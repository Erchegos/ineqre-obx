#!/usr/bin/env tsx

/**
 * precompute-alpha.ts
 *
 * Runs the walk-forward Alpha Engine sweep and stores results to alpha_result_cache.
 * Meant to be run nightly on the VPS or via GitHub Actions so Vercel routes
 * always serve from DB cache — zero computation on page load.
 *
 * Also warms the top-performers cache by triggering that computation inline.
 *
 * Usage:
 *   npx tsx scripts/precompute-alpha.ts
 *   DATABASE_URL=... NODE_TLS_REJECT_UNAUTHORIZED=0 npx tsx scripts/precompute-alpha.ts
 *
 * Schedule: nightly at 02:00 UTC (after ML pipeline at 01:00 UTC)
 */

import { resolve } from 'path';
import { config } from 'dotenv';

config({ path: resolve(__dirname, '../.env.local') });
config({ path: resolve(__dirname, '../.env') });

import { Pool } from 'pg';
import { runMLSimulation, type SimInputBar, type SimParams, type SimStats, type SimTrade } from '../src/lib/mlTradingEngine';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0' ? { rejectUnauthorized: false } : undefined,
  max: 5,
});

// ── Walk-Forward Config ─────────────────────────────────────────────────────

const BEST_STOCKS_KEY  = 'best_stocks_v4_365d_walk_forward';
const TOP_PERF_KEY     = 'top_performers_v2_fwd21d';
const SMA_WARMUP       = 230;
const TRAIN_DAYS       = 90;
const FORWARD_DAYS     = 90;
const TOP_N            = 10;
const MIN_TRAIN_TRADES = 3;

const ENTRY_VALS = [0.5, 1.0, 2.0];
const STOP_VALS  = [3, 5, 8];
const HOLD_VALS  = [21, 30];
const VOL_VALS   = ['off', 'hard'] as const;
const MOM_VALS   = [0, 2] as const;

const BASE_PARAMS: Omit<SimParams, 'entryThreshold'|'stopLossPct'|'maxHoldDays'|'volGate'|'momentumFilter'> = {
  exitThreshold: 0.0, takeProfitPct: 15.0, positionSizePct: 10, minHoldDays: 3,
  cooldownBars: 2, costBps: 10, sma200Require: false, sma50Require: false,
  smaExitOnCross: false, valuationFilter: false,
};

// ── Helpers ─────────────────────────────────────────────────────────────────

function log(msg: string) { console.log(`[${new Date().toISOString()}] ${msg}`); }

// ── Best Stocks Walk-Forward ─────────────────────────────────────────────────

async function computeBestStocks() {
  log('Starting walk-forward best-stocks sweep...');

  const TOTAL_DAYS = 365 + SMA_WARMUP;

  // 1. Top 50 liquid tickers
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
    LIMIT 50
  `);
  const tickers: string[] = liquidRes.rows.map((r: { ticker: string }) => r.ticker);
  const tickerMeta = new Map(liquidRes.rows.map((r: { ticker: string; name: string; sector: string; avg_nokvol: number }) => [r.ticker, r]));

  log(`Universe: ${tickers.length} tickers`);
  if (tickers.length === 0) { log('No tickers found, aborting.'); return; }

  // 2. Prices (last 365 days, post SMA warmup)
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
        ROW_NUMBER() OVER (PARTITION BY ticker ORDER BY date) AS rn
      FROM raw
    )
    SELECT ticker, date::text AS date, close, sma200, sma50
    FROM with_sma
    WHERE rn > 200
      AND date >= CURRENT_DATE - 365 * INTERVAL '1 day'
    ORDER BY ticker, date ASC
  `, [tickers, TOTAL_DAYS]);

  // 3. Momentum factors
  const momRes = await pool.query(`
    SELECT ticker, date::text AS date, mom1m::float, mom6m::float, mom11m::float, vol1m::float
    FROM factor_technical
    WHERE ticker = ANY($1)
      AND date >= CURRENT_DATE - 365 * INTERVAL '1 day'
    ORDER BY ticker, date ASC
  `, [tickers]);

  // 4. ML predictions (actual model output — no future data)
  const mlRes = await pool.query(`
    SELECT DISTINCT ON (ticker, prediction_date::date)
      ticker, prediction_date::date::text AS date,
      ensemble_prediction::float AS pred
    FROM ml_predictions
    WHERE ticker = ANY($1)
      AND prediction_date >= CURRENT_DATE - 365 * INTERVAL '1 day'
      AND ensemble_prediction IS NOT NULL
    ORDER BY ticker, prediction_date::date, prediction_date DESC
  `, [tickers]);

  // 5. OBX benchmark
  const obxRes = await pool.query(`
    SELECT date::text AS date, close::float AS obx_close
    FROM prices_daily
    WHERE ticker = 'OBX' AND date >= CURRENT_DATE - 365 * INTERVAL '1 day'
    ORDER BY date ASC
  `);

  // Build lookup maps
  const obxMap = new Map<string, number>();
  for (const r of obxRes.rows) obxMap.set(r.date.slice(0,10), r.obx_close);

  type MomRow = { date: string; mom1m: number; mom6m: number; mom11m: number; vol1m: number };
  const momByTicker = new Map<string, Map<string, MomRow>>();
  for (const r of momRes.rows) {
    if (!momByTicker.has(r.ticker)) momByTicker.set(r.ticker, new Map());
    momByTicker.get(r.ticker)!.set(r.date.slice(0,10), r);
  }

  const mlByTicker = new Map<string, Map<string, number>>();
  for (const r of mlRes.rows) {
    if (!mlByTicker.has(r.ticker)) mlByTicker.set(r.ticker, new Map());
    mlByTicker.get(r.ticker)!.set(r.date.slice(0,10), r.pred);
  }

  type PxRow = { ticker: string; date: string; close: number; sma200: number; sma50: number };
  const pxByTicker = new Map<string, PxRow[]>();
  for (const r of priceRes.rows as PxRow[]) {
    if (!pxByTicker.has(r.ticker)) pxByTicker.set(r.ticker, []);
    pxByTicker.get(r.ticker)!.push(r);
  }

  // 6. Assemble SimInputBar[] per ticker
  const inputByTicker = new Map<string, SimInputBar[]>();
  for (const ticker of tickers) {
    const pxRows = pxByTicker.get(ticker);
    if (!pxRows || pxRows.length < TRAIN_DAYS + FORWARD_DAYS) continue;
    const momMap = momByTicker.get(ticker) ?? new Map<string, MomRow>();
    const mlMap  = mlByTicker.get(ticker)  ?? new Map<string, number>();

    const input: SimInputBar[] = pxRows.map(px => {
      const d = px.date.slice(0,10);
      const mom = momMap.get(d);
      return {
        date: d, open: px.close, close: px.close, high: px.close, low: px.close,
        volume: 0, sma200: px.sma200 ?? null, sma50: px.sma50 ?? null,
        mlPrediction: mlMap.has(d)
          ? mlMap.get(d)!
          : (mom?.mom6m != null ? mom.mom6m * 0.20 : null),
        mlConfidence: mlMap.has(d) ? 0.7 : (mom?.mom6m != null ? 0.4 : null),
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
    inputByTicker.set(ticker, input);
  }

  // 7. Build combos
  const combos: SimParams[] = [];
  for (const entry of ENTRY_VALS)
    for (const stop of STOP_VALS)
      for (const hold of HOLD_VALS)
        for (const vol of VOL_VALS)
          for (const mom of MOM_VALS)
            combos.push({ ...BASE_PARAMS, entryThreshold: entry, stopLossPct: stop, maxHoldDays: hold, volGate: vol, momentumFilter: mom });

  log(`Running ${combos.length} combos × ${inputByTicker.size} tickers × walk-forward windows...`);

  // 8. Walk-forward
  type ForwardTrade = SimTrade & { ticker: string };
  const allForwardTrades: ForwardTrade[] = [];
  const stockAgg = new Map<string, {
    forwardTrades: SimTrade[]; lastParams: SimParams; lastSharpe: number; windowsSelected: number;
  }>();

  const maxBars = Math.max(...Array.from(inputByTicker.values()).map(v => v.length));
  const numWindows = Math.floor((maxBars - TRAIN_DAYS) / FORWARD_DAYS);
  log(`Windows: ${numWindows} (${TRAIN_DAYS}d train / ${FORWARD_DAYS}d forward)`);

  for (let w = 0; w < numWindows; w++) {
    const fwdStart  = TRAIN_DAYS + w * FORWARD_DAYS;
    const fwdEnd    = fwdStart + FORWARD_DAYS;
    const trainStart = fwdStart - TRAIN_DAYS;

    const windowRankings: Array<{ ticker: string; score: number; params: SimParams; sharpe: number }> = [];

    for (const ticker of tickers) {
      const input = inputByTicker.get(ticker);
      if (!input || input.length < fwdEnd) continue;
      const trainSlice = input.slice(trainStart, fwdStart);
      if (trainSlice.length < 30) continue;

      let bestScore = -Infinity, bestParams: SimParams | null = null, bestSharpe = 0;
      for (const params of combos) {
        const result = runMLSimulation(trainSlice, params);
        if (result.stats.trades >= MIN_TRAIN_TRADES && result.stats.sharpe > 0) {
          const daysInTrade = result.trades.reduce((s,t) => s + t.daysHeld, 0);
          const tim = daysInTrade / Math.max(trainSlice.length, 1);
          const timFactor = 0.5 + 0.5 * Math.min(tim / 0.4, 1.0);
          const score = result.stats.sharpe * timFactor;
          if (score > bestScore) { bestScore = score; bestParams = params; bestSharpe = result.stats.sharpe; }
        }
      }
      if (bestParams && bestSharpe > 0) windowRankings.push({ ticker, score: bestScore, params: bestParams, sharpe: bestSharpe });
    }

    windowRankings.sort((a,b) => b.score - a.score);
    const windowTop = windowRankings.slice(0, TOP_N);

    for (const { ticker, params, sharpe } of windowTop) {
      const input = inputByTicker.get(ticker)!;
      const forwardSlice = input.slice(fwdStart, Math.min(fwdEnd, input.length));
      if (forwardSlice.length < 3) continue;
      const forwardResult = runMLSimulation(forwardSlice, params);
      for (const trade of forwardResult.trades) allForwardTrades.push({ ...trade, ticker });

      const agg = stockAgg.get(ticker) ?? { forwardTrades: [], lastParams: params, lastSharpe: sharpe, windowsSelected: 0 };
      agg.forwardTrades.push(...forwardResult.trades);
      agg.lastParams = params; agg.lastSharpe = sharpe; agg.windowsSelected++;
      stockAgg.set(ticker, agg);
    }

    log(`  Window ${w+1}/${numWindows}: ${windowTop.length} stocks selected, ${allForwardTrades.length} OOS trades so far`);
  }

  // 9. Build bestStocks
  const stockResults: Array<{
    rank: number; ticker: string; name: string; sector: string; avg_nokvol: number;
    bestParams: SimParams; stats: SimStats; trades: SimTrade[]; combosRun: number; windowsSelected: number;
  }> = [];

  for (const [ticker, agg] of stockAgg) {
    if (agg.forwardTrades.length === 0) continue;
    const trades = agg.forwardTrades;
    const wins = trades.filter(t => t.pnlPct > 0).length;
    const totalRet = trades.reduce((s,t) => s + t.pnlPct * 0.1, 0);
    const avgHold = trades.reduce((s,t) => s + t.daysHeld, 0) / trades.length;
    const winRate = wins / trades.length;
    const grossPnls = trades.map(t => t.pnlPct);
    const mean = grossPnls.reduce((s,v) => s+v, 0) / grossPnls.length;
    const stdDev = Math.sqrt(grossPnls.reduce((s,v) => s+(v-mean)**2, 0) / grossPnls.length) || 1;
    const sharpe = mean / stdDev * Math.sqrt(252 / avgHold);
    const maxDD = trades.reduce((worst,t) => Math.min(worst, t.maxDrawdown ?? 0), 0);
    const winTrades = trades.filter(t => t.pnlPct > 0);
    const lossTrades = trades.filter(t => t.pnlPct <= 0);

    stockResults.push({
      rank: 0, ticker,
      name: (tickerMeta.get(ticker) as { name: string })?.name || ticker,
      sector: (tickerMeta.get(ticker) as { sector: string })?.sector || 'Other',
      avg_nokvol: (tickerMeta.get(ticker) as { avg_nokvol: number })?.avg_nokvol || 0,
      bestParams: agg.lastParams,
      stats: {
        totalReturn: totalRet, annualizedReturn: totalRet * (252 / Math.max(numWindows * FORWARD_DAYS, 1)),
        benchmarkReturn: 0, benchmarkAnnReturn: 0, excessReturn: totalRet,
        sharpe, maxDrawdown: maxDD, winRate, trades: trades.length, avgHoldDays: avgHold,
        avgWinPct: winTrades.length > 0 ? winTrades.reduce((s,t) => s+t.pnlPct, 0)/winTrades.length : 0,
        avgLossPct: lossTrades.length > 0 ? lossTrades.reduce((s,t) => s+t.pnlPct, 0)/lossTrades.length : 0,
        profitFactor: winTrades.length > 0 && lossTrades.length > 0
          ? winTrades.reduce((s,t) => s+t.pnlPct, 0) / Math.abs(lossTrades.reduce((s,t) => s+t.pnlPct, 0))
          : winTrades.length > 0 ? 999 : 0,
      },
      trades, combosRun: combos.length, windowsSelected: agg.windowsSelected,
    });
  }

  stockResults.sort((a,b) => (b.windowsSelected * Math.max(b.stats.sharpe, 0)) - (a.windowsSelected * Math.max(a.stats.sharpe, 0)));
  const top10 = stockResults.slice(0, 10).map((r,i) => ({ ...r, rank: i+1 }));

  const result = {
    bestStocks: top10,
    allForwardTrades,
    meta: {
      universe: tickers.length, combosPerTicker: combos.length, qualified: stockResults.length,
      windows: numWindows, days: 365, trainDays: TRAIN_DAYS, forwardDays: FORWARD_DAYS,
      computedAt: new Date().toISOString(),
    },
  };

  await pool.query(
    `INSERT INTO alpha_result_cache (cache_key, result, computed_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (cache_key) DO UPDATE SET result = $2, computed_at = NOW()`,
    [BEST_STOCKS_KEY, JSON.stringify(result)]
  );

  log(`Done: ${top10.length} stocks, ${allForwardTrades.length} OOS trades → cached as '${BEST_STOCKS_KEY}'`);
  return top10.map(s => `  #${s.rank} ${s.ticker} Sharpe=${s.stats.sharpe.toFixed(2)} Trades=${s.stats.trades}`).join('\n');
}

// ── Top Performers Cache Warm ─────────────────────────────────────────────────
// Calls the live route via HTTP to trigger its computation + caching.
// Falls back silently if APP_URL not set.

async function warmTopPerformers() {
  const appUrl = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL;
  const alphaToken = process.env.ALPHA_ENGINE_TOKEN;
  if (!appUrl || !alphaToken) {
    log('Skipping top-performers warm (APP_URL or ALPHA_ENGINE_TOKEN not set)');
    return;
  }
  log('Warming top-performers cache...');
  try {
    const res = await fetch(`${appUrl}/api/alpha/top-performers`, {
      headers: { Authorization: `Bearer ${alphaToken}` },
      signal: AbortSignal.timeout(120_000),
    });
    log(`Top-performers: ${res.status} ${res.ok ? 'cached' : 'failed'}`);
  } catch (e) {
    log(`Top-performers warm failed: ${(e as Error).message}`);
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const startMs = Date.now();
  log('=== Alpha Engine Precompute ===');

  try {
    const summary = await computeBestStocks();
    if (summary) log(`Top 10:\n${summary}`);
  } catch (e) {
    log(`ERROR in computeBestStocks: ${(e as Error).message}`);
    process.exitCode = 1;
  }

  await warmTopPerformers();

  log(`=== Finished in ${((Date.now() - startMs) / 1000).toFixed(1)}s ===`);
  await pool.end();
}

main().catch(err => { console.error(err); process.exit(1); });
