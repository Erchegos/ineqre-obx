/**
 * Risk Management Module
 *
 * Implements drawdown protection via:
 * 1. Volatility regime detection (reuses regimeClassification.ts)
 * 2. Dynamic exposure scaling
 * 3. Portfolio-level stop rules
 *
 * Key principle: Reduce exposure during market stress to limit drawdowns.
 */

import {
  VolatilityRegime,
  VolatilityTrend,
  classifyRegime,
  determineVolatilityTrend,
  getRegimeColor,
} from './regimeClassification';

// ============================================================================
// Types
// ============================================================================

export interface MarketVolatilityData {
  rolling20: number;       // 20-day rolling volatility
  rolling60: number;       // 60-day rolling volatility
  percentile: number;      // Historical percentile (0-100)
}

export interface RiskState {
  regime: VolatilityRegime;
  trend: VolatilityTrend;
  exposureMultiplier: number;
  isRiskOff: boolean;
  drawdownFromPeak: number;
  reason: string;
  recommendations: string[];
}

export interface DrawdownProtectionParams {
  maxDrawdownThreshold?: number;   // Trigger level (default -0.10 = -10%)
  graduatedDerisking?: boolean;    // Apply graduated scaling (default true)
  allowShort?: boolean;            // Allow short positions in risk-off (default false)
}

// ============================================================================
// Exposure Scaling by Regime
// ============================================================================

/**
 * Exposure multipliers by volatility regime
 *
 * - Extreme High: Market stress - reduce to 25% exposure
 * - Elevated: Heightened risk - reduce to 50% exposure
 * - Normal: Full exposure
 * - Low & Contracting/Stable: Calm markets - full exposure
 */
export const REGIME_EXPOSURE_SCALE: Record<VolatilityRegime, number> = {
  'Crisis': 0.10,
  'Extreme High': 0.25,
  'Elevated': 0.50,
  'Normal': 1.00,
  'Low & Contracting': 1.00,
  'Low & Stable': 1.00,
};

/**
 * Get regime-based exposure recommendation
 */
export function getRegimeExposure(regime: VolatilityRegime): number {
  return REGIME_EXPOSURE_SCALE[regime];
}

// ============================================================================
// Risk State Calculation
// ============================================================================

/**
 * Calculate current risk state based on market volatility and portfolio performance
 *
 * @param marketVol Current market volatility metrics
 * @param portfolioEquity Array of portfolio equity values (cumulative)
 * @param params Protection parameters
 * @returns Current risk state with exposure recommendation
 */
export function calculateRiskState(
  marketVol: MarketVolatilityData,
  portfolioEquity: number[],
  params: DrawdownProtectionParams = {}
): RiskState {
  const {
    maxDrawdownThreshold = -0.10,
    graduatedDerisking = true,
  } = params;

  // 1. Classify current volatility regime
  const trend = determineVolatilityTrend(marketVol.rolling20, marketVol.rolling60);
  const regime = classifyRegime(marketVol.percentile, trend);

  // 2. Calculate current drawdown from peak
  let drawdownFromPeak = 0;
  if (portfolioEquity.length > 0) {
    const peak = Math.max(...portfolioEquity);
    const current = portfolioEquity[portfolioEquity.length - 1];
    drawdownFromPeak = peak > 0 ? (current - peak) / peak : 0;
  }

  // 3. Base exposure from regime
  let exposureMultiplier = REGIME_EXPOSURE_SCALE[regime];
  const reasons: string[] = [`Regime: ${regime}`];
  const recommendations: string[] = [];

  // 4. Graduated de-risking based on drawdown
  if (graduatedDerisking && drawdownFromPeak < 0) {
    if (drawdownFromPeak < -0.15) {
      // Severe drawdown: cut to 25%
      exposureMultiplier = Math.min(exposureMultiplier, 0.25);
      reasons.push(`DD=${(drawdownFromPeak * 100).toFixed(1)}% [SEVERE]`);
      recommendations.push('Consider raising cash or hedging');
    } else if (drawdownFromPeak < maxDrawdownThreshold) {
      // Moderate-to-high drawdown: cut to 50%
      exposureMultiplier *= 0.50;
      reasons.push(`DD=${(drawdownFromPeak * 100).toFixed(1)}% [RISK-OFF]`);
      recommendations.push('Reduce position sizes');
    } else if (drawdownFromPeak < -0.05) {
      // Small drawdown: scale to 75%
      exposureMultiplier *= 0.75;
      reasons.push(`DD=${(drawdownFromPeak * 100).toFixed(1)}%`);
      recommendations.push('Monitor positions closely');
    }
  }

  // 5. Floor exposure at 10% (don't go completely to cash)
  exposureMultiplier = Math.max(0.10, exposureMultiplier);

  // 6. Determine risk-off status
  const isRiskOff = drawdownFromPeak < maxDrawdownThreshold || regime === 'Extreme High';

  // 7. Add regime-specific recommendations
  if (regime === 'Extreme High') {
    recommendations.push('Extreme volatility - consider defensive positioning');
  } else if (regime === 'Elevated') {
    recommendations.push('Elevated volatility - tighten stop losses');
  } else if (regime === 'Low & Contracting') {
    recommendations.push('Calm markets - favorable for trend following');
  }

  return {
    regime,
    trend,
    exposureMultiplier,
    isRiskOff,
    drawdownFromPeak,
    reason: reasons.join(', '),
    recommendations,
  };
}

// ============================================================================
// Portfolio Stop-Loss Evaluation
// ============================================================================

export interface StopLossResult {
  shouldStop: boolean;
  currentDrawdown: number;
  peakValue: number;
  troughValue: number;
  recoveryNeeded: number;  // % gain needed to recover to peak
  daysSincePeak: number;
}

/**
 * Evaluate portfolio-level stop-loss
 *
 * @param returns Array of periodic returns
 * @param stopLossLevel Stop-loss threshold (default -0.15 = -15%)
 * @returns Stop-loss evaluation result
 */
export function evaluatePortfolioStop(
  returns: number[],
  stopLossLevel: number = -0.15
): StopLossResult {
  if (returns.length === 0) {
    return {
      shouldStop: false,
      currentDrawdown: 0,
      peakValue: 1,
      troughValue: 1,
      recoveryNeeded: 0,
      daysSincePeak: 0,
    };
  }

  let peak = 1.0;
  let peakIndex = 0;
  let currentValue = 1.0;
  let trough = 1.0;

  for (let i = 0; i < returns.length; i++) {
    currentValue *= (1 + returns[i]);

    if (currentValue > peak) {
      peak = currentValue;
      peakIndex = i;
    }

    trough = Math.min(trough, currentValue);
  }

  const currentDrawdown = (currentValue - peak) / peak;
  const recoveryNeeded = currentDrawdown < 0 ? (peak / currentValue - 1) : 0;
  const daysSincePeak = returns.length - peakIndex - 1;

  return {
    shouldStop: currentDrawdown < stopLossLevel,
    currentDrawdown,
    peakValue: peak,
    troughValue: trough,
    recoveryNeeded,
    daysSincePeak,
  };
}

// ============================================================================
// Position-Level Risk Controls
// ============================================================================

export interface PositionRiskLimits {
  maxPositionSize: number;      // Max single position (% of portfolio)
  maxSectorExposure: number;    // Max sector exposure (% of portfolio)
  maxCorrelatedGroup: number;   // Max correlated group exposure
  minDiversification: number;   // Minimum effective positions
}

export const DEFAULT_RISK_LIMITS: PositionRiskLimits = {
  maxPositionSize: 0.05,        // 5% max per position
  maxSectorExposure: 0.25,      // 25% max per sector
  maxCorrelatedGroup: 0.30,     // 30% max for correlated group
  minDiversification: 10,       // At least 10 effective positions
};

/**
 * Check if a position violates risk limits
 */
export function checkPositionRiskLimits(
  proposedWeight: number,
  currentSectorExposure: number,
  limits: PositionRiskLimits = DEFAULT_RISK_LIMITS
): {
  allowed: boolean;
  adjustedWeight: number;
  violations: string[];
} {
  const violations: string[] = [];
  let adjustedWeight = proposedWeight;

  // Check max position size
  if (Math.abs(proposedWeight) > limits.maxPositionSize) {
    violations.push(`Position size ${(proposedWeight * 100).toFixed(1)}% exceeds max ${(limits.maxPositionSize * 100).toFixed(0)}%`);
    adjustedWeight = Math.sign(proposedWeight) * limits.maxPositionSize;
  }

  // Check sector exposure
  const newSectorExposure = currentSectorExposure + Math.abs(proposedWeight);
  if (newSectorExposure > limits.maxSectorExposure) {
    const maxAllowed = limits.maxSectorExposure - currentSectorExposure;
    if (maxAllowed > 0) {
      violations.push(`Sector exposure would exceed ${(limits.maxSectorExposure * 100).toFixed(0)}%`);
      adjustedWeight = Math.sign(proposedWeight) * Math.min(Math.abs(adjustedWeight), maxAllowed);
    } else {
      violations.push(`Sector at max exposure`);
      adjustedWeight = 0;
    }
  }

  return {
    allowed: violations.length === 0,
    adjustedWeight,
    violations,
  };
}

// ============================================================================
// Regime-Adjusted Strategy Parameters
// ============================================================================

export interface StrategyParameters {
  exposureMultiplier: number;
  stopLossDistance: number;      // % below entry for stop
  takeProfitDistance: number;    // % above entry for take profit
  maxHoldingPeriod: number;      // Days before forced exit
  minConfidenceThreshold: number; // Minimum confidence to trade
}

/**
 * Get strategy parameters adjusted for current regime
 */
export function getRegimeAdjustedParameters(
  regime: VolatilityRegime,
  baseParams: Partial<StrategyParameters> = {}
): StrategyParameters {
  const base: StrategyParameters = {
    exposureMultiplier: 1.0,
    stopLossDistance: 0.05,
    takeProfitDistance: 0.10,
    maxHoldingPeriod: 21,
    minConfidenceThreshold: 0.5,
    ...baseParams,
  };

  switch (regime) {
    case 'Extreme High':
      return {
        exposureMultiplier: 0.25,
        stopLossDistance: base.stopLossDistance * 0.5,  // Tighter stops
        takeProfitDistance: base.takeProfitDistance * 0.5,  // Take profits quicker
        maxHoldingPeriod: Math.round(base.maxHoldingPeriod * 0.5),
        minConfidenceThreshold: 0.7,  // Higher bar to trade
      };

    case 'Elevated':
      return {
        exposureMultiplier: 0.50,
        stopLossDistance: base.stopLossDistance * 0.75,
        takeProfitDistance: base.takeProfitDistance * 0.75,
        maxHoldingPeriod: Math.round(base.maxHoldingPeriod * 0.75),
        minConfidenceThreshold: 0.6,
      };

    case 'Normal':
      return base;

    case 'Low & Contracting':
    case 'Low & Stable':
      return {
        exposureMultiplier: 1.0,
        stopLossDistance: base.stopLossDistance * 1.25,  // Wider stops in calm markets
        takeProfitDistance: base.takeProfitDistance * 1.25,  // Let winners run
        maxHoldingPeriod: Math.round(base.maxHoldingPeriod * 1.25),
        minConfidenceThreshold: 0.45,  // Can trade lower confidence
      };

    default:
      return base;
  }
}

// ============================================================================
// Risk State Display Helpers
// ============================================================================

export interface RiskStateDisplay {
  regime: VolatilityRegime;
  color: string;
  exposurePct: string;
  statusText: string;
  icon: string;
}

export function formatRiskStateForDisplay(state: RiskState): RiskStateDisplay {
  const exposurePct = `${(state.exposureMultiplier * 100).toFixed(0)}%`;

  let statusText: string;
  let icon: string;

  if (state.isRiskOff) {
    statusText = 'RISK-OFF';
    icon = '⚠️';
  } else if (state.exposureMultiplier < 0.5) {
    statusText = 'DEFENSIVE';
    icon = '🛡️';
  } else if (state.exposureMultiplier < 1.0) {
    statusText = 'CAUTIOUS';
    icon = '👀';
  } else {
    statusText = 'NORMAL';
    icon = '✓';
  }

  return {
    regime: state.regime,
    color: getRegimeColor(state.regime),
    exposurePct,
    statusText,
    icon,
  };
}
