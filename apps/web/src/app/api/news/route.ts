/**
 * News Feed API
 * GET /api/news
 *
 * Query params:
 *   ?ticker=EQNR           — filter by ticker
 *   ?sector=Energy          — filter by sector
 *   ?severity_min=3         — minimum severity (1-5)
 *   ?event_type=earnings    — filter by event type
 *   ?limit=50               — max results (default 50, max 200)
 *   ?before=ISO_DATE        — pagination cursor
 */

import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const ticker = sp.get("ticker");
    const sector = sp.get("sector");
    const severityMin = parseInt(sp.get("severity_min") || "1");
    const eventType = sp.get("event_type");
    const limit = Math.min(parseInt(sp.get("limit") || "50"), 200);
    const before = sp.get("before");

    const conditions: string[] = ["e.severity >= $1"];
    const params: any[] = [severityMin];
    let idx = 2;

    if (ticker) {
      conditions.push(`EXISTS (SELECT 1 FROM news_ticker_map tm WHERE tm.news_event_id = e.id AND tm.ticker = $${idx})`);
      params.push(ticker.toUpperCase());
      idx++;
    }

    if (sector) {
      conditions.push(`EXISTS (SELECT 1 FROM news_sector_map sm WHERE sm.news_event_id = e.id AND sm.sector = $${idx})`);
      params.push(sector);
      idx++;
    }

    if (eventType) {
      conditions.push(`e.event_type = $${idx}`);
      params.push(eventType);
      idx++;
    }

    if (before) {
      conditions.push(`e.published_at < $${idx}`);
      params.push(before);
      idx++;
    }

    conditions.push(`e.published_at > NOW() - INTERVAL '30 days'`);

    const where = conditions.join(" AND ");

    const result = await pool.query(`
      SELECT
        e.id, e.published_at, e.source, e.headline, e.summary,
        e.event_type, e.severity, e.sentiment::float, e.confidence::float,
        e.provider_code, e.url, e.structured_facts,
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
      WHERE ${where}
      ORDER BY e.published_at DESC
      LIMIT $${idx}
    `, [...params, limit]);

    return NextResponse.json({
      events: result.rows.map(r => ({
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
        tickers: r.tickers,
        sectors: r.sectors,
      })),
      count: result.rowCount,
    });
  } catch (err) {
    console.error("[NEWS API]", err);
    return NextResponse.json({ error: "Failed to fetch news" }, { status: 500 });
  }
}
