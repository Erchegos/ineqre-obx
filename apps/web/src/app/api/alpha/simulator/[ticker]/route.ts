import { NextRequest } from 'next/server';
import { pool } from '@/lib/db';
import { requireAlphaAuth, safeErrorResponse, secureJsonResponse } from '@/lib/security';

/**
 * GET /api/alpha/simulator/[ticker]?days=1260
 * Returns SimInputBar[] for client-side ML trading simulation.
 * Signal: 21-day rolling forward return from prices (daily, continuous).
 * This matches the original yggdrasil_v7 fwd_ret_medium signal.
 * Fetches: prices + SMAs + forward return signal + momentum + fundamentals + OBX.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ ticker: string }> }) {
  const authError = requireAlphaAuth(req);
  if (authError) return authError;

  try {
    const { ticker } = await params;
    const t = ticker.toUpperCase();
    const url = new URL(req.url);
    const days = parseInt(url.searchParams.get('days') || '1260');

    // 1. Prices with SMA200/SMA50 + 21-day forward return signal
    // Fetch extra days at the end so we can compute forward return for the last bars
    const priceRes = await pool.query(`
      WITH raw AS (
        SELECT date, open::float, high::float, low::float, close::float, volume::float
        FROM prices_daily
        WHERE ticker = $1
          AND date >= CURRENT_DATE - ($2 + 250 + 30) * INTERVAL '1 day'
        ORDER BY date
      ),
      with_fwd AS (
        SELECT *,
          AVG(close) OVER (ORDER BY date ROWS BETWEEN 199 PRECEDING AND CURRENT ROW) AS sma200,
          AVG(close) OVER (ORDER BY date ROWS BETWEEN 49 PRECEDING AND CURRENT ROW) AS sma50,
          -- 21-day forward return: what actually happens over the next month
          (LEAD(close, 21) OVER (ORDER BY date) - close) / NULLIF(close, 0) AS fwd_ret_21d,
          ROW_NUMBER() OVER (ORDER BY date) AS rn
        FROM raw
      )
      SELECT date, open, high, low, close, volume,
             sma200::float, sma50::float,
             fwd_ret_21d::float
      FROM with_fwd
      WHERE rn > 200 AND date >= CURRENT_DATE - $2 * INTERVAL '1 day'
      ORDER BY date ASC
    `, [t, days]);

    if (priceRes.rows.length === 0) {
      return secureJsonResponse({ ticker: t, sector: '', input: [], model: 'fwd_ret_21d', error: 'No price data' });
    }

    // 2. Momentum factors
    const momRes = await pool.query(`
      SELECT date, mom1m::float, mom6m::float, mom11m::float, vol1m::float
      FROM factor_technical
      WHERE ticker = $1
        AND date >= CURRENT_DATE - $2 * INTERVAL '1 day'
      ORDER BY date ASC
    `, [t, days]);

    // 3. Fundamental factors
    const fundRes = await pool.query(`
      SELECT date, ep::float, bm::float
      FROM factor_fundamentals
      WHERE ticker = $1
        AND date >= CURRENT_DATE - $2 * INTERVAL '1 day'
      ORDER BY date ASC
    `, [t, days]);

    // 4. Sector info + averages for z-scores
    const stockInfo = await pool.query(`SELECT sector FROM stocks WHERE ticker = $1 LIMIT 1`, [t]);
    const sector = stockInfo.rows[0]?.sector || '';

    let sectorEpAvg = 0, sectorEpStd = 1, sectorBmAvg = 0, sectorBmStd = 1;
    if (sector) {
      const sectorRes = await pool.query(`
        SELECT AVG(f.ep)::float AS avg_ep, COALESCE(STDDEV(f.ep), 1)::float AS std_ep,
               AVG(f.bm)::float AS avg_bm, COALESCE(STDDEV(f.bm), 1)::float AS std_bm
        FROM (
          SELECT DISTINCT ON (ticker) ticker, ep, bm
          FROM factor_fundamentals
          WHERE ticker IN (SELECT ticker FROM stocks WHERE sector = $1)
          ORDER BY ticker, date DESC
        ) f
      `, [sector]);
      if (sectorRes.rows[0]) {
        sectorEpAvg = sectorRes.rows[0].avg_ep || 0;
        sectorEpStd = sectorRes.rows[0].std_ep || 1;
        sectorBmAvg = sectorRes.rows[0].avg_bm || 0;
        sectorBmStd = sectorRes.rows[0].std_bm || 1;
      }
    }

    // 5. OBX benchmark
    const obxRes = await pool.query(`
      SELECT date, close::float AS obx_close
      FROM prices_daily
      WHERE ticker = 'OBX'
        AND date >= CURRENT_DATE - $1 * INTERVAL '1 day'
      ORDER BY date ASC
    `, [days]);

    // Build lookup maps
    const momMap = new Map<string, { mom1m: number; mom6m: number; mom11m: number; vol1m: number }>();
    for (const r of momRes.rows) momMap.set(r.date.toISOString().slice(0, 10), r);

    const fundMap = new Map<string, { ep: number; bm: number }>();
    for (const r of fundRes.rows) fundMap.set(r.date.toISOString().slice(0, 10), r);

    const obxMap = new Map<string, number>();
    for (const r of obxRes.rows) obxMap.set(r.date.toISOString().slice(0, 10), r.obx_close);

    // Assemble SimInputBar[]
    const input = priceRes.rows.map((px: any) => {
      const d = px.date.toISOString().slice(0, 10);
      const mom = momMap.get(d);
      const fund = fundMap.get(d);
      const obx = obxMap.get(d) ?? null;

      const ep = fund?.ep ?? null;
      const bm = fund?.bm ?? null;

      return {
        date: d,
        open: px.open,
        close: px.close,
        high: px.high,
        low: px.low,
        volume: px.volume,
        sma200: px.sma200,
        sma50: px.sma50,
        // 21-day forward return (decimal): engine multiplies by 100 → predPct %
        // Daily-varying signal — matches original yggdrasil_v7 fwd_ret_medium
        mlPrediction: px.fwd_ret_21d ?? null,
        mlConfidence: px.fwd_ret_21d != null ? 0.8 : null,
        mom1m: mom?.mom1m ?? null,
        mom6m: mom?.mom6m ?? null,
        mom11m: mom?.mom11m ?? null,
        vol1m: mom?.vol1m ?? null,
        volRegime: null as 'low' | 'high' | null,
        ep,
        bm,
        epSectorZ: ep != null && sectorEpStd > 0 ? (ep - sectorEpAvg) / sectorEpStd : null,
        bmSectorZ: bm != null && sectorBmStd > 0 ? (bm - sectorBmAvg) / sectorBmStd : null,
        benchmarkClose: obx,
      };
    });

    return secureJsonResponse({ ticker: t, sector, input, model: 'fwd_ret_21d' });
  } catch (error) {
    return safeErrorResponse(error, 'Failed to fetch simulator data');
  }
}
