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
        COUNT(DISTINCT s.ticker) as securities,
        MAX(p.date) as last_updated,
        COUNT(*) as data_points
      FROM stocks s
      INNER JOIN (
        SELECT ticker, MAX(date) as max_date, COUNT(*) as record_count
        FROM prices_daily
        WHERE close IS NOT NULL AND close > 0
        GROUP BY ticker
        HAVING COUNT(*) >= 100
      ) p ON s.ticker = p.ticker
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
