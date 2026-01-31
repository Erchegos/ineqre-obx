/**
 * Liquidity Regime Detection
 *
 * Classifies stocks into liquidity regimes based on trading volume patterns.
 * Answers the critical trader question: "Can I actually trade this?"
 *
 * Critical for practical credibility with Oslo Børs traders.
 */

export interface VolumeData {
  date: string;
  volume: number;
  close: number;
}

export interface LiquidityMetrics {
  regime: 'Highly Liquid' | 'Liquid' | 'Moderate' | 'Illiquid' | 'Very Illiquid';
  volumePercentile: number;
  avgDailyVolume: number;
  avgDailyValue: number; // Volume * Price
  currency: 'NOK' | 'USD' | 'EUR' | 'GBP';
  recentTrend: 'Improving' | 'Stable' | 'Deteriorating';
  warnings: string[];
  tradingImplications: string[];
}

/**
 * Calculate volume percentiles
 */
function calculatePercentile(values: number[], percentile: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((percentile / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

/**
 * Detect currency from ticker
 */
function detectCurrency(ticker: string): 'NOK' | 'USD' | 'EUR' | 'GBP' {
  if (ticker.endsWith('.US')) return 'USD';
  if (ticker.endsWith('.L')) return 'GBP';
  if (ticker.endsWith('.PA') || ticker.endsWith('.AS') || ticker.endsWith('.MI')) return 'EUR';
  return 'NOK'; // Default to NOK for Oslo Børs
}

/**
 * Detect liquidity regime based on volume analysis
 */
export function detectLiquidityRegime(
  volumeData: VolumeData[],
  ticker: string,
  lookbackDays: number = 60
): LiquidityMetrics | null {
  if (volumeData.length < 30) {
    return null;
  }

  // Use most recent data up to lookback period
  const recentData = volumeData.slice(-lookbackDays);

  // Calculate average daily volume
  const avgDailyVolume = recentData.reduce((sum, d) => sum + d.volume, 0) / recentData.length;

  // Calculate average daily value (volume * price in NOK)
  const avgDailyValue = recentData.reduce((sum, d) => sum + (d.volume * d.close), 0) / recentData.length;

  // Calculate volume percentiles across the dataset
  const allVolumes = recentData.map(d => d.volume);
  const p25 = calculatePercentile(allVolumes, 25);
  const p50 = calculatePercentile(allVolumes, 50);
  const p75 = calculatePercentile(allVolumes, 75);

  // Recent volume (last 10 days)
  const recentVolumes = recentData.slice(-10).map(d => d.volume);
  const recentAvgVolume = recentVolumes.reduce((a, b) => a + b, 0) / recentVolumes.length;

  // Determine volume percentile of recent average
  const volumePercentile = (allVolumes.filter(v => v <= recentAvgVolume).length / allVolumes.length) * 100;

  // Detect trend (comparing recent 10 days vs previous 20 days)
  const previousData = recentData.slice(-30, -10);
  const previousAvgVolume = previousData.length > 0
    ? previousData.reduce((sum, d) => sum + d.volume, 0) / previousData.length
    : avgDailyVolume;

  const volumeChange = (recentAvgVolume - previousAvgVolume) / previousAvgVolume;

  let recentTrend: 'Improving' | 'Stable' | 'Deteriorating';
  if (volumeChange > 0.15) {
    recentTrend = 'Improving';
  } else if (volumeChange < -0.15) {
    recentTrend = 'Deteriorating';
  } else {
    recentTrend = 'Stable';
  }

  // Detect currency and adjust thresholds
  const currency = detectCurrency(ticker);
  const currencyMultiplier = currency === 'USD' ? 0.1 : 1; // USD is ~10x NOK

  // Classify regime based on average daily value and volume consistency
  let regime: 'Highly Liquid' | 'Liquid' | 'Moderate' | 'Illiquid' | 'Very Illiquid';
  const warnings: string[] = [];
  const tradingImplications: string[] = [];

  // Classification criteria (adjusted by currency)
  const threshold1 = 10_000_000 * currencyMultiplier; // 10M NOK or 1M USD
  const threshold2 = 2_000_000 * currencyMultiplier;  // 2M NOK or 200K USD
  const threshold3 = 500_000 * currencyMultiplier;    // 500K NOK or 50K USD
  const threshold4 = 100_000 * currencyMultiplier;    // 100K NOK or 10K USD

  if (avgDailyValue >= threshold1) {
    regime = 'Highly Liquid';
    tradingImplications.push('Suitable for large institutional orders');
    tradingImplications.push('Low market impact expected');
  } else if (avgDailyValue >= threshold2) {
    regime = 'Liquid';
    tradingImplications.push('Suitable for most institutional orders');
    tradingImplications.push('Moderate market impact on large trades');
  } else if (avgDailyValue >= threshold3) {
    regime = 'Moderate';
    tradingImplications.push('Suitable for small to medium orders');
    tradingImplications.push('Consider VWAP execution for larger trades');
    warnings.push('Limited capacity for large institutional trades');
  } else if (avgDailyValue >= threshold4) {
    regime = 'Illiquid';
    tradingImplications.push('Limit order sizes to avoid market impact');
    tradingImplications.push('Spread trading over multiple days');
    warnings.push('High market impact risk on medium-sized orders');
    warnings.push('Wide bid-ask spreads likely');
  } else {
    regime = 'Very Illiquid';
    tradingImplications.push('Extremely limited trading capacity');
    tradingImplications.push('Consider alternative execution venues');
    warnings.push('CRITICAL: Very high market impact risk');
    warnings.push('May be difficult to exit positions');
    warnings.push('Not suitable for institutional trading');
  }

  // Additional warnings based on trend
  if (recentTrend === 'Deteriorating' && regime !== 'Highly Liquid') {
    warnings.push(`Volume trending down (-${Math.abs(volumeChange * 100).toFixed(0)}%)`);
  }

  // Warning for low recent volume percentile
  if (volumePercentile < 25 && regime !== 'Very Illiquid') {
    warnings.push('Recent volume below 25th percentile');
  }

  return {
    regime,
    volumePercentile,
    avgDailyVolume,
    avgDailyValue,
    currency,
    recentTrend,
    warnings,
    tradingImplications,
  };
}

/**
 * Get regime color for UI display
 */
export function getRegimeColor(regime: LiquidityMetrics['regime']): string {
  switch (regime) {
    case 'Highly Liquid':
      return '#10b981'; // green
    case 'Liquid':
      return '#22c55e'; // light green
    case 'Moderate':
      return '#f59e0b'; // amber
    case 'Illiquid':
      return '#ef4444'; // red
    case 'Very Illiquid':
      return '#991b1b'; // dark red
  }
}

/**
 * Get regime icon/indicator
 */
export function getRegimeIndicator(regime: LiquidityMetrics['regime']): string {
  switch (regime) {
    case 'Highly Liquid':
      return '●●●';
    case 'Liquid':
      return '●●○';
    case 'Moderate':
      return '●○○';
    case 'Illiquid':
      return '▲';
    case 'Very Illiquid':
      return '⚠';
  }
}

/**
 * Format liquidity metrics for display
 */
export function formatLiquidityDisplay(metrics: LiquidityMetrics): {
  badge: string;
  detail: string;
  color: string;
} {
  const valueInMillions = (metrics.avgDailyValue / 1_000_000).toFixed(1);
  const volumeFormatted = metrics.avgDailyVolume >= 1_000_000
    ? `${(metrics.avgDailyVolume / 1_000_000).toFixed(1)}M`
    : `${(metrics.avgDailyVolume / 1_000).toFixed(0)}K`;

  return {
    badge: `${getRegimeIndicator(metrics.regime)} ${metrics.regime}`,
    detail: `Avg Daily: ${volumeFormatted} shares (${valueInMillions}M ${metrics.currency}) • Trend: ${metrics.recentTrend}`,
    color: getRegimeColor(metrics.regime),
  };
}
