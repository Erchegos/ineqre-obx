/**
 * Seafood Export Price API
 * GET /api/seafood/export?weeks=104&category=fresh
 *
 * Returns SSB salmon export price (NOK/kg) and volume data.
 */

import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const weeks = parseInt(sp.get("weeks") || "104");
    const category = sp.get("category") || "fresh";

    // 1) Price + volume time series
    const tsResult = await pool.query(`
      SELECT week_start, price_nok_kg::float, volume_tonnes::float
      FROM seafood_export_weekly
      WHERE category = $1
        AND week_start >= (CURRENT_DATE - INTERVAL '1 week' * $2)::date
      ORDER BY week_start
    `, [category, weeks]);

    // 2) Current stats
    const statsResult = await pool.query(`
      WITH recent AS (
        SELECT price_nok_kg::float AS price, week_start
        FROM seafood_export_weekly
        WHERE category = $1
        ORDER BY week_start DESC
        LIMIT 52
      )
      SELECT
        (SELECT price FROM recent LIMIT 1) AS current_price,
        (SELECT week_start FROM recent LIMIT 1) AS latest_week,
        MAX(price) AS high_52w,
        MIN(price) AS low_52w,
        ROUND(AVG(price)::numeric, 2)::float AS avg_52w
      FROM recent
    `, [category]);

    // 3) YoY overlay (current year vs previous year)
    const currentYear = new Date().getFullYear();
    const yoyResult = await pool.query(`
      SELECT
        EXTRACT(WEEK FROM week_start)::int AS week_num,
        EXTRACT(YEAR FROM week_start)::int AS year,
        price_nok_kg::float AS price,
        volume_tonnes::float AS volume
      FROM seafood_export_weekly
      WHERE category = $1
        AND EXTRACT(YEAR FROM week_start) >= $2 - 1
      ORDER BY week_start
    `, [category, currentYear]);

    // Split into current and previous year
    const currentYearData = yoyResult.rows.filter((r: { year: number }) => r.year === currentYear);
    const prevYearData = yoyResult.rows.filter((r: { year: number }) => r.year === currentYear - 1);

    // 4) Category comparison (fresh vs frozen, last 12 weeks)
    const catResult = await pool.query(`
      SELECT category, week_start, price_nok_kg::float AS price, volume_tonnes::float AS volume
      FROM seafood_export_weekly
      WHERE week_start >= (CURRENT_DATE - INTERVAL '12 weeks')::date
        AND category IN ('fresh', 'frozen')
      ORDER BY week_start, category
    `);

    const stats = statsResult.rows[0] || {};

    return NextResponse.json({
      timeSeries: tsResult.rows,
      stats: {
        currentPrice: stats.current_price,
        latestWeek: stats.latest_week,
        high52w: stats.high_52w,
        low52w: stats.low_52w,
        avg52w: stats.avg_52w,
      },
      yoy: {
        currentYear: currentYearData,
        prevYear: prevYearData,
      },
      categoryComparison: catResult.rows,
      category,
      weeks,
    });
  } catch (err) {
    console.error("[SEAFOOD EXPORT]", err);
    return NextResponse.json({ error: "Failed to fetch export data" }, { status: 500 });
  }
}
