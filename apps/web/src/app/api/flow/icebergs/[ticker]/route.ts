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
  const days = Math.min(parseInt(searchParams.get("days") || "5", 10), 90);

  try {
    const { rows } = await pool.query(
      `SELECT detected_at, start_ts, end_ts, direction,
              total_volume, trade_count,
              avg_trade_size::float, size_cv::float, vwap::float,
              est_block_pct::float, detection_method, confidence::float,
              features
       FROM orderflow_iceberg_detections
       WHERE ticker = $1 AND detected_at > NOW() - ($2 || ' days')::interval
       ORDER BY detected_at DESC`,
      [t, String(days)]
    );

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
