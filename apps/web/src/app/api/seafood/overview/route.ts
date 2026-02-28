/**
 * Seafood Intelligence Overview API
 * GET /api/seafood/overview
 *
 * Returns dashboard summary: salmon price, lice averages, traffic lights, alerts
 */

import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // Latest salmon price from commodity_prices
    const salmonResult = await pool.query(`
      SELECT date, close::float AS close, currency
      FROM commodity_prices
      WHERE symbol = 'SALMON'
      ORDER BY date DESC
      LIMIT 2
    `);

    const latestSalmon = salmonResult.rows[0];
    const prevSalmon = salmonResult.rows[1];
    const salmonChange = latestSalmon && prevSalmon
      ? ((latestSalmon.close - prevSalmon.close) / prevSalmon.close) * 100
      : null;

    // Production area traffic light summary
    const trafficResult = await pool.query(`
      SELECT traffic_light, count(*)::int AS count
      FROM seafood_production_areas
      GROUP BY traffic_light
    `);
    const trafficSummary: Record<string, number> = {};
    for (const row of trafficResult.rows) {
      trafficSummary[row.traffic_light] = row.count;
    }

    // Latest company metrics
    const metricsResult = await pool.query(`
      SELECT DISTINCT ON (ticker)
        ticker, company_name, avg_lice_4w::float, pct_above_threshold::float,
        risk_score::float, active_sites, as_of_date
      FROM seafood_company_metrics
      ORDER BY ticker, as_of_date DESC
    `);

    // Industry average lice
    const avgLice = metricsResult.rows.length > 0
      ? metricsResult.rows.reduce((sum, r) => sum + (r.avg_lice_4w || 0), 0) / metricsResult.rows.length
      : null;

    // Active disease count (PD/ILA in latest reporting week)
    const diseaseResult = await pool.query(`
      WITH latest AS (
        SELECT year, week FROM seafood_lice_reports
        ORDER BY year DESC, week DESC LIMIT 1
      )
      SELECT count(DISTINCT locality_id)::int AS count
      FROM seafood_lice_reports lr
      JOIN latest lw ON lr.year = lw.year AND lr.week = lw.week
      WHERE lr.has_pd = true OR lr.has_ila = true
    `);

    // Salmon price sparkline (last 12 weeks)
    const sparkResult = await pool.query(`
      SELECT date, close::float AS close
      FROM commodity_prices
      WHERE symbol = 'SALMON'
      ORDER BY date DESC
      LIMIT 12
    `);

    return NextResponse.json({
      salmonPrice: latestSalmon ? {
        price: latestSalmon.close,
        date: latestSalmon.date,
        currency: latestSalmon.currency,
        changePct: salmonChange,
      } : null,
      industryAvgLice: avgLice,
      liceThreshold: 0.5,
      trafficLights: {
        green: trafficSummary.green || 0,
        yellow: trafficSummary.yellow || 0,
        red: trafficSummary.red || 0,
      },
      activeDiseases: diseaseResult.rows[0]?.count || 0,
      companyCount: metricsResult.rows.length,
      sparkline: sparkResult.rows.reverse().map(r => ({ date: r.date, price: r.close })),
      asOf: metricsResult.rows[0]?.as_of_date || null,
    });
  } catch (err) {
    console.error("[SEAFOOD OVERVIEW]", err);
    return NextResponse.json({ error: "Failed to fetch seafood overview" }, { status: 500 });
  }
}
