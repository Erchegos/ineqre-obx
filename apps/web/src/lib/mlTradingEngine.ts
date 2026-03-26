// ============================================================================
// ML TRADING ENGINE — Pure simulation engine for Alpha Engine Simulator tab
// Pattern: same as fxKalmanPairs.ts — pure TS, no side effects, no DB calls
// ============================================================================

// ── Interfaces ──────────────────────────────────────────────────────────────

export interface SimParams {
  entryThreshold: number;      // Min predicted return % to trigger BUY (default 2.0)
  exitThreshold: number;       // Exit when prediction drops below this % (default -1.0)
  stopLossPct: number;         // Hard stop on actual return % (default 5.0)
  takeProfitPct: number;       // Take profit target % (default 8.0)
  positionSizePct: number;     // % of NAV per trade (default 10)
  minHoldDays: number;         // Minimum hold to prevent whipsaw (default 5)
  maxHoldDays: number;         // Time-based exit (default 30)
  cooldownBars: number;        // Bars after exit before new entry (default 3)
  costBps: number;             // Round-trip transaction cost bps (default 10)
  momentumFilter: 0 | 1 | 2 | 3;   // Require N-of-3 positive momentum (0=OFF)
  volGate: 'off' | 'soft' | 'hard'; // Vol regime suppression
  sma200Require: boolean;      // Only long when price > 200 SMA
  sma50Require: boolean;       // Only long when price > 50 SMA
  smaExitOnCross: boolean;     // Exit if price crosses below SMA200
  valuationFilter: boolean;    // Avoid extreme valuation premium
}

export interface SimInputBar {
  date: string;
  open: number;
  close: number;
  high: number;
  low: number;
  volume: number;
  sma200: number | null;
  sma50: number | null;
  mlPrediction: number | null;   // predicted_return from alpha_signals
  mlConfidence: number | null;   // confidence score
  mom1m: number | null;
  mom6m: number | null;
  mom11m: number | null;
  vol1m: number | null;
  volRegime: 'low' | 'high' | null;
  ep: number | null;
  bm: number | null;
  epSectorZ: number | null;     // sector-relative z-score
  bmSectorZ: number | null;
  benchmarkClose: number | null; // OBX close
}

export interface SimSeriesBar {
  date: string;
  price: number;
  open: number;
  high: number;
  low: number;
  volume: number;
  sma200: number | null;
  sma50: number | null;
  mlPrediction: number | null;   // step-held prediction
  mlConfidence: number | null;
  momScore: number;              // 0-3 count of positive mom windows
  volRegime: string | null;
  ep: number | null;
  bm: number | null;
  epSectorZ: number | null;
  bmSectorZ: number | null;
  // Signal state
  signalActive: boolean;         // Would ML signal fire?
  signalBlocked: boolean;        // Active but blocked by filter?
  blockReason: string | null;    // 'momentum' | 'volRegime' | 'sma200' | 'sma50' | 'valuation' | 'cooldown'
  inPosition: boolean;
  unrealizedPnl: number | null;  // % from entry if in position
  positionDaysHeld: number | null;
  entryMarker: boolean;          // Entry happened at this bar (for chart markers)
  exitMarker: boolean;           // Exit happened at this bar
  exitWin: boolean | null;       // true=win, false=loss, null=no exit
  // Equity
  equityValue: number;           // Compounded NAV indexed to 100
  benchmarkValue: number;        // OBX indexed to 100
}

export interface SimTrade {
  entryDate: string;
  exitDate: string;
  entryPrice: number;
  exitPrice: number;
  predictedReturn: number;
  actualReturn: number;
  pnlPct: number;
  daysHeld: number;
  exitReason: 'take_profit' | 'stop_loss' | 'signal_flip' | 'time_stop' | 'sma_cross' | 'vol_regime';
  maxDrawdown: number;
  momAtEntry: number;
  volAtEntry: string | null;
  predAtEntry: number;
}

export interface SimStats {
  totalReturn: number;
  annualizedReturn: number;
  benchmarkReturn: number;
  benchmarkAnnReturn: number;
  excessReturn: number;
  sharpe: number;
  maxDrawdown: number;
  winRate: number;
  trades: number;
  avgHoldDays: number;
  avgWinPct: number;
  avgLossPct: number;
  profitFactor: number;
}

export interface SimResult {
  series: SimSeriesBar[];
  trades: SimTrade[];
  stats: SimStats;
}

export const SIM_DEFAULTS: SimParams = {
  entryThreshold: 1.0,       // Match Explorer default
  exitThreshold: 0.25,       // Match Explorer default
  stopLossPct: 5.0,
  takeProfitPct: 100,         // Effectively off (Explorer has no TP)
  positionSizePct: 10,
  minHoldDays: 5,
  maxHoldDays: 21,
  cooldownBars: 0,            // Match Explorer (no cooldown)
  costBps: 10,
  momentumFilter: 0,          // Off by default (Explorer has no momentum filter)
  volGate: 'off',
  sma200Require: false,
  sma50Require: false,
  smaExitOnCross: false,
  valuationFilter: false,
};

// ── Core Engine ─────────────────────────────────────────────────────────────

export function runMLSimulation(input: SimInputBar[], params: SimParams): SimResult {
  const series: SimSeriesBar[] = [];
  const trades: SimTrade[] = [];

  if (input.length < 2) return { series: [], trades: [], stats: emptyStats() };

  // State
  let inPosition = false;
  let entryBar = -1;
  let entryPrice = 0;
  let entryPrediction = 0;
  let entryMomScore = 0;
  let entryVolRegime: string | null = null;
  let cooldownUntil = -1;
  let equityValue = 100;
  let peakEquity = 100;
  let maxDrawdown = 0;
  let tradeMinPrice = Infinity;

  // Step-hold ML predictions (monthly → daily)
  let heldPrediction: number | null = null;
  let heldConfidence: number | null = null;
  // Previous bar prediction % (for cross-above entry logic, matching Explorer)
  let prevPredPct: number | null = null;
  // OBX benchmark start
  const obxStart = input.find(b => b.benchmarkClose != null)?.benchmarkClose ?? null;

  for (let i = 0; i < input.length; i++) {
    const bar = input[i];

    // Step-hold: carry forward last known prediction
    if (bar.mlPrediction != null) {
      heldPrediction = bar.mlPrediction;
      heldConfidence = bar.mlConfidence;
    }

    // Momentum score: count positive momentum windows
    const momScore = [bar.mom1m, bar.mom6m, bar.mom11m]
      .filter(v => v != null && v > 0).length as 0 | 1 | 2 | 3;

    const predPct = heldPrediction != null ? heldPrediction * 100 : null;

    // Benchmark
    const benchmarkValue = (obxStart != null && bar.benchmarkClose != null)
      ? (bar.benchmarkClose / obxStart) * 100
      : series.length > 0 ? series[series.length - 1].benchmarkValue : 100;

    let entryMarker = false;
    let exitMarker = false;
    let exitWin: boolean | null = null;

    // ── EXIT LOGIC (check before entry) ──
    if (inPosition && i > entryBar) {
      const daysHeld = i - entryBar;
      const currentReturn = (bar.close - entryPrice) / entryPrice;
      if (bar.close < tradeMinPrice) tradeMinPrice = bar.close;
      const tradeMaxDD = (tradeMinPrice - entryPrice) / entryPrice;

      let exitReason: SimTrade['exitReason'] | null = null;

      // Stop loss — always checked, ignores minHold
      if (currentReturn <= -(params.stopLossPct / 100)) {
        exitReason = 'stop_loss';
      } else if (daysHeld >= params.minHoldDays) {
        // Take profit
        if (currentReturn >= params.takeProfitPct / 100) {
          exitReason = 'take_profit';
        }
        // Signal flip — level-based: exit whenever prediction drops to/below exit threshold
        else if (predPct != null && predPct <= params.exitThreshold) {
          exitReason = 'signal_flip';
        }
        // Time stop
        else if (daysHeld >= params.maxHoldDays) {
          exitReason = 'time_stop';
        }
        // SMA cross exit
        else if (params.smaExitOnCross && bar.sma200 != null && bar.close < bar.sma200) {
          exitReason = 'sma_cross';
        }
        // Vol regime exit (hard gate only)
        else if (params.volGate === 'hard' && bar.volRegime === 'high') {
          exitReason = 'vol_regime';
        }
      }

      if (exitReason) {
        const rawReturn = (bar.close - entryPrice) / entryPrice;
        const costAdj = params.costBps / 10000;
        const pnlPct = rawReturn - costAdj;

        trades.push({
          entryDate: input[entryBar].date,
          exitDate: bar.date,
          entryPrice,
          exitPrice: bar.close,
          predictedReturn: entryPrediction,
          actualReturn: rawReturn,
          pnlPct,
          daysHeld,
          exitReason,
          maxDrawdown: tradeMaxDD,
          momAtEntry: entryMomScore,
          volAtEntry: entryVolRegime,
          predAtEntry: entryPrediction * 100,
        });

        equityValue *= (1 + pnlPct);
        if (equityValue > peakEquity) peakEquity = equityValue;
        const dd = (equityValue - peakEquity) / peakEquity;
        if (dd < maxDrawdown) maxDrawdown = dd;

        inPosition = false;
        cooldownUntil = i + params.cooldownBars;
        exitMarker = true;
        exitWin = rawReturn > 0;
      }
    }

    // ── ENTRY LOGIC ──
    let signalActive = false;
    let signalBlocked = false;
    let blockReason: string | null = null;

    if (!inPosition && predPct != null && i > cooldownUntil) {
      // Cross-above entry: signal must transition from below to above threshold (matches Explorer)
      if (predPct >= params.entryThreshold && (prevPredPct === null || prevPredPct < params.entryThreshold)) {
        signalActive = true;

        // Check filters
        if (i <= cooldownUntil) {
          signalBlocked = true;
          blockReason = 'cooldown';
        }

        if (!signalBlocked && params.momentumFilter > 0 && momScore < params.momentumFilter) {
          signalBlocked = true;
          blockReason = 'momentum';
        }

        if (!signalBlocked && params.volGate !== 'off' && bar.volRegime === 'high') {
          if (params.volGate === 'hard') {
            signalBlocked = true;
            blockReason = 'volRegime';
          }
          // 'soft' doesn't block, just noted
        }

        if (!signalBlocked && params.sma200Require) {
          if (bar.sma200 == null || bar.close < bar.sma200) {
            signalBlocked = true;
            blockReason = 'sma200';
          }
        }

        if (!signalBlocked && params.sma50Require) {
          if (bar.sma50 == null || bar.close < bar.sma50) {
            signalBlocked = true;
            blockReason = 'sma50';
          }
        }

        if (!signalBlocked && params.valuationFilter) {
          if (bar.epSectorZ != null && bar.epSectorZ < -2) {
            signalBlocked = true;
            blockReason = 'valuation';
          }
        }

        // ENTER: signal at close t → fill at CLOSE of same bar (matches Explorer)
        if (signalActive && !signalBlocked) {
          inPosition = true;
          entryBar = i;
          entryPrice = bar.close;
          entryPrediction = heldPrediction!;
          entryMomScore = momScore;
          entryVolRegime = bar.volRegime;
          tradeMinPrice = bar.close;
          entryMarker = true;
        }
      }
    }

    // ── BUILD SERIES POINT ──
    const isInPos = inPosition && i >= entryBar;
    const unrealizedPnl = isInPos
      ? (bar.close - entryPrice) / entryPrice
      : null;

    series.push({
      date: bar.date,
      price: bar.close,
      open: bar.open,
      high: bar.high,
      low: bar.low,
      volume: bar.volume,
      sma200: bar.sma200,
      sma50: bar.sma50,
      mlPrediction: predPct,
      mlConfidence: heldConfidence,
      momScore,
      volRegime: bar.volRegime,
      ep: bar.ep,
      bm: bar.bm,
      epSectorZ: bar.epSectorZ,
      bmSectorZ: bar.bmSectorZ,
      signalActive,
      signalBlocked,
      blockReason,
      inPosition: isInPos,
      unrealizedPnl,
      positionDaysHeld: isInPos ? i - entryBar : null,
      entryMarker,
      exitMarker,
      exitWin,
      equityValue: unrealizedPnl != null ? equityValue * (1 + unrealizedPnl) : equityValue,
      benchmarkValue,
    });

    // Update prevPredPct for next iteration's cross-above check
    prevPredPct = predPct;
  }

  // Close out any open position at last bar (for stats)
  if (inPosition && series.length > 0) {
    const lastBar = input[input.length - 1];
    const daysHeld = input.length - 1 - entryBar;
    const rawReturn = (lastBar.close - entryPrice) / entryPrice;
    const pnlPct = rawReturn - params.costBps / 10000;
    trades.push({
      entryDate: input[entryBar].date,
      exitDate: lastBar.date,
      entryPrice,
      exitPrice: lastBar.close,
      predictedReturn: entryPrediction,
      actualReturn: rawReturn,
      pnlPct,
      daysHeld,
      exitReason: 'time_stop',
      maxDrawdown: (tradeMinPrice - entryPrice) / entryPrice,
      momAtEntry: entryMomScore,
      volAtEntry: entryVolRegime,
      predAtEntry: entryPrediction * 100,
    });
    equityValue *= (1 + pnlPct);
  }

  const stats = computeStats(trades, equityValue, maxDrawdown, series, params);
  return { series, trades, stats };
}

// ── Stats ───────────────────────────────────────────────────────────────────

function computeStats(
  trades: SimTrade[],
  finalEquity: number,
  maxDD: number,
  series: SimSeriesBar[],
  _params: SimParams,
): SimStats {
  if (trades.length === 0) return emptyStats();

  const totalReturn = (finalEquity - 100) / 100;
  const tradingDays = series.length;
  const years = tradingDays / 252;
  const annReturn = years > 0 ? Math.pow(1 + totalReturn, 1 / years) - 1 : 0;

  const benchStart = series[0]?.benchmarkValue ?? 100;
  const benchEnd = series[series.length - 1]?.benchmarkValue ?? 100;
  const benchReturn = (benchEnd - benchStart) / benchStart;
  const benchAnnReturn = years > 0 ? Math.pow(1 + benchReturn, 1 / years) - 1 : 0;

  // Use raw actualReturn for stats (matches Explorer's display — full price return, not position-sized)
  const wins = trades.filter(t => t.actualReturn > 0);
  const losses = trades.filter(t => t.actualReturn <= 0);

  const grossProfit = wins.reduce((s, t) => s + t.actualReturn, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.actualReturn, 0));

  // Sharpe from raw return series
  const rets = trades.map(t => t.actualReturn);
  const avgRet = rets.reduce((a, b) => a + b, 0) / rets.length;
  const stdRet = Math.sqrt(rets.reduce((s, p) => s + (p - avgRet) ** 2, 0) / Math.max(1, rets.length - 1));
  const avgTradesPerYear = trades.length / Math.max(0.5, years);
  const sharpe = stdRet > 0 ? (avgRet / stdRet) * Math.sqrt(avgTradesPerYear) : 0;

  return {
    totalReturn,
    annualizedReturn: annReturn,
    benchmarkReturn: benchReturn,
    benchmarkAnnReturn: benchAnnReturn,
    excessReturn: annReturn - benchAnnReturn,
    sharpe,
    maxDrawdown: maxDD,
    winRate: trades.length > 0 ? wins.length / trades.length : 0,
    trades: trades.length,
    avgHoldDays: trades.reduce((s, t) => s + t.daysHeld, 0) / trades.length,
    avgWinPct: wins.length > 0 ? grossProfit / wins.length : 0,
    avgLossPct: losses.length > 0 ? -grossLoss / losses.length : 0,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0,
  };
}

function emptyStats(): SimStats {
  return {
    totalReturn: 0, annualizedReturn: 0, benchmarkReturn: 0, benchmarkAnnReturn: 0,
    excessReturn: 0, sharpe: 0, maxDrawdown: 0, winRate: 0, trades: 0,
    avgHoldDays: 0, avgWinPct: 0, avgLossPct: 0, profitFactor: 0,
  };
}

// Re-compute stats from a subset of trades (for progressive animation)
export function computeProgressiveStats(
  trades: SimTrade[],
  series: SimSeriesBar[],
): SimStats {
  if (trades.length === 0 || series.length === 0) return emptyStats();

  let equity = 100;
  let peak = 100;
  let maxDD = 0;
  for (const t of trades) {
    equity *= (1 + t.pnlPct);
    if (equity > peak) peak = equity;
    const dd = (equity - peak) / peak;
    if (dd < maxDD) maxDD = dd;
  }

  const totalReturn = (equity - 100) / 100;
  const tradingDays = series.length;
  const years = tradingDays / 252;
  const annReturn = years > 0 ? Math.pow(1 + totalReturn, 1 / years) - 1 : 0;

  const benchStart = series[0]?.benchmarkValue ?? 100;
  const benchEnd = series[series.length - 1]?.benchmarkValue ?? 100;
  const benchReturn = (benchEnd - benchStart) / benchStart;
  const benchAnnReturn = years > 0 ? Math.pow(1 + benchReturn, 1 / years) - 1 : 0;

  // Use raw actualReturn for stats (matches Explorer display)
  const wins = trades.filter(t => t.actualReturn > 0);
  const losses = trades.filter(t => t.actualReturn <= 0);
  const grossProfit = wins.reduce((s, t) => s + t.actualReturn, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.actualReturn, 0));

  const rets = trades.map(t => t.actualReturn);
  const avgRet = rets.reduce((a, b) => a + b, 0) / rets.length;
  const stdRet = Math.sqrt(rets.reduce((s, p) => s + (p - avgRet) ** 2, 0) / Math.max(1, rets.length - 1));
  const avgTradesPerYear = trades.length / Math.max(0.5, years);
  const sharpe = stdRet > 0 ? (avgRet / stdRet) * Math.sqrt(avgTradesPerYear) : 0;

  return {
    totalReturn,
    annualizedReturn: annReturn,
    benchmarkReturn: benchReturn,
    benchmarkAnnReturn: benchAnnReturn,
    excessReturn: annReturn - benchAnnReturn,
    sharpe,
    maxDrawdown: maxDD,
    winRate: trades.length > 0 ? wins.length / trades.length : 0,
    trades: trades.length,
    avgHoldDays: trades.reduce((s, t) => s + t.daysHeld, 0) / trades.length,
    avgWinPct: wins.length > 0 ? grossProfit / wins.length : 0,
    avgLossPct: losses.length > 0 ? -grossLoss / losses.length : 0,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0,
  };
}
