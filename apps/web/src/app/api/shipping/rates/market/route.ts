/**
 * Shipping Market Rates API
 * GET /api/shipping/rates/market?index=BDI,BDTI&days=365
 *
 * Returns market rate time series and per-index stats.
 */

import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const indexParam = request.nextUrl.searchParams.get("index");
    const daysParam = request.nextUrl.searchParams.get("days");
    const days = daysParam ? parseInt(daysParam) : 365;

    // If no index specified, return all available indices
    let indexFilter = "";
    const params: (string[] | number)[] = [days];

    if (indexParam) {
      const indices = indexParam.split(",").map(s => s.trim().toUpperCase());
      params.push(indices);
      indexFilter = `AND index_name = ANY($2::text[])`;
    }

    // Time series data
    const seriesResult = await pool.query(`
      SELECT index_name, rate_date, rate_value::float AS value
      FROM shipping_market_rates
      WHERE rate_date >= CURRENT_DATE - ($1 || ' days')::interval
        ${indexFilter}
      ORDER BY index_name ASC, rate_date ASC
    `, params);

    // Group by index
    const series: Record<string, Array<{ date: string; value: number }>> = {};
    for (const row of seriesResult.rows) {
      if (!series[row.index_name]) {
        series[row.index_name] = [];
      }
      series[row.index_name].push({
        date: row.rate_date,
        value: row.value,
      });
    }

    // Stats per index
    const statsResult = await pool.query(`
      SELECT
        index_name,
        (SELECT rate_value::float FROM shipping_market_rates mr2
         WHERE mr2.index_name = mr.index_name
         ORDER BY mr2.rate_date DESC LIMIT 1) AS latest,
        MAX(rate_value)::float AS high,
        MIN(rate_value)::float AS low,
        AVG(rate_value)::float AS avg,
        (SELECT rate_date FROM shipping_market_rates mr2
         WHERE mr2.index_name = mr.index_name
         ORDER BY mr2.rate_date DESC LIMIT 1) AS latest_date
      FROM shipping_market_rates mr
      WHERE rate_date >= CURRENT_DATE - ($1 || ' days')::interval
        ${indexFilter}
      GROUP BY index_name
    `, params);

    const stats: Record<string, { latest: number; high: number; low: number; avg: number; latestDate: string }> = {};
    for (const row of statsResult.rows) {
      stats[row.index_name] = {
        latest: row.latest,
        high: row.high,
        low: row.low,
        avg: Math.round(row.avg * 100) / 100,
        latestDate: row.latest_date,
      };
    }

    return NextResponse.json({ series, stats });
  } catch (err) {
    console.error("[shipping/rates/market]", err);
    return NextResponse.json({ error: "Failed to fetch market rates" }, { status: 500 });
  }
}
