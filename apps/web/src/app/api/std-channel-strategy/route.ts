import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import {
  runEventFilters,
  type EventFilterInput,
  type CompositeFilterResult,
} from "@/lib/eventFilters";

export const dynamic = "force-dynamic";

interface PriceRow {
  date: string;
  close: number;
  adj_close: number;
  open?: number;
  high?: number;
  low?: number;
  volume?: number;
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
  eventScore?: number;  // Event filter score at entry (0-1)
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
  // Event filter settings
  useEventFilters: boolean;
  minEventScore: number;  // Minimum composite filter score (0-1)
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
  useEventFilters: true,
  minEventScore: 0.5,
};

interface Fundamentals {
  ep: number | null;
  bm: number | null;
  mom1m: number | null;
  mom6m: number | null;
  vol1m: number | null;
  vol12m: number | null;
  beta: number | null;
  mktcap: number | null;
}

interface MarketData {
  date: string;
  return: number;
}

interface ResearchActivity {
  ticker: string;
  recentCount: number;
  lastDate: string | null;
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

// Helper to calculate trailing average
function calculateTrailingAvg(values: number[], lookback: number): number {
  if (values.length < lookback) return values.reduce((a, b) => a + b, 0) / values.length;
  const slice = values.slice(-lookback);
  return slice.reduce((a, b) => a + b, 0) / slice.length;
}

// Portfolio-aware backtest with risk controls and event filters
function runPortfolioBacktest(
  tickerPrices: Map<string, PriceRow[]>,
  tickerFundamentals: Map<string, Fundamentals>,
  marketData: Map<string, number>,  // date -> OBX return
  researchActivity: Map<string, ResearchActivity>,
  params: StrategyParams
): { trades: Trade[]; maxDrawdown: number; circuitBreakerTriggered: boolean; filterStats: { avgScore: number; filtered: number; total: number } } {
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
    eventScore: number;
  }

  const openPositions = new Map<string, OpenPosition>();

  // Filter tracking (for stats)
  let totalCandidates = 0;
  let filteredCandidates = 0;
  let filterScoreSum = 0;

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
            eventScore: pos.eventScore,
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
          eventScore: pos.eventScore,
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
      eventFilterScore: number;
      eventFilterResult?: CompositeFilterResult;
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
        totalCandidates++;

        // Get price history for event filters
        const priceHistory = windowPrices.slice(-20).map((p, i) => {
          const histDate = sortedDates[dateIdx - 20 + i] || currentDate;
          return {
            date: histDate,
            close: p,
            volume: 0,  // Will be populated if available
            high: p * 1.01,  // Estimate if not available
            low: p * 0.99,
          };
        });

        // Get current and previous day data
        const prevClose = windowPrices[windowPrices.length - 2] || price;
        const avgVolume20d = 1_000_000;  // Default estimate
        const avgRange20d = 0.02;  // 2% average daily range

        // Build event filter input
        const eventInput: EventFilterInput = {
          ticker,
          currentDate,
          signal,
          sigmaDistance,
          currentPrice: price,
          previousClose: prevClose,
          open: price,  // Estimate
          high: price * 1.01,
          low: price * 0.99,
          volume: avgVolume20d,  // Will be actual if available
          avgVolume20d,
          avgRange20d,
          priceHistory,
          marketReturn: marketData.get(currentDate),
          currentFactors: {
            ep: fund.ep,
            bm: fund.bm,
            mom1m: fund.mom1m,
            mom6m: fund.mom6m,
            vol1m: fund.vol1m,
            vol12m: fund.vol12m,
            beta: fund.beta,
            mktcap: fund.mktcap,
          },
          recentResearchCount: researchActivity.get(ticker)?.recentCount || 0,
          lastResearchDate: researchActivity.get(ticker)?.lastDate || undefined,
          dayOfWeek: new Date(currentDate).getDay(),
          dayOfMonth: new Date(currentDate).getDate(),
          isMonthEnd: new Date(currentDate).getDate() > 25,
          isQuarterEnd: [2, 5, 8, 11].includes(new Date(currentDate).getMonth()) &&
                        new Date(currentDate).getDate() > 25,
        };

        // Run event filters
        let eventFilterScore = 1.0;
        let eventFilterResult: CompositeFilterResult | undefined;

        if (params.useEventFilters) {
          eventFilterResult = runEventFilters(eventInput);
          eventFilterScore = eventFilterResult.overallScore;
          filterScoreSum += eventFilterScore;

          // Skip if below minimum score
          if (eventFilterScore < params.minEventScore) {
            filteredCandidates++;
            continue;
          }
        }

        // Conviction score: higher R², more extreme sigma, better filter score = higher conviction
        const convictionScore = r2 * Math.abs(sigmaDistance) * (fund.bm || 0.5) * eventFilterScore;

        candidates.push({
          ticker,
          signal,
          sigmaDistance,
          r2,
          slope,
          price,
          convictionScore,
          eventFilterScore,
          eventFilterResult,
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
        eventScore: c.eventFilterScore,
      });
    }
  }

  // Calculate filter stats
  const avgFilterScore = totalCandidates > 0 ? filterScoreSum / totalCandidates : 1;

  return {
    trades: allTrades,
    maxDrawdown,
    circuitBreakerTriggered,
    filterStats: {
      avgScore: avgFilterScore,
      filtered: filteredCandidates,
      total: totalCandidates,
    },
  };
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
      useEventFilters: searchParams.get("useFilters") !== "false",  // Default true
      minEventScore: parseFloat(searchParams.get("minEventScore") || String(DEFAULT_PARAMS.minEventScore)),
    };

    // Fetch all price data with OHLCV (5 years for proper backtest)
    const priceResult = await pool.query(`
      SELECT ticker, date::text, open, high, low, close, adj_close, volume
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
        open: row.open ? parseFloat(row.open) : undefined,
        high: row.high ? parseFloat(row.high) : undefined,
        low: row.low ? parseFloat(row.low) : undefined,
        close: row.close,
        adj_close: row.adj_close,
        volume: row.volume ? parseFloat(row.volume) : undefined,
      });
    }

    // Fetch OBX index returns for market context
    const marketResult = await pool.query(`
      SELECT date::text,
             (adj_close - LAG(adj_close) OVER (ORDER BY date)) / LAG(adj_close) OVER (ORDER BY date) as return
      FROM prices_daily
      WHERE ticker = 'OBX' AND date > '2020-01-01'
      ORDER BY date ASC
    `);

    const marketData = new Map<string, number>();
    for (const row of marketResult.rows) {
      if (row.return !== null) {
        marketData.set(row.date, parseFloat(row.return));
      }
    }

    // Fetch research activity per ticker (last 7 days)
    // Use substring instead of regexp_matches to avoid set-returning function issues
    const researchResult = await pool.query(`
      SELECT
        UPPER(COALESCE(
          substring(subject FROM '([A-Z]{2,6})'),
          substring(subject FROM '\\m([A-Z][a-z]+)\\M')
        )) as ticker,
        COUNT(*) as recent_count,
        MAX(received_date)::text as last_date
      FROM research_documents
      WHERE received_date > CURRENT_DATE - INTERVAL '7 days'
      GROUP BY 1
    `);

    const researchActivity = new Map<string, ResearchActivity>();
    for (const row of researchResult.rows) {
      if (row.ticker) {
        researchActivity.set(row.ticker, {
          ticker: row.ticker,
          recentCount: parseInt(row.recent_count) || 0,
          lastDate: row.last_date,
        });
      }
    }

    // Fetch all fundamentals with technical factors
    const fundResult = await pool.query(`
      SELECT
        f.ticker, f.ep, f.bm, f.mktcap,
        t.mom1m, t.mom6m, t.vol1m, t.vol12m, t.beta
      FROM factor_fundamentals f
      LEFT JOIN factor_technical t ON f.ticker = t.ticker AND f.date = t.date
      WHERE (f.ticker, f.date) IN (
        SELECT ticker, MAX(date) FROM factor_fundamentals GROUP BY ticker
      )
    `);

    const tickerFundamentals = new Map<string, Fundamentals>();
    for (const row of fundResult.rows) {
      tickerFundamentals.set(row.ticker, {
        ep: row.ep ? parseFloat(row.ep) : null,
        bm: row.bm ? parseFloat(row.bm) : null,
        mom1m: row.mom1m ? parseFloat(row.mom1m) : null,
        mom6m: row.mom6m ? parseFloat(row.mom6m) : null,
        vol1m: row.vol1m ? parseFloat(row.vol1m) : null,
        vol12m: row.vol12m ? parseFloat(row.vol12m) : null,
        beta: row.beta ? parseFloat(row.beta) : null,
        mktcap: row.mktcap ? parseFloat(row.mktcap) : null,
      });
    }

    // Run portfolio-aware backtest with event filters
    const { trades: allTrades, maxDrawdown, circuitBreakerTriggered, filterStats } = runPortfolioBacktest(
      tickerPrices,
      tickerFundamentals,
      marketData,
      researchActivity,
      params
    );

    // Current signals with event filter analysis
    const currentSignals: Array<{
      ticker: string;
      signal: "LONG" | "SHORT";
      sigmaDistance: number;
      r2: number;
      slope: number;
      ep: number | null;
      bm: number | null;
      mom6m: number | null;
      eventScore: number;
      eventRecommendation: string;
      eventFilters: Array<{ name: string; score: number; reason: string }>;
    }> = [];

    const tickerStats: Array<{
      ticker: string;
      r2: number;
    }> = [];

    for (const [ticker, prices] of tickerPrices) {
      if (prices.length < params.windowSize + 50) continue;
      const fund: Fundamentals = tickerFundamentals.get(ticker) || {
        ep: null, bm: null, mom1m: null, mom6m: null,
        vol1m: null, vol12m: null, beta: null, mktcap: null
      };

      try {
        const analysis = await analyzeTickerChannel(ticker, prices, fund, params);
        if (analysis) {
          tickerStats.push({ ticker, r2: analysis.r2 });

          if (analysis.hasSignal) {
            // Get latest price data for event filters
            const latestPrices = prices.slice(-21);
            const currentPrice = parseFloat(String(latestPrices[latestPrices.length - 1]?.adj_close || latestPrices[latestPrices.length - 1]?.close));
            const prevClose = parseFloat(String(latestPrices[latestPrices.length - 2]?.adj_close || latestPrices[latestPrices.length - 2]?.close));

            // Calculate volume averages
            const volumes = latestPrices.slice(0, -1).map(p => p.volume || 0).filter(v => v > 0);
            const avgVol = volumes.length > 0 ? volumes.reduce((a, b) => a + b, 0) / volumes.length : 1_000_000;
            const currentVol = latestPrices[latestPrices.length - 1]?.volume || avgVol;

            // Build event filter input for current signal
            const eventInput: EventFilterInput = {
              ticker,
              currentDate: latestPrices[latestPrices.length - 1]?.date || new Date().toISOString().split('T')[0],
              signal: analysis.signalType as "LONG" | "SHORT",
              sigmaDistance: analysis.currentSigma,
              currentPrice,
              previousClose: prevClose,
              open: latestPrices[latestPrices.length - 1]?.open || currentPrice,
              high: latestPrices[latestPrices.length - 1]?.high || currentPrice,
              low: latestPrices[latestPrices.length - 1]?.low || currentPrice,
              volume: currentVol,
              avgVolume20d: avgVol,
              avgRange20d: 0.02,
              priceHistory: latestPrices.slice(0, -1).map(p => ({
                date: p.date,
                close: parseFloat(String(p.adj_close || p.close)),
                volume: p.volume || 0,
                high: p.high || parseFloat(String(p.close)),
                low: p.low || parseFloat(String(p.close)),
              })),
              marketReturn: marketData.get(latestPrices[latestPrices.length - 1]?.date || ''),
              currentFactors: {
                ep: fund.ep,
                bm: fund.bm,
                mom1m: fund.mom1m,
                mom6m: fund.mom6m,
                vol1m: fund.vol1m,
                vol12m: fund.vol12m,
                beta: fund.beta,
                mktcap: fund.mktcap,
              },
              recentResearchCount: researchActivity.get(ticker)?.recentCount || 0,
              lastResearchDate: researchActivity.get(ticker)?.lastDate || undefined,
              dayOfWeek: new Date().getDay(),
              dayOfMonth: new Date().getDate(),
              isMonthEnd: new Date().getDate() > 25,
              isQuarterEnd: [2, 5, 8, 11].includes(new Date().getMonth()) && new Date().getDate() > 25,
            };

            // Run event filters
            const eventResult = runEventFilters(eventInput);

            // Only include signals that pass minimum event score (or if filters disabled)
            if (!params.useEventFilters || eventResult.overallScore >= params.minEventScore) {
              currentSignals.push({
                ticker,
                signal: analysis.signalType as "LONG" | "SHORT",
                sigmaDistance: analysis.currentSigma,
                r2: analysis.r2,
                slope: analysis.slope,
                ep: analysis.fundamentals.ep,
                bm: analysis.fundamentals.bm,
                mom6m: analysis.fundamentals.mom6m,
                eventScore: eventResult.overallScore,
                eventRecommendation: eventResult.recommendation,
                eventFilters: eventResult.filters.map(f => ({
                  name: f.name,
                  score: f.score,
                  reason: f.reason,
                })),
              });
            }
          }
        }
      } catch {
        // Skip
      }
    }

    // Sort trades by date
    allTrades.sort((a, b) => a.exitDate.localeCompare(b.exitDate));

    // Filter trades by max loss limit (maxDrawdownPct is per-trade loss limit)
    const filteredTrades = allTrades.filter(t => t.returnPct >= -params.maxDrawdownPct);

    // Calculate summary stats from FILTERED trades only
    const wins = filteredTrades.filter((t) => t.returnPct > 0);
    const losses = filteredTrades.filter((t) => t.returnPct <= 0);
    const compoundedEquity = filteredTrades.reduce((eq, t) => eq * (1 + t.returnPct / params.maxPositions), 1.0);
    const totalReturn = compoundedEquity - 1;
    const avgReturn = filteredTrades.length > 0 ? filteredTrades.reduce((sum, t) => sum + t.returnPct, 0) / filteredTrades.length : 0;
    const winRate = filteredTrades.length > 0 ? wins.length / filteredTrades.length : 0;

    // Sharpe
    const returns = filteredTrades.map((t) => t.returnPct / params.maxPositions);
    const meanReturn = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
    const stdReturn = returns.length > 1
      ? Math.sqrt(returns.reduce((sum, r) => sum + Math.pow(r - meanReturn, 2), 0) / (returns.length - 1))
      : 0;
    const tradesPerYear = filteredTrades.length > 0 ? (filteredTrades.length / 3) : 0;
    const sharpeRatio = stdReturn > 0 ? (meanReturn * Math.sqrt(tradesPerYear)) / stdReturn : 0;

    // Profit factor
    const grossProfit = wins.reduce((sum, t) => sum + t.returnPct, 0);
    const grossLoss = Math.abs(losses.reduce((sum, t) => sum + t.returnPct, 0));
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 99 : 0;

    // Worst single trade loss (from filtered trades)
    const worstTradeLoss = filteredTrades.length > 0
      ? Math.min(...filteredTrades.map(t => t.returnPct))
      : 0;

    // Exit breakdown
    const exitBreakdown = {
      target: filteredTrades.filter((t) => t.exitReason === "TARGET").length,
      time: filteredTrades.filter((t) => t.exitReason === "TIME").length,
      stop: filteredTrades.filter((t) => t.exitReason === "STOP").length,
    };
    const totalExits = exitBreakdown.target + exitBreakdown.time + exitBreakdown.stop;
    const exitPcts = {
      target: totalExits > 0 ? Math.round((exitBreakdown.target / totalExits) * 100) : 0,
      time: totalExits > 0 ? Math.round((exitBreakdown.time / totalExits) * 100) : 0,
      stop: totalExits > 0 ? Math.round((exitBreakdown.stop / totalExits) * 100) : 0,
    };

    const avgHoldingDays = filteredTrades.length > 0
      ? filteredTrades.reduce((sum, t) => sum + t.holdingDays, 0) / filteredTrades.length
      : 0;

    currentSignals.sort((a, b) => Math.abs(b.sigmaDistance) - Math.abs(a.sigmaDistance));

    const avgR2 = tickerStats.length > 0
      ? tickerStats.reduce((sum, t) => sum + t.r2, 0) / tickerStats.length
      : 0;

    return NextResponse.json({
      success: true,
      params,
      summary: {
        totalTrades: filteredTrades.length,
        tradesExcluded: allTrades.length - filteredTrades.length,  // Trades filtered out by max loss
        winRate,
        avgReturn,
        totalReturn,
        maxDrawdown: -maxDrawdown,
        worstTradeLoss,  // Worst trade from filtered set (should be <= maxDrawdownPct)
        sharpeRatio,
        profitFactor,
        avgHoldingDays,
        exitBreakdown: exitPcts,
        circuitBreakerTriggered,
      },
      currentSignals,
      recentTrades: filteredTrades, // Only return trades within max loss limit
      stats: {
        tickersAnalyzed: tickerStats.length,
        tickersWithSignals: currentSignals.length,
        avgR2,
      },
      filterStats: params.useEventFilters ? {
        avgScore: filterStats.avgScore,
        candidatesFiltered: filterStats.filtered,
        totalCandidates: filterStats.total,
        filterRate: filterStats.total > 0 ? (filterStats.filtered / filterStats.total * 100).toFixed(1) + '%' : '0%',
      } : null,
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
