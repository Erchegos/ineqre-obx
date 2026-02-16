/**
 * IV Term Structure API
 * GET /api/options/[ticker]/iv-curve
 *
 * Returns ATM IV for all expiration dates from pre-loaded DB data.
 */

import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const { ticker } = await params;
  const symbol = ticker.toUpperCase();

  try {
    const result = await pool.query(
      `SELECT expiry, strike, iv, underlying_price
       FROM public.options_chain
       WHERE ticker = $1 AND option_right = 'call' AND iv > 0
       ORDER BY expiry, strike`,
      [symbol]
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ error: `No IV data for ${symbol}` }, { status: 404 });
    }

    // Group by expiry
    const byExpiry = new Map<string, Array<{ strike: number; iv: number; undPrice: number }>>();
    for (const row of result.rows) {
      if (!byExpiry.has(row.expiry)) byExpiry.set(row.expiry, []);
      byExpiry.get(row.expiry)!.push({
        strike: parseFloat(row.strike),
        iv: parseFloat(row.iv),
        undPrice: parseFloat(row.underlying_price),
      });
    }

    const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");

    const termStructure = Array.from(byExpiry.entries())
      .filter(([exp]) => exp >= today)
      .map(([exp, rows]) => {
        const undP = rows.find(r => r.undPrice > 0)?.undPrice || 0;
        const atm = rows.reduce((closest, r) =>
          Math.abs(r.strike - undP) < Math.abs(closest.strike - undP) ? r : closest
        , rows[0]);

        const year = parseInt(exp.substring(0, 4));
        const month = parseInt(exp.substring(4, 6)) - 1;
        const day = parseInt(exp.substring(6, 8));
        const expiryDate = new Date(year, month, day);
        const todayDate = new Date();
        todayDate.setHours(0, 0, 0, 0);
        const dte = Math.ceil((expiryDate.getTime() - todayDate.getTime()) / (1000 * 60 * 60 * 24));

        return {
          expiry: exp,
          daysToExpiry: dte,
          atmIV: atm ? Math.round(atm.iv * 10000) / 100 : null,
          underlyingPrice: undP,
        };
      })
      .filter(d => d.daysToExpiry > 0)
      .sort((a, b) => a.daysToExpiry - b.daysToExpiry);

    return NextResponse.json({ symbol, termStructure });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed" },
      { status: 500 }
    );
  }
}
