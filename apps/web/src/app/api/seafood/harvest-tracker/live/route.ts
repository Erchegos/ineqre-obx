/**
 * Harvest Tracker — Live Vessel Positions API
 * GET /api/seafood/harvest-tracker/live
 *
 * Returns current positions of harvest vessels by joining
 * harvest_vessels with shipping_positions on MMSI or pseudo-IMO.
 */
import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // Try matching via harvest_vessel_positions (from AIS tracking), fallback to shipping_positions (pseudo-IMO)
    const result = await pool.query(`
      SELECT
        hv.id AS vessel_id,
        hv.vessel_name,
        hv.mmsi,
        hv.owner_company,
        hv.operator_ticker,
        hv.capacity_tonnes::float,
        hv.vessel_type,
        COALESCE(hvp.latitude, sp.latitude)::float AS lat,
        COALESCE(hvp.longitude, sp.longitude)::float AS lng,
        COALESCE(hvp.speed_knots, sp.speed_knots)::float AS speed_knots,
        COALESCE(hvp.heading, sp.heading) AS heading,
        sp.nav_status,
        sp.operational_status,
        COALESCE(hvp.timestamp, sp.reported_at) AS reported_at
      FROM harvest_vessels hv
      LEFT JOIN LATERAL (
        SELECT latitude, longitude, speed_knots, heading, timestamp
        FROM harvest_vessel_positions
        WHERE vessel_id = hv.id
        ORDER BY timestamp DESC
        LIMIT 1
      ) hvp ON true
      LEFT JOIN LATERAL (
        SELECT latitude, longitude, speed_knots, heading, nav_status, operational_status, reported_at
        FROM shipping_positions
        WHERE imo = 'HV-' || hv.id::text
        ORDER BY reported_at DESC
        LIMIT 1
      ) sp ON true
      WHERE hv.is_active = true
      ORDER BY hv.vessel_name
    `);

    // Classify vessel status based on operational_status from tracker
    const vessels = result.rows.map(v => ({
      ...v,
      status: v.operational_status || "unknown",
      hasPosition: v.lat != null,
    }));

    return NextResponse.json({
      vessels,
      total: vessels.length,
      withPosition: vessels.filter(v => v.hasPosition).length,
      atFarm: vessels.filter(v => v.status === "at_farm").length,
      inTransit: vessels.filter(v => v.status === "in_transit").length,
      atSlaughterhouse: vessels.filter(v => v.status === "at_slaughterhouse").length,
    });
  } catch (err) {
    console.error("[HARVEST LIVE]", err);
    return NextResponse.json({ error: "Failed to fetch live positions" }, { status: 500 });
  }
}
