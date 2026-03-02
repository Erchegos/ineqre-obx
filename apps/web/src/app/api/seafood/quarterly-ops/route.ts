/**
 * Salmon Quarterly Operations API
 * GET /api/seafood/quarterly-ops
 *
 * Returns quarterly operational data for salmon companies.
 * Query params:
 *   - ticker: optional, filter by ticker
 *   - quarters: optional, number of recent quarters to return (default 8)
 */

import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SALMON_TICKERS = ["MOWI", "SALM", "LSG", "GSF", "BAKKA", "AUSS"];

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const ticker = searchParams.get("ticker")?.toUpperCase();
    const quarters = Math.min(parseInt(searchParams.get("quarters") || "8", 10), 20);

    const tickers = ticker && SALMON_TICKERS.includes(ticker)
      ? [ticker]
      : SALMON_TICKERS;

    const result = await pool.query(
      `SELECT
        ticker,
        year,
        quarter,
        harvest_tonnes_gwt::float AS harvest_gwt,
        revenue_m::float AS revenue_m,
        ebit_operational_m::float AS ebit_m,
        ebit_per_kg::float AS ebit_per_kg,
        cost_per_kg::float AS cost_per_kg,
        price_realization_per_kg::float AS price_per_kg,
        mortality_pct::float AS mortality_pct,
        currency,
        source
      FROM salmon_quarterly_ops
      WHERE ticker = ANY($1::text[])
      ORDER BY year DESC, quarter DESC
      LIMIT $2`,
      [tickers, tickers.length * quarters]
    );

    // Group by ticker
    const byTicker: Record<string, any[]> = {};
    for (const row of result.rows) {
      if (!byTicker[row.ticker]) byTicker[row.ticker] = [];
      byTicker[row.ticker].push({
        year: row.year,
        quarter: row.quarter,
        label: `Q${row.quarter} ${row.year}`,
        harvestGwt: row.harvest_gwt,
        revenueM: row.revenue_m,
        ebitM: row.ebit_m,
        ebitPerKg: row.ebit_per_kg,
        costPerKg: row.cost_per_kg,
        pricePerKg: row.price_per_kg,
        mortalityPct: row.mortality_pct,
        currency: row.currency,
        source: row.source,
      });
    }

    return NextResponse.json({ data: byTicker, tickers });
  } catch (err) {
    console.error("[QUARTERLY OPS]", err);
    return NextResponse.json(
      { error: "Failed to fetch quarterly operations data" },
      { status: 500 }
    );
  }
}
