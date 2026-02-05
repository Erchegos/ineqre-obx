/**
 * POST /api/predictions/generate
 *
 * Generates 1-month forward return predictions using the 19-factor model.
 * Supports both default and optimizer-tuned modes.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * ACADEMIC REFERENCES
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * [1] Gu, S., Kelly, B., & Xiu, D. (2020). "Empirical Asset Pricing via Machine
 *     Learning." Review of Financial Studies, 33(5), 2223-2273.
 *     - 19-factor specification and ML methodology
 *     - Gradient Boosting + Random Forest ensemble
 *
 * [2] Medhat, M., & Schmeling, M. (2021). "Short-term Momentum."
 *     Review of Financial Studies, 35(3), 1480-1526.
 *     - Turnover interactions, size-conditional effects
 *     - End-of-month filtering
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Key Features:
 * - Cross-sectional z-score standardization
 * - mom1m × NOKvol interaction terms (CRITICAL per Medhat & Schmeling)
 * - Size regime classification
 * - Regime-conditional ensemble weights
 * - 60% GB + 40% RF ensemble (base weights)
 * - Optional per-ticker optimized factor subset + ensemble weights
 */

import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import {
  RawFactors,
  fetchCrossSectionalStats,
  enhanceFactors,
  computeEnhancedPrediction,
  computeEnsemblePrediction,
  computeFeatureImportance,
  computePercentiles,
  computeConfidence,
  getRegimeWeightAdjustments,
} from "@/lib/factorAdvanced";
import {
  loadOptimizerConfig,
  getOptimizedFactorWeights,
} from "@/lib/optimizerConfig";

export const dynamic = "force-dynamic";

/**
 * Fetch raw factors for a ticker (technical + fundamentals)
 */
async function fetchRawFactors(ticker: string): Promise<RawFactors | null> {
  // Fetch latest technical factors
  const techResult = await pool.query(
    `SELECT
      ticker, date::text as date,
      mom1m, mom6m, mom11m, mom36m, chgmom,
      vol1m, vol3m, vol12m, maxret, beta, ivol,
      dum_jan
    FROM factor_technical
    WHERE ticker = $1
    ORDER BY date DESC
    LIMIT 1`,
    [ticker]
  );

  if (techResult.rows.length === 0) return null;
  const tech = techResult.rows[0];

  // Fetch latest fundamentals (forward-filled)
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

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { ticker, mode } = body;

    if (!ticker) {
      return NextResponse.json({ error: "Ticker is required" }, { status: 400 });
    }

    const tickerUpper = ticker.toUpperCase().trim();
    const isOptimized = mode === "optimized";

    // Load optimizer config if optimized mode requested
    let optimizerConfig = null;
    let optimizedWeights = null;
    if (isOptimized) {
      optimizerConfig = loadOptimizerConfig(tickerUpper);
      if (!optimizerConfig) {
        return NextResponse.json(
          { error: `No optimized config for ${tickerUpper}` },
          { status: 404 }
        );
      }
      optimizedWeights = getOptimizedFactorWeights(optimizerConfig);
    }

    // 1. Fetch raw factors
    const rawFactors = await fetchRawFactors(tickerUpper);

    if (!rawFactors) {
      return NextResponse.json(
        { error: `No factor data available for ${tickerUpper}` },
        { status: 404 }
      );
    }

    // 2. Fetch cross-sectional statistics for z-score calculation
    const crossSectional = await fetchCrossSectionalStats(rawFactors.date);

    // 3. Enhance factors with z-scores, interactions, and regimes
    const enhancedFactors = enhanceFactors(rawFactors, crossSectional);

    let gbPred: number;
    let rfPred: number;
    let adjustedEnsemble: number;
    let gbWeight: number;
    let rfWeight: number;
    let gbContributions: Record<string, number>;
    let rfContributions: Record<string, number>;
    let modelVersion: string;

    if (isOptimized && optimizedWeights && optimizerConfig) {
      // ── Optimized path: use filtered factor weights + optimizer ensemble ──
      const gbResult = computeEnhancedPrediction(
        enhancedFactors,
        optimizedWeights.gbWeights
      );
      const rfResult = computeEnhancedPrediction(
        enhancedFactors,
        optimizedWeights.rfWeights
      );

      gbPred = gbResult.prediction;
      rfPred = rfResult.prediction;
      gbWeight = optimizerConfig.config.gb_weight;
      rfWeight = optimizerConfig.config.rf_weight;
      adjustedEnsemble = gbPred * gbWeight + rfPred * rfWeight;
      gbContributions = gbResult.contributions;
      rfContributions = rfResult.contributions;
      modelVersion = "v2.1_optimized";
    } else {
      // ── Default path: full 19-factor model ──
      const baseEnsemble = computeEnsemblePrediction(enhancedFactors);
      const regimeWeights = getRegimeWeightAdjustments(
        enhancedFactors.sizeRegime,
        enhancedFactors.turnoverRegime
      );

      gbPred = baseEnsemble.gb;
      rfPred = baseEnsemble.rf;
      gbWeight = regimeWeights.gbWeight;
      rfWeight = regimeWeights.rfWeight;
      adjustedEnsemble = gbPred * gbWeight + rfPred * rfWeight;
      gbContributions = baseEnsemble.contributions.gb;
      rfContributions = baseEnsemble.contributions.rf;
      modelVersion = "v2.0_19factor_enhanced";
    }

    // 6. Compute feature importance
    const featureImportance = computeFeatureImportance(
      gbContributions,
      rfContributions
    );

    // 7. Compute percentiles with regime-adjusted volatility
    const percentiles = computePercentiles(
      adjustedEnsemble,
      enhancedFactors.vol1m,
      enhancedFactors.vol12m,
      enhancedFactors.sizeRegime
    );

    // 8. Compute confidence score
    const confidenceScore = computeConfidence(
      enhancedFactors,
      gbPred,
      rfPred
    );

    // 9. Build prediction object
    const predictionDate = rawFactors.date;
    const targetDate = new Date(predictionDate);
    targetDate.setMonth(targetDate.getMonth() + 1);
    const targetDateStr = targetDate.toISOString().split("T")[0];

    const prediction = {
      ticker: tickerUpper,
      prediction_date: predictionDate,
      target_date: targetDateStr,
      ensemble_prediction: adjustedEnsemble,
      gb_prediction: gbPred,
      rf_prediction: rfPred,
      percentiles,
      feature_importance: featureImportance,
      confidence_score: confidenceScore,
      methodology: {
        model_version: modelVersion,
        uses_interaction_terms: enhancedFactors.mom1m_x_nokvol !== null,
        uses_zscore_standardization: true,
        size_regime: enhancedFactors.sizeRegime,
        turnover_regime: enhancedFactors.turnoverRegime,
        ensemble_weights: { gb: gbWeight, rf: rfWeight },
        is_optimized: isOptimized,
        n_factors: isOptimized && optimizerConfig
          ? optimizerConfig.config.factors.length
          : 19,
        selected_factors: isOptimized && optimizerConfig
          ? optimizerConfig.config.factors
          : undefined,
      },
      factors_summary: {
        mom1m_z: enhancedFactors.mom1m_z,
        mom6m_z: enhancedFactors.mom6m_z,
        mom1m_x_nokvol: enhancedFactors.mom1m_x_nokvol,
        beta_z: enhancedFactors.beta_z,
        vol1m_z: enhancedFactors.vol1m_z,
        bm_z: enhancedFactors.bm_z,
        mktcap_z: enhancedFactors.mktcap_z,
      },
    };

    // 10. Store prediction in database
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
      modelVersion,
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
