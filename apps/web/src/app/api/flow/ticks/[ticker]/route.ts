import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const { ticker } = await params;
  const t = ticker.toUpperCase();
  const { searchParams } = new URL(request.url);
  const limit = Math.min(parseInt(searchParams.get("limit") || "20000", 10), 30000);
  // date param (YYYY-MM-DD) fetches all ticks for that day (Oslo date)
  const date = searchParams.get("date");
  // fallback: minutes from now
  const minutes = parseInt(searchParams.get("minutes") || "60", 10);

  try {
    let rows: any[];

    if (date) {
      // Fetch all ticks where Oslo local date matches (Oslo = UTC+1/+2)
      const result = await pool.query(
        `SELECT ts, price::float, size, side
         FROM orderflow_ticks
         WHERE ticker = $1
           AND (ts AT TIME ZONE 'Europe/Oslo')::date = $2::date
         ORDER BY ts ASC
         LIMIT $3`,
        [t, date, limit]
      );
      rows = result.rows;
    } else {
      // Latest N ticks from recent window
      const result = await pool.query(
        `SELECT ts, price::float, size, side
         FROM orderflow_ticks
         WHERE ticker = $1 AND ts > NOW() - ($2 || ' minutes')::interval
         ORDER BY ts DESC
         LIMIT $3`,
        [t, String(minutes), limit]
      );
      rows = result.rows.reverse();
    }

    return NextResponse.json({
      ticker: t,
      count: rows.length,
      ticks: rows,
    });
  } catch (e: any) {
    console.error("[flow/ticks] Error:", e);
    return NextResponse.json(
      { error: "Ticks fetch failed", message: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
