/**
 * Salmon Forward Curve History API
 * GET /api/seafood/forward-history
 *
 * Returns all weekly snapshots of forward prices for:
 *   - byDate: { "2026-02-25": [{ period, priceEurTonne }], ... }  → forward curve fan
 *   - byPeriod: { "Apr-26": [{ report_date, priceEurTonne }], ... } → contract history
 */

import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Sort contract periods chronologically
const PERIOD_ORDER: Record<string, number> = {};
function periodSortKey(period: string): number {
  if (PERIOD_ORDER[period] !== undefined) return PERIOD_ORDER[period];

  // Q1/Q2/Q3/Q4'YY
  const qMatch = period.match(/^Q([1-4])'(\d{2})$/);
  if (qMatch) return parseInt("20" + qMatch[2]) * 100 + (parseInt(qMatch[1]) - 1) * 3;

  // H1/H2'YY
  const hMatch = period.match(/^H([12])'(\d{2})$/);
  if (hMatch) return parseInt("20" + hMatch[2]) * 100 + (parseInt(hMatch[1]) - 1) * 6;

  // Y'YY
  const yMatch = period.match(/^Y'?(\d{2})$/);
  if (yMatch) return parseInt("20" + yMatch[1]) * 100 + 6;

  // Month-YY (Jan-26, Feb-26, etc.)
  const MONTHS: Record<string, number> = {
    Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
    Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
  };
  const mMatch = period.match(/^([A-Za-z]{3})-(\d{2})$/);
  if (mMatch) return (2000 + parseInt(mMatch[2])) * 100 + (MONTHS[mMatch[1]] ?? 0);

  return 9999;
}

export async function GET() {
  try {
    const result = await pool.query(
      `SELECT report_date::text, period, price_eur_tonne::float
       FROM salmon_forward_prices
       WHERE price_eur_tonne IS NOT NULL
       ORDER BY report_date ASC, period`
    );

    const byDate: Record<string, { period: string; priceEurTonne: number }[]> = {};
    const byPeriod: Record<string, { report_date: string; priceEurTonne: number }[]> = {};
    const dateSet = new Set<string>();
    const periodSet = new Set<string>();

    for (const row of result.rows) {
      const d = row.report_date;
      const p = row.period;
      const v = row.price_eur_tonne;

      dateSet.add(d);
      periodSet.add(p);

      if (!byDate[d]) byDate[d] = [];
      byDate[d].push({ period: p, priceEurTonne: v });

      if (!byPeriod[p]) byPeriod[p] = [];
      byPeriod[p].push({ report_date: d, priceEurTonne: v });
    }

    const dates = Array.from(dateSet).sort();
    const periods = Array.from(periodSet).sort((a, b) => periodSortKey(a) - periodSortKey(b));

    // Sort each date's entries by period order
    for (const d of dates) {
      byDate[d].sort((a, b) => periodSortKey(a.period) - periodSortKey(b.period));
    }

    return NextResponse.json({ byDate, byPeriod, dates, periods });
  } catch (err) {
    console.error("[FORWARD HISTORY]", err);
    return NextResponse.json({ error: "Failed to fetch forward history" }, { status: 500 });
  }
}
