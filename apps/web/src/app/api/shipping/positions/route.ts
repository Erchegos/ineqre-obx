/**
 * Shipping Vessel Positions API
 * GET /api/shipping/positions?ticker=FRO&sector=tanker
 *
 * Returns all active vessel positions for the fleet map.
 * Single optimized query with LATERAL joins.
 */

import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Land/sea validation — must match fix-vessel-positions.ts logic
const LAND_BOXES: [number, number, number, number][] = [
  [42, 72, -10, 40],    // Europe interior
  [-35, 37, -18, 52],   // Africa
  [10, 55, 25, 130],    // Asia mainland
  [-40, -10, 113, 154], // Australia
  [15, 72, -170, -52],  // North America
  [-56, 13, -82, -34],  // South America
  [8, 35, 68, 90],      // India
  [12, 38, 34, 60],     // Arabia
  [-8, 7, 95, 120],     // SE Asia islands
];
const WATER_CORRIDORS: [number, number, number, number][] = [
  [30, 46, -6, 37],     // Mediterranean
  [12, 30, 32, 44],     // Red Sea
  [24, 30.5, 47, 51],   // Inner Persian Gulf
  [23.5, 27, 51, 56.5], // Strait of Hormuz
  [23, 26, 56.5, 60],   // Gulf of Oman
  [50, 72, -5, 12],     // North Sea
  [53, 66, 9, 30],      // Baltic
  [18, 31, -98, -80],   // Gulf of Mexico
  [8, 23, -90, -58],    // Caribbean
  [24, 52, 120, 145],   // Sea of Japan
  [0, 25, 105, 122],    // South China Sea
  [5, 23, 78, 95],      // Bay of Bengal
  [5, 25, 57, 78],      // Arabian Sea
  [-5, 8, -10, 12],     // Gulf of Guinea
  [-27, -10, 30, 50],   // Mozambique Channel
  [40, 47, 27, 42],     // Black Sea
  [-10, 5, 95, 140],    // Indonesian waters
  [-25, -5, 140, 165],  // Torres Strait
  [48, 52, -6, 3],      // English Channel
  [10, 50, -82, -55],   // East coast Americas
  [-56, 60, -130, -115],// West coast Americas
  [42, 55, -80, -55],   // Hudson Bay
  [-2, 8, 95, 106],     // Malacca
];
function isLikelyWater(lat: number, lon: number): boolean {
  for (const [a, b, c, d] of WATER_CORRIDORS) {
    if (lat >= a && lat <= b && lon >= c && lon <= d) return true;
  }
  for (const [a, b, c, d] of LAND_BOXES) {
    if (lat >= a && lat <= b && lon >= c && lon <= d) return false;
  }
  return true;
}

export async function GET(request: NextRequest) {
  try {
    const ticker = request.nextUrl.searchParams.get("ticker");
    const sector = request.nextUrl.searchParams.get("sector");

    const params: string[] = [];
    const conditions: string[] = ["v.status = 'active'"];

    if (ticker) {
      params.push(ticker.toUpperCase());
      conditions.push(`v.company_ticker = $${params.length}`);
    }
    if (sector) {
      params.push(sector);
      conditions.push(`sc.sector = $${params.length}`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const result = await pool.query(`
      SELECT
        v.imo,
        v.vessel_name,
        v.vessel_type,
        v.company_ticker,
        v.dwt,
        v.teu,
        v.cbm,
        v.built_year,
        v.status,
        v.vessel_class,
        p.latitude::float,
        p.longitude::float,
        p.speed_knots::float,
        p.heading,
        p.course,
        p.destination,
        p.destination_port_name,
        p.eta,
        p.nav_status,
        p.operational_status,
        p.current_region,
        p.reported_at,
        c.contract_type,
        c.rate_usd_per_day::float,
        c.rate_worldscale::float,
        c.charterer,
        c.contract_start,
        c.contract_end,
        sc.company_name,
        sc.sector,
        sc.color_hex
      FROM shipping_vessels v
      LEFT JOIN LATERAL (
        SELECT *
        FROM shipping_positions sp
        WHERE sp.imo = v.imo
        ORDER BY sp.reported_at DESC
        LIMIT 1
      ) p ON true
      LEFT JOIN shipping_vessel_contracts c
        ON c.imo = v.imo AND c.is_current = true
      JOIN shipping_companies sc
        ON sc.ticker = v.company_ticker
      ${whereClause}
      ORDER BY sc.company_name ASC, v.vessel_name ASC
    `, params);

    // Filter out vessels on land — null their coordinates so they don't render on map
    const positions = result.rows.map((row) => {
      if (row.latitude != null && row.longitude != null) {
        const lat = Number(row.latitude);
        const lon = Number(row.longitude);
        if (!isLikelyWater(lat, lon)) {
          // Vessel appears to be on land — hide from map
          return { ...row, latitude: null, longitude: null };
        }
      }
      return row;
    });

    return NextResponse.json({ positions });
  } catch (err) {
    console.error("[shipping/positions]", err);
    return NextResponse.json({ error: "Failed to fetch vessel positions" }, { status: 500 });
  }
}
