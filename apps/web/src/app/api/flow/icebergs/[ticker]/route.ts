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
  // If a specific date is provided (YYYY-MM-DD Oslo local date), filter by that day's start_ts
  const date = searchParams.get("date"); // YYYY-MM-DD in Oslo time
  const days = Math.min(parseInt(searchParams.get("days") || "90", 10), 365);

  try {
    let rows: any[];
    if (date) {
      // Filter by start_ts falling on the given Oslo calendar date
      const { rows: r } = await pool.query(
        `SELECT detected_at, start_ts, end_ts, direction,
                total_volume, trade_count,
                avg_trade_size::float, median_trade_size::float,
                price_range_bps::float, vwap::float,
                est_block_pct::float, detection_method, confidence::float
         FROM orderflow_iceberg_detections
         WHERE ticker = $1
           AND (start_ts AT TIME ZONE 'Europe/Oslo')::date = $2::date
         ORDER BY start_ts ASC`,
        [t, date]
      );
      rows = r;
    } else {
      const { rows: r } = await pool.query(
        `SELECT detected_at, start_ts, end_ts, direction,
                total_volume, trade_count,
                avg_trade_size::float, median_trade_size::float,
                price_range_bps::float, vwap::float,
                est_block_pct::float, detection_method, confidence::float
         FROM orderflow_iceberg_detections
         WHERE ticker = $1
           AND start_ts > NOW() - ($2 || ' days')::interval
         ORDER BY start_ts DESC`,
        [t, String(days)]
      );
      rows = r;
    }

    return NextResponse.json({
      ticker: t,
      days,
      count: rows.length,
      detections: rows,
    });
  } catch (e: any) {
    console.error("[flow/icebergs] Error:", e);
    return NextResponse.json(
      { error: "Icebergs fetch failed", message: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
