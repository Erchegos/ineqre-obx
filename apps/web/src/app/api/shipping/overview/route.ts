/**
 * Shipping Intelligence Overview API
 * GET /api/shipping/overview
 *
 * Returns dashboard KPIs: fleet size, age, utilization, market indices (BDI, BDTI, BCTI)
 */

import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // Total fleet size and average fleet age from shipping_companies
    const fleetResult = await pool.query(`
      SELECT
        COALESCE(SUM(fleet_size), 0)::int AS total_vessels,
        COALESCE(AVG(avg_vessel_age), 0)::float AS avg_fleet_age
      FROM shipping_companies
    `);

    const totalVessels = fleetResult.rows[0]?.total_vessels || 0;
    const avgFleetAge = fleetResult.rows[0]?.avg_fleet_age || 0;

    // Vessel status counts from shipping_positions (latest per vessel)
    const statusResult = await pool.query(`
      SELECT
        COALESCE(p.operational_status, 'unknown') AS operational_status,
        COUNT(*)::int AS count
      FROM shipping_vessels v
      LEFT JOIN LATERAL (
        SELECT operational_status
        FROM shipping_positions sp
        WHERE sp.imo = v.imo
        ORDER BY sp.reported_at DESC
        LIMIT 1
      ) p ON true
      WHERE v.status = 'active'
      GROUP BY p.operational_status
    `);

    const statusMap: Record<string, number> = {};
    let totalActive = 0;
    for (const row of statusResult.rows) {
      statusMap[row.operational_status] = row.count;
      totalActive += row.count;
    }

    const atSeaCount = (statusMap["at_sea"] || 0) + (statusMap["underway"] || 0) + (statusMap["laden"] || 0) + (statusMap["ballast"] || 0);
    const inPortCount = (statusMap["in_port"] || 0) + (statusMap["at_anchor"] || 0) + (statusMap["loading"] || 0) + (statusMap["discharging"] || 0);
    const atSeaPct = totalActive > 0 ? (atSeaCount / totalActive) * 100 : 0;
    const fleetUtilization = totalActive > 0 ? ((totalActive - (statusMap["idle"] || 0) - (statusMap["laid_up"] || 0)) / totalActive) * 100 : 0;

    // Latest BDI, BDTI, BCTI from shipping_market_rates
    const indicesResult = await pool.query(`
      WITH latest AS (
        SELECT DISTINCT ON (index_name)
          index_name, rate_value::float AS value, rate_date
        FROM shipping_market_rates
        WHERE index_name IN ('BDI', 'BDTI', 'BCTI')
        ORDER BY index_name, rate_date DESC
      ),
      previous AS (
        SELECT DISTINCT ON (index_name)
          index_name, rate_value::float AS value
        FROM shipping_market_rates
        WHERE index_name IN ('BDI', 'BDTI', 'BCTI')
          AND rate_date < (
            SELECT MAX(rate_date) FROM shipping_market_rates
            WHERE index_name IN ('BDI', 'BDTI', 'BCTI')
          )
        ORDER BY index_name, rate_date DESC
      )
      SELECT
        l.index_name,
        l.value AS latest_value,
        l.rate_date,
        p.value AS prev_value
      FROM latest l
      LEFT JOIN previous p ON p.index_name = l.index_name
    `);

    const indices: Record<string, { value: number | null; change: number | null; date: string | null }> = {
      bdi: { value: null, change: null, date: null },
      bdti: { value: null, change: null, date: null },
      bcti: { value: null, change: null, date: null },
    };

    for (const row of indicesResult.rows) {
      const key = row.index_name.toLowerCase() as "bdi" | "bdti" | "bcti";
      if (indices[key] !== undefined) {
        indices[key] = {
          value: row.latest_value,
          change: row.prev_value ? ((row.latest_value - row.prev_value) / row.prev_value) * 100 : null,
          date: row.rate_date,
        };
      }
    }

    return NextResponse.json({
      totalVessels,
      avgFleetAge: Math.round(avgFleetAge * 10) / 10,
      atSeaCount,
      atSeaPct: Math.round(atSeaPct * 10) / 10,
      inPortCount,
      fleetUtilization: Math.round(fleetUtilization * 10) / 10,
      bdi: indices.bdi,
      bdti: indices.bdti,
      bcti: indices.bcti,
    });
  } catch (err) {
    console.error("[shipping/overview]", err);
    return NextResponse.json({ error: "Failed to fetch shipping overview" }, { status: 500 });
  }
}
