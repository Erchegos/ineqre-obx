/**
 * Regime Classification Utility
 *
 * Single source of truth for volatility regime classification logic.
 * Used by both API and frontend components to ensure consistency.
 */

export type VolatilityRegime =
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
 * Classify volatility regime based on percentile and trend
 *
 * @param percentile Historical percentile (0-100)
 * @param trend Volatility trend direction
 * @returns VolatilityRegime classification
 */
export function classifyRegime(
  percentile: number,
  trend: VolatilityTrend
): VolatilityRegime {
  if (percentile > 85) {
    return "Extreme High";
  } else if (percentile >= 65) {
    return "Elevated";
  } else if (percentile >= 30) {
    return "Normal";
  } else {
    // Low volatility regimes
    if (trend === "Contracting") {
      return "Low & Contracting";
    } else {
      return "Low & Stable";
    }
  }
}

/**
 * Get color for a specific regime
 *
 * @param regime Volatility regime
 * @returns Hex color code
 */
export function getRegimeColor(regime: VolatilityRegime): string {
  const colorMap: Record<VolatilityRegime, string> = {
    "Extreme High": "#dc2626", // red-600
    Elevated: "#f97316", // orange-500
    Normal: "#6b7280", // gray-500
    "Low & Contracting": "#2563eb", // blue-600
    "Low & Stable": "#3b82f6", // blue-500
  };

  return colorMap[regime];
}

/**
 * Get background color with opacity for a regime
 *
 * @param regime Volatility regime
 * @param opacity Opacity value (0-1)
 * @returns RGBA color string
 */
export function getRegimeBackgroundColor(
  regime: VolatilityRegime,
  opacity: number = 0.05
): string {
  const color = getRegimeColor(regime);
  // Convert hex to RGB
  const r = parseInt(color.slice(1, 3), 16);
  const g = parseInt(color.slice(3, 5), 16);
  const b = parseInt(color.slice(5, 7), 16);

  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

/**
 * Get regime metadata (color, description)
 *
 * @param regime Volatility regime
 * @returns RegimeMetadata object
 */
export function getRegimeMetadata(regime: VolatilityRegime): RegimeMetadata {
  const descriptions: Record<VolatilityRegime, string> = {
    "Extreme High":
      "Volatility is at extreme levels, indicating high market stress or uncertainty. Large price swings are expected.",
    Elevated:
      "Volatility is elevated above historical norms. Price movements are likely to be larger than usual.",
    Normal:
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
 *
 * @param beta Market beta coefficient
 * @returns Driver classification
 */
export function getPrimaryDriver(beta: number | null): string {
  if (beta === null) {
    return "Unknown";
  }

  const absBeta = Math.abs(beta);
  if (absBeta < 0.2) {
    return "Idiosyncratic";
  } else if (absBeta < 0.6) {
    return "Mixed";
  } else {
    return "Market-Wide";
  }
}

/**
 * Get interpretation text for beta/correlation
 *
 * @param beta Market beta coefficient
 * @returns Interpretation string
 */
export function getBetaInterpretation(beta: number | null): string {
  if (beta === null) {
    return "Insufficient data to calculate market correlation";
  }

  const absBeta = Math.abs(beta);
  if (absBeta < 0.2) {
    return "Near-zero correlation indicates volatility moves independently of broad market";
  } else if (absBeta < 0.4) {
    return "Low correlation suggests limited systematic risk exposure";
  } else if (absBeta < 0.6) {
    return "Moderate correlation shows some market influence on volatility";
  } else if (absBeta < 0.8) {
    return "High correlation indicates volatility strongly tied to market movements";
  } else {
    return "Very high correlation shows volatility closely tracks market volatility";
  }
}

/**
 * Generate regime interpretation paragraph
 *
 * @param regime Volatility regime
 * @param percentile Historical percentile
 * @param trend Volatility trend
 * @param beta Market beta
 * @param ticker Stock ticker
 * @returns Interpretation paragraph
 */
export function getRegimeInterpretation(
  regime: VolatilityRegime,
  percentile: number,
  trend: VolatilityTrend,
  beta: number | null,
  ticker: string
): string {
  const driver = getPrimaryDriver(beta);
  const trendText =
    trend === "Expanding"
      ? "increasing"
      : trend === "Contracting"
      ? "decreasing"
      : "stable";

  let interpretation = `${ticker} is in a ${regime.toLowerCase()} regime (${Math.round(
    percentile
  )}th percentile historically) with ${trendText} volatility. `;

  if (driver === "Idiosyncratic") {
    interpretation +=
      "Company-specific factors are driving price action rather than systematic market risk. ";
  } else if (driver === "Market-Wide") {
    interpretation +=
      "Volatility is strongly influenced by broader market movements. ";
  } else {
    interpretation +=
      "Both company-specific and market-wide factors are influencing volatility. ";
  }

  // Add regime-specific guidance
  if (regime === "Extreme High") {
    interpretation +=
      "Expect large price swings and heightened uncertainty.";
  } else if (regime === "Elevated") {
    interpretation += "Price movements are likely to be larger than usual.";
  } else if (regime === "Normal") {
    interpretation += "Price behavior is typical for this security.";
  } else if (regime === "Low & Contracting") {
    interpretation +=
      "Market is becoming progressively calmer with smaller expected moves.";
  } else {
    interpretation += "Market conditions are calm and stable.";
  }

  return interpretation;
}

/**
 * Determine volatility trend by comparing short-term vs medium-term
 *
 * @param shortTerm Short-term volatility (e.g., 20-day)
 * @param mediumTerm Medium-term volatility (e.g., 60-day)
 * @param threshold Threshold for "Stable" classification (default 0.05 = 5%)
 * @returns VolatilityTrend
 */
export function determineVolatilityTrend(
  shortTerm: number | null,
  mediumTerm: number | null,
  threshold: number = 0.05
): VolatilityTrend {
  if (shortTerm === null || mediumTerm === null) {
    return "Stable";
  }

  const ratio = shortTerm / mediumTerm;

  if (ratio > 1 + threshold) {
    return "Expanding";
  } else if (ratio < 1 - threshold) {
    return "Contracting";
  } else {
    return "Stable";
  }
}
