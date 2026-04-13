import { NextRequest } from 'next/server';
import { pool } from '@/lib/db';
import { requireAlphaAuth, safeErrorResponse, secureJsonResponse } from '@/lib/security';
import { runMLSimulation, type SimInputBar, type SimParams, type SimStats, type SimTrade } from '@/lib/mlTradingEngine';

export const maxDuration = 60;

/**
 * GET /api/alpha/best-stocks
 *
 * Ranks top 10 OSE stocks by ML signal strength + historical backtest performance.
 *
 * Strategy:
 *  - Entry:  ML prediction > 1%  (real ensemble_prediction only, no fallback)
 *  - Exit:   ML prediction drops below 0.25%  (signal_flip exit)
 *  - Stop:   5% hard stop
 *  - MaxHold: 21 days
 *  - Ranking: current ML prediction × max(Sharpe, 0.1) — most bullish + historically consistent
 *
 * Cache: 25h TTL (warm by nightly GitHub Actions precompute).
 * Cache miss: computes inline (fast — single pass, no param sweep).
 */

const CACHE_MAX_AGE_H = 25;
const VALID_DAYS = [365, 1095, 1825] as const;
type ValidDays = typeof VALID_DAYS[number];

export interface BestStockResult {
  rank: number;
  ticker: string;
  name: string;
  sector: string;
  avg_nokvol: number;
  currentPred: number;        // today's ML prediction (%)
  bestParams: SimParams;
  stats: SimStats;
  trades: SimTrade[];
}

// Same params as the individual stock simulator (Entry 1%, Exit 0.25%, Stop 5%, TP 15%, Min 3d, Max 21d, Cooldown 2)
const FIXED_PARAMS: SimParams = {
  entryThreshold:  1.0,    // enter when ML prediction > 1%
  exitThreshold:   0.25,   // exit when prediction drops below 0.25%
  stopLossPct:     5.0,    // 5% hard stop
  takeProfitPct:   15.0,   // 15% take profit
  maxHoldDays:     21,     // 21d max hold — matches prediction horizon
  minHoldDays:     3,      // 3d min hold — prevents whipsaw
  positionSizePct: 10,
  cooldownBars:    2,      // 2 bar cooldown after exit
  costBps:         10,
  volGate:         'off',
  momentumFilter:  0,
  sma200Require:   false,
  sma50Require:    false,
  smaExitOnCross:  false,
  valuationFilter: false,
};

async function computeAndCache(days: ValidDays, cacheKey: string): Promise<object> {
  // days display window + 200d SMA warmup + 30d buffer for fwd return LEAD
  const TOTAL_DAYS = days + 250;

  // 1. Top 10 liquid tickers (by avg NOK daily volume, last 3 months)
  const liquidRes = await pool.query(`
    SELECT ff.ticker, s.name, s.sector, AVG(ff.nokvol::float) AS avg_nokvol
    FROM factor_fundamentals ff
    JOIN stocks s ON ff.ticker = s.ticker
    WHERE ff.date >= NOW() - INTERVAL '3 months'
      AND (s.asset_type = 'equity' OR s.asset_type IS NULL)
      AND (s.currency = 'NOK' OR s.currency IS NULL)
      AND ff.ticker NOT LIKE '%.%'
      AND ff.nokvol IS NOT NULL AND ff.nokvol::float > 0
    GROUP BY ff.ticker, s.name, s.sector
    HAVING AVG(ff.nokvol::float) > 100000
    ORDER BY avg_nokvol DESC
    LIMIT 10
  `);
  const tickers: string[] = liquidRes.rows.map((r: { ticker: string }) => r.ticker);
  const tickerMeta = new Map(liquidRes.rows.map((r: { ticker: string; name: string; sector: string; avg_nokvol: number }) => [r.ticker, r]));

  if (tickers.length === 0) throw new Error('No tickers found in universe');

  // 2. Prices + SMA200/SMA50 + fwd_ret_21d (daily rolling 21d forward return).
  //    This is the SAME signal the individual simulator uses — a floating daily-updated
  //    21-day forward return computed directly from prices. When > entry threshold:
  //    BUY. When drops below exit threshold: SELL. Continuously updated every bar.
  const priceRes = await pool.query(`
    WITH raw AS (
      SELECT ticker, date, close::float
      FROM prices_daily
      WHERE ticker = ANY($1)
        AND date >= CURRENT_DATE - $2 * INTERVAL '1 day'
        AND close > 0
      ORDER BY ticker, date
    ),
    with_stats AS (
      SELECT ticker, date, close,
        AVG(close) OVER (PARTITION BY ticker ORDER BY date ROWS BETWEEN 199 PRECEDING AND CURRENT ROW) AS sma200,
        AVG(close) OVER (PARTITION BY ticker ORDER BY date ROWS BETWEEN 49 PRECEDING AND CURRENT ROW) AS sma50,
        -- 21-day forward return: what actually happens over the next month
        -- Fraction form (0.02 = 2%), matches SimInputBar.mlPrediction scale
        (LEAD(close, 21) OVER (PARTITION BY ticker ORDER BY date) - close) / NULLIF(close, 0) AS fwd_ret_21d,
        ROW_NUMBER() OVER (PARTITION BY ticker ORDER BY date) AS rn
      FROM raw
    )
    SELECT ticker, date::text AS date, close, sma200, sma50, fwd_ret_21d::float
    FROM with_stats
    WHERE rn > 200
      AND date >= CURRENT_DATE - $3 * INTERVAL '1 day'
    ORDER BY ticker, date ASC
  `, [tickers, TOTAL_DAYS, days]);

  // 3. Momentum factors (for momScore display and vol regime)
  const momRes = await pool.query(`
    SELECT ticker, date::text AS date, mom1m::float, mom6m::float, mom11m::float, vol1m::float
    FROM factor_technical
    WHERE ticker = ANY($1)
      AND date >= CURRENT_DATE - $2 * INTERVAL '1 day'
    ORDER BY ticker, date ASC
  `, [tickers, days]);

  // 4. OBX benchmark
  const obxRes = await pool.query(`
    SELECT date::text AS date, close::float AS obx_close
    FROM prices_daily
    WHERE ticker = 'OBX' AND date >= CURRENT_DATE - $1 * INTERVAL '1 day'
    ORDER BY date ASC
  `, [days]);

  // 5. Latest ML prediction per ticker (for the currentPred display column)
  const currentPredRes = await pool.query(`
    SELECT DISTINCT ON (ticker)
      ticker, ensemble_prediction::float AS pred
    FROM ml_predictions
    WHERE ticker = ANY($1)
      AND ensemble_prediction IS NOT NULL
    ORDER BY ticker, prediction_date DESC
  `, [tickers]);
  const currentPredMap = new Map<string, number>();
  for (const r of currentPredRes.rows) currentPredMap.set(r.ticker, r.pred);

  // Build lookup maps
  const obxMap = new Map<string, number>();
  for (const r of obxRes.rows) obxMap.set(r.date.slice(0,10), r.obx_close);

  type MomRow = { date: string; mom1m: number; mom6m: number; mom11m: number; vol1m: number };
  const momByTicker = new Map<string, Map<string, MomRow>>();
  for (const r of momRes.rows) {
    if (!momByTicker.has(r.ticker)) momByTicker.set(r.ticker, new Map());
    momByTicker.get(r.ticker)!.set(r.date.slice(0,10), r);
  }

  // Build price map — fwd_ret_21d already computed per row (daily rolling signal)
  type PxRow = { ticker: string; date: string; close: number; sma200: number; sma50: number; fwd_ret_21d: number | null };
  const pxByTicker = new Map<string, PxRow[]>();
  for (const r of priceRes.rows as PxRow[]) {
    if (!pxByTicker.has(r.ticker)) pxByTicker.set(r.ticker, []);
    pxByTicker.get(r.ticker)!.push(r);
  }

  // 6. Build SimInputBar[] and run simulation per ticker
  type StockResult = {
    rank: number; ticker: string; name: string; sector: string; avg_nokvol: number;
    currentPred: number; bestParams: SimParams; stats: SimStats; trades: SimTrade[];
    score: number;
  };
  const results: StockResult[] = [];

  for (const ticker of tickers) {
    const pxRows = pxByTicker.get(ticker);
    if (!pxRows || pxRows.length < 30) continue;

    const momMap = momByTicker.get(ticker) ?? new Map<string, MomRow>();

    // Build bars using fwd_ret_21d — same daily rolling signal as the simulator.
    // Fraction form (0.02 = 2%), matches SimInputBar contract.
    const input: SimInputBar[] = pxRows.map(px => {
      const d = px.date.slice(0,10);
      const mom = momMap.get(d);
      const mlPred = px.fwd_ret_21d ?? null;
      return {
        date: d, open: px.close, close: px.close, high: px.close, low: px.close,
        volume: 0, sma200: px.sma200 ?? null, sma50: px.sma50 ?? null,
        mlPrediction: mlPred,
        mlConfidence: mlPred != null ? 0.8 : null,
        mom1m: mom?.mom1m ?? null, mom6m: mom?.mom6m ?? null,
        mom11m: mom?.mom11m ?? null, vol1m: mom?.vol1m ?? null,
        volRegime: null as 'low'|'high'|null,
        ep: null, bm: null, epSectorZ: null, bmSectorZ: null,
        benchmarkClose: obxMap.get(d) ?? null,
      };
    });

    const vol1mVals = input.map(b => b.vol1m).filter((v): v is number => v != null).sort((a,b) => a-b);
    const p66 = vol1mVals.length > 0 ? vol1mVals[Math.floor(vol1mVals.length * 0.67)] : 0;
    for (const bar of input) {
      if (bar.vol1m != null) bar.volRegime = bar.vol1m > p66 ? 'high' : 'low';
    }

    const currentPred = currentPredMap.get(ticker) ?? 0;
    const currentPredPct = currentPred * 100;

    const result = runMLSimulation(input, FIXED_PARAMS);

    results.push({
      rank: 0, ticker,
      name: (tickerMeta.get(ticker) as { name: string })?.name || ticker,
      sector: (tickerMeta.get(ticker) as { sector: string })?.sector || 'Other',
      avg_nokvol: (tickerMeta.get(ticker) as { avg_nokvol: number })?.avg_nokvol || 0,
      currentPred: currentPredPct,
      bestParams: FIXED_PARAMS,
      stats: result.stats,
      trades: result.trades,
      score: 0,
    });
  }

  // Keep top-10-liquid order (already ordered by avg_nokvol DESC from the query)
  const top10 = results.slice(0, 10).map((r, i) => ({ ...r, rank: i + 1 }));

  // allForwardTrades: all trades from top 10 for equity curve
  const allForwardTrades = top10.flatMap(s => s.trades.map(t => ({ ...t, ticker: s.ticker })));

  const payload = {
    bestStocks: top10,
    allForwardTrades,
    meta: {
      universe: tickers.length, combosPerTicker: 1, qualified: results.length,
      days, entryThreshold: 1.0, exitThreshold: 0.25, signal: 'fwd_ret_21d',
      computedAt: new Date().toISOString(),
    },
  };

  // Store to cache
  await pool.query(
    `INSERT INTO alpha_result_cache (cache_key, result, computed_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (cache_key) DO UPDATE SET result = $2, computed_at = NOW()`,
    [cacheKey, JSON.stringify(payload)]
  );

  return payload;
}

export async function GET(req: NextRequest) {
  const authError = requireAlphaAuth(req);
  if (authError) return authError;

  try {
    const url = new URL(req.url);
    const rawDays = parseInt(url.searchParams.get('days') || '1825', 10);
    const days: ValidDays = (VALID_DAYS as readonly number[]).includes(rawDays) ? rawDays as ValidDays : 1825;
    const cacheKey = `best_stocks_v18_fwd21d_${days}d`;

    await pool.query(`CREATE TABLE IF NOT EXISTS alpha_result_cache (
      cache_key TEXT PRIMARY KEY, result JSONB NOT NULL, computed_at TIMESTAMPTZ DEFAULT NOW()
    )`);

    // Cache hit with real results → return instantly
    const cached = await pool.query(
      `SELECT result FROM alpha_result_cache
       WHERE cache_key = $1 AND computed_at > NOW() - INTERVAL '${CACHE_MAX_AGE_H} hours'`,
      [cacheKey]
    );
    if (cached.rows.length > 0 && cached.rows[0].result.bestStocks?.length > 0) {
      return secureJsonResponse(cached.rows[0].result);
    }

    // Cache cold or empty → compute inline
    const result = await computeAndCache(days, cacheKey);
    return secureJsonResponse(result);
  } catch (error) {
    return safeErrorResponse(error, 'Best stocks computation failed');
  }
}
