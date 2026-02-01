import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getPriceTable } from "@/lib/price-data-adapter";
import {
  computeVolatilityMeasures,
  compareVolatilityAroundEvent,
  currentVolatilityPercentile,
  calculateRegimeDuration,
  type RegimePoint
} from "@/lib/volatility";
import { computeReturns, computeBeta } from "@/lib/metrics";
import {
  classifyRegime,
  determineVolatilityTrend,
  getRegimeInterpretation,
  type VolatilityRegime
} from "@/lib/regimeClassification";

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

// Fetch aligned stock and market bars for beta calculation
async function fetchAlignedBarsForBeta(
  ticker: string,
  limit: number,
  useAdjusted: boolean
): Promise<{ stockPrices: number[]; marketPrices: number[] }> {
  const tableName = await getPriceTable();

  // JOIN stock and OBX data by date to ensure alignment
  const q = `
    SELECT
      s.close as stock_close,
      s.adj_close as stock_adj_close,
      m.close as market_close,
      m.adj_close as market_adj_close
    FROM ${tableName} s
    INNER JOIN ${tableName} m ON s.date = m.date
    WHERE upper(s.ticker) = upper($1)
      AND upper(m.ticker) = 'OBX'
      AND s.close IS NOT NULL
      AND s.close > 0
      AND m.close IS NOT NULL
      AND m.close > 0
    ORDER BY s.date DESC
    LIMIT $2
  `;

  const result = await pool.query(q, [ticker, limit]);

  const rows = result.rows.reverse(); // Oldest to newest

  const stockPrices = rows.map((r) => {
    const rawClose = Number(r.stock_close);
    const adjClose = r.stock_adj_close
      ? Number(r.stock_adj_close)
      : rawClose;
    return useAdjusted ? adjClose : rawClose;
  });

  const marketPrices = rows.map((r) => {
    const rawClose = Number(r.market_close);
    const adjClose = r.market_adj_close
      ? Number(r.market_adj_close)
      : rawClose;
    return useAdjusted ? adjClose : rawClose;
  });

  return { stockPrices, marketPrices };
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

    // Calculate Beta (vs OBX) with properly aligned data
    let beta = 0;
    try {
      const { stockPrices, marketPrices } = await fetchAlignedBarsForBeta(
        ticker,
        limit,
        useAdjusted
      );
      if (stockPrices.length > 0 && marketPrices.length > 0) {
        const stockReturns = computeReturns(stockPrices);
        const marketReturns = computeReturns(marketPrices);
        beta = computeBeta(stockReturns, marketReturns);
      }
    } catch (e) {
      console.warn('[Volatility API] Beta calculation failed:', e);
      // Beta will remain 0
    }

    // Compute percentiles
    // FIX APPLIED HERE: Added '?? null' inside the .map() calls
    const percentiles = {
      rolling20: currentVolatilityPercentile(current.rolling20, volSeries.map(v => v.rolling20)),
      rolling60: currentVolatilityPercentile(current.rolling60, volSeries.map(v => v.rolling60)),
      ewma94: currentVolatilityPercentile(current.ewma94, volSeries.map(v => v.ewma94)),

      // FIX: Explicitly convert undefined -> null for the array elements
      yangZhang: currentVolatilityPercentile(
        current.yangZhang ?? null,
        volSeries.map(v => v.yangZhang ?? null)
      ),
      rogersSatchell: currentVolatilityPercentile(
        current.rogersSatchell ?? null,
        volSeries.map(v => v.rogersSatchell ?? null)
      ),
    };

    // Regime Classification
    // Use Yang-Zhang if available, fallback to Rolling20
    const primaryVol = current.yangZhang ?? current.rolling20 ?? 0;
    const primaryPercentile = current.yangZhang
      ? percentiles.yangZhang
      : percentiles.rolling20;

    // Determine trend by comparing short-term vs medium-term
    const trend = determineVolatilityTrend(current.rolling20, current.rolling60);
    const regime = classifyRegime(primaryPercentile, trend);

    // Build regime history
    const regimeHistory: RegimePoint[] = [];
    for (let i = 0; i < volSeries.length; i++) {
      const point = volSeries[i];
      const pointVol = point.yangZhang ?? point.rolling20 ?? 0;
      const pointPercentile = point.yangZhang
        ? currentVolatilityPercentile(point.yangZhang ?? null, volSeries.map(v => v.yangZhang ?? null))
        : currentVolatilityPercentile(point.rolling20, volSeries.map(v => v.rolling20));
      const pointTrend = determineVolatilityTrend(point.rolling20, point.rolling60);
      const pointRegime = classifyRegime(pointPercentile, pointTrend);

      regimeHistory.push({
        date: point.date,
        regime: pointRegime,
        volatility: pointVol,
      });
    }

    // Calculate regime duration stats
    const regimeStats = calculateRegimeDuration(regimeHistory);

    // Calculate expected moves in NOK
    const currentPrice = bars[bars.length - 1].close;
    const dailyVol = primaryVol / Math.sqrt(252);
    const expectedMoves = {
      currentPrice,
      daily1Sigma: currentPrice * dailyVol,
      weekly1Sigma: currentPrice * dailyVol * Math.sqrt(5),
      daily2Sigma: currentPrice * dailyVol * 2,
    };

    // Generate regime interpretation
    const interpretation = getRegimeInterpretation(
      regime,
      primaryPercentile,
      trend,
      beta,
      ticker.toUpperCase()
    );

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
      beta: sanitizeNumber(beta), // Beta vs OBX

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
        rogersSatchell: sanitizeNumber(current.rogersSatchell),
        yangZhang: sanitizeNumber(current.yangZhang),
      },

      percentiles: {
        rolling20: sanitizeNumber(percentiles.rolling20),
        rolling60: sanitizeNumber(percentiles.rolling60),
        ewma94: sanitizeNumber(percentiles.ewma94),
        rogersSatchell: sanitizeNumber(percentiles.rogersSatchell),
        yangZhang: sanitizeNumber(percentiles.yangZhang),
      },

      regime: {
        current: regime,
        level: sanitizeNumber(primaryVol),
        percentile: sanitizeNumber(primaryPercentile),
        trend,
        duration: regimeStats.currentDuration,
        lastShift: regimeStats.lastShift,
        averageDuration: regimeStats.averageDuration,
        interpretation,
      },

      expectedMoves: {
        currentPrice: sanitizeNumber(expectedMoves.currentPrice),
        daily1Sigma: sanitizeNumber(expectedMoves.daily1Sigma),
        weekly1Sigma: sanitizeNumber(expectedMoves.weekly1Sigma),
        daily2Sigma: sanitizeNumber(expectedMoves.daily2Sigma),
      },

      regimeHistory: regimeHistory.map(point => ({
        date: point.date,
        regime: point.regime,
        volatility: sanitizeNumber(point.volatility),
        close: sanitizeNumber(bars.find(b => b.date === point.date)?.close ?? 0),
      })),

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