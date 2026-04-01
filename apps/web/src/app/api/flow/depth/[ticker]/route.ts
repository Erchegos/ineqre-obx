import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const { ticker } = await params;
  const t = ticker.toUpperCase();

  try {
    // Latest snapshot + 5-min trailing history
    const { rows } = await pool.query(
      `SELECT ts, bid_prices, bid_sizes, bid_orders,
              ask_prices, ask_sizes, ask_orders,
              spread_bps::float, mid_price::float, book_imbalance::float
       FROM orderflow_depth_snapshots
       WHERE ticker = $1 AND ts > NOW() - INTERVAL '5 minutes'
       ORDER BY ts DESC
       LIMIT 60`,
      [t]
    );

    if (rows.length === 0) {
      return NextResponse.json(
        { error: "No depth data found", ticker: t },
        { status: 404 }
      );
    }

    return NextResponse.json({
      ticker: t,
      latest: rows[0],
      history: rows.reverse(),
      count: rows.length,
    });
  } catch (e: any) {
    console.error("[flow/depth] Error:", e);
    return NextResponse.json(
      { error: "Depth fetch failed", message: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
