/**
 * STD Channel Strategy Module
 *
 * Strategy 4: Slope-Aligned Mean Reversion with Fundamental Quality Filter
 *
 * CORE PRINCIPLE: Trade mean reversion WITH the trend, not against it.
 * Use fundamentals to filter out value traps.
 *
 * ENTRY RULES:
 * - LONG: slope > 0 (uptrend) AND price < lowerBand1.5σ AND fundamentals pass
 * - SHORT: slope < 0 (downtrend) AND price > upperBand1.5σ AND fundamentals pass
 *
 * EXIT RULES:
 * - Target: midLine (mean reversion target)
 * - Stop: Beyond entry band (e.g., if entered at -1.5σ, stop at -2.5σ)
 * - Time stop: 21 trading days max holding period
 *
 * FUNDAMENTAL FILTERS:
 * - Quality: ep > 0 (positive earnings)
 * - Momentum: mom6m > universe median (not falling knife)
 * - Value: bm > 0.3 (some book value backing)
 */

// ============================================================================
// Types
// ============================================================================

export interface STDChannelData {
  date: string;
  close: number;
  midLine: number;
  upperBand1: number;
  lowerBand1: number;
  upperBand2: number;
  lowerBand2: number;
}

export interface ChannelMetadata {
  slope: number;
  sigma: number;
  r2: number;
  windowSize: number;
}

export interface FundamentalFactors {
  ep: number | null;      // Earnings yield
  bm: number | null;      // Book-to-market
  mom6m: number | null;   // 6-month momentum
  mom1m: number | null;   // 1-month momentum (reversal)
  vol12m: number | null;  // 12-month volatility
  mktcap: number | null;  // Market cap
}

export interface SignalResult {
  date: string;
  ticker: string;
  signal: 'LONG' | 'SHORT' | 'NONE';
  sigmaDistance: number;  // How many σ from midLine
  slope: number;
  r2: number;
  fundamentalScore: number;
  confidence: number;
  entryPrice: number;
  targetPrice: number;    // midLine
  stopPrice: number;      // Beyond entry band
  reasons: string[];
}

export interface TradeResult {
  ticker: string;
  entryDate: string;
  exitDate: string;
  signal: 'LONG' | 'SHORT';
  entryPrice: number;
  exitPrice: number;
  returnPct: number;
  holdingDays: number;
  exitReason: 'TARGET' | 'STOP' | 'TIME' | 'SIGNAL_FLIP';
  sigmaAtEntry: number;
  sigmaAtExit: number;
}

export interface BacktestResult {
  ticker: string;
  totalTrades: number;
  winRate: number;
  avgReturn: number;
  totalReturn: number;
  maxDrawdown: number;
  sharpeRatio: number;
  profitFactor: number;
  avgHoldingDays: number;
  trades: TradeResult[];
}

// ============================================================================
// Strategy Parameters
// ============================================================================

export const DEFAULT_STRATEGY_PARAMS = {
  // Entry thresholds (σ from midLine)
  entryThresholdSigma: 1.5,      // Enter when price is 1.5σ from midLine
  extremeThresholdSigma: 2.0,    // Stronger signal at 2σ

  // Exit thresholds
  targetSigma: 0,                // Exit at midLine (0σ)
  stopSigma: 2.5,                // Stop loss beyond entry band
  maxHoldingDays: 21,            // Time stop (1 month)

  // Quality filters
  minR2: 0.4,                    // Minimum R² for channel quality
  minSlope: 0.0001,              // Minimum absolute slope (avoid flat)

  // Fundamental filters
  minEP: 0,                      // Positive earnings required
  minBM: 0.2,                    // Minimum book-to-market
  mom6mPercentile: 40,           // Mom6m must be above 40th percentile

  // Position sizing
  maxPositionPct: 0.05,          // 5% max position size
  sigmaScaling: true,            // Scale position size inverse to sigma
};

export type StrategyParams = typeof DEFAULT_STRATEGY_PARAMS;

// ============================================================================
// Signal Generation
// ============================================================================

/**
 * Calculate distance from midLine in σ units
 */
export function calculateSigmaDistance(
  price: number,
  midLine: number,
  sigma: number
): number {
  if (sigma === 0) return 0;
  return (price - midLine) / sigma;
}

/**
 * Check if fundamentals pass quality filter
 */
export function checkFundamentalQuality(
  factors: FundamentalFactors,
  params: StrategyParams = DEFAULT_STRATEGY_PARAMS
): { pass: boolean; score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;
  let checks = 0;

  // Earnings yield check
  if (factors.ep !== null) {
    checks++;
    if (factors.ep > params.minEP) {
      score++;
      reasons.push(`EP: ${(factors.ep * 100).toFixed(1)}% (positive)`);
    } else {
      reasons.push(`EP: ${(factors.ep * 100).toFixed(1)}% (negative - FAIL)`);
    }
  }

  // Book-to-market check
  if (factors.bm !== null) {
    checks++;
    if (factors.bm > params.minBM) {
      score++;
      reasons.push(`BM: ${factors.bm.toFixed(2)} (above ${params.minBM})`);
    } else {
      reasons.push(`BM: ${factors.bm.toFixed(2)} (below ${params.minBM} - FAIL)`);
    }
  }

  // Mom6m is checked separately against universe percentile
  // For now, we just note if it's positive
  if (factors.mom6m !== null) {
    if (factors.mom6m > 0) {
      reasons.push(`Mom6m: ${(factors.mom6m * 100).toFixed(1)}% (positive)`);
    } else {
      reasons.push(`Mom6m: ${(factors.mom6m * 100).toFixed(1)}% (negative)`);
    }
  }

  // Pass if majority of checks pass (or if we have limited data)
  const pass = checks === 0 || score >= checks * 0.5;
  const finalScore = checks > 0 ? score / checks : 0.5;

  return { pass, score: finalScore, reasons };
}

/**
 * Generate trading signal for a single day
 */
export function generateSignal(
  channelData: STDChannelData,
  metadata: ChannelMetadata,
  factors: FundamentalFactors,
  ticker: string,
  params: StrategyParams = DEFAULT_STRATEGY_PARAMS
): SignalResult {
  const { close, midLine, upperBand1, lowerBand1 } = channelData;
  const { slope, sigma, r2 } = metadata;

  const sigmaDistance = calculateSigmaDistance(close, midLine, sigma);
  const fundamentalCheck = checkFundamentalQuality(factors, params);

  const result: SignalResult = {
    date: channelData.date,
    ticker,
    signal: 'NONE',
    sigmaDistance,
    slope,
    r2,
    fundamentalScore: fundamentalCheck.score,
    confidence: 0,
    entryPrice: close,
    targetPrice: midLine,
    stopPrice: close,
    reasons: [...fundamentalCheck.reasons],
  };

  // Quality checks
  if (r2 < params.minR2) {
    result.reasons.push(`R² ${r2.toFixed(3)} < ${params.minR2} (poor channel fit)`);
    return result;
  }

  if (Math.abs(slope) < params.minSlope) {
    result.reasons.push(`Slope ${slope.toFixed(6)} too flat`);
    return result;
  }

  // Fundamental filter
  if (!fundamentalCheck.pass) {
    result.reasons.push('Fundamentals FAIL');
    return result;
  }

  // LONG SIGNAL: Uptrend + Oversold
  if (slope > 0 && sigmaDistance < -params.entryThresholdSigma) {
    result.signal = 'LONG';
    result.stopPrice = midLine - params.stopSigma * sigma;
    result.confidence = calculateConfidence(sigmaDistance, r2, fundamentalCheck.score, 'LONG');
    result.reasons.push(`LONG: Uptrend (slope=${slope.toFixed(4)}) + Oversold (${sigmaDistance.toFixed(2)}σ)`);
  }

  // SHORT SIGNAL: Downtrend + Overbought
  else if (slope < 0 && sigmaDistance > params.entryThresholdSigma) {
    result.signal = 'SHORT';
    result.stopPrice = midLine + params.stopSigma * sigma;
    result.confidence = calculateConfidence(sigmaDistance, r2, fundamentalCheck.score, 'SHORT');
    result.reasons.push(`SHORT: Downtrend (slope=${slope.toFixed(4)}) + Overbought (${sigmaDistance.toFixed(2)}σ)`);
  }

  return result;
}

/**
 * Calculate signal confidence (0-1)
 */
function calculateConfidence(
  sigmaDistance: number,
  r2: number,
  fundamentalScore: number,
  signal: 'LONG' | 'SHORT'
): number {
  // Sigma component: more extreme = more confident
  const absSigma = Math.abs(sigmaDistance);
  const sigmaConf = Math.min(1, (absSigma - 1) / 1.5); // 0 at 1σ, 1 at 2.5σ

  // R² component: better fit = more confident
  const r2Conf = Math.min(1, (r2 - 0.5) / 0.4); // 0 at 0.5, 1 at 0.9

  // Fundamental component
  const fundConf = fundamentalScore;

  // Weighted average
  return sigmaConf * 0.4 + r2Conf * 0.3 + fundConf * 0.3;
}

// ============================================================================
// Trade Simulation
// ============================================================================

/**
 * Simulate a single trade from entry to exit
 */
export function simulateTrade(
  entrySignal: SignalResult,
  priceData: Array<{ date: string; close: number; midLine: number }>,
  sigma: number,
  params: StrategyParams = DEFAULT_STRATEGY_PARAMS
): TradeResult | null {
  if (entrySignal.signal === 'NONE') return null;

  const entryIdx = priceData.findIndex(d => d.date === entrySignal.date);
  if (entryIdx === -1 || entryIdx >= priceData.length - 1) return null;

  const entry = priceData[entryIdx];
  const isLong = entrySignal.signal === 'LONG';

  let exitIdx = entryIdx + 1;
  let exitReason: TradeResult['exitReason'] = 'TIME';

  // Simulate forward
  while (exitIdx < priceData.length && exitIdx - entryIdx < params.maxHoldingDays) {
    const current = priceData[exitIdx];
    const currentSigma = calculateSigmaDistance(current.close, current.midLine, sigma);

    // Check target (midLine reached)
    if (isLong && currentSigma >= params.targetSigma) {
      exitReason = 'TARGET';
      break;
    }
    if (!isLong && currentSigma <= params.targetSigma) {
      exitReason = 'TARGET';
      break;
    }

    // Check stop loss
    if (isLong && currentSigma < -params.stopSigma) {
      exitReason = 'STOP';
      break;
    }
    if (!isLong && currentSigma > params.stopSigma) {
      exitReason = 'STOP';
      break;
    }

    exitIdx++;
  }

  // Ensure we don't go beyond data
  if (exitIdx >= priceData.length) {
    exitIdx = priceData.length - 1;
  }

  const exit = priceData[exitIdx];
  const exitSigma = calculateSigmaDistance(exit.close, exit.midLine, sigma);

  // Calculate return
  let returnPct: number;
  if (isLong) {
    returnPct = (exit.close - entry.close) / entry.close;
  } else {
    returnPct = (entry.close - exit.close) / entry.close;
  }

  return {
    ticker: entrySignal.ticker,
    entryDate: entry.date,
    exitDate: exit.date,
    signal: entrySignal.signal,
    entryPrice: entry.close,
    exitPrice: exit.close,
    returnPct,
    holdingDays: exitIdx - entryIdx,
    exitReason,
    sigmaAtEntry: entrySignal.sigmaDistance,
    sigmaAtExit: exitSigma,
  };
}

// ============================================================================
// Backtest Engine
// ============================================================================

/**
 * Run backtest for a single ticker
 */
export function runTickerBacktest(
  ticker: string,
  channelData: STDChannelData[],
  metadata: ChannelMetadata,
  factors: FundamentalFactors,
  params: StrategyParams = DEFAULT_STRATEGY_PARAMS
): BacktestResult {
  const trades: TradeResult[] = [];
  const returns: number[] = [];

  let i = 0;
  while (i < channelData.length - params.maxHoldingDays) {
    const signal = generateSignal(channelData[i], metadata, factors, ticker, params);

    if (signal.signal !== 'NONE') {
      const priceData = channelData.slice(i).map(d => ({
        date: d.date,
        close: d.close,
        midLine: d.midLine,
      }));

      const trade = simulateTrade(signal, priceData, metadata.sigma, params);

      if (trade) {
        trades.push(trade);
        returns.push(trade.returnPct);

        // Skip to after exit (no overlapping trades)
        i += trade.holdingDays + 1;
        continue;
      }
    }

    i++;
  }

  // Calculate metrics
  const wins = trades.filter(t => t.returnPct > 0);
  const losses = trades.filter(t => t.returnPct <= 0);

  const winRate = trades.length > 0 ? wins.length / trades.length : 0;
  const avgReturn = returns.length > 0
    ? returns.reduce((a, b) => a + b, 0) / returns.length
    : 0;

  // Cumulative return
  const totalReturn = returns.reduce((cum, r) => cum * (1 + r), 1) - 1;

  // Max drawdown
  let peak = 1;
  let maxDD = 0;
  let cumValue = 1;
  for (const r of returns) {
    cumValue *= (1 + r);
    peak = Math.max(peak, cumValue);
    const dd = (cumValue - peak) / peak;
    maxDD = Math.min(maxDD, dd);
  }

  // Sharpe ratio (assuming monthly-ish trades)
  const mean = avgReturn;
  const variance = returns.length > 1
    ? returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / (returns.length - 1)
    : 0;
  const stdDev = Math.sqrt(variance);
  const sharpeRatio = stdDev > 0 ? (mean / stdDev) * Math.sqrt(12) : 0; // Annualized

  // Profit factor
  const grossProfit = wins.reduce((sum, t) => sum + t.returnPct, 0);
  const grossLoss = Math.abs(losses.reduce((sum, t) => sum + t.returnPct, 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 999 : 0;

  // Average holding days
  const avgHoldingDays = trades.length > 0
    ? trades.reduce((sum, t) => sum + t.holdingDays, 0) / trades.length
    : 0;

  return {
    ticker,
    totalTrades: trades.length,
    winRate,
    avgReturn,
    totalReturn,
    maxDrawdown: maxDD,
    sharpeRatio,
    profitFactor,
    avgHoldingDays,
    trades,
  };
}

// ============================================================================
// Position Sizing
// ============================================================================

/**
 * Calculate position size based on signal confidence and volatility
 */
export function calculatePositionSize(
  signal: SignalResult,
  portfolioValue: number,
  sigma: number,
  params: StrategyParams = DEFAULT_STRATEGY_PARAMS
): number {
  if (signal.signal === 'NONE') return 0;

  // Base position size
  let size = portfolioValue * params.maxPositionPct;

  // Scale by confidence
  size *= (0.5 + signal.confidence * 0.5); // 50-100% of max based on confidence

  // Scale inverse to sigma (wider channels = smaller positions)
  if (params.sigmaScaling && sigma > 0) {
    const sigmaNormalized = sigma / signal.entryPrice; // As percentage
    const sigmaFactor = Math.min(1, 0.02 / sigmaNormalized); // Target 2% sigma, scale down if higher
    size *= sigmaFactor;
  }

  return Math.round(size * 100) / 100; // Round to cents
}

// ============================================================================
// Signal Summary for Dashboard
// ============================================================================

export interface DashboardSignal {
  ticker: string;
  date: string;
  signal: 'LONG' | 'SHORT' | 'NONE';
  sigmaDistance: number;
  slopeDirection: 'UP' | 'DOWN' | 'FLAT';
  r2Quality: 'EXCELLENT' | 'GOOD' | 'FAIR' | 'POOR';
  fundamentalGrade: 'A' | 'B' | 'C' | 'F';
  confidence: number;
  targetReturn: number; // Expected return to midLine
  riskReward: number;
  summary: string;
}

export function generateDashboardSignal(
  signal: SignalResult,
  metadata: ChannelMetadata
): DashboardSignal {
  // Slope direction
  let slopeDirection: DashboardSignal['slopeDirection'] = 'FLAT';
  if (metadata.slope > 0.0001) slopeDirection = 'UP';
  else if (metadata.slope < -0.0001) slopeDirection = 'DOWN';

  // R² quality
  let r2Quality: DashboardSignal['r2Quality'] = 'POOR';
  if (metadata.r2 >= 0.8) r2Quality = 'EXCELLENT';
  else if (metadata.r2 >= 0.65) r2Quality = 'GOOD';
  else if (metadata.r2 >= 0.5) r2Quality = 'FAIR';

  // Fundamental grade
  let fundamentalGrade: DashboardSignal['fundamentalGrade'] = 'F';
  if (signal.fundamentalScore >= 0.8) fundamentalGrade = 'A';
  else if (signal.fundamentalScore >= 0.6) fundamentalGrade = 'B';
  else if (signal.fundamentalScore >= 0.4) fundamentalGrade = 'C';

  // Target return (distance to midLine)
  const targetReturn = signal.signal === 'LONG'
    ? (signal.targetPrice - signal.entryPrice) / signal.entryPrice
    : signal.signal === 'SHORT'
    ? (signal.entryPrice - signal.targetPrice) / signal.entryPrice
    : 0;

  // Risk/reward ratio
  const riskToStop = Math.abs(signal.entryPrice - signal.stopPrice) / signal.entryPrice;
  const riskReward = riskToStop > 0 ? targetReturn / riskToStop : 0;

  // Summary text
  let summary = '';
  if (signal.signal === 'LONG') {
    summary = `LONG: Price ${Math.abs(signal.sigmaDistance).toFixed(1)}σ below trend in uptrend channel`;
  } else if (signal.signal === 'SHORT') {
    summary = `SHORT: Price ${Math.abs(signal.sigmaDistance).toFixed(1)}σ above trend in downtrend channel`;
  } else {
    summary = 'No signal: ' + (signal.reasons[signal.reasons.length - 1] || 'conditions not met');
  }

  return {
    ticker: signal.ticker,
    date: signal.date,
    signal: signal.signal,
    sigmaDistance: signal.sigmaDistance,
    slopeDirection,
    r2Quality,
    fundamentalGrade,
    confidence: signal.confidence,
    targetReturn,
    riskReward,
    summary,
  };
}
