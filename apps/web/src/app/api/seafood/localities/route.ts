/**
 * Localities API
 * GET /api/seafood/localities
 *
 * Returns all fish farm localities with latest lice count and coordinates
 */

import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const result = await pool.query(`
      SELECT
        sl.locality_id,
        sl.name,
        sl.company_name,
        sl.ticker,
        sl.municipality_name,
        sl.production_area_number,
        sl.lat::float,
        sl.lng::float,
        sl.has_biomass,
        lr.avg_adult_female_lice::float AS latest_lice,
        lr.sea_temperature::float AS latest_temp,
        lr.year AS lice_year,
        lr.week AS lice_week
      FROM seafood_localities sl
      LEFT JOIN LATERAL (
        SELECT avg_adult_female_lice, sea_temperature, year, week
        FROM seafood_lice_reports
        WHERE locality_id = sl.locality_id
        ORDER BY year DESC, week DESC
        LIMIT 1
      ) lr ON true
      WHERE sl.is_active = true AND sl.lat IS NOT NULL AND sl.lng IS NOT NULL
      ORDER BY sl.production_area_number ASC, sl.name ASC
    `);

    return NextResponse.json({
      localities: result.rows.map(r => ({
        localityId: r.locality_id,
        name: r.name,
        companyName: r.company_name,
        ticker: r.ticker,
        municipality: r.municipality_name,
        productionArea: r.production_area_number,
        lat: r.lat,
        lng: r.lng,
        hasBiomass: r.has_biomass,
        latestLice: r.latest_lice,
        latestTemp: r.latest_temp,
        liceWeek: r.lice_year && r.lice_week ? `${r.lice_year}-W${String(r.lice_week).padStart(2, "0")}` : null,
      })),
      count: result.rows.length,
    });
  } catch (err) {
    console.error("[SEAFOOD LOCALITIES]", err);
    return NextResponse.json({ error: "Failed to fetch localities" }, { status: 500 });
  }
}
