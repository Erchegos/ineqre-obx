// apps/web/src/lib/metrics.ts

/**
 * Compute log returns from a price series
 */
export function computeReturns(prices: number[]): number[] {
  const returns: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    if (prices[i] > 0 && prices[i - 1] > 0) {
      returns.push(Math.log(prices[i] / prices[i - 1]));
    }
  }
  return returns;
}

/**
 * Compute beta (sensitivity to market)
 * Beta = Covariance(asset, market) / Variance(market)
 */
export function computeBeta(assetReturns: number[], marketReturns: number[]): number {
  const n = Math.min(assetReturns.length, marketReturns.length);
  if (n < 2) return 0;

  const assetMean = assetReturns.slice(0, n).reduce((a, b) => a + b, 0) / n;
  const marketMean = marketReturns.slice(0, n).reduce((a, b) => a + b, 0) / n;

  let covariance = 0;
  let marketVariance = 0;

  for (let i = 0; i < n; i++) {
    const assetDiff = assetReturns[i] - assetMean;
    const marketDiff = marketReturns[i] - marketMean;
    covariance += assetDiff * marketDiff;
    marketVariance += marketDiff * marketDiff;
  }

  covariance /= n - 1;
  marketVariance /= n - 1;

  return marketVariance > 0 ? covariance / marketVariance : 0;
}

/**
 * Compute drawdown series
 * Drawdown = (Current Price - Peak Price) / Peak Price
 */
export function computeDrawdownSeries(
  prices: number[]
): Array<{ date: string; drawdown: number }> {
  const result: Array<{ date: string; drawdown: number }> = [];
  let peak = prices[0];

  for (let i = 0; i < prices.length; i++) {
    if (prices[i] > peak) {
      peak = prices[i];
    }
    const drawdown = (prices[i] - peak) / peak;
    
    // Create a simple date string based on index
    const date = new Date(Date.now() - (prices.length - i) * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    
    result.push({ date, drawdown });
  }

  return result;
}

/**
 * Compute Sharpe Ratio
 * Sharpe = (Mean Return - Risk Free Rate) / Std Dev of Returns
 * Annualized
 */
export function computeSharpeRatio(returns: number[], riskFreeRate: number = 0): number {
  if (returns.length < 2) return 0;

  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / (returns.length - 1);
  const stdDev = Math.sqrt(variance);

  if (stdDev === 0) return 0;

  // Annualize: mean * 252 days, stdDev * sqrt(252)
  const annualizedMean = mean * 252;
  const annualizedStdDev = stdDev * Math.sqrt(252);

  return (annualizedMean - riskFreeRate) / annualizedStdDev;
}

/**
 * Compute Value at Risk (VaR) at a given confidence level
 */
export function computeVaR(returns: number[], confidenceLevel: number = 0.95): number {
  if (returns.length === 0) return 0;
  
  const sorted = [...returns].sort((a, b) => a - b);
  const index = Math.floor(returns.length * (1 - confidenceLevel));
  
  return sorted[index] || 0;
}

/**
 * Compute Conditional Value at Risk (CVaR) / Expected Shortfall
 */
export function computeCVaR(returns: number[], confidenceLevel: number = 0.95): number {
  if (returns.length === 0) return 0;
  
  const sorted = [...returns].sort((a, b) => a - b);
  const index = Math.floor(returns.length * (1 - confidenceLevel));
  
  const tailReturns = sorted.slice(0, index + 1);
  if (tailReturns.length === 0) return 0;
  
  return tailReturns.reduce((a, b) => a + b, 0) / tailReturns.length;
}

/**
 * Compute annualized volatility from returns
 */
export function computeVolatility(returns: number[]): number {
  if (returns.length < 2) return 0;

  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / (returns.length - 1);

  return Math.sqrt(variance * 252); // Annualized
}

/**
 * Compute maximum drawdown
 */
export function computeMaxDrawdown(prices: number[]): number {
  let peak = prices[0];
  let maxDD = 0;

  for (const price of prices) {
    if (price > peak) {
      peak = price;
    }
    const drawdown = (price - peak) / peak;
    if (drawdown < maxDD) {
      maxDD = drawdown;
    }
  }

  return maxDD;
}