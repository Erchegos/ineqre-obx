// apps/web/src/lib/volatility.ts

/**
 * Advanced Volatility Estimation Library
 * Implements multiple volatility measures for risk analysis
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
};

/**
 * Compute log returns from prices
 */
function computeLogReturns(prices: number[]): number[] {
  const returns: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    returns.push(Math.log(prices[i] / prices[i - 1]));
  }
  return returns;
}

/**
 * Historical volatility (annualized)
 */
export function historicalVolatility(returns: number[]): number {
  if (returns.length < 2) return 0;
  
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / (returns.length - 1);
  
  return Math.sqrt(variance * 252);
}

/**
 * Rolling window volatility
 */
function rollingVolatility(returns: number[], window: number): number[] {
  const result: number[] = [];
  
  for (let i = 0; i < returns.length; i++) {
    if (i < window - 1) {
      result.push(NaN);
      continue;
    }
    
    const windowReturns = returns.slice(i - window + 1, i + 1);
    const vol = historicalVolatility(windowReturns);
    result.push(vol);
  }
  
  return result;
}

/**
 * EWMA Volatility
 */
function ewmaVolatility(returns: number[], lambda: number): number[] {
  const result: number[] = [];
  
  if (returns.length === 0) return result;
  
  let variance = returns[0] * returns[0];
  result.push(Math.sqrt(variance * 252));
  
  for (let i = 1; i < returns.length; i++) {
    variance = lambda * variance + (1 - lambda) * returns[i] * returns[i];
    result.push(Math.sqrt(variance * 252));
  }
  
  return result;
}

/**
 * Parkinson volatility estimator
 */
function parkinsonVolatility(bars: PriceBar[], window: number): number[] {
  const result: number[] = [];
  
  for (let i = 0; i < bars.length; i++) {
    if (i < window - 1) {
      result.push(NaN);
      continue;
    }
    
    let sumHL = 0;
    for (let j = i - window + 1; j <= i; j++) {
      const hl = Math.log(bars[j].high / bars[j].low);
      sumHL += hl * hl;
    }
    
    const vol = Math.sqrt((1 / (4 * Math.log(2))) * (sumHL / window)) * Math.sqrt(252);
    result.push(vol);
  }
  
  return result;
}

/**
 * Garman-Klass volatility estimator
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
      const hl = Math.log(bars[j].high / bars[j].low);
      const co = Math.log(bars[j].close / bars[j].open);
      sum += 0.5 * hl * hl - (2 * Math.log(2) - 1) * co * co;
    }
    
    const vol = Math.sqrt((sum / window) * 252);
    result.push(vol);
  }
  
  return result;
}

/**
 * Compute all volatility measures
 */
export function computeVolatilityMeasures(bars: PriceBar[]): VolatilityPoint[] {
  if (bars.length < 2) return [];
  
  const closes = bars.map(b => b.close);
  const logReturns = computeLogReturns(closes);
  
  const rolling20 = rollingVolatility(logReturns, 20);
  const rolling60 = rollingVolatility(logReturns, 60);
  const rolling120 = rollingVolatility(logReturns, 120);
  const ewma94 = ewmaVolatility(logReturns, 0.94);
  const ewma97 = ewmaVolatility(logReturns, 0.97);
  const parkinson = parkinsonVolatility(bars, 60);
  const garmanKlass = garmanKlassVolatility(bars, 60);
  
  const histVol = historicalVolatility(logReturns);
  
  const result: VolatilityPoint[] = [];
  
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
    });
  }
  
  return result;
}

/**
 * Compare volatility before/after event
 */
export function compareVolatilityAroundEvent(
  returns: number[],
  dates: string[],
  eventDate: string,
  windowDays: number = 30
): {
  before: number;
  after: number;
  change: number;
  changePercent: number;
} {
  const eventIdx = dates.findIndex(d => d === eventDate);
  
  if (eventIdx === -1 || eventIdx < windowDays) {
    return { before: 0, after: 0, change: 0, changePercent: 0 };
  }
  
  const beforeReturns = returns.slice(Math.max(0, eventIdx - windowDays), eventIdx);
  const afterReturns = returns.slice(eventIdx, Math.min(returns.length, eventIdx + windowDays));
  
  const beforeVol = historicalVolatility(beforeReturns);
  const afterVol = historicalVolatility(afterReturns);
  const change = afterVol - beforeVol;
  const changePercent = beforeVol > 0 ? (change / beforeVol) * 100 : 0;
  
  return {
    before: beforeVol,
    after: afterVol,
    change,
    changePercent,
  };
}

/**
 * Current volatility percentile
 */
export function currentVolatilityPercentile(
  currentVol: number,
  historicalVols: number[]
): number {
  const validVols = historicalVols.filter(v => !isNaN(v) && isFinite(v));
  if (validVols.length === 0) return 0;
  
  const belowCount = validVols.filter(v => v <= currentVol).length;
  return (belowCount / validVols.length) * 100;
}
