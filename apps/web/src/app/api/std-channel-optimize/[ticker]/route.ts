import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface Trade {
  entryDate: string;
  exitDate: string;
  signal: "LONG" | "SHORT";
  returnPct: number;
  holdingDays: number;
  exitReason: "TARGET" | "TIME" | "STOP";
}

interface BacktestResult {
  params: {
    entrySigma: number;
    stopSigma: number;
    maxDays: number;
    minR2: number;
    windowSize: number;
  };
  totalTrades: number;
  winRate: number;
  totalReturn: number;
  sharpe: number;
  profitFactor: number;
  maxDrawdown: number;
  avgReturn: number;
  avgHoldingDays: number;
  exitBreakdown: { target: number; time: number; stop: number };
  trades: Trade[];
  score: number;
}

// Linear regression helper
function linearRegression(closes: number[]): { slope: number; intercept: number; r2: number } {
  const n = closes.length;
  if (n < 2) return { slope: 0, intercept: 0, r2: 0 };

  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += closes[i];
    sumXY += i * closes[i];
    sumX2 += i * i;
    sumY2 += closes[i] * closes[i];
  }

  const denom = n * sumX2 - sumX * sumX;
  if (Math.abs(denom) < 1e-10) return { slope: 0, intercept: sumY / n, r2: 0 };

  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;

  // R-squared
  const yMean = sumY / n;
  let ssTot = 0, ssRes = 0;
  for (let i = 0; i < n; i++) {
    const predicted = intercept + slope * i;
    ssTot += (closes[i] - yMean) ** 2;
    ssRes += (closes[i] - predicted) ** 2;
  }
  const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0;

  return { slope, intercept, r2 };
}

// Run backtest for a single ticker with specific parameters
function runBacktest(
  prices: Array<{ date: string; close: number }>,
  params: { entrySigma: number; stopSigma: number; maxDays: number; minR2: number; windowSize: number }
): BacktestResult | null {
  const { entrySigma, stopSigma, maxDays, minR2, windowSize } = params;
  const trades: Trade[] = [];

  if (prices.length < windowSize + maxDays) return null;

  for (let i = windowSize; i < prices.length - maxDays; i++) {
    const windowPrices = prices.slice(i - windowSize, i);
    const closes = windowPrices.map(p => p.close);
    const { slope, intercept, r2 } = linearRegression(closes);

    if (r2 < minR2) continue;

    // Calculate sigma (standard deviation of residuals)
    const residuals = closes.map((y, x) => y - (intercept + slope * x));
    const sigma = Math.sqrt(residuals.reduce((sum, r) => sum + r * r, 0) / (residuals.length - 1));
    if (sigma < 0.01) continue;

    const currentPrice = prices[i].close;
    const midLine = intercept + slope * windowSize;
    const sigmaDistance = (currentPrice - midLine) / sigma;

    // Signal generation: Slope-aligned mean reversion
    let signal: "LONG" | "SHORT" | null = null;
    if (slope > 0 && sigmaDistance < -entrySigma) {
      signal = "LONG"; // Uptrend, price below lower band
    } else if (slope < 0 && sigmaDistance > entrySigma) {
      signal = "SHORT"; // Downtrend, price above upper band
    }

    if (!signal) continue;

    // Check if we're already in a trade (skip overlapping)
    if (trades.length > 0) {
      const lastTrade = trades[trades.length - 1];
      const lastExitIdx = prices.findIndex(p => p.date === lastTrade.exitDate);
      if (lastExitIdx >= i) continue;
    }

    // Simulate trade
    const entryDate = prices[i].date;
    const entryPrice = currentPrice;
    let exitDate = "";
    let exitPrice = 0;
    let exitReason: "TARGET" | "TIME" | "STOP" = "TIME";

    for (let j = 1; j <= maxDays && i + j < prices.length; j++) {
      const futurePrice = prices[i + j].close;
      const futureMid = intercept + slope * (windowSize + j);
      const futureSigmaDist = (futurePrice - futureMid) / sigma;

      // Check exit conditions
      if (signal === "LONG") {
        if (futureSigmaDist >= 0) {
          exitReason = "TARGET";
          exitDate = prices[i + j].date;
          exitPrice = futurePrice;
          break;
        }
        if (futureSigmaDist < -stopSigma) {
          exitReason = "STOP";
          exitDate = prices[i + j].date;
          exitPrice = futurePrice;
          break;
        }
      } else {
        if (futureSigmaDist <= 0) {
          exitReason = "TARGET";
          exitDate = prices[i + j].date;
          exitPrice = futurePrice;
          break;
        }
        if (futureSigmaDist > stopSigma) {
          exitReason = "STOP";
          exitDate = prices[i + j].date;
          exitPrice = futurePrice;
          break;
        }
      }

      // Time stop
      if (j === maxDays) {
        exitDate = prices[i + j].date;
        exitPrice = futurePrice;
      }
    }

    if (!exitDate || exitPrice === 0) continue;

    const returnPct = signal === "LONG"
      ? (exitPrice - entryPrice) / entryPrice
      : (entryPrice - exitPrice) / entryPrice;

    const holdingDays = prices.findIndex(p => p.date === exitDate) - i;

    trades.push({
      entryDate,
      exitDate,
      signal,
      returnPct,
      holdingDays,
      exitReason,
    });
  }

  if (trades.length < 3) return null;

  // Calculate metrics
  const wins = trades.filter(t => t.returnPct > 0);
  const losses = trades.filter(t => t.returnPct <= 0);
  const winRate = wins.length / trades.length;

  const returns = trades.map(t => t.returnPct);
  const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
  const totalReturn = returns.reduce((cum, r) => cum * (1 + r), 1) - 1;

  // Sharpe (annualized, assuming ~20 trading days/month)
  const stdDev = Math.sqrt(returns.reduce((sum, r) => sum + (r - avgReturn) ** 2, 0) / returns.length);
  const avgHoldingDays = trades.reduce((sum, t) => sum + t.holdingDays, 0) / trades.length;
  const tradesPerYear = 252 / avgHoldingDays;
  const annualizedReturn = avgReturn * tradesPerYear;
  const annualizedStd = stdDev * Math.sqrt(tradesPerYear);
  const sharpe = annualizedStd > 0 ? annualizedReturn / annualizedStd : 0;

  // Profit factor
  const grossProfit = wins.reduce((sum, t) => sum + t.returnPct, 0);
  const grossLoss = Math.abs(losses.reduce((sum, t) => sum + t.returnPct, 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 99 : 0;

  // Max drawdown
  let peak = 1;
  let maxDD = 0;
  let equity = 1;
  for (const trade of trades) {
    equity *= (1 + trade.returnPct);
    if (equity > peak) peak = equity;
    const dd = (peak - equity) / peak;
    if (dd > maxDD) maxDD = dd;
  }

  // Exit breakdown
  const exitBreakdown = {
    target: trades.filter(t => t.exitReason === "TARGET").length,
    time: trades.filter(t => t.exitReason === "TIME").length,
    stop: trades.filter(t => t.exitReason === "STOP").length,
  };

  // Scoring: Prioritize low DD, high target exits, low stops, good Sharpe
  const ddPenalty = maxDD < 0.10 ? 4 : maxDD < 0.15 ? 2 : maxDD < 0.20 ? 1 : 0;
  const targetBonus = (exitBreakdown.target / trades.length) * 3;
  const stopPenalty = (exitBreakdown.stop / trades.length) * 2;
  const sharpeBonus = Math.min(sharpe, 3) * 2;
  const pfBonus = Math.min(profitFactor, 5) * 0.5;
  const score = ddPenalty + targetBonus - stopPenalty + sharpeBonus + pfBonus;

  return {
    params,
    totalTrades: trades.length,
    winRate,
    totalReturn,
    sharpe,
    profitFactor,
    maxDrawdown: maxDD,
    avgReturn,
    avgHoldingDays,
    exitBreakdown,
    trades,
    score,
  };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const { ticker } = await params;
  const { searchParams } = new URL(request.url);

  if (!ticker) {
    return NextResponse.json({ success: false, error: "Missing ticker" }, { status: 400 });
  }

  // Parse custom parameters from query string
  const customEntrySigmas = searchParams.get("entrySigmas");
  const customStopSigmas = searchParams.get("stopSigmas");
  const customMaxDays = searchParams.get("maxDays");
  const customMinR2s = searchParams.get("minR2s");
  const customWindows = searchParams.get("windows");
  const minTrades = parseInt(searchParams.get("minTrades") || "3");

  try {
    // Fetch 5+ years of price data for this ticker
    const priceResult = await pool.query(`
      SELECT date::text, adj_close as close
      FROM prices_daily
      WHERE ticker = $1
        AND date > '2020-01-01'
        AND adj_close IS NOT NULL
        AND adj_close > 0
      ORDER BY date ASC
    `, [ticker]);

    if (priceResult.rows.length < 300) {
      return NextResponse.json({
        success: false,
        error: `Insufficient price data for ${ticker}: ${priceResult.rows.length} rows (need 300+)`,
      }, { status: 400 });
    }

    const prices = priceResult.rows.map(r => ({
      date: r.date,
      close: parseFloat(r.close),
    }));

    // Parameter grid for optimization - use custom or defaults
    const entrySigmas = customEntrySigmas
      ? customEntrySigmas.split(",").map(Number).filter(n => !isNaN(n) && n > 0)
      : [1.5, 2.0, 2.5, 3.0, 3.5];
    const stopSigmas = customStopSigmas
      ? customStopSigmas.split(",").map(Number).filter(n => !isNaN(n) && n > 0)
      : [2.5, 3.0, 3.5, 4.0]; // Max 4σ - tighter risk control
    const maxDaysList = customMaxDays
      ? customMaxDays.split(",").map(Number).filter(n => !isNaN(n) && n > 0)
      : [5, 7, 10, 14, 21, 30];
    const minR2s = customMinR2s
      ? customMinR2s.split(",").map(Number).filter(n => !isNaN(n) && n >= 0 && n <= 1)
      : [0.3, 0.5, 0.7];
    const windowSizes = customWindows
      ? customWindows.split(",").map(Number).filter(n => !isNaN(n) && n > 50)
      : [126, 189, 252];

    const results: BacktestResult[] = [];
    let tested = 0;

    for (const entrySigma of entrySigmas) {
      for (const stopSigma of stopSigmas) {
        // Stop must be wider than entry
        if (stopSigma <= entrySigma) continue;

        for (const maxDays of maxDaysList) {
          for (const minR2 of minR2s) {
            for (const windowSize of windowSizes) {
              tested++;
              const result = runBacktest(prices, {
                entrySigma,
                stopSigma,
                maxDays,
                minR2,
                windowSize,
              });

              if (result && result.totalTrades >= minTrades) {
                results.push(result);
              }
            }
          }
        }
      }
    }

    // Sort by score (higher is better)
    results.sort((a, b) => b.score - a.score);

    // Return top 10 results (without trades to keep response small)
    const topResults = results.slice(0, 10).map(r => ({
      params: r.params,
      totalTrades: r.totalTrades,
      winRate: r.winRate,
      totalReturn: r.totalReturn,
      sharpe: r.sharpe,
      profitFactor: r.profitFactor,
      maxDrawdown: r.maxDrawdown,
      avgReturn: r.avgReturn,
      avgHoldingDays: r.avgHoldingDays,
      exitBreakdown: r.exitBreakdown,
      score: r.score,
    }));

    // Include trades for the best result
    const bestResult = results[0];
    const bestWithTrades = bestResult ? {
      ...topResults[0],
      trades: bestResult.trades.map(t => ({
        entryDate: t.entryDate,
        exitDate: t.exitDate,
        signal: t.signal,
        returnPct: t.returnPct,
        holdingDays: t.holdingDays,
        exitReason: t.exitReason,
      })),
    } : null;

    return NextResponse.json({
      success: true,
      ticker,
      tested,
      dataPoints: prices.length,
      dateRange: {
        start: prices[0].date,
        end: prices[prices.length - 1].date,
      },
      results: topResults,
      best: bestWithTrades,
      parametersUsed: {
        entrySigmas,
        stopSigmas,
        maxDaysList,
        minR2s,
        windowSizes,
        minTrades,
      },
    });
  } catch (error) {
    console.error(`STD Channel Optimize error for ${ticker}:`, error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    }, { status: 500 });
  }
}
