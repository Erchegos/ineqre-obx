import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Returns all tickers that have factor data in factor_technical.
 * Single query instead of N individual requests.
 */
export async function GET() {
  try {
    const result = await pool.query<{ ticker: string; count: number }>(`
      SELECT ticker, COUNT(*) as count
      FROM factor_technical
      GROUP BY ticker
      HAVING COUNT(*) >= 100
      ORDER BY ticker
    `);

    const tickers = result.rows.map((row) => row.ticker);

    return NextResponse.json({
      success: true,
      count: tickers.length,
      tickers,
    });
  } catch (error: any) {
    console.error("Error fetching factor tickers:", error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
