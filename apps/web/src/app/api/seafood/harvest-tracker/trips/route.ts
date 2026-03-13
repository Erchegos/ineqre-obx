/**
 * Harvest Tracker — Trips API
 * GET /api/seafood/harvest-tracker/trips?ticker=&days=90&area=&limit=500
 *
 * Returns detected harvest trips with price matching.
 */
import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const ticker = sp.get("ticker");
    const days = parseInt(sp.get("days") || "90");
    const area = sp.get("area");
    const limit = parseInt(sp.get("limit") || "500");

    const params: (string | number)[] = [days, limit];
    const conditions: string[] = [
      "t.departure_time >= (CURRENT_DATE - INTERVAL '1 day' * $1)"
    ];

    if (ticker) {
      params.push(ticker);
      conditions.push(`t.origin_ticker = $${params.length}`);
    }
    if (area) {
      params.push(parseInt(area));
      conditions.push(`t.production_area_number = $${params.length}`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const result = await pool.query(`
      SELECT t.id, t.vessel_name, t.origin_locality_id, t.origin_name, t.origin_ticker,
             t.destination_slaughterhouse_id, t.destination_name,
             t.departure_time, t.arrival_time, t.duration_hours::float,
             t.estimated_volume_tonnes::float,
             t.spot_price_at_harvest::float, t.production_area_number, t.status,
             sl.lat::float AS origin_lat, sl.lng::float AS origin_lng,
             hs.lat::float AS dest_lat, hs.lng::float AS dest_lng
      FROM harvest_trips t
      LEFT JOIN seafood_localities sl ON sl.locality_id = t.origin_locality_id
      LEFT JOIN harvest_slaughterhouses hs ON hs.id = t.destination_slaughterhouse_id
      ${whereClause}
      ORDER BY t.departure_time DESC
      LIMIT $2
    `, params);

    // Summary stats — build separate params without the LIMIT param
    const summaryParams: (string | number)[] = [days];
    const summaryConditions: string[] = [
      "departure_time >= (CURRENT_DATE - INTERVAL '1 day' * $1)"
    ];
    if (ticker) {
      summaryParams.push(ticker);
      summaryConditions.push(`origin_ticker = $${summaryParams.length}`);
    }
    if (area) {
      summaryParams.push(parseInt(area));
      summaryConditions.push(`production_area_number = $${summaryParams.length}`);
    }
    const summaryWhere = summaryConditions.length > 0 ? `WHERE ${summaryConditions.join(" AND ")}` : "";

    const summary = await pool.query(`
      SELECT
        COUNT(*)::int AS total_trips,
        COALESCE(SUM(estimated_volume_tonnes), 0)::float AS total_volume,
        AVG(spot_price_at_harvest)::float AS avg_price,
        AVG(duration_hours)::float AS avg_duration
      FROM harvest_trips
      ${summaryWhere}
    `, summaryParams);

    return NextResponse.json({
      trips: result.rows,
      summary: summary.rows[0] || { total_trips: 0, total_volume: 0, avg_price: null, avg_duration: null },
      days,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[HARVEST TRIPS]", msg, err);
    return NextResponse.json({ error: "Failed to fetch trips", detail: msg }, { status: 500 });
  }
}
