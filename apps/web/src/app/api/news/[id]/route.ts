/**
 * Single News Event API
 * GET /api/news/[id]
 *
 * Returns full event details including all ticker and sector mappings.
 */

import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const eventId = parseInt(id);
    if (isNaN(eventId)) {
      return NextResponse.json({ error: "Invalid event ID" }, { status: 400 });
    }

    const result = await pool.query(
      `
      SELECT
        e.id, e.published_at, e.source, e.headline, e.summary,
        e.event_type, e.severity, e.sentiment::float, e.confidence::float,
        e.provider_code, e.url, e.raw_content,
        COALESCE(
          (SELECT json_agg(json_build_object(
            'ticker', tm.ticker,
            'relevance', tm.relevance_score::float,
            'direction', tm.impact_direction
          )) FROM news_ticker_map tm WHERE tm.news_event_id = e.id),
          '[]'
        ) AS tickers,
        COALESCE(
          (SELECT json_agg(json_build_object(
            'sector', sm.sector,
            'impact', sm.impact_score::float
          )) FROM news_sector_map sm WHERE sm.news_event_id = e.id),
          '[]'
        ) AS sectors
      FROM news_events e
      WHERE e.id = $1
    `,
      [eventId]
    );

    if (result.rowCount === 0) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    const r = result.rows[0];
    return NextResponse.json({
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
      rawContent: r.raw_content,
      tickers: r.tickers,
      sectors: r.sectors,
    });
  } catch (err) {
    console.error("[NEWS API]", err);
    return NextResponse.json(
      { error: "Failed to fetch news event" },
      { status: 500 }
    );
  }
}
