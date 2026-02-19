/**
 * Regime Classification Utility
 *
 * Single source of truth for volatility regime classification logic.
 * Used by both API and frontend components to ensure consistency.
 *
 * 6-regime system with consistent colors across all pages:
 *   Crisis → Extreme High → Elevated → Normal → Low & Contracting → Low & Stable
 */

export type VolatilityRegime =
  | "Crisis"
  | "Extreme High"
  | "Elevated"
  | "Normal"
  | "Low & Contracting"
  | "Low & Stable";

export type VolatilityTrend = "Expanding" | "Contracting" | "Stable";

export interface RegimeMetadata {
  regime: VolatilityRegime;
  color: string;
  backgroundColor: string;
  description: string;
}

/**
 * Classify volatility regime based on percentile, trend, and optional vol ratio
 *
 * @param percentile Historical percentile (0-100)
 * @param trend Volatility trend direction
 * @param volRatio Optional 20d/60d vol ratio for Crisis detection
 * @returns VolatilityRegime classification
 */
export function classifyRegime(
  percentile: number,
  trend: VolatilityTrend,
  volRatio?: number
): VolatilityRegime {
  // Crisis: >95th percentile, OR >90th with rapid expansion (20d/60d > 1.5)
  if (percentile > 95) {
    return "Crisis";
  }
  if (percentile > 90 && trend === "Expanding" && volRatio && volRatio > 1.5) {
    return "Crisis";
  }
  if (percentile > 85) {
    return "Extreme High";
  } else if (percentile >= 65) {
    return "Elevated";
  } else if (percentile >= 30) {
    return "Normal";
  } else {
    if (trend === "Contracting") {
      return "Low & Contracting";
    } else {
      return "Low & Stable";
    }
  }
}

/**
 * Get accent color for a specific regime
 */
export function getRegimeColor(regime: VolatilityRegime): string {
  const colorMap: Record<VolatilityRegime, string> = {
    "Crisis": "#FF1744",
    "Extreme High": "#F44336",
    "Elevated": "#FF9800",
    "Normal": "#9E9E9E",
    "Low & Contracting": "#2196F3",
    "Low & Stable": "#4CAF50",
  };
  return colorMap[regime];
}

/**
 * Get background tint for regime (dark-mode compatible)
 */
export function getRegimeBackgroundTint(regime: VolatilityRegime): string {
  const tintMap: Record<VolatilityRegime, string> = {
    "Crisis": "rgba(183, 28, 28, 0.15)",
    "Extreme High": "rgba(244, 67, 54, 0.08)",
    "Elevated": "rgba(255, 152, 0, 0.08)",
    "Normal": "rgba(158, 158, 158, 0.05)",
    "Low & Contracting": "rgba(33, 150, 243, 0.08)",
    "Low & Stable": "rgba(76, 175, 80, 0.08)",
  };
  return tintMap[regime];
}

/**
 * Get background color with opacity for a regime
 */
export function getRegimeBackgroundColor(
  regime: VolatilityRegime,
  opacity: number = 0.05
): string {
  const color = getRegimeColor(regime);
  const r = parseInt(color.slice(1, 3), 16);
  const g = parseInt(color.slice(3, 5), 16);
  const b = parseInt(color.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

/**
 * Get regime metadata (color, description)
 */
export function getRegimeMetadata(regime: VolatilityRegime): RegimeMetadata {
  const descriptions: Record<VolatilityRegime, string> = {
    "Crisis":
      "Volatility has reached crisis levels indicating severe market stress, potential forced selling, or systemic risk. Extreme caution warranted. Expect violent price swings and liquidity deterioration.",
    "Extreme High":
      "Volatility is at extreme levels, indicating high market stress or uncertainty. Large price swings are expected.",
    "Elevated":
      "Volatility is elevated above historical norms. Price movements are likely to be larger than usual.",
    "Normal":
      "Volatility is within normal historical ranges. Price behavior is typical for this security.",
    "Low & Contracting":
      "Volatility is low and decreasing. Market is becoming calmer with smaller expected price movements.",
    "Low & Stable":
      "Volatility is low and stable. Market conditions are calm with small expected price movements.",
  };

  return {
    regime,
    color: getRegimeColor(regime),
    backgroundColor: getRegimeBackgroundColor(regime),
    description: descriptions[regime],
  };
}

/**
 * Determine primary volatility driver based on beta
 */
export function getPrimaryDriver(beta: number | null): string {
  if (beta === null) return "Unknown";
  const absBeta = Math.abs(beta);
  if (absBeta < 0.2) return "Idiosyncratic";
  if (absBeta < 0.6) return "Mixed";
  return "Market-Wide";
}

/**
 * Get interpretation text for beta/correlation
 */
export function getBetaInterpretation(beta: number | null): string {
  if (beta === null) return "Insufficient data to calculate market correlation";
  const absBeta = Math.abs(beta);
  if (absBeta < 0.2) return "Near-zero correlation indicates volatility moves independently of broad market";
  if (absBeta < 0.4) return "Low correlation suggests limited systematic risk exposure";
  if (absBeta < 0.6) return "Moderate correlation shows some market influence on volatility";
  if (absBeta < 0.8) return "High correlation indicates volatility strongly tied to market movements";
  return "Very high correlation shows volatility closely tracks market volatility";
}

/**
 * Generate regime interpretation paragraph
 */
export function getRegimeInterpretation(
  regime: VolatilityRegime,
  percentile: number,
  trend: VolatilityTrend,
  beta: number | null,
  ticker: string
): string {
  const driver = getPrimaryDriver(beta);
  const trendText = trend === "Expanding" ? "increasing" : trend === "Contracting" ? "decreasing" : "stable";

  let interpretation = `${ticker} is in a ${regime.toLowerCase()} regime (${Math.round(percentile)}th percentile historically) with ${trendText} volatility. `;

  if (driver === "Idiosyncratic") {
    interpretation += "Company-specific factors are driving price action rather than systematic market risk. ";
  } else if (driver === "Market-Wide") {
    interpretation += "Volatility is strongly influenced by broader market movements. ";
  } else {
    interpretation += "Both company-specific and market-wide factors are influencing volatility. ";
  }

  if (regime === "Crisis") {
    interpretation += "Expect violent price swings, liquidity deterioration, and potential correlation breakdown. Capital preservation is priority.";
  } else if (regime === "Extreme High") {
    interpretation += "Expect large price swings and heightened uncertainty.";
  } else if (regime === "Elevated") {
    interpretation += "Price movements are likely to be larger than usual.";
  } else if (regime === "Normal") {
    interpretation += "Price behavior is typical for this security.";
  } else if (regime === "Low & Contracting") {
    interpretation += "Market is becoming progressively calmer with smaller expected moves.";
  } else {
    interpretation += "Market conditions are calm and stable.";
  }

  return interpretation;
}

/**
 * Determine volatility trend by comparing short-term vs medium-term
 */
export function determineVolatilityTrend(
  shortTerm: number | null,
  mediumTerm: number | null,
  threshold: number = 0.05
): VolatilityTrend {
  if (shortTerm === null || mediumTerm === null) return "Stable";
  const ratio = shortTerm / mediumTerm;
  if (ratio > 1 + threshold) return "Expanding";
  if (ratio < 1 - threshold) return "Contracting";
  return "Stable";
}

/** All 6 regimes in severity order (highest to lowest) */
export const ALL_REGIMES: VolatilityRegime[] = [
  "Crisis",
  "Extreme High",
  "Elevated",
  "Normal",
  "Low & Contracting",
  "Low & Stable",
];
