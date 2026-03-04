/**
 * Shipping Company Quarterly TCE Rates API
 * GET /api/shipping/rates/company?ticker=FRO&quarters=8
 *
 * Returns company quarterly TCE data.
 */

import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const ticker = request.nextUrl.searchParams.get("ticker");
    const quartersParam = request.nextUrl.searchParams.get("quarters");
    const quarters = quartersParam ? parseInt(quartersParam) : 8;

    const params: (string | number)[] = [quarters];
    const conditions: string[] = [];

    if (ticker) {
      params.push(ticker.toUpperCase());
      conditions.push(`cr.ticker = $${params.length}`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    // Get unique quarters to limit by, then fetch data
    const result = await pool.query(`
      WITH ranked_quarters AS (
        SELECT DISTINCT quarter
        FROM shipping_company_rates
        ${ticker ? `WHERE ticker = $2` : ""}
        ORDER BY quarter DESC
        LIMIT $1
      )
      SELECT
        cr.ticker,
        sc.company_name,
        cr.quarter,
        cr.vessel_class,
        cr.rate_usd_per_day::float,
        cr.vessels_in_class::int,
        cr.contract_coverage_pct::float,
        cr.spot_exposure_pct::float
      FROM shipping_company_rates cr
      JOIN shipping_companies sc ON sc.ticker = cr.ticker
      WHERE cr.quarter IN (SELECT quarter FROM ranked_quarters)
        ${ticker ? `AND cr.ticker = $2` : ""}
      ORDER BY cr.ticker ASC, cr.quarter DESC, cr.vessel_class ASC
    `, params);

    // Collect unique tickers
    const tickers = [...new Set(result.rows.map(r => r.ticker))];

    return NextResponse.json({
      data: result.rows.map(row => ({
        ticker: row.ticker,
        company_name: row.company_name,
        quarter: row.quarter,
        vessel_class: row.vessel_class,
        rate_usd_per_day: row.rate_usd_per_day,
        contract_coverage_pct: row.contract_coverage_pct,
        spot_exposure_pct: row.spot_exposure_pct,
        vessels_in_class: row.vessels_in_class,
      })),
      tickers,
    });
  } catch (err) {
    console.error("[shipping/rates/company]", err);
    return NextResponse.json({ error: "Failed to fetch company rates" }, { status: 500 });
  }
}
