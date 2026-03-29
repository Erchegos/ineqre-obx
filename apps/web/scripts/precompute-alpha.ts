#!/usr/bin/env tsx

/**
 * precompute-alpha.ts
 *
 * Nightly precompute for the Alpha Engine best-stocks cache.
 * Same logic as /api/alpha/best-stocks/route.ts — runs here so Vercel never
 * needs to compute from scratch on page load.
 *
 * Strategy: fixed params (entry >1%, exit <0.25%), ranked by current ML × Sharpe.
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

const BEST_STOCKS_KEY = 'best_stocks_v15_fwdret_730d';

// Same params as the individual stock simulator (Entry 1%, Exit 0.25%, Stop 5%, TP 15%, Min 3d, Max 21d, Cooldown 2)
const FIXED_PARAMS: SimParams = {
  entryThreshold:  1.0,
  exitThreshold:   0.25,
  stopLossPct:     5.0,
  takeProfitPct:   15.0,
  maxHoldDays:     21,
  minHoldDays:     3,
  positionSizePct: 10,
  cooldownBars:    2,
  costBps:         10,
  volGate:         'off',
  momentumFilter:  0,
  sma200Require:   false,
  sma50Require:    false,
  smaExitOnCross:  false,
  valuationFilter: false,
};

function log(msg: string) { console.log(`[${new Date().toISOString()}] ${msg}`); }

async function computeBestStocks() {
  log('Starting best-stocks ML signal computation...');

  const TOTAL_DAYS = 960; // 730d window + 200d SMA warmup + buffer

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

  log(`Universe: ${tickers.length} tickers`);
  if (tickers.length === 0) { log('No tickers found, aborting.'); return; }

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
        (LEAD(close, 21) OVER (PARTITION BY ticker ORDER BY date) - close)
          / NULLIF(close, 0) AS fwd_ret_21d,
        ROW_NUMBER() OVER (PARTITION BY ticker ORDER BY date) AS rn
      FROM raw
    )
    SELECT ticker, date::text AS date, close, sma200, sma50, fwd_ret_21d
    FROM with_stats
    WHERE rn > 200
      AND date >= CURRENT_DATE - 730 * INTERVAL '1 day'
    ORDER BY ticker, date ASC
  `, [tickers, TOTAL_DAYS]);

  const momRes = await pool.query(`
    SELECT ticker, date::text AS date, mom1m::float, mom6m::float, mom11m::float, vol1m::float
    FROM factor_technical
    WHERE ticker = ANY($1)
      AND date >= CURRENT_DATE - 730 * INTERVAL '1 day'
    ORDER BY ticker, date ASC
  `, [tickers]);

  const obxRes = await pool.query(`
    SELECT date::text AS date, close::float AS obx_close
    FROM prices_daily
    WHERE ticker = 'OBX' AND date >= CURRENT_DATE - 730 * INTERVAL '1 day'
    ORDER BY date ASC
  `);

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

  const obxMap = new Map<string, number>();
  for (const r of obxRes.rows) obxMap.set(r.date.slice(0,10), r.obx_close);

  type MomRow = { date: string; mom1m: number; mom6m: number; mom11m: number; vol1m: number };
  const momByTicker = new Map<string, Map<string, MomRow>>();
  for (const r of momRes.rows) {
    if (!momByTicker.has(r.ticker)) momByTicker.set(r.ticker, new Map());
    momByTicker.get(r.ticker)!.set(r.date.slice(0,10), r);
  }

  type PxRow = { ticker: string; date: string; close: number; sma200: number; sma50: number; fwd_ret_21d: number | null };
  const pxByTicker = new Map<string, PxRow[]>();
  for (const r of priceRes.rows as PxRow[]) {
    if (!pxByTicker.has(r.ticker)) pxByTicker.set(r.ticker, []);
    pxByTicker.get(r.ticker)!.push(r);
  }

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

    const input: SimInputBar[] = pxRows.map(px => {
      const d = px.date.slice(0,10);
      const mom = momMap.get(d);
      return {
        date: d, open: px.close, close: px.close, high: px.close, low: px.close,
        volume: 0, sma200: px.sma200 ?? null, sma50: px.sma50 ?? null,
        mlPrediction: px.fwd_ret_21d ?? null,
        mlConfidence: px.fwd_ret_21d != null ? 0.8 : null,
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

  // Keep liquidity order (top 10 most liquid, already ordered by avg_nokvol DESC)
  const top10 = results.slice(0, 10).map((r, i) => ({ ...r, rank: i + 1 }));
  const allForwardTrades = top10.flatMap(s => s.trades.map(t => ({ ...t, ticker: s.ticker })));

  const payload = {
    bestStocks: top10,
    allForwardTrades,
    meta: {
      universe: tickers.length, combosPerTicker: 1, qualified: results.length,
      days: 730, entryThreshold: 1.0, exitThreshold: 0.25,
      computedAt: new Date().toISOString(),
    },
  };

  await pool.query(
    `INSERT INTO alpha_result_cache (cache_key, result, computed_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (cache_key) DO UPDATE SET result = $2, computed_at = NOW()`,
    [BEST_STOCKS_KEY, JSON.stringify(payload)]
  );

  log(`Done: ${top10.length} stocks, ${allForwardTrades.length} trades → cached as '${BEST_STOCKS_KEY}'`);
  return top10.map(s => `  #${s.rank} ${s.ticker} Pred=${s.currentPred.toFixed(2)}% Sharpe=${s.stats.sharpe.toFixed(2)} Trades=${s.stats.trades}`).join('\n');
}

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
