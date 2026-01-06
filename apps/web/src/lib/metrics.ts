export function annualizedVolatility(dailyReturns: number[]): number | null {
  if (dailyReturns.length < 20) return null;

  const mean =
    dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;

  const variance =
    dailyReturns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) /
    (dailyReturns.length - 1);

  const dailyStd = Math.sqrt(variance);
  return dailyStd * Math.sqrt(252);
}

export function maxDrawdown(prices: number[]): number | null {
  if (prices.length < 2) return null;

  let peak = prices[0];
  let maxDd = 0;

  for (const price of prices) {
    if (price > peak) peak = price;
    const drawdown = (price - peak) / peak;
    if (drawdown < maxDd) maxDd = drawdown;
  }

  return maxDd;
}

export function var95(dailyReturns: number[]): number | null {
  if (dailyReturns.length < 100) return null;

  const sorted = [...dailyReturns].sort((a, b) => a - b);
  const idx = Math.floor(0.05 * (sorted.length - 1));
  return sorted[idx];
}

export function cvar95(dailyReturns: number[]): number | null {
  if (dailyReturns.length < 100) return null;

  const v = var95(dailyReturns);
  if (v == null) return null;

  const tail = dailyReturns.filter((r) => r <= v);
  if (!tail.length) return v;

  return tail.reduce((a, b) => a + b, 0) / tail.length;
}


