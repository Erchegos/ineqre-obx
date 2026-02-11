import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const dynamic = "force-dynamic";

interface PriceRow {
  date: string;
  close: number;
  adj_close: number;
}

interface Fundamentals {
  ep: number | null;
  bm: number | null;
}

interface Trade {
  returnPct: number;
  exitReason: string;
}

interface StrategyParams {
  entryThresholdSigma: number;
  stopSigma: number;
  maxHoldingDays: number;
  minR2: number;
  windowSize: number;
  minBM: number;
  minEP: number;
  minSlope: number;
  maxPositions: number;
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

// Fast backtest for optimization - returns key metrics
function runFastBacktest(
  tickerPrices: Map<string, PriceRow[]>,
  tickerFundamentals: Map<string, Fundamentals>,
  tickerPriceByDate: Map<string, Map<string, PriceRow>>,
  sortedDates: string[],
  params: StrategyParams
): { trades: Trade[]; worstTrade: number } {
  const trades: Trade[] = [];

  interface OpenPosition {
    ticker: string;
    entryPrice: number;
    entryIdx: number;
    signal: "LONG" | "SHORT";
  }

  const openPositions = new Map<string, OpenPosition>();

  for (let dateIdx = params.windowSize; dateIdx < sortedDates.length; dateIdx++) {
    const currentDate = sortedDates[dateIdx];

    // Check exits for open positions
    for (const [ticker, pos] of Array.from(openPositions.entries())) {
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

        trades.push({ returnPct, exitReason });
        openPositions.delete(ticker);
      }
    }

    // Check for new entries (only if we have capacity)
    if (openPositions.size >= params.maxPositions) continue;

    interface EntryCandidate {
      ticker: string;
      signal: "LONG" | "SHORT";
      price: number;
      convictionScore: number;
    }

    const candidates: EntryCandidate[] = [];

    for (const [ticker] of tickerPrices) {
      if (openPositions.has(ticker)) continue;

      const priceMap = tickerPriceByDate.get(ticker);
      const currentPrice = priceMap?.get(currentDate);
      if (!currentPrice) continue;

      const fund = tickerFundamentals.get(ticker);
      if (!fund) continue;

      if (fund.ep !== null && fund.ep < params.minEP) continue;
      if (fund.bm !== null && fund.bm < params.minBM) continue;

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

      if (r2 < params.minR2) continue;
      if (Math.abs(slope) < params.minSlope) continue;

      const residuals = windowPrices.map((y, x) => y - (intercept + slope * x));
      const sigma = Math.sqrt(residuals.reduce((sum, r) => sum + r * r, 0) / (residuals.length - 1));

      const price = parseFloat(String(currentPrice.adj_close || currentPrice.close));
      const midLine = intercept + slope * (windowPrices.length - 1);
      const sigmaDistance = sigma > 0 ? (price - midLine) / sigma : 0;

      let signal: "LONG" | "SHORT" | null = null;

      if (slope > 0 && sigmaDistance < -params.entryThresholdSigma) {
        signal = "LONG";
      } else if (slope < 0 && sigmaDistance > params.entryThresholdSigma) {
        signal = "SHORT";
      }

      if (signal) {
        const convictionScore = r2 * Math.abs(sigmaDistance) * (fund.bm || 0.5);
        candidates.push({ ticker, signal, price, convictionScore });
      }
    }

    candidates.sort((a, b) => b.convictionScore - a.convictionScore);
    const slotsAvailable = params.maxPositions - openPositions.size;

    for (let i = 0; i < Math.min(candidates.length, slotsAvailable); i++) {
      const c = candidates[i];
      openPositions.set(c.ticker, {
        ticker: c.ticker,
        entryPrice: c.price,
        entryIdx: dateIdx,
        signal: c.signal,
      });
    }
  }

  const worstTrade = trades.length > 0 ? Math.min(...trades.map(t => t.returnPct)) : 0;

  return { trades, worstTrade };
}

export async function GET() {
  try {
    // Fetch all price data (5 years)
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

    // Fetch all fundamentals
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

    // Create shared date index
    const allDates = new Set<string>();
    for (const [, prices] of tickerPrices) {
      for (const p of prices) {
        allDates.add(p.date);
      }
    }
    const sortedDates = Array.from(allDates).sort();

    const tickerPriceByDate = new Map<string, Map<string, PriceRow>>();
    for (const [ticker, prices] of tickerPrices) {
      const priceMap = new Map<string, PriceRow>();
      for (const p of prices) {
        priceMap.set(p.date, p);
      }
      tickerPriceByDate.set(ticker, priceMap);
    }

    // Parameter combinations to test
    const paramSets = [
      { entrySigma: 3.5, stopSigma: 5, maxDays: 10, minR2: 0.7, windowSize: 189 },
      { entrySigma: 3.5, stopSigma: 5, maxDays: 7, minR2: 0.7, windowSize: 189 },
      { entrySigma: 3.5, stopSigma: 5, maxDays: 14, minR2: 0.7, windowSize: 189 },
      { entrySigma: 3.25, stopSigma: 5, maxDays: 14, minR2: 0.7, windowSize: 189 },
      { entrySigma: 3.25, stopSigma: 5, maxDays: 21, minR2: 0.7, windowSize: 189 },
      { entrySigma: 3.5, stopSigma: 5, maxDays: 5, minR2: 0.7, windowSize: 189 },
      { entrySigma: 3.25, stopSigma: 5, maxDays: 10, minR2: 0.7, windowSize: 189 },
      { entrySigma: 3.5, stopSigma: 4.5, maxDays: 14, minR2: 0.7, windowSize: 189 },
      { entrySigma: 3.5, stopSigma: 4.5, maxDays: 7, minR2: 0.7, windowSize: 189 },
      { entrySigma: 3.5, stopSigma: 4.5, maxDays: 10, minR2: 0.7, windowSize: 189 },
    ];

    const results = [];

    for (const ps of paramSets) {
      const params: StrategyParams = {
        entryThresholdSigma: ps.entrySigma,
        stopSigma: ps.stopSigma,
        maxHoldingDays: ps.maxDays,
        minR2: ps.minR2,
        windowSize: ps.windowSize,
        minBM: 0.3,
        minEP: 0,
        minSlope: 0.0001,
        maxPositions: 5,
      };

      const { trades, worstTrade } = runFastBacktest(
        tickerPrices,
        tickerFundamentals,
        tickerPriceByDate,
        sortedDates,
        params
      );

      const wins = trades.filter(t => t.returnPct > 0);
      const losses = trades.filter(t => t.returnPct <= 0);
      const winRate = trades.length > 0 ? wins.length / trades.length : 0;

      // Compounded return with position weighting
      const totalReturn = trades.reduce((eq, t) => eq * (1 + t.returnPct / params.maxPositions), 1.0) - 1;

      // Sharpe
      const returns = trades.map(t => t.returnPct / params.maxPositions);
      const meanReturn = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
      const stdReturn = returns.length > 1
        ? Math.sqrt(returns.reduce((sum, r) => sum + Math.pow(r - meanReturn, 2), 0) / (returns.length - 1))
        : 0;
      const tradesPerYear = trades.length > 0 ? trades.length / 5 : 0;
      const sharpe = stdReturn > 0 ? (meanReturn * Math.sqrt(tradesPerYear)) / stdReturn : 0;

      // Profit factor
      const grossProfit = wins.reduce((sum, t) => sum + t.returnPct, 0);
      const grossLoss = Math.abs(losses.reduce((sum, t) => sum + t.returnPct, 0));
      const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 99 : 0;

      // Score: Sharpe (2x), PF (2x), low worst trade (3x)
      const score = sharpe * 2 + Math.min(profitFactor, 10) * 0.2 - Math.abs(worstTrade) * 3;

      results.push({
        params: ps,
        totalTrades: trades.length,
        winRate,
        totalReturn,
        sharpe,
        profitFactor,
        maxDrawdown: worstTrade,  // This is the REAL worst single trade
        score,
      });
    }

    // Sort by score descending
    results.sort((a, b) => b.score - a.score);

    return NextResponse.json({
      success: true,
      tested: paramSets.length,
      tickersAnalyzed: tickerPrices.size,
      dataRange: "2020-2025",
      results,
      best: results[0],
      note: "Real backtested worst trade values",
    });

  } catch (error) {
    console.error("Optimizer error:", error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    }, { status: 500 });
  }
}
