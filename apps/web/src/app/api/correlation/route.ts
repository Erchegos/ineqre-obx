import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getPriceTable } from "@/lib/price-data-adapter";

export const dynamic = "force-dynamic";

function pearsonCorrelation(x: number[], y: number[]): number {
  const n = x.length;
  if (n === 0 || n !== y.length) return 0;

  const sumX = x.reduce((a, b) => a + b, 0);
  const sumY = y.reduce((a, b) => a + b, 0);
  const sumXY = x.reduce((acc, xi, i) => acc + xi * y[i], 0);
  const sumX2 = x.reduce((a, b) => a + b * b, 0);
  const sumY2 = y.reduce((a, b) => a + b * b, 0);

  const numerator = n * sumXY - sumX * sumY;
  const denominator = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));

  if (denominator === 0) return 0;
  return numerator / denominator;
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const tickersParam = searchParams.get("tickers");
    const limitDays = parseInt(searchParams.get("limit") || "365");
    const windowSize = parseInt(searchParams.get("window") || "60");
    const mode = searchParams.get("mode") || "total_return"; 

    if (!tickersParam) {
      return NextResponse.json({ error: "No tickers provided" }, { status: 400 });
    }

    const tickers = tickersParam.split(",").map((t) => t.trim().toUpperCase());
    if (tickers.length < 2) {
      return NextResponse.json({ error: "Select at least 2 tickers" }, { status: 400 });
    }

    const tableName = await getPriceTable();

    // 1. Fetch Data by Date Range (More robust than LIMIT)
    // We add a buffer (windowSize * 2) to ensure we have enough prior data for the first rolling point
    const query = `
      SELECT ticker, date::text as date, close, adj_close
      FROM ${tableName}
      WHERE ticker = ANY($1)
        AND date >= CURRENT_DATE - ($2 || ' days')::INTERVAL
        AND close IS NOT NULL
        AND close > 0
      ORDER BY date ASC
    `;
    
    // Request slightly more history than the limit to account for market holidays vs calendar days
    const lookbackBuffer = Math.floor(limitDays + (limitDays * 0.4) + windowSize); 
    const result = await pool.query(query, [tickers, lookbackBuffer]);

    // 2. Group by Ticker
    const rawData: Record<string, { date: string; value: number }[]> = {};
    const tickerCounts: Record<string, number> = {};

    result.rows.forEach((row) => {
      if (!rawData[row.ticker]) {
        rawData[row.ticker] = [];
        tickerCounts[row.ticker] = 0;
      }
      
      let val = Number(row.close);
      if (mode === "total_return") {
        val = row.adj_close ? Number(row.adj_close) : val;
      }

      rawData[row.ticker].push({
        date: row.date,
        value: val,
      });
      tickerCounts[row.ticker]++;
    });

    // CHECK 1: Ensure we actually found data for the requested tickers
    const missingTickers = tickers.filter(t => !rawData[t] || rawData[t].length === 0);
    if (missingTickers.length > 0) {
      return NextResponse.json({ 
        error: `No data found for: ${missingTickers.join(", ")}` 
      }, { status: 404 });
    }

    // 3. Find Intersection (Dates where ALL tickers have data)
    const dateCounts: Record<string, number> = {};
    Object.values(rawData).forEach((series) => {
      series.forEach((p) => {
        dateCounts[p.date] = (dateCounts[p.date] || 0) + 1;
      });
    });

    const commonDates = Object.keys(dateCounts)
      .filter((d) => dateCounts[d] === tickers.length)
      .sort(); // Oldest -> Newest

    // CHECK 2: Insufficient Overlap
    // If the intersection is too small to calculate even a basic correlation
    if (commonDates.length < 5) {
      // Find the bottleneck ticker to give a helpful error
      const shortestTicker = Object.entries(tickerCounts)
        .sort(([, a], [, b]) => a - b)[0];
      
      return NextResponse.json({ 
        error: `Insufficient overlapping data. ${shortestTicker[0]} only has ${shortestTicker[1]} days of data in this period.` 
      }, { status: 400 });
    }

    // 4. Create Aligned Price Series
    const alignedPrices: Record<string, number[]> = {};
    tickers.forEach((t) => {
      const map = new Map(rawData[t].map((i) => [i.date, i.value]));
      alignedPrices[t] = commonDates.map((d) => map.get(d) || 0);
    });

    // 5. Compute Log Returns
    const returns: Record<string, number[]> = {};
    const returnDates = commonDates.slice(1); 

    tickers.forEach((t) => {
      const prices = alignedPrices[t];
      const rets = [];
      for (let i = 1; i < prices.length; i++) {
        const pCurrent = prices[i];
        const pPrev = prices[i - 1];
        if (pPrev > 0 && pCurrent > 0) {
          rets.push(Math.log(pCurrent / pPrev));
        } else {
          rets.push(0);
        }
      }
      returns[t] = rets;
    });

    // 6. Compute Matrix (Uses all available overlapping data)
    const matrix: number[][] = [];
    const averageCorrelations: any[] = [];

    for (let i = 0; i < tickers.length; i++) {
      const row: number[] = [];
      let sumCorr = 0;
      let count = 0;

      for (let j = 0; j < tickers.length; j++) {
        if (i === j) {
          row.push(1);
        } else {
          const corr = pearsonCorrelation(returns[tickers[i]], returns[tickers[j]]);
          row.push(corr);
          sumCorr += corr;
          count++;
        }
      }
      matrix.push(row);
      averageCorrelations.push({
        ticker: tickers[i],
        avgCorrelation: count > 0 ? sumCorr / count : 0
      });
    }

    // 7. Compute Rolling Correlation (Graceful Fallback)
    const rollingCorrelations = [];
    let regimeDistribution = {};
    
    // Only compute rolling if we have enough data points (need at least window size)
    if (tickers.length >= 2 && returnDates.length > windowSize) {
      const r1 = returns[tickers[0]];
      const r2 = returns[tickers[1]];
      
      for (let i = windowSize; i < r1.length; i++) {
        const slice1 = r1.slice(i - windowSize, i);
        const slice2 = r2.slice(i - windowSize, i);
        
        const corr = pearsonCorrelation(slice1, slice2);
        
        // Volatility for regime detection
        const mean = slice1.reduce((a, b) => a + b, 0) / slice1.length;
        const variance = slice1.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / slice1.length;
        const vol = Math.sqrt(variance * 252); 

        rollingCorrelations.push({
          date: returnDates[i],
          correlation: corr,
          volatility: vol,
        });
      }

      // Compute Regimes
      if (rollingCorrelations.length > 0) {
        const vols = rollingCorrelations.map((r) => r.volatility);
        const meanVol = vols.reduce((a, b) => a + b, 0) / vols.length;
        const stdVol = Math.sqrt(vols.reduce((sum, v) => sum + Math.pow(v - meanVol, 2), 0) / vols.length);

        let highStress = 0, elevatedRisk = 0, normal = 0, lowVol = 0;

        for (const vol of vols) {
          if (vol > meanVol + 2 * stdVol) highStress++;
          else if (vol > meanVol + 1.0 * stdVol) elevatedRisk++;
          else if (vol > meanVol - 0.5 * stdVol) normal++;
          else lowVol++;
        }

        const total = vols.length;
        regimeDistribution = {
          "High Stress": (highStress / total) * 100,
          "Elevated Risk": (elevatedRisk / total) * 100,
          "Normal": (normal / total) * 100,
          "Low Volatility": (lowVol / total) * 100,
        };
      }
    }

    return NextResponse.json({
      startDate: commonDates[0],
      endDate: commonDates[commonDates.length - 1],
      observations: commonDates.length,
      warning: commonDates.length < windowSize ? "Not enough data for rolling chart" : null,
      matrix: {
        tickers,
        values: matrix,
      },
      averageCorrelations: averageCorrelations.sort((a, b) => b.avgCorrelation - a.avgCorrelation),
      rollingCorrelations, // Might be empty if data is short, which is fine
      regimeDistribution,
    });

  } catch (error: any) {
    console.error("Correlation API Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}