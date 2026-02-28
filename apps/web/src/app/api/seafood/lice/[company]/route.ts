/**
 * Per-Company Lice Data API
 * GET /api/seafood/lice/[company]?weeks=12
 */

import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ company: string }> }
) {
  try {
    const { company } = await params;
    const ticker = company.toUpperCase();
    const weeks = parseInt(req.nextUrl.searchParams.get("weeks") || "12");

    // Get all localities for this company
    const localitiesResult = await pool.query(`
      SELECT locality_id, name, lat::float, lng::float, production_area_number
      FROM seafood_localities
      WHERE upper(ticker) = $1 AND is_active = true
    `, [ticker]);

    if (localitiesResult.rows.length === 0) {
      return NextResponse.json({ error: "No localities found for ticker" }, { status: 404 });
    }

    const localityIds = localitiesResult.rows.map(r => r.locality_id);

    // Lice reports for these localities
    const liceResult = await pool.query(`
      SELECT
        lr.locality_id,
        lr.year,
        lr.week,
        lr.avg_adult_female_lice::float AS avg_lice,
        lr.avg_mobile_lice::float AS avg_mobile,
        lr.sea_temperature::float AS sea_temp,
        lr.has_cleaning,
        lr.has_mechanical_removal,
        lr.has_medicinal_treatment
      FROM seafood_lice_reports lr
      WHERE lr.locality_id = ANY($1::int[])
      ORDER BY lr.year DESC, lr.week DESC
      LIMIT $2
    `, [localityIds, weeks * localityIds.length]);

    // Aggregate weekly
    const weekMap = new Map<string, { lice: number[]; temps: number[]; treatments: number }>();
    for (const r of liceResult.rows) {
      const key = `${r.year}-W${String(r.week).padStart(2, "0")}`;
      if (!weekMap.has(key)) weekMap.set(key, { lice: [], temps: [], treatments: 0 });
      const entry = weekMap.get(key)!;
      if (r.avg_lice != null) entry.lice.push(r.avg_lice);
      if (r.sea_temp != null) entry.temps.push(r.sea_temp);
      if (r.has_cleaning || r.has_mechanical_removal || r.has_medicinal_treatment) entry.treatments++;
    }

    const weeklyAvg = Array.from(weekMap.entries())
      .map(([week, data]) => ({
        week,
        avgLice: data.lice.length > 0 ? data.lice.reduce((a, b) => a + b, 0) / data.lice.length : null,
        avgTemp: data.temps.length > 0 ? data.temps.reduce((a, b) => a + b, 0) / data.temps.length : null,
        treatments: data.treatments,
        siteCount: data.lice.length,
      }))
      .sort((a, b) => a.week.localeCompare(b.week));

    return NextResponse.json({
      ticker,
      localities: localitiesResult.rows,
      weekly: weeklyAvg,
      totalSites: localitiesResult.rows.length,
    });
  } catch (err) {
    console.error("[COMPANY LICE]", err);
    return NextResponse.json({ error: "Failed to fetch company lice data" }, { status: 500 });
  }
}
