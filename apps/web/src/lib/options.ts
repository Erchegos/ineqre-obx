/**
 * Options Calculations Library
 * P&L, Greeks, Payoff Diagrams, Black-Scholes
 */

// Option type
export type OptionType = "call" | "put";

// Option position
export interface OptionPosition {
  type: OptionType;
  strike: number;
  premium: number; // Price paid/received per share
  quantity: number; // Positive = long, negative = short
  expiry: string; // YYYYMMDD
  iv?: number; // Implied volatility (from chain data)
}

// Option contract data from IBKR
export interface OptionContract {
  conId: number;
  symbol: string;
  strike: number;
  expiry: string;
  right: OptionType;
  bid: number;
  ask: number;
  last: number;
  iv: number; // Implied volatility
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  openInterest: number;
  volume: number;
}

// Option chain organized by strike
export interface OptionChainRow {
  strike: number;
  call?: OptionContract;
  put?: OptionContract;
}

// P&L calculation result
export interface PayoffPoint {
  price: number;
  pnl: number;
  pnlPercent: number;
}

/**
 * Calculate option payoff at expiration
 */
export function calculatePayoff(
  position: OptionPosition,
  underlyingPrice: number
): number {
  const { type, strike, premium, quantity } = position;

  let intrinsicValue: number;
  if (type === "call") {
    intrinsicValue = Math.max(0, underlyingPrice - strike);
  } else {
    intrinsicValue = Math.max(0, strike - underlyingPrice);
  }

  // P&L = (Intrinsic Value - Premium Paid) * Quantity * 100
  const pnlPerShare = intrinsicValue - premium;
  return pnlPerShare * quantity * 100;
}

/**
 * Calculate total P&L for multiple positions at expiration
 */
export function calculateTotalPayoff(
  positions: OptionPosition[],
  underlyingPrice: number
): number {
  return positions.reduce((total, pos) => total + calculatePayoff(pos, underlyingPrice), 0);
}

/**
 * Generate payoff diagram data points
 */
export function generatePayoffDiagram(
  positions: OptionPosition[],
  currentPrice: number,
  priceRange: number = 0.5 // 50% range above/below current price
): PayoffPoint[] {
  const minPrice = currentPrice * (1 - priceRange);
  const maxPrice = currentPrice * (1 + priceRange);
  const steps = 100;
  const stepSize = (maxPrice - minPrice) / steps;

  const totalPremium = positions.reduce((sum, pos) => sum + pos.premium * Math.abs(pos.quantity) * 100, 0);

  const points: PayoffPoint[] = [];
  for (let i = 0; i <= steps; i++) {
    const price = minPrice + i * stepSize;
    const pnl = calculateTotalPayoff(positions, price);
    points.push({
      price: Math.round(price * 100) / 100,
      pnl: Math.round(pnl * 100) / 100,
      pnlPercent: totalPremium > 0 ? Math.round((pnl / totalPremium) * 10000) / 100 : 0,
    });
  }

  return points;
}

/**
 * Calculate breakeven price(s) for option positions
 */
export function calculateBreakeven(positions: OptionPosition[]): number[] {
  // Find approximate breakevens using payoff diagram
  const samplePrice = positions[0]?.strike || 100;
  const points = generatePayoffDiagram(positions, samplePrice, 1);

  const breakevens: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    // Check if P&L crosses zero
    if ((prev.pnl <= 0 && curr.pnl > 0) || (prev.pnl >= 0 && curr.pnl < 0)) {
      // Linear interpolation
      const ratio = Math.abs(prev.pnl) / (Math.abs(prev.pnl) + Math.abs(curr.pnl));
      const breakeven = prev.price + ratio * (curr.price - prev.price);
      breakevens.push(Math.round(breakeven * 100) / 100);
    }
  }

  return breakevens;
}

/**
 * Calculate max profit and max loss for positions.
 * Uses net call/put exposure to determine if profit or loss is unlimited:
 * - Net long calls (qty > 0) → unlimited profit upside
 * - Net short calls (qty < 0) → unlimited loss upside
 * Put side is always bounded (price can't go below 0).
 */
export function calculateMaxProfitLoss(positions: OptionPosition[]): {
  maxProfit: number | "unlimited";
  maxLoss: number | "unlimited";
} {
  const samplePrice = positions[0]?.strike || 100;
  const points = generatePayoffDiagram(positions, samplePrice, 2);

  const pnls = points.map(p => p.pnl);
  const maxPnl = Math.max(...pnls);
  const minPnl = Math.min(...pnls);

  // Net call exposure: positive = long calls dominate, negative = short calls dominate
  const netCallQty = positions
    .filter(p => p.type === "call")
    .reduce((sum, p) => sum + p.quantity, 0);

  // At very high prices, long calls → unlimited profit, short calls → unlimited loss
  const unlimitedProfit = netCallQty > 0;
  const unlimitedLoss = netCallQty < 0;

  return {
    maxProfit: unlimitedProfit ? "unlimited" : maxPnl,
    maxLoss: unlimitedLoss ? "unlimited" : minPnl,
  };
}

/**
 * Black-Scholes option pricing
 */
export function blackScholes(
  type: OptionType,
  S: number, // Current stock price
  K: number, // Strike price
  T: number, // Time to expiration in years
  r: number, // Risk-free interest rate
  sigma: number // Volatility
): { price: number; delta: number; gamma: number; theta: number; vega: number } {
  const d1 = (Math.log(S / K) + (r + sigma * sigma / 2) * T) / (sigma * Math.sqrt(T));
  const d2 = d1 - sigma * Math.sqrt(T);

  const Nd1 = normalCDF(d1);
  const Nd2 = normalCDF(d2);
  const nd1 = normalPDF(d1);

  let price: number;
  let delta: number;

  if (type === "call") {
    price = S * Nd1 - K * Math.exp(-r * T) * Nd2;
    delta = Nd1;
  } else {
    price = K * Math.exp(-r * T) * normalCDF(-d2) - S * normalCDF(-d1);
    delta = Nd1 - 1;
  }

  const gamma = nd1 / (S * sigma * Math.sqrt(T));
  const theta = (-S * nd1 * sigma / (2 * Math.sqrt(T)) - r * K * Math.exp(-r * T) * (type === "call" ? Nd2 : normalCDF(-d2))) / 365;
  const vega = S * nd1 * Math.sqrt(T) / 100;

  return { price, delta, gamma, theta, vega };
}

/**
 * Calculate implied volatility using Newton-Raphson method
 */
export function calculateIV(
  type: OptionType,
  marketPrice: number,
  S: number,
  K: number,
  T: number,
  r: number
): number {
  let sigma = 0.3; // Initial guess
  const maxIterations = 100;
  const precision = 0.0001;

  for (let i = 0; i < maxIterations; i++) {
    const result = blackScholes(type, S, K, T, r, sigma);
    const diff = result.price - marketPrice;

    if (Math.abs(diff) < precision) {
      return sigma;
    }

    // Newton-Raphson update
    const vega = result.vega * 100; // Convert back
    if (vega === 0) break;
    sigma = sigma - diff / vega;

    // Keep sigma in reasonable bounds
    sigma = Math.max(0.01, Math.min(sigma, 5));
  }

  return sigma;
}

/**
 * Days until expiration
 */
export function daysToExpiry(expiry: string): number {
  // expiry format: YYYYMMDD
  const year = parseInt(expiry.substring(0, 4));
  const month = parseInt(expiry.substring(4, 6)) - 1;
  const day = parseInt(expiry.substring(6, 8));
  const expiryDate = new Date(year, month, day);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffTime = expiryDate.getTime() - today.getTime();
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

/**
 * Format expiry date for display
 */
export function formatExpiry(expiry: string): string {
  const year = expiry.substring(0, 4);
  const month = expiry.substring(4, 6);
  const day = expiry.substring(6, 8);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[parseInt(month) - 1]} ${parseInt(day)}, ${year}`;
}

/**
 * Calculate put/call ratio from chain
 */
export function calculatePutCallRatio(chain: OptionChainRow[]): {
  volumeRatio: number;
  oiRatio: number;
  putOI: number;
  callOI: number;
} {
  let putVolume = 0;
  let callVolume = 0;
  let putOI = 0;
  let callOI = 0;

  for (const row of chain) {
    if (row.put) {
      putVolume += row.put.volume || 0;
      putOI += row.put.openInterest || 0;
    }
    if (row.call) {
      callVolume += row.call.volume || 0;
      callOI += row.call.openInterest || 0;
    }
  }

  return {
    volumeRatio: callVolume > 0 ? putVolume / callVolume : 0,
    oiRatio: callOI > 0 ? putOI / callOI : 0,
    putOI,
    callOI,
  };
}

// ─── Multi-time Payoff (Black-Scholes based) ────────────────────

export interface MultiTimePayoffPoint {
  price: number;
  pnlToday: number;
  pnlMid1: number;
  pnlMid2: number;
  pnlExpiry: number;
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
}

/**
 * Generate payoff diagram at multiple time points using Black-Scholes.
 * Shows P&L curves for: today, 1/3 elapsed, 2/3 elapsed, at expiry.
 * Includes portfolio Greeks at current time for each price point.
 */
export function generateMultiTimePayoff(
  positions: OptionPosition[],
  currentPrice: number,
  totalDTE: number,
  riskFreeRate: number = 0.04,
  priceRange: number = 0.4,
): MultiTimePayoffPoint[] {
  const minPrice = currentPrice * (1 - priceRange);
  const maxPrice = currentPrice * (1 + priceRange);
  const steps = 100;
  const stepSize = (maxPrice - minPrice) / steps;

  const dteToday = Math.max(totalDTE, 1);
  const dteMid1 = Math.max(Math.round(totalDTE * 0.66), 1);
  const dteMid2 = Math.max(Math.round(totalDTE * 0.33), 1);

  const totalCost = positions.reduce(
    (sum, pos) => sum + pos.premium * pos.quantity * 100,
    0,
  );

  const calcValue = (price: number, daysRemaining: number): number => {
    let value = 0;
    for (const pos of positions) {
      const iv = pos.iv || 0.3;
      if (daysRemaining <= 0) {
        const intrinsic =
          pos.type === "call"
            ? Math.max(0, price - pos.strike)
            : Math.max(0, pos.strike - price);
        value += intrinsic * pos.quantity * 100;
      } else {
        const T = daysRemaining / 365;
        const bs = blackScholes(pos.type, price, pos.strike, T, riskFreeRate, iv);
        value += bs.price * pos.quantity * 100;
      }
    }
    return value;
  };

  const points: MultiTimePayoffPoint[] = [];
  for (let i = 0; i <= steps; i++) {
    const price = minPrice + i * stepSize;
    const roundedPrice = Math.round(price * 100) / 100;

    const pnlToday = calcValue(price, dteToday) - totalCost;
    const pnlMid1 = calcValue(price, dteMid1) - totalCost;
    const pnlMid2 = calcValue(price, dteMid2) - totalCost;
    const pnlExpiry = calcValue(price, 0) - totalCost;

    let delta = 0, gamma = 0, theta = 0, vega = 0;
    if (dteToday > 0) {
      const T = dteToday / 365;
      for (const pos of positions) {
        const iv = pos.iv || 0.3;
        const bs = blackScholes(pos.type, price, pos.strike, T, riskFreeRate, iv);
        delta += bs.delta * pos.quantity;
        gamma += bs.gamma * pos.quantity;
        theta += bs.theta * pos.quantity * 100;
        vega += bs.vega * pos.quantity;
      }
    }

    points.push({
      price: roundedPrice,
      pnlToday: Math.round(pnlToday * 100) / 100,
      pnlMid1: Math.round(pnlMid1 * 100) / 100,
      pnlMid2: Math.round(pnlMid2 * 100) / 100,
      pnlExpiry: Math.round(pnlExpiry * 100) / 100,
      delta: Math.round(delta * 1000) / 1000,
      gamma: Math.round(gamma * 10000) / 10000,
      theta: Math.round(theta * 100) / 100,
      vega: Math.round(vega * 1000) / 1000,
    });
  }

  return points;
}

// Standard normal CDF
function normalCDF(x: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x) / Math.sqrt(2);

  const t = 1.0 / (1.0 + p * x);
  const y = 1.0 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

  return 0.5 * (1.0 + sign * y);
}

// Standard normal PDF
function normalPDF(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}
