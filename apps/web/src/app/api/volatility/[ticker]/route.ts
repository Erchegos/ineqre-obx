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

// --- Helpers ---
function sanitizeNumber(n: number | undefined): number | null {
  if (n === undefined || isNaN(n) || !isFinite(n)) return null;
  return n;
}

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

// --- Data Fetching ---
async function fetchBars(ticker: string, limit: number, useAdjusted: boolean): Promise<PriceBar[]> {
  const tableName = await getPriceTable();
  
  const q = `
    SELECT 
      date::date as date, 
      open, 
      high, 
      low, 
      close,
      adj_close 
    FROM ${tableName}
    WHERE ticker = $1
      AND close IS NOT NULL
      AND close > 0
    ORDER BY date DESC
    LIMIT $2
  `;
  
  const result = await pool.query(q, [ticker, limit]);
  
  return result.rows.map((r) => {
    // Logic: If useAdjusted is true, we swap 'close' with 'adj_close'
    // We assume Open/High/Low are proportional or we just use raw for those 
    // (Note: For precise Yang-Zhang on splits, you'd ideally adjust O/H/L too, 
    // but swapping Close is the most important step for standard volatility).
    const rawClose = Number(r.close);
    const adjClose = r.adj_close ? Number(r.adj_close) : rawClose;
    
    // Calculate the adjustment factor if needed to scale O/H/L
    // (Optional: simple version just swaps close. 
    // More complex version scales O/H/L by (AdjClose / Close))
    const ratio = useAdjusted && rawClose !== 0 ? adjClose / rawClose : 1;

    return {
      date: r.date instanceof Date ? r.date.toISOString().slice(0, 10) : String(r.date),
      open: Number(r.open) * ratio,
      high: Number(r.high) * ratio,
      low: Number(r.low) * ratio,
      close: useAdjusted ? adjClose : rawClose,
    };
  }).reverse(); // Return oldest -> newest for calculation
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const { ticker } = await params;
  const { searchParams } = new URL(request.url);
  
  // 1. DYNAMIC LIMIT: Default to 1500 if not provided
  const limitParam = searchParams.get("limit");
  const limit = limitParam ? parseInt(limitParam, 10) : 1500;

  // 2. ADJUSTED LOGIC: Check strictly for "false" to disable it
  // Default to true (Total Return)
  const adjustedParam = searchParams.get("adjusted");
  const useAdjusted = adjustedParam !== "false"; 

  if (!ticker) {
    return NextResponse.json({ error: "Ticker is required" }, { status: 400 });
  }

  try {
    const bars = await fetchBars(ticker, limit, useAdjusted);

    if (bars.length < 30) {
      return NextResponse.json(
        { error: "Insufficient data for volatility analysis" },
        { status: 400 }
      );
    }

    // Compute Volatility
    const volSeries = computeVolatilityMeasures(bars);
    
    // Get latest values
    const current = volSeries[volSeries.length - 1];

    // Compute percentiles
    // We need to map safely in case specific metrics are missing in older data
    const percentiles = {
      rolling20: currentVolatilityPercentile(current.rolling20, volSeries.map(v => v.rolling20)),
      ewma94: currentVolatilityPercentile(current.ewma94, volSeries.map(v => v.ewma94)),
      // Add percentiles for our new favorite metrics
      yangZhang: currentVolatilityPercentile(current.yangZhang, volSeries.map(v => v.yangZhang)),
      rogersSatchell: currentVolatilityPercentile(current.rogersSatchell, volSeries.map(v => v.rogersSatchell)),
    };

    // Event Analysis
    const largeMoves = bars.filter((b, i) => {
      if (i === 0) return false;
      const ret = Math.abs((b.close - bars[i-1].close) / bars[i-1].close);
      return ret > 0.05; 
    }).slice(-5); 

    const eventAnalysis = largeMoves.map(event => {
      return compareVolatilityAroundEvent(volSeries, event.date, 10);
    }).filter(e => e !== null);

    const responseData = {
      ticker: ticker.toUpperCase(),
      count: volSeries.length,
      adjusted: useAdjusted, // Echo back status
      
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
        // ADDED MISSING METRICS HERE:
        rogersSatchell: sanitizeNumber(current.rogersSatchell),
        yangZhang: sanitizeNumber(current.yangZhang),
      },
      
      percentiles: {
        rolling20: sanitizeNumber(percentiles.rolling20),
        ewma94: sanitizeNumber(percentiles.ewma94),
        // ADDED MISSING PERCENTILES HERE:
        rogersSatchell: sanitizeNumber(percentiles.rogersSatchell),
        yangZhang: sanitizeNumber(percentiles.yangZhang),
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
      },
      { status: 500 }
    );
  }
}