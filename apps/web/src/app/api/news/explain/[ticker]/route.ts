/**
 * "Why Did It Move?" API
 * GET /api/news/explain/[ticker]
 *
 * Query params:
 *   ?days=30           — lookback window (default 30, max 90)
 *   ?sigma=2           — move threshold in std devs (default 2)
 *
 * Finds significant price moves (>Nσ) and correlates them with
 * news events within ±24 hours of the move.
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
    const days = Math.min(parseInt(sp.get("days") || "30"), 90);
    const sigma = parseFloat(sp.get("sigma") || "2");

    const upperTicker = ticker.toUpperCase();

    // 1. Get price data and compute returns + rolling std
    const priceResult = await pool.query(
      `
      WITH daily AS (
        SELECT
          date,
          adj_close,
          LAG(adj_close) OVER (ORDER BY date) AS prev_close
        FROM prices_daily
        WHERE ticker = $1
          AND date > NOW() - INTERVAL '${days + 30} days'
        ORDER BY date
      ),
      returns AS (
        SELECT
          date,
          adj_close,
          (adj_close - prev_close) / NULLIF(prev_close, 0) AS daily_return
        FROM daily
        WHERE prev_close IS NOT NULL
      ),
      stats AS (
        SELECT
          AVG(daily_return) AS mean_return,
          STDDEV(daily_return) AS std_return
        FROM returns
      )
      SELECT
        r.date,
        r.adj_close,
        r.daily_return,
        s.mean_return,
        s.std_return,
        CASE WHEN s.std_return > 0
          THEN ABS(r.daily_return - s.mean_return) / s.std_return
          ELSE 0
        END AS z_score
      FROM returns r, stats s
      WHERE r.date > NOW() - INTERVAL '${days} days'
        AND CASE WHEN s.std_return > 0
          THEN ABS(r.daily_return - s.mean_return) / s.std_return
          ELSE 0
        END >= $2
      ORDER BY r.date DESC
    `,
      [upperTicker, sigma]
    );

    // 2. For each significant move, find correlated news (±24h)
    const moves = [];
    for (const row of priceResult.rows) {
      const newsResult = await pool.query(
        `
        SELECT
          e.id, e.published_at, e.headline, e.summary,
          e.event_type, e.severity, e.sentiment::float, e.confidence::float,
          e.source, e.provider_code,
          tm.relevance_score::float AS relevance,
          tm.impact_direction
        FROM news_events e
        JOIN news_ticker_map tm ON tm.news_event_id = e.id
        WHERE tm.ticker = $1
          AND e.published_at BETWEEN ($2::timestamptz - INTERVAL '24 hours')
                                   AND ($2::timestamptz + INTERVAL '24 hours')
        ORDER BY e.severity DESC, e.published_at DESC
        LIMIT 10
      `,
        [upperTicker, row.date]
      );

      moves.push({
        date: row.date,
        price: parseFloat(row.adj_close),
        dailyReturn: parseFloat(row.daily_return),
        zScore: parseFloat(row.z_score),
        meanReturn: parseFloat(row.mean_return),
        stdReturn: parseFloat(row.std_return),
        direction: parseFloat(row.daily_return) >= 0 ? "up" : "down",
        newsEvents: newsResult.rows.map((n) => ({
          id: Number(n.id),
          publishedAt: n.published_at,
          headline: n.headline,
          summary: n.summary,
          eventType: n.event_type,
          severity: n.severity,
          sentiment: n.sentiment,
          confidence: n.confidence,
          source: n.source,
          providerCode: n.provider_code,
          relevance: n.relevance,
          impactDirection: n.impact_direction,
        })),
        explained: newsResult.rowCount! > 0,
      });
    }

    return NextResponse.json({
      ticker: upperTicker,
      sigma,
      days,
      moves,
      totalMoves: moves.length,
      explainedMoves: moves.filter((m) => m.explained).length,
      unexplainedMoves: moves.filter((m) => !m.explained).length,
    });
  } catch (err) {
    console.error("[NEWS EXPLAIN API]", err);
    return NextResponse.json(
      { error: "Failed to analyze moves" },
      { status: 500 }
    );
  }
}
