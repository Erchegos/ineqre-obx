// apps/web/src/lib/metrics.ts

// Annualized volatility from daily log returns
// Input: daily log returns (e.g. ln(Pt/Pt-1))
// Output: annualized volatility (decimal, e.g. 0.48 = 48%)
export function annualizedVolatility(
  dailyLogReturns: number[],
  tradingDays = 252
) {
  if (!dailyLogReturns || dailyLogReturns.length < 2) return 0;

  const n = dailyLogReturns.length;
  const mean = dailyLogReturns.reduce((s, x) => s + x, 0) / n;

  let ss = 0;
  for (const x of dailyLogReturns) ss += (x - mean) ** 2;

  const variance = ss / (n - 1);
  const dailyStd = Math.sqrt(variance);

  return dailyStd * Math.sqrt(tradingDays);
}

// Max drawdown from a price series
// Input: prices in chronological order
// Output: max drawdown as decimal (negative, e.g. -0.77 = -77%)
export function maxDrawdown(prices: number[]) {
  if (!prices || prices.length < 2) return 0;

  let peak = prices[0];
  let mdd = 0;

  for (const p of prices) {
    if (p > peak) peak = p;
    const dd = peak > 0 ? (p - peak) / peak : 0;
    if (dd < mdd) mdd = dd;
  }

  return mdd;
}

// Convert log return to simple return
// log r = ln(Pt/Pt-1)
// simple r = Pt/Pt-1 - 1
export function simpleReturnFromLogReturn(rLog: number) {
  return Math.exp(rLog) - 1;
}

// 95% one day VaR and CVaR from log returns
// Convention used:
// - Returns are simple returns (can be negative).
// - VaR 95 is the 5th percentile of returns (typically negative).
// - CVaR 95 is the average return in the worst 5% tail (<= VaR).
export function varCvar95FromLogReturns(dailyLogReturns: number[]) {
  const out = { var95: 0, cvar95: 0 };

  if (!dailyLogReturns || dailyLogReturns.length < 30) return out;

  const simple = dailyLogReturns
    .filter((x) => Number.isFinite(x))
    .map((x) => simpleReturnFromLogReturn(x));

  if (simple.length < 30) return out;

  const sorted = [...simple].sort((a, b) => a - b);

  // 5th percentile index (VaR 95)
  const idx = Math.max(0, Math.floor(0.05 * (sorted.length - 1)));
  const var95 = sorted[idx];

  // Tail mean (CVaR 95): average of returns <= var95
  const tail = sorted.filter((x) => x <= var95);
  const cvar95 =
    tail.length > 0 ? tail.reduce((s, x) => s + x, 0) / tail.length : var95;

  out.var95 = var95;
  out.cvar95 = cvar95;

  return out;
}

// Optional named exports if you want them later
export function var95(dailyLogReturns: number[]) {
  return varCvar95FromLogReturns(dailyLogReturns).var95;
}

export function cvar95(dailyLogReturns: number[]) {
  return varCvar95FromLogReturns(dailyLogReturns).cvar95;
}
