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
  const barType = searchParams.get("bar_type") || "time_5m";
  const date = searchParams.get("date"); // YYYY-MM-DD
  const limit = Math.min(parseInt(searchParams.get("limit") || "500", 10), 2000);

  try {
    let query: string;
    let queryParams: any[];

    if (date) {
      query = `SELECT bar_type, bar_open_ts, bar_close_ts,
                      open::float, high::float, low::float, close::float,
                      volume, buy_volume, sell_volume,
                      ofi::float, vpin::float, kyle_lambda::float,
                      spread_mean_bps::float, depth_imbalance_mean::float
               FROM orderflow_bars
               WHERE ticker = $1 AND bar_type = $2
                 AND bar_open_ts >= $3::date
                 AND bar_open_ts < ($3::date + INTERVAL '1 day')
               ORDER BY bar_open_ts`;
      queryParams = [t, barType, date];
    } else {
      query = `SELECT bar_type, bar_open_ts, bar_close_ts,
                      open::float, high::float, low::float, close::float,
                      volume, buy_volume, sell_volume,
                      ofi::float, vpin::float, kyle_lambda::float,
                      spread_mean_bps::float, depth_imbalance_mean::float
               FROM orderflow_bars
               WHERE ticker = $1 AND bar_type = $2
               ORDER BY bar_open_ts DESC
               LIMIT $3`;
      queryParams = [t, barType, limit];
    }

    const { rows } = await pool.query(query, queryParams);

    return NextResponse.json({
      ticker: t,
      barType,
      count: rows.length,
      bars: date ? rows : rows.reverse(),
    });
  } catch (e: any) {
    console.error("[flow/bars] Error:", e);
    return NextResponse.json(
      { error: "Bars fetch failed", message: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
