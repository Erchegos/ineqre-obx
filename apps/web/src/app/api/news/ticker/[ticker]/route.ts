/**
 * Per-Ticker News Feed API
 * GET /api/news/ticker/[ticker]
 *
 * Query params:
 *   ?limit=30          — max results (default 30, max 100)
 *   ?before=ISO_DATE   — pagination cursor
 *   ?severity_min=1    — minimum severity filter
 *
 * Returns news events for a specific ticker, ordered by recency.
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
    const limit = Math.min(parseInt(sp.get("limit") || "30"), 100);
    const before = sp.get("before");
    const severityMin = parseInt(sp.get("severity_min") || "1");

    const conditions: string[] = [
      "tm.ticker = $1",
      "e.severity >= $2",
      "e.published_at > NOW() - INTERVAL '14 days'",
    ];
    const queryParams: any[] = [ticker.toUpperCase(), severityMin];
    let idx = 3;

    if (before) {
      conditions.push(`e.published_at < $${idx}`);
      queryParams.push(before);
      idx++;
    }

    const where = conditions.join(" AND ");

    const result = await pool.query(
      `
      SELECT
        e.id, e.published_at, e.source, e.headline, e.summary,
        e.event_type, e.severity, e.sentiment::float, e.confidence::float,
        e.provider_code, e.url, e.structured_facts,
        tm.relevance_score::float AS relevance,
        tm.impact_direction,
        COALESCE(
          (SELECT json_agg(json_build_object(
            'ticker', t2.ticker,
            'relevance', t2.relevance_score::float,
            'direction', t2.impact_direction
          )) FROM news_ticker_map t2 WHERE t2.news_event_id = e.id),
          '[]'
        ) AS all_tickers,
        COALESCE(
          (SELECT json_agg(json_build_object(
            'sector', sm.sector,
            'impact', sm.impact_score::float
          )) FROM news_sector_map sm WHERE sm.news_event_id = e.id),
          '[]'
        ) AS sectors
      FROM news_events e
      JOIN news_ticker_map tm ON tm.news_event_id = e.id
      WHERE ${where}
      ORDER BY e.published_at DESC
      LIMIT $${idx}
    `,
      [...queryParams, limit]
    );

    return NextResponse.json({
      ticker: ticker.toUpperCase(),
      events: result.rows.map((r) => ({
        id: Number(r.id),
        publishedAt: r.published_at,
        source: r.source,
        headline: r.headline,
        summary: r.summary,
        eventType: r.event_type,
        severity: r.severity,
        sentiment: r.sentiment,
        confidence: r.confidence,
        providerCode: r.provider_code,
        url: r.url,
        structuredFacts: r.structured_facts,
        relevance: r.relevance,
        impactDirection: r.impact_direction,
        tickers: r.all_tickers,
        sectors: r.sectors,
      })),
      count: result.rowCount,
    });
  } catch (err) {
    console.error("[NEWS TICKER API]", err);
    return NextResponse.json(
      { error: "Failed to fetch ticker news" },
      { status: 500 }
    );
  }
}
