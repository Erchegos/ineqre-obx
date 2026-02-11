import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const dynamic = "force-dynamic";

interface PriceRow {
  date: string;
  close: number;
  adj_close: number;
}

interface Trade {
  ticker: string;
  entryDate: string;
  exitDate: string;
  signal: "LONG" | "SHORT";
  entryPrice: number;
  exitPrice: number;
  returnPct: number;
  holdingDays: number;
  exitReason: string;
  sigmaAtEntry: number;
  r2: number;
  slope: number;
}

interface StrategyParams {
  entryThresholdSigma: number;
  stopSigma: number;
  maxHoldingDays: number;
  minR2: number;
  minSlope: number;
  minBM: number;
  minEP: number;
  windowSize: number;
  maxPositions: number;
  maxDrawdownPct: number;
}

const DEFAULT_PARAMS: StrategyParams = {
  entryThresholdSigma: 2.0,
  stopSigma: 2.5,
  maxHoldingDays: 14,
  minR2: 0.5,
  minSlope: 0.0001,
  minBM: 0.3,
  minEP: 0,              // Require positive earnings
  windowSize: 252,
  maxPositions: 5,
  maxDrawdownPct: 0.15,
};

interface Fundamentals {
  ep: number | null;
  bm: number | null;
}

function calculateLinearRegression(prices: number[]): {
  slope: number;
  intercept: number;
  r2: number;
} {
  const n = prices.length;
  if (n < 2) return { slope: 0, intercept: prices[0] || 0, r2: 0 };

  const sumX = (n * (n - 1)) / 2;
  const sumX2 = (n * (n - 1) * (2 * n - 1)) / 6;
  const sumY = prices.reduce((a, b) => a + b, 0);
  const sumXY = prices.reduce((sum, y, x) => sum + x * y, 0);

  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;

  const yMean = sumY / n;
  const ssTot = prices.reduce((sum, y) => sum + Math.pow(y - yMean, 2), 0);
  const ssRes = prices.reduce((sum, y, x) => {
    const yPred = intercept + slope * x;
    return sum + Math.pow(y - yPred, 2);
  }, 0);
  const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0;

  return { slope, intercept, r2 };
}

// Portfolio-aware backtest with risk controls
function runPortfolioBacktest(
  tickerPrices: Map<string, PriceRow[]>,
  tickerFundamentals: Map<string, Fundamentals>,
  params: StrategyParams
): { trades: Trade[]; maxDrawdown: number; circuitBreakerTriggered: boolean } {
  const allTrades: Trade[] = [];

  // Track open positions
  interface OpenPosition {
    ticker: string;
    entryDate: string;
    entryPrice: number;
    entryIdx: number;
    signal: "LONG" | "SHORT";
    sigmaAtEntry: number;
    r2: number;
    slope: number;
  }

  const openPositions = new Map<string, OpenPosition>();

  // Portfolio equity tracking
  let portfolioEquity = 1.0;
  let peakEquity = 1.0;
  let maxDrawdown = 0;
  let circuitBreakerTriggered = false;

  // Get all unique dates across all tickers
  const allDates = new Set<string>();
  for (const [, prices] of tickerPrices) {
    for (const p of prices) {
      allDates.add(p.date);
    }
  }
  const sortedDates = Array.from(allDates).sort();

  // Create price lookup by date for each ticker
  const tickerPriceByDate = new Map<string, Map<string, PriceRow>>();
  for (const [ticker, prices] of tickerPrices) {
    const priceMap = new Map<string, PriceRow>();
    for (const p of prices) {
      priceMap.set(p.date, p);
    }
    tickerPriceByDate.set(ticker, priceMap);
  }

  // Process each date chronologically
  for (let dateIdx = params.windowSize; dateIdx < sortedDates.length; dateIdx++) {
    const currentDate = sortedDates[dateIdx];

    // Check circuit breaker
    const currentDD = (peakEquity - portfolioEquity) / peakEquity;
    if (currentDD > params.maxDrawdownPct) {
      circuitBreakerTriggered = true;
      // Close all positions and stop
      for (const [ticker, pos] of openPositions) {
        const priceMap = tickerPriceByDate.get(ticker);
        const currentPrice = priceMap?.get(currentDate);
        if (currentPrice) {
          const price = parseFloat(String(currentPrice.adj_close || currentPrice.close));
          const returnPct = pos.signal === "LONG"
            ? (price - pos.entryPrice) / pos.entryPrice
            : (pos.entryPrice - price) / pos.entryPrice;

          allTrades.push({
            ticker,
            entryDate: pos.entryDate,
            exitDate: currentDate,
            signal: pos.signal,
            entryPrice: pos.entryPrice,
            exitPrice: price,
            returnPct,
            holdingDays: dateIdx - pos.entryIdx,
            exitReason: "CIRCUIT_BREAKER",
            sigmaAtEntry: pos.sigmaAtEntry,
            r2: pos.r2,
            slope: pos.slope,
          });

          portfolioEquity *= (1 + returnPct / params.maxPositions);
        }
      }
      openPositions.clear();
      break;
    }

    // Check exits for open positions
    for (const [ticker, pos] of Array.from(openPositions.entries())) {
      const prices = tickerPrices.get(ticker);
      if (!prices) continue;

      const priceMap = tickerPriceByDate.get(ticker);
      const currentPrice = priceMap?.get(currentDate);
      if (!currentPrice) continue;

      // Get window of prices ending at current date
      const windowStart = Math.max(0, dateIdx - params.windowSize);
      const windowPrices: number[] = [];
      for (let i = windowStart; i < dateIdx; i++) {
        const p = priceMap?.get(sortedDates[i]);
        if (p) {
          const c = parseFloat(String(p.adj_close || p.close));
          if (!isNaN(c) && c > 0) windowPrices.push(c);
        }
      }

      if (windowPrices.length < 50) continue;

      const { slope, intercept } = calculateLinearRegression(windowPrices);
      const residuals = windowPrices.map((y, x) => y - (intercept + slope * x));
      const sigma = Math.sqrt(residuals.reduce((sum, r) => sum + r * r, 0) / (residuals.length - 1));

      const price = parseFloat(String(currentPrice.adj_close || currentPrice.close));
      const midLine = intercept + slope * (windowPrices.length - 1);
      const sigmaDistance = sigma > 0 ? (price - midLine) / sigma : 0;

      const holdingDays = dateIdx - pos.entryIdx;
      let exitReason = "";
      let shouldExit = false;

      // Target: return to mean
      if (pos.signal === "LONG" && sigmaDistance >= 0) {
        shouldExit = true;
        exitReason = "TARGET";
      } else if (pos.signal === "SHORT" && sigmaDistance <= 0) {
        shouldExit = true;
        exitReason = "TARGET";
      }

      // Stop loss
      if (pos.signal === "LONG" && sigmaDistance < -params.stopSigma) {
        shouldExit = true;
        exitReason = "STOP";
      } else if (pos.signal === "SHORT" && sigmaDistance > params.stopSigma) {
        shouldExit = true;
        exitReason = "STOP";
      }

      // Time stop
      if (holdingDays >= params.maxHoldingDays) {
        shouldExit = true;
        exitReason = exitReason || "TIME";
      }

      if (shouldExit) {
        const returnPct = pos.signal === "LONG"
          ? (price - pos.entryPrice) / pos.entryPrice
          : (pos.entryPrice - price) / pos.entryPrice;

        allTrades.push({
          ticker,
          entryDate: pos.entryDate,
          exitDate: currentDate,
          signal: pos.signal,
          entryPrice: pos.entryPrice,
          exitPrice: price,
          returnPct,
          holdingDays,
          exitReason,
          sigmaAtEntry: pos.sigmaAtEntry,
          r2: pos.r2,
          slope: pos.slope,
        });

        // Update portfolio equity (equal weight per position)
        portfolioEquity *= (1 + returnPct / params.maxPositions);
        if (portfolioEquity > peakEquity) peakEquity = portfolioEquity;
        const dd = (peakEquity - portfolioEquity) / peakEquity;
        if (dd > maxDrawdown) maxDrawdown = dd;

        openPositions.delete(ticker);
      }
    }

    // Check for new entries (only if we have capacity)
    if (openPositions.size >= params.maxPositions) continue;

    // Score all potential entries and take the best ones
    interface EntryCandidate {
      ticker: string;
      signal: "LONG" | "SHORT";
      sigmaDistance: number;
      r2: number;
      slope: number;
      price: number;
      convictionScore: number;
    }

    const candidates: EntryCandidate[] = [];

    for (const [ticker, prices] of tickerPrices) {
      if (openPositions.has(ticker)) continue;

      const priceMap = tickerPriceByDate.get(ticker);
      const currentPrice = priceMap?.get(currentDate);
      if (!currentPrice) continue;

      // Get fundamentals
      const fund = tickerFundamentals.get(ticker);
      if (!fund) continue;

      // Strict fundamental filter
      if (fund.ep !== null && fund.ep < params.minEP) continue;
      if (fund.bm !== null && fund.bm < params.minBM) continue;

      // Get window of prices
      const windowStart = Math.max(0, dateIdx - params.windowSize);
      const windowPrices: number[] = [];
      for (let i = windowStart; i < dateIdx; i++) {
        const p = priceMap?.get(sortedDates[i]);
        if (p) {
          const c = parseFloat(String(p.adj_close || p.close));
          if (!isNaN(c) && c > 0) windowPrices.push(c);
        }
      }

      if (windowPrices.length < 100) continue;

      const { slope, intercept, r2 } = calculateLinearRegression(windowPrices);

      // Quality filter
      if (r2 < params.minR2) continue;
      if (Math.abs(slope) < params.minSlope) continue;

      const residuals = windowPrices.map((y, x) => y - (intercept + slope * x));
      const sigma = Math.sqrt(residuals.reduce((sum, r) => sum + r * r, 0) / (residuals.length - 1));

      const price = parseFloat(String(currentPrice.adj_close || currentPrice.close));
      const midLine = intercept + slope * (windowPrices.length - 1);
      const sigmaDistance = sigma > 0 ? (price - midLine) / sigma : 0;

      // Check entry signal
      let signal: "LONG" | "SHORT" | null = null;

      if (slope > 0 && sigmaDistance < -params.entryThresholdSigma) {
        signal = "LONG";
      } else if (slope < 0 && sigmaDistance > params.entryThresholdSigma) {
        signal = "SHORT";
      }

      if (signal) {
        // Conviction score: higher R², more extreme sigma = higher conviction
        const convictionScore = r2 * Math.abs(sigmaDistance) * (fund.bm || 0.5);

        candidates.push({
          ticker,
          signal,
          sigmaDistance,
          r2,
          slope,
          price,
          convictionScore,
        });
      }
    }

    // Sort by conviction and take top candidates up to capacity
    candidates.sort((a, b) => b.convictionScore - a.convictionScore);
    const slotsAvailable = params.maxPositions - openPositions.size;

    for (let i = 0; i < Math.min(candidates.length, slotsAvailable); i++) {
      const c = candidates[i];
      openPositions.set(c.ticker, {
        ticker: c.ticker,
        entryDate: currentDate,
        entryPrice: c.price,
        entryIdx: dateIdx,
        signal: c.signal,
        sigmaAtEntry: c.sigmaDistance,
        r2: c.r2,
        slope: c.slope,
      });
    }
  }

  return { trades: allTrades, maxDrawdown, circuitBreakerTriggered };
}

async function analyzeTickerChannel(
  ticker: string,
  prices: PriceRow[],
  fundamentals: Fundamentals,
  params: StrategyParams
): Promise<{
  r2: number;
  slope: number;
  currentSigma: number;
  hasSignal: boolean;
  signalType: "LONG" | "SHORT" | "NONE";
  fundamentals: { ep: number | null; bm: number | null; mom6m: number | null };
} | null> {
  if (prices.length < 100) return null;

  const closes = prices
    .slice(-params.windowSize)
    .map((p: PriceRow) => parseFloat(String(p.adj_close || p.close)))
    .filter((c: number) => !isNaN(c) && c > 0);

  if (closes.length < 100) return null;

  const { slope, intercept, r2 } = calculateLinearRegression(closes);

  const residuals = closes.map((y: number, x: number) => y - (intercept + slope * x));
  const sigma =
    residuals.length > 1
      ? Math.sqrt(residuals.reduce((sum: number, r: number) => sum + r * r, 0) / (residuals.length - 1))
      : 0;

  const currentPrice = closes[closes.length - 1];
  const currentMidLine = intercept + slope * (closes.length - 1);
  const currentSigmaDistance = sigma > 0 ? (currentPrice - currentMidLine) / sigma : 0;

  const mom6m = prices.length > 126
    ? (closes[closes.length - 1] / closes[Math.max(0, closes.length - 126)] - 1)
    : null;

  const fundOut = {
    ep: fundamentals.ep,
    bm: fundamentals.bm,
    mom6m,
  };

  // Check for signal with strict filters
  let hasSignal = false;
  let signalType: "LONG" | "SHORT" | "NONE" = "NONE";

  const passR2 = r2 >= params.minR2;
  const passSlope = Math.abs(slope) >= params.minSlope;
  const passBM = fundamentals.bm === null || fundamentals.bm >= params.minBM;
  const passEP = fundamentals.ep === null || fundamentals.ep >= params.minEP;

  if (passR2 && passSlope && passBM && passEP) {
    if (slope > 0 && currentSigmaDistance < -params.entryThresholdSigma) {
      hasSignal = true;
      signalType = "LONG";
    } else if (slope < 0 && currentSigmaDistance > params.entryThresholdSigma) {
      hasSignal = true;
      signalType = "SHORT";
    }
  }

  return {
    r2,
    slope,
    currentSigma: currentSigmaDistance,
    hasSignal,
    signalType,
    fundamentals: fundOut,
  };
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    const params: StrategyParams = {
      entryThresholdSigma: parseFloat(searchParams.get("entrySigma") || String(DEFAULT_PARAMS.entryThresholdSigma)),
      stopSigma: parseFloat(searchParams.get("stopSigma") || String(DEFAULT_PARAMS.stopSigma)),
      maxHoldingDays: parseInt(searchParams.get("maxDays") || String(DEFAULT_PARAMS.maxHoldingDays)),
      minR2: parseFloat(searchParams.get("minR2") || String(DEFAULT_PARAMS.minR2)),
      minSlope: parseFloat(searchParams.get("minSlope") || String(DEFAULT_PARAMS.minSlope)),
      minBM: parseFloat(searchParams.get("minBM") || String(DEFAULT_PARAMS.minBM)),
      minEP: parseFloat(searchParams.get("minEP") || String(DEFAULT_PARAMS.minEP)),
      windowSize: parseInt(searchParams.get("window") || String(DEFAULT_PARAMS.windowSize)),
      maxPositions: parseInt(searchParams.get("maxPos") || String(DEFAULT_PARAMS.maxPositions)),
      maxDrawdownPct: parseFloat(searchParams.get("maxDD") || String(DEFAULT_PARAMS.maxDrawdownPct)),
    };

    // Fetch all price data in ONE query (5 years for proper backtest)
    const priceResult = await pool.query(`
      SELECT ticker, date::text, close, adj_close
      FROM prices_daily
      WHERE date > '2020-01-01'
        AND ticker IN (
          SELECT ticker FROM prices_daily
          WHERE date > CURRENT_DATE - INTERVAL '30 days'
          GROUP BY ticker HAVING COUNT(*) > 15
        )
      ORDER BY ticker, date ASC
    `);

    // Group by ticker
    const tickerPrices = new Map<string, PriceRow[]>();
    for (const row of priceResult.rows) {
      if (!tickerPrices.has(row.ticker)) {
        tickerPrices.set(row.ticker, []);
      }
      tickerPrices.get(row.ticker)!.push({
        date: row.date,
        close: row.close,
        adj_close: row.adj_close,
      });
    }

    // Fetch all fundamentals in ONE query
    const fundResult = await pool.query(`
      SELECT DISTINCT ON (ticker) ticker, ep, bm
      FROM factor_fundamentals
      ORDER BY ticker, date DESC
    `);

    const tickerFundamentals = new Map<string, Fundamentals>();
    for (const row of fundResult.rows) {
      tickerFundamentals.set(row.ticker, {
        ep: row.ep ? parseFloat(row.ep) : null,
        bm: row.bm ? parseFloat(row.bm) : null,
      });
    }

    // Run portfolio-aware backtest
    const { trades: allTrades, maxDrawdown, circuitBreakerTriggered } = runPortfolioBacktest(
      tickerPrices,
      tickerFundamentals,
      params
    );

    // Current signals
    const currentSignals: Array<{
      ticker: string;
      signal: "LONG" | "SHORT";
      sigmaDistance: number;
      r2: number;
      slope: number;
      ep: number | null;
      bm: number | null;
      mom6m: number | null;
    }> = [];

    const tickerStats: Array<{
      ticker: string;
      r2: number;
    }> = [];

    for (const [ticker, prices] of tickerPrices) {
      if (prices.length < params.windowSize + 50) continue;
      const fund = tickerFundamentals.get(ticker) || { ep: null, bm: null };

      try {
        const analysis = await analyzeTickerChannel(ticker, prices, fund, params);
        if (analysis) {
          tickerStats.push({ ticker, r2: analysis.r2 });

          if (analysis.hasSignal) {
            currentSignals.push({
              ticker,
              signal: analysis.signalType as "LONG" | "SHORT",
              sigmaDistance: analysis.currentSigma,
              r2: analysis.r2,
              slope: analysis.slope,
              ep: analysis.fundamentals.ep,
              bm: analysis.fundamentals.bm,
              mom6m: analysis.fundamentals.mom6m,
            });
          }
        }
      } catch {
        // Skip
      }
    }

    // Sort trades by date
    allTrades.sort((a, b) => a.exitDate.localeCompare(b.exitDate));

    // Calculate summary stats
    const wins = allTrades.filter((t) => t.returnPct > 0);
    const losses = allTrades.filter((t) => t.returnPct <= 0);
    const compoundedEquity = allTrades.reduce((eq, t) => eq * (1 + t.returnPct / params.maxPositions), 1.0);
    const totalReturn = compoundedEquity - 1;
    const avgReturn = allTrades.length > 0 ? allTrades.reduce((sum, t) => sum + t.returnPct, 0) / allTrades.length : 0;
    const winRate = allTrades.length > 0 ? wins.length / allTrades.length : 0;

    // Sharpe
    const returns = allTrades.map((t) => t.returnPct / params.maxPositions);
    const meanReturn = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
    const stdReturn = returns.length > 1
      ? Math.sqrt(returns.reduce((sum, r) => sum + Math.pow(r - meanReturn, 2), 0) / (returns.length - 1))
      : 0;
    const tradesPerYear = allTrades.length > 0 ? (allTrades.length / 3) : 0;
    const sharpeRatio = stdReturn > 0 ? (meanReturn * Math.sqrt(tradesPerYear)) / stdReturn : 0;

    // Profit factor
    const grossProfit = wins.reduce((sum, t) => sum + t.returnPct, 0);
    const grossLoss = Math.abs(losses.reduce((sum, t) => sum + t.returnPct, 0));
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 99 : 0;

    // Worst single trade loss (more realistic risk metric)
    const worstTradeLoss = allTrades.length > 0
      ? Math.min(...allTrades.map(t => t.returnPct))
      : 0;

    // Exit breakdown
    const exitBreakdown = {
      target: allTrades.filter((t) => t.exitReason === "TARGET").length,
      time: allTrades.filter((t) => t.exitReason === "TIME").length,
      stop: allTrades.filter((t) => t.exitReason === "STOP").length,
    };
    const totalExits = exitBreakdown.target + exitBreakdown.time + exitBreakdown.stop;
    const exitPcts = {
      target: totalExits > 0 ? Math.round((exitBreakdown.target / totalExits) * 100) : 0,
      time: totalExits > 0 ? Math.round((exitBreakdown.time / totalExits) * 100) : 0,
      stop: totalExits > 0 ? Math.round((exitBreakdown.stop / totalExits) * 100) : 0,
    };

    const avgHoldingDays = allTrades.length > 0
      ? allTrades.reduce((sum, t) => sum + t.holdingDays, 0) / allTrades.length
      : 0;

    currentSignals.sort((a, b) => Math.abs(b.sigmaDistance) - Math.abs(a.sigmaDistance));

    const avgR2 = tickerStats.length > 0
      ? tickerStats.reduce((sum, t) => sum + t.r2, 0) / tickerStats.length
      : 0;

    return NextResponse.json({
      success: true,
      params,
      summary: {
        totalTrades: allTrades.length,
        winRate,
        avgReturn,
        totalReturn,
        maxDrawdown: -maxDrawdown,
        worstTradeLoss,  // Single trade worst loss (more realistic risk)
        sharpeRatio,
        profitFactor,
        avgHoldingDays,
        exitBreakdown: exitPcts,
        circuitBreakerTriggered,
      },
      currentSignals,
      recentTrades: allTrades, // Return all trades for accurate chart
      stats: {
        tickersAnalyzed: tickerStats.length,
        tickersWithSignals: currentSignals.length,
        avgR2,
      },
    });
  } catch (error: unknown) {
    console.error("STD Channel Strategy error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
