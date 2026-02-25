/**
 * Short Positions Overview API
 * GET /api/shorts
 *
 * Returns the latest short position for each stock, sorted by short_pct descending.
 *
 * Query params:
 *   ?min_pct=0.5    — minimum short % to include (default 0)
 *   ?limit=50       — max results (default 100)
 */

import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const minPct = parseFloat(sp.get("min_pct") || "0");
    const limit = Math.min(parseInt(sp.get("limit") || "100"), 200);

    // Get the latest short position per ticker
    const result = await pool.query(
      `
      WITH latest AS (
        SELECT DISTINCT ON (sp.ticker)
          sp.ticker,
          sp.isin,
          sp.date,
          sp.short_pct::float AS short_pct,
          sp.total_short_shares::bigint AS total_short_shares,
          sp.active_positions,
          sp.prev_short_pct::float AS prev_short_pct,
          sp.change_pct::float AS change_pct,
          s.name AS stock_name,
          s.sector
        FROM short_positions sp
        LEFT JOIN stocks s ON upper(s.ticker) = upper(sp.ticker)
        ORDER BY sp.ticker, sp.date DESC
      )
      SELECT l.*,
        -- 30-day historical short % for sparkline
        (
          SELECT json_agg(json_build_object(
            'date', h.date,
            'short_pct', h.short_pct::float
          ) ORDER BY h.date ASC)
          FROM short_positions h
          WHERE h.ticker = l.ticker
            AND h.date >= l.date::date - INTERVAL '90 days'
        ) AS history,
        -- Top holders
        (
          SELECT json_agg(json_build_object(
            'holder', sh.position_holder,
            'pct', sh.short_pct::float,
            'shares', sh.short_shares::bigint
          ) ORDER BY sh.short_pct DESC)
          FROM short_position_holders sh
          WHERE sh.ticker = l.ticker AND sh.date = l.date
        ) AS holders
      FROM latest l
      WHERE l.short_pct >= $1
      ORDER BY l.short_pct DESC
      LIMIT $2
      `,
      [minPct, limit]
    );

    return NextResponse.json({
      positions: result.rows.map((r) => ({
        ticker: r.ticker,
        isin: r.isin,
        date: r.date,
        shortPct: r.short_pct,
        totalShortShares: r.total_short_shares
          ? Number(r.total_short_shares)
          : null,
        activePositions: r.active_positions,
        prevShortPct: r.prev_short_pct,
        changePct: r.change_pct,
        stockName: r.stock_name,
        sector: r.sector,
        history: r.history || [],
        holders: (r.holders || []).map((h: any) => ({
          ...h,
          shares: h.shares ? Number(h.shares) : null,
        })),
      })),
      count: result.rowCount,
    });
  } catch (err) {
    console.error("[SHORTS API]", err);
    return NextResponse.json(
      { error: "Failed to fetch short positions" },
      { status: 500 }
    );
  }
}
