import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const runResult = await pool.query(
      `SELECT id FROM backtest_runs ORDER BY created_at DESC LIMIT 1`
    );
    if (runResult.rows.length === 0) {
      return NextResponse.json({ success: true, tickers: [] });
    }

    const result = await pool.query(
      `SELECT DISTINCT ticker FROM backtest_predictions
       WHERE backtest_run_id = $1
       ORDER BY ticker`,
      [runResult.rows[0].id]
    );

    return NextResponse.json({
      success: true,
      tickers: result.rows.map((r: any) => r.ticker),
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
