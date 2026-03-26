import { NextRequest } from 'next/server';
import { pool } from '@/lib/db';
import { requireAlphaAuth, safeErrorResponse, secureJsonResponse } from '@/lib/security';

/**
 * GET /api/alpha/simulator/[ticker]?days=1260
 * Returns SimInputBar[] for client-side ML trading simulation.
 * Reads directly from ml_predictions (ensemble_prediction) — independent of alpha_signals.
 * Fetches: prices + SMAs + ML predictions + momentum + fundamentals + OBX benchmark.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ ticker: string }> }) {
  const authError = requireAlphaAuth(req);
  if (authError) return authError;

  try {
    const { ticker } = await params;
    const t = ticker.toUpperCase();
    const url = new URL(req.url);
    const days = parseInt(url.searchParams.get('days') || '1260');

    // 1. Prices with SMA200/SMA50
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
      return secureJsonResponse({ ticker: t, sector: '', input: [], model: 'ml_predictions', error: 'No price data' });
    }

    // 2. ML predictions — use ensemble_prediction directly (actual 1-month forward return)
    const mlRes = await pool.query(`
      SELECT prediction_date AS date,
             ensemble_prediction::float AS prediction,
             confidence_score::float AS confidence
      FROM ml_predictions
      WHERE ticker = $1
        AND prediction_date >= CURRENT_DATE - ($2 + 60) * INTERVAL '1 day'
      ORDER BY prediction_date ASC
    `, [t, days]);

    // 3. Momentum factors
    const momRes = await pool.query(`
      SELECT date, mom1m::float, mom6m::float, mom11m::float, vol1m::float
      FROM factor_technical
      WHERE ticker = $1
        AND date >= CURRENT_DATE - $2 * INTERVAL '1 day'
      ORDER BY date ASC
    `, [t, days]);

    // 4. Fundamental factors
    const fundRes = await pool.query(`
      SELECT date, ep::float, bm::float
      FROM factor_fundamentals
      WHERE ticker = $1
        AND date >= CURRENT_DATE - $2 * INTERVAL '1 day'
      ORDER BY date ASC
    `, [t, days]);

    // 5. Sector info + averages for valuation z-scores
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

    // Build lookup maps
    const mlMap = new Map<string, { prediction: number; confidence: number }>();
    for (const r of mlRes.rows) mlMap.set(r.date.toISOString().slice(0, 10), r);

    const momMap = new Map<string, { mom1m: number; mom6m: number; mom11m: number; vol1m: number }>();
    for (const r of momRes.rows) momMap.set(r.date.toISOString().slice(0, 10), r);

    const fundMap = new Map<string, { ep: number; bm: number }>();
    for (const r of fundRes.rows) fundMap.set(r.date.toISOString().slice(0, 10), r);

    const obxMap = new Map<string, number>();
    for (const r of obxRes.rows) obxMap.set(r.date.toISOString().slice(0, 10), r.obx_close);

    // ── ML Prediction pass-through ───────────────────────────────────────────
    // Use ensemble_prediction directly from ml_predictions table.
    // This is the actual 1-month forward return prediction from the Ridge/GB/RF
    // ensemble. Values range [-15%, +10%] with stddev ~3%.
    //
    // The engine multiplies by 100 → predPct in percent (e.g. 0.03 → 3%).
    // Default entry threshold 1% works well with this range.
    //
    // Momentum is NOT mixed into the signal — it stays as a separate UI filter.
    // This keeps the ML signal pure and interpretable.

    let heldPrediction: number | null = null;
    let heldConfidence = 0.5;

    const input = priceRes.rows.map((px: any) => {
      const d = px.date.toISOString().slice(0, 10);
      const ml = mlMap.get(d);
      const mom = momMap.get(d);
      const fund = fundMap.get(d);
      const obx = obxMap.get(d) ?? null;

      // Step-hold: carry forward last known ML prediction
      if (ml) {
        heldPrediction = ml.prediction;
        heldConfidence = ml.confidence ?? 0.5;
      }

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
        mlPrediction: heldPrediction,  // Raw ensemble prediction (decimal, e.g. 0.03 = 3%)
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

    return secureJsonResponse({ ticker: t, sector, input, model: 'ml_predictions' });
  } catch (error) {
    return safeErrorResponse(error, 'Failed to fetch simulator data');
  }
}
