/**
 * Options Overview API
 * GET /api/options
 *
 * Returns list of all stocks with pre-loaded options data
 */

import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const result = await pool.query(
      `SELECT ticker, underlying_price, currency, expirations, strikes, fetched_at
       FROM public.options_meta
       ORDER BY ticker`,
    );

    const stocks = result.rows.map((row) => ({
      ticker: row.ticker,
      underlying_price: parseFloat(row.underlying_price),
      currency: row.currency || "USD",
      expirations: row.expirations as string[],
      strikes: row.strikes as number[],
      fetched_at: row.fetched_at,
    }));

    return NextResponse.json({ stocks });
  } catch (error: unknown) {
    console.error("[Options Overview API] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch options stocks" },
      { status: 500 }
    );
  }
}
