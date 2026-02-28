/**
 * Production Areas API
 * GET /api/seafood/production-areas
 *
 * Returns 13 Norwegian aquaculture production areas with traffic light status
 */

import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const result = await pool.query(`
      SELECT
        spa.area_number,
        spa.name,
        spa.traffic_light,
        spa.decision_date,
        spa.capacity_change_pct::float,
        spa.center_lat::float,
        spa.center_lng::float,
        spa.notes,
        spa.boundary_geojson,
        count(sl.id)::int AS locality_count,
        avg(slr.avg_adult_female_lice::float) AS avg_lice
      FROM seafood_production_areas spa
      LEFT JOIN seafood_localities sl ON sl.production_area_number = spa.area_number AND sl.is_active = true
      LEFT JOIN LATERAL (
        SELECT avg_adult_female_lice
        FROM seafood_lice_reports lr
        WHERE lr.locality_id = sl.locality_id
        ORDER BY lr.year DESC, lr.week DESC
        LIMIT 1
      ) slr ON true
      GROUP BY spa.id
      ORDER BY spa.area_number ASC
    `);

    return NextResponse.json({
      areas: result.rows.map(r => ({
        areaNumber: r.area_number,
        name: r.name,
        trafficLight: r.traffic_light,
        decisionDate: r.decision_date,
        capacityChangePct: r.capacity_change_pct,
        centerLat: r.center_lat,
        centerLng: r.center_lng,
        notes: r.notes,
        boundaryGeoJson: r.boundary_geojson,
        localityCount: r.locality_count,
        avgLice: r.avg_lice,
      })),
    });
  } catch (err) {
    console.error("[PRODUCTION AREAS]", err);
    return NextResponse.json({ error: "Failed to fetch production areas" }, { status: 500 });
  }
}
