/**
 * Shipping Vessel Positions API
 * GET /api/shipping/positions?ticker=FRO&sector=tanker
 *
 * Returns all active vessel positions for the fleet map.
 * Single optimized query with LATERAL joins.
 * Land/sea filter uses Natural Earth 110m coastline polygons.
 */

import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { isOnWater } from "@/lib/landCheck";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

    // Filter out vessels on land using Natural Earth coastline polygons
    const positions = result.rows.map((row) => {
      if (row.latitude != null && row.longitude != null) {
        const lat = Number(row.latitude);
        const lon = Number(row.longitude);
        if (!isOnWater(lat, lon)) {
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
