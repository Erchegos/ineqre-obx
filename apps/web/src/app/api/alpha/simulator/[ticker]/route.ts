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
    // Monthly ML prediction alone is flat and tiny. The original signals were
    // daily composites of ML z-score + momentum + price trend. Recompute that
    // here so the simulator gets daily-varying, properly-scaled signals.
    //
    // Components (weights sum to 1.0):
    //   ML z-score (step-held monthly)  : 35% — directional ML view
    //   Momentum alignment (daily)      : 30% — trend confirmation
    //   Price vs SMA200 (daily)         : 20% — long-term trend
    //   Price vs SMA50 (daily)          : 15% — short-term trend
    //
    // Composite range: ±1.0 → scaled by 0.15 → predicted_return ±0.15
    // Engine does ×100 → predPct ±15% (matches original signal magnitude)

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

      // Momentum component: daily alignment of 1m/6m/11m [-1, +1]
      const momScore = mom ? (
        ((mom.mom1m ?? 0) > 0 ? 1 : -1) * 0.3 +
        ((mom.mom6m ?? 0) > 0 ? 1 : -1) * 0.4 +
        ((mom.mom11m ?? 0) > 0 ? 1 : -1) * 0.3
      ) : 0;

      // Price vs SMA200: daily trend position [-1, +1]
      const priceSma200 = (px.sma200 && px.sma200 > 0)
        ? Math.max(-1, Math.min(1, (px.close - px.sma200) / px.sma200 / 0.15))
        : 0;

      // Price vs SMA50: daily short-term trend [-1, +1]
      const priceSma50 = (px.sma50 && px.sma50 > 0)
        ? Math.max(-1, Math.min(1, (px.close - px.sma50) / px.sma50 / 0.10))
        : 0;

      // Daily composite signal [-1, +1]
      const composite =
        0.35 * heldMlZ +       // ML prediction (monthly, step-held z-score)
        0.30 * momScore +       // Momentum alignment (daily)
        0.20 * priceSma200 +    // Long-term price trend (daily)
        0.15 * priceSma50;      // Short-term price trend (daily)

      // Scale to predicted_return magnitude: composite ±1 → ±0.15
      // Engine does ×100 → predPct ±15% (matches old signal range)
      const dailyPrediction = composite * 0.15;

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
