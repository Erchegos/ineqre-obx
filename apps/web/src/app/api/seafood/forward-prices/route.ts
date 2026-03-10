/**
 * Salmon Forward Prices API
 * GET /api/seafood/forward-prices
 *
 * Returns salmon forward curve from Fish Pool/Euronext Price Status reports.
 */

import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest) {
  try {
    // Get the latest report date's forward curve
    const latestDate = await pool.query(
      `SELECT DISTINCT report_date FROM salmon_forward_prices
       ORDER BY report_date DESC LIMIT 2`
    );

    if (latestDate.rows.length === 0) {
      return NextResponse.json({ forwards: [], previous: [], latestDate: null });
    }

    const currentDate = latestDate.rows[0].report_date;
    const previousDate = latestDate.rows[1]?.report_date || null;

    // Current forward curve
    const currentResult = await pool.query(
      `SELECT period, price_eur_tonne::float, trend
       FROM salmon_forward_prices
       WHERE report_date = $1
       ORDER BY period`,
      [currentDate]
    );

    // Previous forward curve (for w/w change)
    let previousResult = { rows: [] as any[] };
    if (previousDate) {
      previousResult = await pool.query(
        `SELECT period, price_eur_tonne::float
         FROM salmon_forward_prices
         WHERE report_date = $1
         ORDER BY period`,
        [previousDate]
      );
    }

    // Merge w/w change into forwards
    const prevMap = new Map(previousResult.rows.map((r: any) => [r.period, r.price_eur_tonne]));
    const forwards = currentResult.rows.map((r: any) => {
      const prev = prevMap.get(r.period);
      return {
        ...r,
        report_date: currentDate,
        prev_price: prev ?? null,
        change_pct: prev && r.price_eur_tonne ? ((r.price_eur_tonne - prev) / prev) * 100 : null,
      };
    });

    return NextResponse.json({
      forwards,
      previous: previousResult.rows,
      latestDate: currentDate,
      previousDate,
    });
  } catch (err) {
    console.error("[FORWARD PRICES]", err);
    return NextResponse.json(
      { error: "Failed to fetch forward prices" },
      { status: 500 }
    );
  }
}
