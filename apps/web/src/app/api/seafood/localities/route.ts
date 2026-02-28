/**
 * Localities API
 * GET /api/seafood/localities
 *
 * Returns all fish farm localities with latest lice count, coordinates, and
 * production area name. Includes inactive sites (without lice data) so the
 * map shows the full coastal picture.
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
        sl.is_active,
        spa.name AS area_name,
        spa.traffic_light,
        lr.avg_adult_female_lice::float AS latest_lice,
        lr.avg_mobile_lice::float AS latest_mobile,
        lr.avg_stationary_lice::float AS latest_stationary,
        lr.sea_temperature::float AS latest_temp,
        lr.has_cleaning,
        lr.has_mechanical_removal,
        lr.has_medicinal_treatment,
        lr.year AS lice_year,
        lr.week AS lice_week
      FROM seafood_localities sl
      LEFT JOIN seafood_production_areas spa
        ON spa.area_number = sl.production_area_number
      LEFT JOIN LATERAL (
        -- Prefer the latest report WITH actual lice data;
        -- fallow sites report NULL lice, which makes dots gray.
        -- Fall back to absolute latest if no report has lice data.
        (SELECT avg_adult_female_lice, avg_mobile_lice, avg_stationary_lice,
                sea_temperature, has_cleaning, has_mechanical_removal,
                has_medicinal_treatment, year, week
         FROM seafood_lice_reports
         WHERE locality_id = sl.locality_id
           AND avg_adult_female_lice IS NOT NULL
         ORDER BY year DESC, week DESC
         LIMIT 1)
        UNION ALL
        (SELECT avg_adult_female_lice, avg_mobile_lice, avg_stationary_lice,
                sea_temperature, has_cleaning, has_mechanical_removal,
                has_medicinal_treatment, year, week
         FROM seafood_lice_reports
         WHERE locality_id = sl.locality_id
         ORDER BY year DESC, week DESC
         LIMIT 1)
        LIMIT 1
      ) lr ON true
      WHERE sl.lat IS NOT NULL AND sl.lng IS NOT NULL
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
        areaName: r.area_name,
        areaTrafficLight: r.traffic_light,
        lat: r.lat,
        lng: r.lng,
        hasBiomass: r.has_biomass,
        isActive: r.is_active,
        latestLice: r.latest_lice,
        latestMobile: r.latest_mobile,
        latestStationary: r.latest_stationary,
        latestTemp: r.latest_temp,
        hasCleaning: r.has_cleaning,
        hasMechanicalRemoval: r.has_mechanical_removal,
        hasMedicinalTreatment: r.has_medicinal_treatment,
        liceWeek: r.lice_year && r.lice_week ? `${r.lice_year}-W${String(r.lice_week).padStart(2, "0")}` : null,
      })),
      count: result.rows.length,
    });
  } catch (err) {
    console.error("[SEAFOOD LOCALITIES]", err);
    return NextResponse.json({ error: "Failed to fetch localities" }, { status: 500 });
  }
}
