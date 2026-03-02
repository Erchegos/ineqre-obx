/**
 * Seafood Harvest & Mortality API
 * GET /api/seafood/harvest?months=24&species=salmon
 *
 * Returns harvest volumes and mortality rates by production area.
 */

import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const months = parseInt(sp.get("months") || "24");
    const species = sp.get("species") || "salmon";

    // 1) Monthly harvest by area
    const harvestResult = await pool.query(`
      SELECT area_number, month,
             harvest_tonnes::float,
             mortality_tonnes::float,
             biomass_tonnes::float,
             feed_tonnes::float,
             stock_count
      FROM seafood_biomass_monthly
      WHERE species = $1
        AND month >= (CURRENT_DATE - INTERVAL '1 month' * $2)::date
      ORDER BY month, area_number
    `, [species, months]);

    // 2) National monthly totals
    const nationalResult = await pool.query(`
      SELECT month,
             SUM(harvest_tonnes)::float AS total_harvest,
             SUM(mortality_tonnes)::float AS total_mortality,
             SUM(biomass_tonnes)::float AS total_biomass,
             SUM(feed_tonnes)::float AS total_feed,
             CASE WHEN SUM(biomass_tonnes) > 0
               THEN ROUND((SUM(mortality_tonnes) / SUM(biomass_tonnes) * 100)::numeric, 2)
               ELSE 0 END AS mortality_rate_pct,
             CASE WHEN SUM(harvest_tonnes) > 0
               THEN ROUND((SUM(feed_tonnes) / SUM(harvest_tonnes))::numeric, 2)
               ELSE NULL END AS feed_conversion_ratio
      FROM seafood_biomass_monthly
      WHERE species = $1
        AND month >= (CURRENT_DATE - INTERVAL '1 month' * $2)::date
      GROUP BY month
      ORDER BY month
    `, [species, months]);

    // 3) YoY harvest comparison by area (latest 12 months vs prior 12)
    const yoyResult = await pool.query(`
      WITH latest_month AS (
        SELECT MAX(month) AS m FROM seafood_biomass_monthly WHERE species = $1
      ),
      recent AS (
        SELECT area_number, SUM(harvest_tonnes)::float AS harvest
        FROM seafood_biomass_monthly bm, latest_month lm
        WHERE species = $1 AND month > (lm.m - INTERVAL '12 months')::date
        GROUP BY area_number
      ),
      prior AS (
        SELECT area_number, SUM(harvest_tonnes)::float AS harvest
        FROM seafood_biomass_monthly bm, latest_month lm
        WHERE species = $1
          AND month > (lm.m - INTERVAL '24 months')::date
          AND month <= (lm.m - INTERVAL '12 months')::date
        GROUP BY area_number
      )
      SELECT r.area_number,
             r.harvest AS recent_harvest,
             p.harvest AS prior_harvest,
             CASE WHEN p.harvest > 0
               THEN ROUND(((r.harvest - p.harvest) / p.harvest * 100)::numeric, 1)
               ELSE NULL END AS yoy_change_pct
      FROM recent r
      LEFT JOIN prior p ON r.area_number = p.area_number
      ORDER BY r.area_number
    `, [species]);

    return NextResponse.json({
      byArea: harvestResult.rows,
      national: nationalResult.rows,
      yoyComparison: yoyResult.rows,
      species,
      months,
    });
  } catch (err) {
    console.error("[SEAFOOD HARVEST]", err);
    return NextResponse.json({ error: "Failed to fetch harvest data" }, { status: 500 });
  }
}
