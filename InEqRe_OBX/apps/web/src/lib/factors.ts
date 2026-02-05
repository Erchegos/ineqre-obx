/**
 * Predictive Factor Calculation Library
 * Implements 19 research-backed factors for equity return prediction
 *
 * Factor Categories:
 * - Momentum (5): mom1m, mom6m, mom11m, mom36m, chgmom
 * - Volatility (6): vol1m, vol3m, vol12m, maxret, beta, ivol
 * - Fundamentals (7): bm, nokvol, ep, dy, sp, sg, mktcap
 * - Categorical (1): dum_jan
 */

import { pool } from './db';

export type TechnicalFactors = {
  date: string;
  mom1m: number | null;
  mom6m: number | null;
  mom11m: number | null;
  mom36m: number | null;
  chgmom: number | null;
  vol1m: number | null;
  vol3m: number | null;
  vol12m: number | null;
  maxret: number | null;
  beta: number | null;
  ivol: number | null;
  dum_jan: number;
};

/**
 * Calculate log return between two prices
 */
function logReturn(price1: number, price2: number): number | null {
  if (price1 <= 0 || price2 <= 0) return null;
  return Math.log(price2 / price1);
}

/**
 * Calculate momentum factors from price history
 * Uses log returns as per academic research
 */
export function calculateMomentumFactors(
  prices: Array<{ date: string; adjClose: number }>,
  targetIndex: number
): {
  mom1m: number | null;
  mom6m: number | null;
  mom11m: number | null;
  mom36m: number | null;
} {
  const result = {
    mom1m: null as number | null,
    mom6m: null as number | null,
    mom11m: null as number | null,
    mom36m: null as number | null,
  };

  const currentPrice = prices[targetIndex]?.adjClose;
  if (!currentPrice || currentPrice <= 0) return result;

  // mom1m: 1-month momentum (t-21 to t)
  const price1m = prices[targetIndex - 21]?.adjClose;
  if (price1m && price1m > 0) {
    result.mom1m = logReturn(price1m, currentPrice);
  }

  // mom6m: 6-month momentum (t-147 to t-21, skipping most recent month to avoid reversal)
  const price6mStart = prices[targetIndex - 147]?.adjClose;
  const price6mEnd = prices[targetIndex - 21]?.adjClose;
  if (price6mStart && price6mStart > 0 && price6mEnd && price6mEnd > 0) {
    result.mom6m = logReturn(price6mStart, price6mEnd);
  }

  // mom11m: 11-month momentum (t-252 to t-21)
  const price11mStart = prices[targetIndex - 252]?.adjClose;
  const price11mEnd = prices[targetIndex - 21]?.adjClose;
  if (price11mStart && price11mStart > 0 && price11mEnd && price11mEnd > 0) {
    result.mom11m = logReturn(price11mStart, price11mEnd);
  }

  // mom36m: 36-month momentum (t-1008 to t-252)
  const price36mStart = prices[targetIndex - 1008]?.adjClose;
  const price36mEnd = prices[targetIndex - 252]?.adjClose;
  if (price36mStart && price36mStart > 0 && price36mEnd && price36mEnd > 0) {
    result.mom36m = logReturn(price36mStart, price36mEnd);
  }

  return result;
}

/**
 * Calculate change in momentum (chgmom)
 * Difference between current 6m momentum and 6m momentum from 6 months ago
 */
export function calculateMomentumChange(
  prices: Array<{ date: string; adjClose: number }>,
  targetIndex: number
): number | null {
  // Current 6m momentum (t-147 to t-21)
  const currentMom6m = calculateMomentumFactors(prices, targetIndex).mom6m;

  // 6m momentum from 6 months ago (t-273 to t-147)
  const price6mAgoStart = prices[targetIndex - 273]?.adjClose;
  const price6mAgoEnd = prices[targetIndex - 147]?.adjClose;

  if (!currentMom6m || !price6mAgoStart || !price6mAgoEnd) return null;

  const previousMom6m = logReturn(price6mAgoStart, price6mAgoEnd);
  if (previousMom6m === null) return null;

  return currentMom6m - previousMom6m;
}

/**
 * Calculate volatility factors from daily returns
 * All volatilities are annualized using sqrt(252)
 */
export function calculateVolatilityFactors(
  prices: Array<{ date: string; adjClose: number }>,
  targetIndex: number
): {
  vol1m: number | null;
  vol3m: number | null;
  vol12m: number | null;
  maxret: number | null;
} {
  const result = {
    vol1m: null as number | null,
    vol3m: null as number | null,
    vol12m: null as number | null,
    maxret: null as number | null,
  };

  // Helper to calculate volatility over a window
  const calcVol = (windowSize: number): number | null => {
    const returns: number[] = [];
    for (let i = 1; i <= windowSize; i++) {
      const idx = targetIndex - i + 1;
      if (idx < 0 || idx >= prices.length) continue;

      const prevPrice = prices[idx - 1]?.adjClose;
      const currPrice = prices[idx]?.adjClose;

      if (prevPrice && prevPrice > 0 && currPrice && currPrice > 0) {
        returns.push(logReturn(prevPrice, currPrice)!);
      }
    }

    if (returns.length < windowSize * 0.8) return null; // Need at least 80% of data

    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / returns.length;
    const stdDev = Math.sqrt(variance);

    // Annualize using sqrt(252)
    return stdDev * Math.sqrt(252);
  };

  result.vol1m = calcVol(21);
  result.vol3m = calcVol(63);
  result.vol12m = calcVol(252);

  // maxret: Maximum daily return in past month
  const dailyReturns: number[] = [];
  for (let i = 1; i <= 21; i++) {
    const idx = targetIndex - i + 1;
    if (idx < 0 || idx >= prices.length) continue;

    const prevPrice = prices[idx - 1]?.adjClose;
    const currPrice = prices[idx]?.adjClose;

    if (prevPrice && prevPrice > 0 && currPrice && currPrice > 0) {
      dailyReturns.push(logReturn(prevPrice, currPrice)!);
    }
  }

  if (dailyReturns.length >= 15) {
    result.maxret = Math.max(...dailyReturns);
  }

  return result;
}

/**
 * Calculate beta and idiosyncratic volatility
 * Requires market (OBX) data for regression
 */
export async function calculateBetaAndIVOL(
  ticker: string,
  targetDate: string,
  windowDays: number = 252
): Promise<{ beta: number | null; ivol: number | null }> {
  const result = { beta: null as number | null, ivol: null as number | null };

  try {
    // Fetch stock returns
    const stockQuery = `
      SELECT date, adj_close
      FROM prices_daily
      WHERE ticker = $1
        AND date <= $2
        AND adj_close IS NOT NULL
        AND adj_close > 0
      ORDER BY date DESC
      LIMIT $3
    `;
    const stockResult = await pool.query(stockQuery, [ticker, targetDate, windowDays + 1]);

    if (stockResult.rows.length < windowDays * 0.8) return result;

    // Fetch OBX returns
    const marketQuery = `
      SELECT date, adj_close
      FROM prices_daily
      WHERE ticker = 'OBX'
        AND date <= $1
        AND adj_close IS NOT NULL
        AND adj_close > 0
      ORDER BY date DESC
      LIMIT $2
    `;
    const marketResult = await pool.query(marketQuery, [targetDate, windowDays + 1]);

    if (marketResult.rows.length < windowDays * 0.8) return result;

    // Calculate returns for both stock and market
    // Use ISO date strings as keys since pg returns Date objects (reference equality fails)
    const toDateStr = (d: Date | string) => d instanceof Date ? d.toISOString().split('T')[0] : String(d);

    const stockReturns: { date: string; return: number }[] = [];
    for (let i = 0; i < stockResult.rows.length - 1; i++) {
      const currPrice = parseFloat(stockResult.rows[i].adj_close);
      const prevPrice = parseFloat(stockResult.rows[i + 1].adj_close);
      const ret = logReturn(prevPrice, currPrice);
      if (ret !== null) {
        stockReturns.push({ date: toDateStr(stockResult.rows[i].date), return: ret });
      }
    }

    const marketReturns: { date: string; return: number }[] = [];
    for (let i = 0; i < marketResult.rows.length - 1; i++) {
      const currPrice = parseFloat(marketResult.rows[i].adj_close);
      const prevPrice = parseFloat(marketResult.rows[i + 1].adj_close);
      const ret = logReturn(prevPrice, currPrice);
      if (ret !== null) {
        marketReturns.push({ date: toDateStr(marketResult.rows[i].date), return: ret });
      }
    }

    // Match dates using string keys
    const marketReturnsByDate = new Map(marketReturns.map(r => [r.date, r.return]));
    const matched: { stock: number; market: number }[] = [];

    for (const sr of stockReturns) {
      const mr = marketReturnsByDate.get(sr.date);
      if (mr !== undefined) {
        matched.push({ stock: sr.return, market: mr });
      }
    }

    if (matched.length < windowDays * 0.7) return result;

    // Calculate beta using linear regression
    const n = matched.length;
    const sumX = matched.reduce((s, p) => s + p.market, 0);
    const sumY = matched.reduce((s, p) => s + p.stock, 0);
    const sumXY = matched.reduce((s, p) => s + p.market * p.stock, 0);
    const sumX2 = matched.reduce((s, p) => s + p.market * p.market, 0);

    const meanX = sumX / n;
    const meanY = sumY / n;

    const beta = (sumXY - n * meanX * meanY) / (sumX2 - n * meanX * meanX);
    result.beta = beta;

    // Calculate idiosyncratic volatility (residual standard deviation)
    const alpha = meanY - beta * meanX;
    const residuals = matched.map(p => p.stock - (alpha + beta * p.market));
    const residualVariance = residuals.reduce((s, r) => s + r * r, 0) / n;
    result.ivol = Math.sqrt(residualVariance) * Math.sqrt(252); // Annualize

  } catch (error) {
    console.warn(`Error calculating beta/IVOL for ${ticker}:`, error);
  }

  return result;
}

/**
 * Calculate NOK trading volume (20-day average of close * volume)
 * Requires price data with close and volume
 */
export function calculateNOKVolume(
  prices: Array<{ date: string; close: number; volume: number }>,
  targetIndex: number,
  windowDays: number = 20
): number | null {
  const values: number[] = [];
  for (let i = 0; i < windowDays; i++) {
    const idx = targetIndex - i;
    if (idx < 0) break;
    const p = prices[idx];
    if (p && p.close > 0 && p.volume > 0) {
      values.push(p.close * p.volume);
    }
  }
  if (values.length < windowDays * 0.8) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Calculate all technical factors for a given date
 */
export async function calculateTechnicalFactorsForDate(
  ticker: string,
  prices: Array<{ date: string; adjClose: number }>,
  targetIndex: number,
  calculateBeta: boolean = false // Beta is expensive, only calculate every 5 days
): Promise<TechnicalFactors> {
  const date = prices[targetIndex].date;

  const momentum = calculateMomentumFactors(prices, targetIndex);
  const chgmom = calculateMomentumChange(prices, targetIndex);
  const volatility = calculateVolatilityFactors(prices, targetIndex);

  let beta = null;
  let ivol = null;

  if (calculateBeta) {
    const betaResult = await calculateBetaAndIVOL(ticker, date);
    beta = betaResult.beta;
    ivol = betaResult.ivol;
  }

  // January dummy
  const dateObj = new Date(date);
  const dum_jan = dateObj.getMonth() === 0 ? 1 : 0;

  return {
    date,
    mom1m: momentum.mom1m,
    mom6m: momentum.mom6m,
    mom11m: momentum.mom11m,
    mom36m: momentum.mom36m,
    chgmom,
    vol1m: volatility.vol1m,
    vol3m: volatility.vol3m,
    vol12m: volatility.vol12m,
    maxret: volatility.maxret,
    beta,
    ivol,
    dum_jan,
  };
}

/**
 * Insert technical factors into database
 */
export async function insertTechnicalFactors(
  ticker: string,
  factors: TechnicalFactors[]
): Promise<{ inserted: number; errors: number }> {
  let inserted = 0;
  let errors = 0;

  for (const factor of factors) {
    try {
      await pool.query(
        `
        INSERT INTO factor_technical (
          ticker, date,
          mom1m, mom6m, mom11m, mom36m, chgmom,
          vol1m, vol3m, vol12m, maxret, beta, ivol,
          dum_jan
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        ON CONFLICT (ticker, date) DO UPDATE SET
          mom1m = EXCLUDED.mom1m,
          mom6m = EXCLUDED.mom6m,
          mom11m = EXCLUDED.mom11m,
          mom36m = EXCLUDED.mom36m,
          chgmom = EXCLUDED.chgmom,
          vol1m = EXCLUDED.vol1m,
          vol3m = EXCLUDED.vol3m,
          vol12m = EXCLUDED.vol12m,
          maxret = EXCLUDED.maxret,
          beta = COALESCE(EXCLUDED.beta, factor_technical.beta),
          ivol = COALESCE(EXCLUDED.ivol, factor_technical.ivol),
          dum_jan = EXCLUDED.dum_jan
        `,
        [
          ticker,
          factor.date,
          factor.mom1m,
          factor.mom6m,
          factor.mom11m,
          factor.mom36m,
          factor.chgmom,
          factor.vol1m,
          factor.vol3m,
          factor.vol12m,
          factor.maxret,
          factor.beta,
          factor.ivol,
          factor.dum_jan,
        ]
      );
      inserted++;
    } catch (error) {
      console.error(`Error inserting factors for ${ticker} on ${factor.date}:`, error);
      errors++;
    }
  }

  return { inserted, errors };
}
