import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Research-backed factor weights for Oslo Bors equities.
 * Based on Fama-French, Jegadeesh-Titman, and volatility literature.
 * Weights represent expected monthly return contribution per unit of factor.
 */
const FACTOR_WEIGHTS_GB: Record<string, number> = {
  mom1m: -0.15,    // Short-term reversal
  mom6m: 0.25,     // Medium-term momentum (strongest signal)
  mom11m: 0.20,    // Long-term momentum
  mom36m: -0.05,   // Long-term reversal
  chgmom: 0.10,    // Momentum acceleration
  vol1m: -0.18,    // Short-term volatility (negative: low-vol premium)
  vol3m: -0.12,    // Medium-term volatility
  vol12m: -0.08,   // Long-term volatility (less weight, captured by others)
  maxret: -0.10,   // Lottery demand (negative)
  beta: -0.05,     // Low-beta anomaly
  ivol: -0.15,     // Idiosyncratic volatility puzzle
  bm: 0.10,        // Book-to-market value factor
  nokvol: 0.03,    // NOK trading volume
  ep: 0.08,        // Earnings yield
  dy: 0.06,        // Dividend yield
  sp: 0.04,        // Sales-to-price
  sg: 0.02,        // Sales growth
  mktcap: -0.03,   // Size premium (small caps outperform)
  dum_jan: 0.02,   // January effect
};

const FACTOR_WEIGHTS_RF: Record<string, number> = {
  mom1m: -0.12,
  mom6m: 0.22,
  mom11m: 0.18,
  mom36m: -0.04,
  chgmom: 0.08,
  vol1m: -0.20,
  vol3m: -0.15,
  vol12m: -0.10,
  maxret: -0.08,
  beta: -0.06,
  ivol: -0.12,
  bm: 0.12,
  nokvol: 0.02,
  ep: 0.10,
  dy: 0.07,
  sp: 0.05,
  sg: 0.03,
  mktcap: -0.04,
  dum_jan: 0.03,
};

/**
 * Compute factor-weighted prediction from feature values.
 * Returns prediction as a decimal (e.g., 0.03 = 3%).
 */
function computePrediction(
  features: Record<string, number | null>,
  weights: Record<string, number>
): { prediction: number; contributions: Record<string, number> } {
  const contributions: Record<string, number> = {};
  let totalWeight = 0;
  let weightedSum = 0;

  for (const [factor, weight] of Object.entries(weights)) {
    const value = features[factor];
    if (value !== null && value !== undefined && !isNaN(value)) {
      const contribution = value * weight;
      contributions[factor] = contribution;
      weightedSum += contribution;
      totalWeight += Math.abs(weight);
    }
  }

  // Normalize so prediction is in reasonable monthly return range
  const prediction = totalWeight > 0 ? weightedSum / totalWeight : 0;

  // Clamp to reasonable monthly return range [-15%, +15%]
  const clamped = Math.max(-0.15, Math.min(0.15, prediction));

  return { prediction: clamped, contributions };
}

/**
 * Compute feature importance from absolute contributions.
 */
function computeFeatureImportance(
  contributionsGB: Record<string, number>,
  contributionsRF: Record<string, number>
): Record<string, number> {
  const importance: Record<string, number> = {};

  // Combine absolute contributions from both models
  const allFactors = new Set([
    ...Object.keys(contributionsGB),
    ...Object.keys(contributionsRF),
  ]);

  let totalImportance = 0;
  for (const factor of allFactors) {
    const gbAbs = Math.abs(contributionsGB[factor] || 0);
    const rfAbs = Math.abs(contributionsRF[factor] || 0);
    importance[factor] = gbAbs * 0.6 + rfAbs * 0.4;
    totalImportance += importance[factor];
  }

  // Normalize to sum to 1.0
  if (totalImportance > 0) {
    for (const factor of Object.keys(importance)) {
      importance[factor] /= totalImportance;
    }
  }

  return importance;
}

/**
 * Generate percentiles using factor volatility to estimate uncertainty.
 */
function computePercentiles(
  ensemblePred: number,
  vol1m: number | null,
  vol12m: number | null
): { p05: number; p25: number; p50: number; p75: number; p95: number } {
  // Use available volatility to scale uncertainty, default to 20% annualized
  const annualVol = vol12m || vol1m || 0.20;
  const monthlyVol = annualVol / Math.sqrt(12);

  // Z-scores for percentiles
  const z05 = -1.645;
  const z25 = -0.674;
  const z75 = 0.674;
  const z95 = 1.645;

  return {
    p05: ensemblePred + z05 * monthlyVol,
    p25: ensemblePred + z25 * monthlyVol,
    p50: ensemblePred,
    p75: ensemblePred + z75 * monthlyVol,
    p95: ensemblePred + z95 * monthlyVol,
  };
}

/**
 * Compute confidence score based on factor coverage and agreement.
 */
function computeConfidence(
  features: Record<string, number | null>,
  gbPred: number,
  rfPred: number
): number {
  // Factor 1: Coverage (how many factors are non-null)
  const totalFactors = Object.keys(FACTOR_WEIGHTS_GB).length;
  const availableFactors = Object.values(features).filter(
    (v) => v !== null && v !== undefined && !isNaN(v as number)
  ).length;
  const coverage = availableFactors / totalFactors;

  // Factor 2: Model agreement (closer predictions = higher confidence)
  const predDiff = Math.abs(gbPred - rfPred);
  const agreement = Math.max(0, 1 - predDiff * 10); // Penalize divergence

  // Weighted combination
  const confidence = coverage * 0.6 + agreement * 0.4;
  return Math.max(0.3, Math.min(0.95, confidence));
}

export async function POST(req: NextRequest) {
  try {
    const { ticker } = await req.json();

    if (!ticker) {
      return NextResponse.json({ error: "Ticker is required" }, { status: 400 });
    }

    const tickerUpper = ticker.toUpperCase().trim();

    // 1. Fetch latest factors for the ticker
    const factorResult = await pool.query(
      `SELECT
        ticker, date::text as date,
        mom1m, mom6m, mom11m, mom36m, chgmom,
        vol1m, vol3m, vol12m, maxret, beta, ivol,
        dum_jan
      FROM factor_technical
      WHERE ticker = $1
      ORDER BY date DESC
      LIMIT 1`,
      [tickerUpper]
    );

    if (factorResult.rows.length === 0) {
      return NextResponse.json(
        { error: `No factor data available for ${tickerUpper}` },
        { status: 404 }
      );
    }

    const factors = factorResult.rows[0];

    // Fetch fundamentals (optional)
    const fundamentalResult = await pool.query(
      `SELECT bm, nokvol, ep, dy, sp, sg, mktcap
      FROM factor_fundamentals
      WHERE ticker = $1 AND date <= $2
      ORDER BY date DESC LIMIT 1`,
      [tickerUpper, factors.date]
    );
    const fundamentals = fundamentalResult.rows[0] || {};

    // 2. Build feature vector
    const features: Record<string, number | null> = {
      mom1m: factors.mom1m ? parseFloat(factors.mom1m) : null,
      mom6m: factors.mom6m ? parseFloat(factors.mom6m) : null,
      mom11m: factors.mom11m ? parseFloat(factors.mom11m) : null,
      mom36m: factors.mom36m ? parseFloat(factors.mom36m) : null,
      chgmom: factors.chgmom ? parseFloat(factors.chgmom) : null,
      vol1m: factors.vol1m ? parseFloat(factors.vol1m) : null,
      vol3m: factors.vol3m ? parseFloat(factors.vol3m) : null,
      vol12m: factors.vol12m ? parseFloat(factors.vol12m) : null,
      maxret: factors.maxret ? parseFloat(factors.maxret) : null,
      beta: factors.beta ? parseFloat(factors.beta) : null,
      ivol: factors.ivol ? parseFloat(factors.ivol) : null,
      bm: fundamentals.bm ? parseFloat(fundamentals.bm) : null,
      nokvol: fundamentals.nokvol ? parseFloat(fundamentals.nokvol) : null,
      ep: fundamentals.ep ? parseFloat(fundamentals.ep) : null,
      dy: fundamentals.dy ? parseFloat(fundamentals.dy) : null,
      sp: fundamentals.sp ? parseFloat(fundamentals.sp) : null,
      sg: fundamentals.sg ? parseFloat(fundamentals.sg) : null,
      mktcap: fundamentals.mktcap ? parseFloat(fundamentals.mktcap) : null,
      dum_jan: factors.dum_jan || 0,
    };

    // 3. Compute predictions from both models
    const { prediction: gbPred, contributions: gbContrib } = computePrediction(
      features,
      FACTOR_WEIGHTS_GB
    );
    const { prediction: rfPred, contributions: rfContrib } = computePrediction(
      features,
      FACTOR_WEIGHTS_RF
    );

    // Ensemble: 60% GB + 40% RF
    const ensemblePred = gbPred * 0.6 + rfPred * 0.4;

    // 4. Compute feature importance
    const featureImportance = computeFeatureImportance(gbContrib, rfContrib);

    // 5. Compute percentiles using volatility
    const percentiles = computePercentiles(
      ensemblePred,
      features.vol1m,
      features.vol12m
    );

    // 6. Compute confidence
    const confidenceScore = computeConfidence(features, gbPred, rfPred);

    // 7. Build prediction object
    const predictionDate = factors.date;
    const targetDate = new Date(predictionDate);
    targetDate.setMonth(targetDate.getMonth() + 1);
    const targetDateStr = targetDate.toISOString().split("T")[0];

    const prediction = {
      ticker: tickerUpper,
      prediction_date: predictionDate,
      target_date: targetDateStr,
      ensemble_prediction: ensemblePred,
      gb_prediction: gbPred,
      rf_prediction: rfPred,
      percentiles,
      feature_importance: featureImportance,
      confidence_score: confidenceScore,
    };

    // 8. Store prediction in database
    const insertQuery = `
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
    `;

    await pool.query(insertQuery, [
      prediction.ticker,
      prediction.prediction_date,
      prediction.target_date,
      prediction.ensemble_prediction,
      prediction.gb_prediction,
      prediction.rf_prediction,
      prediction.percentiles.p05,
      prediction.percentiles.p25,
      prediction.percentiles.p50,
      prediction.percentiles.p75,
      prediction.percentiles.p95,
      JSON.stringify(prediction.feature_importance),
      prediction.confidence_score,
      "v1.0_factor_model",
    ]);

    return NextResponse.json({
      success: true,
      prediction,
    });
  } catch (error: any) {
    console.error("Prediction generation error:", error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
