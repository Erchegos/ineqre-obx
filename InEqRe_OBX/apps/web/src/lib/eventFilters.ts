/**
 * Event-Driven Filters for STD Channel Strategy
 *
 * Purpose: Distinguish between mean-reverting opportunities and regime shifts.
 * A 3σ move could be:
 *   - Temporary overreaction (technical) → TRADE
 *   - Fundamental regime shift (news) → AVOID
 *
 * Filter Categories (orthogonal information):
 * 1. Volume Anomaly - Informed trading detection
 * 2. Gap Detection - Overnight news events
 * 3. Market Context - Systematic vs idiosyncratic
 * 4. Volatility Regime - Risk environment
 * 5. Fundamental Stability - Recent earnings/guidance changes
 * 6. Research Activity - Analyst coverage timing
 * 7. Liquidity Quality - Manipulation risk
 * 8. Momentum Divergence - Trend exhaustion signals
 *
 * Each filter returns a score from 0 (avoid) to 1 (proceed) with reasoning.
 */

// ============================================================================
// Types
// ============================================================================

export interface FilterResult {
  name: string;
  score: number;           // 0 = avoid, 0.5 = neutral, 1 = proceed
  weight: number;          // Importance weight (sum to 1)
  reason: string;          // Human-readable explanation
  data?: Record<string, unknown>;  // Supporting data
}

export interface EventFilterInput {
  ticker: string;
  currentDate: string;
  signal: 'LONG' | 'SHORT';
  sigmaDistance: number;

  // Price data (current + history)
  currentPrice: number;
  previousClose: number;
  open: number;
  high: number;
  low: number;
  volume: number;

  // Historical context (trailing 20 days)
  avgVolume20d: number;
  avgRange20d: number;     // Average (high-low)/close
  priceHistory: Array<{
    date: string;
    close: number;
    volume: number;
    high: number;
    low: number;
  }>;

  // Market context
  marketReturn?: number;   // OBX index return same day
  sectorReturn?: number;   // Sector average return
  marketVolatility?: number; // VIX-equivalent for Oslo

  // Factors (current and lagged)
  currentFactors: {
    ep: number | null;
    bm: number | null;
    mom1m: number | null;
    mom6m: number | null;
    vol1m: number | null;
    vol12m: number | null;
    beta: number | null;
    mktcap: number | null;
  };
  laggedFactors?: {
    ep: number | null;
    bm: number | null;
    mom1m: number | null;
    mom6m: number | null;
  };

  // Research data
  recentResearchCount?: number;  // Research docs in last 7 days
  lastResearchDate?: string;

  // Calendar
  dayOfWeek: number;       // 0=Sunday, 1=Monday, etc.
  dayOfMonth: number;
  isMonthEnd: boolean;
  isQuarterEnd: boolean;
}

export interface CompositeFilterResult {
  overallScore: number;    // 0-1 composite score
  recommendation: 'PROCEED' | 'CAUTION' | 'AVOID';
  filters: FilterResult[];
  summary: string;
}

// ============================================================================
// Individual Filters
// ============================================================================

/**
 * FILTER 1: Volume Anomaly Detection
 *
 * Economic rationale: High volume during extreme moves suggests informed
 * trading / news flow. These moves are less likely to mean-revert.
 *
 * Scoring:
 * - Volume < 1.5x average → 1.0 (technical move, good to trade)
 * - Volume 1.5-2.5x average → 0.6 (moderate caution)
 * - Volume 2.5-4x average → 0.3 (likely news-driven)
 * - Volume > 4x average → 0.1 (definitely news, avoid)
 */
export function volumeAnomalyFilter(input: EventFilterInput): FilterResult {
  const volumeRatio = input.avgVolume20d > 0
    ? input.volume / input.avgVolume20d
    : 1;

  let score: number;
  let reason: string;

  if (volumeRatio < 1.5) {
    score = 1.0;
    reason = `Normal volume (${volumeRatio.toFixed(1)}x avg) - technical move`;
  } else if (volumeRatio < 2.5) {
    score = 0.6;
    reason = `Elevated volume (${volumeRatio.toFixed(1)}x avg) - moderate caution`;
  } else if (volumeRatio < 4.0) {
    score = 0.3;
    reason = `High volume (${volumeRatio.toFixed(1)}x avg) - likely news-driven`;
  } else {
    score = 0.1;
    reason = `Extreme volume (${volumeRatio.toFixed(1)}x avg) - strong news event`;
  }

  return {
    name: 'Volume Anomaly',
    score,
    weight: 0.20,  // High importance
    reason,
    data: { volumeRatio, volume: input.volume, avgVolume: input.avgVolume20d },
  };
}

/**
 * FILTER 2: Gap Detection
 *
 * Economic rationale: Overnight gaps indicate news released outside
 * market hours. These are fundamentally-driven, less likely to revert.
 *
 * Scoring:
 * - Gap < 1% → 1.0 (no overnight news)
 * - Gap 1-3% → 0.7 (minor news)
 * - Gap 3-5% → 0.4 (significant news)
 * - Gap > 5% → 0.15 (major news event)
 */
export function gapDetectionFilter(input: EventFilterInput): FilterResult {
  const gapPct = Math.abs((input.open - input.previousClose) / input.previousClose) * 100;

  // Direction matters: gap in same direction as signal is worse
  const gapDirection = input.open > input.previousClose ? 'UP' : 'DOWN';
  const signalAligned = (input.signal === 'LONG' && gapDirection === 'DOWN') ||
                        (input.signal === 'SHORT' && gapDirection === 'UP');

  let score: number;
  let reason: string;

  if (gapPct < 1) {
    score = 1.0;
    reason = `No significant gap (${gapPct.toFixed(1)}%) - no overnight news`;
  } else if (gapPct < 3) {
    score = signalAligned ? 0.75 : 0.6;
    reason = `Minor gap ${gapDirection} (${gapPct.toFixed(1)}%) - ${signalAligned ? 'aligned with signal' : 'against signal'}`;
  } else if (gapPct < 5) {
    score = signalAligned ? 0.5 : 0.3;
    reason = `Significant gap ${gapDirection} (${gapPct.toFixed(1)}%) - material news`;
  } else {
    score = 0.15;
    reason = `Large gap ${gapDirection} (${gapPct.toFixed(1)}%) - major news event`;
  }

  return {
    name: 'Gap Detection',
    score,
    weight: 0.15,
    reason,
    data: { gapPct, gapDirection, signalAligned },
  };
}

/**
 * FILTER 3: Market Context (Beta-adjusted)
 *
 * Economic rationale: If the whole market/sector is moving, the stock's
 * move may be systematic (macro-driven) rather than stock-specific.
 * Systematic moves can persist; idiosyncratic moves more likely to revert.
 *
 * Scoring based on "excess return" = stock return - (beta * market return)
 * - Excess explains most of move → 1.0 (stock-specific, good to trade)
 * - Market explains most → 0.4 (systematic, caution)
 */
export function marketContextFilter(input: EventFilterInput): FilterResult {
  // If no market data, return neutral
  if (input.marketReturn === undefined || input.currentFactors.beta === null) {
    return {
      name: 'Market Context',
      score: 0.7,
      weight: 0.15,
      reason: 'Market data unavailable - neutral assumption',
      data: {},
    };
  }

  const stockReturn = (input.currentPrice - input.previousClose) / input.previousClose;
  const beta = input.currentFactors.beta;
  const expectedReturn = beta * input.marketReturn;
  const excessReturn = stockReturn - expectedReturn;

  // What portion of the move is stock-specific?
  const totalMove = Math.abs(stockReturn);
  const idiosyncraticPortion = totalMove > 0 ? Math.abs(excessReturn) / totalMove : 1;

  let score: number;
  let reason: string;

  if (idiosyncraticPortion > 0.7) {
    score = 1.0;
    reason = `Stock-specific move (${(idiosyncraticPortion * 100).toFixed(0)}% idiosyncratic) - good reversion candidate`;
  } else if (idiosyncraticPortion > 0.4) {
    score = 0.7;
    reason = `Mixed move (${(idiosyncraticPortion * 100).toFixed(0)}% idiosyncratic, ${((1 - idiosyncraticPortion) * 100).toFixed(0)}% market)`;
  } else {
    score = 0.4;
    reason = `Market-driven move (${((1 - idiosyncraticPortion) * 100).toFixed(0)}% explained by beta=${beta.toFixed(2)}) - may persist`;
  }

  return {
    name: 'Market Context',
    score,
    weight: 0.15,
    reason,
    data: {
      stockReturn: stockReturn * 100,
      marketReturn: input.marketReturn * 100,
      beta,
      expectedReturn: expectedReturn * 100,
      excessReturn: excessReturn * 100,
      idiosyncraticPortion,
    },
  };
}

/**
 * FILTER 4: Volatility Regime
 *
 * Economic rationale: In high-volatility regimes, extreme moves are more
 * common and may persist. In low-vol regimes, extreme moves are unusual
 * and more likely to mean-revert.
 *
 * Compares current vol to 12-month average vol.
 */
export function volatilityRegimeFilter(input: EventFilterInput): FilterResult {
  const vol1m = input.currentFactors.vol1m;
  const vol12m = input.currentFactors.vol12m;

  if (vol1m === null || vol12m === null || vol12m === 0) {
    return {
      name: 'Volatility Regime',
      score: 0.7,
      weight: 0.10,
      reason: 'Volatility data unavailable - neutral assumption',
      data: {},
    };
  }

  const volRatio = vol1m / vol12m;

  let score: number;
  let reason: string;

  if (volRatio < 0.8) {
    score = 1.0;
    reason = `Low-vol regime (current ${(vol1m * 100).toFixed(0)}% vs avg ${(vol12m * 100).toFixed(0)}%) - extreme moves unusual, good reversion`;
  } else if (volRatio < 1.2) {
    score = 0.8;
    reason = `Normal-vol regime (${(vol1m * 100).toFixed(0)}% ≈ ${(vol12m * 100).toFixed(0)}%) - standard conditions`;
  } else if (volRatio < 1.5) {
    score = 0.6;
    reason = `Elevated-vol regime (${(vol1m * 100).toFixed(0)}% vs avg ${(vol12m * 100).toFixed(0)}%) - increased uncertainty`;
  } else {
    score = 0.35;
    reason = `High-vol regime (${(vol1m * 100).toFixed(0)}% vs avg ${(vol12m * 100).toFixed(0)}%) - extreme moves more common`;
  }

  return {
    name: 'Volatility Regime',
    score,
    weight: 0.10,
    reason,
    data: { vol1m, vol12m, volRatio },
  };
}

/**
 * FILTER 5: Fundamental Stability
 *
 * Economic rationale: If fundamentals (E/P, B/M) changed significantly
 * recently, the price move may reflect new information being priced in.
 * Stable fundamentals suggest technical overreaction.
 *
 * Compares current factors to 30-day lagged factors.
 */
export function fundamentalStabilityFilter(input: EventFilterInput): FilterResult {
  if (!input.laggedFactors) {
    return {
      name: 'Fundamental Stability',
      score: 0.7,
      weight: 0.10,
      reason: 'Lagged fundamental data unavailable - neutral assumption',
      data: {},
    };
  }

  const current = input.currentFactors;
  const lagged = input.laggedFactors;

  // Check for significant changes
  const changes: string[] = [];
  let changeCount = 0;

  // E/P change (earnings revision)
  if (current.ep !== null && lagged.ep !== null && lagged.ep !== 0) {
    const epChange = Math.abs((current.ep - lagged.ep) / lagged.ep);
    if (epChange > 0.15) {
      changes.push(`E/P changed ${(epChange * 100).toFixed(0)}%`);
      changeCount++;
    }
  }

  // B/M change (usually stable, changes suggest revaluation)
  if (current.bm !== null && lagged.bm !== null && lagged.bm !== 0) {
    const bmChange = Math.abs((current.bm - lagged.bm) / lagged.bm);
    if (bmChange > 0.10) {
      changes.push(`B/M changed ${(bmChange * 100).toFixed(0)}%`);
      changeCount++;
    }
  }

  // Momentum reversal (was positive, now negative or vice versa)
  if (current.mom6m !== null && lagged.mom6m !== null) {
    const momFlip = (current.mom6m > 0 && lagged.mom6m < 0) ||
                    (current.mom6m < 0 && lagged.mom6m > 0);
    if (momFlip) {
      changes.push('6M momentum flipped sign');
      changeCount++;
    }
  }

  let score: number;
  let reason: string;

  if (changeCount === 0) {
    score = 1.0;
    reason = 'Fundamentals stable - price move likely technical';
  } else if (changeCount === 1) {
    score = 0.6;
    reason = `Minor fundamental change: ${changes.join(', ')}`;
  } else {
    score = 0.3;
    reason = `Multiple fundamental changes: ${changes.join(', ')} - may be justified`;
  }

  return {
    name: 'Fundamental Stability',
    score,
    weight: 0.10,
    reason,
    data: { changeCount, changes },
  };
}

/**
 * FILTER 6: Research Activity
 *
 * Economic rationale: Recent analyst coverage (reports, rating changes)
 * suggests new information in the market. Moves following research
 * are more likely to be fundamentally justified.
 *
 * Looks at research documents in the past 7 days.
 */
export function researchActivityFilter(input: EventFilterInput): FilterResult {
  const recentDocs = input.recentResearchCount ?? 0;

  let score: number;
  let reason: string;

  if (recentDocs === 0) {
    score = 1.0;
    reason = 'No recent analyst coverage - likely technical move';
  } else if (recentDocs === 1) {
    score = 0.7;
    reason = '1 research report in past 7 days - some new information';
  } else if (recentDocs <= 3) {
    score = 0.5;
    reason = `${recentDocs} research reports in past 7 days - active coverage`;
  } else {
    score = 0.25;
    reason = `${recentDocs} research reports in past 7 days - heavy analyst activity, move likely justified`;
  }

  return {
    name: 'Research Activity',
    score,
    weight: 0.10,
    reason,
    data: { recentResearchCount: recentDocs, lastResearchDate: input.lastResearchDate },
  };
}

/**
 * FILTER 7: Liquidity Quality
 *
 * Economic rationale: Illiquid stocks can have extreme moves due to
 * small order flow imbalances, but these can persist (no one to trade against).
 * Very liquid stocks mean-revert faster due to arbitrage.
 *
 * Based on average daily volume in NOK.
 */
export function liquidityFilter(input: EventFilterInput): FilterResult {
  const avgDailyValue = input.avgVolume20d * input.currentPrice;
  const avgDailyValueMNOK = avgDailyValue / 1_000_000;

  let score: number;
  let reason: string;

  if (avgDailyValueMNOK > 50) {
    score = 1.0;
    reason = `Very liquid (${avgDailyValueMNOK.toFixed(0)}M NOK/day) - fast mean reversion expected`;
  } else if (avgDailyValueMNOK > 20) {
    score = 0.85;
    reason = `Liquid (${avgDailyValueMNOK.toFixed(0)}M NOK/day) - good execution`;
  } else if (avgDailyValueMNOK > 5) {
    score = 0.6;
    reason = `Moderate liquidity (${avgDailyValueMNOK.toFixed(0)}M NOK/day) - some execution risk`;
  } else if (avgDailyValueMNOK > 1) {
    score = 0.4;
    reason = `Low liquidity (${avgDailyValueMNOK.toFixed(1)}M NOK/day) - moves can persist`;
  } else {
    score = 0.2;
    reason = `Very illiquid (${(avgDailyValueMNOK * 1000).toFixed(0)}K NOK/day) - high execution/reversion risk`;
  }

  return {
    name: 'Liquidity Quality',
    score,
    weight: 0.10,
    reason,
    data: { avgDailyValueMNOK },
  };
}

/**
 * FILTER 8: Momentum Divergence
 *
 * Economic rationale: If short-term momentum (1M) diverges significantly
 * from medium-term momentum (6M), it suggests either:
 * - Trend exhaustion (reversal likely) → good for our strategy
 * - New trend formation (move will continue) → avoid
 *
 * For LONG signals: Want negative 1M but positive 6M (dip in uptrend)
 * For SHORT signals: Want positive 1M but negative 6M (rally in downtrend)
 */
export function momentumDivergenceFilter(input: EventFilterInput): FilterResult {
  const mom1m = input.currentFactors.mom1m;
  const mom6m = input.currentFactors.mom6m;

  if (mom1m === null || mom6m === null) {
    return {
      name: 'Momentum Divergence',
      score: 0.7,
      weight: 0.10,
      reason: 'Momentum data unavailable - neutral assumption',
      data: {},
    };
  }

  let score: number;
  let reason: string;

  if (input.signal === 'LONG') {
    // Ideal: negative 1M (dip) but positive/flat 6M (still in uptrend)
    if (mom1m < -0.03 && mom6m > 0) {
      score = 1.0;
      reason = `Perfect divergence: 1M down (${(mom1m * 100).toFixed(1)}%) but 6M up (${(mom6m * 100).toFixed(1)}%) - dip in uptrend`;
    } else if (mom1m < 0 && mom6m > -0.05) {
      score = 0.8;
      reason = `Good setup: 1M negative (${(mom1m * 100).toFixed(1)}%), 6M neutral/positive`;
    } else if (mom1m < 0 && mom6m < -0.10) {
      score = 0.4;
      reason = `Caution: Both 1M (${(mom1m * 100).toFixed(1)}%) and 6M (${(mom6m * 100).toFixed(1)}%) negative - falling knife`;
    } else {
      score = 0.6;
      reason = `Mixed signals: 1M=${(mom1m * 100).toFixed(1)}%, 6M=${(mom6m * 100).toFixed(1)}%`;
    }
  } else {
    // SHORT signal
    // Ideal: positive 1M (rally) but negative 6M (still in downtrend)
    if (mom1m > 0.03 && mom6m < 0) {
      score = 1.0;
      reason = `Perfect divergence: 1M up (${(mom1m * 100).toFixed(1)}%) but 6M down (${(mom6m * 100).toFixed(1)}%) - rally in downtrend`;
    } else if (mom1m > 0 && mom6m < 0.05) {
      score = 0.8;
      reason = `Good setup: 1M positive (${(mom1m * 100).toFixed(1)}%), 6M neutral/negative`;
    } else if (mom1m > 0 && mom6m > 0.10) {
      score = 0.4;
      reason = `Caution: Both 1M (${(mom1m * 100).toFixed(1)}%) and 6M (${(mom6m * 100).toFixed(1)}%) positive - fighting trend`;
    } else {
      score = 0.6;
      reason = `Mixed signals: 1M=${(mom1m * 100).toFixed(1)}%, 6M=${(mom6m * 100).toFixed(1)}%`;
    }
  }

  return {
    name: 'Momentum Divergence',
    score,
    weight: 0.10,
    reason,
    data: { mom1m, mom6m },
  };
}

// ============================================================================
// Composite Filter
// ============================================================================

/**
 * Run all filters and compute composite score
 */
export function runEventFilters(input: EventFilterInput): CompositeFilterResult {
  const filters: FilterResult[] = [
    volumeAnomalyFilter(input),
    gapDetectionFilter(input),
    marketContextFilter(input),
    volatilityRegimeFilter(input),
    fundamentalStabilityFilter(input),
    researchActivityFilter(input),
    liquidityFilter(input),
    momentumDivergenceFilter(input),
  ];

  // Weighted average
  const totalWeight = filters.reduce((sum, f) => sum + f.weight, 0);
  const weightedSum = filters.reduce((sum, f) => sum + f.score * f.weight, 0);
  const overallScore = weightedSum / totalWeight;

  // Recommendation
  let recommendation: 'PROCEED' | 'CAUTION' | 'AVOID';
  if (overallScore >= 0.7) {
    recommendation = 'PROCEED';
  } else if (overallScore >= 0.5) {
    recommendation = 'CAUTION';
  } else {
    recommendation = 'AVOID';
  }

  // Summary
  const lowScoreFilters = filters.filter(f => f.score < 0.5);
  const highScoreFilters = filters.filter(f => f.score >= 0.8);

  let summary: string;
  if (recommendation === 'PROCEED') {
    summary = `Strong setup: ${highScoreFilters.map(f => f.name).join(', ')} all favorable`;
  } else if (recommendation === 'AVOID') {
    summary = `Red flags: ${lowScoreFilters.map(f => f.name).join(', ')}`;
  } else {
    const concerns = lowScoreFilters.length > 0
      ? `Concerns: ${lowScoreFilters.map(f => f.name).join(', ')}`
      : 'Mixed signals across filters';
    summary = concerns;
  }

  return {
    overallScore,
    recommendation,
    filters,
    summary,
  };
}

/**
 * Quick check - returns true if trade should proceed
 */
export function shouldProceedWithTrade(
  input: EventFilterInput,
  minScore: number = 0.5
): boolean {
  const result = runEventFilters(input);
  return result.overallScore >= minScore;
}

/**
 * Get filter score for position sizing adjustment
 * Returns multiplier: 0.5 (half size) to 1.0 (full size)
 */
export function getPositionSizeMultiplier(input: EventFilterInput): number {
  const result = runEventFilters(input);

  // Map score 0.5-1.0 to multiplier 0.5-1.0
  // Below 0.5 score = don't trade at all
  if (result.overallScore < 0.5) return 0;

  return 0.5 + (result.overallScore - 0.5);
}
