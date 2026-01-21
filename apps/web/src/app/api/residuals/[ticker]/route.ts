import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getPriceTable } from "@/lib/price-data-adapter";
import {
  computeReturns,
  computeResidualSquares,
} from "@/lib/metrics";

export const dynamic = "force-dynamic";

type PriceRow = {
  date: string;
  close: number;
  adj_close: number;
};

// Fetch stock prices with dates
async function fetchPricesWithDates(
  ticker: string,
  limit: number,
  useAdjusted: boolean
): Promise<{ dates: string[]; prices: number[] }> {
  const tableName = await getPriceTable();

  const q = `
    SELECT date::date as date, close, adj_close
    FROM ${tableName}
    WHERE upper(ticker) = upper($1)
      AND close IS NOT NULL
      AND close > 0
      AND source = 'ibkr'
    ORDER BY date DESC
    LIMIT $2
  `;

  const result = await pool.query(q, [ticker, limit]);

  const rows: PriceRow[] = result.rows
    .map((r) => ({
      date:
        r.date instanceof Date
          ? r.date.toISOString().slice(0, 10)
          : String(r.date),
      close: Number(r.close),
      adj_close: r.adj_close ? Number(r.adj_close) : Number(r.close),
    }))
    .reverse(); // Oldest to newest

  const dates = rows.map((r) => r.date);
  const prices = rows.map((r) => (useAdjusted ? r.adj_close : r.close));

  return { dates, prices };
}

// Fetch market (OBX) prices
async function fetchMarketPrices(
  limit: number,
  useAdjusted: boolean
): Promise<number[]> {
  const tableName = await getPriceTable();

  const q = `
    SELECT close, adj_close
    FROM ${tableName}
    WHERE upper(ticker) = 'OBX'
      AND close IS NOT NULL
      AND close > 0
      AND source = 'ibkr'
    ORDER BY date DESC
    LIMIT $1
  `;

  const result = await pool.query(q, [limit]);

  return result.rows
    .map((r) => {
      const rawClose = Number(r.close);
      const adjClose = r.adj_close ? Number(r.adj_close) : rawClose;
      return useAdjusted ? adjClose : rawClose;
    })
    .reverse(); // Oldest to newest
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const { ticker } = await params;
  const { searchParams } = new URL(request.url);

  // Parse query parameters
  const limit = parseInt(searchParams.get("limit") || "1500", 10);
  const useAdjusted = searchParams.get("adjusted") !== "false";

  try {
    // Fetch stock data with dates
    const { dates, prices: stockPrices } = await fetchPricesWithDates(
      ticker,
      limit,
      useAdjusted
    );

    console.log(`[Residuals API] ${ticker}: Fetched ${stockPrices.length} stock prices`);

    if (stockPrices.length < 2) {
      console.warn(`[Residuals API] ${ticker}: Insufficient data (${stockPrices.length} prices)`);
      return NextResponse.json(
        { error: `Insufficient data for residuals analysis. Found ${stockPrices.length} prices, need at least 2.` },
        { status: 400 }
      );
    }

    // Fetch market (OBX) prices
    const marketPrices = await fetchMarketPrices(limit, useAdjusted);

    console.log(`[Residuals API] ${ticker}: Fetched ${marketPrices.length} OBX market prices`);

    // Align both series to the minimum available length
    const minLength = Math.min(stockPrices.length, marketPrices.length);

    if (minLength < 2) {
      console.warn(`[Residuals API] ${ticker}: Insufficient overlapping data (${minLength} data points)`);
      return NextResponse.json(
        { error: `Insufficient overlapping data. Found ${stockPrices.length} stock prices and ${marketPrices.length} OBX prices. Need at least 2 overlapping points.` },
        { status: 400 }
      );
    }

    console.log(`[Residuals API] ${ticker}: Using ${minLength} overlapping data points`);

    // Align both to the same length (take last N points)
    const alignedStock = stockPrices.slice(-minLength);
    const alignedMarket = marketPrices.slice(-minLength);
    const alignedDates = dates.slice(-minLength);

    // Compute returns (log returns)
    const stockReturns = computeReturns(alignedStock);
    const marketReturns = computeReturns(alignedMarket);

    // Align dates (returns start from index 1)
    const returnDates = alignedDates.slice(1);

    // Compute residual squares
    const residualSquares = computeResidualSquares(
      stockReturns,
      marketReturns,
      returnDates
    );

    // Calculate mean residual square (lowest point baseline)
    const meanResidualSquare =
      residualSquares.reduce((sum, r) => sum + r.residualSquare, 0) /
      residualSquares.length;

    return NextResponse.json({
      ticker: ticker.toUpperCase(),
      count: residualSquares.length,
      adjusted: useAdjusted,
      meanResidualSquare,
      dateRange: {
        start: returnDates[0] || "",
        end: returnDates[returnDates.length - 1] || "",
      },
      data: residualSquares,
    });
  } catch (error: any) {
    console.error("[Residuals API] Error:", error);
    return NextResponse.json(
      { error: error?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
