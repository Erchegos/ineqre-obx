/**
 * FX Hedging Analytics Library
 *
 * Implements currency risk measurement and hedging analytics based on
 * International Financial Management theory. No forecasting - only exposure
 * measurement and hedge design via no-arbitrage principles.
 *
 * Reference: Solnik & McLeavey, "Global Investments" Chapter 10
 */

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export interface FXExposure {
  currency: string;
  revenuePct: number; // Decimal (0.75 = 75%)
}

export interface FXRate {
  date: string;
  rate: number;
}

export interface InterestRate {
  currency: string;
  rate: number; // Annualized decimal (0.045 = 4.5%)
  tenor: string; // '1M', '3M', '6M', '12M'
}

export interface ReturnDecomposition {
  date: string;
  totalReturnNOK: number; // %
  pureEquityReturn: number; // %
  fxContribution: number; // %
  interactionTerm: number; // %
  usdFxContribution?: number;
  eurFxContribution?: number;
  gbpFxContribution?: number;
}

export interface CurrencyBeta {
  ticker: string;
  currencyPair: string;
  date: string;
  windowDays: number;
  beta: number;
  rSquared: number;
  stdError: number;
  tStat: number;
  pValue: number;
  observations: number;
}

export interface ForwardRate {
  currencyPair: string;
  date: string;
  tenor: string;
  spotRate: number;
  domesticRate: number; // NOK
  foreignRate: number; // USD/EUR/GBP
  forwardRate: number;
  forwardPoints: number; // pips
  annualizedCarry: number; // %
  daysToMaturity: number;
}

export interface HedgePnL {
  ticker: string;
  date: string;
  currencyPair: string;
  hedgeRatio: number; // 0-1
  tenor: string;
  unhedgedReturn: number; // %
  hedgedReturn: number; // %
  spotPnL: number; // %
  forwardPnL: number; // %
  carryComponent: number; // %
  transactionCost: number; // %
  unhedgedVolatility: number; // %
  hedgedVolatility: number; // %
  volatilityReduction: number; // %
}

export interface OptimalHedge {
  ticker: string;
  currencyPair: string;
  date: string;
  windowDays: number;
  minVarianceHedge: number;
  regressionHedge: number;
  stabilityAdjustedHedge: number;
  vol0pct: number;
  vol50pct: number;
  vol100pct: number;
  volOptimal: number;
  maxDrawdownUnhedged: number;
  maxDrawdownHedged: number;
  opportunityCost: number;
}

// ============================================================================
// MODULE 1: FX EXPOSURE DECOMPOSITION
// ============================================================================

/**
 * Decompose NOK return into pure equity return, FX contribution, and interaction
 *
 * Formula: R_NOK = R_local + ΔFX + (R_local × ΔFX)
 *
 * @param nokReturn - Total return in NOK (%)
 * @param fxReturns - FX rate changes by currency (%)
 * @param exposures - Revenue exposure by currency (decimal)
 */
export function decomposeReturn(
  nokReturn: number,
  fxReturns: { usd?: number; eur?: number; gbp?: number },
  exposures: { usdPct?: number; eurPct?: number; gbpPct?: number }
): Omit<ReturnDecomposition, "date"> {

  // Calculate weighted FX contribution
  const fxContribution =
    (exposures.usdPct || 0) * (fxReturns.usd || 0) +
    (exposures.eurPct || 0) * (fxReturns.eur || 0) +
    (exposures.gbpPct || 0) * (fxReturns.gbp || 0);

  // Approximate pure equity return
  // For daily returns, we can use: R_local ≈ R_NOK - FX_contribution
  const pureEquityReturn = nokReturn - fxContribution;

  // Interaction term (residual from exact decomposition)
  // R_NOK = (1 + R_local)(1 + ΔFX) - 1
  //       = R_local + ΔFX + R_local × ΔFX
  const interactionTerm = nokReturn - pureEquityReturn - fxContribution;

  return {
    totalReturnNOK: nokReturn,
    pureEquityReturn,
    fxContribution,
    interactionTerm,
    usdFxContribution: (exposures.usdPct || 0) * (fxReturns.usd || 0),
    eurFxContribution: (exposures.eurPct || 0) * (fxReturns.eur || 0),
    gbpFxContribution: (exposures.gbpPct || 0) * (fxReturns.gbp || 0),
  };
}

// ============================================================================
// MODULE 2: CURRENCY BETA ESTIMATION
// ============================================================================

/**
 * Estimate currency beta via OLS regression
 * Model: R_equity = alpha + beta_FX × ΔFX + epsilon
 *
 * @param equityReturns - Daily equity returns (%)
 * @param fxReturns - Daily FX rate changes (%)
 * @param windowDays - Rolling window size (20, 63, 252)
 */
export function estimateCurrencyBeta(
  equityReturns: number[],
  fxReturns: number[],
  windowDays: number
): Omit<CurrencyBeta, "ticker" | "currencyPair" | "date"> {

  const n = Math.min(equityReturns.length, fxReturns.length, windowDays);

  if (n < 10) {
    // Insufficient data
    return {
      windowDays,
      beta: 0,
      rSquared: 0,
      stdError: 0,
      tStat: 0,
      pValue: 1,
      observations: n,
    };
  }

  // Take last N observations
  const eqReturns = equityReturns.slice(-n);
  const fxRets = fxReturns.slice(-n);

  // Calculate means
  const meanEquity = eqReturns.reduce((a, b) => a + b, 0) / n;
  const meanFx = fxRets.reduce((a, b) => a + b, 0) / n;

  // Calculate covariance and variance
  let covariance = 0;
  let fxVariance = 0;
  let eqVariance = 0;

  for (let i = 0; i < n; i++) {
    const eqDev = eqReturns[i] - meanEquity;
    const fxDev = fxRets[i] - meanFx;
    covariance += eqDev * fxDev;
    fxVariance += fxDev * fxDev;
    eqVariance += eqDev * eqDev;
  }

  covariance /= (n - 1);
  fxVariance /= (n - 1);
  eqVariance /= (n - 1);

  // Beta = Cov(R_eq, ΔFX) / Var(ΔFX)
  const beta = fxVariance > 0 ? covariance / fxVariance : 0;

  // Calculate R² (coefficient of determination)
  const correlation = Math.sqrt(fxVariance) > 0 && Math.sqrt(eqVariance) > 0
    ? covariance / (Math.sqrt(fxVariance) * Math.sqrt(eqVariance))
    : 0;
  const rSquared = correlation ** 2;

  // Calculate residual variance
  const predicted = fxRets.map((fx) => meanEquity + beta * (fx - meanFx));
  let residualSumSquares = 0;
  for (let i = 0; i < n; i++) {
    residualSumSquares += (eqReturns[i] - predicted[i]) ** 2;
  }
  const residualVariance = residualSumSquares / (n - 2);

  // Standard error of beta
  const stdError = fxVariance > 0
    ? Math.sqrt(residualVariance / ((n - 1) * fxVariance))
    : 0;

  // t-statistic
  const tStat = stdError > 0 ? beta / stdError : 0;

  // p-value (two-tailed) - approximate using normal distribution for large n
  const pValue = stdError > 0 ? 2 * (1 - normalCDF(Math.abs(tStat))) : 1;

  return {
    windowDays,
    beta,
    rSquared,
    stdError,
    tStat,
    pValue,
    observations: n,
  };
}

// ============================================================================
// MODULE 3: FORWARD PRICING VIA INTEREST RATE PARITY
// ============================================================================

/**
 * Calculate forward rate using Covered Interest Rate Parity
 *
 * Formula: F = S × [(1 + r_domestic × τ) / (1 + r_foreign × τ)]
 *
 * @param spot - Spot FX rate (NOK per foreign currency)
 * @param domesticRate - NOK interest rate (annualized decimal)
 * @param foreignRate - Foreign interest rate (annualized decimal)
 * @param daysToMaturity - Days until forward maturity
 */
export function calculateForwardRate(
  spot: number,
  domesticRate: number,
  foreignRate: number,
  daysToMaturity: number
): Omit<ForwardRate, "currencyPair" | "date" | "tenor"> {

  const tau = daysToMaturity / 365; // Year fraction

  // Interest Rate Parity formula
  const forward = spot * ((1 + domesticRate * tau) / (1 + foreignRate * tau));

  // Forward points (in pips)
  const forwardPoints = (forward - spot) * 10000;

  // Annualized carry return
  const annualizedCarry = ((forward / spot) - 1) * (365 / daysToMaturity);

  return {
    spotRate: spot,
    domesticRate,
    foreignRate,
    forwardRate: forward,
    forwardPoints,
    annualizedCarry: annualizedCarry * 100, // Convert to %
    daysToMaturity,
  };
}

/**
 * Get days to maturity for tenor
 */
export function getTenorDays(tenor: string): number {
  const map: Record<string, number> = {
    "1M": 30,
    "3M": 91,
    "6M": 182,
    "12M": 365,
  };
  return map[tenor] || 30;
}

// ============================================================================
// MODULE 4: HEDGE P&L ATTRIBUTION
// ============================================================================

/**
 * Calculate hedge P&L components
 *
 * Components:
 * - Spot P&L: Unhedged FX exposure
 * - Forward P&L: Hedge instrument P&L
 * - Carry: Interest rate differential
 * - Transaction costs
 *
 * @param spotReturn - Spot FX return (%)
 * @param forwardReturn - Forward rate return (%)
 * @param hedgeRatio - Hedge ratio (0-1)
 * @param carry - Carry component (%)
 * @param transactionCost - Bid-ask + roll costs (%)
 * @param historicalReturns - For volatility calculation
 */
export function calculateHedgePnL(
  spotReturn: number,
  forwardReturn: number,
  hedgeRatio: number,
  carry: number,
  transactionCost: number,
  historicalReturns: number[]
): Omit<HedgePnL, "ticker" | "date" | "currencyPair" | "tenor"> {

  // Spot P&L (unhedged exposure)
  const spotPnL = spotReturn;

  // Forward P&L (hedge position)
  // Hedging means going short FX forward, so P&L = -h × (S_T - F)
  const forwardPnL = -hedgeRatio * (spotReturn - forwardReturn);

  // Total hedged return
  const hedgedReturn =
    (1 - hedgeRatio) * spotPnL +
    forwardPnL +
    carry -
    transactionCost;

  // Volatility metrics (annualized)
  const unhedgedVol = standardDeviation(historicalReturns) * Math.sqrt(252);
  const hedgedVol = unhedgedVol * Math.sqrt(1 - hedgeRatio);
  const volReduction = unhedgedVol > 0
    ? ((unhedgedVol - hedgedVol) / unhedgedVol) * 100
    : 0;

  return {
    hedgeRatio,
    unhedgedReturn: spotPnL,
    hedgedReturn,
    spotPnL,
    forwardPnL,
    carryComponent: carry,
    transactionCost,
    unhedgedVolatility: unhedgedVol,
    hedgedVolatility: hedgedVol,
    volatilityReduction: volReduction,
  };
}

// ============================================================================
// MODULE 5: OPTIMAL HEDGE RATIO
// ============================================================================

/**
 * Calculate optimal hedge ratio via minimum variance
 *
 * h* = Cov(R_equity, ΔFX) / Var(ΔFX)
 *
 * This is equivalent to the OLS beta coefficient
 */
export function calculateOptimalHedgeRatio(
  equityReturns: number[],
  fxReturns: number[],
  windowDays: number,
  carryRate: number = 0
): Omit<OptimalHedge, "ticker" | "currencyPair" | "date"> {

  const n = Math.min(equityReturns.length, fxReturns.length, windowDays);

  if (n < 20) {
    return {
      windowDays,
      minVarianceHedge: 0,
      regressionHedge: 0,
      stabilityAdjustedHedge: 0,
      vol0pct: 0,
      vol50pct: 0,
      vol100pct: 0,
      volOptimal: 0,
      maxDrawdownUnhedged: 0,
      maxDrawdownHedged: 0,
      opportunityCost: 0,
    };
  }

  const eqReturns = equityReturns.slice(-n);
  const fxRets = fxReturns.slice(-n);

  // Calculate beta (same as min variance hedge for linear model)
  const betaResult = estimateCurrencyBeta(eqReturns, fxRets, n);
  const minVarianceHedge = Math.max(0, Math.min(1, betaResult.beta));
  const regressionHedge = minVarianceHedge;

  // Stability-adjusted hedge (shrink toward 0.5 if high uncertainty)
  const shrinkageFactor = betaResult.stdError > 0
    ? 1 / (1 + betaResult.stdError)
    : 0.5;
  const stabilityAdjustedHedge =
    shrinkageFactor * minVarianceHedge + (1 - shrinkageFactor) * 0.5;

  // Calculate volatilities for different hedge ratios
  const equityVol = standardDeviation(eqReturns) * Math.sqrt(252);
  const fxVol = standardDeviation(fxRets) * Math.sqrt(252);
  const correlation = betaResult.rSquared > 0
    ? Math.sqrt(betaResult.rSquared) * Math.sign(betaResult.beta)
    : 0;

  const vol0pct = equityVol;
  const vol100pct = Math.sqrt(
    equityVol ** 2 + fxVol ** 2 - 2 * correlation * equityVol * fxVol
  );
  const vol50pct = Math.sqrt(
    equityVol ** 2 + (0.5 * fxVol) ** 2 - 2 * 0.5 * correlation * equityVol * fxVol
  );
  const volOptimal = equityVol * Math.sqrt(Math.max(0, 1 - correlation ** 2));

  // Drawdown analysis
  const maxDrawdownUnhedged = calculateMaxDrawdown(eqReturns);
  const hedgedReturns = eqReturns.map((r, i) => r - minVarianceHedge * fxRets[i]);
  const maxDrawdownHedged = calculateMaxDrawdown(hedgedReturns);

  // Opportunity cost (carry sacrifice)
  const opportunityCost = minVarianceHedge * carryRate;

  return {
    windowDays,
    minVarianceHedge,
    regressionHedge,
    stabilityAdjustedHedge,
    vol0pct,
    vol50pct,
    vol100pct,
    volOptimal,
    maxDrawdownUnhedged,
    maxDrawdownHedged,
    opportunityCost,
  };
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Calculate standard deviation
 */
export function standardDeviation(values: number[]): number {
  if (values.length < 2) return 0;

  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, val) => sum + (val - mean) ** 2, 0) / (values.length - 1);

  return Math.sqrt(variance);
}

/**
 * Calculate maximum drawdown
 */
export function calculateMaxDrawdown(returns: number[]): number {
  if (returns.length === 0) return 0;

  let cumReturn = 1;
  let peak = 1;
  let maxDD = 0;

  for (const r of returns) {
    cumReturn *= (1 + r / 100);
    peak = Math.max(peak, cumReturn);
    const drawdown = (cumReturn / peak - 1) * 100;
    maxDD = Math.min(maxDD, drawdown);
  }

  return maxDD;
}

/**
 * Normal CDF (cumulative distribution function)
 * Approximation for p-value calculation
 */
function normalCDF(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp(-x * x / 2);
  const prob =
    d *
    t *
    (0.3193815 +
      t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));

  return x > 0 ? 1 - prob : prob;
}

/**
 * Calculate covariance between two series
 */
export function calculateCovariance(x: number[], y: number[]): number {
  const n = Math.min(x.length, y.length);
  if (n < 2) return 0;

  const meanX = x.slice(0, n).reduce((a, b) => a + b, 0) / n;
  const meanY = y.slice(0, n).reduce((a, b) => a + b, 0) / n;

  let cov = 0;
  for (let i = 0; i < n; i++) {
    cov += (x[i] - meanX) * (y[i] - meanY);
  }

  return cov / (n - 1);
}

/**
 * Calculate variance
 */
export function calculateVariance(values: number[]): number {
  return standardDeviation(values) ** 2;
}

/**
 * Calculate log returns from prices
 */
export function calculateLogReturns(prices: number[]): number[] {
  const returns: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    if (prices[i] > 0 && prices[i - 1] > 0) {
      returns.push((Math.log(prices[i] / prices[i - 1])) * 100);
    }
  }
  return returns;
}

/**
 * Calculate simple returns from prices
 */
export function calculateSimpleReturns(prices: number[]): number[] {
  const returns: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    if (prices[i - 1] > 0) {
      returns.push(((prices[i] / prices[i - 1]) - 1) * 100);
    }
  }
  return returns;
}
