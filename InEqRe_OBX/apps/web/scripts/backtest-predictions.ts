#!/usr/bin/env tsx
/**
 * Walk-Forward Backtest for 19-Factor ML Prediction Model
 *
 * For each month's last trading day, generates predictions using only data
 * available at that time, then compares against realized 1-month forward returns.
 *
 * IMPORTANT CAVEAT: The model weights (FACTOR_WEIGHTS_GB, FACTOR_WEIGHTS_RF) are
 * fixed constants calibrated from academic research — not trained on historical data.
 * This backtest measures how well research-derived weights capture patterns in
 * Norwegian equity returns. It is NOT a true out-of-sample test of a trained ML model.
 *
 * Usage: NODE_TLS_REJECT_UNAUTHORIZED=0 npx tsx scripts/backtest-predictions.ts
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import { randomUUID } from 'crypto';
import { writeFileSync } from 'fs';

config({ path: resolve(__dirname, '../.env.local') });

import { pool } from '../src/lib/db';
import {
  RawFactors,
  fetchCrossSectionalStats,
  enhanceFactors,
  computeEnsemblePrediction,
  computePercentiles,
  computeConfidence,
  getRegimeWeightAdjustments,
} from '../src/lib/factorAdvanced';

// ─── Types ────────────────────────────────────────────────────────────────────

interface BacktestConfig {
  minTickersPerMonth: number;
  forwardDays: number;
  modelVersion: string;
}

interface PredictionOutcome {
  ticker: string;
  predictionDate: string;
  targetDate: string;
  ensemblePrediction: number;
  gbPrediction: number;
  rfPrediction: number;
  actualReturn: number | null;
  p05: number;
  p25: number;
  p50: number;
  p75: number;
  p95: number;
  confidenceScore: number;
  sizeRegime: string | null;
  turnoverRegime: string | null;
  quintile: number;
  directionCorrect: boolean | null;
}

interface MonthlyMetrics {
  month: string;
  nTickers: number;
  hitRate: number;
  mae: number;
  ic: number;
  longReturn: number;
  shortReturn: number;
  longShortReturn: number;
  avgPrediction: number;
  avgActual: number;
  p90Calibration: number;
  p50Calibration: number;
}

interface OverallMetrics {
  backtestStart: string;
  backtestEnd: string;
  nMonths: number;
  nTotalPredictions: number;
  overallHitRate: number;
  overallMAE: number;
  overallICMean: number;
  overallICStd: number;
  overallICIR: number;
  pctMonthsICPositive: number;
  longShortTotalReturn: number;
  longShortAnnualized: number;
  longShortSharpe: number;
  longShortMaxDrawdown: number;
  p90Calibration: number;
  p50Calibration: number;
  metricsBySizeRegime: Record<string, { ic: number; hitRate: number; avgLS: number; n: number }>;
}

// Exclude indices, ETFs, US-listed duplicates
const EXCLUDED_TICKERS = new Set([
  'OBX', 'OSEBX', 'OSEAX', 'DAX', 'ESTX50', 'NDX', 'SPX', 'VIX', 'HEX',
  'SPY', 'QQQ', 'IWM', 'EFA', 'EWD', 'EWN', 'GLD', 'SLV', 'USO',
  'XLE', 'XOP', 'VGK', 'NORW', 'COPX', 'DBB', 'DBC',
  'EQNR.US', 'FRO.US', 'BORR.US', 'FLNG.US', 'BWLP.US', 'HAFN.US', 'ECO.US',
]);

// ─── Database Setup ───────────────────────────────────────────────────────────

async function ensureTablesExist(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS backtest_predictions (
      id BIGSERIAL PRIMARY KEY,
      backtest_run_id UUID NOT NULL,
      ticker VARCHAR(20) NOT NULL,
      prediction_date DATE NOT NULL,
      target_date DATE,
      ensemble_prediction NUMERIC(12, 6),
      gb_prediction NUMERIC(12, 6),
      rf_prediction NUMERIC(12, 6),
      actual_return NUMERIC(12, 6),
      p05 NUMERIC(12, 6),
      p25 NUMERIC(12, 6),
      p50 NUMERIC(12, 6),
      p75 NUMERIC(12, 6),
      p95 NUMERIC(12, 6),
      confidence_score NUMERIC(5, 4),
      size_regime VARCHAR(10),
      turnover_regime VARCHAR(10),
      quintile INTEGER,
      direction_correct BOOLEAN,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (backtest_run_id, ticker, prediction_date)
    );

    CREATE TABLE IF NOT EXISTS backtest_monthly (
      id BIGSERIAL PRIMARY KEY,
      backtest_run_id UUID NOT NULL,
      month DATE NOT NULL,
      n_tickers INTEGER,
      hit_rate NUMERIC(8, 6),
      mae NUMERIC(12, 6),
      ic NUMERIC(8, 6),
      long_return NUMERIC(12, 6),
      short_return NUMERIC(12, 6),
      long_short_return NUMERIC(12, 6),
      avg_prediction NUMERIC(12, 6),
      avg_actual NUMERIC(12, 6),
      p90_calibration NUMERIC(8, 6),
      p50_calibration NUMERIC(8, 6),
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (backtest_run_id, month)
    );

    CREATE TABLE IF NOT EXISTS backtest_runs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      run_date TIMESTAMPTZ DEFAULT NOW(),
      model_version VARCHAR(50) NOT NULL,
      backtest_start DATE,
      backtest_end DATE,
      n_months INTEGER,
      n_total_predictions INTEGER,
      overall_hit_rate NUMERIC(8, 6),
      overall_mae NUMERIC(12, 6),
      overall_ic_mean NUMERIC(8, 6),
      overall_ic_ir NUMERIC(8, 6),
      long_short_total_return NUMERIC(12, 6),
      long_short_annualized NUMERIC(12, 6),
      long_short_sharpe NUMERIC(8, 4),
      long_short_max_drawdown NUMERIC(12, 6),
      p90_calibration NUMERIC(8, 6),
      metrics_by_size_regime JSONB,
      config JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
}

// ─── Data Fetching ────────────────────────────────────────────────────────────

/**
 * Get last trading day of each calendar month with sufficient cross-sectional coverage.
 */
async function getRebalanceDates(minTickers: number): Promise<string[]> {
  const result = await pool.query<{ date: string }>(`
    SELECT date::text
    FROM (
      SELECT date, ROW_NUMBER() OVER (
        PARTITION BY date_trunc('month', date)
        ORDER BY date DESC
      ) as rn
      FROM factor_technical
      WHERE ticker NOT IN (${[...EXCLUDED_TICKERS].map((_, i) => `$${i + 1}`).join(',')})
      GROUP BY date
      HAVING COUNT(DISTINCT ticker) >= $${EXCLUDED_TICKERS.size + 1}
    ) sub
    WHERE rn = 1
    ORDER BY date
  `, [...EXCLUDED_TICKERS, minTickers]);

  return result.rows.map(r => r.date);
}

/**
 * Batch-fetch all factors for a given date (one query instead of per-ticker).
 */
async function fetchAllFactorsForDate(date: string): Promise<RawFactors[]> {
  const result = await pool.query(`
    SELECT
      ft.ticker, ft.date::text as date,
      ft.mom1m, ft.mom6m, ft.mom11m, ft.mom36m, ft.chgmom,
      ft.vol1m, ft.vol3m, ft.vol12m, ft.maxret, ft.beta, ft.ivol, ft.dum_jan,
      ff.bm, ff.ep, ff.dy, ff.sp, ff.sg, ff.mktcap, ff.nokvol
    FROM factor_technical ft
    LEFT JOIN LATERAL (
      SELECT bm, ep, dy, sp, sg, mktcap, nokvol
      FROM factor_fundamentals ff2
      WHERE ff2.ticker = ft.ticker AND ff2.date <= ft.date
      ORDER BY ff2.date DESC LIMIT 1
    ) ff ON true
    WHERE ft.date = $1
      AND ft.mom1m IS NOT NULL
      AND ft.vol1m IS NOT NULL
  `, [date]);

  return result.rows
    .filter(r => !EXCLUDED_TICKERS.has(r.ticker))
    .filter(r => r.mktcap !== null && r.nokvol !== null)
    .map(r => ({
      ticker: r.ticker,
      date: r.date,
      mom1m: r.mom1m ? parseFloat(r.mom1m) : null,
      mom6m: r.mom6m ? parseFloat(r.mom6m) : null,
      mom11m: r.mom11m ? parseFloat(r.mom11m) : null,
      mom36m: r.mom36m ? parseFloat(r.mom36m) : null,
      chgmom: r.chgmom ? parseFloat(r.chgmom) : null,
      vol1m: r.vol1m ? parseFloat(r.vol1m) : null,
      vol3m: r.vol3m ? parseFloat(r.vol3m) : null,
      vol12m: r.vol12m ? parseFloat(r.vol12m) : null,
      maxret: r.maxret ? parseFloat(r.maxret) : null,
      beta: r.beta ? parseFloat(r.beta) : null,
      ivol: r.ivol ? parseFloat(r.ivol) : null,
      dum_jan: r.dum_jan || 0,
      bm: r.bm ? parseFloat(r.bm) : null,
      ep: r.ep ? parseFloat(r.ep) : null,
      dy: r.dy ? parseFloat(r.dy) : null,
      sp: r.sp ? parseFloat(r.sp) : null,
      sg: r.sg ? parseFloat(r.sg) : null,
      mktcap: r.mktcap ? parseFloat(r.mktcap) : null,
      nokvol: r.nokvol ? parseFloat(r.nokvol) : null,
    }));
}

/**
 * Compute actual 1-month forward log return for a ticker from a given date.
 * Uses exactly forwardDays trading days ahead.
 */
async function computeActualReturn(
  ticker: string,
  fromDate: string,
  forwardDays: number
): Promise<{ actualReturn: number | null; targetDate: string | null }> {
  const result = await pool.query(`
    SELECT date::text as date, adj_close
    FROM prices_daily
    WHERE ticker = $1 AND date >= $2
      AND adj_close IS NOT NULL AND adj_close > 0
    ORDER BY date ASC
    LIMIT $3
  `, [ticker, fromDate, forwardDays + 1]);

  if (result.rows.length < forwardDays + 1) {
    return { actualReturn: null, targetDate: null };
  }

  const startPrice = parseFloat(result.rows[0].adj_close);
  const endPrice = parseFloat(result.rows[forwardDays].adj_close);
  const targetDate = result.rows[forwardDays].date;

  if (startPrice <= 0 || endPrice <= 0) {
    return { actualReturn: null, targetDate: null };
  }

  return {
    actualReturn: Math.log(endPrice / startPrice),
    targetDate,
  };
}

// ─── Statistics ───────────────────────────────────────────────────────────────

function computeRanks(values: number[]): number[] {
  const indexed = values.map((v, i) => ({ v, i }));
  indexed.sort((a, b) => a.v - b.v);

  const ranks = new Array(values.length);
  let i = 0;
  while (i < indexed.length) {
    let j = i;
    while (j < indexed.length && indexed[j].v === indexed[i].v) j++;
    const avgRank = (i + j + 1) / 2;  // Average rank for ties
    for (let k = i; k < j; k++) {
      ranks[indexed[k].i] = avgRank;
    }
    i = j;
  }
  return ranks;
}

function pearsonCorrelation(x: number[], y: number[]): number {
  const n = x.length;
  if (n < 3) return 0;

  const meanX = x.reduce((a, b) => a + b, 0) / n;
  const meanY = y.reduce((a, b) => a + b, 0) / n;

  let sumXY = 0, sumX2 = 0, sumY2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - meanX;
    const dy = y[i] - meanY;
    sumXY += dx * dy;
    sumX2 += dx * dx;
    sumY2 += dy * dy;
  }

  const denom = Math.sqrt(sumX2 * sumY2);
  return denom > 0 ? sumXY / denom : 0;
}

function spearmanCorrelation(x: number[], y: number[]): number {
  return pearsonCorrelation(computeRanks(x), computeRanks(y));
}

function mean(arr: number[]): number {
  return arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}

function stddev(arr: number[]): number {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  const variance = arr.reduce((sum, v) => sum + (v - m) ** 2, 0) / (arr.length - 1);
  return Math.sqrt(variance);
}

// ─── Quintile Assignment ──────────────────────────────────────────────────────

function assignQuintiles(outcomes: PredictionOutcome[]): void {
  const sorted = [...outcomes]
    .filter(o => o.actualReturn !== null)
    .sort((a, b) => a.ensemblePrediction - b.ensemblePrediction);

  const n = sorted.length;
  if (n < 5) {
    // Too few for quintiles, assign all to Q3
    for (const o of outcomes) o.quintile = 3;
    return;
  }

  const quintileSize = Math.floor(n / 5);
  for (let i = 0; i < sorted.length; i++) {
    const q = Math.min(5, Math.floor(i / quintileSize) + 1);
    sorted[i].quintile = q;
  }

  // Map back by ticker
  const quintileMap = new Map(sorted.map(o => [o.ticker, o.quintile]));
  for (const o of outcomes) {
    o.quintile = quintileMap.get(o.ticker) || 0;
  }
}

// ─── Monthly Metrics ──────────────────────────────────────────────────────────

function computeMonthlyMetrics(
  outcomes: PredictionOutcome[],
  rebalanceDate: string
): MonthlyMetrics | null {
  const withActual = outcomes.filter(o => o.actualReturn !== null);
  if (withActual.length < 5) return null;

  // Hit rate
  const directionChecks = withActual.filter(
    o => o.ensemblePrediction !== 0 && o.actualReturn !== 0
  );
  const hits = directionChecks.filter(o => o.directionCorrect).length;
  const hitRate = directionChecks.length > 0 ? hits / directionChecks.length : 0;

  // MAE
  const absErrors = withActual.map(o => Math.abs(o.ensemblePrediction - o.actualReturn!));
  const mae = mean(absErrors);

  // IC (Spearman)
  const predictions = withActual.map(o => o.ensemblePrediction);
  const actuals = withActual.map(o => o.actualReturn!);
  const ic = spearmanCorrelation(predictions, actuals);

  // Long-short returns
  const q5 = withActual.filter(o => o.quintile === 5);
  const q1 = withActual.filter(o => o.quintile === 1);
  const longReturn = q5.length > 0 ? mean(q5.map(o => o.actualReturn!)) : 0;
  const shortReturn = q1.length > 0 ? mean(q1.map(o => o.actualReturn!)) : 0;
  const longShortReturn = longReturn - shortReturn;

  // Calibration
  const withinP90 = withActual.filter(
    o => o.actualReturn! >= o.p05 && o.actualReturn! <= o.p95
  ).length;
  const withinP50 = withActual.filter(
    o => o.actualReturn! >= o.p25 && o.actualReturn! <= o.p75
  ).length;

  const monthStr = rebalanceDate.slice(0, 7) + '-01';

  return {
    month: monthStr,
    nTickers: withActual.length,
    hitRate,
    mae,
    ic,
    longReturn,
    shortReturn,
    longShortReturn,
    avgPrediction: mean(predictions),
    avgActual: mean(actuals),
    p90Calibration: withinP90 / withActual.length,
    p50Calibration: withinP50 / withActual.length,
  };
}

// ─── Overall Metrics ──────────────────────────────────────────────────────────

function computeOverallMetrics(
  monthly: MonthlyMetrics[],
  allOutcomes: PredictionOutcome[]
): OverallMetrics {
  const withActual = allOutcomes.filter(o => o.actualReturn !== null);

  // Overall hit rate
  const dirChecks = withActual.filter(
    o => o.ensemblePrediction !== 0 && o.actualReturn !== 0
  );
  const overallHitRate = dirChecks.length > 0
    ? dirChecks.filter(o => o.directionCorrect).length / dirChecks.length
    : 0;

  // Overall MAE
  const overallMAE = mean(withActual.map(o => Math.abs(o.ensemblePrediction - o.actualReturn!)));

  // IC statistics
  const ics = monthly.map(m => m.ic);
  const overallICMean = mean(ics);
  const overallICStd = stddev(ics);
  const overallICIR = overallICStd > 0 ? overallICMean / overallICStd : 0;
  const pctMonthsICPositive = ics.filter(ic => ic > 0).length / Math.max(1, ics.length);

  // Long-short portfolio
  const lsReturns = monthly.map(m => m.longShortReturn);
  const lsMean = mean(lsReturns);
  const lsStd = stddev(lsReturns);
  const longShortSharpe = lsStd > 0 ? (lsMean / lsStd) * Math.sqrt(12) : 0;
  const longShortTotalReturn = lsReturns.reduce((a, b) => a + b, 0);

  // Annualized (compound)
  const nYears = monthly.length / 12;
  const longShortAnnualized = nYears > 0 ? longShortTotalReturn / nYears : 0;

  // Max drawdown
  let cumReturn = 0;
  let peak = 0;
  let maxDrawdown = 0;
  for (const r of lsReturns) {
    cumReturn += r;
    peak = Math.max(peak, cumReturn);
    maxDrawdown = Math.min(maxDrawdown, cumReturn - peak);
  }

  // Calibration
  const p90Cal = withActual.length > 0
    ? withActual.filter(o => o.actualReturn! >= o.p05 && o.actualReturn! <= o.p95).length / withActual.length
    : 0;
  const p50Cal = withActual.length > 0
    ? withActual.filter(o => o.actualReturn! >= o.p25 && o.actualReturn! <= o.p75).length / withActual.length
    : 0;

  // By size regime
  const regimes = ['microcap', 'small', 'mid', 'large', 'mega'];
  const metricsBySizeRegime: Record<string, { ic: number; hitRate: number; avgLS: number; n: number }> = {};

  for (const regime of regimes) {
    const regimeOutcomes = withActual.filter(o => o.sizeRegime === regime);
    if (regimeOutcomes.length < 10) continue;

    const regimeDirChecks = regimeOutcomes.filter(
      o => o.ensemblePrediction !== 0 && o.actualReturn !== 0
    );
    const regimeHitRate = regimeDirChecks.length > 0
      ? regimeDirChecks.filter(o => o.directionCorrect).length / regimeDirChecks.length
      : 0;

    const preds = regimeOutcomes.map(o => o.ensemblePrediction);
    const acts = regimeOutcomes.map(o => o.actualReturn!);
    const regimeIC = spearmanCorrelation(preds, acts);

    // Average L/S per month for this regime is hard without per-regime quintiles,
    // so just compute the correlation of prediction vs actual return
    metricsBySizeRegime[regime] = {
      ic: regimeIC,
      hitRate: regimeHitRate,
      avgLS: mean(acts.filter((_, i) => preds[i] > 0)) - mean(acts.filter((_, i) => preds[i] <= 0)),
      n: regimeOutcomes.length,
    };
  }

  const dates = monthly.map(m => m.month).sort();

  return {
    backtestStart: dates[0] || '',
    backtestEnd: dates[dates.length - 1] || '',
    nMonths: monthly.length,
    nTotalPredictions: withActual.length,
    overallHitRate,
    overallMAE,
    overallICMean,
    overallICStd,
    overallICIR,
    pctMonthsICPositive,
    longShortTotalReturn,
    longShortAnnualized,
    longShortSharpe,
    longShortMaxDrawdown: maxDrawdown,
    p90Calibration: p90Cal,
    p50Calibration: p50Cal,
    metricsBySizeRegime,
  };
}

// ─── Output ───────────────────────────────────────────────────────────────────

function printSummary(overall: OverallMetrics, monthly: MonthlyMetrics[]): void {
  const sep = '='.repeat(80);
  console.log('\n' + sep);
  console.log('BACKTEST SUMMARY: 19-Factor ML Prediction Model (v2.0_19factor_enhanced)');
  console.log(sep);
  console.log(`Period:           ${overall.backtestStart.slice(0, 7)} to ${overall.backtestEnd.slice(0, 7)} (${overall.nMonths} months)`);
  console.log(`Total predictions: ${overall.nTotalPredictions.toLocaleString()}`);

  console.log('\nDIRECTION ACCURACY');
  console.log(`  Hit rate:        ${(overall.overallHitRate * 100).toFixed(1)}% (baseline: 50%)`);

  console.log('\nPREDICTION ERROR');
  console.log(`  MAE:             ${(overall.overallMAE * 100).toFixed(2)}%`);

  console.log('\nINFORMATION COEFFICIENT');
  console.log(`  Mean IC:         ${overall.overallICMean.toFixed(3)}`);
  console.log(`  IC Std:          ${overall.overallICStd.toFixed(3)}`);
  console.log(`  ICIR:            ${overall.overallICIR.toFixed(3)}`);
  console.log(`  % months IC > 0: ${(overall.pctMonthsICPositive * 100).toFixed(1)}%`);

  console.log('\nLONG-SHORT PORTFOLIO (Q5 - Q1, equal-weighted)');
  console.log(`  Total return:    ${overall.longShortTotalReturn >= 0 ? '+' : ''}${(overall.longShortTotalReturn * 100).toFixed(1)}%`);
  console.log(`  Annualized:      ${overall.longShortAnnualized >= 0 ? '+' : ''}${(overall.longShortAnnualized * 100).toFixed(1)}%`);
  console.log(`  Sharpe ratio:    ${overall.longShortSharpe.toFixed(2)}`);
  console.log(`  Max drawdown:    ${(overall.longShortMaxDrawdown * 100).toFixed(1)}%`);
  const pctMonthsPositive = monthly.filter(m => m.longShortReturn > 0).length / Math.max(1, monthly.length);
  console.log(`  % months > 0:    ${(pctMonthsPositive * 100).toFixed(1)}%`);

  console.log('\nCALIBRATION');
  console.log(`  90% interval:    ${(overall.p90Calibration * 100).toFixed(1)}% (target: 90%)`);
  console.log(`  50% interval:    ${(overall.p50Calibration * 100).toFixed(1)}% (target: 50%)`);

  if (Object.keys(overall.metricsBySizeRegime).length > 0) {
    console.log('\nBY SIZE REGIME');
    for (const [regime, metrics] of Object.entries(overall.metricsBySizeRegime)) {
      console.log(`  ${regime.padEnd(10)} IC=${metrics.ic.toFixed(3)}  Hit=${(metrics.hitRate * 100).toFixed(0)}%  L/S=${metrics.avgLS >= 0 ? '+' : ''}${(metrics.avgLS * 100).toFixed(2)}%  n=${metrics.n}`);
    }
  }

  console.log('\nMONTHLY DETAIL');
  console.log('  Month      Tickers  Hit%    MAE%    IC      L/S%');
  console.log('  ' + '-'.repeat(55));
  for (const m of monthly) {
    console.log(
      `  ${m.month.slice(0, 7)}  ${String(m.nTickers).padStart(7)}  ` +
      `${(m.hitRate * 100).toFixed(1).padStart(5)}  ` +
      `${(m.mae * 100).toFixed(2).padStart(6)}  ` +
      `${m.ic.toFixed(3).padStart(6)}  ` +
      `${(m.longShortReturn * 100).toFixed(2).padStart(6)}`
    );
  }

  console.log('\n' + sep);
  console.log('NOTE: Model weights are fixed research-derived constants, not trained on this data.');
  console.log('This measures how well academic factor premia apply to Oslo Bors equities.');
  console.log(sep);
}

// ─── Database Storage ─────────────────────────────────────────────────────────

async function storeResults(
  runId: string,
  cfg: BacktestConfig,
  outcomes: PredictionOutcome[],
  monthly: MonthlyMetrics[],
  overall: OverallMetrics
): Promise<void> {
  console.log('\nStoring results in database...');

  // Store individual predictions using multi-row batch inserts
  const COLS_PER_ROW = 18;
  const batchSize = 100; // 100 rows per INSERT = 1800 params (well under PG 65535 limit)
  for (let i = 0; i < outcomes.length; i += batchSize) {
    const batch = outcomes.slice(i, i + batchSize);
    const values: any[] = [];
    const placeholders: string[] = [];
    for (let j = 0; j < batch.length; j++) {
      const o = batch[j];
      const offset = j * COLS_PER_ROW;
      placeholders.push(
        `($${offset+1},$${offset+2},$${offset+3},$${offset+4},$${offset+5},$${offset+6},$${offset+7},$${offset+8},$${offset+9},$${offset+10},$${offset+11},$${offset+12},$${offset+13},$${offset+14},$${offset+15},$${offset+16},$${offset+17},$${offset+18})`
      );
      values.push(
        runId, o.ticker, o.predictionDate, o.targetDate || null,
        o.ensemblePrediction, o.gbPrediction, o.rfPrediction, o.actualReturn,
        o.p05, o.p25, o.p50, o.p75, o.p95, o.confidenceScore,
        o.sizeRegime, o.turnoverRegime, o.quintile, o.directionCorrect,
      );
    }
    await pool.query(`
      INSERT INTO backtest_predictions (
        backtest_run_id, ticker, prediction_date, target_date,
        ensemble_prediction, gb_prediction, rf_prediction, actual_return,
        p05, p25, p50, p75, p95, confidence_score,
        size_regime, turnover_regime, quintile, direction_correct
      ) VALUES ${placeholders.join(',')}
      ON CONFLICT (backtest_run_id, ticker, prediction_date) DO NOTHING
    `, values);
    process.stdout.write(`  predictions: ${Math.min(i + batchSize, outcomes.length)}/${outcomes.length}\r`);
  }
  console.log();

  // Store monthly metrics in one batch
  {
    const MCOLS = 13;
    const values: any[] = [];
    const placeholders: string[] = [];
    for (let j = 0; j < monthly.length; j++) {
      const m = monthly[j];
      const offset = j * MCOLS;
      placeholders.push(
        `($${offset+1},$${offset+2},$${offset+3},$${offset+4},$${offset+5},$${offset+6},$${offset+7},$${offset+8},$${offset+9},$${offset+10},$${offset+11},$${offset+12},$${offset+13})`
      );
      values.push(
        runId, m.month, m.nTickers,
        m.hitRate, m.mae, m.ic, m.longReturn, m.shortReturn, m.longShortReturn,
        m.avgPrediction, m.avgActual, m.p90Calibration, m.p50Calibration,
      );
    }
    await pool.query(`
      INSERT INTO backtest_monthly (
        backtest_run_id, month, n_tickers,
        hit_rate, mae, ic, long_return, short_return, long_short_return,
        avg_prediction, avg_actual, p90_calibration, p50_calibration
      ) VALUES ${placeholders.join(',')}
      ON CONFLICT (backtest_run_id, month) DO NOTHING
    `, values);
  }

  // Store run summary
  await pool.query(`
    INSERT INTO backtest_runs (
      id, model_version, backtest_start, backtest_end,
      n_months, n_total_predictions,
      overall_hit_rate, overall_mae, overall_ic_mean, overall_ic_ir,
      long_short_total_return, long_short_annualized, long_short_sharpe,
      long_short_max_drawdown, p90_calibration,
      metrics_by_size_regime, config
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
  `, [
    runId, cfg.modelVersion,
    overall.backtestStart, overall.backtestEnd,
    overall.nMonths, overall.nTotalPredictions,
    overall.overallHitRate, overall.overallMAE,
    overall.overallICMean, overall.overallICIR,
    overall.longShortTotalReturn, overall.longShortAnnualized,
    overall.longShortSharpe, overall.longShortMaxDrawdown,
    overall.p90Calibration,
    JSON.stringify(overall.metricsBySizeRegime),
    JSON.stringify(cfg),
  ]);

  console.log(`Stored: ${outcomes.length} predictions, ${monthly.length} monthly, 1 run summary`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const startTime = Date.now();
  const runId = randomUUID();
  const cfg: BacktestConfig = {
    minTickersPerMonth: 10,
    forwardDays: 21,
    modelVersion: 'v2.0_19factor_enhanced',
  };

  console.log('='.repeat(80));
  console.log('BACKTEST: 19-Factor ML Prediction Model');
  console.log('='.repeat(80));
  console.log(`Run ID: ${runId}`);
  console.log(`Started: ${new Date().toISOString()}\n`);

  try {
    // 1. Create tables
    await ensureTablesExist();
    console.log('Database tables ready');

    // 2. Get rebalance dates
    const rebalanceDates = await getRebalanceDates(cfg.minTickersPerMonth);
    console.log(`Found ${rebalanceDates.length} monthly rebalance dates`);
    if (rebalanceDates.length === 0) {
      console.log('No rebalance dates found. Exiting.');
      process.exit(0);
    }
    console.log(`Range: ${rebalanceDates[0]} to ${rebalanceDates[rebalanceDates.length - 1]}\n`);

    // 3. Walk-forward loop
    const allOutcomes: PredictionOutcome[] = [];
    const monthlyResults: MonthlyMetrics[] = [];

    for (let i = 0; i < rebalanceDates.length; i++) {
      const rebalanceDate = rebalanceDates[i];
      process.stdout.write(`[${i + 1}/${rebalanceDates.length}] ${rebalanceDate}  `);

      // 3a. Batch-fetch all factors for this date
      const allFactors = await fetchAllFactorsForDate(rebalanceDate);

      if (allFactors.length < cfg.minTickersPerMonth) {
        console.log(`skip (${allFactors.length} tickers)`);
        continue;
      }

      // 3b. Cross-sectional stats
      const crossSectional = await fetchCrossSectionalStats(rebalanceDate);

      // 3c. Generate predictions and compute actuals
      const monthOutcomes: PredictionOutcome[] = [];

      for (const raw of allFactors) {
        const enhanced = enhanceFactors(raw, crossSectional);
        const baseEnsemble = computeEnsemblePrediction(enhanced);
        const { gbWeight, rfWeight } = getRegimeWeightAdjustments(
          enhanced.sizeRegime, enhanced.turnoverRegime
        );
        const adjustedEnsemble = baseEnsemble.gb * gbWeight + baseEnsemble.rf * rfWeight;
        const percentiles = computePercentiles(
          adjustedEnsemble, enhanced.vol1m, enhanced.vol12m, enhanced.sizeRegime
        );
        const confidence = computeConfidence(enhanced, baseEnsemble.gb, baseEnsemble.rf);

        const { actualReturn, targetDate } = await computeActualReturn(
          raw.ticker, rebalanceDate, cfg.forwardDays
        );

        monthOutcomes.push({
          ticker: raw.ticker,
          predictionDate: rebalanceDate,
          targetDate: targetDate || '',
          ensemblePrediction: adjustedEnsemble,
          gbPrediction: baseEnsemble.gb,
          rfPrediction: baseEnsemble.rf,
          actualReturn,
          ...percentiles,
          confidenceScore: confidence,
          sizeRegime: enhanced.sizeRegime,
          turnoverRegime: enhanced.turnoverRegime,
          quintile: 0,
          directionCorrect: null,
        });
      }

      // 3d. Assign quintiles and direction
      assignQuintiles(monthOutcomes);
      for (const o of monthOutcomes) {
        if (o.actualReturn !== null) {
          o.directionCorrect =
            (o.ensemblePrediction > 0 && o.actualReturn > 0) ||
            (o.ensemblePrediction < 0 && o.actualReturn < 0) ||
            (o.ensemblePrediction === 0 && o.actualReturn === 0);
        }
      }

      // 3e. Monthly metrics
      const metrics = computeMonthlyMetrics(monthOutcomes, rebalanceDate);
      if (metrics) {
        monthlyResults.push(metrics);
        console.log(
          `${allFactors.length} tickers  ` +
          `IC=${metrics.ic.toFixed(3).padStart(7)}  ` +
          `Hit=${(metrics.hitRate * 100).toFixed(1).padStart(5)}%  ` +
          `L/S=${(metrics.longShortReturn * 100).toFixed(2).padStart(6)}%`
        );
      } else {
        console.log(`${allFactors.length} tickers  (insufficient actuals)`);
      }

      allOutcomes.push(...monthOutcomes);
    }

    if (monthlyResults.length === 0) {
      console.log('\nNo months with sufficient data for metrics. Exiting.');
      process.exit(0);
    }

    // 4. Overall metrics
    const overall = computeOverallMetrics(monthlyResults, allOutcomes);

    // 5. Print summary
    printSummary(overall, monthlyResults);

    // 6. Store results
    await storeResults(runId, cfg, allOutcomes, monthlyResults, overall);

    // 7. Write JSON report
    const reportPath = resolve(__dirname, `../backtest-report-${runId.slice(0, 8)}.json`);
    const report = { runId, config: cfg, overall, monthly: monthlyResults };
    writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`\nJSON report: ${reportPath}`);

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`Duration: ${duration}s`);
    process.exit(0);
  } catch (err: any) {
    console.error('\nFatal error:', err.message);
    console.error(err.stack);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
