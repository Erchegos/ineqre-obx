/**
 * FX Terminal Analytics Library
 *
 * Functions for the FX Terminal page that are NOT already in fxHedging.ts or fxPairCalculations.ts.
 * Multi-currency regression, NOK trade-weighted index, portfolio FX VaR, carry trade metrics.
 */

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export interface MultiCurrencyRegressionResult {
  betaMarket: number;
  tstatMarket: number;
  betaUsd: number;
  tstatUsd: number;
  betaEur: number;
  tstatEur: number;
  betaGbp: number;
  tstatGbp: number;
  betaSek: number;
  tstatSek: number;
  rSquared: number;
  rSquaredFxOnly: number;
  residualVol: number;
  observations: number;
}

export interface NetExposureResult {
  netUsdPct: number;
  netEurPct: number;
  netGbpPct: number;
  netSekPct: number;
  ebitdaSensitivityUsd: number;
  ebitdaSensitivityEur: number;
  ebitdaSensitivityGbp: number;
  epsSensitivityUsd: number;
  epsSensitivityEur: number;
  epsSensitivityGbp: number;
}

export interface PortfolioFxVaRResult {
  var95_1d: number;
  var99_1d: number;
  var95_1m: number;
  var99_1m: number;
  currencyContributions: Record<string, number>;
  totalFxExposure: number;
}

export interface CarryTradeResult {
  carry: number; // annualized carry (%)
  carrySharpe: number;
  spotVol: number; // annualized spot vol (%)
  cumulativePnl: { date: string; carry: number; spot: number; total: number }[];
}

export interface NokIndexPoint {
  date: string;
  index: number;
  change1d: number;
}

// ============================================================================
// MULTI-CURRENCY OLS REGRESSION
// ============================================================================

/**
 * Multi-factor OLS regression via normal equations: (X'X)^-1 X'Y
 *
 * Model: R_stock = α + β_mkt×R_OBX + β_usd×R_USDNOK + β_eur×R_EURNOK + β_gbp×R_GBPNOK + β_sek×R_SEKNOK + ε
 *
 * Also computes R²_fx_only from a partial regression excluding the market factor.
 */
export function multiCurrencyRegression(
  stockReturns: number[],
  marketReturns: number[],
  fxReturns: { usd: number[]; eur: number[]; gbp: number[]; sek: number[] },
  windowSize?: number
): MultiCurrencyRegressionResult {
  const n = Math.min(
    stockReturns.length,
    marketReturns.length,
    fxReturns.usd.length,
    fxReturns.eur.length,
    fxReturns.gbp.length,
    fxReturns.sek.length
  );

  const w = windowSize ? Math.min(n, windowSize) : n;

  if (w < 20) {
    return emptyRegressionResult(w);
  }

  // Take last w observations
  const y = stockReturns.slice(-w);
  const xMkt = marketReturns.slice(-w);
  const xUsd = fxReturns.usd.slice(-w);
  const xEur = fxReturns.eur.slice(-w);
  const xGbp = fxReturns.gbp.slice(-w);
  const xSek = fxReturns.sek.slice(-w);

  // Build X matrix: [1, mkt, usd, eur, gbp, sek] — 6 columns
  const k = 6;
  const X: number[][] = [];
  for (let i = 0; i < w; i++) {
    X.push([1, xMkt[i], xUsd[i], xEur[i], xGbp[i], xSek[i]]);
  }

  // X'X (k×k)
  const XtX = matMulTranspose(X, X, k);
  // X'Y (k×1)
  const XtY = vecMulTranspose(X, y, k);

  // Solve (X'X)β = X'Y
  const betas = solveLinearSystem(XtX, XtY, k);
  if (!betas) return emptyRegressionResult(w);

  // Compute residuals and R²
  const yMean = y.reduce((a, b) => a + b, 0) / w;
  let ssTot = 0;
  let ssRes = 0;
  const residuals: number[] = [];
  for (let i = 0; i < w; i++) {
    const yHat = betas[0] + betas[1] * xMkt[i] + betas[2] * xUsd[i] +
      betas[3] * xEur[i] + betas[4] * xGbp[i] + betas[5] * xSek[i];
    const res = y[i] - yHat;
    residuals.push(res);
    ssRes += res * res;
    ssTot += (y[i] - yMean) * (y[i] - yMean);
  }

  const rSquared = ssTot > 0 ? 1 - ssRes / ssTot : 0;

  // Standard errors: SE = sqrt(diag((X'X)^-1 * σ²_ε))
  const sigmaSquared = ssRes / (w - k);
  const XtXinv = invertMatrix(XtX, k);
  const stdErrors = XtXinv
    ? Array.from({ length: k }, (_, i) => Math.sqrt(Math.max(0, XtXinv[i][i] * sigmaSquared)))
    : new Array(k).fill(0);

  const tStats = betas.map((b, i) => stdErrors[i] > 0 ? b / stdErrors[i] : 0);

  // Residual vol (annualized)
  const residualVol = Math.sqrt(sigmaSquared * 252);

  // Compute R²_fx_only: regression without market factor
  // Model: R_stock = α + β_usd×R_USDNOK + β_eur×R_EURNOK + β_gbp×R_GBPNOK + β_sek×R_SEKNOK + ε
  const kFx = 5;
  const Xfx: number[][] = [];
  for (let i = 0; i < w; i++) {
    Xfx.push([1, xUsd[i], xEur[i], xGbp[i], xSek[i]]);
  }
  const XtXfx = matMulTranspose(Xfx, Xfx, kFx);
  const XtYfx = vecMulTranspose(Xfx, y, kFx);
  const betasFx = solveLinearSystem(XtXfx, XtYfx, kFx);

  let rSquaredFxOnly = 0;
  if (betasFx) {
    let ssResFx = 0;
    for (let i = 0; i < w; i++) {
      const yHat = betasFx[0] + betasFx[1] * xUsd[i] + betasFx[2] * xEur[i] +
        betasFx[3] * xGbp[i] + betasFx[4] * xSek[i];
      ssResFx += (y[i] - yHat) ** 2;
    }
    rSquaredFxOnly = ssTot > 0 ? 1 - ssResFx / ssTot : 0;
  }

  return {
    betaMarket: betas[1],
    tstatMarket: tStats[1],
    betaUsd: betas[2],
    tstatUsd: tStats[2],
    betaEur: betas[3],
    tstatEur: tStats[3],
    betaGbp: betas[4],
    tstatGbp: tStats[4],
    betaSek: betas[5],
    tstatSek: tStats[5],
    rSquared: Math.max(0, Math.min(1, rSquared)),
    rSquaredFxOnly: Math.max(0, Math.min(1, rSquaredFxOnly)),
    residualVol,
    observations: w,
  };
}

function emptyRegressionResult(n: number): MultiCurrencyRegressionResult {
  return {
    betaMarket: 0, tstatMarket: 0,
    betaUsd: 0, tstatUsd: 0,
    betaEur: 0, tstatEur: 0,
    betaGbp: 0, tstatGbp: 0,
    betaSek: 0, tstatSek: 0,
    rSquared: 0, rSquaredFxOnly: 0,
    residualVol: 0, observations: n,
  };
}

// ============================================================================
// NET EXPOSURE FROM FUNDAMENTALS
// ============================================================================

/**
 * Calculate net currency exposure and EBITDA/EPS sensitivity from revenue/cost split
 *
 * NetExposure_j = Revenue_j% - Cost_j%
 * EBITDA_sensitivity_j = NetExposure_j (already in % terms per 1% FX move)
 * EPS_sensitivity_j = EBITDA_sensitivity × (1 - tax) × leverage
 */
export function calculateNetExposure(
  revenue: { usd: number; eur: number; gbp: number; sek: number },
  cost: { usd: number; eur: number; gbp: number; sek: number },
  taxRate: number = 0.22,
  leverageRatio: number = 1.5 // EBITDA / Net Income proxy
): NetExposureResult {
  const netUsd = revenue.usd - cost.usd;
  const netEur = revenue.eur - cost.eur;
  const netGbp = revenue.gbp - cost.gbp;
  const netSek = revenue.sek - cost.sek;

  const afterTaxLeverage = (1 - taxRate) * leverageRatio;

  return {
    netUsdPct: netUsd,
    netEurPct: netEur,
    netGbpPct: netGbp,
    netSekPct: netSek,
    ebitdaSensitivityUsd: netUsd,
    ebitdaSensitivityEur: netEur,
    ebitdaSensitivityGbp: netGbp,
    epsSensitivityUsd: netUsd * afterTaxLeverage,
    epsSensitivityEur: netEur * afterTaxLeverage,
    epsSensitivityGbp: netGbp * afterTaxLeverage,
  };
}

// ============================================================================
// PORTFOLIO FX VaR
// ============================================================================

/**
 * Parametric FX VaR for a portfolio
 *
 * Portfolio FX VaR = |w' × β_fx| × σ_fx × z_α × √T
 */
export function portfolioFxVaR(
  weights: number[], // portfolio weights (sum to 1)
  fxBetas: { usd: number[]; eur: number[]; gbp: number[]; sek: number[] }, // per-stock betas
  fxVols: { usd: number; eur: number; gbp: number; sek: number }, // annualized FX vols
  fxCorrelations: number[][] // 4×4 correlation matrix [usd, eur, gbp, sek]
): PortfolioFxVaRResult {
  const currencies = ["usd", "eur", "gbp", "sek"] as const;

  // Weighted portfolio beta per currency
  const portfolioBetas: Record<string, number> = {};
  for (const ccy of currencies) {
    portfolioBetas[ccy] = weights.reduce((sum, w, i) => sum + w * (fxBetas[ccy][i] || 0), 0);
  }

  // Portfolio FX variance = β' Σ_fx β
  const vols = [fxVols.usd, fxVols.eur, fxVols.gbp, fxVols.sek];
  const betas = currencies.map(c => portfolioBetas[c]);

  // Σ_fx = D × C × D where D = diag(vols), C = correlation
  let portfolioFxVariance = 0;
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      portfolioFxVariance += betas[i] * betas[j] * vols[i] * vols[j] * (fxCorrelations[i]?.[j] ?? (i === j ? 1 : 0));
    }
  }
  const portfolioFxVol = Math.sqrt(Math.max(0, portfolioFxVariance));

  // z-scores
  const z95 = 1.645;
  const z99 = 2.326;

  // 1-day VaR (vol is annualized, scale down)
  const dailyVol = portfolioFxVol / Math.sqrt(252);
  const var95_1d = dailyVol * z95;
  const var99_1d = dailyVol * z99;

  // 1-month VaR
  const monthlyVol = portfolioFxVol / Math.sqrt(12);
  const var95_1m = monthlyVol * z95;
  const var99_1m = monthlyVol * z99;

  // Per-currency contribution to total FX risk
  const contributions: Record<string, number> = {};
  const totalBetaAbs = currencies.reduce((sum, c) => sum + Math.abs(portfolioBetas[c]), 0);
  for (const ccy of currencies) {
    contributions[ccy] = totalBetaAbs > 0
      ? Math.abs(portfolioBetas[ccy]) / totalBetaAbs * 100
      : 25;
  }

  return {
    var95_1d: var95_1d * 100,
    var99_1d: var99_1d * 100,
    var95_1m: var95_1m * 100,
    var99_1m: var99_1m * 100,
    currencyContributions: contributions,
    totalFxExposure: portfolioFxVol * 100,
  };
}

// ============================================================================
// CARRY TRADE ANALYTICS
// ============================================================================

/**
 * Carry trade metrics for a currency pair
 *
 * Carry = r_NOK - r_foreign (positive = earn carry going long NOK)
 * Sharpe = carry / vol
 */
export function carryTradeMetrics(
  domesticRate: number, // NOK annualized rate (decimal, e.g. 0.045)
  foreignRate: number,  // Foreign annualized rate
  spotHistory: { date: string; rate: number }[],
): CarryTradeResult {
  const carry = (domesticRate - foreignRate) * 100; // annualized carry in %

  if (spotHistory.length < 2) {
    return { carry, carrySharpe: 0, spotVol: 0, cumulativePnl: [] };
  }

  // Calculate daily spot returns
  const dailyReturns: number[] = [];
  for (let i = 1; i < spotHistory.length; i++) {
    if (spotHistory[i].rate > 0 && spotHistory[i - 1].rate > 0) {
      dailyReturns.push((spotHistory[i].rate / spotHistory[i - 1].rate - 1) * 100);
    }
  }

  // Spot vol (annualized)
  const spotVol = stdDev(dailyReturns) * Math.sqrt(252);

  // Carry Sharpe = annualized carry / annualized spot vol
  const carrySharpe = spotVol > 0 ? carry / spotVol : 0;

  // Cumulative P&L series
  const dailyCarry = carry / 252; // daily carry in %
  let cumCarry = 0;
  let cumSpot = 0;
  const cumulativePnl: CarryTradeResult["cumulativePnl"] = [];

  for (let i = 1; i < spotHistory.length; i++) {
    const spotRet = spotHistory[i].rate > 0 && spotHistory[i - 1].rate > 0
      ? (spotHistory[i].rate / spotHistory[i - 1].rate - 1) * 100
      : 0;
    cumCarry += dailyCarry;
    cumSpot += spotRet;
    cumulativePnl.push({
      date: spotHistory[i].date,
      carry: cumCarry,
      spot: cumSpot,
      total: cumCarry + cumSpot,
    });
  }

  return { carry, carrySharpe, spotVol, cumulativePnl };
}

// ============================================================================
// NOK TRADE-WEIGHTED INDEX
// ============================================================================

/**
 * Compute a trade-weighted NOK index (I44 proxy)
 *
 * I_t = 100 × Π(S_j,t / S_j,0)^(-w_j)
 *
 * Higher index = stronger NOK. Negative exponent because higher S (more NOK per foreign)
 * means weaker NOK, so we invert.
 *
 * Default weights (I44 proxy): EUR=0.45, USD=0.25, SEK=0.15, GBP=0.10, DKK=0.05
 */
export function nokTradeWeightedIndex(
  rates: { date: string; usd: number; eur: number; gbp: number; sek: number; dkk: number }[],
  weights: { usd: number; eur: number; gbp: number; sek: number; dkk: number } = {
    eur: 0.45, usd: 0.25, sek: 0.15, gbp: 0.10, dkk: 0.05,
  }
): NokIndexPoint[] {
  if (rates.length === 0) return [];

  const base = rates[0];
  const result: NokIndexPoint[] = [];

  for (let i = 0; i < rates.length; i++) {
    const r = rates[i];
    // Geometric weighted index with negative exponents (higher S = weaker NOK = lower index)
    const index = 100 *
      Math.pow(r.usd / base.usd, -weights.usd) *
      Math.pow(r.eur / base.eur, -weights.eur) *
      Math.pow(r.gbp / base.gbp, -weights.gbp) *
      Math.pow(r.sek / base.sek, -weights.sek) *
      Math.pow(r.dkk / base.dkk, -weights.dkk);

    const prevIndex = i > 0 ? result[i - 1].index : 100;
    const change1d = prevIndex > 0 ? ((index / prevIndex) - 1) * 100 : 0;

    result.push({ date: r.date, index, change1d });
  }

  return result;
}

// ============================================================================
// HEDGE COST & BREAK-EVEN
// ============================================================================

/**
 * Calculate forward hedge cost and break-even FX move
 */
export function calculateHedgeCostAndBreakeven(
  spot: number,
  domesticRate: number,
  foreignRate: number,
  hedgeRatio: number,
  horizonDays: number,
  spreadBps: number = 5 // bid-ask spread in bps
): { costBps: number; breakEvenPct: number; forwardRate: number; forwardPoints: number } {
  const tau = horizonDays / 365;
  const forward = spot * ((1 + domesticRate * tau) / (1 + foreignRate * tau));
  const forwardPoints = forward - spot;

  // Cost = forward premium + transaction spread
  const forwardCostBps = ((forward / spot - 1) * 10000) * hedgeRatio;
  const totalCostBps = Math.abs(forwardCostBps) + spreadBps * hedgeRatio;

  // Annualize
  const costBpsAnnual = totalCostBps * (365 / horizonDays);

  // Break-even: FX move needed to offset hedge cost
  const breakEvenPct = hedgeRatio > 0 ? totalCostBps / (hedgeRatio * 100) : 0;

  return {
    costBps: costBpsAnnual,
    breakEvenPct,
    forwardRate: forward,
    forwardPoints,
  };
}

// ============================================================================
// LINEAR ALGEBRA HELPERS (for OLS)
// ============================================================================

/** X'X: compute k×k matrix from X (n×k) */
function matMulTranspose(X: number[][], _X2: number[][], k: number): number[][] {
  const n = X.length;
  const result: number[][] = Array.from({ length: k }, () => new Array(k).fill(0));
  for (let i = 0; i < k; i++) {
    for (let j = i; j < k; j++) {
      let sum = 0;
      for (let t = 0; t < n; t++) {
        sum += X[t][i] * X[t][j];
      }
      result[i][j] = sum;
      result[j][i] = sum; // symmetric
    }
  }
  return result;
}

/** X'Y: compute k×1 vector from X (n×k) and y (n×1) */
function vecMulTranspose(X: number[][], y: number[], k: number): number[] {
  const n = X.length;
  const result = new Array(k).fill(0);
  for (let i = 0; i < k; i++) {
    for (let t = 0; t < n; t++) {
      result[i] += X[t][i] * y[t];
    }
  }
  return result;
}

/** Solve Ax = b via Gaussian elimination with partial pivoting */
function solveLinearSystem(A: number[][], b: number[], k: number): number[] | null {
  // Create augmented matrix
  const aug: number[][] = A.map((row, i) => [...row, b[i]]);

  // Forward elimination with partial pivoting
  for (let col = 0; col < k; col++) {
    // Find pivot
    let maxVal = Math.abs(aug[col][col]);
    let maxRow = col;
    for (let row = col + 1; row < k; row++) {
      if (Math.abs(aug[row][col]) > maxVal) {
        maxVal = Math.abs(aug[row][col]);
        maxRow = row;
      }
    }

    if (maxVal < 1e-12) return null; // Singular matrix

    // Swap rows
    if (maxRow !== col) {
      [aug[col], aug[maxRow]] = [aug[maxRow], aug[col]];
    }

    // Eliminate
    for (let row = col + 1; row < k; row++) {
      const factor = aug[row][col] / aug[col][col];
      for (let j = col; j <= k; j++) {
        aug[row][j] -= factor * aug[col][j];
      }
    }
  }

  // Back substitution
  const x = new Array(k).fill(0);
  for (let i = k - 1; i >= 0; i--) {
    let sum = aug[i][k];
    for (let j = i + 1; j < k; j++) {
      sum -= aug[i][j] * x[j];
    }
    x[i] = sum / aug[i][i];
  }

  return x;
}

/** Invert a k×k matrix via Gauss-Jordan elimination */
function invertMatrix(A: number[][], k: number): number[][] | null {
  // Create [A|I]
  const aug: number[][] = A.map((row, i) => {
    const identity = new Array(k).fill(0);
    identity[i] = 1;
    return [...row, ...identity];
  });

  for (let col = 0; col < k; col++) {
    // Pivot
    let maxVal = Math.abs(aug[col][col]);
    let maxRow = col;
    for (let row = col + 1; row < k; row++) {
      if (Math.abs(aug[row][col]) > maxVal) {
        maxVal = Math.abs(aug[row][col]);
        maxRow = row;
      }
    }
    if (maxVal < 1e-12) return null;
    if (maxRow !== col) [aug[col], aug[maxRow]] = [aug[maxRow], aug[col]];

    // Scale pivot row
    const pivot = aug[col][col];
    for (let j = 0; j < 2 * k; j++) aug[col][j] /= pivot;

    // Eliminate column
    for (let row = 0; row < k; row++) {
      if (row === col) continue;
      const factor = aug[row][col];
      for (let j = 0; j < 2 * k; j++) {
        aug[row][j] -= factor * aug[col][j];
      }
    }
  }

  // Extract inverse from right half
  return aug.map(row => row.slice(k));
}

/** Standard deviation helper */
function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

// ============================================================================
// QUARTER-END DATE HELPERS
// Rime, Schrimpf & Syrstad (RFS 2022) — Table 7:
// CIP basis widens 40–71 bps at quarter-end as global banks window-dress
// leverage ratio exposures for regulatory reporting snapshots.
// ============================================================================

/** Returns the next quarter-end date (Mar 31 / Jun 30 / Sep 30 / Dec 31) from a given date */
export function getNextQuarterEnd(fromDate: Date): Date {
  const y = fromDate.getFullYear();
  const m = fromDate.getMonth(); // 0-indexed
  // Quarter-end months: 2 (Mar), 5 (Jun), 8 (Sep), 11 (Dec)
  const qEnds = [
    new Date(y, 2, 31),
    new Date(y, 5, 30),
    new Date(y, 8, 30),
    new Date(y, 11, 31),
    new Date(y + 1, 2, 31), // next year Q1
  ];
  // First QE strictly after fromDate
  return qEnds.find((d) => d > fromDate) ?? new Date(y + 1, 2, 31);
}

/** Returns the next N quarter-end dates from a given date */
export function getUpcomingQuarterEnds(fromDate: Date, count: number): Date[] {
  const results: Date[] = [];
  let current = fromDate;
  for (let i = 0; i < count; i++) {
    const next = getNextQuarterEnd(current);
    results.push(next);
    current = new Date(next.getTime() + 86400000); // day after
  }
  return results;
}

/**
 * Returns whether [startDate, startDate + tenorDays] crosses a quarter-end.
 * Rime et al. (RFS 2022): basis widens 40–71 bps when settlement straddles QE.
 */
export function hedgeCrossesQuarterEnd(
  startDate: Date,
  tenorDays: number
): { crosses: boolean; quarterEndDate: Date | null; daysUntilQE: number | null } {
  const endDate = new Date(startDate.getTime() + tenorDays * 86400000);
  const nextQE = getNextQuarterEnd(startDate);
  if (nextQE <= endDate) {
    const daysUntilQE = Math.round((nextQE.getTime() - startDate.getTime()) / 86400000);
    return { crosses: true, quarterEndDate: nextQE, daysUntilQE };
  }
  return { crosses: false, quarterEndDate: null, daysUntilQE: null };
}

/** Format a quarter-end date as "Q1 2026 end (Mar 31)" */
export function quarterEndLabel(date: Date): string {
  const m = date.getMonth(); // 0-indexed
  const y = date.getFullYear();
  const qMap: Record<number, { q: string; label: string }> = {
    2: { q: "Q1", label: "Mar 31" },
    5: { q: "Q2", label: "Jun 30" },
    8: { q: "Q3", label: "Sep 30" },
    11: { q: "Q4", label: "Dec 31" },
  };
  const info = qMap[m];
  if (!info) return date.toISOString().slice(0, 10);
  return `${info.q} ${y} end (${info.label})`;
}

/**
 * Historical average basis widening at quarter-end.
 * Source: Rime, Schrimpf & Syrstad (RFS 2022) — Table 7.
 */
export function quarterEndBasisWidening(): { low: number; high: number; median: number } {
  return { low: 40, high: 71, median: 55 };
}
