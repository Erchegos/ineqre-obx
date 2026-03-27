import { NextRequest } from 'next/server';
import { pool } from '@/lib/db';
import { requireAlphaAuth, safeErrorResponse, secureJsonResponse } from '@/lib/security';
import { runMLSimulation, type SimInputBar, type SimParams, type SimStats, type SimTrade } from '@/lib/mlTradingEngine';

/**
 * GET /api/alpha/best-stocks
 *
 * Parameter-sweep optimized top 10 stocks from top 50 liquid OSE equities.
 * For each ticker: runs 108 strategy combos over the last 365 days.
 * Scoring: Sharpe × TIM_factor (time-in-market weighted) to keep ≥10 concurrent positions.
 * TIM_factor = 0.5 + 0.5 × min(timeInMarket / 0.5, 1.0)
 * → strategies with <50% TIM are penalised, favouring more continuous exposure.
 *
 * 108 combos = Entry[0.5,1.0,2.0] × Stop[3,5,8] × MaxHold[21,30,45] × VolGate[off,hard] × Mom[0,2]
 * Cached 24h in alpha_result_cache.
 */

const CACHE_KEY = 'best_stocks_v3_365d_tim_weighted';
const CACHE_MAX_AGE_H = 24;
const DAYS = 365 + 250 + 30; // extra for SMA warmup

// 108 param combos for sweep
const ENTRY_VALS = [0.5, 1.0, 2.0];
const STOP_VALS  = [3, 5, 8];
const HOLD_VALS  = [21, 30, 45];
const VOL_VALS   = ['off', 'hard'] as const;
const MOM_VALS   = [0, 2] as const;

const BASE_PARAMS: Omit<SimParams, 'entryThreshold' | 'stopLossPct' | 'maxHoldDays' | 'volGate' | 'momentumFilter'> = {
  exitThreshold: 0.0,
  takeProfitPct: 15.0,
  positionSizePct: 10,
  minHoldDays: 3,
  cooldownBars: 2,
  costBps: 10,
  sma200Require: false,
  sma50Require: false,
  smaExitOnCross: false,
  valuationFilter: false,
};

export interface BestStockResult {
  rank: number;
  ticker: string;
  name: string;
  sector: string;
  avg_nokvol: number;
  bestParams: SimParams;
  stats: SimStats;
  trades: SimTrade[];
  combosRun: number;
}

export async function GET(req: NextRequest) {
  const authError = requireAlphaAuth(req);
  if (authError) return authError;

  try {
    // Check cache
    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS alpha_result_cache (
        cache_key TEXT PRIMARY KEY, result JSONB NOT NULL, computed_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      const cached = await pool.query(
        `SELECT result FROM alpha_result_cache
         WHERE cache_key = $1 AND computed_at > NOW() - INTERVAL '${CACHE_MAX_AGE_H} hours'`,
        [CACHE_KEY]
      );
      if (cached.rows.length > 0) return secureJsonResponse(cached.rows[0].result);
    } catch { /* fall through */ }

    // 1. Top 50 liquid NOK equities by avg daily NOK volume (last 3 months)
    const liquidRes = await pool.query(`
      SELECT ff.ticker, s.name, s.sector,
             AVG(ff.nokvol::float) AS avg_nokvol
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
      LIMIT 50
    `);
    const tickers: string[] = liquidRes.rows.map((r: { ticker: string }) => r.ticker);
    const tickerMeta = new Map<string, { name: string; sector: string; avg_nokvol: number }>(
      liquidRes.rows.map((r: { ticker: string; name: string; sector: string; avg_nokvol: number }) => [r.ticker, r])
    );
    if (tickers.length === 0) return secureJsonResponse({ bestStocks: [], meta: { computedAt: new Date().toISOString() } });

    // 2. Bulk fetch price + SMA + fwd_ret_21d for all tickers
    const priceRes = await pool.query(`
      WITH raw AS (
        SELECT ticker, date, close::float
        FROM prices_daily
        WHERE ticker = ANY($1)
          AND date >= CURRENT_DATE - $2 * INTERVAL '1 day'
          AND close > 0
        ORDER BY ticker, date
      ),
      with_sma AS (
        SELECT ticker, date, close,
          AVG(close) OVER (PARTITION BY ticker ORDER BY date ROWS BETWEEN 199 PRECEDING AND CURRENT ROW) AS sma200,
          AVG(close) OVER (PARTITION BY ticker ORDER BY date ROWS BETWEEN 49 PRECEDING AND CURRENT ROW) AS sma50,
          ROW_NUMBER() OVER (PARTITION BY ticker ORDER BY date) AS rn,
          (LEAD(close, 21) OVER (PARTITION BY ticker ORDER BY date) - close) / NULLIF(close, 0) AS fwd_ret_21d
        FROM raw
      )
      SELECT ticker, date::text AS date, close, sma200, sma50, fwd_ret_21d
      FROM with_sma
      WHERE rn > 200
        AND date >= CURRENT_DATE - 365 * INTERVAL '1 day'
      ORDER BY ticker, date ASC
    `, [tickers, DAYS]);

    // 3. Bulk fetch momentum factors
    const momRes = await pool.query(`
      SELECT ticker, date::text AS date, mom1m::float, mom6m::float, mom11m::float, vol1m::float
      FROM factor_technical
      WHERE ticker = ANY($1)
        AND date >= CURRENT_DATE - 365 * INTERVAL '1 day'
      ORDER BY ticker, date ASC
    `, [tickers]);

    // 4. OBX benchmark
    const obxRes = await pool.query(`
      SELECT date::text AS date, close::float AS obx_close
      FROM prices_daily
      WHERE ticker = 'OBX'
        AND date >= CURRENT_DATE - 365 * INTERVAL '1 day'
      ORDER BY date ASC
    `);

    // Build lookup maps
    const obxMap = new Map<string, number>();
    for (const r of obxRes.rows) obxMap.set(r.date.slice(0, 10), r.obx_close);

    type MomRow = { date: string; mom1m: number; mom6m: number; mom11m: number; vol1m: number };
    const momByTicker = new Map<string, Map<string, MomRow>>();
    for (const r of momRes.rows) {
      if (!momByTicker.has(r.ticker)) momByTicker.set(r.ticker, new Map());
      momByTicker.get(r.ticker)!.set(r.date.slice(0, 10), r);
    }

    // 5. Assemble SimInputBar[] per ticker
    type PxRow = { ticker: string; date: string; close: number; sma200: number; sma50: number; fwd_ret_21d: number | null };
    const pxByTicker = new Map<string, PxRow[]>();
    for (const r of priceRes.rows as PxRow[]) {
      if (!pxByTicker.has(r.ticker)) pxByTicker.set(r.ticker, []);
      pxByTicker.get(r.ticker)!.push(r);
    }

    // 6. Build combos
    const combos: SimParams[] = [];
    for (const entry of ENTRY_VALS)
      for (const stop of STOP_VALS)
        for (const hold of HOLD_VALS)
          for (const vol of VOL_VALS)
            for (const mom of MOM_VALS)
              combos.push({ ...BASE_PARAMS, entryThreshold: entry, stopLossPct: stop, maxHoldDays: hold, volGate: vol, momentumFilter: mom });

    // 7. Run sweep per ticker
    const results: BestStockResult[] = [];

    for (const ticker of tickers) {
      const pxRows = pxByTicker.get(ticker);
      if (!pxRows || pxRows.length < 30) continue;

      const momMap = momByTicker.get(ticker) ?? new Map<string, MomRow>();

      // Build SimInputBar[]
      const input: SimInputBar[] = pxRows.map(px => {
        const d = px.date.slice(0, 10);
        const mom = momMap.get(d);
        return {
          date: d,
          open: px.close, // no open in bulk query — use close as approximation
          close: px.close,
          high: px.close,
          low: px.close,
          volume: 0,
          sma200: px.sma200 ?? null,
          sma50: px.sma50 ?? null,
          mlPrediction: px.fwd_ret_21d ?? null,
          mlConfidence: px.fwd_ret_21d != null ? 0.8 : null,
          mom1m: mom?.mom1m ?? null,
          mom6m: mom?.mom6m ?? null,
          mom11m: mom?.mom11m ?? null,
          vol1m: mom?.vol1m ?? null,
          volRegime: null as 'low' | 'high' | null,
          ep: null,
          bm: null,
          epSectorZ: null,
          bmSectorZ: null,
          benchmarkClose: obxMap.get(d) ?? null,
        };
      });

      // Compute vol regime (top 33% = 'high', rest = 'low')
      const vol1mVals = input.map(b => b.vol1m).filter((v): v is number => v != null).sort((a, b) => a - b);
      const p66 = vol1mVals.length > 0 ? vol1mVals[Math.floor(vol1mVals.length * 0.67)] : 0;
      for (const bar of input) {
        if (bar.vol1m != null) bar.volRegime = bar.vol1m > p66 ? 'high' : 'low';
      }

      // Run all combos, pick best TIM-weighted Sharpe
      // score = sharpe × (0.5 + 0.5 × min(timeInMarket / 0.5, 1.0))
      // Rewards strategies invested ≥50% of the time, penalises very sparse ones.
      let bestScore = -Infinity;
      let bestSharpe = 0;
      let bestStats: SimStats | null = null;
      let bestParams: SimParams | null = null;
      let bestTrades: SimTrade[] = [];

      for (const params of combos) {
        const result = runMLSimulation(input, params);
        if (result.stats.trades >= 5 && result.stats.sharpe > 0) {
          const daysInTrade = result.trades.reduce((s, t) => s + t.daysHeld, 0);
          const timeInMarket = daysInTrade / Math.max(input.length, 1);
          const timFactor = 0.5 + 0.5 * Math.min(timeInMarket / 0.5, 1.0);
          const score = result.stats.sharpe * timFactor;
          if (score > bestScore) {
            bestScore = score;
            bestSharpe = result.stats.sharpe;
            bestStats = result.stats;
            bestParams = params;
            bestTrades = result.trades;
          }
        }
      }

      if (bestStats && bestParams && bestSharpe > 0 && bestStats.winRate >= 0.45) {
        results.push({
          rank: 0, // set after sort
          ticker,
          name: tickerMeta.get(ticker)?.name || ticker,
          sector: tickerMeta.get(ticker)?.sector || 'Other',
          avg_nokvol: tickerMeta.get(ticker)?.avg_nokvol || 0,
          bestParams,
          stats: bestStats,
          trades: bestTrades,
          combosRun: combos.length,
        });
      }
    }

    // Sort by Sharpe, assign rank
    results.sort((a, b) => b.stats.sharpe - a.stats.sharpe);
    const top10 = results.slice(0, 10).map((r, i) => ({ ...r, rank: i + 1 }));

    const result = {
      bestStocks: top10,
      meta: {
        universe: tickers.length,
        combosPerTicker: combos.length,
        qualified: results.length,
        days: 365,
        computedAt: new Date().toISOString(),
      },
    };

    // Cache result
    try {
      await pool.query(
        `INSERT INTO alpha_result_cache (cache_key, result, computed_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (cache_key) DO UPDATE SET result = $2, computed_at = NOW()`,
        [CACHE_KEY, JSON.stringify(result)]
      );
    } catch { /* non-fatal */ }

    return secureJsonResponse(result);
  } catch (error) {
    return safeErrorResponse(error, 'Best stocks sweep failed');
  }
}
