/**
 * Disease Outbreaks API
 * GET /api/seafood/diseases
 *
 * Returns PD (Pancreas Disease) and ILA (Infectious Salmon Anaemia) outbreaks
 * aggregated from lice report data (has_pd, has_ila flags).
 */

import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    // Get the latest week in the dataset to determine "active"
    const latestWeekRes = await pool.query(`
      SELECT year, week FROM seafood_lice_reports
      ORDER BY year DESC, week DESC LIMIT 1
    `);
    const latestYear = latestWeekRes.rows[0]?.year;
    const latestWeek = latestWeekRes.rows[0]?.week;

    // Find all localities with PD or ILA outbreaks, aggregate weeks active
    const result = await pool.query(`
      WITH disease_reports AS (
        -- PD outbreaks
        SELECT
          lr.locality_id,
          'PD' AS disease,
          lr.year,
          lr.week,
          ROW_NUMBER() OVER (PARTITION BY lr.locality_id ORDER BY lr.year DESC, lr.week DESC) AS rn
        FROM seafood_lice_reports lr
        WHERE lr.has_pd = true
        UNION ALL
        -- ILA outbreaks
        SELECT
          lr.locality_id,
          'ILA' AS disease,
          lr.year,
          lr.week,
          ROW_NUMBER() OVER (PARTITION BY lr.locality_id ORDER BY lr.year DESC, lr.week DESC) AS rn
        FROM seafood_lice_reports lr
        WHERE lr.has_ila = true
      ),
      outbreak_summary AS (
        SELECT
          dr.locality_id,
          dr.disease,
          count(*)::int AS weeks_active,
          max(dr.year * 100 + dr.week) AS latest_yearweek,
          max(dr.year) FILTER (WHERE dr.rn = 1) AS latest_year,
          max(dr.week) FILTER (WHERE dr.rn = 1) AS latest_week
        FROM disease_reports dr
        GROUP BY dr.locality_id, dr.disease
      )
      SELECT
        os.locality_id,
        os.disease,
        os.weeks_active,
        os.latest_year,
        os.latest_week,
        sl.name AS locality_name,
        sl.ticker,
        sl.production_area_number AS area,
        spa.name AS area_name,
        CASE WHEN os.latest_year = $1 AND os.latest_week = $2 THEN true ELSE false END AS is_active
      FROM outbreak_summary os
      JOIN seafood_localities sl ON sl.locality_id = os.locality_id
      LEFT JOIN seafood_production_areas spa ON spa.area_number = sl.production_area_number
      ORDER BY
        (CASE WHEN os.latest_year = $1 AND os.latest_week = $2 THEN 0 ELSE 1 END),
        os.disease,
        os.weeks_active DESC
    `, [latestYear, latestWeek]);

    return NextResponse.json({
      outbreaks: result.rows.map(r => ({
        localityId: r.locality_id,
        localityName: r.locality_name,
        ticker: r.ticker,
        area: r.area,
        areaName: r.area_name,
        disease: r.disease,
        weeksActive: r.weeks_active,
        latestWeek: `${r.latest_year}-W${String(r.latest_week).padStart(2, "0")}`,
        isActive: r.is_active,
      })),
      summary: {
        pd: {
          total: result.rows.filter(r => r.disease === "PD").length,
          active: result.rows.filter(r => r.disease === "PD" && r.is_active).length,
        },
        ila: {
          total: result.rows.filter(r => r.disease === "ILA").length,
          active: result.rows.filter(r => r.disease === "ILA" && r.is_active).length,
        },
      },
      latestWeek: latestYear && latestWeek ? `${latestYear}-W${String(latestWeek).padStart(2, "0")}` : null,
    });
  } catch (err) {
    console.error("[SEAFOOD DISEASES]", err);
    return NextResponse.json({ error: "Failed to fetch disease data" }, { status: 500 });
  }
}
