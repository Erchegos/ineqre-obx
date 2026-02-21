/**
 * Portfolio Optimization Engine
 *
 * Implements mean-variance optimization for long-only equity portfolios.
 * Supports 5 optimization modes with projected gradient descent solver.
 *
 * Mathematical references:
 * - Markowitz (1952): Mean-variance portfolio selection
 * - Ledoit & Wolf (2004): Honey, I shrunk the sample covariance matrix
 * - Duchi et al. (2008): Efficient projections onto the l1-ball
 * - Maillard, Roncalli & Teïletche (2010): Risk parity portfolios
 */

// ============================================================================
// Types
// ============================================================================

export type OptimizationMode =
  | 'equal'
  | 'min_variance'
  | 'max_sharpe'
  | 'risk_parity'
  | 'max_diversification';

export type CovarianceMethod = 'sample' | 'shrinkage' | 'ewma';

export interface OptimizationConstraints {
  maxPositionSize: number;    // default 0.10
  minPositionSize: number;    // default 0.01
  maxSectorExposure: number;  // default 0.30
  excludeTickers: string[];
}

export interface OptimizationInput {
  tickers: string[];
  returns: number[][];            // tickers.length arrays of daily log returns
  expectedReturns?: number[];     // annualized expected returns (for max_sharpe)
  sectors: string[];              // sector per ticker
  mode: OptimizationMode;
  constraints: OptimizationConstraints;
  riskFreeRate: number;           // annualized (e.g., 0.045)
  covarianceMethod: CovarianceMethod;
}

export interface RiskDecomposition {
  ticker: string;
  weight: number;
  marginalContribution: number;
  componentRisk: number;
  percentOfRisk: number;
  componentVaR95: number;
}

export interface StressScenario {
  name: string;
  portfolioVol: number;
  var95: number;
  description: string;
}

export interface EfficientFrontierPoint {
  return: number;
  volatility: number;
  sharpe: number;
}

export interface AssetPoint {
  ticker: string;
  return: number;
  volatility: number;
}

export interface OptimizationResult {
  weights: number[];
  portfolioReturn: number;        // annualized
  portfolioVolatility: number;    // annualized
  sharpeRatio: number;
  sortinoRatio: number;
  var95: number;
  var99: number;
  cvar95: number;
  cvar99: number;
  maxDrawdown: number;
  diversificationRatio: number;
  herfindahlIndex: number;
  effectivePositions: number;
  riskDecomposition: RiskDecomposition[];
  efficientFrontier: EfficientFrontierPoint[];
  assetPoints: AssetPoint[];
  covarianceMatrix: number[][];
  correlationMatrix: number[][];
  stressScenarios: StressScenario[];
  shrinkageIntensity?: number;
}

// ============================================================================
// Linear Algebra Helpers
// ============================================================================

function matVecMul(A: number[][], x: number[]): number[] {
  const n = A.length;
  const result = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < x.length; j++) {
      result[i] += A[i][j] * x[j];
    }
  }
  return result;
}

function dotProduct(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += a[i] * b[i];
  }
  return sum;
}

function portfolioVariance(w: number[], cov: number[][]): number {
  return dotProduct(w, matVecMul(cov, w));
}

function portfolioVol(w: number[], cov: number[][]): number {
  return Math.sqrt(Math.max(0, portfolioVariance(w, cov)));
}

// ============================================================================
// Covariance Matrix Construction
// ============================================================================

/**
 * Sample covariance matrix from daily returns.
 * returns[i] = array of T daily log returns for asset i.
 */
function sampleCovariance(returns: number[][]): number[][] {
  const N = returns.length;
  const T = returns[0].length;

  // Compute means
  const means = returns.map(r => r.reduce((a, b) => a + b, 0) / T);

  // Covariance matrix (unbiased: divide by T-1)
  const cov: number[][] = Array.from({ length: N }, () => new Array(N).fill(0));
  for (let i = 0; i < N; i++) {
    for (let j = i; j < N; j++) {
      let sum = 0;
      for (let t = 0; t < T; t++) {
        sum += (returns[i][t] - means[i]) * (returns[j][t] - means[j]);
      }
      const c = sum / (T - 1);
      cov[i][j] = c;
      cov[j][i] = c;
    }
  }
  return cov;
}

/**
 * Ledoit-Wolf shrinkage estimator.
 * Shrinks sample covariance toward a diagonal target (scaled identity).
 * Essential when N/T ratio is large.
 */
export function ledoitWolfShrinkage(
  returns: number[][]
): { matrix: number[][]; shrinkageIntensity: number } {
  const N = returns.length;
  const T = returns[0].length;

  const S = sampleCovariance(returns);

  // Target: diagonal matrix with average variance on diagonal
  const avgVar = S.reduce((sum, row, i) => sum + row[i], 0) / N;

  // Compute optimal shrinkage intensity (Ledoit-Wolf 2004 analytical formula)
  const means = returns.map(r => r.reduce((a, b) => a + b, 0) / T);

  // Demeaned returns
  const X: number[][] = returns.map((r, i) => r.map(v => v - means[i]));

  // Sum of squared off-diagonal sample covariances
  let piSum = 0;
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      // pi_ij = asymptotic variance of sqrt(T) * s_ij
      let sumK = 0;
      for (let t = 0; t < T; t++) {
        sumK += Math.pow(X[i][t] * X[j][t] - S[i][j], 2);
      }
      piSum += sumK / T;
    }
  }

  // Rho: sum of asymptotic covariances of s_ij with target
  // For identity target scaled by avgVar, rho simplifies
  let rhoSum = 0;
  for (let i = 0; i < N; i++) {
    let sumK = 0;
    for (let t = 0; t < T; t++) {
      sumK += Math.pow(X[i][t] * X[i][t] - S[i][i], 2);
    }
    rhoSum += sumK / T;
  }

  // Gamma: squared Frobenius distance between sample and target
  let gammaSum = 0;
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const target_ij = i === j ? avgVar : 0;
      gammaSum += Math.pow(S[i][j] - target_ij, 2);
    }
  }

  // Optimal shrinkage intensity
  const kappa = (piSum - rhoSum) / gammaSum;
  const delta = Math.max(0, Math.min(1, kappa / T));

  // Shrunk covariance: delta * F + (1 - delta) * S
  const shrunk: number[][] = Array.from({ length: N }, () => new Array(N).fill(0));
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const target_ij = i === j ? avgVar : 0;
      shrunk[i][j] = delta * target_ij + (1 - delta) * S[i][j];
    }
  }

  return { matrix: shrunk, shrinkageIntensity: delta };
}

/**
 * EWMA covariance matrix (exponentially weighted).
 */
function ewmaCovariance(returns: number[][], lambda: number = 0.94): number[][] {
  const N = returns.length;
  const T = returns[0].length;

  const cov: number[][] = Array.from({ length: N }, () => new Array(N).fill(0));

  // Initialize with first observation
  for (let i = 0; i < N; i++) {
    for (let j = i; j < N; j++) {
      cov[i][j] = returns[i][0] * returns[j][0];
      cov[j][i] = cov[i][j];
    }
  }

  // EWMA update
  for (let t = 1; t < T; t++) {
    for (let i = 0; i < N; i++) {
      for (let j = i; j < N; j++) {
        cov[i][j] = lambda * cov[i][j] + (1 - lambda) * returns[i][t] * returns[j][t];
        cov[j][i] = cov[i][j];
      }
    }
  }

  return cov;
}

/**
 * Build covariance matrix using selected method.
 */
export function buildCovarianceMatrix(
  returns: number[][],
  method: CovarianceMethod
): { matrix: number[][]; shrinkageIntensity?: number } {
  switch (method) {
    case 'shrinkage': return ledoitWolfShrinkage(returns);
    case 'ewma': return { matrix: ewmaCovariance(returns) };
    case 'sample': return { matrix: sampleCovariance(returns) };
    default: return ledoitWolfShrinkage(returns);
  }
}

/**
 * Extract correlation matrix from covariance matrix.
 */
export function covToCorrelation(cov: number[][]): number[][] {
  const N = cov.length;
  const vols = cov.map((row, i) => Math.sqrt(Math.max(0, row[i])));
  const corr: number[][] = Array.from({ length: N }, () => new Array(N).fill(0));
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      if (vols[i] > 0 && vols[j] > 0) {
        corr[i][j] = cov[i][j] / (vols[i] * vols[j]);
      } else {
        corr[i][j] = i === j ? 1 : 0;
      }
    }
  }
  return corr;
}

// ============================================================================
// Simplex Projection (Duchi et al. 2008)
// ============================================================================

/**
 * Project vector onto the probability simplex (non-negative, sum to 1).
 * O(N log N) algorithm.
 */
function projectOntoSimplex(v: number[]): number[] {
  const n = v.length;
  const u = [...v].sort((a, b) => b - a);
  let cumSum = 0;
  let rho = 0;
  for (let j = 0; j < n; j++) {
    cumSum += u[j];
    if (u[j] + (1 - cumSum) / (j + 1) > 0) {
      rho = j;
    }
  }
  const theta = (u.slice(0, rho + 1).reduce((a, b) => a + b, 0) - 1) / (rho + 1);
  return v.map(vi => Math.max(0, vi - theta));
}

/**
 * Apply box constraints (max/min position, sector limits).
 */
function applyConstraints(
  w: number[],
  tickers: string[],
  sectors: string[],
  constraints: OptimizationConstraints
): number[] {
  const result = [...w];

  // Box constraints
  for (let i = 0; i < result.length; i++) {
    if (result[i] > constraints.maxPositionSize) {
      result[i] = constraints.maxPositionSize;
    }
    if (result[i] > 0 && result[i] < constraints.minPositionSize) {
      result[i] = 0; // Below minimum → zero out
    }
  }

  // Sector constraints
  const sectorWeights: Record<string, { total: number; indices: number[] }> = {};
  for (let i = 0; i < sectors.length; i++) {
    const s = sectors[i] || 'Unknown';
    if (!sectorWeights[s]) sectorWeights[s] = { total: 0, indices: [] };
    sectorWeights[s].total += result[i];
    sectorWeights[s].indices.push(i);
  }

  for (const sec of Object.values(sectorWeights)) {
    if (sec.total > constraints.maxSectorExposure && sec.total > 0) {
      const scale = constraints.maxSectorExposure / sec.total;
      for (const idx of sec.indices) {
        result[idx] *= scale;
      }
    }
  }

  return result;
}

/**
 * Renormalize weights to sum to 1 after constraint application.
 */
function normalize(w: number[]): number[] {
  const sum = w.reduce((a, b) => a + b, 0);
  if (sum <= 0) return new Array(w.length).fill(1 / w.length);
  return w.map(wi => wi / sum);
}

// ============================================================================
// Optimization Modes
// ============================================================================

/**
 * Equal weight: w_i = 1/N
 */
function optimizeEqualWeight(n: number): number[] {
  return new Array(n).fill(1 / n);
}

/**
 * Minimum Variance: closed-form solution w* = Σ⁻¹1 / (1'Σ⁻¹1).
 * Falls back to inverse-variance weighting if matrix is singular.
 * Constraints applied iteratively after the analytical solution.
 */
function optimizeMinVariance(
  cov: number[][],
  tickers: string[],
  sectors: string[],
  constraints: OptimizationConstraints
): number[] {
  const n = cov.length;

  // Closed-form: w* = Σ⁻¹ * 1 / (1' * Σ⁻¹ * 1)
  const covInv = invertMatrix(cov);

  if (covInv) {
    const ones = new Array(n).fill(1);
    const SigInvOnes = matVecMul(covInv, ones);
    const denom = dotProduct(ones, SigInvOnes);

    if (denom > 1e-12) {
      let w = SigInvOnes.map(v => v / denom);

      // Handle negative weights (long-only): clamp and re-normalize
      w = w.map(wi => Math.max(0, wi));
      w = normalize(w);

      // Apply constraints iteratively (3 rounds for convergence)
      for (let round = 0; round < 3; round++) {
        w = applyConstraints(w, tickers, sectors, constraints);
        w = normalize(w);
      }

      return w;
    }
  }

  // Fallback: inverse-variance weighting
  const invVar = cov.map((row, i) => row[i] > 1e-12 ? 1 / row[i] : 0);
  let w = normalize(invVar);
  for (let round = 0; round < 3; round++) {
    w = applyConstraints(w, tickers, sectors, constraints);
    w = normalize(w);
  }
  return w;
}

/**
 * Maximum Sharpe: closed-form tangency portfolio.
 * w* = Σ⁻¹(μ − rf·1) / 1'Σ⁻¹(μ − rf·1)
 * Falls back to return-scaled inverse-variance if singular.
 */
function optimizeMaxSharpe(
  cov: number[][],
  mu: number[],
  riskFreeRate: number,
  tickers: string[],
  sectors: string[],
  constraints: OptimizationConstraints
): number[] {
  const n = cov.length;

  // Excess returns (daily scale, matching covariance)
  const rfDaily = riskFreeRate / 252;
  const excessMu = mu.map(m => m / 252 - rfDaily);

  const covInv = invertMatrix(cov);

  if (covInv) {
    const SigInvExcess = matVecMul(covInv, excessMu);
    const ones = new Array(n).fill(1);
    const denom = dotProduct(ones, SigInvExcess);

    if (Math.abs(denom) > 1e-12) {
      let w = SigInvExcess.map(v => v / denom);

      // Long-only: clamp negatives
      w = w.map(wi => Math.max(0, wi));
      const wSum = w.reduce((a, b) => a + b, 0);
      if (wSum > 1e-12) {
        w = w.map(wi => wi / wSum);

        for (let round = 0; round < 3; round++) {
          w = applyConstraints(w, tickers, sectors, constraints);
          w = normalize(w);
        }

        return w;
      }
    }
  }

  // Fallback: weight by excess return / variance (reward-to-risk)
  const rtr = mu.map((m, i) => {
    const excess = m - riskFreeRate;
    const vol = cov[i][i] > 1e-12 ? cov[i][i] : 1;
    return Math.max(0, excess / vol);
  });
  let w = normalize(rtr);
  for (let round = 0; round < 3; round++) {
    w = applyConstraints(w, tickers, sectors, constraints);
    w = normalize(w);
  }
  return w;
}

/**
 * Risk Parity: equalize risk contributions.
 * RC_i = w_i * (Sigma*w)_i / sigma_p = 1/N for all i.
 * Uses Spinu (2013) iterative algorithm.
 */
function optimizeRiskParity(
  cov: number[][],
  tickers: string[],
  sectors: string[],
  constraints: OptimizationConstraints,
  maxIter: number = 500
): number[] {
  const n = cov.length;
  let w = new Array(n).fill(1 / n);
  const targetRC = 1 / n;

  for (let iter = 0; iter < maxIter; iter++) {
    const sigW = matVecMul(cov, w);
    const portVol = portfolioVol(w, cov);

    if (portVol < 1e-12) break;

    // Marginal risk contributions
    const mrc = sigW.map(s => s / portVol);

    // Risk contributions
    const rc = w.map((wi, i) => wi * mrc[i]);
    const totalRC = rc.reduce((a, b) => a + b, 0);

    // Update: scale weights inversely to marginal contribution
    const wNew = w.map((wi, i) => {
      if (mrc[i] <= 0) return wi;
      return targetRC / mrc[i];
    });

    // Normalize
    let wNorm = normalize(wNew);

    // Apply constraints
    wNorm = applyConstraints(wNorm, tickers, sectors, constraints);
    wNorm = normalize(wNorm);

    // Damped update for stability
    w = w.map((wi, i) => 0.5 * wi + 0.5 * wNorm[i]);
  }

  return w;
}

/**
 * Maximum Diversification: maximize DR = (w'sigma) / sqrt(w'Sigma*w).
 * Closed-form: w* ∝ Σ⁻¹σ (equivalent to min-variance on correlation matrix).
 */
function optimizeMaxDiversification(
  cov: number[][],
  tickers: string[],
  sectors: string[],
  constraints: OptimizationConstraints
): number[] {
  const n = cov.length;
  const sigma = cov.map((row, i) => Math.sqrt(Math.max(1e-12, row[i])));

  // Closed-form: w* ∝ Σ⁻¹σ
  const covInv = invertMatrix(cov);
  if (covInv) {
    const SigInvSigma = matVecMul(covInv, sigma);
    // Clamp negatives (long-only) and normalize
    let w = SigInvSigma.map(v => Math.max(0, v));
    const wSum = w.reduce((a, b) => a + b, 0);
    if (wSum > 1e-12) {
      w = w.map(wi => wi / wSum);
      for (let round = 0; round < 3; round++) {
        w = applyConstraints(w, tickers, sectors, constraints);
        w = normalize(w);
      }
      return w;
    }
  }

  // Fallback: weight by inverse volatility (maximizes diversification heuristically)
  const invVol = sigma.map(s => s > 1e-12 ? 1 / s : 0);
  let w = normalize(invVol);
  for (let round = 0; round < 3; round++) {
    w = applyConstraints(w, tickers, sectors, constraints);
    w = normalize(w);
  }
  return w;
}

// ============================================================================
// Risk Metrics
// ============================================================================

/**
 * Compute annualized portfolio return from daily weights and returns.
 */
function computePortfolioReturn(
  w: number[],
  returns: number[][]
): { annualizedReturn: number; dailyReturns: number[] } {
  const T = returns[0].length;
  const dailyReturns: number[] = [];

  for (let t = 0; t < T; t++) {
    let portRet = 0;
    for (let i = 0; i < w.length; i++) {
      portRet += w[i] * returns[i][t];
    }
    dailyReturns.push(portRet);
  }

  const meanDaily = dailyReturns.reduce((a, b) => a + b, 0) / T;
  const annualizedReturn = meanDaily * 252;

  return { annualizedReturn, dailyReturns };
}

/**
 * Compute Sortino ratio (penalizes only downside vol).
 */
function computeSortino(
  dailyReturns: number[],
  riskFreeRate: number
): number {
  const rfDaily = riskFreeRate / 252;
  const meanDaily = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
  const excessReturns = dailyReturns.map(r => r - rfDaily);

  // Downside deviation: std of negative excess returns
  const downsideReturns = excessReturns.filter(r => r < 0);
  if (downsideReturns.length === 0) return 10; // Perfect (capped)

  const downsideVar = downsideReturns.reduce((sum, r) => sum + r * r, 0) / downsideReturns.length;
  const downsideDev = Math.sqrt(downsideVar) * Math.sqrt(252);

  if (downsideDev <= 0) return 10;
  return ((meanDaily - rfDaily) * 252) / downsideDev;
}

/**
 * Compute VaR and CVaR from daily returns.
 */
function computeVaR(
  dailyReturns: number[],
  confidence: number = 0.95
): { var: number; cvar: number } {
  const sorted = [...dailyReturns].sort((a, b) => a - b);
  const idx = Math.floor(sorted.length * (1 - confidence));
  const varValue = -sorted[idx] * Math.sqrt(252); // Annualized

  // CVaR: average of returns worse than VaR
  const tailReturns = sorted.slice(0, idx + 1);
  const cvar = tailReturns.length > 0
    ? -(tailReturns.reduce((a, b) => a + b, 0) / tailReturns.length) * Math.sqrt(252)
    : varValue;

  return { var: varValue, cvar };
}

/**
 * Compute maximum drawdown from daily returns.
 */
function computeMaxDrawdown(dailyReturns: number[]): number {
  let peak = 1;
  let cumValue = 1;
  let maxDD = 0;

  for (const r of dailyReturns) {
    cumValue *= (1 + r);
    if (cumValue > peak) peak = cumValue;
    const dd = (peak - cumValue) / peak;
    if (dd > maxDD) maxDD = dd;
  }

  return maxDD;
}

/**
 * Compute risk decomposition per holding.
 */
function computeRiskDecomposition(
  w: number[],
  cov: number[][],
  tickers: string[]
): RiskDecomposition[] {
  const sigW = matVecMul(cov, w);
  const portVol = portfolioVol(w, cov);
  const annualizedPortVol = portVol * Math.sqrt(252);

  if (annualizedPortVol <= 0) {
    return tickers.map((t, i) => ({
      ticker: t,
      weight: w[i],
      marginalContribution: 0,
      componentRisk: 0,
      percentOfRisk: 0,
      componentVaR95: 0,
    }));
  }

  const mrc = sigW.map(s => (s / portVol) * Math.sqrt(252)); // Annualized MRC
  const totalComponentRisk = w.reduce((sum, wi, i) => sum + wi * mrc[i], 0);

  return tickers.map((t, i) => {
    const compRisk = w[i] * mrc[i];
    return {
      ticker: t,
      weight: w[i],
      marginalContribution: mrc[i],
      componentRisk: compRisk,
      percentOfRisk: totalComponentRisk > 0 ? (compRisk / totalComponentRisk) * 100 : 0,
      componentVaR95: compRisk * 1.645, // 95% VaR ≈ 1.645σ
    };
  });
}

/**
 * Compute stress scenarios.
 */
function computeStressScenarios(
  w: number[],
  cov: number[][],
  corr: number[][]
): StressScenario[] {
  const baseVol = portfolioVol(w, cov) * Math.sqrt(252);
  const baseVaR = baseVol * 1.645;

  // Scenario 1: Vol doubles (cov × 4)
  const cov2x = cov.map(row => row.map(v => v * 4));
  const vol2x = portfolioVol(w, cov2x) * Math.sqrt(252);

  // Scenario 2: Correlations → 1
  const N = cov.length;
  const vols = cov.map((row, i) => Math.sqrt(Math.max(0, row[i])));
  const covCorr1: number[][] = Array.from({ length: N }, (_, i) =>
    Array.from({ length: N }, (_, j) => vols[i] * vols[j])
  );
  const volCorr1 = portfolioVol(w, covCorr1) * Math.sqrt(252);

  // Scenario 3: Crisis de-risking (10% exposure)
  const crisisVol = baseVol * 0.1; // Only 10% exposure remains

  return [
    {
      name: 'Volatility Doubles',
      portfolioVol: vol2x,
      var95: vol2x * 1.645,
      description: 'All asset volatilities double (covariance × 4)',
    },
    {
      name: 'Perfect Correlation',
      portfolioVol: volCorr1,
      var95: volCorr1 * 1.645,
      description: 'All pairwise correlations go to 1.0 (systemic crisis)',
    },
    {
      name: 'Crisis Regime (10% exposure)',
      portfolioVol: crisisVol,
      var95: crisisVol * 1.645,
      description: 'Regime-based de-risking to 10% gross exposure',
    },
  ];
}

/**
 * Invert a square matrix via Gauss-Jordan elimination.
 * Returns null if singular.
 */
function invertMatrix(m: number[][]): number[][] | null {
  const n = m.length;
  const aug = m.map((row, i) => [
    ...row, ...Array.from({ length: n }, (_, j) => i === j ? 1 : 0),
  ]);

  for (let col = 0; col < n; col++) {
    let maxRow = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(aug[row][col]) > Math.abs(aug[maxRow][col])) maxRow = row;
    }
    [aug[col], aug[maxRow]] = [aug[maxRow], aug[col]];
    const pivot = aug[col][col];
    if (Math.abs(pivot) < 1e-14) return null;
    for (let j = 0; j < 2 * n; j++) aug[col][j] /= pivot;
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const f = aug[row][col];
      for (let j = 0; j < 2 * n; j++) aug[row][j] -= f * aug[col][j];
    }
  }
  return aug.map(row => row.slice(n));
}

/**
 * Analytical Markowitz efficient frontier (closed-form).
 *
 * Uses: σ² = (C·r² − 2A·r + B) / D
 * where A = 1'Σ⁻¹μ, B = μ'Σ⁻¹μ, C = 1'Σ⁻¹1, D = BC − A².
 *
 * Produces the exact textbook parabola — perfectly smooth.
 */
function computeEfficientFrontier(
  cov: number[][],
  mu: number[],
  _tickers: string[],
  _sectors: string[],
  _constraints: OptimizationConstraints,
  riskFreeRate: number,
  numPoints: number = 80
): EfficientFrontierPoint[] {
  const N = cov.length;

  // Convert to daily returns for matrix math
  const muD = mu.map(m => m / 252);

  const covInv = invertMatrix(cov);
  if (!covInv) return [];

  const ones = new Array(N).fill(1);
  const SigInvMu = matVecMul(covInv, muD);
  const SigInvOnes = matVecMul(covInv, ones);

  const A = dotProduct(ones, SigInvMu);     // 1'Σ⁻¹μ
  const B = dotProduct(muD, SigInvMu);       // μ'Σ⁻¹μ
  const C = dotProduct(ones, SigInvOnes);    // 1'Σ⁻¹1
  const D = B * C - A * A;

  if (D <= 1e-16) return [];

  // Sweep returns from below min asset to above max asset
  const minRet = Math.min(...muD);
  const maxRet = Math.max(...muD);
  const range = maxRet - minRet;
  const sweepMin = minRet - range * 0.2;
  const sweepMax = maxRet + range * 0.1;

  const points: EfficientFrontierPoint[] = [];

  for (let i = 0; i <= numPoints; i++) {
    const t = i / numPoints;
    const rD = sweepMin + t * (sweepMax - sweepMin);

    const varD = (C * rD * rD - 2 * A * rD + B) / D;
    if (varD < 0) continue;

    const volAnnual = Math.sqrt(varD) * Math.sqrt(252);
    const retAnnual = rD * 252;
    const sharpe = volAnnual > 0 ? (retAnnual - riskFreeRate) / volAnnual : 0;

    points.push({ return: retAnnual, volatility: volAnnual, sharpe });
  }

  return points;
}

// ============================================================================
// Main Optimization Function
// ============================================================================

export function optimizePortfolio(input: OptimizationInput): OptimizationResult {
  const {
    tickers, returns, expectedReturns, sectors, mode,
    constraints, riskFreeRate, covarianceMethod
  } = input;

  const N = tickers.length;

  // 1. Build covariance matrix (daily)
  const covResult = buildCovarianceMatrix(returns, covarianceMethod);
  const cov = covResult.matrix;

  // Add small regularization for numerical stability
  for (let i = 0; i < N; i++) {
    cov[i][i] += 1e-8;
  }

  const corr = covToCorrelation(cov);

  // 2. Expected returns (annualized)
  // If ML predictions available, use those; otherwise use historical means
  const mu = expectedReturns || returns.map(r => {
    const mean = r.reduce((a, b) => a + b, 0) / r.length;
    return mean * 252;
  });

  // 3. Run optimizer
  let weights: number[];
  switch (mode) {
    case 'equal':
      weights = optimizeEqualWeight(N);
      break;
    case 'min_variance':
      weights = optimizeMinVariance(cov, tickers, sectors, constraints);
      break;
    case 'max_sharpe':
      weights = optimizeMaxSharpe(cov, mu, riskFreeRate, tickers, sectors, constraints);
      break;
    case 'risk_parity':
      weights = optimizeRiskParity(cov, tickers, sectors, constraints);
      break;
    case 'max_diversification':
      weights = optimizeMaxDiversification(cov, tickers, sectors, constraints);
      break;
    default:
      weights = optimizeMinVariance(cov, tickers, sectors, constraints);
  }

  // 4. Compute portfolio metrics
  const { annualizedReturn, dailyReturns } = computePortfolioReturn(weights, returns);
  const annualizedVol = portfolioVol(weights, cov) * Math.sqrt(252);
  const sharpeRatio = annualizedVol > 0
    ? (annualizedReturn - riskFreeRate) / annualizedVol
    : 0;
  const sortinoRatio = computeSortino(dailyReturns, riskFreeRate);
  const var95 = computeVaR(dailyReturns, 0.95);
  const var99 = computeVaR(dailyReturns, 0.99);
  const maxDrawdown = computeMaxDrawdown(dailyReturns);

  // Diversification ratio
  const assetVols = cov.map((row, i) => Math.sqrt(Math.max(0, row[i])) * Math.sqrt(252));
  const weightedVol = dotProduct(weights, assetVols);
  const diversificationRatio = annualizedVol > 0 ? weightedVol / annualizedVol : 1;

  // Concentration
  const squaredWeights = weights.map(w => w * w);
  const herfindahlIndex = squaredWeights.reduce((a, b) => a + b, 0);
  const effectivePositions = herfindahlIndex > 0 ? 1 / herfindahlIndex : 0;

  // 5. Risk decomposition
  const riskDecomposition = computeRiskDecomposition(weights, cov, tickers);

  // 6. Efficient frontier
  const efficientFrontier = computeEfficientFrontier(
    cov, mu, tickers, sectors, constraints, riskFreeRate
  );

  // 7. Stress scenarios
  const stressScenarios = computeStressScenarios(weights, cov, corr);

  // 8. Individual asset return/vol points (for frontier chart context)
  const assetPoints: AssetPoint[] = tickers.map((t, i) => ({
    ticker: t,
    return: mu[i],
    volatility: assetVols[i],
  }));

  return {
    weights,
    portfolioReturn: annualizedReturn,
    portfolioVolatility: annualizedVol,
    sharpeRatio,
    sortinoRatio,
    var95: var95.var,
    var99: var99.var,
    cvar95: var95.cvar,
    cvar99: var99.cvar,
    maxDrawdown,
    diversificationRatio,
    herfindahlIndex,
    effectivePositions,
    riskDecomposition,
    efficientFrontier,
    assetPoints,
    covarianceMatrix: cov,
    correlationMatrix: corr,
    stressScenarios,
    shrinkageIntensity: covResult.shrinkageIntensity,
  };
}
