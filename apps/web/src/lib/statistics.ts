/**
 * Statistical Functions for Quantitative Finance
 *
 * Provides confidence intervals, significance testing, and other
 * statistical measures for parameter estimates.
 *
 * Critical for demonstrating statistical maturity to Oslo Børs professionals.
 */

/**
 * T-distribution critical values (two-tailed, common alpha levels)
 * For large samples (n > 120), approximates normal distribution
 */
const T_CRITICAL_VALUES: Record<number, Record<number, number>> = {
  30: { 0.10: 1.697, 0.05: 2.042, 0.01: 2.750 },
  60: { 0.10: 1.671, 0.05: 2.000, 0.01: 2.660 },
  120: { 0.10: 1.658, 0.05: 1.980, 0.01: 2.617 },
  Infinity: { 0.10: 1.645, 0.05: 1.960, 0.01: 2.576 }, // Normal approximation
};

/**
 * Get t-critical value for given degrees of freedom and alpha
 */
function getTCritical(df: number, alpha: number = 0.05): number {
  // Find closest df in table
  const dfs = [30, 60, 120, Infinity];
  const closestDf = dfs.reduce((prev, curr) => {
    return Math.abs(curr - df) < Math.abs(prev - df) ? curr : prev;
  });

  return T_CRITICAL_VALUES[closestDf][alpha] || 1.96;
}

/**
 * Calculate t-statistic and p-value for a coefficient
 */
export function calculateTStatistic(
  coefficient: number,
  standardError: number,
  degreesOfFreedom: number
): {
  tStatistic: number;
  pValue: number;
  isSignificant: boolean;
  significance: '***' | '**' | '*' | 'ns';
} {
  if (standardError === 0) {
    return {
      tStatistic: 0,
      pValue: 1,
      isSignificant: false,
      significance: 'ns',
    };
  }

  const tStat = coefficient / standardError;

  // Approximate p-value using t-distribution
  // For large samples, use normal approximation
  let pValue: number;
  if (degreesOfFreedom > 120) {
    // Normal approximation
    pValue = 2 * (1 - normalCDF(Math.abs(tStat)));
  } else {
    // Rough t-distribution approximation
    const criticalValues = [
      { alpha: 0.001, critical: getTCritical(degreesOfFreedom, 0.01) * 1.3 },
      { alpha: 0.01, critical: getTCritical(degreesOfFreedom, 0.01) },
      { alpha: 0.05, critical: getTCritical(degreesOfFreedom, 0.05) },
      { alpha: 0.10, critical: getTCritical(degreesOfFreedom, 0.10) },
    ];

    const absT = Math.abs(tStat);
    if (absT >= criticalValues[0].critical) {
      pValue = 0.001;
    } else if (absT >= criticalValues[1].critical) {
      pValue = 0.01;
    } else if (absT >= criticalValues[2].critical) {
      pValue = 0.05;
    } else if (absT >= criticalValues[3].critical) {
      pValue = 0.10;
    } else {
      pValue = 0.20;
    }
  }

  // Determine significance level
  let significance: '***' | '**' | '*' | 'ns';
  if (pValue < 0.001) {
    significance = '***';
  } else if (pValue < 0.01) {
    significance = '**';
  } else if (pValue < 0.05) {
    significance = '*';
  } else {
    significance = 'ns';
  }

  return {
    tStatistic: tStat,
    pValue,
    isSignificant: pValue < 0.05,
    significance,
  };
}

/**
 * Normal CDF approximation (for p-value calculation)
 */
function normalCDF(x: number): number {
  // Abramowitz and Stegun approximation
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp(-x * x / 2);
  const prob =
    d *
    t *
    (0.3193815 +
      t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));

  return x > 0 ? 1 - prob : prob;
}

/**
 * Calculate confidence interval for a parameter estimate
 */
export function calculateConfidenceInterval(
  estimate: number,
  standardError: number,
  degreesOfFreedom: number,
  confidenceLevel: number = 0.95
): {
  lower: number;
  upper: number;
  width: number;
} {
  const alpha = 1 - confidenceLevel;
  const tCritical = getTCritical(degreesOfFreedom, alpha);

  const margin = tCritical * standardError;

  return {
    lower: estimate - margin,
    upper: estimate + margin,
    width: 2 * margin,
  };
}

/**
 * Beta regression statistics
 * Calculates beta, standard error, t-stat, p-value, and confidence intervals
 */
export function calculateBetaStatistics(
  stockReturns: number[],
  marketReturns: number[],
  confidenceLevel: number = 0.95
): {
  beta: number;
  alpha: number;
  rSquared: number;
  standardError: number;
  tStatistic: number;
  pValue: number;
  confidenceInterval: {
    lower: number;
    upper: number;
  };
  isSignificant: boolean;
  significance: '***' | '**' | '*' | 'ns';
} | null {
  if (stockReturns.length !== marketReturns.length || stockReturns.length < 30) {
    return null;
  }

  const n = stockReturns.length;

  // Calculate means
  const meanStock = stockReturns.reduce((a, b) => a + b, 0) / n;
  const meanMarket = marketReturns.reduce((a, b) => a + b, 0) / n;

  // Calculate covariance and variance
  let covariance = 0;
  let varianceMarket = 0;
  let varianceStock = 0;

  for (let i = 0; i < n; i++) {
    const stockDev = stockReturns[i] - meanStock;
    const marketDev = marketReturns[i] - meanMarket;
    covariance += stockDev * marketDev;
    varianceMarket += marketDev * marketDev;
    varianceStock += stockDev * stockDev;
  }

  covariance /= n - 1;
  varianceMarket /= n - 1;
  varianceStock /= n - 1;

  // Beta = Cov(Stock, Market) / Var(Market)
  const beta = covariance / varianceMarket;

  // Alpha (intercept)
  const alpha = meanStock - beta * meanMarket;

  // R-squared
  const rSquared = Math.pow(covariance, 2) / (varianceMarket * varianceStock);

  // Residual variance and standard error of beta
  const residualVariance = varianceStock * (1 - rSquared);
  const standardError = Math.sqrt(residualVariance / (varianceMarket * (n - 2)));

  // Degrees of freedom (n - 2 for simple regression)
  const df = n - 2;

  // T-statistic and p-value
  const stats = calculateTStatistic(beta, standardError, df);

  // Confidence interval
  const ci = calculateConfidenceInterval(beta, standardError, df, confidenceLevel);

  return {
    beta,
    alpha,
    rSquared,
    standardError,
    tStatistic: stats.tStatistic,
    pValue: stats.pValue,
    confidenceInterval: {
      lower: ci.lower,
      upper: ci.upper,
    },
    isSignificant: stats.isSignificant,
    significance: stats.significance,
  };
}

/**
 * Correlation with significance testing
 */
export function calculateCorrelationStatistics(
  x: number[],
  y: number[],
  confidenceLevel: number = 0.95
): {
  correlation: number;
  tStatistic: number;
  pValue: number;
  confidenceInterval: {
    lower: number;
    upper: number;
  };
  isSignificant: boolean;
  significance: '***' | '**' | '*' | 'ns';
} | null {
  if (x.length !== y.length || x.length < 30) {
    return null;
  }

  const n = x.length;

  // Calculate means
  const meanX = x.reduce((a, b) => a + b, 0) / n;
  const meanY = y.reduce((a, b) => a + b, 0) / n;

  // Calculate correlation
  let numerator = 0;
  let sumXSquared = 0;
  let sumYSquared = 0;

  for (let i = 0; i < n; i++) {
    const xDev = x[i] - meanX;
    const yDev = y[i] - meanY;
    numerator += xDev * yDev;
    sumXSquared += xDev * xDev;
    sumYSquared += yDev * yDev;
  }

  const correlation = numerator / Math.sqrt(sumXSquared * sumYSquared);

  // T-statistic for correlation
  const tStat = correlation * Math.sqrt((n - 2) / (1 - correlation * correlation));

  // Degrees of freedom
  const df = n - 2;

  const stats = calculateTStatistic(correlation, correlation / tStat, df);

  // Fisher Z-transformation for confidence interval
  const fisherZ = 0.5 * Math.log((1 + correlation) / (1 - correlation));
  const seZ = 1 / Math.sqrt(n - 3);
  const zCritical = getTCritical(Infinity, 1 - confidenceLevel); // Use normal approximation

  const zLower = fisherZ - zCritical * seZ;
  const zUpper = fisherZ + zCritical * seZ;

  // Transform back to correlation scale
  const lower = (Math.exp(2 * zLower) - 1) / (Math.exp(2 * zLower) + 1);
  const upper = (Math.exp(2 * zUpper) - 1) / (Math.exp(2 * zUpper) + 1);

  return {
    correlation,
    tStatistic: tStat,
    pValue: stats.pValue,
    confidenceInterval: {
      lower,
      upper,
    },
    isSignificant: stats.isSignificant,
    significance: stats.significance,
  };
}

/**
 * Format statistics for display
 */
export function formatBetaDisplay(
  beta: number,
  stats: ReturnType<typeof calculateBetaStatistics>
): string {
  if (!stats) {
    return beta.toFixed(4);
  }

  const ci = `${stats.confidenceInterval.lower.toFixed(2)}-${stats.confidenceInterval.upper.toFixed(2)}`;
  const pVal = stats.pValue < 0.001 ? '<0.001' : stats.pValue.toFixed(3);

  return `${beta.toFixed(4)} (95% CI: ${ci}, p=${pVal})${stats.significance !== 'ns' ? stats.significance : ''}`;
}

/**
 * Format correlation for display with significance stars
 */
export function formatCorrelationDisplay(
  corr: number,
  stats: ReturnType<typeof calculateCorrelationStatistics>
): string {
  if (!stats) {
    return corr.toFixed(4);
  }

  return `${corr.toFixed(4)}${stats.significance !== 'ns' ? stats.significance : ''}`;
}
