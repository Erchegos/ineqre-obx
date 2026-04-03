import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/flow/dates?ticker=EQNR
 * Returns distinct dates that have tick data for a given ticker, in Oslo local time.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const ticker = (searchParams.get("ticker") || "EQNR").toUpperCase();

  try {
    const { rows } = await pool.query(
      `SELECT DISTINCT (ts AT TIME ZONE 'Europe/Oslo')::date::text AS date,
              COUNT(*)::int AS tick_count
       FROM orderflow_ticks
       WHERE ticker = $1
       GROUP BY 1
       ORDER BY 1 DESC
       LIMIT 30`,
      [ticker]
    );
    return NextResponse.json({ ticker, dates: rows });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}
