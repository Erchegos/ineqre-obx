/**
 * Disease Outbreaks API
 * GET /api/seafood/diseases
 *
 * Returns PD (Pancreas Disease) and ILA (Infectious Salmon Anaemia) outbreaks
 * from lice report data (has_pd, has_ila flags).
 *
 * Note: BarentsWatch disease flags are cumulative — once set on a locality,
 * they remain true until the site is officially cleared by Mattilsynet.
 * If a flag has been set for ALL weeks in our data window, the outbreak
 * predates our data — we mark it as such instead of showing a misleading date.
 */

import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    // Get the latest week and total distinct weeks in our data
    const metaRes = await pool.query(`
      SELECT
        max(year) FILTER (WHERE (year*100+week) = (SELECT max(year*100+week) FROM seafood_lice_reports)) AS latest_year,
        max(week) FILTER (WHERE (year*100+week) = (SELECT max(year*100+week) FROM seafood_lice_reports)) AS latest_week,
        min(year*100+week) AS earliest_yearweek,
        count(DISTINCT year*100+week)::int AS total_weeks
      FROM seafood_lice_reports
    `);
    const latestYear = metaRes.rows[0]?.latest_year;
    const latestWeek = metaRes.rows[0]?.latest_week;
    const earliestYW = metaRes.rows[0]?.earliest_yearweek;
    const totalWeeks = metaRes.rows[0]?.total_weeks ?? 0;

    // Find all localities with PD or ILA
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

    const fmtYW = (yw: number) => {
      const y = Math.floor(yw / 100);
      const w = yw % 100;
      return `${y}-W${String(w).padStart(2, "0")}`;
    };

    const outbreaks = result.rows.map(r => {
      // If flagged for ALL weeks, the outbreak predates our data window
      const predatesWindow = r.weeks_flagged >= totalWeeks;
      return {
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
        firstDetected: predatesWindow ? null : fmtYW(r.first_yearweek),
        lastDetected: fmtYW(r.last_yearweek),
        isActive: r.in_latest_week,
        predatesWindow,
      };
    });

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
      dataWindow: {
        earliest: earliestYW ? fmtYW(earliestYW) : null,
        totalWeeks,
      },
      latestWeek: latestYear && latestWeek ? `${latestYear}-W${String(latestWeek).padStart(2, "0")}` : null,
    });
  } catch (err) {
    console.error("[SEAFOOD DISEASES]", err);
    return NextResponse.json({ error: "Failed to fetch disease data" }, { status: 500 });
  }
}
