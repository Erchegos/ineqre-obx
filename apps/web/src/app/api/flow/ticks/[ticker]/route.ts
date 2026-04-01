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
  const minutes = parseInt(searchParams.get("minutes") || "30", 10);
  const limit = Math.min(parseInt(searchParams.get("limit") || "5000", 10), 10000);

  try {
    const { rows } = await pool.query(
      `SELECT ts, price::float, size, side
       FROM orderflow_ticks
       WHERE ticker = $1 AND ts > NOW() - ($2 || ' minutes')::interval
       ORDER BY ts DESC
       LIMIT $3`,
      [t, String(minutes), limit]
    );

    return NextResponse.json({
      ticker: t,
      count: rows.length,
      ticks: rows.reverse(),
    });
  } catch (e: any) {
    console.error("[flow/ticks] Error:", e);
    return NextResponse.json(
      { error: "Ticks fetch failed", message: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
