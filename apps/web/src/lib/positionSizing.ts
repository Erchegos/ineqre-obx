/**
 * Position Sizing Library
 *
 * Implements Kelly-inspired position sizing with confidence and volatility adjustments.
 * Key principle: Size positions by conviction level and risk budget.
 *
 * Position weight = kellyFraction * confidenceFactor * volatilityAdjustment
 *
 * References:
 * - Kelly (1956): Optimal betting fraction
 * - Thorp (2006): Kelly Criterion in practice
 */

export interface PositionSizeParams {
  confidence: number;       // Model confidence score (0.25 to 0.95)
  prediction: number;       // Expected return (log return)
  volatility: number;       // Annualized volatility (e.g., vol12m)
  historicalWinRate?: number; // Historical hit rate (default 0.52)
  maxPositionPct?: number;  // Maximum position size (default 0.05 = 5%)
  targetPortfolioVol?: number; // Target portfolio volatility (default 0.15 = 15%)
}

export interface PositionSizeResult {
  rawKellyWeight: number;
  confidenceMultiplier: number;
  volatilityMultiplier: number;
  finalWeight: number;
  direction: 'LONG' | 'SHORT' | 'FLAT';
  rationale: string;
  riskMetrics: {
    positionContribution: number;  // Expected vol contribution
    kellyFraction: number;
    effectiveEdge: number;
  };
}

/**
 * Calculate optimal position size based on Kelly criterion + adjustments
 *
 * @param params Position sizing parameters
 * @returns Position size result with detailed breakdown
 */
export function calculatePositionSize(params: PositionSizeParams): PositionSizeResult {
  const {
    confidence,
    prediction,
    volatility,
    historicalWinRate = 0.52,
    maxPositionPct = 0.05,
    targetPortfolioVol = 0.15,
  } = params;

  // Handle edge cases
  if (volatility <= 0 || isNaN(volatility)) {
    return createFlatResult('Invalid volatility');
  }

  if (Math.abs(prediction) < 0.001) {
    return createFlatResult('Prediction near zero');
  }

  // 1. Calculate Kelly fraction
  // Kelly = (p * b - q) / b, where:
  // - p = win probability (historical hit rate)
  // - q = 1 - p (loss probability)
  // - b = odds ratio (expected gain / expected loss)

  // Simplified: use prediction magnitude as edge proxy
  const edge = Math.abs(prediction);

  // Assume symmetric payoff for simplicity (b = 1)
  // Kelly = 2p - 1 for fair-odds scenario
  // Adjust by edge magnitude
  const kellyFraction = (2 * historicalWinRate - 1) * (edge / volatility);

  // Apply fractional Kelly (half-Kelly is common in practice for safety)
  const rawKellyWeight = kellyFraction * 0.5;

  // 2. Confidence multiplier
  // Low confidence (0.25): 50% of Kelly
  // High confidence (0.95): 100% of Kelly
  // Linear interpolation: 0.5 + (conf - 0.25) * (0.5 / 0.7)
  const confidenceMultiplier = Math.max(0.3, Math.min(1.0,
    0.5 + (confidence - 0.25) * (0.5 / 0.7)
  ));

  // 3. Volatility adjustment
  // Scale down positions in high-vol stocks to maintain risk budget
  // If stock vol > target, scale down proportionally
  const volatilityMultiplier = Math.min(1.0, targetPortfolioVol / volatility);

  // 4. Combine adjustments
  let finalWeight = rawKellyWeight * confidenceMultiplier * volatilityMultiplier;

  // 5. Apply direction
  const direction: 'LONG' | 'SHORT' | 'FLAT' = prediction > 0 ? 'LONG' : prediction < 0 ? 'SHORT' : 'FLAT';
  finalWeight = Math.sign(prediction) * Math.abs(finalWeight);

  // 6. Cap at maximum position size
  finalWeight = Math.max(-maxPositionPct, Math.min(maxPositionPct, finalWeight));

  // Calculate risk metrics
  const positionContribution = Math.abs(finalWeight) * volatility;
  const effectiveEdge = edge * (historicalWinRate * 2 - 1);

  return {
    rawKellyWeight,
    confidenceMultiplier,
    volatilityMultiplier,
    finalWeight,
    direction,
    rationale: formatRationale(kellyFraction, confidenceMultiplier, volatilityMultiplier, finalWeight, confidence),
    riskMetrics: {
      positionContribution,
      kellyFraction,
      effectiveEdge,
    },
  };
}

/**
 * Create a flat (zero position) result
 */
function createFlatResult(reason: string): PositionSizeResult {
  return {
    rawKellyWeight: 0,
    confidenceMultiplier: 0,
    volatilityMultiplier: 0,
    finalWeight: 0,
    direction: 'FLAT',
    rationale: reason,
    riskMetrics: {
      positionContribution: 0,
      kellyFraction: 0,
      effectiveEdge: 0,
    },
  };
}

/**
 * Format human-readable rationale
 */
function formatRationale(
  kelly: number,
  confMult: number,
  volMult: number,
  final: number,
  confidence: number
): string {
  const confLevel = confidence >= 0.7 ? 'HIGH' : confidence >= 0.5 ? 'MEDIUM' : 'LOW';
  const volAdj = volMult < 0.8 ? 'vol-scaled down' : volMult < 1.0 ? 'slight vol adjustment' : 'full size';

  return `Kelly=${(kelly * 100).toFixed(1)}%, Conf=${confLevel}(${(confMult * 100).toFixed(0)}%), ${volAdj} -> ${(final * 100).toFixed(2)}%`;
}

/**
 * Normalize weights across a portfolio
 *
 * @param weights Array of position weights
 * @param maxGrossExposure Maximum total absolute weight (default 1.0)
 * @returns Normalized weights
 */
export function normalizePortfolioWeights(
  weights: number[],
  maxGrossExposure: number = 1.0
): number[] {
  const grossExposure = weights.reduce((sum, w) => sum + Math.abs(w), 0);

  if (grossExposure <= maxGrossExposure) {
    return weights;
  }

  const scaleFactor = maxGrossExposure / grossExposure;
  return weights.map(w => w * scaleFactor);
}

/**
 * Calculate portfolio-level metrics from position weights and expected returns
 */
export interface PortfolioMetrics {
  grossExposure: number;
  netExposure: number;
  longExposure: number;
  shortExposure: number;
  expectedReturn: number;
  expectedVolatility: number;
  expectedSharpe: number;
  herfindahlIndex: number;  // Concentration measure
  effectivePositions: number;
}

export function calculatePortfolioMetrics(
  weights: number[],
  expectedReturns: number[],
  volatilities: number[],
  riskFreeRate: number = 0.04
): PortfolioMetrics {
  if (weights.length !== expectedReturns.length || weights.length !== volatilities.length) {
    throw new Error('Arrays must have same length');
  }

  const n = weights.length;

  const grossExposure = weights.reduce((sum, w) => sum + Math.abs(w), 0);
  const netExposure = weights.reduce((sum, w) => sum + w, 0);
  const longExposure = weights.filter(w => w > 0).reduce((sum, w) => sum + w, 0);
  const shortExposure = weights.filter(w => w < 0).reduce((sum, w) => sum + Math.abs(w), 0);

  // Expected portfolio return
  const expectedReturn = weights.reduce((sum, w, i) => sum + w * expectedReturns[i], 0);

  // Expected portfolio volatility (simplified: assume zero correlation)
  // In practice, you'd use a covariance matrix
  const varianceContributions = weights.map((w, i) => Math.pow(w * volatilities[i], 2));
  const expectedVolatility = Math.sqrt(varianceContributions.reduce((sum, v) => sum + v, 0));

  // Expected Sharpe ratio
  const expectedSharpe = expectedVolatility > 0
    ? (expectedReturn - riskFreeRate / 12) / expectedVolatility  // Monthly
    : 0;

  // Herfindahl index (concentration)
  const squaredWeights = weights.map(w => Math.pow(w, 2));
  const herfindahlIndex = squaredWeights.reduce((sum, w) => sum + w, 0) /
    Math.pow(weights.reduce((sum, w) => sum + w, 0), 2);

  // Effective number of positions (inverse HHI)
  const effectivePositions = grossExposure > 0 ? 1 / herfindahlIndex : 0;

  return {
    grossExposure,
    netExposure,
    longExposure,
    shortExposure,
    expectedReturn,
    expectedVolatility,
    expectedSharpe,
    herfindahlIndex,
    effectivePositions,
  };
}

/**
 * Calculate turnover between two weight sets
 *
 * @param prevWeights Previous period weights
 * @param currWeights Current period weights
 * @returns One-way turnover (sum of absolute weight changes / 2)
 */
export function calculateTurnover(
  prevWeights: Map<string, number>,
  currWeights: Map<string, number>
): number {
  const allTickers = new Set([...prevWeights.keys(), ...currWeights.keys()]);
  let totalChange = 0;

  for (const ticker of allTickers) {
    const prev = prevWeights.get(ticker) || 0;
    const curr = currWeights.get(ticker) || 0;
    totalChange += Math.abs(curr - prev);
  }

  // One-way turnover = half of total weight change
  return totalChange / 2;
}
