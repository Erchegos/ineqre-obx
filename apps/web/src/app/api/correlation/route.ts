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
    const limit = parseInt(searchParams.get("limit") || "365");
    const window = parseInt(searchParams.get("window") || "60");

    if (!tickersParam) {
      return NextResponse.json({ error: "Missing tickers parameter" }, { status: 400 });
    }

    const tickers = tickersParam.split(",").map((t) => t.trim().toUpperCase());

    if (tickers.length < 2) {
      return NextResponse.json({ error: "Need at least 2 tickers" }, { status: 400 });
    }

    const tableName = await getPriceTable();

    // Fetch price data for all tickers
    const query = `
      SELECT 
        ticker,
        date,
        close,
        (close - LAG(close) OVER (PARTITION BY ticker ORDER BY date)) / LAG(close) OVER (PARTITION BY ticker ORDER BY date) as return
      FROM ${tableName}
      WHERE ticker = ANY($1)
        AND source = 'ibkr'
        AND close IS NOT NULL
        AND close > 0
        AND date >= CURRENT_DATE - INTERVAL '${limit} days'
      ORDER BY ticker, date
    `;

    const result = await pool.query(query, [tickers]);

    // Organize data by ticker
    const dataByTicker: Record<string, { date: string; return: number }[]> = {};
    
    for (const row of result.rows) {
      if (row.return !== null) {
        if (!dataByTicker[row.ticker]) {
          dataByTicker[row.ticker] = [];
        }
        dataByTicker[row.ticker].push({
          date: row.date instanceof Date ? row.date.toISOString().split('T')[0] : row.date,
          return: parseFloat(row.return),
        });
      }
    }

    // Find common dates across all tickers
    const allDates = new Set<string>();
    for (const ticker of tickers) {
      if (dataByTicker[ticker]) {
        dataByTicker[ticker].forEach((d) => allDates.add(d.date));
      }
    }

    const commonDates = Array.from(allDates).sort();

    // Build aligned return series
    const alignedReturns: Record<string, number[]> = {};
    
    for (const ticker of tickers) {
      alignedReturns[ticker] = commonDates.map((date) => {
        const entry = dataByTicker[ticker]?.find((d) => d.date === date);
        return entry ? entry.return : 0;
      });
    }

    // Check if we have enough data
    if (commonDates.length < window) {
      return NextResponse.json({
        error: `Insufficient overlapping data. Need at least ${window} days, found ${commonDates.length}`,
      }, { status: 400 });
    }

    // Compute correlation matrix
    const matrix: number[][] = [];
    for (let i = 0; i < tickers.length; i++) {
      matrix[i] = [];
      for (let j = 0; j < tickers.length; j++) {
        if (i === j) {
          matrix[i][j] = 1;
        } else {
          matrix[i][j] = pearsonCorrelation(alignedReturns[tickers[i]], alignedReturns[tickers[j]]);
        }
      }
    }

    // Compute average correlations
    const averageCorrelations = tickers.map((ticker, i) => {
      const corrs = matrix[i].filter((_, j) => i !== j);
      const avg = corrs.reduce((a, b) => a + b, 0) / corrs.length;
      return { ticker, avgCorrelation: avg };
    });

    // Compute rolling correlations for first two tickers
    const rollingCorrelations = [];
    
    if (tickers.length >= 2 && commonDates.length >= window) {
      for (let i = window - 1; i < commonDates.length; i++) {
        const windowReturns1 = alignedReturns[tickers[0]].slice(i - window + 1, i + 1);
        const windowReturns2 = alignedReturns[tickers[1]].slice(i - window + 1, i + 1);
        const corr = pearsonCorrelation(windowReturns1, windowReturns2);
        
        // Compute volatility
        const mean = windowReturns1.reduce((a, b) => a + b, 0) / windowReturns1.length;
        const variance = windowReturns1.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / windowReturns1.length;
        const vol = Math.sqrt(variance);
        
        rollingCorrelations.push({
          date: commonDates[i],
          correlation: corr,
          volatility: vol,
        });
      }
    }

    // Compute regime distribution
    const vols = rollingCorrelations.map((r) => r.volatility);
    const meanVol = vols.reduce((a, b) => a + b, 0) / vols.length;
    const stdVol = Math.sqrt(vols.reduce((sum, v) => sum + Math.pow(v - meanVol, 2), 0) / vols.length);

    let highStress = 0;
    let elevatedRisk = 0;
    let normal = 0;
    let lowVol = 0;

    for (const vol of vols) {
      if (vol > meanVol + 2 * stdVol) highStress++;
      else if (vol > meanVol + stdVol) elevatedRisk++;
      else if (vol > meanVol + 0.5 * stdVol) normal++;
      else lowVol++;
    }

    const total = vols.length;

    return NextResponse.json({
      startDate: commonDates[0],
      endDate: commonDates[commonDates.length - 1],
      observations: commonDates.length,
      matrix: {
        tickers,
        values: matrix,
      },
      averageCorrelations,
      rollingCorrelations,
      regimeDistribution: {
        "High Stress": (highStress / total) * 100,
        "Elevated Risk": (elevatedRisk / total) * 100,
        "Normal": (normal / total) * 100,
        "Low Volatility": (lowVol / total) * 100,
      },
    });
  } catch (error: any) {
    console.error("Correlation API error:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}