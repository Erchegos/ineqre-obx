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

    // Null out positions that are clearly seed data (integer lat/lon = estimated, not AIS)
    // These vessels still appear in lists but won't render on the map
    const positions = result.rows.map((v) => {
      if (v.latitude == null || v.longitude == null) return v;
      const lat = Number(v.latitude);
      const lon = Number(v.longitude);
      const isRound = lat === Math.round(lat) && lon === Math.round(lon);
      if (!isRound) return v; // precise decimal coordinates = real AIS data
      // Round coords for moored/in_port vessels at known ports are likely OK
      const status = String(v.operational_status || v.nav_status || "");
      if (status === "in_port" || status === "loading" || status === "discharging") return v;
      // All other round-coordinate positions are unreliable seed data
      return { ...v, latitude: null, longitude: null };
    });

    return NextResponse.json({ positions });
  } catch (err) {
    console.error("[shipping/positions]", err);
    return NextResponse.json({ error: "Failed to fetch vessel positions" }, { status: 500 });
  }
}
