import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getPriceTable } from "@/lib/price-data-adapter";
import {
  computeReturns,
  computeResidualSquares,
  computeOLSRegression,
} from "@/lib/metrics";

export const dynamic = "force-dynamic";

type PriceRow = {
  date: string;
  close: number;
  adj_close: number;
};

// Fetch aligned stock and market prices by date
async function fetchAlignedPrices(
  ticker: string,
  limit: number,
  useAdjusted: boolean
): Promise<{
  dates: string[];
  stockPrices: number[];
  marketPrices: number[];
}> {
  const tableName = await getPriceTable();

  // JOIN stock and OBX data by date to ensure alignment
  const q = `
    SELECT
      s.date::date as date,
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

  const rows = result.rows
    .map((r) => ({
      date:
        r.date instanceof Date
          ? r.date.toISOString().slice(0, 10)
          : String(r.date),
      stockClose: Number(r.stock_close),
      stockAdjClose: r.stock_adj_close
        ? Number(r.stock_adj_close)
        : Number(r.stock_close),
      marketClose: Number(r.market_close),
      marketAdjClose: r.market_adj_close
        ? Number(r.market_adj_close)
        : Number(r.market_close),
    }))
    .reverse(); // Oldest to newest

  const dates = rows.map((r) => r.date);
  const stockPrices = rows.map((r) =>
    useAdjusted ? r.stockAdjClose : r.stockClose
  );
  const marketPrices = rows.map((r) =>
    useAdjusted ? r.marketAdjClose : r.marketClose
  );

  return { dates, stockPrices, marketPrices };
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
    // Fetch aligned stock and market data by date
    const { dates, stockPrices, marketPrices } = await fetchAlignedPrices(
      ticker,
      limit,
      useAdjusted
    );

    console.log(
      `[Residuals API] ${ticker}: Fetched ${stockPrices.length} aligned price pairs`
    );

    if (stockPrices.length < 2) {
      console.warn(
        `[Residuals API] ${ticker}: Insufficient data (${stockPrices.length} prices)`
      );
      return NextResponse.json(
        {
          error: `Insufficient data for residuals analysis. Found ${stockPrices.length} overlapping dates with OBX, need at least 2.`,
        },
        { status: 400 }
      );
    }

    // Compute returns (log returns)
    const stockReturns = computeReturns(stockPrices);
    const marketReturns = computeReturns(marketPrices);

    // Align dates (returns start from index 1)
    const returnDates = dates.slice(1);

    // Compute OLS regression to get alpha, beta, R²
    const regression = computeOLSRegression(stockReturns, marketReturns);

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

    // Prepare returns data for scatter plot (stock return vs market return)
    const returnsData = stockReturns.map((stockReturn, i) => ({
      date: returnDates[i] || "",
      stockReturn: stockReturn,
      marketReturn: marketReturns[i] || 0,
      residual: regression.residuals[i] || 0,
      residualSquare: residualSquares[i]?.residualSquare || 0,
    }));

    return NextResponse.json({
      ticker: ticker.toUpperCase(),
      count: residualSquares.length,
      adjusted: useAdjusted,
      meanResidualSquare,
      dateRange: {
        start: returnDates[0] || "",
        end: returnDates[returnDates.length - 1] || "",
      },
      regression: {
        alpha: regression.alpha,
        beta: regression.beta,
        rSquared: regression.rSquared,
      },
      data: residualSquares, // Keep for backwards compatibility
      returnsData: returnsData, // New: actual returns for scatter plot
    });
  } catch (error: any) {
    console.error("[Residuals API] Error:", error);
    return NextResponse.json(
      { error: error?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
