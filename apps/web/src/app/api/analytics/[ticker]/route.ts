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
};

async function fetchPrices(ticker: string, limit: number): Promise<PriceRow[]> {
  const tableName = await getPriceTable();
  
  const q = `
    SELECT date::date as date, close
    FROM public.${tableName}
    WHERE upper(ticker) = upper($1)
      AND close IS NOT NULL
      AND close > 0
    ORDER BY date DESC
    LIMIT $2
  `;
  
  const result = await pool.query(q, [ticker, limit]);
  // Map first, then reverse to get chronological order (oldest → newest)
  const mapped = result.rows.map(r => ({
    date: r.date instanceof Date ? r.date.toISOString().slice(0, 10) : String(r.date),
    close: Number(r.close),
  }));
  return mapped.reverse();
}

async function fetchMarketPrices(limit: number): Promise<PriceRow[]> {
  const tableName = await getPriceTable();
  
  const q = `
    SELECT date::date as date, close
    FROM public.${tableName}
    WHERE upper(ticker) = 'OBX'
      AND close IS NOT NULL
      AND close > 0
    ORDER BY date DESC
    LIMIT $1
  `;
  
  const result = await pool.query(q, [limit]);
  const mapped = result.rows.map(r => ({
    date: r.date instanceof Date ? r.date.toISOString().slice(0, 10) : String(r.date),
    close: Number(r.close),
  }));
  return mapped.reverse();
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ ticker: string }> }
) {
  try {
    const { ticker } = await ctx.params;
    const url = new URL(req.url);
    const limitRaw = url.searchParams.get("limit");
    const limit = Math.min(Math.max(Number(limitRaw || 1500), 20), 5000);

    // Fetch prices for the ticker
    const prices = await fetchPrices(ticker, limit);

    // Reduced minimum requirement from 252 to 20 days
    if (prices.length < 20) {
      return NextResponse.json(
        {
          ticker: ticker.toUpperCase(),
          error: `Insufficient data: only ${prices.length} days available (minimum 20 required)`,
        },
        { status: 400 }
      );
    }

    // Compute returns
    const closes = prices.map(p => p.close);
    const dates = prices.map(p => p.date);
    const logReturns = computeReturns(closes);

    if (logReturns.length === 0) {
      return NextResponse.json(
        {
          ticker: ticker.toUpperCase(),
          error: "Unable to compute returns",
        },
        { status: 400 }
      );
    }

    // Compute summary statistics
    const totalReturn = (closes[closes.length - 1] - closes[0]) / closes[0];
    
    // Calculate number of years for annualization
    const days = closes.length;
    const years = days / 252;
    const annualizedReturn = years > 0 ? Math.pow(1 + totalReturn, 1 / years) - 1 : 0;

    // Volatility (annualized)
    const mean = logReturns.reduce((a, b) => a + b, 0) / logReturns.length;
    const variance = logReturns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / (logReturns.length - 1);
    const volatility = Math.sqrt(variance * 252);

    // Max drawdown
    const drawdownSeries = computeDrawdownSeries(closes);
    const maxDrawdown = Math.min(...drawdownSeries.map(d => d.drawdown));

    // VaR and CVaR (95%)
    const sortedReturns = [...logReturns].sort((a, b) => a - b);
    const var95Index = Math.floor(logReturns.length * 0.05);
    const var95 = sortedReturns[var95Index] || 0;
    const cvar95 =
      sortedReturns.slice(0, var95Index + 1).reduce((a, b) => a + b, 0) / (var95Index + 1 || 1);

    // Compute beta vs OBX
    let beta = 0;
    try {
      const marketPrices = await fetchMarketPrices(limit);
      
      // Only compute beta if we have sufficient overlapping data
      if (marketPrices.length >= 20) {
        const marketCloses = marketPrices.map(p => p.close);
        const marketReturns = computeReturns(marketCloses);
        beta = computeBeta(logReturns, marketReturns);
      }
    } catch (e) {
      console.warn("Failed to compute beta:", e);
      // Beta remains 0 if computation fails
    }

    // Sharpe ratio (assuming risk-free rate = 0)
    const sharpeRatio = computeSharpeRatio(logReturns, 0);

    // Build return series
    const returnSeries = logReturns.map((r, i) => ({
      date: dates[i + 1],
      return: r,
    }));

    return NextResponse.json({
      ticker: ticker.toUpperCase(),
      count: prices.length,
      summary: {
        totalReturn,
        annualizedReturn,
        volatility,
        maxDrawdown,
        var95,
        cvar95,
        beta,
        sharpeRatio,
      },
      prices: prices.map(p => ({ date: p.date, close: p.close })),
      returns: returnSeries,
      drawdown: drawdownSeries,
      dateRange: {
        start: dates[0],
        end: dates[dates.length - 1],
      },
    });
  } catch (e: any) {
    console.error("[Analytics API] Error:", e);
    return NextResponse.json(
      {
        error: "Analytics computation failed",
        message: e?.message ?? String(e),
      },
      { status: 500 }
    );
  }
}