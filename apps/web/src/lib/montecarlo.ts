/**
 * Monte Carlo Simulation Utilities
 * Simulates future price paths using Geometric Brownian Motion
 */

/**
 * Generate a single Brownian motion path
 * Uses Box-Muller transform for normal random variables
 */
function generateNormalRandom(): number {
  const u1 = Math.random();
  const u2 = Math.random();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/**
 * Calculate drift and volatility from historical returns
 */
export function calculateParameters(returns: number[]): {
  drift: number;
  volatility: number;
  meanReturn: number;
} {
  const n = returns.length;
  if (n === 0) return { drift: 0, volatility: 0, meanReturn: 0 };

  // Calculate mean return
  const meanReturn = returns.reduce((a, b) => a + b, 0) / n;

  // Calculate volatility (standard deviation)
  const variance = returns.reduce((sum, r) => sum + Math.pow(r - meanReturn, 2), 0) / n;
  const volatility = Math.sqrt(variance);

  // Drift (mu) = mean - 0.5 * variance (for GBM)
  const drift = meanReturn - 0.5 * variance;

  return { drift, volatility, meanReturn };
}

/**
 * Generate multiple Monte Carlo paths using Geometric Brownian Motion
 * S(t+dt) = S(t) * exp((drift - 0.5*vol^2)*dt + vol*sqrt(dt)*Z)
 * where Z ~ N(0,1)
 *
 * Includes outlier filtering to remove extreme paths
 */
export function generateMonteCarloSimulation(
  startPrice: number,
  numPaths: number,
  numSteps: number,
  drift: number,
  volatility: number,
  dt: number = 1, // time step (1 day by default)
  filterOutliers: boolean = true
): Array<Array<{ time: number; price: number }>> {
  const allPaths: Array<Array<{ time: number; price: number }>> = [];

  // Generate more paths than needed to account for filtering
  const pathsToGenerate = filterOutliers ? Math.floor(numPaths * 1.3) : numPaths;

  for (let pathIdx = 0; pathIdx < pathsToGenerate; pathIdx++) {
    const path: Array<{ time: number; price: number }> = [
      { time: 0, price: startPrice },
    ];

    let currentPrice = startPrice;
    let isValid = true;

    for (let step = 1; step <= numSteps; step++) {
      const dW = generateNormalRandom() * Math.sqrt(dt);
      const exponent = (drift - 0.5 * volatility * volatility) * dt + volatility * dW;

      // Clamp exponent to prevent overflow/underflow
      const clampedExponent = Math.max(Math.min(exponent, 5), -5);
      currentPrice = currentPrice * Math.exp(clampedExponent);

      // Check for extreme values during path generation
      if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
        isValid = false;
        break;
      }

      path.push({
        time: step * dt,
        price: currentPrice,
      });
    }

    if (isValid) {
      allPaths.push(path);
    }
  }

  // Filter outliers based on final prices
  if (filterOutliers && allPaths.length > numPaths) {
    const finalPrices = allPaths.map(path => path[path.length - 1].price);
    const mean = finalPrices.reduce((a, b) => a + b, 0) / finalPrices.length;
    const variance = finalPrices.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / finalPrices.length;
    const stdDev = Math.sqrt(variance);

    // Keep paths within 3 standard deviations
    const filteredPaths = allPaths.filter(path => {
      const finalPrice = path[path.length - 1].price;
      return Math.abs(finalPrice - mean) <= 3 * stdDev;
    });

    // Return requested number of paths
    return filteredPaths.slice(0, numPaths);
  }

  return allPaths.slice(0, numPaths);
}

/**
 * Calculate distribution of final prices from paths
 * Uses better binning strategy for smoother distribution
 */
export function calculateFinalDistribution(
  paths: Array<Array<{ time: number; price: number }>>,
  numBins: number = 60
): Array<{ price: number; count: number; density: number }> {
  if (paths.length === 0 || paths[0].length === 0) return [];

  // Get final prices from all paths
  const finalPrices = paths.map(path => path[path.length - 1].price).sort((a, b) => a - b);

  const minPrice = Math.min(...finalPrices);
  const maxPrice = Math.max(...finalPrices);

  // Use percentile-based range to avoid extreme outliers affecting bins
  const p5 = finalPrices[Math.floor(finalPrices.length * 0.02)];
  const p95 = finalPrices[Math.floor(finalPrices.length * 0.98)];
  const range = p95 - p5;

  // Extend range slightly beyond percentiles
  const extendedMin = p5 - range * 0.1;
  const extendedMax = p95 + range * 0.1;
  const extendedRange = extendedMax - extendedMin;
  const binWidth = extendedRange / numBins;

  // Create bins
  const bins: Array<{ price: number; count: number; density: number }> = [];

  for (let i = 0; i < numBins; i++) {
    const binMin = extendedMin + i * binWidth;
    const binMax = binMin + binWidth;
    const binCenter = (binMin + binMax) / 2;

    const count = finalPrices.filter(p => p >= binMin && p < binMax).length;
    const density = binWidth > 0 ? count / (paths.length * binWidth) : 0;

    bins.push({
      price: binCenter,
      count,
      density,
    });
  }

  return bins;
}

/**
 * Calculate theoretical normal distribution for comparison
 */
export function calculateTheoreticalDistribution(
  startPrice: number,
  finalTime: number,
  drift: number,
  volatility: number,
  bins: Array<{ price: number; count: number; density: number }>
): Array<{ price: number; density: number }> {
  // For GBM, ln(S_T / S_0) ~ N(mu*T, sigma^2*T)
  const mean = drift * finalTime;
  const variance = volatility * volatility * finalTime;
  const stdDev = Math.sqrt(variance);

  return bins.map(bin => {
    const logPrice = Math.log(bin.price / startPrice);
    const exponent = -Math.pow(logPrice - mean, 2) / (2 * variance);
    const density = (1 / (bin.price * stdDev * Math.sqrt(2 * Math.PI))) * Math.exp(exponent);

    return {
      price: bin.price,
      density,
    };
  });
}

/**
 * Calculate percentiles from final price distribution
 */
export function calculatePercentiles(
  paths: Array<Array<{ time: number; price: number }>>
): {
  p5: number;
  p25: number;
  p50: number;
  p75: number;
  p95: number;
  mean: number;
} {
  if (paths.length === 0 || paths[0].length === 0) {
    return { p5: 0, p25: 0, p50: 0, p75: 0, p95: 0, mean: 0 };
  }

  const finalPrices = paths.map(path => path[path.length - 1].price).sort((a, b) => a - b);
  const n = finalPrices.length;

  const mean = finalPrices.reduce((a, b) => a + b, 0) / n;

  return {
    p5: finalPrices[Math.floor(n * 0.05)],
    p25: finalPrices[Math.floor(n * 0.25)],
    p50: finalPrices[Math.floor(n * 0.50)],
    p75: finalPrices[Math.floor(n * 0.75)],
    p95: finalPrices[Math.floor(n * 0.95)],
    mean,
  };
}
