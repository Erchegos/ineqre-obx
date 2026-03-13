/**
 * Harvest Tracker — Activity API
 * GET /api/seafood/harvest-tracker/activity?days=30
 *
 * Returns daily harvest activity for charts (trip count + volume + spot price).
 */
import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const days = parseInt(req.nextUrl.searchParams.get("days") || "30");

    // Daily trip count and volume
    const activity = await pool.query(`
      SELECT
        departure_time::date AS date,
        COUNT(*)::int AS trips,
        SUM(estimated_volume_tonnes)::float AS volume,
        AVG(spot_price_at_harvest)::float AS avg_spot_price
      FROM harvest_trips
      WHERE departure_time >= (CURRENT_DATE - INTERVAL '1 day' * $1)
      GROUP BY departure_time::date
      ORDER BY date
    `, [days]);

    // By company
    const byCompany = await pool.query(`
      SELECT
        origin_ticker AS ticker,
        departure_time::date AS date,
        COUNT(*)::int AS trips,
        SUM(estimated_volume_tonnes)::float AS volume
      FROM harvest_trips
      WHERE departure_time >= (CURRENT_DATE - INTERVAL '1 day' * $1)
        AND origin_ticker IS NOT NULL
      GROUP BY origin_ticker, departure_time::date
      ORDER BY date, ticker
    `, [days]);

    // Weekly salmon price: SSB fresh export (3wk MA) + Fish Pool spot for latest weeks (tagged)
    // Fish Pool extends only after SSB ends, with 7-day gap to avoid overlap
    const spotPrices = await pool.query(`
      WITH ssb AS (
        SELECT week_start AS report_date,
               AVG(price_nok_kg::float) OVER (
                 ORDER BY week_start ROWS BETWEEN 1 PRECEDING AND 1 FOLLOWING
               ) AS sisalmon_avg,
               'actual' AS source
        FROM seafood_export_weekly
        WHERE category = 'fresh'
          AND week_start >= (CURRENT_DATE - INTERVAL '1 day' * ($1 + 14))
      ),
      ssb_filtered AS (
        SELECT report_date, sisalmon_avg, source FROM ssb
        WHERE report_date >= (CURRENT_DATE - INTERVAL '1 day' * $1)
      ),
      ssb_max AS (
        SELECT MAX(report_date) AS max_date FROM ssb_filtered
      ),
      fishpool_ext AS (
        SELECT report_date, sisalmon_avg::float AS sisalmon_avg, 'estimate' AS source
        FROM salmon_spot_weekly
        WHERE currency = 'NOK' AND sisalmon_avg > 20
          AND report_date > (SELECT max_date + INTERVAL '5 day' FROM ssb_max)
      )
      SELECT report_date, sisalmon_avg, source FROM ssb_filtered
      UNION ALL
      SELECT report_date, sisalmon_avg, source FROM fishpool_ext
      ORDER BY report_date
    `, [days]);

    return NextResponse.json({
      daily: activity.rows,
      byCompany: byCompany.rows,
      spotPrices: spotPrices.rows,
      days,
    });
  } catch (err) {
    console.error("[HARVEST ACTIVITY]", err);
    return NextResponse.json({ error: "Failed to fetch activity" }, { status: 500 });
  }
}
