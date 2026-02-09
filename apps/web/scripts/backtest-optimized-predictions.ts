#!/usr/bin/env tsx
/**
 * Walk-Forward Backtest for Optimized Predictions
 *
 * Generates backtest predictions using per-ticker optimizer configs.
 * Only runs for tickers that have an optimizer config in src/data/optimizer-configs/.
 *
 * Usage: NODE_TLS_REJECT_UNAUTHORIZED=0 npx tsx scripts/backtest-optimized-predictions.ts
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import { readdirSync, readFileSync, existsSync } from 'fs';

config({ path: resolve(__dirname, '../.env.local') });

import { pool } from '../src/lib/db';
import {
  RawFactors,
  fetchCrossSectionalStats,
  enhanceFactors,
  computeEnsemblePredictionWithConfig,
  computePercentiles,
  computeConfidence,
} from '../src/lib/factorAdvanced';

// ─── Types ────────────────────────────────────────────────────────────────────

interface OptimizerConfig {
  ticker: string;
  config: {
    factors: string[];
    gb_weight: number;
    rf_weight: number;
  };
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

// ─── Load Optimizer Configs ───────────────────────────────────────────────────

function loadOptimizerConfigs(): Map<string, OptimizerConfig> {
  const configDir = resolve(__dirname, '../src/data/optimizer-configs');
  const configs = new Map<string, OptimizerConfig>();

  if (!existsSync(configDir)) {
    console.log('No optimizer configs directory found');
    return configs;
  }

  const files = readdirSync(configDir).filter(f => f.endsWith('.json'));
  for (const file of files) {
    try {
      const content = readFileSync(resolve(configDir, file), 'utf-8');
      const cfg: OptimizerConfig = JSON.parse(content);
      configs.set(cfg.ticker.toUpperCase(), cfg);
    } catch (err) {
      console.warn(`Failed to load ${file}:`, err);
    }
  }

  return configs;
}

// ─── Data Fetching ────────────────────────────────────────────────────────────

async function getTickerHistoricalDates(ticker: string): Promise<string[]> {
  const result = await pool.query<{ date: string }>(`
    SELECT DISTINCT date::text
    FROM factor_technical
    WHERE ticker = $1
      AND mom1m IS NOT NULL
      AND vol1m IS NOT NULL
    ORDER BY date
  `, [ticker]);
  return result.rows.map(r => r.date);
}

async function fetchFactorsForDate(ticker: string, date: string): Promise<RawFactors | null> {
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
    WHERE ft.ticker = $1 AND ft.date = $2
  `, [ticker, date]);

  if (result.rows.length === 0) return null;

  const r = result.rows[0];
  if (!r.mktcap || !r.nokvol) return null;

  return {
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
  };
}

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

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('='.repeat(80));
  console.log('BACKTEST: Optimized Predictions');
  console.log('='.repeat(80));

  const optimizerConfigs = loadOptimizerConfigs();
  console.log(`\nFound ${optimizerConfigs.size} optimizer configs: ${[...optimizerConfigs.keys()].join(', ')}\n`);

  if (optimizerConfigs.size === 0) {
    console.log('No optimizer configs found. Nothing to do.');
    process.exit(0);
  }

  // Get the latest backtest run ID
  const runResult = await pool.query(`
    SELECT id FROM backtest_runs ORDER BY created_at DESC LIMIT 1
  `);
  if (runResult.rows.length === 0) {
    console.error('No backtest run found. Run backtest-predictions.ts first.');
    process.exit(1);
  }
  const runId = runResult.rows[0].id;
  console.log(`Using backtest run: ${runId}\n`);

  const forwardDays = 21;

  for (const [ticker, cfg] of optimizerConfigs) {
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`Processing ${ticker} (${cfg.config.factors.length} factors: ${cfg.config.factors.join(', ')})`);
    console.log(`Ensemble: ${(cfg.config.gb_weight * 100).toFixed(0)}% GB + ${(cfg.config.rf_weight * 100).toFixed(0)}% RF`);

    // Get all existing default predictions for this ticker from this run
    const existingResult = await pool.query(`
      SELECT prediction_date::text, target_date::text, actual_return
      FROM backtest_predictions
      WHERE backtest_run_id = $1 AND ticker = $2 AND model_type = 'default'
      ORDER BY prediction_date
    `, [runId, ticker]);

    if (existingResult.rows.length === 0) {
      console.log(`  No default predictions found for ${ticker}. Skipping.`);
      continue;
    }

    console.log(`  Found ${existingResult.rows.length} prediction dates`);

    const outcomes: PredictionOutcome[] = [];
    let processed = 0;

    for (const row of existingResult.rows) {
      const predDate = row.prediction_date;

      const raw = await fetchFactorsForDate(ticker, predDate);
      if (!raw) continue;

      const crossSectional = await fetchCrossSectionalStats(predDate);
      const enhanced = enhanceFactors(raw, crossSectional);

      // Use optimized config for prediction
      const result = computeEnsemblePredictionWithConfig(
        enhanced,
        cfg.config.factors,
        cfg.config.gb_weight,
        cfg.config.rf_weight
      );

      const percentiles = computePercentiles(
        result.ensemble, enhanced.vol1m, enhanced.vol12m, enhanced.sizeRegime
      );
      const confidence = computeConfidence(enhanced, result.gb, result.rf);

      const actualReturn = row.actual_return !== null ? parseFloat(row.actual_return) : null;
      const targetDate = row.target_date;

      const directionCorrect = actualReturn !== null
        ? (result.ensemble > 0 && actualReturn > 0) ||
          (result.ensemble < 0 && actualReturn < 0) ||
          (result.ensemble === 0 && actualReturn === 0)
        : null;

      outcomes.push({
        ticker,
        predictionDate: predDate,
        targetDate: targetDate || '',
        ensemblePrediction: result.ensemble,
        gbPrediction: result.gb,
        rfPrediction: result.rf,
        actualReturn,
        ...percentiles,
        confidenceScore: confidence,
        sizeRegime: enhanced.sizeRegime,
        turnoverRegime: enhanced.turnoverRegime,
        quintile: 0, // Will compute later if needed
        directionCorrect,
      });

      processed++;
      if (processed % 20 === 0) {
        process.stdout.write(`  Processed ${processed}/${existingResult.rows.length}\r`);
      }
    }

    console.log(`  Processed ${processed}/${existingResult.rows.length} predictions`);

    // Store optimized predictions
    if (outcomes.length > 0) {
      const COLS = 19;
      const batchSize = 50;

      for (let i = 0; i < outcomes.length; i += batchSize) {
        const batch = outcomes.slice(i, i + batchSize);
        const values: any[] = [];
        const placeholders: string[] = [];

        for (let j = 0; j < batch.length; j++) {
          const o = batch[j];
          const offset = j * COLS;
          placeholders.push(
            `($${offset+1},$${offset+2},$${offset+3},$${offset+4},$${offset+5},$${offset+6},$${offset+7},$${offset+8},$${offset+9},$${offset+10},$${offset+11},$${offset+12},$${offset+13},$${offset+14},$${offset+15},$${offset+16},$${offset+17},$${offset+18},$${offset+19})`
          );
          values.push(
            runId, o.ticker, o.predictionDate, o.targetDate || null,
            o.ensemblePrediction, o.gbPrediction, o.rfPrediction, o.actualReturn,
            o.p05, o.p25, o.p50, o.p75, o.p95, o.confidenceScore,
            o.sizeRegime, o.turnoverRegime, o.quintile, o.directionCorrect,
            'optimized'
          );
        }

        await pool.query(`
          INSERT INTO backtest_predictions (
            backtest_run_id, ticker, prediction_date, target_date,
            ensemble_prediction, gb_prediction, rf_prediction, actual_return,
            p05, p25, p50, p75, p95, confidence_score,
            size_regime, turnover_regime, quintile, direction_correct,
            model_type
          ) VALUES ${placeholders.join(',')}
          ON CONFLICT (backtest_run_id, ticker, prediction_date, model_type) DO UPDATE SET
            ensemble_prediction = EXCLUDED.ensemble_prediction,
            gb_prediction = EXCLUDED.gb_prediction,
            rf_prediction = EXCLUDED.rf_prediction,
            p05 = EXCLUDED.p05, p25 = EXCLUDED.p25, p50 = EXCLUDED.p50,
            p75 = EXCLUDED.p75, p95 = EXCLUDED.p95,
            confidence_score = EXCLUDED.confidence_score,
            direction_correct = EXCLUDED.direction_correct
        `, values);
      }

      // Compute metrics
      const withActual = outcomes.filter(o => o.actualReturn !== null);
      const dirChecks = withActual.filter(o => o.ensemblePrediction !== 0 && o.actualReturn !== 0);
      const hitRate = dirChecks.length > 0
        ? dirChecks.filter(o => o.directionCorrect).length / dirChecks.length
        : 0;
      const mae = withActual.length > 0
        ? withActual.reduce((sum, o) => sum + Math.abs(o.ensemblePrediction - o.actualReturn!), 0) / withActual.length
        : 0;

      console.log(`  Stored ${outcomes.length} optimized predictions`);
      console.log(`  Hit Rate: ${(hitRate * 100).toFixed(1)}%  MAE: ${(mae * 100).toFixed(2)}%`);
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log('DONE!');
  console.log('='.repeat(80));

  await pool.end();
  process.exit(0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
