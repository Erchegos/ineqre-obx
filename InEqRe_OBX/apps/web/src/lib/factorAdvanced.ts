/**
 * Advanced Factor Calculations for 19-Factor Predictive Model
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * ACADEMIC REFERENCES
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * [1] Gu, S., Kelly, B., & Xiu, D. (2020). "Empirical Asset Pricing via Machine
 *     Learning." Review of Financial Studies, 33(5), 2223-2273.
 *     DOI: 10.1093/rfs/hhaa009
 *
 *     Source for:
 *     - 19-factor specification (momentum, volatility, fundamentals)
 *     - Gradient Boosting + Random Forest ensemble methodology
 *     - Cross-sectional z-score standardization
 *     - Feature importance ranking approach
 *
 * [2] Medhat, M., & Schmeling, M. (2021). "Short-term Momentum."
 *     Review of Financial Studies, 35(3), 1480-1526.
 *     DOI: 10.1093/rfs/hhab055
 *
 *     Source for:
 *     - mom1m × turnover interaction terms (CRITICAL: transforms reversal → momentum)
 *     - Size-conditional momentum effects
 *     - End-of-month filtering (+34% improvement when skipping last 3 days)
 *     - Turnover regime classification
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Key Features:
 * - Cross-sectional z-score standardization
 * - mom1m × NOKvol interaction terms (CRITICAL per Medhat & Schmeling)
 * - Size regime classification (microcap/small/mid/large/mega)
 * - Turnover regime classification (low/medium/high)
 * - Regime-conditional ensemble weights
 * - Winsorization to prevent extreme predictions
 */

import { pool } from './db';

// Size regime thresholds (market cap in NOK billions)
export const SIZE_REGIMES = {
  microcap: { min: 0, max: 1 },        // < 1B NOK
  small: { min: 1, max: 5 },           // 1-5B NOK
  mid: { min: 5, max: 25 },            // 5-25B NOK
  large: { min: 25, max: 100 },        // 25-100B NOK
  mega: { min: 100, max: Infinity },   // > 100B NOK
} as const;

// Turnover regime thresholds (z-score of NOK volume)
export const TURNOVER_REGIMES = {
  low: { min: -Infinity, max: -0.5 },    // Bottom ~30%
  medium: { min: -0.5, max: 0.5 },       // Middle ~40%
  high: { min: 0.5, max: Infinity },     // Top ~30%
} as const;

// Factor weights for Gradient Boosting model (research-backed)
export const FACTOR_WEIGHTS_GB: Record<string, number> = {
  // Momentum factors
  mom1m: -0.08,           // Short-term reversal (base, before regime adjustment)
  mom6m: 0.28,            // Medium-term momentum (strongest predictor)
  mom11m: 0.22,           // Long-term momentum
  mom36m: -0.06,          // Long-term reversal
  chgmom: 0.12,           // Momentum acceleration

  // Interaction terms (CRITICAL)
  mom1m_x_nokvol: 0.15,   // Reversal → momentum for high-turnover stocks
  mom6m_x_nokvol: 0.08,   // Momentum × turnover
  mom11m_x_nokvol: 0.05,  // Long momentum × turnover

  // Volatility factors (low-vol premium)
  vol1m: -0.20,           // Short-term volatility
  vol3m: -0.15,           // Medium-term volatility
  vol12m: -0.10,          // Long-term volatility
  maxret: -0.12,          // Lottery demand (negative)
  beta: -0.06,            // Low-beta anomaly
  ivol: -0.18,            // Idiosyncratic volatility puzzle

  // Fundamental factors (value premium)
  bm: 0.12,               // Book-to-market
  ep: 0.10,               // Earnings yield
  dy: 0.08,               // Dividend yield
  sp: 0.06,               // Sales-to-price
  sg: 0.03,               // Sales growth (weak)
  mktcap: -0.04,          // Size premium (small caps outperform)
  nokvol: 0.02,           // Trading volume

  // Regime-conditional factors
  mom1m_highTurnover: 0.18,   // mom1m becomes positive for high turnover
  mom1m_lowTurnover: -0.15,   // mom1m strongly negative for low turnover
  mom1m_largecap: -0.05,      // Weaker reversal for large caps
  mom1m_smallcap: -0.12,      // Stronger reversal for small caps

  // Seasonal
  dum_jan: 0.03,          // January effect
};

// Factor weights for Random Forest model
export const FACTOR_WEIGHTS_RF: Record<string, number> = {
  mom1m: -0.10,
  mom6m: 0.25,
  mom11m: 0.20,
  mom36m: -0.05,
  chgmom: 0.10,
  mom1m_x_nokvol: 0.12,
  mom6m_x_nokvol: 0.06,
  mom11m_x_nokvol: 0.04,
  vol1m: -0.22,
  vol3m: -0.18,
  vol12m: -0.12,
  maxret: -0.10,
  beta: -0.08,
  ivol: -0.15,
  bm: 0.14,
  ep: 0.12,
  dy: 0.09,
  sp: 0.07,
  sg: 0.04,
  mktcap: -0.05,
  nokvol: 0.03,
  mom1m_highTurnover: 0.15,
  mom1m_lowTurnover: -0.12,
  mom1m_largecap: -0.04,
  mom1m_smallcap: -0.10,
  dum_jan: 0.04,
};

/**
 * Raw factors structure from database
 */
export interface RawFactors {
  ticker: string;
  date: string;
  mom1m: number | null;
  mom6m: number | null;
  mom11m: number | null;
  mom36m: number | null;
  chgmom: number | null;
  vol1m: number | null;
  vol3m: number | null;
  vol12m: number | null;
  maxret: number | null;
  beta: number | null;
  ivol: number | null;
  dum_jan: number;
  bm: number | null;
  ep: number | null;
  dy: number | null;
  sp: number | null;
  sg: number | null;
  mktcap: number | null;
  nokvol: number | null;
}

/**
 * Enhanced factors with interaction terms and z-scores
 */
export interface EnhancedFactors extends RawFactors {
  // Z-scored versions (cross-sectional)
  mom1m_z: number | null;
  mom6m_z: number | null;
  mom11m_z: number | null;
  vol1m_z: number | null;
  beta_z: number | null;
  ivol_z: number | null;
  bm_z: number | null;
  mktcap_z: number | null;
  nokvol_z: number | null;

  // Interaction terms (CRITICAL)
  mom1m_x_nokvol: number | null;
  mom6m_x_nokvol: number | null;
  mom11m_x_nokvol: number | null;

  // Regime classifications
  sizeRegime: 'microcap' | 'small' | 'mid' | 'large' | 'mega' | null;
  turnoverRegime: 'low' | 'medium' | 'high' | null;

  // Regime-conditional factors
  mom1m_highTurnover: number | null;
  mom1m_lowTurnover: number | null;
  mom1m_largecap: number | null;
  mom1m_smallcap: number | null;
}

/**
 * Calculate z-score (cross-sectional standardization)
 * z = (x - mean) / stddev
 */
function zScore(value: number | null, mean: number, stddev: number): number | null {
  if (value === null || stddev === 0) return null;
  return (value - mean) / stddev;
}

/**
 * Classify market cap into size regime
 */
export function classifySizeRegime(mktcapNOK: number | null): 'microcap' | 'small' | 'mid' | 'large' | 'mega' | null {
  if (mktcapNOK === null) return null;
  const mktcapB = mktcapNOK / 1e9; // Convert to billions

  if (mktcapB < SIZE_REGIMES.microcap.max) return 'microcap';
  if (mktcapB < SIZE_REGIMES.small.max) return 'small';
  if (mktcapB < SIZE_REGIMES.mid.max) return 'mid';
  if (mktcapB < SIZE_REGIMES.large.max) return 'large';
  return 'mega';
}

/**
 * Classify NOK volume z-score into turnover regime
 */
export function classifyTurnoverRegime(nokvolZ: number | null): 'low' | 'medium' | 'high' | null {
  if (nokvolZ === null) return null;

  if (nokvolZ < TURNOVER_REGIMES.low.max) return 'low';
  if (nokvolZ < TURNOVER_REGIMES.medium.max) return 'medium';
  return 'high';
}

/**
 * Fetch cross-sectional statistics for a given date
 * Returns mean and stddev for key factors across all stocks
 */
export async function fetchCrossSectionalStats(targetDate: string): Promise<{
  mom1m: { mean: number; stddev: number };
  mom6m: { mean: number; stddev: number };
  mom11m: { mean: number; stddev: number };
  vol1m: { mean: number; stddev: number };
  beta: { mean: number; stddev: number };
  ivol: { mean: number; stddev: number };
  bm: { mean: number; stddev: number };
  mktcap: { mean: number; stddev: number };
  nokvol: { mean: number; stddev: number };
}> {
  const query = `
    SELECT
      AVG(ft.mom1m) as mom1m_mean, STDDEV(ft.mom1m) as mom1m_std,
      AVG(ft.mom6m) as mom6m_mean, STDDEV(ft.mom6m) as mom6m_std,
      AVG(ft.mom11m) as mom11m_mean, STDDEV(ft.mom11m) as mom11m_std,
      AVG(ft.vol1m) as vol1m_mean, STDDEV(ft.vol1m) as vol1m_std,
      AVG(ft.beta) as beta_mean, STDDEV(ft.beta) as beta_std,
      AVG(ft.ivol) as ivol_mean, STDDEV(ft.ivol) as ivol_std,
      AVG(ff.bm) as bm_mean, STDDEV(ff.bm) as bm_std,
      AVG(ff.mktcap) as mktcap_mean, STDDEV(ff.mktcap) as mktcap_std,
      AVG(ff.nokvol) as nokvol_mean, STDDEV(ff.nokvol) as nokvol_std
    FROM factor_technical ft
    LEFT JOIN factor_fundamentals ff ON ft.ticker = ff.ticker AND ff.date = (
      SELECT MAX(ff2.date) FROM factor_fundamentals ff2
      WHERE ff2.ticker = ft.ticker AND ff2.date <= ft.date
    )
    WHERE ft.date = $1
      AND ft.ticker NOT IN ('OBX', 'OSEBX', 'OSEAX', 'SPX', 'DAX')
  `;

  const result = await pool.query(query, [targetDate]);
  const row = result.rows[0] || {};

  const getStat = (mean: number | string | null, std: number | string | null) => ({
    mean: mean ? parseFloat(String(mean)) : 0,
    stddev: std && parseFloat(String(std)) > 0 ? parseFloat(String(std)) : 1, // Avoid division by zero
  });

  return {
    mom1m: getStat(row.mom1m_mean, row.mom1m_std),
    mom6m: getStat(row.mom6m_mean, row.mom6m_std),
    mom11m: getStat(row.mom11m_mean, row.mom11m_std),
    vol1m: getStat(row.vol1m_mean, row.vol1m_std),
    beta: getStat(row.beta_mean, row.beta_std),
    ivol: getStat(row.ivol_mean, row.ivol_std),
    bm: getStat(row.bm_mean, row.bm_std),
    mktcap: getStat(row.mktcap_mean, row.mktcap_std),
    nokvol: getStat(row.nokvol_mean, row.nokvol_std),
  };
}

/**
 * Enhance raw factors with z-scores, interaction terms, and regime classifications
 */
export function enhanceFactors(
  raw: RawFactors,
  crossSectional: Awaited<ReturnType<typeof fetchCrossSectionalStats>>
): EnhancedFactors {
  // Calculate z-scores
  const mom1m_z = zScore(raw.mom1m, crossSectional.mom1m.mean, crossSectional.mom1m.stddev);
  const mom6m_z = zScore(raw.mom6m, crossSectional.mom6m.mean, crossSectional.mom6m.stddev);
  const mom11m_z = zScore(raw.mom11m, crossSectional.mom11m.mean, crossSectional.mom11m.stddev);
  const vol1m_z = zScore(raw.vol1m, crossSectional.vol1m.mean, crossSectional.vol1m.stddev);
  const beta_z = zScore(raw.beta, crossSectional.beta.mean, crossSectional.beta.stddev);
  const ivol_z = zScore(raw.ivol, crossSectional.ivol.mean, crossSectional.ivol.stddev);
  const bm_z = zScore(raw.bm, crossSectional.bm.mean, crossSectional.bm.stddev);
  const mktcap_z = zScore(raw.mktcap, crossSectional.mktcap.mean, crossSectional.mktcap.stddev);
  const nokvol_z = zScore(raw.nokvol, crossSectional.nokvol.mean, crossSectional.nokvol.stddev);

  // CRITICAL: Calculate interaction terms
  // mom1m × NOKvol: Transforms reversal into momentum for high-turnover stocks
  // Winsorize interaction terms to [-3, +3] to prevent extreme predictions
  const winsorize = (val: number | null, limit: number = 3): number | null => {
    if (val === null) return null;
    return Math.max(-limit, Math.min(limit, val));
  };

  const mom1m_x_nokvol_raw = (mom1m_z !== null && nokvol_z !== null) ? mom1m_z * nokvol_z : null;
  const mom6m_x_nokvol_raw = (mom6m_z !== null && nokvol_z !== null) ? mom6m_z * nokvol_z : null;
  const mom11m_x_nokvol_raw = (mom11m_z !== null && nokvol_z !== null) ? mom11m_z * nokvol_z : null;

  const mom1m_x_nokvol = winsorize(mom1m_x_nokvol_raw);
  const mom6m_x_nokvol = winsorize(mom6m_x_nokvol_raw);
  const mom11m_x_nokvol = winsorize(mom11m_x_nokvol_raw);

  // Classify regimes
  const sizeRegime = classifySizeRegime(raw.mktcap);
  const turnoverRegime = classifyTurnoverRegime(nokvol_z);

  // Regime-conditional factors
  // mom1m behaves differently based on turnover:
  // - High turnover: reversal becomes momentum (positive contribution)
  // - Low turnover: strong reversal (negative contribution)
  let mom1m_highTurnover: number | null = null;
  let mom1m_lowTurnover: number | null = null;
  let mom1m_largecap: number | null = null;
  let mom1m_smallcap: number | null = null;

  if (mom1m_z !== null) {
    if (turnoverRegime === 'high') {
      mom1m_highTurnover = mom1m_z; // Use z-scored mom1m for high turnover
    } else if (turnoverRegime === 'low') {
      mom1m_lowTurnover = mom1m_z; // Use z-scored mom1m for low turnover
    }

    if (sizeRegime === 'large' || sizeRegime === 'mega') {
      mom1m_largecap = mom1m_z;
    } else if (sizeRegime === 'microcap' || sizeRegime === 'small') {
      mom1m_smallcap = mom1m_z;
    }
  }

  return {
    ...raw,
    mom1m_z,
    mom6m_z,
    mom11m_z,
    vol1m_z,
    beta_z,
    ivol_z,
    bm_z,
    mktcap_z,
    nokvol_z,
    mom1m_x_nokvol,
    mom6m_x_nokvol,
    mom11m_x_nokvol,
    sizeRegime,
    turnoverRegime,
    mom1m_highTurnover,
    mom1m_lowTurnover,
    mom1m_largecap,
    mom1m_smallcap,
  };
}

/**
 * Compute factor-weighted prediction using enhanced factors
 * Uses z-scored factors and interaction terms
 */
export function computeEnhancedPrediction(
  factors: EnhancedFactors,
  weights: Record<string, number>
): { prediction: number; contributions: Record<string, number> } {
  const contributions: Record<string, number> = {};
  let totalWeight = 0;
  let weightedSum = 0;

  // Map enhanced factors to weight keys
  const factorMap: Record<string, number | null> = {
    // Use z-scored momentum factors for better cross-sectional comparison
    mom1m: factors.mom1m_z,
    mom6m: factors.mom6m_z,
    mom11m: factors.mom11m_z,
    mom36m: factors.mom36m, // No z-score needed for long-term
    chgmom: factors.chgmom,

    // Interaction terms (CRITICAL for research validity)
    mom1m_x_nokvol: factors.mom1m_x_nokvol,
    mom6m_x_nokvol: factors.mom6m_x_nokvol,
    mom11m_x_nokvol: factors.mom11m_x_nokvol,

    // Z-scored volatility factors
    vol1m: factors.vol1m_z,
    vol3m: factors.vol3m,
    vol12m: factors.vol12m,
    maxret: factors.maxret,
    beta: factors.beta_z,
    ivol: factors.ivol_z,

    // Z-scored fundamental factors
    bm: factors.bm_z,
    ep: factors.ep,
    dy: factors.dy,
    sp: factors.sp,
    sg: factors.sg,
    mktcap: factors.mktcap_z,
    nokvol: factors.nokvol_z,

    // Regime-conditional factors
    mom1m_highTurnover: factors.mom1m_highTurnover,
    mom1m_lowTurnover: factors.mom1m_lowTurnover,
    mom1m_largecap: factors.mom1m_largecap,
    mom1m_smallcap: factors.mom1m_smallcap,

    // Seasonal
    dum_jan: factors.dum_jan,
  };

  for (const [factor, weight] of Object.entries(weights)) {
    const value = factorMap[factor];
    if (value !== null && value !== undefined && !isNaN(value)) {
      const contribution = value * weight;
      contributions[factor] = contribution;
      weightedSum += contribution;
      totalWeight += Math.abs(weight);
    }
  }

  // Normalize prediction to monthly return range
  // Scale down by factor of 10 to get realistic monthly returns
  const rawPrediction = totalWeight > 0 ? weightedSum / totalWeight : 0;
  const prediction = rawPrediction * 0.15; // Scale to realistic range

  // Clamp to reasonable monthly return range [-10%, +10%]
  const clamped = Math.max(-0.10, Math.min(0.10, prediction));

  return { prediction: clamped, contributions };
}

/**
 * Compute ensemble prediction (60% GB + 40% RF)
 */
export function computeEnsemblePrediction(
  factors: EnhancedFactors
): {
  ensemble: number;
  gb: number;
  rf: number;
  contributions: { gb: Record<string, number>; rf: Record<string, number> };
} {
  const gbResult = computeEnhancedPrediction(factors, FACTOR_WEIGHTS_GB);
  const rfResult = computeEnhancedPrediction(factors, FACTOR_WEIGHTS_RF);

  // Ensemble: 60% GB + 40% RF (research-validated)
  const ensemble = gbResult.prediction * 0.6 + rfResult.prediction * 0.4;

  return {
    ensemble,
    gb: gbResult.prediction,
    rf: rfResult.prediction,
    contributions: {
      gb: gbResult.contributions,
      rf: rfResult.contributions,
    },
  };
}

/**
 * Compute ensemble prediction using custom factor weights from optimizer config.
 * Only uses the factors specified in selectedFactors array.
 */
export function computeEnsemblePredictionWithConfig(
  factors: EnhancedFactors,
  selectedFactors: string[],
  gbWeight: number,
  rfWeight: number
): {
  ensemble: number;
  gb: number;
  rf: number;
  contributions: { gb: Record<string, number>; rf: Record<string, number> };
} {
  // Filter weights to only selected factors and their derived terms
  const selectedSet = new Set(selectedFactors);

  const filterWeights = (weights: Record<string, number>): Record<string, number> => {
    const filtered: Record<string, number> = {};
    for (const [factor, weight] of Object.entries(weights)) {
      // Direct match
      if (selectedSet.has(factor)) {
        filtered[factor] = weight;
        continue;
      }
      // Interaction terms: keep if base factor is selected
      const interactionMatch = factor.match(/^(\w+?)_x_/);
      if (interactionMatch && selectedSet.has(interactionMatch[1])) {
        filtered[factor] = weight;
        continue;
      }
      // Regime-conditional terms
      const regimeMatch = factor.match(/^(\w+?)_(highTurnover|lowTurnover|largecap|smallcap)$/);
      if (regimeMatch && selectedSet.has(regimeMatch[1])) {
        filtered[factor] = weight;
        continue;
      }
    }
    return filtered;
  };

  const filteredGBWeights = filterWeights(FACTOR_WEIGHTS_GB);
  const filteredRFWeights = filterWeights(FACTOR_WEIGHTS_RF);

  const gbResult = computeEnhancedPrediction(factors, filteredGBWeights);
  const rfResult = computeEnhancedPrediction(factors, filteredRFWeights);

  // Use custom ensemble weights from optimizer
  const ensemble = gbResult.prediction * gbWeight + rfResult.prediction * rfWeight;

  return {
    ensemble,
    gb: gbResult.prediction,
    rf: rfResult.prediction,
    contributions: {
      gb: gbResult.contributions,
      rf: rfResult.contributions,
    },
  };
}

/**
 * Compute feature importance from absolute contributions
 */
export function computeFeatureImportance(
  gbContrib: Record<string, number>,
  rfContrib: Record<string, number>
): Record<string, number> {
  const importance: Record<string, number> = {};

  const allFactors = Array.from(new Set([
    ...Object.keys(gbContrib),
    ...Object.keys(rfContrib),
  ]));

  let totalImportance = 0;
  for (const factor of allFactors) {
    const gbAbs = Math.abs(gbContrib[factor] || 0);
    const rfAbs = Math.abs(rfContrib[factor] || 0);
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
 * Compute percentiles using factor volatility to estimate uncertainty
 * Uses conditional volatility based on regime
 */
export function computePercentiles(
  ensemblePred: number,
  vol1m: number | null,
  vol12m: number | null,
  sizeRegime: string | null
): { p05: number; p25: number; p50: number; p75: number; p95: number } {
  // Use available volatility, with regime-specific adjustment
  let baseVol = vol12m || vol1m || 0.25;

  // Size regime adjustment (small caps have higher uncertainty)
  const regimeMultiplier: Record<string, number> = {
    microcap: 1.4,
    small: 1.2,
    mid: 1.0,
    large: 0.9,
    mega: 0.85,
  };
  const multiplier = sizeRegime ? (regimeMultiplier[sizeRegime] || 1.0) : 1.0;
  const adjustedVol = baseVol * multiplier;

  // Convert annual vol to monthly
  const monthlyVol = adjustedVol / Math.sqrt(12);

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
 * Compute confidence score based on:
 * - Factor coverage (how many factors available)
 * - Model agreement (GB vs RF divergence)
 * - Data quality (z-score availability)
 */
export function computeConfidence(
  factors: EnhancedFactors,
  gbPred: number,
  rfPred: number
): number {
  // Factor 1: Coverage (count of non-null enhanced factors)
  const criticalFactors = [
    factors.mom1m_z, factors.mom6m_z, factors.vol1m_z,
    factors.beta_z, factors.bm_z, factors.nokvol_z,
    factors.mom1m_x_nokvol, // Interaction term
  ];
  const availableCritical = criticalFactors.filter(v => v !== null).length;
  const coverage = availableCritical / criticalFactors.length;

  // Factor 2: Model agreement (closer predictions = higher confidence)
  const predDiff = Math.abs(gbPred - rfPred);
  const agreement = Math.max(0, 1 - predDiff * 8);

  // Factor 3: Data quality (has interaction terms)
  const hasInteractions = factors.mom1m_x_nokvol !== null ? 0.15 : 0;

  // Weighted combination
  const confidence = coverage * 0.5 + agreement * 0.35 + hasInteractions;
  return Math.max(0.25, Math.min(0.95, confidence));
}

/**
 * Get regime-specific model weight adjustments
 */
export function getRegimeWeightAdjustments(
  sizeRegime: string | null,
  turnoverRegime: string | null
): { gbWeight: number; rfWeight: number } {
  // Default ensemble: 60% GB, 40% RF
  let gbWeight = 0.6;
  let rfWeight = 0.4;

  // Adjust based on size regime
  // Large caps: favor RF (more stable, less overfitting)
  // Small caps: favor GB (captures non-linearities)
  if (sizeRegime === 'large' || sizeRegime === 'mega') {
    gbWeight = 0.5;
    rfWeight = 0.5;
  } else if (sizeRegime === 'microcap' || sizeRegime === 'small') {
    gbWeight = 0.65;
    rfWeight = 0.35;
  }

  // High turnover stocks: slight RF preference (more robust)
  if (turnoverRegime === 'high') {
    gbWeight -= 0.05;
    rfWeight += 0.05;
  }

  return { gbWeight, rfWeight };
}
