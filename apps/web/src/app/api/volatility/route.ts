// apps/web/src/app/api/volatility/[ticker]/route.ts
import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getPriceTable } from "@/lib/price-data-adapter";
import { computeVolatilityMeasures, compareVolatilityAroundEvent, currentVolatilityPercentile } from "@/lib/volatility";

export const dynamic = "force-dynamic";

type PriceBar = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
};

async function fetchBars(ticker: string, limit: number): Promise<PriceBar[]> {
  const tableName = await getPriceTable();
  
  const q = `
    SELECT 
      date::date as date, 
      open, 
      high, 
      low, 
      close
    FROM public.${tableName}
    WHERE upper(ticker) = upper($1)
      AND open IS NOT NULL
      AND high IS NOT NULL
      AND low IS NOT NULL
      AND close IS NOT NULL
      AND close > 0
    ORDER BY date ASC
    LIMIT $2
  `;
  
  const result = await pool.query(q, [ticker, limit]);
  return result.rows.map(r => ({
    date: r.date instanceof Date ? r.date.toISOString().slice(0, 10) : String(r.date),
    open: Number(r.open),
    high: Number(r.high),
    low: Number(r.low),
    close: Number(r.close),
  }));
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ ticker: string }> }
) {
  try {
    const { ticker } = await ctx.params;
    const url = new URL(req.url);
    const limitRaw = url.searchParams.get("limit");
    const limit = Math.min(Math.max(Number(limitRaw || 500), 100), 2000);
    
    // Optional: event dates for comparison
    const eventDatesParam = url.searchParams.get("events");
    const eventDates = eventDatesParam ? eventDatesParam.split(",") : [];
    
    // Fetch OHLC data
    const bars = await fetchBars(ticker, limit);
    
    if (bars.length < 60) {
      return NextResponse.json({
        ticker: ticker.toUpperCase(),
        error: "Insufficient data (minimum 60 days required)",
      }, { status: 400 });
    }
    
    // Compute all volatility measures
    const volSeries = computeVolatilityMeasures(bars);
    
    // Get current values (most recent)
    const current = volSeries[volSeries.length - 1];
    
    // Compute percentiles for current values
    const rolling20Values = volSeries.map(v => v.rolling20).filter(v => !isNaN(v));
    const ewma94Values = volSeries.map(v => v.ewma94).filter(v => !isNaN(v));
    
    const percentiles = {
      rolling20: currentVolatilityPercentile(current.rolling20, rolling20Values),
      ewma94: currentVolatilityPercentile(current.ewma94, ewma94Values),
    };
    
    // Event analysis (if event dates provided)
    const eventAnalysis = eventDates.map(eventDate => {
      const dates = bars.map(b => b.date);
      const closes = bars.map(b => b.close);
      const returns: number[] = [];
      for (let i = 1; i < closes.length; i++) {
        returns.push(Math.log(closes[i] / closes[i - 1]));
      }
      
      const comparison = compareVolatilityAroundEvent(returns, dates.slice(1), eventDate, 30);
      
      return {
        date: eventDate,
        ...comparison,
      };
    });
    
    return NextResponse.json({
      ticker: ticker.toUpperCase(),
      count: volSeries.length,
      
      current: {
        date: current.date,
        historical: current.historical,
        rolling20: current.rolling20,
        rolling60: current.rolling60,
        rolling120: current.rolling120,
        ewma94: current.ewma94,
        ewma97: current.ewma97,
        parkinson: current.parkinson,
        garmanKlass: current.garmanKlass,
      },
      
      percentiles,
      
      series: volSeries,
      
      eventAnalysis: eventAnalysis.length > 0 ? eventAnalysis : undefined,
      
      dateRange: {
        start: volSeries[0].date,
        end: volSeries[volSeries.length - 1].date,
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      {
        error: "Volatility computation failed",
        message: e?.message ?? String(e),
      },
      { status: 500 }
    );
  }
}