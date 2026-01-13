import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getPriceTable } from "@/lib/price-data-adapter";
import { 
  computeVolatilityMeasures, 
  compareVolatilityAroundEvent, 
  currentVolatilityPercentile 
} from "@/lib/volatility";

export const dynamic = "force-dynamic";

type PriceBar = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
};

/**
 * Sanitize a number for JSON serialization
 * Converts NaN and Infinity to null
 */
function sanitizeNumber(n: number | undefined): number | null {
  if (n === undefined || isNaN(n) || !isFinite(n)) return null;
  return n;
}

/**
 * Sanitize an object, converting all NaN/Infinity to null
 */
function sanitizeData(data: any): any {
  if (typeof data === 'number') {
    return sanitizeNumber(data);
  }
  if (Array.isArray(data)) {
    return data.map(sanitizeData);
  }
  if (data && typeof data === 'object') {
    const result: any = {};
    for (const [key, value] of Object.entries(data)) {
      result[key] = sanitizeData(value);
    }
    return result;
  }
  return data;
}

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
      AND open > 0
      AND high > 0
      AND low > 0
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
    
    const eventDatesParam = url.searchParams.get("events");
    const eventDates = eventDatesParam ? eventDatesParam.split(",") : [];
    
    console.log(`[Volatility API] Fetching data for ${ticker}...`);
    
    const bars = await fetchBars(ticker, limit);
    
    console.log(`[Volatility API] Found ${bars.length} bars with complete OHLC data`);
    
    if (bars.length === 0) {
      return NextResponse.json({
        ticker: ticker.toUpperCase(),
        error: "No OHLC data found. This ticker might only have close prices.",
      }, { status: 404 });
    }
    
    if (bars.length < 60) {
      return NextResponse.json({
        ticker: ticker.toUpperCase(),
        error: `Insufficient data: only ${bars.length} days (minimum 60 required)`,
      }, { status: 400 });
    }
    
    console.log(`[Volatility API] Computing volatility measures...`);
    
    const volSeries = computeVolatilityMeasures(bars);
    
    if (volSeries.length === 0) {
      return NextResponse.json({
        ticker: ticker.toUpperCase(),
        error: "Failed to compute volatility measures",
      }, { status: 500 });
    }
    
    const current = volSeries[volSeries.length - 1];
    
    const rolling20Values = volSeries.map(v => v.rolling20).filter(v => !isNaN(v));
    const ewma94Values = volSeries.map(v => v.ewma94).filter(v => !isNaN(v));
    
    const percentiles = {
      rolling20: currentVolatilityPercentile(current.rolling20, rolling20Values),
      ewma94: currentVolatilityPercentile(current.ewma94, ewma94Values),
    };
    
    console.log(`[Volatility API] Computing event analysis for ${eventDates.length} events...`);
    
    const eventAnalysis = eventDates.map(eventDate => {
      try {
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
      } catch (e) {
        console.error(`Failed to analyze event ${eventDate}:`, e);
        return {
          date: eventDate,
          before: 0,
          after: 0,
          change: 0,
          changePercent: 0,
        };
      }
    });
    
    console.log(`[Volatility API] Success! Returning ${volSeries.length} volatility points`);
    
    // Sanitize the response data to handle NaN/Infinity values
    const responseData = {
      ticker: ticker.toUpperCase(),
      count: volSeries.length,
      
      current: {
        date: current.date,
        historical: sanitizeNumber(current.historical),
        rolling20: sanitizeNumber(current.rolling20),
        rolling60: sanitizeNumber(current.rolling60),
        rolling120: sanitizeNumber(current.rolling120),
        ewma94: sanitizeNumber(current.ewma94),
        ewma97: sanitizeNumber(current.ewma97),
        parkinson: sanitizeNumber(current.parkinson),
        garmanKlass: sanitizeNumber(current.garmanKlass),
      },
      
      percentiles: {
        rolling20: sanitizeNumber(percentiles.rolling20),
        ewma94: sanitizeNumber(percentiles.ewma94),
      },
      
      series: sanitizeData(volSeries),
      eventAnalysis: eventAnalysis.length > 0 ? sanitizeData(eventAnalysis) : undefined,
      
      dateRange: {
        start: volSeries[0].date,
        end: volSeries[volSeries.length - 1].date,
      },
    };
    
    return NextResponse.json(responseData);
  } catch (e: any) {
    console.error('[Volatility API] Error:', e);
    return NextResponse.json(
      {
        error: "Volatility computation failed",
        message: e?.message ?? String(e),
        stack: process.env.NODE_ENV === 'development' ? e?.stack : undefined,
      },
      { status: 500 }
    );
  }
}