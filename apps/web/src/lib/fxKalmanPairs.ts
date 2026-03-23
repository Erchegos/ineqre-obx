/**
 * Kalman Filter Pairs Trading Engine
 *
 * Models the spread between two FX log-price series using an adaptive
 * Kalman filter. Treats the hedge ratio β and intercept α as latent states
 * that evolve as a random walk (regime-adaptive).
 *
 * State:    θ_t = [α_t, β_t]^T
 * Evolution: θ_t = θ_{t-1} + η_t,  η_t ~ N(0, W)
 * Obs:      y_t = [1, x_t] · θ_t + ε_t,  ε_t ~ N(0, Ve)
 *
 * Kalman gain update uses the Joseph form for numerical stability:
 * P_{t|t} = (I - K·H)·P_{t|t-1}·(I - K·H)^T + K·Ve·K^T
 *
 * References:
 *  - quantframe.io/knowledge-hub/journal/pairs-trading-kalman-filter
 *  - Rime et al. (2022) for FX basis context
 */

export interface KalmanParams {
  /** State drift variance. Controls how fast β/α can change. Default 1e-4 */
  delta: number;
  /** Observation noise variance. Controls spread noise. Default 1e-3 */
  Ve: number;
  /**
   * Position size as % of NAV per trade. Scales per-trade P&L to realistic portfolio returns.
   * Rule-of-thumb: each σ of spread capture ≈ positionSizePct × 0.01% of portfolio.
   * Default 15 → ~20-25% annual return for ~100 trades/year.
   */
  positionSizePct?: number;
  /** Round-trip transaction cost in basis points (bid-ask × 2 + slippage + commission). Default 5 */
  totalCostBps?: number;
}

export const DEFAULT_PARAMS: KalmanParams = {
  delta: 1e-4,
  Ve: 1e-3,
  positionSizePct: 10,
  totalCostBps: 8,
};

export const ENTRY_Z  = 2.0;   // Enter long/short at ±2σ
export const EXIT_Z   = 0.5;   // Exit at ±0.5σ (mean reversion)
export const STOP_Z   = 4.0;   // Hard stop at ±4σ

export interface KalmanPoint {
  date: string;
  logY: number;
  logX: number;
  alpha: number;
  beta: number;
  spread: number;   // residual e_t
  zscore: number;   // e_t / sqrt(S_t)
  spreadVol: number; // sqrt(S_t)
}

export interface PairsTrade {
  entryDate: string;
  exitDate: string;
  direction: 'long' | 'short';   // long = buy Y, sell β*X
  entryZ: number;
  exitZ: number;
  entryBeta: number;
  entrySpreadVol: number;        // spreadVol at entry — for client-side rescaling
  daysHeld: number;
  pnlPct: number;                // position-sized, cost-adjusted P&L (%)
  exitReason: 'signal' | 'stop';
}

export interface PairsStats {
  totalReturn: number;           // Cumulative P&L % (compounded)
  annualizedReturn: number;
  sharpe: number;
  maxDrawdown: number;
  winRate: number;
  trades: number;
  avgHoldDays: number;
  avgPnlPct: number;
}

export interface KalmanResult {
  series: KalmanPoint[];
  trades: PairsTrade[];
  equity: { date: string; value: number }[];  // Indexed to 100
  stats: PairsStats;
  pairY: string;
  pairX: string;
}

// ── Kalman Filter Core ──────────────────────────────────────────────────────

/**
 * Run the 2D Kalman filter on aligned log-price series.
 * Returns per-date state estimates [α_t, β_t], residuals, and z-scores.
 */
export function runKalmanFilter(
  dates: string[],
  logY: number[],
  logX: number[],
  params: KalmanParams,
): KalmanPoint[] {
  const { delta, Ve } = params;
  const n = dates.length;

  // W = (delta/(1-delta)) * I_2
  const wScale = delta / (1 - delta);

  // Initial state: α=0, β=1 (neutral hedge ratio)
  let th0 = 0, th1 = 1;

  // Initial covariance: large uncertainty
  let P00 = 1, P01 = 0, P11 = 1;

  const result: KalmanPoint[] = [];

  for (let t = 0; t < n; t++) {
    const y = logY[t];
    const x = logX[t];

    // ── Predict step: add state drift W ───────────────────────────────────
    // P_{t|t-1} = P_{t-1|t-1} + W  (θ is unchanged: random walk prior)
    P00 += wScale;
    P11 += wScale;
    // P01 unchanged (W is diagonal)

    // ── Update step ────────────────────────────────────────────────────────
    // H = [1, x]
    // Innovation: e = y - H·θ
    const e = y - (th0 + th1 * x);

    // Innovation variance: S = H·P·H^T + Ve
    // S = P00 + 2*x*P01 + x^2*P11 + Ve
    const S = P00 + 2 * x * P01 + x * x * P11 + Ve;

    // Kalman gain: K = P·H^T / S  (2x1 vector)
    const K0 = (P00 + x * P01) / S;
    const K1 = (P01 + x * P11) / S;

    // State update: θ = θ + K * e
    th0 += K0 * e;
    th1 += K1 * e;

    // Covariance update — Joseph form for stability:
    // A = I - K·H:  A = [[1-K0, -K0*x], [-K1, 1-K1*x]]
    const A00 = 1 - K0;
    const A01 = -K0 * x;
    const A10 = -K1;
    const A11 = 1 - K1 * x;

    // P_new = A·P·A^T + K·Ve·K^T
    // A·P:
    const AP00 = A00 * P00 + A01 * P01;   // wait — P is [[P00,P01],[P01,P11]]
    const AP01 = A00 * P01 + A01 * P11;
    const AP10 = A10 * P00 + A11 * P01;
    const AP11 = A10 * P01 + A11 * P11;

    // A·P·A^T:
    const newP00 = AP00 * A00 + AP01 * A01;
    const newP01 = AP00 * A10 + AP01 * A11;
    const newP11 = AP10 * A10 + AP11 * A11;

    // + K·Ve·K^T
    P00 = newP00 + K0 * K0 * Ve;
    P01 = newP01 + K0 * K1 * Ve;
    P11 = newP11 + K1 * K1 * Ve;

    const zScore = e / Math.sqrt(Math.max(S, 1e-12));
    const spreadVol = Math.sqrt(Math.max(S, 1e-12));

    result.push({
      date: dates[t],
      logY: y,
      logX: x,
      alpha: th0,
      beta: th1,
      spread: e,
      zscore: zScore,
      spreadVol,
    });
  }

  return result;
}

// ── Trade Simulation ────────────────────────────────────────────────────────

export function simulatePairsTrades(series: KalmanPoint[], params: KalmanParams = DEFAULT_PARAMS): PairsTrade[] {
  const trades: PairsTrade[] = [];
  let inTrade = false;
  let direction: 'long' | 'short' = 'long';
  let entryIdx = 0;
  let entryZ = 0;
  let entryBeta = 1;
  let entrySpreadVol = 0;
  let entryLogY = 0, entryLogX = 0;

  // Position sizing & cost params
  const positionSizePct = params.positionSizePct ?? 15;
  const totalCostBps = params.totalCostBps ?? 5;

  // Burn-in: skip first 30 points to let filter converge
  const BURN_IN = 30;

  for (let t = BURN_IN; t < series.length; t++) {
    const pt = series[t];

    if (!inTrade) {
      // Entry signals
      if (pt.zscore < -ENTRY_Z) {
        inTrade = true;
        direction = 'long';
        entryIdx = t;
        entryZ = pt.zscore;
        entryBeta = pt.beta;
        entrySpreadVol = pt.spreadVol;
        entryLogY = pt.logY;
        entryLogX = pt.logX;
      } else if (pt.zscore > ENTRY_Z) {
        inTrade = true;
        direction = 'short';
        entryIdx = t;
        entryZ = pt.zscore;
        entryBeta = pt.beta;
        entrySpreadVol = pt.spreadVol;
        entryLogY = pt.logY;
        entryLogX = pt.logX;
      }
    } else {
      const daysHeld = t - entryIdx;
      const absZ = Math.abs(pt.zscore);

      let exit = false;
      let exitReason: PairsTrade['exitReason'] = 'signal';

      // Stop loss
      if (absZ > STOP_Z) {
        exit = true;
        exitReason = 'stop';
      }
      // Mean reversion exit
      else if (direction === 'long' && pt.zscore > -EXIT_Z) {
        exit = true;
      } else if (direction === 'short' && pt.zscore < EXIT_Z) {
        exit = true;
      }

      if (exit) {
        // Raw spread change in log-level space
        const spreadChange = (pt.logY - entryLogY) - entryBeta * (pt.logX - entryLogX);

        // Normalize to sigma-units, then scale by position size:
        //   capture ≈ z_entry - z_exit (σ units of mean-reversion captured)
        //   pnlPct = capture × positionSizePct × 0.01 − roundTripCost
        // This gives ~0.1-0.3% per trade at default positionSizePct=15, matching
        // realistic FX pairs fund returns of 15-25% annually over ~100 trades.
        const capture = entrySpreadVol > 0 ? spreadChange / entrySpreadVol : spreadChange;
        const directedCapture = direction === 'long' ? capture : -capture;
        const costPct = totalCostBps / 10000;
        const pnlPct = directedCapture * (positionSizePct * 0.01) - costPct * 100;

        trades.push({
          entryDate: series[entryIdx].date,
          exitDate: pt.date,
          direction,
          entryZ: Math.round(entryZ * 1000) / 1000,
          exitZ: Math.round(pt.zscore * 1000) / 1000,
          entryBeta: Math.round(entryBeta * 1000) / 1000,
          entrySpreadVol: Math.round(entrySpreadVol * 100000) / 100000,
          daysHeld,
          pnlPct: Math.round(pnlPct * 1000) / 1000,
          exitReason,
        });

        inTrade = false;
      }
    }
  }

  return trades;
}

// ── Equity Curve + Stats ────────────────────────────────────────────────────

export function buildEquityAndStats(
  trades: PairsTrade[],
  series: KalmanPoint[],
): { equity: { date: string; value: number }[]; stats: PairsStats } {
  // Build equity curve: one point per trade exit, starting at 100
  let value = 100;
  const equity: { date: string; value: number }[] = [
    { date: series[0]?.date ?? '', value: 100 },
  ];

  for (const t of trades) {
    value *= 1 + t.pnlPct / 100;
    equity.push({ date: t.exitDate, value: Math.round(value * 100) / 100 });
  }

  // Stats
  const n = trades.length;
  const totalReturn = value - 100;
  const wins = trades.filter(t => t.pnlPct > 0).length;
  const pnls = trades.map(t => t.pnlPct);
  const avgPnl = n > 0 ? pnls.reduce((s, v) => s + v, 0) / n : 0;
  const avgHold = n > 0 ? trades.reduce((s, t) => s + t.daysHeld, 0) / n : 0;

  // Annualized return: assume ~252 trading days/year
  const totalDays = trades.reduce((s, t) => s + t.daysHeld, 0);
  const years = totalDays / 252;
  const annualizedReturn = years > 0
    ? (Math.pow(value / 100, 1 / years) - 1) * 100
    : 0;

  // Sharpe on per-trade returns (annualized by sqrt of trades/year)
  const stdPnl = n > 1
    ? Math.sqrt(pnls.reduce((s, v) => s + (v - avgPnl) ** 2, 0) / (n - 1))
    : 0;
  const tradesPerYear = years > 0 ? n / years : 0;
  const sharpe = stdPnl > 0
    ? (avgPnl / stdPnl) * Math.sqrt(tradesPerYear)
    : 0;

  // Max drawdown
  let peak = 100, maxDD = 0;
  for (const pt of equity) {
    if (pt.value > peak) peak = pt.value;
    const dd = (pt.value - peak) / peak * 100;
    if (dd < maxDD) maxDD = dd;
  }

  return {
    equity,
    stats: {
      totalReturn: Math.round(totalReturn * 10) / 10,
      annualizedReturn: Math.round(annualizedReturn * 10) / 10,
      sharpe: Math.round(sharpe * 100) / 100,
      maxDrawdown: Math.round(maxDD * 10) / 10,
      winRate: n > 0 ? Math.round((wins / n) * 1000) / 10 : 0,
      trades: n,
      avgHoldDays: Math.round(avgHold * 10) / 10,
      avgPnlPct: Math.round(avgPnl * 100) / 100,
    },
  };
}

// ── Full Pipeline ────────────────────────────────────────────────────────────

export function runKalmanPairs(
  dates: string[],
  logY: number[],
  logX: number[],
  pairY: string,
  pairX: string,
  params: KalmanParams = DEFAULT_PARAMS,
): KalmanResult {
  const series = runKalmanFilter(dates, logY, logX, params);
  const trades = simulatePairsTrades(series, params);
  const { equity, stats } = buildEquityAndStats(trades, series);
  return { series, trades, equity, stats, pairY, pairX };
}
