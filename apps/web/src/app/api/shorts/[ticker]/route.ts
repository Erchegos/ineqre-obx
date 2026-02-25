/**
 * Per-Stock Short Position History API
 * GET /api/shorts/[ticker]
 *
 * Returns the full short position history for a specific ticker.
 *
 * Query params:
 *   ?days=365    — number of days of history (default all)
 */

import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  try {
    const { ticker } = await params;
    const sp = req.nextUrl.searchParams;
    const days = parseInt(sp.get("days") || "0");

    const upperTicker = ticker.toUpperCase();

    // Validate ticker
    if (!/^[A-Z0-9.]{1,10}$/.test(upperTicker)) {
      return NextResponse.json({ error: "Invalid ticker" }, { status: 400 });
    }

    const conditions = ["sp.ticker = $1"];
    const queryParams: any[] = [upperTicker];

    if (days > 0) {
      conditions.push(`sp.date >= NOW() - INTERVAL '${days} days'`);
    }

    const where = conditions.join(" AND ");

    // Get full history
    const historyResult = await pool.query(
      `
      SELECT
        sp.date,
        sp.short_pct::float AS short_pct,
        sp.total_short_shares::bigint AS total_short_shares,
        sp.active_positions,
        sp.prev_short_pct::float AS prev_short_pct,
        sp.change_pct::float AS change_pct
      FROM short_positions sp
      WHERE ${where}
      ORDER BY sp.date DESC
      `,
      queryParams
    );

    // Get holder history (all dates)
    const holdersResult = await pool.query(
      `
      SELECT
        sh.date,
        sh.position_holder,
        sh.short_pct::float AS short_pct,
        sh.short_shares::bigint AS short_shares
      FROM short_position_holders sh
      WHERE sh.ticker = $1
        ${days > 0 ? `AND sh.date >= NOW() - INTERVAL '${days} days'` : ""}
      ORDER BY sh.date DESC, sh.short_pct DESC
      `,
      [upperTicker]
    );

    // Group holders by date
    const holdersByDate = new Map<string, any[]>();
    for (const h of holdersResult.rows) {
      const dateStr = h.date;
      if (!holdersByDate.has(dateStr)) holdersByDate.set(dateStr, []);
      holdersByDate.get(dateStr)!.push({
        holder: h.position_holder,
        pct: h.short_pct,
        shares: h.short_shares ? Number(h.short_shares) : null,
      });
    }

    // Get stock info
    const stockResult = await pool.query(
      `SELECT name, sector FROM stocks WHERE upper(ticker) = $1 LIMIT 1`,
      [upperTicker]
    );

    // Calculate stats
    const history = historyResult.rows;
    const latest = history[0];
    const pcts = history.map((r) => r.short_pct).filter((p) => p > 0);
    const maxPct = pcts.length ? Math.max(...pcts) : 0;
    const avgPct = pcts.length
      ? pcts.reduce((a, b) => a + b, 0) / pcts.length
      : 0;

    return NextResponse.json({
      ticker: upperTicker,
      stockName: stockResult.rows[0]?.name || null,
      sector: stockResult.rows[0]?.sector || null,
      latest: latest
        ? {
            date: latest.date,
            shortPct: latest.short_pct,
            totalShortShares: latest.total_short_shares
              ? Number(latest.total_short_shares)
              : null,
            activePositions: latest.active_positions,
            changePct: latest.change_pct,
          }
        : null,
      stats: {
        maxShortPct: maxPct,
        avgShortPct: avgPct,
        dataPoints: history.length,
        firstDate: history.length ? history[history.length - 1].date : null,
        lastDate: history.length ? history[0].date : null,
      },
      history: history.map((r) => ({
        date: r.date,
        shortPct: r.short_pct,
        totalShortShares: r.total_short_shares
          ? Number(r.total_short_shares)
          : null,
        activePositions: r.active_positions,
        changePct: r.change_pct,
        holders: holdersByDate.get(r.date) || [],
      })),
    });
  } catch (err) {
    console.error("[SHORTS TICKER API]", err);
    return NextResponse.json(
      { error: "Failed to fetch short positions" },
      { status: 500 }
    );
  }
}
