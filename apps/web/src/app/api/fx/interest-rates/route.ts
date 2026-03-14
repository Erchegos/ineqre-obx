/**
 * FX Interest Rates API
 * GET /api/fx/interest-rates
 *
 * Returns current rates per currency/tenor from interest_rates table.
 */

import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const result = await pool.query<{
      currency: string;
      tenor: string;
      rate: string;
      rate_type: string;
      source: string;
      date: string;
    }>(
      `SELECT DISTINCT ON (currency, tenor, rate_type)
        currency, tenor, rate, rate_type, source, date::text
       FROM interest_rates
       ORDER BY currency, tenor, rate_type, date DESC`
    );

    // Group by currency
    const byCurrency: Record<string, { tenor: string; rate: number; rateType: string; source: string; date: string }[]> = {};
    for (const row of result.rows) {
      if (!byCurrency[row.currency]) byCurrency[row.currency] = [];
      byCurrency[row.currency].push({
        tenor: row.tenor,
        rate: parseFloat(row.rate) * 100, // convert to %
        rateType: row.rate_type,
        source: row.source,
        date: row.date,
      });
    }

    return NextResponse.json({
      status: "ok",
      currencies: byCurrency,
      count: result.rows.length,
    });
  } catch (error: any) {
    console.error("[FX Interest Rates API] Error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to fetch interest rates" },
      { status: 500 }
    );
  }
}
