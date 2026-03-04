/**
 * Shipping Companies List API
 * GET /api/shipping/companies?sector=tanker
 *
 * Returns all shipping companies with fleet stats, latest TCE, and stock price.
 */

import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const sector = request.nextUrl.searchParams.get("sector");

    const params: string[] = [];
    let sectorFilter = "";
    if (sector) {
      params.push(sector);
      sectorFilter = `WHERE sc.sector = $${params.length}`;
    }

    // Single query: companies + latest TCE + latest 2 prices (for change calc)
    const result = await pool.query(`
      WITH company_prices AS (
        SELECT ticker, close, date,
               ROW_NUMBER() OVER (PARTITION BY ticker ORDER BY date DESC) AS rn
        FROM prices_daily
        WHERE ticker IN (SELECT ticker FROM shipping_companies)
          AND date >= CURRENT_DATE - INTERVAL '14 days'
      )
      SELECT
        sc.ticker,
        sc.company_name,
        sc.sector,
        sc.fleet_size,
        sc.avg_vessel_age::float,
        sc.headquarters,
        sc.color_hex,
        cr.rate_usd_per_day::float AS latest_tce,
        p1.close::float AS stock_price,
        CASE WHEN p2.close > 0 THEN ((p1.close - p2.close) / p2.close) * 100 ELSE NULL END AS price_change_pct
      FROM shipping_companies sc
      LEFT JOIN LATERAL (
        SELECT rate_usd_per_day, quarter, vessel_class
        FROM shipping_company_rates
        WHERE ticker = sc.ticker
        ORDER BY quarter DESC
        LIMIT 1
      ) cr ON true
      LEFT JOIN company_prices p1 ON p1.ticker = sc.ticker AND p1.rn = 1
      LEFT JOIN company_prices p2 ON p2.ticker = sc.ticker AND p2.rn = 2
      ${sectorFilter}
      ORDER BY sc.company_name ASC
    `, params);

    return NextResponse.json({
      companies: result.rows.map(row => ({
        ticker: row.ticker,
        company_name: row.company_name,
        sector: row.sector,
        fleet_size: row.fleet_size,
        avg_vessel_age: row.avg_vessel_age,
        headquarters: row.headquarters,
        color_hex: row.color_hex,
        avg_tce: row.latest_tce,
        contract_coverage_pct: null,
        spot_exposure_pct: null,
        stock_price: row.stock_price,
        stock_change_pct: row.price_change_pct ? Math.round(row.price_change_pct * 100) / 100 : null,
      })),
    });
  } catch (err) {
    console.error("[shipping/companies]", err);
    return NextResponse.json({ error: "Failed to fetch shipping companies" }, { status: 500 });
  }
}
