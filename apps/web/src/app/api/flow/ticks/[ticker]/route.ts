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
  const limit = Math.min(parseInt(searchParams.get("limit") || "60000", 10), 100000);
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

    // Fetch previous trading day close for reference
    let prevClose: number | null = null;
    try {
      const refDate = date || new Date().toISOString().slice(0, 10);
      const pcRes = await pool.query(
        `SELECT close::float FROM prices_daily
         WHERE upper(ticker) = $1 AND date < $2::date AND close IS NOT NULL
         ORDER BY date DESC LIMIT 1`,
        [t, refDate]
      );
      if (pcRes.rows.length > 0) prevClose = pcRes.rows[0].close;
    } catch { /* non-critical */ }

    return NextResponse.json({
      ticker: t,
      count: rows.length,
      prevClose,
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
