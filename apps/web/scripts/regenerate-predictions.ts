#!/usr/bin/env tsx
/**
 * Regenerate v2.0 ML predictions for all ML-ready tickers
 * Uses the latest factor data from the database.
 *
 * Usage: NODE_TLS_REJECT_UNAUTHORIZED=0 npx tsx scripts/regenerate-predictions.ts
 */

import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(__dirname, '../.env.local') });

import { pool } from '../src/lib/db';
import {
  RawFactors,
  fetchCrossSectionalStats,
  enhanceFactors,
  computeEnsemblePrediction,
  computeFeatureImportance,
  computePercentiles,
  computeConfidence,
  getRegimeWeightAdjustments,
} from '../src/lib/factorAdvanced';

/**
 * Get all ML-ready tickers (complete factor data)
 */
async function getMLReadyTickers(): Promise<string[]> {
  const result = await pool.query<{ ticker: string }>(`
    SELECT ft_agg.ticker
    FROM (
      SELECT ticker FROM factor_technical GROUP BY ticker HAVING COUNT(*) >= 100
    ) ft_agg
    INNER JOIN LATERAL (
      SELECT 1 FROM factor_technical ft2
      WHERE ft2.ticker = ft_agg.ticker AND ft2.beta IS NOT NULL AND ft2.ivol IS NOT NULL
      ORDER BY ft2.date DESC LIMIT 1
    ) beta_check ON true
    INNER JOIN LATERAL (
      SELECT 1 FROM factor_fundamentals ff
      WHERE ff.ticker = ft_agg.ticker AND ff.bm IS NOT NULL AND ff.mktcap IS NOT NULL AND ff.nokvol IS NOT NULL
      ORDER BY ff.date DESC LIMIT 1
    ) fund_check ON true
    ORDER BY ft_agg.ticker
  `);
  return result.rows.map(r => r.ticker);
}

/**
 * Fetch raw factors for a ticker
 */
async function fetchRawFactors(ticker: string): Promise<RawFactors | null> {
  const techResult = await pool.query(
    `SELECT ticker, date::text as date,
      mom1m, mom6m, mom11m, mom36m, chgmom,
      vol1m, vol3m, vol12m, maxret, beta, ivol, dum_jan
    FROM factor_technical
    WHERE ticker = $1
    ORDER BY date DESC LIMIT 1`,
    [ticker]
  );

  if (techResult.rows.length === 0) return null;
  const tech = techResult.rows[0];

  const fundResult = await pool.query(
    `SELECT bm, ep, dy, sp, sg, mktcap, nokvol
    FROM factor_fundamentals
    WHERE ticker = $1 AND date <= $2
    ORDER BY date DESC LIMIT 1`,
    [ticker, tech.date]
  );
  const fund = fundResult.rows[0] || {};

  return {
    ticker: tech.ticker,
    date: tech.date,
    mom1m: tech.mom1m ? parseFloat(tech.mom1m) : null,
    mom6m: tech.mom6m ? parseFloat(tech.mom6m) : null,
    mom11m: tech.mom11m ? parseFloat(tech.mom11m) : null,
    mom36m: tech.mom36m ? parseFloat(tech.mom36m) : null,
    chgmom: tech.chgmom ? parseFloat(tech.chgmom) : null,
    vol1m: tech.vol1m ? parseFloat(tech.vol1m) : null,
    vol3m: tech.vol3m ? parseFloat(tech.vol3m) : null,
    vol12m: tech.vol12m ? parseFloat(tech.vol12m) : null,
    maxret: tech.maxret ? parseFloat(tech.maxret) : null,
    beta: tech.beta ? parseFloat(tech.beta) : null,
    ivol: tech.ivol ? parseFloat(tech.ivol) : null,
    dum_jan: tech.dum_jan || 0,
    bm: fund.bm ? parseFloat(fund.bm) : null,
    ep: fund.ep ? parseFloat(fund.ep) : null,
    dy: fund.dy ? parseFloat(fund.dy) : null,
    sp: fund.sp ? parseFloat(fund.sp) : null,
    sg: fund.sg ? parseFloat(fund.sg) : null,
    mktcap: fund.mktcap ? parseFloat(fund.mktcap) : null,
    nokvol: fund.nokvol ? parseFloat(fund.nokvol) : null,
  };
}

async function generatePrediction(ticker: string): Promise<boolean> {
  const rawFactors = await fetchRawFactors(ticker);
  if (!rawFactors) return false;

  const crossSectional = await fetchCrossSectionalStats(rawFactors.date);
  const enhanced = enhanceFactors(rawFactors, crossSectional);
  const baseEnsemble = computeEnsemblePrediction(enhanced);
  const { gbWeight, rfWeight } = getRegimeWeightAdjustments(enhanced.sizeRegime, enhanced.turnoverRegime);
  const adjustedEnsemble = baseEnsemble.gb * gbWeight + baseEnsemble.rf * rfWeight;
  const featureImportance = computeFeatureImportance(baseEnsemble.contributions.gb, baseEnsemble.contributions.rf);
  const percentiles = computePercentiles(adjustedEnsemble, enhanced.vol1m, enhanced.vol12m, enhanced.sizeRegime);
  const confidenceScore = computeConfidence(enhanced, baseEnsemble.gb, baseEnsemble.rf);

  const targetDate = new Date(rawFactors.date);
  targetDate.setMonth(targetDate.getMonth() + 1);
  const targetDateStr = targetDate.toISOString().split('T')[0];

  await pool.query(`
    INSERT INTO ml_predictions (
      ticker, prediction_date, target_date,
      ensemble_prediction, gb_prediction, rf_prediction,
      p05, p25, p50, p75, p95,
      feature_importance, confidence_score, model_version
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
    ON CONFLICT (ticker, prediction_date, model_version) DO UPDATE SET
      ensemble_prediction = EXCLUDED.ensemble_prediction,
      gb_prediction = EXCLUDED.gb_prediction,
      rf_prediction = EXCLUDED.rf_prediction,
      p05 = EXCLUDED.p05, p25 = EXCLUDED.p25,
      p50 = EXCLUDED.p50, p75 = EXCLUDED.p75, p95 = EXCLUDED.p95,
      feature_importance = EXCLUDED.feature_importance,
      confidence_score = EXCLUDED.confidence_score
    RETURNING *
  `, [
    ticker,
    rawFactors.date,
    targetDateStr,
    adjustedEnsemble,
    baseEnsemble.gb,
    baseEnsemble.rf,
    percentiles.p05,
    percentiles.p25,
    percentiles.p50,
    percentiles.p75,
    percentiles.p95,
    JSON.stringify(featureImportance),
    confidenceScore,
    'v2.0_19factor_enhanced',
  ]);

  return true;
}

async function main() {
  console.log('=== Regenerating v2.0 ML Predictions ===\n');

  try {
    const tickers = await getMLReadyTickers();
    console.log(`Found ${tickers.length} ML-ready tickers\n`);

    let succeeded = 0;
    let failed = 0;

    for (const ticker of tickers) {
      try {
        process.stdout.write(`[${ticker.padEnd(10)}] `);
        const ok = await generatePrediction(ticker);
        if (ok) {
          succeeded++;
          console.log('OK');
        } else {
          failed++;
          console.log('NO FACTORS');
        }
      } catch (err: any) {
        failed++;
        console.log(`ERROR: ${err.message}`);
      }
    }

    console.log(`\n=== DONE ===`);
    console.log(`Succeeded: ${succeeded}/${tickers.length}`);
    console.log(`Failed: ${failed}`);

    process.exit(failed > 0 ? 1 : 0);
  } catch (err: any) {
    console.error('Fatal error:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
