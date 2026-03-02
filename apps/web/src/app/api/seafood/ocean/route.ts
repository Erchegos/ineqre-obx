/**
 * Seafood Ocean Conditions API
 * GET /api/seafood/ocean?weeks=52
 *
 * Returns sea temperature data aggregated by production area and week.
 * Data sourced from BarentsWatch lice reports, aggregated by fetch-ocean-conditions.ts.
 */

import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const weeks = parseInt(sp.get("weeks") || "52");

    // 1) Check data availability
    const countResult = await pool.query(`
      SELECT COUNT(*) as total FROM seafood_ocean_conditions
    `);
    const totalRows = parseInt(countResult.rows[0].total);

    if (totalRows === 0) {
      return NextResponse.json({
        heatmap: [],
        areaAverages: [],
        trends: [],
        message: "No ocean temperature data available yet. Data is aggregated from BarentsWatch lice reports.",
        weeks,
      });
    }

    // 2) Heatmap data: area × week matrix
    const heatmapResult = await pool.query(`
      SELECT area_number, year, week,
             avg_sea_temp::float, min_sea_temp::float, max_sea_temp::float,
             reporting_sites
      FROM seafood_ocean_conditions
      WHERE (year * 100 + week) >= (
        EXTRACT(YEAR FROM NOW())::int * 100 +
        EXTRACT(WEEK FROM NOW())::int - $1
      )
      ORDER BY year, week, area_number
    `, [weeks]);

    // 3) Area averages (overall mean temp per area)
    const avgResult = await pool.query(`
      SELECT area_number,
             ROUND(AVG(avg_sea_temp::numeric), 1) AS mean_temp,
             ROUND(MIN(min_sea_temp::numeric), 1) AS overall_min,
             ROUND(MAX(max_sea_temp::numeric), 1) AS overall_max,
             COUNT(*) AS data_weeks
      FROM seafood_ocean_conditions
      GROUP BY area_number
      ORDER BY area_number
    `);

    // 4) Recent trend (last 12 weeks, all areas)
    const trendResult = await pool.query(`
      SELECT area_number, year, week, avg_sea_temp::float
      FROM seafood_ocean_conditions
      WHERE (year * 100 + week) >= (
        EXTRACT(YEAR FROM NOW())::int * 100 +
        EXTRACT(WEEK FROM NOW())::int - 12
      )
      ORDER BY year, week, area_number
    `);

    return NextResponse.json({
      heatmap: heatmapResult.rows,
      areaAverages: avgResult.rows,
      trends: trendResult.rows,
      weeks,
    });
  } catch (err) {
    console.error("[SEAFOOD OCEAN]", err);
    return NextResponse.json({ error: "Failed to fetch ocean conditions" }, { status: 500 });
  }
}
