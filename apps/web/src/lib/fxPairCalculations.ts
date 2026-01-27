/**
 * FX Pair Calculations - Quant Trader Layout
 *
 * Professional FX analytics for NOK-based portfolios.
 * All calculations follow strict quantitative finance conventions.
 *
 * Canonical representation: NOK/X (NOK per 1 unit of foreign currency)
 */

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export interface FXSpotData {
  date: string;
  pair: string; // 'NOKUSD', 'NOKEUR', 'NOKGBP'
  spot: number; // NOK per 1 unit of foreign currency
  bid?: number;
  ask?: number;
}

export interface FXReturnSeries {
  date: string;
  logReturn: number; // ln(S_t / S_t-1)
  simpleReturn: number; // (S_t / S_t-1) - 1
}

export interface InterestRateData {
  currency: string;
  date: string;
  tenor: string; // '1M', '3M', '6M', '12M'
  rate: number; // Annualized decimal (0.045 = 4.5%)
  dayCount: string; // 'ACT/360', 'ACT/365', '30/360'
}

export interface ForwardPrice {
  pair: string;
  date: string;
  tenor: string;
  spot: number;
  forward: number;
  logForward: number; // ln(F)
  domesticRate: number; // r_NOK
  foreignRate: number; // r_X
  carry: number; // r_NOK - r_X
  tau: number; // Time in years
}

export interface FXVolatility {
  pair: string;
  window: number; // days
  annualizedVol: number; // sqrt(252) * std(r^FX)
  observations: number;
}

export interface CurrencyBeta {
  ticker: string;
  pair: string;
  beta: number; // β_FX from regression
  alpha: number;
  rSquared: number;
  stdError: number;
  tStat: number;
  window: number;
}

export interface HedgedReturn {
  date: string;
  unhedgedReturn: number; // r^Equity_NOK
  fxReturn: number; // r^FX
  carry: number; // Carry component
  hedgeRatio: number; // h (0-1)
  hedgedReturn: number; // r^Equity_NOK - h*r^FX + h*Carry
  spotPnL: number;
  forwardPnL: number;
}

export interface FXStressScenario {
  scenario: string;
  fxShock: number; // % shock to spot
  unhedgedPnL: number;
  hedgedPnL: number; // at various hedge ratios
  hedgeRatio: number;
}

// ============================================================================
// 1. CANONICAL FX REPRESENTATION
// ============================================================================

/**
 * Validate and normalize FX pair to NOK/X format
 * All pairs expressed as NOK per 1 unit of foreign currency
 */
export function normalizeFXPair(pair: string): string {
  const normalized = pair.toUpperCase().replace(/[^A-Z]/g, '');

  if (!normalized.startsWith('NOK')) {
    throw new Error(`Invalid FX pair: ${pair}. Must be in NOK/X format (e.g., NOKUSD)`);
  }

  const foreignCurrency = normalized.substring(3);
  if (!['USD', 'EUR', 'GBP', 'SEK', 'DKK'].includes(foreignCurrency)) {
    throw new Error(`Unsupported foreign currency: ${foreignCurrency}`);
  }

  return normalized;
}

// ============================================================================
// 2. FX LOG RETURN CONSTRUCTION
// ============================================================================

/**
 * Compute FX log returns for time additivity
 * r^FX_t = ln(S_t / S_t-1)
 */
export function calculateFXLogReturns(spots: FXSpotData[]): FXReturnSeries[] {
  if (spots.length < 2) return [];

  const returns: FXReturnSeries[] = [];

  for (let i = 1; i < spots.length; i++) {
    const St = spots[i].spot;
    const St1 = spots[i - 1].spot;

    if (St <= 0 || St1 <= 0) {
      throw new Error(`Invalid spot rate: S_t=${St}, S_t-1=${St1}`);
    }

    const logReturn = Math.log(St / St1);
    const simpleReturn = (St / St1) - 1;

    returns.push({
      date: spots[i].date,
      logReturn,
      simpleReturn,
    });
  }

  return returns;
}

// ============================================================================
// 3. INTEREST RATE INPUTS
// ============================================================================

/**
 * Validate interest rate alignment
 * Rates must match by tenor, compounding, and day count
 */
export function validateInterestRateAlignment(
  domesticRate: InterestRateData,
  foreignRate: InterestRateData
): void {
  if (domesticRate.tenor !== foreignRate.tenor) {
    throw new Error(
      `Tenor mismatch: domestic=${domesticRate.tenor}, foreign=${foreignRate.tenor}`
    );
  }

  if (domesticRate.dayCount !== foreignRate.dayCount) {
    throw new Error(
      `Day count mismatch: domestic=${domesticRate.dayCount}, foreign=${foreignRate.dayCount}`
    );
  }

  if (domesticRate.date !== foreignRate.date) {
    throw new Error(
      `Date mismatch: domestic=${domesticRate.date}, foreign=${foreignRate.date}`
    );
  }
}

/**
 * Convert tenor string to year fraction
 */
export function tenorToYearFraction(tenor: string, dayCount: string = 'ACT/365'): number {
  const tenorMap: Record<string, number> = {
    'ON': 1 / 365,
    '1W': 7 / 365,
    '1M': 30 / 365,
    '3M': 91 / 365,
    '6M': 182 / 365,
    '12M': 365 / 365,
  };

  const tau = tenorMap[tenor];
  if (!tau) {
    throw new Error(`Unsupported tenor: ${tenor}`);
  }

  // Adjust for day count convention
  if (dayCount === 'ACT/360') {
    return tau * (365 / 360);
  }

  return tau;
}

// ============================================================================
// 4. FORWARD RATE PRICING (COVERED INTEREST RATE PARITY)
// ============================================================================

/**
 * Calculate forward rate using strict no-arbitrage IRP
 *
 * Formula: F_{t,T} = S_t × [(1 + r_NOK × T) / (1 + r_X × T)]
 * Log form: ln(F) = ln(S) + (r_NOK - r_X) × T
 */
export function calculateForwardPrice(
  spot: number,
  domesticRate: number,
  foreignRate: number,
  tau: number
): ForwardPrice {

  if (spot <= 0) {
    throw new Error(`Invalid spot rate: ${spot}`);
  }

  // Arithmetic forward pricing
  const forward = spot * ((1 + domesticRate * tau) / (1 + foreignRate * tau));

  // Log forward pricing (validation)
  const logForward = Math.log(spot) + (domesticRate - foreignRate) * tau;
  const forwardFromLog = Math.exp(logForward);

  // Validate IRP consistency (should match within numerical precision)
  const diff = Math.abs(forward - forwardFromLog);
  if (diff > 1e-6) {
    console.warn(`IRP validation warning: diff=${diff}`);
  }

  return {
    pair: '', // To be set by caller
    date: '',
    tenor: '',
    spot,
    forward,
    logForward,
    domesticRate,
    foreignRate,
    carry: domesticRate - foreignRate,
    tau,
  };
}

// ============================================================================
// 5. CARRY DECOMPOSITION
// ============================================================================

/**
 * Carry is the interest rate differential
 * Carry_{t,T} = r_NOK - r_X
 */
export function calculateCarry(domesticRate: number, foreignRate: number): number {
  return domesticRate - foreignRate;
}

/**
 * Annualized carry return (%)
 */
export function calculateAnnualizedCarry(carry: number, tau: number): number {
  return (carry / tau) * 100; // Convert to %
}

// ============================================================================
// 6. FX FORWARD P&L ATTRIBUTION
// ============================================================================

/**
 * Decompose forward P&L into components
 * P&L_t = S_t - F_0
 *
 * Detailed breakdown:
 * - Spot movement: S_t - S_0
 * - Carry accrual: (r_NOK - r_X) × Notional × τ
 * - Roll yield: Remaining component
 */
export function attributeForwardPnL(
  spotInitial: number,
  spotFinal: number,
  forwardInitial: number,
  carry: number,
  tau: number,
  notional: number = 1
): {
  totalPnL: number;
  spotMovement: number;
  carryAccrual: number;
  rollYield: number;
} {

  const totalPnL = (spotFinal - forwardInitial) * notional;
  const spotMovement = (spotFinal - spotInitial) * notional;
  const carryAccrual = carry * tau * notional;
  const rollYield = totalPnL - spotMovement - carryAccrual;

  return {
    totalPnL,
    spotMovement,
    carryAccrual,
    rollYield,
  };
}

// ============================================================================
// 7. FX VOLATILITY
// ============================================================================

/**
 * Realized FX volatility using annualized standard deviation of log returns
 * σ_FX = sqrt(252) × std(r^FX)
 */
export function calculateFXVolatility(
  returns: FXReturnSeries[],
  annualizationFactor: number = 252
): FXVolatility {

  if (returns.length < 2) {
    return {
      pair: '',
      window: returns.length,
      annualizedVol: 0,
      observations: returns.length,
    };
  }

  const logReturns = returns.map(r => r.logReturn);

  // Calculate mean
  const mean = logReturns.reduce((sum, r) => sum + r, 0) / logReturns.length;

  // Calculate variance
  const variance = logReturns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / (logReturns.length - 1);

  // Annualized volatility
  const annualizedVol = Math.sqrt(annualizationFactor) * Math.sqrt(variance);

  return {
    pair: '',
    window: returns.length,
    annualizedVol: annualizedVol * 100, // Convert to %
    observations: returns.length,
  };
}

/**
 * Rolling FX volatility
 */
export function calculateRollingFXVolatility(
  returns: FXReturnSeries[],
  window: number
): Array<{ date: string; volatility: number }> {

  const result: Array<{ date: string; volatility: number }> = [];

  for (let i = window; i <= returns.length; i++) {
    const windowReturns = returns.slice(i - window, i);
    const vol = calculateFXVolatility(windowReturns);

    result.push({
      date: returns[i - 1].date,
      volatility: vol.annualizedVol,
    });
  }

  return result;
}

// ============================================================================
// 8. CURRENCY BETA ESTIMATION
// ============================================================================

/**
 * Economic FX exposure via regression
 * r^Equity_NOK = α + β_FX × r^FX + ε
 */
export function estimateCurrencyBetaOLS(
  equityReturns: number[],
  fxReturns: number[],
  window?: number
): CurrencyBeta {

  const n = window ? Math.min(window, equityReturns.length, fxReturns.length) : Math.min(equityReturns.length, fxReturns.length);

  if (n < 10) {
    throw new Error(`Insufficient observations for regression: n=${n}`);
  }

  const y = equityReturns.slice(-n);
  const x = fxReturns.slice(-n);

  // Calculate means
  const meanY = y.reduce((a, b) => a + b, 0) / n;
  const meanX = x.reduce((a, b) => a + b, 0) / n;

  // Calculate beta via OLS
  let numerator = 0;
  let denominator = 0;

  for (let i = 0; i < n; i++) {
    numerator += (x[i] - meanX) * (y[i] - meanY);
    denominator += Math.pow(x[i] - meanX, 2);
  }

  const beta = numerator / denominator;
  const alpha = meanY - beta * meanX;

  // Calculate R²
  const fitted = x.map(xi => alpha + beta * xi);
  const ssTot = y.reduce((sum, yi) => sum + Math.pow(yi - meanY, 2), 0);
  const ssRes = y.reduce((sum, yi, i) => sum + Math.pow(yi - fitted[i], 2), 0);
  const rSquared = 1 - (ssRes / ssTot);

  // Standard error of beta
  const residualVariance = ssRes / (n - 2);
  const stdError = Math.sqrt(residualVariance / denominator);

  // t-statistic
  const tStat = beta / stdError;

  return {
    ticker: '',
    pair: '',
    beta,
    alpha,
    rSquared,
    stdError,
    tStat,
    window: n,
  };
}

// ============================================================================
// 9. HEDGED RETURN CONSTRUCTION
// ============================================================================

/**
 * Construct hedged returns with explicit carry retention
 * r^Hedged = r^Equity_NOK - h × r^FX + h × Carry
 */
export function constructHedgedReturn(
  equityReturn: number,
  fxReturn: number,
  carry: number,
  hedgeRatio: number
): HedgedReturn {

  if (hedgeRatio < 0 || hedgeRatio > 1) {
    throw new Error(`Invalid hedge ratio: ${hedgeRatio}. Must be in [0, 1]`);
  }

  const spotPnL = -hedgeRatio * fxReturn;
  const carryPnL = hedgeRatio * carry;
  const hedgedReturn = equityReturn + spotPnL + carryPnL;

  return {
    date: '',
    unhedgedReturn: equityReturn,
    fxReturn,
    carry,
    hedgeRatio,
    hedgedReturn,
    spotPnL,
    forwardPnL: spotPnL + carryPnL,
  };
}

/**
 * Calculate hedged return series
 */
export function calculateHedgedReturnSeries(
  equityReturns: number[],
  fxReturns: number[],
  carry: number,
  hedgeRatio: number
): number[] {

  const n = Math.min(equityReturns.length, fxReturns.length);
  const hedgedReturns: number[] = [];

  for (let i = 0; i < n; i++) {
    const hedged = constructHedgedReturn(
      equityReturns[i],
      fxReturns[i],
      carry / 252, // Daily carry
      hedgeRatio
    );
    hedgedReturns.push(hedged.hedgedReturn);
  }

  return hedgedReturns;
}

// ============================================================================
// 10. STRESS SCENARIO ENGINE
// ============================================================================

/**
 * Apply deterministic FX shock to spot and forward
 * No Monte Carlo - direct scenario analysis
 */
export function applyFXStressScenario(
  spot: number,
  forward: number,
  fxShock: number, // % shock (e.g., 0.10 = 10% depreciation)
  equityReturn: number,
  equityBeta: number,
  hedgeRatio: number,
  carry: number
): FXStressScenario {

  // Shocked spot
  const spotShocked = spot * (1 + fxShock);

  // Shocked FX return (log approximation for small shocks)
  const fxReturn = Math.log(spotShocked / spot);

  // Equity P&L from FX shock (via beta)
  const equityFXImpact = equityBeta * fxReturn;

  // Unhedged P&L
  const unhedgedPnL = equityReturn + equityFXImpact;

  // Hedged P&L
  const hedgeSpotPnL = -hedgeRatio * fxReturn;
  const hedgeCarryPnL = hedgeRatio * carry;
  const hedgedPnL = unhedgedPnL + hedgeSpotPnL + hedgeCarryPnL;

  return {
    scenario: `FX Shock: ${(fxShock * 100).toFixed(1)}%`,
    fxShock,
    unhedgedPnL: unhedgedPnL * 100,
    hedgedPnL: hedgedPnL * 100,
    hedgeRatio,
  };
}

/**
 * Generate FX stress scenario grid
 */
export function generateStressScenarioGrid(
  spot: number,
  forward: number,
  equityReturn: number,
  equityBeta: number,
  carry: number,
  fxShocks: number[] = [-0.20, -0.10, -0.05, 0, 0.05, 0.10, 0.20],
  hedgeRatios: number[] = [0, 0.25, 0.50, 0.75, 1.0]
): Array<{ shock: number; hedgeRatio: number; pnl: number }> {

  const grid: Array<{ shock: number; hedgeRatio: number; pnl: number }> = [];

  for (const shock of fxShocks) {
    for (const hedgeRatio of hedgeRatios) {
      const scenario = applyFXStressScenario(
        spot,
        forward,
        shock,
        equityReturn,
        equityBeta,
        hedgeRatio,
        carry
      );

      grid.push({
        shock,
        hedgeRatio,
        pnl: scenario.hedgedPnL,
      });
    }
  }

  return grid;
}

// ============================================================================
// 11. DATA INTEGRITY RULES
// ============================================================================

/**
 * Validate FX data series integrity
 */
export function validateFXDataIntegrity(data: FXSpotData[]): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  // Check for missing days (assuming calendar days, not trading days)
  if (data.length < 2) {
    errors.push('Insufficient data points');
    return { valid: false, errors };
  }

  // Check for non-positive rates
  for (const point of data) {
    if (point.spot <= 0) {
      errors.push(`Invalid spot rate at ${point.date}: ${point.spot}`);
    }
  }

  // Check for duplicate dates
  const dates = new Set(data.map(d => d.date));
  if (dates.size !== data.length) {
    errors.push('Duplicate dates found in series');
  }

  // Check for temporal ordering
  for (let i = 1; i < data.length; i++) {
    if (new Date(data[i].date) <= new Date(data[i - 1].date)) {
      errors.push(`Time series not properly ordered at index ${i}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate IRP condition
 */
export function validateIRP(
  spot: number,
  forward: number,
  domesticRate: number,
  foreignRate: number,
  tau: number,
  tolerance: number = 1e-4
): boolean {

  const theoreticalForward = spot * ((1 + domesticRate * tau) / (1 + foreignRate * tau));
  const diff = Math.abs(forward - theoreticalForward) / spot;

  return diff < tolerance;
}

// ============================================================================
// 12. OUTPUT REQUIREMENTS
// ============================================================================

/**
 * Complete FX pair analytics bundle
 */
export interface FXPairAnalytics {
  pair: string;
  date: string;

  // Spot data
  spot: number;
  bid?: number;
  ask?: number;

  // Returns
  logReturn: number;
  simpleReturn: number;

  // Volatility
  volatility: {
    annualized: number;
    window: number;
  };

  // Forward curve
  forwards: Array<{
    tenor: string;
    forward: number;
    carry: number;
    impliedRate: number;
  }>;

  // Carry
  carry: {
    '1M': number;
    '3M': number;
    '6M': number;
    '12M': number;
  };

  // Hedge cost (transaction cost + carry sacrifice)
  hedgeCost: {
    bidAskSpread: number;
    carryOpportunityCost: number;
    total: number;
  };

  // Stress sensitivities
  stressScenarios: Array<{
    shock: number;
    unhedgedPnL: number;
    hedgedPnL: number;
  }>;
}
