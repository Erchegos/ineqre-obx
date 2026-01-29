// apps/web/src/lib/volatility.ts

/**
 * Advanced Volatility Estimation Library
 * Implements standard and advanced volatility measures for equity research.
 */

export type PriceBar = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
};

export type VolatilityPoint = {
  date: string;
  historical: number;
  rolling20: number;
  rolling60: number;
  rolling120: number;
  ewma94: number;
  ewma97: number;
  parkinson?: number;
  garmanKlass?: number;
  rogersSatchell?: number; // NEW: Robust to trend
  yangZhang?: number;      // NEW: Handles overnight gaps (Best in Class)
};

/**
 * Helper: Calculate Log Returns
 */
function computeLogReturns(prices: number[]): number[] {
  const returns: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    returns.push(Math.log(prices[i] / prices[i - 1]));
  }
  return returns;
}

/**
 * 1. Standard Deviation (Annualized)
 */
export function historicalVolatility(returns: number[]): number {
  if (returns.length < 2) return 0;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / (returns.length - 1);
  return Math.sqrt(variance * 252);
}

/**
 * 2. Rolling Window Volatility
 */
function rollingVolatility(returns: number[], window: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < returns.length; i++) {
    if (i < window - 1) {
      result.push(NaN);
      continue;
    }
    const windowReturns = returns.slice(i - window + 1, i + 1);
    result.push(historicalVolatility(windowReturns));
  }
  return result;
}

/**
 * 3. EWMA (Exponentially Weighted Moving Average)
 * Reacts faster to recent shocks than simple rolling windows.
 */
function ewmaVolatility(returns: number[], lambda: number): number[] {
  const result: number[] = [];
  if (returns.length === 0) return result;
  
  // Seed with first return squared
  let variance = returns[0] * returns[0];
  result.push(Math.sqrt(variance * 252));
  
  for (let i = 1; i < returns.length; i++) {
    // Recursive formula: Var_t = λ * Var_t-1 + (1-λ) * r_t^2
    variance = lambda * variance + (1 - lambda) * returns[i] * returns[i];
    result.push(Math.sqrt(variance * 252));
  }
  return result;
}

/**
 * 4. Parkinson Volatility
 * Uses High/Low range. Good for intraday risk, ignores gaps.
 */
function parkinsonVolatility(bars: PriceBar[], window: number): number[] {
  const result: number[] = [];
  const k = 1 / (4 * Math.log(2));

  for (let i = 0; i < bars.length; i++) {
    if (i < window - 1) {
      result.push(NaN);
      continue;
    }
    let sum = 0;
    for (let j = i - window + 1; j <= i; j++) {
      const h = bars[j].high > 0 ? bars[j].high : bars[j].close;
      const l = bars[j].low > 0 ? bars[j].low : bars[j].close;
      const hl = Math.log(h / l);
      sum += hl * hl;
    }
    result.push(Math.sqrt((k * sum) / window) * Math.sqrt(252));
  }
  return result;
}

/**
 * 5. Garman-Klass Volatility
 * Extensions of Parkinson that includes Open/Close data.
 */
function garmanKlassVolatility(bars: PriceBar[], window: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < bars.length; i++) {
    if (i < window - 1) {
      result.push(NaN);
      continue;
    }
    let sum = 0;
    for (let j = i - window + 1; j <= i; j++) {
      const h = bars[j].high > 0 ? bars[j].high : bars[j].close;
      const l = bars[j].low > 0 ? bars[j].low : bars[j].close;
      const o = bars[j].open > 0 ? bars[j].open : bars[j].close;
      const c = bars[j].close;

      const hl = Math.log(h / l);
      const co = Math.log(c / o);
      // GK Formula: 0.5 * (ln(H/L))^2 - (2ln2 - 1) * (ln(C/O))^2
      sum += 0.5 * hl * hl - (2 * Math.log(2) - 1) * co * co;
    }
    result.push(Math.sqrt((sum / window) * 252));
  }
  return result;
}

/**
 * 6. Rogers-Satchell Volatility
 * Best for trending assets. It allows for non-zero drift (trend) without
 * inflating the volatility calculation.
 */
function rogersSatchellVolatility(bars: PriceBar[], window: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < bars.length; i++) {
    if (i < window - 1) {
      result.push(NaN);
      continue;
    }
    let sum = 0;
    for (let j = i - window + 1; j <= i; j++) {
      const h = bars[j].high;
      const l = bars[j].low;
      const o = bars[j].open;
      const c = bars[j].close;
      
      // Safety for bad data
      if (h <= 0 || l <= 0 || o <= 0 || c <= 0) continue;

      // RS Formula: ln(H/C)*ln(H/O) + ln(L/C)*ln(L/O)
      sum += Math.log(h / c) * Math.log(h / o) + Math.log(l / c) * Math.log(l / o);
    }
    result.push(Math.sqrt((sum / window) * 252));
  }
  return result;
}

/**
 * 7. Yang-Zhang Volatility (The "Gold Standard")
 * A weighted average of Rogers-Satchell (Intraday) and Open-Close (Overnight) volatility.
 * This is the minimum variance estimator.
 */
function yangZhangVolatility(bars: PriceBar[], window: number): number[] {
  const result: number[] = [];
  // k constant minimizes variance
  const k = 0.34 / (1.34 + (window + 1) / (window - 1));

  for (let i = 0; i < bars.length; i++) {
    if (i < window) { // Needs window + 1 previous day for overnight gap
      result.push(NaN);
      continue;
    }

    const slice = bars.slice(i - window + 1, i + 1);
    const prevSlice = bars.slice(i - window, i); // Offset by 1 for prev close

    // 1. Overnight Vol (Close_prev to Open_curr)
    const overnightReturns = slice.map((bar, idx) => Math.log(bar.open / prevSlice[idx].close));
    const varOpen = historicalVolatility(overnightReturns) ** 2 / 252; // De-annualize for calculation

    // 2. Open-to-Close Vol (Open_curr to Close_curr)
    const openCloseReturns = slice.map(bar => Math.log(bar.close / bar.open));
    const varClose = historicalVolatility(openCloseReturns) ** 2 / 252;

    // 3. Rogers-Satchell Vol (Intraday)
    let sumRS = 0;
    for (const bar of slice) {
      const { high: h, low: l, open: o, close: c } = bar;
      if (h>0 && l>0 && o>0 && c>0) {
        sumRS += Math.log(h/c)*Math.log(h/o) + Math.log(l/c)*Math.log(l/o);
      }
    }
    const varRS = sumRS / window;

    // Combine: YZ = Var_open + k * Var_close + (1-k) * Var_RS
    const varYZ = varOpen + k * varClose + (1 - k) * varRS;
    
    result.push(Math.sqrt(varYZ * 252));
  }
  return result;
}

/**
 * Main Function: Compute All Measures
 */
export function computeVolatilityMeasures(bars: PriceBar[]): VolatilityPoint[] {
  if (bars.length < 2) return [];
  
  const closes = bars.map(b => b.close);
  const logReturns = computeLogReturns(closes);
  
  // Compute individual series
  const rolling20 = rollingVolatility(logReturns, 20);
  const rolling60 = rollingVolatility(logReturns, 60);
  const rolling120 = rollingVolatility(logReturns, 120);
  const ewma94 = ewmaVolatility(logReturns, 0.94);
  const ewma97 = ewmaVolatility(logReturns, 0.97);
  const parkinson = parkinsonVolatility(bars, 20);
  const garmanKlass = garmanKlassVolatility(bars, 20);
  const rogersSatchell = rogersSatchellVolatility(bars, 20);
  const yangZhang = yangZhangVolatility(bars, 20);
  
  const histVol = historicalVolatility(logReturns);
  
  const result: VolatilityPoint[] = [];
  
  // Align all arrays (they might have different starting NaN padding)
  for (let i = 1; i < bars.length; i++) {
    result.push({
      date: bars[i].date,
      historical: histVol,
      rolling20: rolling20[i - 1] || NaN,
      rolling60: rolling60[i - 1] || NaN,
      rolling120: rolling120[i - 1] || NaN,
      ewma94: ewma94[i - 1] || NaN,
      ewma97: ewma97[i - 1] || NaN,
      parkinson: parkinson[i] || NaN,
      garmanKlass: garmanKlass[i] || NaN,
      rogersSatchell: rogersSatchell[i] || NaN,
      yangZhang: yangZhang[i] || NaN,
    });
  }
  
  return result;
}

/**
 * Event Analysis (Fixed Date Matching + Series Support)
 */
export function compareVolatilityAroundEvent(
  series: VolatilityPoint[],
  eventDate: string,
  windowDays: number = 30
): {
  date: string;
  before: number;
  after: number;
  change: number;
  changePercent: number;
} | null {
  if (!series || series.length === 0) return null;

  // Normalize date
  const target = String(eventDate).slice(0, 10);
  let foundIdx = series.findIndex(d => String(d.date).slice(0, 10) === target);
  
  // Fuzzy match if exact date is missing (weekend/holiday)
  if (foundIdx === -1) {
     foundIdx = series.findIndex(d => String(d.date).slice(0, 10) > target);
  }

  if (foundIdx === -1 || foundIdx < windowDays || foundIdx + windowDays >= series.length) {
    return { date: eventDate, before: 0, after: 0, change: 0, changePercent: 0 };
  }
  
  const beforeSlice = series.slice(foundIdx - windowDays, foundIdx);
  const afterSlice = series.slice(foundIdx, foundIdx + windowDays);

  // Use 'rolling20' as the benchmark for event studies (standard practice)
  const getAvgVol = (slice: VolatilityPoint[]) => {
    const valid = slice
      .map(p => p.rolling20)
      .filter(v => v !== undefined && !isNaN(v) && v > 0);
    if (valid.length === 0) return 0;
    return valid.reduce((sum, v) => sum + v, 0) / valid.length;
  };

  const beforeVol = getAvgVol(beforeSlice);
  const afterVol = getAvgVol(afterSlice);
  const change = afterVol - beforeVol;
  const changePercent = beforeVol > 0.0001 ? (change / beforeVol) * 100 : 0;
  
  return {
    date: eventDate,
    before: beforeVol,
    after: afterVol,
    change,
    changePercent,
  };
}

/**
 * Volatility Cone Helper
 * Returns expected price range for n-days out based on current vol
 */
export function calculateVolatilityCone(currentPrice: number, volatility: number, days: number) {
  const dailyVol = volatility / Math.sqrt(252);
  const variance = dailyVol * Math.sqrt(days);
  return {
    upper1sigma: currentPrice * (1 + variance),
    lower1sigma: currentPrice * (1 - variance),
    upper2sigma: currentPrice * (1 + 2 * variance),
    lower2sigma: currentPrice * (1 - 2 * variance),
  };
}

export function currentVolatilityPercentile(
  currentVol: number | null,
  historicalVols: (number | null)[]
): number {
  if (currentVol === null || currentVol === undefined) return 0;
  const validVols = historicalVols.filter((v): v is number => v !== null && !isNaN(v));
  if (validVols.length === 0) return 0;
  const belowCount = validVols.filter(v => v <= currentVol).length;
  return (belowCount / validVols.length) * 100;
}

/**
 * Regime Analysis Utilities
 */

export type RegimePoint = {
  date: string;
  regime: string;
  volatility: number;
};

export type RegimeStats = {
  currentDuration: number;
  averageDuration: number;
  lastShift: string | null;
};

export type RegimePeriod = {
  regime: string;
  start: string;
  end: string;
};

/**
 * Calculate regime duration statistics
 *
 * @param series Array of regime points sorted by date
 * @returns RegimeStats object
 */
export function calculateRegimeDuration(series: RegimePoint[]): RegimeStats {
  if (series.length === 0) {
    return {
      currentDuration: 0,
      averageDuration: 0,
      lastShift: null,
    };
  }

  const currentRegime = series[series.length - 1].regime;
  let currentDuration = 0;
  let lastShift: string | null = null;

  // Walk backward to find current duration
  for (let i = series.length - 1; i >= 0; i--) {
    if (series[i].regime === currentRegime) {
      currentDuration++;
    } else {
      // Found the shift point
      if (i + 1 < series.length) {
        lastShift = series[i + 1].date;
      }
      break;
    }
  }

  // If we went through the entire array, there's no previous regime
  if (currentDuration === series.length) {
    lastShift = series[0].date;
  }

  // Calculate average regime duration
  const durations: number[] = [];
  let tempDuration = 1;

  for (let i = 1; i < series.length; i++) {
    if (series[i].regime === series[i - 1].regime) {
      tempDuration++;
    } else {
      durations.push(tempDuration);
      tempDuration = 1;
    }
  }

  // Add the last duration
  if (tempDuration > 0) {
    durations.push(tempDuration);
  }

  const averageDuration =
    durations.length > 0
      ? durations.reduce((sum, d) => sum + d, 0) / durations.length
      : currentDuration;

  return {
    currentDuration,
    averageDuration: Math.round(averageDuration),
    lastShift,
  };
}

/**
 * Group consecutive regime periods for visualization
 *
 * @param data Array of regime points
 * @returns Array of regime periods with start/end dates
 */
export function groupRegimePeriods(data: RegimePoint[]): RegimePeriod[] {
  if (data.length === 0) return [];

  const periods: RegimePeriod[] = [];
  let currentPeriod: RegimePeriod | null = null;

  for (const point of data) {
    if (!currentPeriod || currentPeriod.regime !== point.regime) {
      // Start new period
      if (currentPeriod) {
        periods.push(currentPeriod);
      }
      currentPeriod = {
        regime: point.regime,
        start: point.date,
        end: point.date,
      };
    } else {
      // Extend current period
      currentPeriod.end = point.date;
    }
  }

  // Add the last period
  if (currentPeriod) {
    periods.push(currentPeriod);
  }

  return periods;
}