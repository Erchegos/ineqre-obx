/**
 * Lice Data API
 * GET /api/seafood/lice?weeks=26
 *
 * Returns aggregated lice data by production area and week
 */

import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const weeks = parseInt(req.nextUrl.searchParams.get("weeks") || "26");

    // Get current year/week for limit calculation
    const now = new Date();
    const startOfYear = new Date(now.getFullYear(), 0, 1);
    const currentWeek = Math.ceil(((now.getTime() - startOfYear.getTime()) / 86400000 + startOfYear.getDay() + 1) / 7);
    const currentYear = now.getFullYear();

    // Aggregated lice by week (industry average)
    const weeklyResult = await pool.query(`
      SELECT
        lr.year,
        lr.week,
        avg(lr.avg_adult_female_lice::float) AS avg_lice,
        avg(lr.avg_mobile_lice::float) AS avg_mobile,
        avg(lr.sea_temperature::float) AS avg_temp,
        count(*)::int AS report_count,
        count(*) FILTER (WHERE lr.avg_adult_female_lice::float > 0.5)::int AS above_threshold
      FROM seafood_lice_reports lr
      GROUP BY lr.year, lr.week
      ORDER BY lr.year DESC, lr.week DESC
      LIMIT $1
    `, [weeks]);

    // By production area (latest week only)
    const areaResult = await pool.query(`
      SELECT
        sl.production_area_number AS area,
        spa.name AS area_name,
        spa.traffic_light,
        avg(lr.avg_adult_female_lice::float) AS avg_lice,
        count(*)::int AS site_count
      FROM seafood_lice_reports lr
      JOIN seafood_localities sl ON sl.locality_id = lr.locality_id
      JOIN seafood_production_areas spa ON spa.area_number = sl.production_area_number
      WHERE (lr.year, lr.week) = (
        SELECT year, week FROM seafood_lice_reports ORDER BY year DESC, week DESC LIMIT 1
      )
      GROUP BY sl.production_area_number, spa.name, spa.traffic_light
      ORDER BY sl.production_area_number
    `);

    return NextResponse.json({
      weekly: weeklyResult.rows.reverse().map(r => ({
        year: r.year,
        week: r.week,
        avgLice: r.avg_lice,
        avgMobile: r.avg_mobile,
        avgTemp: r.avg_temp,
        reportCount: r.report_count,
        aboveThreshold: r.above_threshold,
      })),
      byArea: areaResult.rows.map(r => ({
        area: r.area,
        areaName: r.area_name,
        trafficLight: r.traffic_light,
        avgLice: r.avg_lice,
        siteCount: r.site_count,
      })),
      threshold: 0.5,
    });
  } catch (err) {
    console.error("[SEAFOOD LICE]", err);
    return NextResponse.json({ error: "Failed to fetch lice data" }, { status: 500 });
  }
}
