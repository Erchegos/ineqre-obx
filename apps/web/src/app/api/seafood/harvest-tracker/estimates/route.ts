/**
 * Harvest Tracker — Quarterly Estimates API
 * GET /api/seafood/harvest-tracker/estimates?quarters=4&ticker=
 *
 * Returns per-company quarterly harvest estimates vs actuals.
 */
import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const quarters = parseInt(sp.get("quarters") || "4");
    const ticker = sp.get("ticker");

    const params: (string | number)[] = [quarters];
    let tickerClause = "";
    if (ticker) {
      params.push(ticker);
      tickerClause = `AND ticker = $${params.length}`;
    }

    const result = await pool.query(`
      SELECT ticker, company_name, year, quarter,
             estimated_harvest_tonnes::float, trip_count,
             estimated_avg_price_nok::float,
             actual_harvest_tonnes::float, actual_price_realization::float,
             estimation_accuracy_pct::float, updated_at
      FROM harvest_quarterly_estimates
      WHERE (year * 4 + quarter) >= (
        EXTRACT(YEAR FROM CURRENT_DATE)::int * 4 + EXTRACT(QUARTER FROM CURRENT_DATE)::int - $1
      )
      ${tickerClause}
      ORDER BY year DESC, quarter DESC, ticker
    `, params);

    // Also get current quarter running totals from trips directly
    const currentQ = await pool.query(`
      SELECT origin_ticker AS ticker,
             COUNT(*)::int AS trip_count,
             COALESCE(SUM(estimated_volume_tonnes), 0)::float AS est_volume,
             CASE
               WHEN SUM(CASE WHEN spot_price_at_harvest IS NOT NULL THEN estimated_volume_tonnes ELSE 0 END) > 0
               THEN (SUM(COALESCE(spot_price_at_harvest, 0) * estimated_volume_tonnes) /
                    NULLIF(SUM(CASE WHEN spot_price_at_harvest IS NOT NULL THEN estimated_volume_tonnes ELSE 0 END), 0))::float
               ELSE NULL
             END AS vwap_price
      FROM harvest_trips
      WHERE EXTRACT(YEAR FROM departure_time) = EXTRACT(YEAR FROM CURRENT_DATE)
        AND EXTRACT(QUARTER FROM departure_time) = EXTRACT(QUARTER FROM CURRENT_DATE)
        AND origin_ticker IS NOT NULL
      GROUP BY origin_ticker
    `);

    return NextResponse.json({
      estimates: result.rows,
      currentQuarter: currentQ.rows,
      quarters,
    });
  } catch (err) {
    console.error("[HARVEST ESTIMATES]", err);
    return NextResponse.json({ error: "Failed to fetch estimates" }, { status: 500 });
  }
}
