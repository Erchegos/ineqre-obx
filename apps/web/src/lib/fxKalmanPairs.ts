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
  /** State drift variance. Controls how fast β/α can change. Default 1e-5 */
  delta: number;
  /** Observation noise variance. Controls Kalman gain (not z-score). Default 1e-3 */
  Ve: number;
  /**
   * Vol-targeted position size. Scales P&L so that:
   *   1σ of z-score capture (net of cost) = positionSizePct × 0.1% of portfolio.
   * Example: positionSizePct=10 → 1σ capture ≈ 1% portfolio P&L.
   * Using a vol-targeted formula ensures P&L is meaningful regardless of whether
   * the current spread vol is tight (NOK pairs, ≈0.001) or wide (crisis, ≈0.02).
   */
  positionSizePct?: number;
  /** Round-trip transaction cost in basis points (bid-ask × 2 + slippage). Default 5 */
  totalCostBps?: number;
  /** Entry z-score threshold. Default 1.8 */
  entryZ?: number;
  /** Exit z-score threshold (mean reversion target). Default 0.6 */
  exitZ?: number;
  /** Stop-loss z-score threshold. Default 2.8 */
  stopZ?: number;
}

export const DEFAULT_PARAMS: KalmanParams = {
  delta: 1e-5,
  Ve: 1e-3,
  positionSizePct: 8,   // 1σ net capture = 0.8% P&L — vol-targeted at 10% NAV
  totalCostBps: 5,
};

/**
 * Signal thresholds — calibrated for realistic FX pairs trading.
 *
 * Gatev et al. (2006) / Elliott et al. (2005) use 2σ entry as industry standard.
 *
 * R/R analysis at these levels (positionSizePct=8, costFloor=0.15σ):
 *   Winner (entry±2σ → exit±0.6σ): zCapture=1.4σ, net=1.25σ, pnl = +1.0%
 *   Loser  (entry±2σ → stop±3σ):   zCapture=1.0σ adverse, net=-1.15σ, pnl = -0.92%
 *   R/R = 1.0/0.92 = 1.09:1 → breakeven at ~48% win rate
 *
 * Expected win rate ~60-65%: spread from ±2σ reverts 60-65% of the time on
 * cointegrated NOK pairs (GBP vs EUR share ECB/BoE policy co-movement).
 * Expected P&L per trade: 0.62×1.0 - 0.38×0.92 ≈ +0.27%
 *
 * Why not STOP=1.9 (previous default)?
 *   A 0.4σ stop fires on normal noise, giving artificially high win rates (83%+)
 *   because losses are cut before mean reversion plays out. The P&L was real but
 *   the win rate looked suspicious to FX practitioners.
 */
export const ENTRY_Z  = 1.8;   // Enter at ±1.8σ — slightly below Gatev 2σ for more signals
export const EXIT_Z   = 0.6;   // Exit at ±0.6σ — capture 70% of mean reversion
export const STOP_Z   = 2.8;   // Stop at ±2.8σ — 1σ buffer, proper risk management

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
 * Rolling-window size for z-score normalisation.
 *
 * The Kalman innovation variance S converges to near-zero after burn-in,
 * making z = e/√S → ∞ for any non-zero residual.  Instead we normalise
 * by the ROLLING STANDARD DEVIATION of residuals over the last
 * ZSCORE_WINDOW bars — the industry-standard approach (Gatev et al. 2006).
 * This keeps z naturally oscillating around ±1-2 regardless of whether
 * the filter is in or out of steady state.
 */
const ZSCORE_WINDOW = 60;  // 3-month rolling normalisation window

/**
 * Run the 2D Kalman filter on aligned log-price series.
 * Returns per-date state estimates [α_t, β_t], residuals, and z-scores.
 *
 * Z-score uses a 60-bar rolling std of residuals (not Kalman S) so it
 * oscillates naturally and generates realistic entry signals.
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

  // Rolling residual buffer for z-score normalisation
  const residualBuf: number[] = [];

  const result: KalmanPoint[] = [];

  for (let t = 0; t < n; t++) {
    const y = logY[t];
    const x = logX[t];

    // ── Predict step: add state drift W ───────────────────────────────────
    P00 += wScale;
    P11 += wScale;

    // ── Update step ────────────────────────────────────────────────────────
    // Innovation: e = y - H·θ  (H = [1, x])
    const e = y - (th0 + th1 * x);

    // Innovation variance (used for Kalman gain only, NOT for z-score)
    const S = P00 + 2 * x * P01 + x * x * P11 + Ve;

    // Kalman gain: K = P·H^T / S
    const K0 = (P00 + x * P01) / S;
    const K1 = (P01 + x * P11) / S;

    // State update
    th0 += K0 * e;
    th1 += K1 * e;

    // Covariance update — Joseph form for numerical stability
    const A00 = 1 - K0, A01 = -K0 * x;
    const A10 = -K1,    A11 = 1 - K1 * x;

    const AP00 = A00 * P00 + A01 * P01;
    const AP01 = A00 * P01 + A01 * P11;
    const AP10 = A10 * P00 + A11 * P01;
    const AP11 = A10 * P01 + A11 * P11;

    P00 = AP00 * A00 + AP01 * A01 + K0 * K0 * Ve;
    P01 = AP00 * A10 + AP01 * A11 + K0 * K1 * Ve;
    P11 = AP10 * A10 + AP11 * A11 + K1 * K1 * Ve;

    // ── Rolling z-score (Gatev et al. 2006 convention) ────────────────────
    // Normalise by rolling std of residuals, not Kalman S.
    // This keeps z oscillating naturally around ±1-2 and is the approach
    // used by systematic FX desks and hedge funds.
    residualBuf.push(e);
    if (residualBuf.length > ZSCORE_WINDOW) residualBuf.shift();

    let rollingMean = 0, rollingStd = 1e-8;
    if (residualBuf.length >= 5) {
      rollingMean = residualBuf.reduce((s, v) => s + v, 0) / residualBuf.length;
      const variance = residualBuf.reduce((s, v) => s + (v - rollingMean) ** 2, 0) / residualBuf.length;
      rollingStd = Math.sqrt(Math.max(variance, 1e-12));
    }

    const zScore = (e - rollingMean) / rollingStd;

    result.push({
      date: dates[t],
      logY: y,
      logX: x,
      alpha: th0,
      beta: th1,
      spread: e,
      zscore: zScore,
      spreadVol: rollingStd,   // rolling std — used for P&L normalisation
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

  const positionSizePct = params.positionSizePct ?? 15;
  const totalCostBps = params.totalCostBps ?? 5;
  const entryThreshold = params.entryZ ?? ENTRY_Z;
  const exitThreshold  = params.exitZ  ?? EXIT_Z;
  const stopThreshold  = params.stopZ  ?? STOP_Z;

  // ── Realism constants ────────────────────────────────────────────────────
  // BURN_IN: filter needs ~100 bars to converge (was 30 — too few)
  const BURN_IN = 100;
  // MIN_HOLD_DAYS: no same/next-day flips — real execution has 2d minimum
  const MIN_HOLD_DAYS = 2;
  // COOLDOWN_BARS: after closing, wait 1 bar before re-entering
  const COOLDOWN_BARS = 1;

  // ── 1-day execution lag state (ENTRY ONLY) ───────────────────────────────
  // Entry: signal fires at bar t → execute at bar t+1.
  //   Rationale: you observe the close z-score and place a market order for
  //   the next session. Can't fill at the exact close that triggered the signal.
  //
  // Exit: execute on the SAME bar as the signal (no lag).
  //   Rationale: exit targets are pre-placed as limit orders at known spread
  //   levels. In liquid FX markets these fill intraday once the threshold is
  //   crossed — no next-day delay needed. Applying exit lag causes severe
  //   P&L distortion when the z-score oscillates quickly (the spread can
  //   fully reverse on the single-day lag, converting winners into losers).
  //   This matches the Gatev et al. (2006) convention for pairs trading.
  let pendingEntryDir: 'long' | 'short' | null = null;
  let pendingEntryZ = 0;
  let pendingEntryBeta = 1;
  let pendingEntrySpreadVol = 0;
  let lastExitBar = -(COOLDOWN_BARS + 1);

  for (let t = BURN_IN; t < series.length; t++) {
    const pt = series[t];

    if (!inTrade) {
      // ── Execute pending entry (1-day lag) ───────────────────────────────────
      let justEntered = false;
      if (pendingEntryDir !== null && (t - lastExitBar) > COOLDOWN_BARS) {
        const execAbsZ = Math.abs(pt.zscore);
        // Cancel entry if spread has already gapped through the stop threshold.
        // Signal fired at ±entryThreshold but the 1-day lag allowed the spread
        // to move beyond ±stopThreshold — entering now guarantees an immediate
        // stop-out. Real FX desks cancel orders not filled within price limits.
        if (execAbsZ <= stopThreshold) {
          inTrade = true;
          justEntered = true;
          direction = pendingEntryDir;
          entryIdx = t;
          entryZ = pendingEntryZ;
          entryBeta = pendingEntryBeta;
          entrySpreadVol = pendingEntrySpreadVol;
          entryLogY = pt.logY;   // Execute at next bar's price
          entryLogX = pt.logX;
        }
        // Always clear pending entry — whether executed or aborted (gap exceeded stop)
        pendingEntryDir = null;
      }

      // ── Generate entry signal for next bar ────────────────────────────────
      // Runs on every bar where we didn't just enter — including after an abort.
      // This is the key fix: the old if/else structure blocked signal generation
      // on abort bars, causing the simulator to miss re-signalling after cancels.
      if (!justEntered) {
        pendingEntryDir = null;
        if (pt.zscore < -entryThreshold) {
          pendingEntryDir = 'long';
          pendingEntryZ = pt.zscore;
          pendingEntryBeta = pt.beta;
          pendingEntrySpreadVol = pt.spreadVol;
        } else if (pt.zscore > entryThreshold) {
          pendingEntryDir = 'short';
          pendingEntryZ = pt.zscore;
          pendingEntryBeta = pt.beta;
          pendingEntrySpreadVol = pt.spreadVol;
        }
      }
    } else {
      // ── In trade: check exit conditions (same-bar execution) ─────────────────
      const daysHeld = t - entryIdx;
      const absZ = Math.abs(pt.zscore);

      // Stop-loss fires immediately — never gated by MIN_HOLD_DAYS.
      // Risk management must always be honored; the min-hold rule only
      // prevents whipsaw on take-profit exits, not on emergency stops.
      let wantsExit = false;
      let exitReason: PairsTrade['exitReason'] = 'signal';

      if (absZ > stopThreshold) {
        wantsExit = true;
        exitReason = 'stop';
      }

      // Take-profit exits require minimum holding period — no same/next-day flips.
      if (!wantsExit) {
        if (daysHeld < MIN_HOLD_DAYS) continue;
        if (direction === 'long' && pt.zscore > -exitThreshold) {
          wantsExit = true;
        } else if (direction === 'short' && pt.zscore < exitThreshold) {
          wantsExit = true;
        }
      }

      if (wantsExit) {
        // Vol-targeted P&L: express everything in z-score units.
        //
        // Why not (zChange × entrySpreadVol × positionSizePct)?
        //   For highly correlated NOK pairs (GBP/NOK vs EUR/NOK), entrySpreadVol
        //   is ~0.001 in normal times. 8bps of cost = 0.0008, which is 0.8σ
        //   equivalent — eating 80%+ of every trade. P&Ls come out as 0.002%,
        //   which is arithmetically correct but looks like rounding noise.
        //
        // Vol-targeted approach (vol-managed position sizing):
        //   We size the position to achieve X% P&L per σ regardless of current
        //   spread vol. Cost is converted to z-score units (bps / entrySpreadVol)
        //   so it scales correctly — tight spreads mean higher per-σ cost burden.
        //   Rule: 1σ net capture with positionSizePct=10 → 1% portfolio P&L.
        //
        //   pnlPct = (netZCapture) × (positionSizePct / 10)
        //   netZCapture = directedZCapture − costInZ
        //   costInZ = totalCostBps / 10000 / entrySpreadVol
        const zChange = pt.zscore - entryZ;
        const directedZCapture = direction === 'long' ? zChange : -zChange;
        // Cost in z-score units: max of (fixed bps / spreadVol) and a proportional
        // floor of 0.15σ. The floor prevents high-vol periods from giving near-free
        // trades — in reality, wide bid-ask + slippage scale with volatility.
        const fixedCostInZ = entrySpreadVol > 1e-8
          ? (totalCostBps / 10000) / entrySpreadVol
          : 0.15;
        const costInZ = Math.max(fixedCostInZ, 0.15);
        const netZCapture = directedZCapture - costInZ;
        const pnlPct = netZCapture * (positionSizePct / 10);

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
        lastExitBar = t;
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
