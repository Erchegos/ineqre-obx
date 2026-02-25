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
 *
 * Returns news events with ticker/sector maps. Price returns computed in a
 * separate batch query to avoid slow LATERAL JOINs.
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
    const params: (string | number)[] = [severityMin];
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

    conditions.push(`e.published_at > NOW() - INTERVAL '90 days'`);

    const where = conditions.join(" AND ");

    // Step 1: Fetch events with ticker/sector maps (fast — no price JOINs)
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
          ) ORDER BY tm.relevance_score DESC NULLS LAST) FROM news_ticker_map tm WHERE tm.news_event_id = e.id),
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

    // Step 2: Batch price lookup for primary tickers
    // Collect unique (ticker, date) pairs
    const priceLookups = new Map<string, string>(); // eventId -> ticker
    const eventDates = new Map<string, string>(); // eventId -> date
    for (const row of result.rows) {
      const tickers = row.tickers as { ticker: string; relevance: number }[];
      if (Array.isArray(tickers) && tickers.length > 0) {
        priceLookups.set(String(row.id), tickers[0].ticker);
        eventDates.set(String(row.id), new Date(row.published_at).toISOString().slice(0, 10));
      }
    }

    // Build price return map: ticker|date -> dayReturnPct
    const priceMap = new Map<string, { close: number; returnPct: number | null }>();
    if (priceLookups.size > 0) {
      const uniqueTickers = [...new Set(priceLookups.values())];
      try {
        const priceResult = await pool.query(`
          WITH ranked AS (
            SELECT ticker, date, close,
              LAG(close) OVER (PARTITION BY upper(ticker) ORDER BY date) AS prev_close
            FROM prices_daily
            WHERE upper(ticker) = ANY($1::text[])
              AND close IS NOT NULL
              AND date > NOW() - INTERVAL '95 days'
          )
          SELECT upper(ticker) as ticker, date::text as date, close::float,
            CASE WHEN prev_close > 0
              THEN ((close - prev_close) / prev_close * 100)::float
              ELSE NULL
            END AS day_return_pct
          FROM ranked
          WHERE prev_close IS NOT NULL
        `, [uniqueTickers.map(t => t.toUpperCase())]);

        for (const pr of priceResult.rows) {
          priceMap.set(`${pr.ticker}|${pr.date}`, {
            close: pr.close,
            returnPct: pr.day_return_pct,
          });
        }
      } catch {
        // Price lookup is non-critical
      }
    }

    // Step 3: Merge and respond
    const events = result.rows.map(r => {
      const eventId = String(r.id);
      const primaryTicker = priceLookups.get(eventId) || null;
      const eventDate = eventDates.get(eventId);
      let dayReturnPct: number | null = null;
      let priceClose: number | null = null;

      if (primaryTicker && eventDate) {
        // Try exact date, then -1d, -2d, -3d
        const key = primaryTicker.toUpperCase();
        for (let offset = 0; offset <= 3; offset++) {
          const d = new Date(eventDate);
          d.setDate(d.getDate() - offset);
          const dStr = d.toISOString().slice(0, 10);
          const hit = priceMap.get(`${key}|${dStr}`);
          if (hit) {
            priceClose = hit.close;
            dayReturnPct = hit.returnPct;
            break;
          }
        }
      }

      return {
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
        structuredFacts: r.structured_facts || null,
        tickers: r.tickers,
        sectors: r.sectors,
        primaryTicker,
        dayReturnPct: dayReturnPct != null ? Number(dayReturnPct) : null,
        priceClose: priceClose != null ? Number(priceClose) : null,
      };
    });

    return NextResponse.json({ events, count: events.length });
  } catch (err) {
    console.error("[NEWS API]", err);
    return NextResponse.json({ error: "Failed to fetch news" }, { status: 500 });
  }
}
