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

    // Time series data — prefer pareto_daily over manual/interpolated when both exist
    const seriesResult = await pool.query(`
      SELECT DISTINCT ON (index_name, rate_date)
        index_name, rate_date, rate_value::float AS value, source
      FROM shipping_market_rates
      WHERE rate_date >= CURRENT_DATE - ($1 || ' days')::interval
        ${indexFilter}
      ORDER BY index_name ASC, rate_date ASC,
        CASE source
          WHEN 'pareto_daily' THEN 1
          WHEN 'pareto' THEN 2
          WHEN 'pareto_interpolated' THEN 3
          WHEN 'market_data' THEN 4
          WHEN 'manual' THEN 5
          ELSE 6
        END ASC
    `, params);

    // Group by index and apply spike filter
    const rawSeries: Record<string, Array<{ date: string; value: number }>> = {};
    for (const row of seriesResult.rows) {
      if (!rawSeries[row.index_name]) rawSeries[row.index_name] = [];
      rawSeries[row.index_name].push({ date: row.rate_date, value: row.value });
    }

    // Spike filter: remove points that deviate >200% from rolling median of neighbors
    const series: Record<string, Array<{ date: string; value: number }>> = {};
    for (const [idx, pts] of Object.entries(rawSeries)) {
      if (pts.length < 5) { series[idx] = pts; continue; }
      const filtered: typeof pts = [];
      for (let i = 0; i < pts.length; i++) {
        // Get window of up to 5 neighbors (excluding current point)
        const neighbors: number[] = [];
        for (let j = Math.max(0, i - 3); j <= Math.min(pts.length - 1, i + 3); j++) {
          if (j !== i) neighbors.push(pts[j].value);
        }
        neighbors.sort((a, b) => a - b);
        const median = neighbors[Math.floor(neighbors.length / 2)];
        const ratio = pts[i].value / median;
        // Keep point if within 3x of median (generous threshold for volatile markets)
        if (ratio > 0.33 && ratio < 3.0) {
          filtered.push(pts[i]);
        }
        // else: silently drop the spike
      }
      // Apply 3-point weighted moving average to smooth interpolation artifacts
      if (filtered.length >= 3) {
        const smoothed: typeof filtered = [filtered[0]];
        for (let i = 1; i < filtered.length - 1; i++) {
          smoothed.push({
            date: filtered[i].date,
            value: Math.round((filtered[i - 1].value * 0.2 + filtered[i].value * 0.6 + filtered[i + 1].value * 0.2) * 100) / 100,
          });
        }
        smoothed.push(filtered[filtered.length - 1]);
        series[idx] = smoothed;
      } else {
        series[idx] = filtered;
      }
    }

    // Compute stats from filtered series (not raw DB) so stats match charts
    const stats: Record<string, { latest: number; high: number; low: number; avg: number; latestDate: string }> = {};
    for (const [idx, pts] of Object.entries(series)) {
      if (pts.length === 0) continue;
      const vals = pts.map(p => p.value);
      const last = pts[pts.length - 1];
      stats[idx] = {
        latest: last.value,
        high: Math.max(...vals),
        low: Math.min(...vals),
        avg: Math.round((vals.reduce((s, v) => s + v, 0) / vals.length) * 100) / 100,
        latestDate: last.date,
      };
    }

    return NextResponse.json({ series, stats });
  } catch (err) {
    console.error("[shipping/rates/market]", err);
    return NextResponse.json({ error: "Failed to fetch market rates" }, { status: 500 });
  }
}
