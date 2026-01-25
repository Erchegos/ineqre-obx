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
      SELECT date::date as date, close, adj_close
      FROM public.${tableName}
      WHERE upper(ticker) = upper($1)
        AND close IS NOT NULL
        AND close > 0
        AND date >= $2::date
        AND date <= $3::date
      ORDER BY date ASC
    `;
    const result = await pool.query(q, [ticker, startDate, endDate]);
    return result.rows.map(r => ({
      date: r.date instanceof Date ? r.date.toISOString().slice(0, 10) : String(r.date),
      close: Number(r.close),
      adj_close: r.adj_close ? Number(r.adj_close) : Number(r.close),
    }));
  }

  // Otherwise use limit (fetching most recent N rows)
  const q = `
    SELECT date::date as date, close, adj_close
    FROM public.${tableName}
    WHERE upper(ticker) = upper($1)
      AND close IS NOT NULL
      AND close > 0
    ORDER BY date DESC
    LIMIT $2
  `;
  const result = await pool.query(q, [ticker, limit]);
  return result.rows.map(r => ({
    date: r.date instanceof Date ? r.date.toISOString().slice(0, 10) : String(r.date),
    close: Number(r.close),
    adj_close: r.adj_close ? Number(r.adj_close) : Number(r.close),
  })).reverse();
}

async function fetchMarketPrices(limit: number): Promise<number[]> {
  const tableName = await getPriceTable();
  const q = `
    SELECT close
    FROM public.${tableName}
    WHERE upper(ticker) = 'OBX' AND close IS NOT NULL
    ORDER BY date DESC LIMIT $1
  `;
  const result = await pool.query(q, [limit]);
  return result.rows.map(r => Number(r.close)).reverse();
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

    // Prepare data arrays
    const dates = prices.map(p => p.date);
    const closes = prices.map(p => p.close);

    // For adjusted prices, find the first valid adj_close (>0) and only use data from that point
    // This avoids the spike caused by mixing close (when adj_close=0) with real adj_close values
    const firstValidAdjIndex = prices.findIndex(p => p.adj_close > 0 && p.adj_close !== p.close);
    const hasValidAdjClose = firstValidAdjIndex >= 0;

    // If no valid adj_close data exists, use close for both series
    const adjCloses = hasValidAdjClose
      ? prices.slice(firstValidAdjIndex).map(p => p.adj_close)
      : closes;
    const adjDates = hasValidAdjClose
      ? dates.slice(firstValidAdjIndex)
      : dates;

    // Fetch Market Data for Beta (align length roughly)
    let marketReturns: number[] | null = null;
    let adjMarketReturns: number[] | null = null;
    try {
      const marketCloses = await fetchMarketPrices(limit);
      if (marketCloses.length >= closes.length) {
         // Trim to match exactly if needed, or just use simpler alignment
         const alignedMarket = marketCloses.slice(-closes.length);
         marketReturns = computeReturns(alignedMarket);

         // Also align market returns for adjusted series
         if (hasValidAdjClose && marketCloses.length >= adjCloses.length) {
           const adjAlignedMarket = marketCloses.slice(-adjCloses.length);
           adjMarketReturns = computeReturns(adjAlignedMarket);
         }
      }
    } catch (e) { console.warn("Beta calc failed", e); }

    // --- CALCULATE TWICE ---
    // 1. Adjusted (Total Return) - Uses only valid adj_close data
    const adjStats = calculateMetrics(
        adjCloses,
        adjMarketReturns || marketReturns,
        adjCloses[0],
        adjCloses[adjCloses.length - 1]
    );

    // 2. Raw (Price Return) - Uses all close data
    const rawStats = calculateMetrics(
        closes,
        marketReturns,
        closes[0],
        closes[closes.length - 1]
    );

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
      },
    });

  } catch (e: any) {
    console.error("[Analytics API] Error:", e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}