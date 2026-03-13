/**
 * Harvest Tracker — Slaughterhouses API
 * GET /api/seafood/harvest-tracker/slaughterhouses
 *
 * Returns all registered slaughterhouse/processing plant locations.
 */
import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const result = await pool.query(`
      SELECT s.id, s.name, s.company_name, s.ticker,
             s.lat::float, s.lng::float, s.municipality,
             s.production_area_number, s.capacity_tonnes_day::float, s.is_active,
             pa.name AS area_name, pa.traffic_light
      FROM harvest_slaughterhouses s
      LEFT JOIN seafood_production_areas pa ON s.production_area_number = pa.area_number
      WHERE s.is_active = true
      ORDER BY s.ticker, s.name
    `);

    return NextResponse.json({
      slaughterhouses: result.rows,
      total: result.rows.length,
    });
  } catch (err) {
    console.error("[HARVEST SLAUGHTERHOUSES]", err);
    return NextResponse.json({ error: "Failed to fetch slaughterhouses" }, { status: 500 });
  }
}
