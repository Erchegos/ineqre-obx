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
    // Try to detect which price table exists
    let tableName = "prices_daily";
    try {
      const tableCheck = await pool.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables
          WHERE table_schema = 'public'
          AND table_name = 'prices_daily'
        ) as has_prices_daily,
        EXISTS (
          SELECT FROM information_schema.tables
          WHERE table_schema = 'public'
          AND table_name = 'obx_equities'
        ) as has_obx_equities
      `);

      if (tableCheck.rows[0].has_obx_equities && !tableCheck.rows[0].has_prices_daily) {
        tableName = "obx_equities";
      }
    } catch (e) {
      console.error("Failed to detect table, using prices_daily:", e);
    }

    const buildStatsQuery = (table: string) => `
      SELECT
        COUNT(DISTINCT s.ticker) as securities,
        MAX(p.date) as last_updated,
        COUNT(*) as data_points
      FROM stocks s
      INNER JOIN ${table} p ON s.ticker = p.ticker
      WHERE p.close IS NOT NULL
        AND p.close > 0
    `;

    let result;
    try {
      result = await pool.query(buildStatsQuery(tableName));
    } catch (firstError) {
      console.error(`Stats query failed with ${tableName}, trying alternative:`, firstError);
      // Try the other table
      const altTable = tableName === "prices_daily" ? "obx_equities" : "prices_daily";
      result = await pool.query(buildStatsQuery(altTable));
    }

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
