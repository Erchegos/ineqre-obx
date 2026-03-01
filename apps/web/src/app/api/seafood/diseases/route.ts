/**
 * Disease Outbreaks API
 * GET /api/seafood/diseases
 *
 * Returns PD (Pancreas Disease) and ILA (Infectious Salmon Anaemia) outbreaks
 * from lice report data (has_pd, has_ila flags).
 *
 * Note: BarentsWatch disease flags are cumulative — once set on a locality,
 * they remain true until the site is officially cleared by Mattilsynet.
 * We determine "active" by checking the latest week's flag, and show
 * the earliest detection date in our data window.
 */

import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    // Get the latest 2 weeks in the dataset to determine "active" vs "cleared"
    const latestWeekRes = await pool.query(`
      SELECT year, week FROM seafood_lice_reports
      ORDER BY year DESC, week DESC LIMIT 1
    `);
    const latestYear = latestWeekRes.rows[0]?.year;
    const latestWeek = latestWeekRes.rows[0]?.week;

    // Find all localities with PD or ILA, with first/last detection and locality coords
    const result = await pool.query(`
      WITH disease_flags AS (
        SELECT
          lr.locality_id,
          'ILA' AS disease,
          min(lr.year * 100 + lr.week) AS first_yearweek,
          max(lr.year * 100 + lr.week) AS last_yearweek,
          count(*)::int AS weeks_flagged,
          bool_or(lr.year = $1 AND lr.week = $2) AS in_latest_week
        FROM seafood_lice_reports lr
        WHERE lr.has_ila = true
        GROUP BY lr.locality_id
        UNION ALL
        SELECT
          lr.locality_id,
          'PD' AS disease,
          min(lr.year * 100 + lr.week) AS first_yearweek,
          max(lr.year * 100 + lr.week) AS last_yearweek,
          count(*)::int AS weeks_flagged,
          bool_or(lr.year = $1 AND lr.week = $2) AS in_latest_week
        FROM seafood_lice_reports lr
        WHERE lr.has_pd = true
        GROUP BY lr.locality_id
      )
      SELECT
        df.locality_id,
        df.disease,
        df.weeks_flagged,
        df.first_yearweek,
        df.last_yearweek,
        df.in_latest_week,
        sl.name AS locality_name,
        sl.ticker,
        sl.company_name,
        sl.production_area_number AS area,
        sl.lat,
        sl.lng,
        spa.name AS area_name
      FROM disease_flags df
      JOIN seafood_localities sl ON sl.locality_id = df.locality_id
      LEFT JOIN seafood_production_areas spa ON spa.area_number = sl.production_area_number
      ORDER BY
        df.disease,
        df.in_latest_week DESC,
        sl.production_area_number,
        sl.name
    `, [latestYear, latestWeek]);

    // Helper to convert yearweek int (202510) to "2025-W10" string
    const fmtYW = (yw: number) => {
      const y = Math.floor(yw / 100);
      const w = yw % 100;
      return `${y}-W${String(w).padStart(2, "0")}`;
    };

    const outbreaks = result.rows.map(r => ({
      localityId: r.locality_id,
      localityName: r.locality_name,
      ticker: r.ticker,
      companyName: r.company_name,
      area: r.area,
      areaName: r.area_name,
      lat: r.lat ? parseFloat(r.lat) : null,
      lng: r.lng ? parseFloat(r.lng) : null,
      disease: r.disease,
      weeksFlagged: r.weeks_flagged,
      firstDetected: fmtYW(r.first_yearweek),
      lastDetected: fmtYW(r.last_yearweek),
      isActive: r.in_latest_week,
    }));

    return NextResponse.json({
      outbreaks,
      summary: {
        pd: {
          total: outbreaks.filter(r => r.disease === "PD").length,
          active: outbreaks.filter(r => r.disease === "PD" && r.isActive).length,
        },
        ila: {
          total: outbreaks.filter(r => r.disease === "ILA").length,
          active: outbreaks.filter(r => r.disease === "ILA" && r.isActive).length,
        },
      },
      latestWeek: latestYear && latestWeek ? `${latestYear}-W${String(latestWeek).padStart(2, "0")}` : null,
    });
  } catch (err) {
    console.error("[SEAFOOD DISEASES]", err);
    return NextResponse.json({ error: "Failed to fetch disease data" }, { status: 500 });
  }
}
