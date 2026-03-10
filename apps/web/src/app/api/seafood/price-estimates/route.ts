/**
 * Pareto Salmon Price Estimates API
 * GET /api/seafood/price-estimates?source=pareto
 *
 * Returns quarterly/annual salmon price estimates from Pareto Seafood Weekly,
 * plus latest spot price and historical spot series.
 */

import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const source = sp.get("source") || "pareto";

    // Latest report's estimates (quarterly + annual)
    const latestReport = await pool.query(
      `SELECT DISTINCT ON (period) report_date, period, price_nok_kg::float, price_eur_kg::float,
              supply_growth_yoy::float, is_estimate
       FROM salmon_price_estimates
       WHERE source = $1 AND period != 'spot'
       ORDER BY period, report_date DESC`,
      [source]
    );

    // Latest spot data
    const latestSpot = await pool.query(
      `SELECT report_date, price_nok_kg::float as spot_nok, price_eur_kg::float as spot_eur,
              qtd_price_nok::float, consensus_nok::float
       FROM salmon_price_estimates
       WHERE source = $1 AND period = 'spot'
       ORDER BY report_date DESC
       LIMIT 1`,
      [source]
    );

    // Spot price history (weekly from each report)
    const spotHistory = await pool.query(
      `SELECT report_date, price_nok_kg::float as spot_nok, price_eur_kg::float as spot_eur,
              qtd_price_nok::float, consensus_nok::float
       FROM salmon_price_estimates
       WHERE source = $1 AND period = 'spot'
       ORDER BY report_date ASC`,
      [source]
    );

    // Separate quarterly and annual estimates
    const quarterly = latestReport.rows.filter((r) => r.period.startsWith("Q"));
    const annual = latestReport.rows.filter((r) => /^\d{4}/.test(r.period));

    return NextResponse.json({
      source,
      spot: latestSpot.rows[0] || null,
      spotHistory: spotHistory.rows,
      quarterly,
      annual,
      estimateCount: latestReport.rows.length,
    });
  } catch (err) {
    console.error("[PRICE ESTIMATES]", err);
    return NextResponse.json(
      { error: "Failed to fetch price estimates" },
      { status: 500 }
    );
  }
}
