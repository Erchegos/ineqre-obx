import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getPriceTable } from "@/lib/price-data-adapter";
import {
  computeReturns,
  computeBeta,
  computeDrawdownSeries,
  computeSharpeRatio,
} from "@/lib/metrics";

export const dynamic = "force-dynamic";

type PriceRow = {
  date: string;
  close: number;
  adj_close: number;
};

// Helper to calculate all metrics for a given series of prices
function calculateMetrics(
  prices: number[], 
  marketReturns: number[] | null,
  startPrice: number,
  endPrice: number
) {
  const logReturns = computeReturns(prices);
  
  // 1. Total Return & Annualized
  const totalReturn = (endPrice - startPrice) / startPrice;
  const days = prices.length;
  const years = days / 252;
  const annualizedReturn = years > 0 ? Math.pow(1 + totalReturn, 1 / years) - 1 : 0;

  // 2. Volatility
  const mean = logReturns.reduce((a, b) => a + b, 0) / (logReturns.length || 1);
  const variance = logReturns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / (logReturns.length - 1 || 1);
  const volatility = Math.sqrt(variance * 252);

  // 3. Drawdown
  const drawdownSeries = computeDrawdownSeries(prices);
  const maxDrawdown = Math.min(...drawdownSeries.map(d => d.drawdown));

  // 4. VaR / CVaR
  const sortedReturns = [...logReturns].sort((a, b) => a - b);
  const var95Index = Math.floor(logReturns.length * 0.05);
  const var95 = sortedReturns[var95Index] || 0;
  const cvar95 =
    sortedReturns.slice(0, var95Index + 1).reduce((a, b) => a + b, 0) / (var95Index + 1 || 1);

  // 5. Beta
  let beta = 0;
  if (marketReturns && marketReturns.length === logReturns.length) {
    beta = computeBeta(logReturns, marketReturns);
  }

  // 6. Sharpe
  const sharpeRatio = computeSharpeRatio(logReturns, 0);

  return {
    metrics: {
      totalReturn,
      annualizedReturn,
      volatility,
      maxDrawdown,
      var95,
      cvar95,
      beta,
      sharpeRatio,
    },
    returns: logReturns,
    drawdown: drawdownSeries,
  };
}

async function fetchPrices(
  ticker: string,
  limit: number,
  startDate?: string,
  endDate?: string
): Promise<PriceRow[]> {
  const tableName = await getPriceTable();

  // If date range is provided, use that instead of limit
  if (startDate && endDate) {
    const q = `
      SELECT TO_CHAR(date, 'YYYY-MM-DD') as date, close, adj_close
      FROM public.${tableName}
      WHERE upper(ticker) = upper($1)
        AND close IS NOT NULL
        AND close > 0
        AND date >= $2::date
        AND date <= $3::date
        AND EXTRACT(DOW FROM date) NOT IN (0, 6)
      ORDER BY date ASC
    `;
    const result = await pool.query(q, [ticker, startDate, endDate]);
    return result.rows.map(r => ({
      date: String(r.date), // Already formatted as YYYY-MM-DD by TO_CHAR
      close: Number(r.close),
      adj_close: r.adj_close ? Number(r.adj_close) : Number(r.close),
    }));
  }

  // Otherwise use limit (fetching most recent N rows)
  // Exclude weekends (0=Sunday, 6=Saturday)
  const q = `
    SELECT TO_CHAR(date, 'YYYY-MM-DD') as date, close, adj_close
    FROM public.${tableName}
    WHERE upper(ticker) = upper($1)
      AND close IS NOT NULL
      AND close > 0
      AND EXTRACT(DOW FROM date) NOT IN (0, 6)
    ORDER BY date DESC
    LIMIT $2
  `;
  const result = await pool.query(q, [ticker, limit]);
  return result.rows.map(r => ({
    date: String(r.date), // Already formatted as YYYY-MM-DD by TO_CHAR
    close: Number(r.close),
    adj_close: r.adj_close ? Number(r.adj_close) : Number(r.close),
  })).reverse();
}

// Fetch OBX prices aligned by date with the stock's dates
async function fetchMarketPricesAligned(
  stockDates: string[]
): Promise<Map<string, number>> {
  const tableName = await getPriceTable();
  const q = `
    SELECT TO_CHAR(date, 'YYYY-MM-DD') as date, close
    FROM public.${tableName}
    WHERE upper(ticker) = 'OBX'
      AND close IS NOT NULL
      AND date >= $1::date
      AND date <= $2::date
    ORDER BY date ASC
  `;
  const result = await pool.query(q, [stockDates[0], stockDates[stockDates.length - 1]]);
  const map = new Map<string, number>();
  for (const r of result.rows) {
    map.set(String(r.date), Number(r.close));
  }
  return map;
}

async function getFullDateRange(ticker: string): Promise<{ start: string; end: string } | null> {
  const tableName = await getPriceTable();
  const q = `
    SELECT
      TO_CHAR(MIN(date), 'YYYY-MM-DD') as start_date,
      TO_CHAR(MAX(date), 'YYYY-MM-DD') as end_date
    FROM public.${tableName}
    WHERE upper(ticker) = upper($1)
      AND close IS NOT NULL
      AND close > 0
  `;
  const result = await pool.query(q, [ticker]);
  if (result.rows.length === 0 || !result.rows[0].start_date) return null;

  return {
    start: String(result.rows[0].start_date), // Already formatted as YYYY-MM-DD by TO_CHAR
    end: String(result.rows[0].end_date) // Already formatted as YYYY-MM-DD by TO_CHAR
  };
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ ticker: string }> }
) {
  try {
    const { ticker } = await ctx.params;
    const url = new URL(req.url);

    // Support both limit-based and date-range-based queries
    const startDate = url.searchParams.get("startDate") || undefined;
    const endDate = url.searchParams.get("endDate") || undefined;

    // Increase max limit to 10000 to support data back to 1999 (~6500 trading days)
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 1500), 20), 10000);

    const prices = await fetchPrices(ticker, limit, startDate, endDate);

    if (prices.length < 20) {
      return NextResponse.json({ ticker, error: "Insufficient data" }, { status: 400 });
    }

    // Get the full date range available in database (not just fetched range)
    const fullDateRange = await getFullDateRange(ticker);

    // Prepare data arrays
    const dates = prices.map(p => p.date);
    const closes = prices.map(p => p.close);

    // For adjusted prices, find the first valid adj_close (>0) and only use data from that point
    // This avoids the spike caused by mixing close (when adj_close=0) with real adj_close values
    const firstValidAdjIndex = prices.findIndex(p => p.adj_close > 0 && p.adj_close !== p.close);

    // Check if we have enough valid adj_close data (at least 20 days)
    // This prevents using adjusted data when only 1-2 days differ (noise)
    const hasValidAdjClose = firstValidAdjIndex >= 0 &&
                             (prices.length - firstValidAdjIndex) >= 20;

    // If no valid adj_close data exists, use close for both series
    const adjCloses = hasValidAdjClose
      ? prices.slice(firstValidAdjIndex).map(p => p.adj_close)
      : closes;
    const adjDates = hasValidAdjClose
      ? dates.slice(firstValidAdjIndex)
      : dates;

    // Fetch Market Data for Beta — aligned by DATE (not position)
    let rawBeta = 0;
    let adjBeta = 0;
    try {
      const obxMap = await fetchMarketPricesAligned(dates);

      // Build date-aligned pairs for raw series: only dates where both stock AND OBX have data
      const rawPairs: { stockClose: number; obxClose: number }[] = [];
      for (let i = 0; i < dates.length; i++) {
        const obxClose = obxMap.get(dates[i]);
        if (obxClose !== undefined) {
          rawPairs.push({ stockClose: closes[i], obxClose });
        }
      }
      if (rawPairs.length >= 20) {
        rawBeta = computeBeta(
          computeReturns(rawPairs.map(p => p.stockClose)),
          computeReturns(rawPairs.map(p => p.obxClose))
        );
      }

      // Build date-aligned pairs for adjusted series
      if (hasValidAdjClose) {
        const adjPairs: { stockClose: number; obxClose: number }[] = [];
        const adjPrices = prices.slice(firstValidAdjIndex);
        for (const p of adjPrices) {
          const obxClose = obxMap.get(p.date);
          if (obxClose !== undefined) {
            adjPairs.push({ stockClose: p.adj_close, obxClose });
          }
        }
        if (adjPairs.length >= 20) {
          adjBeta = computeBeta(
            computeReturns(adjPairs.map(p => p.stockClose)),
            computeReturns(adjPairs.map(p => p.obxClose))
          );
        } else {
          adjBeta = rawBeta; // Fallback
        }
      } else {
        adjBeta = rawBeta;
      }
    } catch (e) { console.warn("Beta calc failed", e); }

    // --- CALCULATE TWICE ---
    // 1. Adjusted (Total Return) - Uses only valid adj_close data
    const adjStats = calculateMetrics(
        adjCloses,
        null, // Beta computed separately via date-aligned method
        adjCloses[0],
        adjCloses[adjCloses.length - 1]
    );
    adjStats.metrics.beta = adjBeta;

    // 2. Raw (Price Return) - Uses all close data
    const rawStats = calculateMetrics(
        closes,
        null, // Beta computed separately via date-aligned method
        closes[0],
        closes[closes.length - 1]
    );
    rawStats.metrics.beta = rawBeta;

    // Helper to format returns series with dates
    const formatReturns = (rets: number[], dateArr: string[]) => rets.map((r, i) => ({
      date: dateArr[i + 1],
      return: r
    }));

    return NextResponse.json({
      ticker: ticker.toUpperCase(),
      count: prices.length,
      // Return BOTH sets of summaries
      summary: {
        adjusted: adjStats.metrics,
        raw: rawStats.metrics
      },
      // Return BOTH sets of series (adjusted may have different date range)
      returns: {
        adjusted: formatReturns(adjStats.returns, adjDates),
        raw: formatReturns(rawStats.returns, dates)
      },
      drawdown: {
        adjusted: adjStats.drawdown,
        raw: rawStats.drawdown
      },
      prices: prices.map(p => ({
        date: p.date,
        close: p.close,
        adj_close: p.adj_close > 0 ? p.adj_close : p.close // Fallback for display
      })),
      dateRange: {
        start: dates[0],
        end: dates[dates.length - 1],
        adjustedStart: adjDates[0], // When valid adj_close data begins
        fullStart: fullDateRange?.start, // Earliest data in database
        fullEnd: fullDateRange?.end, // Latest data in database
      },
    });

  } catch (e: any) {
    console.error("[Analytics API] Error:", e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}