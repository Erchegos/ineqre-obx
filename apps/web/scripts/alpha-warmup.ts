/**
 * Alpha Engine Cache Warmup Script
 *
 * Runs all 3 expensive alpha computations and stores results in alpha_result_cache.
 * Designed to run nightly on the VPS after the ML pipeline completes (16:30 CET).
 *
 * Usage:
 *   npx tsx scripts/alpha-warmup.ts
 *   npx tsx scripts/alpha-warmup.ts --model yggdrasil_v7
 */

import { Pool } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('[alpha-warmup] ERROR: DATABASE_URL not set');
  process.exit(1);
}

const pool = new Pool({ connectionString: DATABASE_URL, max: 5 });
const CACHE_MAX_AGE_H = 25;
const MODEL = process.argv.includes('--model')
  ? process.argv[process.argv.indexOf('--model') + 1]
  : 'yggdrasil_v7';

// ── Helpers ────────────────────────────────────────────────────────────────────

const ENTRY_PCT = 1.0;
const EXIT_PCT  = 0.25;
const STOP_LOSS = -0.05;
const MIN_HOLD  = 5;
const MAX_HOLD  = 21;
const LOOKBACK  = 5;

async function ensureCacheTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS alpha_result_cache (
      cache_key TEXT PRIMARY KEY,
      result JSONB NOT NULL,
      computed_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

async function storeCache(cacheKey: string, result: unknown) {
  await pool.query(
    `INSERT INTO alpha_result_cache (cache_key, result, computed_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (cache_key) DO UPDATE SET result = $2, computed_at = NOW()`,
    [cacheKey, JSON.stringify(result)]
  );
}

function isCacheStale(cacheKey: string, computedAt: Date): boolean {
  const ageMs = Date.now() - computedAt.getTime();
  const ageH = ageMs / (1000 * 60 * 60);
  return ageH >= CACHE_MAX_AGE_H;
}

// ── Liquid Universe ────────────────────────────────────────────────────────────

async function getLiquidTickers(): Promise<{ ticker: string; name: string; sector: string; avg_nokvol: number }[]> {
  const res = await pool.query(`
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
  return res.rows;
}

// ── Walk-Forward Trade Simulation (shared logic) ───────────────────────────────

function simulateTrades(
  tickers: string[],
  sigByTicker: Map<string, Map<string, number>>,
  priceByTicker: Map<string, { date: string; close: number }[]>,
  cutoffStr: string,
) {
  interface Trade {
    entryDate: string; exitDate: string;
    entryPrice: number; exitPrice: number;
    pnl: number; maxDrawdown: number;
    exitReason: 'signal' | 'stop' | 'timeStop';
  }

  interface TradeResult {
    ticker: string; name?: string; sector?: string;
    avg_nokvol?: number; latestPred?: number;
    trades: number; wins: number;
    totalPnl: number; avgPnl: number; winRate: number;
    avgMaxDrawdown: number; maxSingleDrawdown: number;
    score: number;
  }

  const results: TradeResult[] = [];

  for (const ticker of tickers) {
    const prices = priceByTicker.get(ticker);
    const sigs = sigByTicker.get(ticker);
    if (!prices || prices.length < 30 || !sigs || sigs.size === 0) continue;

    type Day = { date: string; close: number; pred_pct: number | null };
    const days: Day[] = prices.map(p => ({
      date: p.date, close: p.close,
      pred_pct: sigs.has(p.date) ? sigs.get(p.date)! * 100 : null,
    }));

    const trades: Trade[] = [];
    let inTrade = false;
    let entryIdx = 0;
    let entryDate = '';
    let entryPrice = 0;
    let minPriceDuringTrade = 0;

    for (let i = 1; i < days.length; i++) {
      if (!inTrade) {
        let prev: number | null = null;
        for (let j = i - 1; j >= Math.max(0, i - LOOKBACK); j--) {
          if (days[j].pred_pct != null) { prev = days[j].pred_pct!; break; }
        }
        const curr = days[i].pred_pct;
        if (prev != null && curr != null && prev < ENTRY_PCT && curr >= ENTRY_PCT
            && days[i].date >= cutoffStr) {
          inTrade = true;
          entryIdx = i;
          entryDate = days[i].date;
          entryPrice = days[i].close;
          minPriceDuringTrade = days[i].close;
        }
      } else {
        if (days[i].close < minPriceDuringTrade) minPriceDuringTrade = days[i].close;
        const daysHeld = i - entryIdx;
        const priceReturn = (days[i].close - entryPrice) / entryPrice;
        let exitReason: Trade['exitReason'] | null = null;
        if (priceReturn <= STOP_LOSS) exitReason = 'stop';
        else if (daysHeld >= MAX_HOLD) exitReason = 'timeStop';
        else if (daysHeld >= MIN_HOLD) {
          let prev: number | null = null;
          for (let j = i - 1; j >= Math.max(0, i - LOOKBACK); j--) {
            if (days[j].pred_pct != null) { prev = days[j].pred_pct!; break; }
          }
          const curr = days[i].pred_pct;
          if (prev != null && curr != null && prev > EXIT_PCT && curr <= EXIT_PCT) exitReason = 'signal';
        }
        if (exitReason) {
          const exitPrice = days[i].close;
          const pnl = (exitPrice - entryPrice) / entryPrice;
          const maxDrawdown = (minPriceDuringTrade - entryPrice) / entryPrice;
          trades.push({ entryDate, exitDate: days[i].date, entryPrice, exitPrice, pnl, maxDrawdown, exitReason });
          inTrade = false;
        }
      }
    }

    if (trades.length < 3) continue;
    const wins = trades.filter(t => t.pnl > 0).length;
    const totalPnl = trades.reduce((s, t) => s + t.pnl, 0);
    const avgPnl = totalPnl / trades.length;
    const winRate = wins / trades.length;
    const avgMaxDrawdown = trades.reduce((s, t) => s + t.maxDrawdown, 0) / trades.length;
    const maxSingleDrawdown = Math.min(...trades.map(t => t.maxDrawdown));
    if (winRate < 0.4) continue;
    const cappedAvg = trades.reduce((s, t) => s + Math.min(t.pnl, 0.10), 0) / trades.length;
    if (cappedAvg <= 0) continue;
    const score = winRate * cappedAvg * Math.sqrt(trades.length);
    results.push({
      ticker, trades: trades.length, wins,
      totalPnl: Math.round(totalPnl * 10000) / 100,
      avgPnl: Math.round(avgPnl * 10000) / 100,
      winRate: Math.round(winRate * 1000) / 10,
      avgMaxDrawdown: Math.round(avgMaxDrawdown * 10000) / 100,
      maxSingleDrawdown: Math.round(maxSingleDrawdown * 10000) / 100,
      score,
    });
  }
  return results;
}

// ── Warmup: Top Performers ─────────────────────────────────────────────────────

async function warmupTopPerformers(tickers: { ticker: string; name: string; sector: string; avg_nokvol: number }[]) {
  const cacheKey = `top_performers_v1_${MODEL}`;
  const tickerList = tickers.map(t => t.ticker);
  const tickerMeta = new Map(tickers.map(t => [t.ticker, t]));

  const [sigRes, priceRes, latestSigRes] = await Promise.all([
    pool.query(`
      SELECT ticker, signal_date::text AS date, predicted_return::float
      FROM alpha_signals
      WHERE ticker = ANY($1) AND model_id = $2
        AND signal_date >= NOW() - INTERVAL '400 days'
        AND predicted_return IS NOT NULL
      ORDER BY ticker, signal_date ASC
    `, [tickerList, MODEL]),
    pool.query(`
      SELECT ticker, date::text, close::float
      FROM prices_daily
      WHERE ticker = ANY($1)
        AND date >= NOW() - INTERVAL '400 days'
        AND close > 0
      ORDER BY ticker, date ASC
    `, [tickerList]),
    pool.query(`
      SELECT DISTINCT ON (ticker) ticker, predicted_return::float
      FROM alpha_signals
      WHERE ticker = ANY($1) AND model_id = $2 AND predicted_return IS NOT NULL
      ORDER BY ticker, signal_date DESC
    `, [tickerList, MODEL]),
  ]);

  const latestPred = new Map<string, number>(
    latestSigRes.rows.map((r: { ticker: string; predicted_return: number }) => [r.ticker, r.predicted_return])
  );

  const sigByTicker = new Map<string, Map<string, number>>();
  for (const row of sigRes.rows) {
    if (!sigByTicker.has(row.ticker)) sigByTicker.set(row.ticker, new Map());
    sigByTicker.get(row.ticker)!.set(row.date.slice(0, 10), row.predicted_return);
  }

  const priceByTicker = new Map<string, { date: string; close: number }[]>();
  for (const row of priceRes.rows) {
    if (!priceByTicker.has(row.ticker)) priceByTicker.set(row.ticker, []);
    priceByTicker.get(row.ticker)!.push({ date: row.date.slice(0, 10), close: row.close });
  }

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 365);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const results = simulateTrades(tickerList, sigByTicker, priceByTicker, cutoffStr);
  results.sort((a, b) => b.score - a.score);
  const top10 = results.slice(0, 10).map(({ score, ...r }) => ({
    ...r,
    name: tickerMeta.get(r.ticker)?.name || r.ticker,
    sector: tickerMeta.get(r.ticker)?.sector || 'Other',
    avg_nokvol: tickerMeta.get(r.ticker)?.avg_nokvol || 0,
    latestPred: ((latestPred.get(r.ticker) || 0) * 100),
  }));

  const result = {
    topPerformers: top10,
    meta: {
      model: MODEL, universe: tickerList.length, qualified: results.length,
      rules: { entryPct: ENTRY_PCT, exitPct: EXIT_PCT, stopLoss: STOP_LOSS * 100, minHold: MIN_HOLD, maxHold: MAX_HOLD },
    },
  };
  await storeCache(cacheKey, result);
  console.log(`[alpha-warmup] top-performers: ${top10.length} results cached`);
}

// ── Warmup: Equity Curve ───────────────────────────────────────────────────────

async function warmupEquityCurve(tickers: { ticker: string }[]) {
  const cacheKey = `equity_curve_v1_${MODEL}`;
  const tickerList = tickers.map(t => t.ticker);

  const [sigRes, priceRes] = await Promise.all([
    pool.query(`
      SELECT ticker, signal_date::text AS date, predicted_return::float
      FROM alpha_signals
      WHERE ticker = ANY($1) AND model_id = $2
        AND signal_date >= NOW() - INTERVAL '415 days'
        AND predicted_return IS NOT NULL
      ORDER BY ticker, signal_date ASC
    `, [tickerList, MODEL]),
    pool.query(`
      SELECT ticker, date::text, close::float
      FROM prices_daily
      WHERE ticker = ANY($1)
        AND date >= NOW() - INTERVAL '415 days'
        AND close > 0
      ORDER BY date ASC
    `, [tickerList]),
  ]);

  const priceByTickerMap = new Map<string, Map<string, number>>();
  const allDatesSet = new Set<string>();
  for (const row of priceRes.rows) {
    const d = row.date.slice(0, 10);
    if (!priceByTickerMap.has(row.ticker)) priceByTickerMap.set(row.ticker, new Map());
    priceByTickerMap.get(row.ticker)!.set(d, row.close);
    allDatesSet.add(d);
  }
  const allDates = [...allDatesSet].sort();

  const sigByTicker = new Map<string, Map<string, number>>();
  for (const row of sigRes.rows) {
    const d = row.date.slice(0, 10);
    if (!sigByTicker.has(row.ticker)) sigByTicker.set(row.ticker, new Map());
    sigByTicker.get(row.ticker)!.set(d, row.predicted_return * 100);
  }

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 365);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  const simDates = allDates.filter(d => d >= cutoffStr);
  if (simDates.length === 0) {
    await storeCache(cacheKey, { equityCurve: [], stats: {} });
    return;
  }

  const allDateIdx = new Map<string, number>();
  allDates.forEach((d, i) => allDateIdx.set(d, i));

  const getSignalCurrPrev = (ticker: string, si: number): [number | null, number | null] => {
    const date = simDates[si];
    const ai = allDateIdx.get(date) ?? 0;
    const sigMap = sigByTicker.get(ticker);
    const curr = sigMap?.get(date) ?? null;
    let prev: number | null = null;
    if (sigMap) {
      for (let j = ai - 1; j >= Math.max(0, ai - LOOKBACK); j--) {
        if (sigMap.has(allDates[j])) { prev = sigMap.get(allDates[j])!; break; }
      }
    }
    return [curr, prev];
  };

  const crossingsBySimIdx: string[][] = Array.from({ length: simDates.length }, () => []);
  for (const ticker of tickerList) {
    for (let si = 1; si < simDates.length; si++) {
      const [curr, prev] = getSignalCurrPrev(ticker, si);
      if (prev !== null && curr !== null && prev < ENTRY_PCT && curr >= ENTRY_PCT) {
        crossingsBySimIdx[si].push(ticker);
      }
    }
  }
  for (let si = 0; si < simDates.length; si++) {
    const date = simDates[si];
    crossingsBySimIdx[si].sort((a, b) =>
      (sigByTicker.get(b)?.get(date) ?? 0) - (sigByTicker.get(a)?.get(date) ?? 0)
    );
  }

  const MAX_SLOTS = 10;
  const INIT_SLOT = 100 / MAX_SLOTS;
  const slotBalance = Array<number>(MAX_SLOTS).fill(INIT_SLOT);
  const slotPos = Array<{ ticker: string; entryPrice: number; entrySimIdx: number } | null>(MAX_SLOTS).fill(null);
  const equityCurve: { date: string; value: number; positions: number }[] = [];
  let tradeCount = 0, winCount = 0;

  for (let si = 0; si < simDates.length; si++) {
    const date = simDates[si];
    for (let s = 0; s < MAX_SLOTS; s++) {
      const pos = slotPos[s];
      if (!pos) continue;
      const price = priceByTickerMap.get(pos.ticker)?.get(date);
      if (!price) continue;
      const daysHeld = si - pos.entrySimIdx;
      const priceReturn = (price - pos.entryPrice) / pos.entryPrice;
      const [curr, prev] = getSignalCurrPrev(pos.ticker, si);
      let exit = false;
      if (priceReturn <= STOP_LOSS) exit = true;
      else if (daysHeld >= MAX_HOLD) exit = true;
      else if (daysHeld >= MIN_HOLD && prev !== null && curr !== null && prev > EXIT_PCT && curr <= EXIT_PCT) exit = true;
      if (exit) {
        slotBalance[s] *= (1 + priceReturn);
        slotPos[s] = null;
        tradeCount++;
        if (priceReturn > 0) winCount++;
      }
    }
    const freeSlots: number[] = [];
    for (let s = 0; s < MAX_SLOTS; s++) if (!slotPos[s]) freeSlots.push(s);
    if (freeSlots.length > 0) {
      const activeTickers = new Set(slotPos.filter(Boolean).map(p => p!.ticker));
      let fi = 0;
      for (const ticker of crossingsBySimIdx[si]) {
        if (fi >= freeSlots.length) break;
        if (activeTickers.has(ticker)) continue;
        const price = priceByTickerMap.get(ticker)?.get(date);
        if (!price) continue;
        slotPos[freeSlots[fi]] = { ticker, entryPrice: price, entrySimIdx: si };
        activeTickers.add(ticker);
        fi++;
      }
    }
    let totalValue = 0, activePosCount = 0;
    for (let s = 0; s < MAX_SLOTS; s++) {
      const pos = slotPos[s];
      if (!pos) { totalValue += slotBalance[s]; }
      else {
        const price = priceByTickerMap.get(pos.ticker)?.get(date);
        const ret = price ? (price - pos.entryPrice) / pos.entryPrice : 0;
        totalValue += slotBalance[s] * (1 + ret);
        activePosCount++;
      }
    }
    equityCurve.push({ date, value: Math.round(totalValue * 100) / 100, positions: activePosCount });
  }

  const vals = equityCurve.map(e => e.value);
  const totalReturn = vals.length > 0 ? vals[vals.length - 1] - 100 : 0;
  let maxDD = 0, peak = 100;
  for (const v of vals) {
    if (v > peak) peak = v;
    const dd = (v - peak) / peak * 100;
    if (dd < maxDD) maxDD = dd;
  }

  const result = {
    equityCurve,
    stats: {
      totalReturn: Math.round(totalReturn * 10) / 10,
      maxDrawdown: Math.round(maxDD * 10) / 10,
      winRate: tradeCount > 0 ? Math.round(winCount / tradeCount * 1000) / 10 : 0,
      trades: tradeCount,
      model: MODEL,
      universe: tickerList.length,
    },
  };
  await storeCache(cacheKey, result);
  console.log(`[alpha-warmup] equity-curve: ${equityCurve.length} data points cached`);
}

// ── Warmup: Portfolio Backtest ─────────────────────────────────────────────────

async function warmupPortfolioBacktest(tickers: { ticker: string; name: string; sector: string }[]) {
  const CACHE_KEY = 'portfolio_backtest_v5';
  const tickerList = tickers.map(t => t.ticker);
  const tickerMeta = new Map(tickers.map(t => [t.ticker, t]));

  const TOP_N = 15;
  const MAX_SINGLE_STOCK = 0.12;
  const MAX_SECTOR_WEIGHT = 0.35;
  const COST_BPS = 10;
  const ALPHA_WEIGHTS = { ml: 0.35, momentum: 0.20, valuation: 0.20, cnn: 0.15, cluster: 0.10 };

  const [sigRes, priceRes, factRes] = await Promise.all([
    pool.query(`
      SELECT ticker, signal_date::text AS date, predicted_return::float
      FROM alpha_signals
      WHERE ticker = ANY($1) AND model_id = $2
        AND signal_date >= NOW() - INTERVAL '400 days'
        AND predicted_return IS NOT NULL
      ORDER BY ticker, signal_date ASC
    `, [tickerList, MODEL]),
    pool.query(`
      SELECT ticker, date::text, close::float
      FROM prices_daily
      WHERE ticker = ANY($1) AND date >= NOW() - INTERVAL '400 days' AND close > 0
      ORDER BY ticker, date ASC
    `, [tickerList]),
    pool.query(`
      SELECT ft.ticker, ft.date::text, ft.mom1m::float, ft.mom6m::float, ft.mom11m::float
      FROM factor_technical ft
      WHERE ft.ticker = ANY($1) AND ft.date >= NOW() - INTERVAL '400 days'
      ORDER BY ft.ticker, ft.date ASC
    `, [tickerList]),
  ]);

  // Build maps
  const sigByTicker = new Map<string, Map<string, number>>();
  for (const r of sigRes.rows) {
    if (!sigByTicker.has(r.ticker)) sigByTicker.set(r.ticker, new Map());
    sigByTicker.get(r.ticker)!.set(r.date.slice(0, 10), r.predicted_return);
  }

  const priceByTicker = new Map<string, Map<string, number>>();
  const allDatesSet = new Set<string>();
  for (const r of priceRes.rows) {
    const d = r.date.slice(0, 10);
    if (!priceByTicker.has(r.ticker)) priceByTicker.set(r.ticker, new Map());
    priceByTicker.get(r.ticker)!.set(d, r.close);
    allDatesSet.add(d);
  }
  const allDates = [...allDatesSet].sort();

  const factByTicker = new Map<string, Map<string, { mom1m: number; mom6m: number; mom11m: number }>>();
  for (const r of factRes.rows) {
    const d = r.date.slice(0, 10);
    if (!factByTicker.has(r.ticker)) factByTicker.set(r.ticker, new Map());
    factByTicker.get(r.ticker)!.set(d, { mom1m: r.mom1m, mom6m: r.mom6m, mom11m: r.mom11m });
  }

  // Monthly rebalance dates
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 365);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  const simDates = allDates.filter(d => d >= cutoffStr);

  const monthlyDates: string[] = [];
  let lastMonth = '';
  for (const d of simDates) {
    const ym = d.slice(0, 7);
    if (ym !== lastMonth) { monthlyDates.push(d); lastMonth = ym; }
  }

  // Monthly rebalance: compute composite score and pick top N
  const equityCurve: { date: string; value: number }[] = [];
  const monthlyReturns: { month: string; return: number; holdings: number }[] = [];
  let portfolioValue = 100;
  let currentWeights = new Map<string, number>();

  const allMonths = monthlyDates;

  for (let mi = 0; mi < allMonths.length - 1; mi++) {
    const rebalDate = allMonths[mi];
    const nextDate = allMonths[mi + 1];

    // Score each ticker
    const scores: { ticker: string; score: number; sector: string }[] = [];
    for (const ticker of tickerList) {
      const sig = sigByTicker.get(ticker);
      const fact = factByTicker.get(ticker);
      const latestSig = sig?.get(rebalDate) ?? null;
      const latestFact = fact?.get(rebalDate) ?? null;
      if (latestSig === null) continue;

      const mlScore = Math.max(-1, Math.min(1, latestSig * 10));
      const momScore = latestFact
        ? (Math.sign(latestFact.mom1m) * 0.3 + Math.sign(latestFact.mom6m) * 0.4 + Math.sign(latestFact.mom11m) * 0.3)
        : 0;
      const composite = ALPHA_WEIGHTS.ml * mlScore + ALPHA_WEIGHTS.momentum * momScore;
      scores.push({ ticker, score: composite, sector: tickerMeta.get(ticker)?.sector || 'Other' });
    }
    scores.sort((a, b) => b.score - a.score);

    // Apply constraints
    const selected: { ticker: string; weight: number; sector: string }[] = [];
    const sectorWeights = new Map<string, number>();
    for (const s of scores) {
      if (selected.length >= TOP_N) break;
      if (s.score <= 0) break;
      const sw = (sectorWeights.get(s.sector) || 0);
      if (sw >= MAX_SECTOR_WEIGHT) continue;
      const w = Math.min(MAX_SINGLE_STOCK, 1 / TOP_N);
      selected.push({ ticker: s.ticker, weight: w, sector: s.sector });
      sectorWeights.set(s.sector, sw + w);
    }

    if (selected.length === 0) {
      equityCurve.push({ date: rebalDate, value: Math.round(portfolioValue * 100) / 100 });
      continue;
    }

    // Normalize weights
    const totalW = selected.reduce((s, h) => s + h.weight, 0);
    const weights = new Map(selected.map(h => [h.ticker, h.weight / totalW]));

    // Apply transaction costs
    if (currentWeights.size > 0) {
      let turnover = 0;
      const allT = new Set([...weights.keys(), ...currentWeights.keys()]);
      for (const t of allT) {
        const newW = weights.get(t) || 0;
        const oldW = currentWeights.get(t) || 0;
        turnover += Math.abs(newW - oldW);
      }
      portfolioValue *= (1 - (turnover / 2) * (COST_BPS / 10000));
    }
    currentWeights = weights;

    // Compute portfolio return for the month
    let portfolioReturn = 0;
    let validWeight = 0;
    for (const [ticker, w] of weights) {
      const prices = priceByTicker.get(ticker);
      const p0 = prices?.get(rebalDate);
      const p1 = prices?.get(nextDate);
      if (p0 && p1 && p0 > 0) {
        portfolioReturn += w * (p1 - p0) / p0;
        validWeight += w;
      }
    }
    if (validWeight > 0) portfolioReturn /= validWeight;
    portfolioValue *= (1 + portfolioReturn);

    equityCurve.push({ date: rebalDate, value: Math.round(portfolioValue * 100) / 100 });
    monthlyReturns.push({
      month: rebalDate.slice(0, 7),
      return: Math.round(portfolioReturn * 10000) / 100,
      holdings: selected.length,
    });
  }

  // Current portfolio snapshot
  const latestHoldings: { ticker: string; name: string; sector: string; weight: number }[] = [];
  for (const [ticker, weight] of currentWeights) {
    latestHoldings.push({
      ticker,
      name: tickerMeta.get(ticker)?.name || ticker,
      sector: tickerMeta.get(ticker)?.sector || 'Other',
      weight: Math.round(weight * 10000) / 100,
    });
  }
  latestHoldings.sort((a, b) => b.weight - a.weight);

  // Summary stats
  const totalReturn = portfolioValue - 100;
  const months = monthlyReturns.length;
  const annualizedReturn = months > 0 ? (Math.pow(portfolioValue / 100, 12 / months) - 1) * 100 : 0;
  const monthlyVals = monthlyReturns.map(m => m.return);
  const avgMonthly = monthlyVals.length > 0 ? monthlyVals.reduce((s, v) => s + v, 0) / monthlyVals.length : 0;
  const stdMonthly = monthlyVals.length > 1
    ? Math.sqrt(monthlyVals.reduce((s, v) => s + Math.pow(v - avgMonthly, 2), 0) / (monthlyVals.length - 1))
    : 0;
  const sharpe = stdMonthly > 0 ? (avgMonthly / stdMonthly) * Math.sqrt(12) : 0;
  const winRate = monthlyVals.filter(v => v > 0).length / (monthlyVals.length || 1);
  let maxDD = 0, peak = 100;
  for (const p of equityCurve) {
    if (p.value > peak) peak = p.value;
    const dd = (p.value - peak) / peak * 100;
    if (dd < maxDD) maxDD = dd;
  }

  // Sector allocation
  const sectorAlloc = new Map<string, number>();
  const sectorColors: Record<string, string> = {
    Energy: '#ef4444', Seafood: '#22c55e', Shipping: '#3b82f6', Materials: '#f59e0b',
    Banks: '#8b5cf6', Finance: '#7c3aed', Telecom: '#06b6d4', Consumer: '#ec4899',
    Industrial: '#f97316', Industrials: '#fb923c', Technology: '#14b8a6', Tech: '#a855f7',
    Investment: '#e879f9', 'Renewable Energy': '#4ade80', Healthcare: '#f43f5e',
    Other: '#64748b',
  };
  for (const h of latestHoldings) {
    sectorAlloc.set(h.sector, (sectorAlloc.get(h.sector) || 0) + h.weight);
  }

  const result = {
    config: { weights: ALPHA_WEIGHTS, maxSingleStock: MAX_SINGLE_STOCK, maxSectorWeight: MAX_SECTOR_WEIGHT, costBps: COST_BPS, rebalance: 'Monthly' },
    summary: {
      months,
      totalReturn: Math.round(totalReturn * 10) / 10,
      annualizedReturn: Math.round(annualizedReturn * 10) / 10,
      sharpe: Math.round(sharpe * 100) / 100,
      winRate: Math.round(winRate * 1000) / 10,
      maxDrawdown: Math.round(maxDD * 10) / 10,
      avgMonthlyReturn: Math.round(avgMonthly * 10) / 10,
    },
    equityCurve,
    monthlyReturns,
    currentPortfolio: { date: allMonths[allMonths.length - 1], holdings: latestHoldings },
    sectorAllocation: [...sectorAlloc.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([sector, weight]) => ({
        sector, weight: Math.round(weight * 10) / 10,
        color: sectorColors[sector] || '#64748b',
      })),
  };

  await storeCache(CACHE_KEY, result);
  console.log(`[alpha-warmup] portfolio-backtest: ${equityCurve.length} months, total return ${result.summary.totalReturn}%`);
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`[alpha-warmup] Starting cache warmup — model: ${MODEL}`);
  const start = Date.now();

  await ensureCacheTable();
  const tickers = await getLiquidTickers();
  console.log(`[alpha-warmup] Universe: ${tickers.length} liquid tickers`);

  if (tickers.length === 0) {
    console.error('[alpha-warmup] No tickers found — aborting');
    await pool.end();
    process.exit(1);
  }

  await warmupTopPerformers(tickers);
  await warmupEquityCurve(tickers);
  await warmupPortfolioBacktest(tickers);

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`[alpha-warmup] Done in ${elapsed}s`);
  await pool.end();
}

main().catch(err => {
  console.error('[alpha-warmup] FATAL:', err);
  process.exit(1);
});
