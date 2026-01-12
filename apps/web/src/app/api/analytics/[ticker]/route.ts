// apps/web/src/app/api/analytics/[ticker]/route.ts
import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { annualizedVolatility, maxDrawdown, var95, cvar95 } from "@/lib/metrics";

export const dynamic = "force-dynamic";

type PriceRow = {
  date: string;
  close: number;
};

async function fetchPrices(ticker: string, limit: number): Promise<PriceRow[]> {
  const q = `
    SELECT date::date as date, close
    FROM public.obx_equities
    WHERE upper(ticker) = upper($1)
      AND close IS NOT NULL
      AND close > 0
    ORDER BY date ASC
    LIMIT $2
  `;
  
  const result = await pool.query(q, [ticker, limit]);
  return result.rows.map(r => ({
    date: r.date instanceof Date ? r.date.toISOString().slice(0, 10) : String(r.date),
    close: Number(r.close)
  }));
}

async function fetchMarketPrices(limit: number): Promise<PriceRow[]> {
  // OBX as market proxy
  const q = `
    SELECT date::date as date, close
    FROM public.obx_equities
    WHERE upper(ticker) = 'OBX'
      AND close IS NOT NULL
      AND close > 0
    ORDER BY date ASC
    LIMIT $1
  `;
  
  const result = await pool.query(q, [limit]);
  return result.rows.map(r => ({
    date: r.date instanceof Date ? r.date.toISOString().slice(0, 10) : String(r.date),
    close: Number(r.close)
  }));
}

function computeReturns(prices: number[]): number[] {
  const returns: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    const ret = (prices[i] - prices[i - 1]) / prices[i - 1];
    returns.push(ret);
  }
  return returns;
}

function computeDrawdownSeries(prices: number[]): Array<{ date: string; drawdown: number }> {
  const result: Array<{ date: string; drawdown: number }> = [];
  let peak = prices[0] ?? 0;
  
  return prices.map((p, i) => {
    peak = Math.max(peak, p);
    const dd = peak > 0 ? (p - peak) / peak : 0;
    return { date: "", drawdown: dd }; // date will be filled by caller
  });
}

function computeBeta(assetReturns: number[], marketReturns: number[]): number {
  const n = Math.min(assetReturns.length, marketReturns.length);
  if (n < 20) return 0;
  
  const assetMean = assetReturns.slice(0, n).reduce((a, b) => a + b, 0) / n;
  const marketMean = marketReturns.slice(0, n).reduce((a, b) => a + b, 0) / n;
  
  let covariance = 0;
  let marketVariance = 0;
  
  for (let i = 0; i < n; i++) {
    const assetDev = assetReturns[i] - assetMean;
    const marketDev = marketReturns[i] - marketMean;
    covariance += assetDev * marketDev;
    marketVariance += marketDev * marketDev;
  }
  
  if (marketVariance === 0) return 0;
  return covariance / marketVariance;
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
    
    // Fetch price data
    const prices = await fetchPrices(ticker, limit);
    
    if (prices.length === 0) {
      return NextResponse.json({
        ticker: ticker.toUpperCase(),
        error: "No price data found",
      }, { status: 404 });
    }
    
    // Extract arrays
    const dates = prices.map(p => p.date);
    const closes = prices.map(p => p.close);
    
    // Compute returns
    const returns = computeReturns(closes);
    
    // Compute metrics
    const vol = annualizedVolatility(returns);
    const maxDd = maxDrawdown(closes);
    const valueAtRisk = var95(returns);
    const cValueAtRisk = cvar95(returns);
    
    // Compute drawdown series
    const drawdownBase = computeDrawdownSeries(closes);
    const drawdownSeries = drawdownBase.map((dd, i) => ({
      date: dates[i],
      drawdown: dd.drawdown
    }));
    
    // Compute beta vs OBX
    let beta = 0;
    try {
      const marketPrices = await fetchMarketPrices(limit);
      const marketCloses = marketPrices.map(p => p.close);
      const marketReturns = computeReturns(marketCloses);
      beta = computeBeta(returns, marketReturns);
    } catch (e) {
      console.warn("Failed to compute beta:", e);
    }
    
    // Cumulative return
    const totalReturn = closes.length > 1 
      ? (closes[closes.length - 1] - closes[0]) / closes[0]
      : 0;
    
    // Annualized return (simple approximation)
    const days = closes.length;
    const years = days / 252;
    const annualizedReturn = years > 0 
      ? Math.pow(1 + totalReturn, 1 / years) - 1
      : 0;
    
    // Return series with returns
    const returnSeries = returns.map((ret, i) => ({
      date: dates[i + 1], // returns start at index 1
      return: ret
    }));
    
    return NextResponse.json({
      ticker: ticker.toUpperCase(),
      count: prices.length,
      
      // Summary metrics
      summary: {
        totalReturn,
        annualizedReturn,
        volatility: vol,
        maxDrawdown: maxDd,
        var95: valueAtRisk,
        cvar95: cValueAtRisk,
        beta,
        sharpeRatio: vol > 0 ? annualizedReturn / vol : 0,
      },
      
      // Time series
      prices: prices.map(p => ({ date: p.date, close: p.close })),
      returns: returnSeries,
      drawdown: drawdownSeries,
      
      // Metadata
      dateRange: {
        start: dates[0],
        end: dates[dates.length - 1],
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      {
        error: "Analytics computation failed",
        message: e?.message ?? String(e),
        code: e?.code,
      },
      { status: 500 }
    );
  }
}