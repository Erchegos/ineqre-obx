/**
 * Harvest Tracker — Vessels API
 * GET /api/seafood/harvest-tracker/vessels
 *
 * Returns all registered wellboats/harvest vessels.
 */
import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const result = await pool.query(`
      SELECT id, vessel_name, imo, mmsi, owner_company, operator_ticker,
             capacity_tonnes::float, vessel_type, built_year, is_active
      FROM harvest_vessels
      ORDER BY owner_company, vessel_name
    `);

    return NextResponse.json({
      vessels: result.rows,
      total: result.rows.length,
      withMmsi: result.rows.filter(v => v.mmsi).length,
    });
  } catch (err) {
    console.error("[HARVEST VESSELS]", err);
    return NextResponse.json({ error: "Failed to fetch vessels" }, { status: 500 });
  }
}
