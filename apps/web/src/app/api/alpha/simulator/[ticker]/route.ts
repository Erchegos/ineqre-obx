import { NextRequest } from 'next/server';
import { pool } from '@/lib/db';
import { requireAlphaAuth, safeErrorResponse, secureJsonResponse } from '@/lib/security';

/**
 * GET /api/alpha/simulator/[ticker]?days=1260&model=yggdrasil_v7
 * Returns SimInputBar[] for client-side ML trading simulation.
 * Fetches: prices + SMAs + alpha signals + momentum + fundamentals + OBX benchmark.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ ticker: string }> }) {
  const authError = requireAlphaAuth(req);
  if (authError) return authError;

  try {
    const { ticker } = await params;
    const t = ticker.toUpperCase();
    const url = new URL(req.url);
    const days = parseInt(url.searchParams.get('days') || '1260');
    const model = url.searchParams.get('model') || 'yggdrasil_v7';

    // 1. Prices with SMA200/SMA50 (window functions in SQL, same pattern as signals/[ticker])
    const priceRes = await pool.query(`
      WITH raw AS (
        SELECT date, open::float, high::float, low::float, close::float, volume::float
        FROM prices_daily
        WHERE ticker = $1
          AND date >= CURRENT_DATE - ($2 + 250) * INTERVAL '1 day'
        ORDER BY date
      ),
      with_sma AS (
        SELECT *,
          AVG(close) OVER (ORDER BY date ROWS BETWEEN 199 PRECEDING AND CURRENT ROW) AS sma200,
          AVG(close) OVER (ORDER BY date ROWS BETWEEN 49 PRECEDING AND CURRENT ROW) AS sma50,
          ROW_NUMBER() OVER (ORDER BY date) AS rn
        FROM raw
      )
      SELECT date, open, high, low, close, volume,
             sma200::float, sma50::float
      FROM with_sma
      WHERE rn > 200 AND date >= CURRENT_DATE - $2 * INTERVAL '1 day'
      ORDER BY date ASC
    `, [t, days]);

    if (priceRes.rows.length === 0) {
      return secureJsonResponse({ ticker: t, sector: '', input: [], model, error: 'No price data' });
    }

    // 2. Alpha signals (fetch signal_value z-score for daily composite)
    const sigRes = await pool.query(`
      SELECT signal_date AS date, predicted_return::float, confidence::float,
             signal_value::float
      FROM alpha_signals
      WHERE ticker = $1 AND model_id = $2
        AND signal_date >= CURRENT_DATE - ($3 + 60) * INTERVAL '1 day'
      ORDER BY signal_date ASC
    `, [t, model, days]);

    // 3. Momentum factors
    const momRes = await pool.query(`
      SELECT date, mom1m::float, mom6m::float, mom11m::float, vol1m::float
      FROM factor_technical
      WHERE ticker = $1
        AND date >= CURRENT_DATE - $2 * INTERVAL '1 day'
      ORDER BY date ASC
    `, [t, days]);

    // 4. Fundamental factors (time series for the period)
    const fundRes = await pool.query(`
      SELECT date, ep::float, bm::float
      FROM factor_fundamentals
      WHERE ticker = $1
        AND date >= CURRENT_DATE - $2 * INTERVAL '1 day'
      ORDER BY date ASC
    `, [t, days]);

    // 5. Sector info + averages for z-scores
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

    // 6. OBX benchmark
    const obxRes = await pool.query(`
      SELECT date, close::float AS obx_close
      FROM prices_daily
      WHERE ticker = 'OBX'
        AND date >= CURRENT_DATE - $1 * INTERVAL '1 day'
      ORDER BY date ASC
    `, [days]);

    // Build lookup maps (date string → data)
    const sigMap = new Map<string, { predicted_return: number; confidence: number; signal_value: number }>();
    for (const r of sigRes.rows) sigMap.set(r.date.toISOString().slice(0, 10), r);

    const momMap = new Map<string, { mom1m: number; mom6m: number; mom11m: number; vol1m: number }>();
    for (const r of momRes.rows) momMap.set(r.date.toISOString().slice(0, 10), r);

    const fundMap = new Map<string, { ep: number; bm: number }>();
    for (const r of fundRes.rows) fundMap.set(r.date.toISOString().slice(0, 10), r);

    const obxMap = new Map<string, number>();
    for (const r of obxRes.rows) obxMap.set(r.date.toISOString().slice(0, 10), r.obx_close);

    // ── Daily composite signal ──────────────────────────────────────────────
    // The original signals were daily ML predictions that updated every bar.
    // Reconstruct by combining step-held ML z-score (monthly anchor) with
    // smooth daily momentum (actual factor values, not binary). No SMA price
    // position — those are lagging and inversely predictive for short holds.
    //
    // Components:
    //   ML z-score (step-held)  : 70% — cross-sectional prediction rank
    //   Momentum (smooth daily) : 30% — trend confirmation from factor_technical
    //
    // Scale: composite [-1,+1] × 0.08 → engine ×100 → predPct [-8,+8]
    // Old signals ranged roughly -2% to +6% for ORK — this matches.

    let heldMlZ = 0;
    let heldConfidence = 0.5;

    // Assemble SimInputBar[] with daily composite signals
    const input = priceRes.rows.map((px: any) => {
      const d = px.date.toISOString().slice(0, 10);
      const sig = sigMap.get(d);
      const mom = momMap.get(d);
      const fund = fundMap.get(d);
      const obx = obxMap.get(d) ?? null;

      // Step-hold ML z-score from monthly alpha_signals
      if (sig) {
        heldMlZ = sig.signal_value ?? 0;
        heldConfidence = sig.confidence ?? 0.5;
      }

      // Smooth daily momentum: use actual momentum VALUES (not binary sign)
      // Normalized to [-1,+1] by typical magnitude per timeframe
      const normMom1m = mom ? Math.max(-1, Math.min(1, (mom.mom1m ?? 0) / 0.15)) : 0;
      const normMom6m = mom ? Math.max(-1, Math.min(1, (mom.mom6m ?? 0) / 0.30)) : 0;
      const normMom11m = mom ? Math.max(-1, Math.min(1, (mom.mom11m ?? 0) / 0.50)) : 0;
      const momScore = 0.3 * normMom1m + 0.4 * normMom6m + 0.3 * normMom11m;

      // Daily composite: ML dominates, momentum adds daily variation
      const composite = 0.70 * heldMlZ + 0.30 * momScore;

      // Scale to match old signal range (predPct ≈ [-6, +6])
      const dailyPrediction = composite * 0.08;

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
        mlPrediction: dailyPrediction,
        mlConfidence: heldConfidence,
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

    return secureJsonResponse({ ticker: t, sector, input, model });
  } catch (error) {
    return safeErrorResponse(error, 'Failed to fetch simulator data');
  }
}
