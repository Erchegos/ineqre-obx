/**
 * Standard Deviation Channel Calculations
 *
 * Based on linear regression with standard deviation bands.
 * Algorithm ported from /Users/olaslettebak/backtest-lab/scan_eodhd_daily.py
 */

export type StdChannelResult = {
  slope: number;
  intercept: number;
  sigma: number; // Standard deviation
  r: number; // Correlation coefficient
  r2: number; // R-squared
  midLine: number[]; // Regression line values
  upperBand: number[]; // +k*sigma band
  lowerBand: number[]; // -k*sigma band
};

/**
 * Calculate standard deviation channel for a price series
 *
 * @param prices - Array of close prices
 * @param k - Multiplier for standard deviation bands (typically 2.0)
 * @returns StdChannelResult with regression line and bands
 */
export function calculateStdChannel(
  prices: number[],
  k: number = 2.0
): StdChannelResult {
  const n = prices.length;

  if (n < 2) {
    throw new Error('Need at least 2 data points for regression');
  }

  // Create x values (0, 1, 2, ...)
  const x = Array.from({ length: n }, (_, i) => i);

  // Calculate means
  const xMean = x.reduce((sum, val) => sum + val, 0) / n;
  const yMean = prices.reduce((sum, val) => sum + val, 0) / n;

  // Calculate covariance and variance
  let covXY = 0;
  let varX = 0;

  for (let i = 0; i < n; i++) {
    const xDev = x[i] - xMean;
    const yDev = prices[i] - yMean;
    covXY += xDev * yDev;
    varX += xDev * xDev;
  }

  covXY /= (n - 1);
  varX /= (n - 1);

  // Calculate slope and intercept
  const slope = varX !== 0 ? covXY / varX : 0;
  const intercept = yMean - slope * xMean;

  // Calculate fitted values (regression line)
  const yHat = x.map(xi => slope * xi + intercept);

  // Calculate residuals and standard deviation
  const residuals = prices.map((yi, i) => yi - yHat[i]);
  const sumSquaredResiduals = residuals.reduce((sum, r) => sum + r * r, 0);
  const sigma = n > 2 ? Math.sqrt(sumSquaredResiduals / (n - 1)) : 0;

  // Calculate correlation coefficient (R)
  const stdX = Math.sqrt(varX);
  const varY = prices.reduce((sum, val) => sum + Math.pow(val - yMean, 2), 0) / (n - 1);
  const stdY = Math.sqrt(varY);
  const r = (stdX !== 0 && stdY !== 0) ? covXY / (stdX * stdY) : 0;
  const r2 = r * r;

  // Calculate bands
  const upperBand = yHat.map(y => y + k * sigma);
  const lowerBand = yHat.map(y => y - k * sigma);

  return {
    slope,
    intercept,
    sigma,
    r,
    r2,
    midLine: yHat,
    upperBand,
    lowerBand,
  };
}

/**
 * Find optimal window size for STD channel
 * Scans multiple window sizes and returns the one with highest R² (best correlation)
 *
 * @param prices - Full price series
 * @param minWindow - Minimum window size (e.g., 255 = ~1 year)
 * @param maxWindow - Maximum window size (e.g., 1530 = ~6 years)
 * @param step - Step size for scanning (e.g., 20)
 * @param k - Standard deviation multiplier
 * @returns Object with best window size and its channel data
 */
export function findOptimalWindow(
  prices: number[],
  minWindow: number = 200,
  maxWindow: number = 1200,
  step: number = 20,
  k: number = 2.0
): { windowSize: number; channel: StdChannelResult; score: number } {
  let bestScore = -Infinity;
  let bestWindow = minWindow;
  let bestChannel: StdChannelResult | null = null;

  // Respect user's explicit minWindow setting - don't override it
  const effectiveMinWindow = Math.max(minWindow, 2); // Just ensure minimum 2 points
  const effectiveMaxWindow = Math.min(maxWindow, prices.length);

  for (let w = effectiveMinWindow; w <= effectiveMaxWindow; w += step) {
    // Use last w prices
    const window = prices.slice(-w);

    try {
      const channel = calculateStdChannel(window, k);

      // Score: Simply use R² (highest correlation = best fit)
      // We want the window size that gives the BEST R² value
      const score = channel.r2;

      if (score > bestScore) {
        bestScore = score;
        bestWindow = w;
        bestChannel = channel;
      }
    } catch (e) {
      // Skip windows that fail
      continue;
    }
  }

  if (!bestChannel) {
    // Fallback: use user's minWindow or all available data
    const fallbackWindow = Math.min(minWindow, prices.length);
    const window = prices.slice(-fallbackWindow);
    const channel = calculateStdChannel(window, k);
    return {
      windowSize: fallbackWindow,
      channel,
      score: channel.r2,
    };
  }

  return {
    windowSize: bestWindow,
    channel: bestChannel,
    score: bestScore,
  };
}

/**
 * Apply STD channel to OHLC data
 * Returns data ready for chart rendering
 */
export function applyStdChannelToOHLC(
  data: Array<{ date: string; close: number }>,
  k: number = 2.0,
  windowSize?: number
): Array<{
  date: string;
  close: number;
  midLine: number;
  upperBand: number;
  lowerBand: number;
}> {
  const closes = data.map(d => d.close);

  let channel: StdChannelResult;

  if (windowSize) {
    // Use specific window
    const window = closes.slice(-windowSize);
    channel = calculateStdChannel(window, k);

    // Pad with nulls for data before the window
    const paddingLength = data.length - windowSize;
    const paddedMid = [...Array(paddingLength).fill(null), ...channel.midLine];
    const paddedUpper = [...Array(paddingLength).fill(null), ...channel.upperBand];
    const paddedLower = [...Array(paddingLength).fill(null), ...channel.lowerBand];

    return data.map((d, i) => ({
      date: d.date,
      close: d.close,
      midLine: paddedMid[i]!,
      upperBand: paddedUpper[i]!,
      lowerBand: paddedLower[i]!,
    }));
  } else {
    // Use full data
    channel = calculateStdChannel(closes, k);

    return data.map((d, i) => ({
      date: d.date,
      close: d.close,
      midLine: channel.midLine[i],
      upperBand: channel.upperBand[i],
      lowerBand: channel.lowerBand[i],
    }));
  }
}
