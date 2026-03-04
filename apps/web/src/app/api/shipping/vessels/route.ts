/**
 * Shipping Vessels List API
 * GET /api/shipping/vessels?ticker=FRO&sector=tanker&status=active
 *
 * Returns vessel list with contract info (no position data).
 */

import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const ticker = request.nextUrl.searchParams.get("ticker");
    const sector = request.nextUrl.searchParams.get("sector");
    const status = request.nextUrl.searchParams.get("status");

    const params: string[] = [];
    const conditions: string[] = [];

    if (ticker) {
      params.push(ticker.toUpperCase());
      conditions.push(`v.company_ticker = $${params.length}`);
    }
    if (sector) {
      params.push(sector);
      conditions.push(`sc.sector = $${params.length}`);
    }
    if (status) {
      params.push(status);
      conditions.push(`v.status = $${params.length}`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const result = await pool.query(`
      SELECT
        v.imo,
        v.vessel_name,
        v.vessel_type,
        v.vessel_class,
        v.company_ticker,
        v.dwt,
        v.teu,
        v.cbm,
        v.built_year,
        v.flag,
        v.status,
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
      LEFT JOIN shipping_vessel_contracts c
        ON c.imo = v.imo AND c.is_current = true
      JOIN shipping_companies sc
        ON sc.ticker = v.company_ticker
      ${whereClause}
      ORDER BY sc.company_name ASC, v.vessel_name ASC
    `, params);

    return NextResponse.json({
      vessels: result.rows,
    });
  } catch (err) {
    console.error("[shipping/vessels]", err);
    return NextResponse.json({ error: "Failed to fetch vessels" }, { status: 500 });
  }
}
