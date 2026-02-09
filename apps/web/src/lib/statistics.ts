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

// ============================================================================
// Risk-Adjusted Performance Metrics
// ============================================================================

/**
 * Calculate Sharpe Ratio
 *
 * Sharpe = (mean return - risk-free rate) / std dev
 * Annualized: multiply by sqrt(periods per year)
 *
 * @param returns Array of periodic returns (e.g., monthly)
 * @param riskFreeRate Annual risk-free rate (default 4%)
 * @param periodsPerYear Number of periods per year (default 12 for monthly)
 * @returns Annualized Sharpe ratio
 */
export function calculateSharpeRatio(
  returns: number[],
  riskFreeRate: number = 0.04,
  periodsPerYear: number = 12
): number {
  if (returns.length < 3) return 0;

  const meanReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
  const periodicRf = riskFreeRate / periodsPerYear;
  const excessReturn = meanReturn - periodicRf;

  const variance = returns.reduce((sum, r) => sum + Math.pow(r - meanReturn, 2), 0) / (returns.length - 1);
  const stdDev = Math.sqrt(variance);

  if (stdDev === 0) return 0;

  return (excessReturn / stdDev) * Math.sqrt(periodsPerYear);
}

/**
 * Calculate Sortino Ratio
 *
 * Sortino = (mean return - target return) / downside deviation
 * Only penalizes downside volatility, not upside variance.
 *
 * @param returns Array of periodic returns
 * @param targetReturn Target/minimum acceptable return (default 0)
 * @param periodsPerYear Number of periods per year (default 12 for monthly)
 * @returns Annualized Sortino ratio
 */
export function calculateSortinoRatio(
  returns: number[],
  targetReturn: number = 0,
  periodsPerYear: number = 12
): number {
  if (returns.length < 3) return 0;

  const meanReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
  const periodicTarget = targetReturn / periodsPerYear;

  // Calculate downside deviation (only negative deviations from target)
  const downsideReturns = returns.filter(r => r < periodicTarget);

  if (downsideReturns.length === 0) {
    // No downside returns - return high positive value
    return meanReturn > periodicTarget ? 999 : 0;
  }

  const downsideVariance = downsideReturns.reduce(
    (sum, r) => sum + Math.pow(r - periodicTarget, 2),
    0
  ) / downsideReturns.length;

  const downsideDeviation = Math.sqrt(downsideVariance);

  if (downsideDeviation === 0) return 0;

  const excessReturn = meanReturn - periodicTarget;
  return (excessReturn / downsideDeviation) * Math.sqrt(periodsPerYear);
}

/**
 * Calculate Maximum Drawdown
 *
 * Maximum peak-to-trough decline during the period.
 *
 * @param returns Array of periodic returns
 * @returns Maximum drawdown (negative number, e.g., -0.25 = -25%)
 */
export function calculateMaxDrawdown(returns: number[]): number {
  if (returns.length === 0) return 0;

  let peak = 1;
  let maxDrawdown = 0;
  let cumulativeValue = 1;

  for (const ret of returns) {
    cumulativeValue *= (1 + ret);
    peak = Math.max(peak, cumulativeValue);
    const drawdown = (cumulativeValue - peak) / peak;
    maxDrawdown = Math.min(maxDrawdown, drawdown);
  }

  return maxDrawdown;
}

/**
 * Calculate Calmar Ratio
 *
 * Calmar = Annualized return / |Max drawdown|
 * Measures return per unit of drawdown risk.
 *
 * @param returns Array of periodic returns
 * @param periodsPerYear Number of periods per year (default 12 for monthly)
 * @returns Calmar ratio
 */
export function calculateCalmarRatio(
  returns: number[],
  periodsPerYear: number = 12
): number {
  if (returns.length < 3) return 0;

  const maxDD = calculateMaxDrawdown(returns);

  if (maxDD === 0) return 0;

  // Calculate annualized return
  const cumulativeReturn = returns.reduce((prod, r) => prod * (1 + r), 1) - 1;
  const periods = returns.length;
  const annualizedReturn = Math.pow(1 + cumulativeReturn, periodsPerYear / periods) - 1;

  return annualizedReturn / Math.abs(maxDD);
}

/**
 * Calculate drawdown series and related metrics
 *
 * @param returns Array of periodic returns
 * @returns Drawdown analysis
 */
export function calculateDrawdownAnalysis(returns: number[]): {
  drawdownSeries: number[];
  maxDrawdown: number;
  maxDrawdownDuration: number;
  currentDrawdown: number;
  averageDrawdown: number;
} {
  if (returns.length === 0) {
    return {
      drawdownSeries: [],
      maxDrawdown: 0,
      maxDrawdownDuration: 0,
      currentDrawdown: 0,
      averageDrawdown: 0,
    };
  }

  const drawdownSeries: number[] = [];
  let peak = 1;
  let cumulativeValue = 1;
  let maxDrawdown = 0;
  let maxDrawdownDuration = 0;
  let currentDrawdownDuration = 0;

  for (const ret of returns) {
    cumulativeValue *= (1 + ret);
    peak = Math.max(peak, cumulativeValue);
    const drawdown = (cumulativeValue - peak) / peak;
    drawdownSeries.push(drawdown);
    maxDrawdown = Math.min(maxDrawdown, drawdown);

    if (drawdown < 0) {
      currentDrawdownDuration++;
      maxDrawdownDuration = Math.max(maxDrawdownDuration, currentDrawdownDuration);
    } else {
      currentDrawdownDuration = 0;
    }
  }

  const currentDrawdown = drawdownSeries[drawdownSeries.length - 1];
  const negativeDrawdowns = drawdownSeries.filter(d => d < 0);
  const averageDrawdown = negativeDrawdowns.length > 0
    ? negativeDrawdowns.reduce((a, b) => a + b, 0) / negativeDrawdowns.length
    : 0;

  return {
    drawdownSeries,
    maxDrawdown,
    maxDrawdownDuration,
    currentDrawdown,
    averageDrawdown,
  };
}

/**
 * Calculate comprehensive risk-adjusted metrics
 */
export interface RiskAdjustedMetrics {
  sharpeRatio: number;
  sortinoRatio: number;
  calmarRatio: number;
  maxDrawdown: number;
  maxDrawdownDuration: number;
  annualizedReturn: number;
  annualizedVolatility: number;
  hitRate: number;
  profitFactor: number;
}

export function calculateRiskAdjustedMetrics(
  returns: number[],
  riskFreeRate: number = 0.04,
  periodsPerYear: number = 12
): RiskAdjustedMetrics {
  if (returns.length < 3) {
    return {
      sharpeRatio: 0,
      sortinoRatio: 0,
      calmarRatio: 0,
      maxDrawdown: 0,
      maxDrawdownDuration: 0,
      annualizedReturn: 0,
      annualizedVolatility: 0,
      hitRate: 0,
      profitFactor: 0,
    };
  }

  const sharpeRatio = calculateSharpeRatio(returns, riskFreeRate, periodsPerYear);
  const sortinoRatio = calculateSortinoRatio(returns, 0, periodsPerYear);
  const calmarRatio = calculateCalmarRatio(returns, periodsPerYear);

  const ddAnalysis = calculateDrawdownAnalysis(returns);

  // Annualized return
  const cumulativeReturn = returns.reduce((prod, r) => prod * (1 + r), 1) - 1;
  const annualizedReturn = Math.pow(1 + cumulativeReturn, periodsPerYear / returns.length) - 1;

  // Annualized volatility
  const meanReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((sum, r) => sum + Math.pow(r - meanReturn, 2), 0) / (returns.length - 1);
  const annualizedVolatility = Math.sqrt(variance * periodsPerYear);

  // Hit rate (% of positive returns)
  const positiveReturns = returns.filter(r => r > 0).length;
  const hitRate = positiveReturns / returns.length;

  // Profit factor (sum of gains / sum of losses)
  const gains = returns.filter(r => r > 0).reduce((a, b) => a + b, 0);
  const losses = Math.abs(returns.filter(r => r < 0).reduce((a, b) => a + b, 0));
  const profitFactor = losses > 0 ? gains / losses : gains > 0 ? 999 : 0;

  return {
    sharpeRatio,
    sortinoRatio,
    calmarRatio,
    maxDrawdown: ddAnalysis.maxDrawdown,
    maxDrawdownDuration: ddAnalysis.maxDrawdownDuration,
    annualizedReturn,
    annualizedVolatility,
    hitRate,
    profitFactor,
  };
}
