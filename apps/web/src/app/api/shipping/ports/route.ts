/**
 * Shipping Ports Reference API
 * GET /api/shipping/ports
 *
 * Returns all port reference data.
 */

import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const result = await pool.query(`
      SELECT
        id,
        port_name,
        country,
        region,
        latitude::float,
        longitude::float,
        port_type,
        unlocode
      FROM shipping_ports
      ORDER BY port_name ASC
    `);

    return NextResponse.json({
      ports: result.rows,
    });
  } catch (err) {
    console.error("[shipping/ports]", err);
    return NextResponse.json({ error: "Failed to fetch ports" }, { status: 500 });
  }
}
