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
  const date = searchParams.get("date"); // YYYY-MM-DD
  const days = Math.min(parseInt(searchParams.get("days") || "5", 10), 60);

  try {
    let query: string;
    let queryParams: any[];

    if (date) {
      query = `SELECT ts, vpin_50::float AS vpin, vpin_percentile::float,
                      kyle_lambda_60m::float AS kyle_lambda,
                      toxicity_score::float, regime
               FROM orderflow_signals
               WHERE ticker = $1
                 AND ts >= $2::date
                 AND ts < ($2::date + INTERVAL '1 day')
               ORDER BY ts`;
      queryParams = [t, date];
    } else {
      query = `SELECT ts, vpin_50::float AS vpin, vpin_percentile::float,
                      kyle_lambda_60m::float AS kyle_lambda,
                      toxicity_score::float, regime
               FROM orderflow_signals
               WHERE ticker = $1
                 AND ts > NOW() - ($2 || ' days')::interval
               ORDER BY ts`;
      queryParams = [t, String(days)];
    }

    const { rows } = await pool.query(query, queryParams);

    return NextResponse.json({
      ticker: t,
      count: rows.length,
      series: rows,
    });
  } catch (e: any) {
    console.error("[flow/vpin] Error:", e);
    return NextResponse.json(
      { error: "VPIN fetch failed", message: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
