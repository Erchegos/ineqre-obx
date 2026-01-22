import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function errShape(e: unknown) {
  const x = e as any;
  return {
    message: x?.message ?? String(e),
    code: x?.code ?? null,
    detail: x?.detail ?? null,
  };
}

export async function GET() {
  try {
    // Match the stocks list filter: only count tickers with 100+ records
    const query = `
      SELECT
        COUNT(DISTINCT ticker_summary.ticker) as securities,
        MAX(ticker_summary.max_date) as last_updated,
        SUM(ticker_summary.record_count) as data_points
      FROM (
        SELECT
          p.ticker,
          MAX(p.date) as max_date,
          COUNT(*) as record_count
        FROM prices_daily p
        INNER JOIN stocks s ON p.ticker = s.ticker
        WHERE p.close IS NOT NULL AND p.close > 0
        GROUP BY p.ticker
        HAVING COUNT(*) >= 100
      ) ticker_summary
    `;

    const result = await pool.query(query);

    const stats = {
      securities: Number(result.rows[0].securities || 0),
      last_updated: result.rows[0].last_updated,
      data_points: Number(result.rows[0].data_points || 0),
    };

    return NextResponse.json(stats);
  } catch (e: unknown) {
    console.error("Error fetching stats:", e);

    return NextResponse.json(
      {
        error: "Failed to fetch system stats",
        pg: errShape(e),
      },
      { status: 500 }
    );
  }
}
