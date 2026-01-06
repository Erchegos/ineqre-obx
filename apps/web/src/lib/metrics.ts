export function annualizedVolatility(returns: number[]): number {
  if (returns.length === 0) return 0;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance =
    returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (returns.length - 1);
  return Math.sqrt(variance) * Math.sqrt(252);
}

export function maxDrawdown(prices: number[]): number {
  let peak = prices[0] ?? 0;
  let maxDd = 0;
  for (const p of prices) {
    peak = Math.max(peak, p);
    const dd = peak > 0 ? (p - peak) / peak : 0;
    maxDd = Math.min(maxDd, dd);
  }
  return maxDd;
}

export function var95(returns: number[]): number {
  if (returns.length < 30) return 0;
  const sorted = [...returns].sort((a, b) => a - b);
  const idx = Math.floor(0.05 * sorted.length);
  return sorted[idx];
}

export function cvar95(returns: number[]): number {
  const v = var95(returns);
  const tail = returns.filter((r) => r <= v);
  if (!tail.length) return v;
  return tail.reduce((a, b) => a + b, 0) / tail.length;
}
