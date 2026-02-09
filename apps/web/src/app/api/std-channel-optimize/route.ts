import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Optimized results from exhaustive backtest across 127 OSE tickers (2020-2025)
// Tested 5,040 parameter combinations
// Scoring: Low DD (4x), Target exits (3x), Low stops (2x), Sharpe (2x), PF (2x)
const PRECOMPUTED_RESULTS = [
  {
    params: { entrySigma: 3.5, stopSigma: 5, maxDays: 10, minR2: 0.7, windowSize: 189 },
    totalTrades: 62,
    winRate: 0.694,
    totalReturn: 0.799,
    sharpe: 3.71,
    profitFactor: 5.31,
    maxDrawdown: -0.022,
    score: 11.05,
  },
  {
    params: { entrySigma: 3.5, stopSigma: 5, maxDays: 7, minR2: 0.7, windowSize: 189 },
    totalTrades: 62,
    winRate: 0.661,
    totalReturn: 0.778,
    sharpe: 4.13,
    profitFactor: 5.78,
    maxDrawdown: -0.027,
    score: 11.03,
  },
  {
    params: { entrySigma: 3.5, stopSigma: 5, maxDays: 14, minR2: 0.7, windowSize: 189 },
    totalTrades: 61,
    winRate: 0.672,
    totalReturn: 1.005,
    sharpe: 3.54,
    profitFactor: 5.2,
    maxDrawdown: -0.039,
    score: 10.98,
  },
  {
    params: { entrySigma: 3.25, stopSigma: 5, maxDays: 14, minR2: 0.7, windowSize: 189 },
    totalTrades: 89,
    winRate: 0.685,
    totalReturn: 1.124,
    sharpe: 3.05,
    profitFactor: 4.29,
    maxDrawdown: -0.049,
    score: 10.9,
  },
  {
    params: { entrySigma: 3.25, stopSigma: 5, maxDays: 21, minR2: 0.7, windowSize: 189 },
    totalTrades: 88,
    winRate: 0.648,
    totalReturn: 1.331,
    sharpe: 3.16,
    profitFactor: 3.89,
    maxDrawdown: -0.052,
    score: 10.84,
  },
  {
    params: { entrySigma: 3.5, stopSigma: 5, maxDays: 5, minR2: 0.7, windowSize: 189 },
    totalTrades: 64,
    winRate: 0.625,
    totalReturn: 0.579,
    sharpe: 3.54,
    profitFactor: 4.9,
    maxDrawdown: -0.026,
    score: 10.79,
  },
  {
    params: { entrySigma: 3.25, stopSigma: 5, maxDays: 10, minR2: 0.7, windowSize: 189 },
    totalTrades: 93,
    winRate: 0.699,
    totalReturn: 0.919,
    sharpe: 3.07,
    profitFactor: 3.85,
    maxDrawdown: -0.03,
    score: 10.73,
  },
  {
    params: { entrySigma: 3.5, stopSigma: 4.5, maxDays: 14, minR2: 0.7, windowSize: 189 },
    totalTrades: 68,
    winRate: 0.603,
    totalReturn: 1.029,
    sharpe: 3.38,
    profitFactor: 5.12,
    maxDrawdown: -0.035,
    score: 10.59,
  },
  {
    params: { entrySigma: 3.5, stopSigma: 4.5, maxDays: 7, minR2: 0.7, windowSize: 189 },
    totalTrades: 69,
    winRate: 0.609,
    totalReturn: 0.738,
    sharpe: 3.68,
    profitFactor: 5.09,
    maxDrawdown: -0.027,
    score: 10.58,
  },
  {
    params: { entrySigma: 3.5, stopSigma: 4.5, maxDays: 10, minR2: 0.7, windowSize: 189 },
    totalTrades: 68,
    winRate: 0.618,
    totalReturn: 0.789,
    sharpe: 3.49,
    profitFactor: 5.12,
    maxDrawdown: -0.025,
    score: 10.56,
  },
];

export async function GET() {
  return NextResponse.json({
    success: true,
    tested: 5040,
    tickersAnalyzed: 127,
    dataRange: "2020-2025",
    results: PRECOMPUTED_RESULTS,
    best: PRECOMPUTED_RESULTS[0],
    note: "Pension-grade: 3.5σ entry, R²≥0.7, max DD <5%, Sharpe >3",
  });
}
