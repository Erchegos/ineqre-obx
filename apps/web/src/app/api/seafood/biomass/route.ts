/**
 * Seafood Biomass API
 * GET /api/seafood/biomass?area=&months=24&species=salmon
 *
 * Returns biomass time series by production area, totals, and YoY comparison.
 */

import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const area = sp.get("area"); // optional: filter to single area
    const months = parseInt(sp.get("months") || "24");
    const species = sp.get("species") || "salmon";

    const areaFilter = area ? `AND area_number = ${parseInt(area)}` : "";

    // 1) Time series
    const tsResult = await pool.query(`
      SELECT area_number, month,
             biomass_tonnes::float, harvest_tonnes::float,
             mortality_tonnes::float, feed_tonnes::float,
             stock_count
      FROM seafood_biomass_monthly
      WHERE species = $1
        AND month >= (CURRENT_DATE - INTERVAL '1 month' * $2)::date
        ${areaFilter}
      ORDER BY month, area_number
    `, [species, months]);

    // 2) Current totals (latest month per area)
    const totalsResult = await pool.query(`
      SELECT DISTINCT ON (area_number)
        area_number, month, biomass_tonnes::float, harvest_tonnes::float,
        stock_count
      FROM seafood_biomass_monthly
      WHERE species = $1 ${areaFilter}
      ORDER BY area_number, month DESC
    `, [species]);

    // 3) National total biomass trend (monthly)
    const nationalResult = await pool.query(`
      SELECT month,
             SUM(biomass_tonnes)::float AS total_biomass,
             SUM(harvest_tonnes)::float AS total_harvest,
             SUM(feed_tonnes)::float AS total_feed,
             SUM(stock_count)::bigint AS total_stock
      FROM seafood_biomass_monthly
      WHERE species = $1
        AND month >= (CURRENT_DATE - INTERVAL '1 month' * $2)::date
      GROUP BY month
      ORDER BY month
    `, [species, months]);

    // 4) YoY comparison (current month vs same month last year)
    const yoyResult = await pool.query(`
      WITH latest AS (
        SELECT MAX(month) AS latest_month FROM seafood_biomass_monthly WHERE species = $1
      ),
      current_data AS (
        SELECT area_number, biomass_tonnes::float AS biomass
        FROM seafood_biomass_monthly bm, latest l
        WHERE bm.month = l.latest_month AND species = $1
      ),
      prev_year AS (
        SELECT area_number, biomass_tonnes::float AS biomass
        FROM seafood_biomass_monthly bm, latest l
        WHERE bm.month = (l.latest_month - INTERVAL '1 year')::date AND species = $1
      )
      SELECT c.area_number,
             c.biomass AS current_biomass,
             p.biomass AS prev_biomass,
             CASE WHEN p.biomass > 0
               THEN ROUND(((c.biomass - p.biomass) / p.biomass * 100)::numeric, 1)
               ELSE NULL END AS yoy_change_pct
      FROM current_data c
      LEFT JOIN prev_year p ON c.area_number = p.area_number
      ORDER BY c.area_number
    `, [species]);

    return NextResponse.json({
      timeSeries: tsResult.rows,
      currentTotals: totalsResult.rows,
      nationalTrend: nationalResult.rows,
      yoyComparison: yoyResult.rows,
      species,
      months,
    });
  } catch (err) {
    console.error("[SEAFOOD BIOMASS]", err);
    return NextResponse.json({ error: "Failed to fetch biomass data" }, { status: 500 });
  }
}
