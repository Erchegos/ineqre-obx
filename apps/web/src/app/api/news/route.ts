/**
 * News Feed API — Unified Feed
 * GET /api/news
 *
 * Merges two data sources:
 *   1. news_events (IBKR — Dow Jones, Briefing, FLY)
 *   2. newsweb_filings (Oslo Børs NewsWeb — regulatory filings)
 *
 * Query params:
 *   ?ticker=EQNR           — filter by ticker
 *   ?sector=Energy          — filter by sector (IBKR only)
 *   ?severity_min=3         — minimum severity (1-5)
 *   ?event_type=earnings    — filter by event type
 *   ?source=NEWSWEB         — filter by source (IBKR, NEWSWEB)
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
    const sourceFilter = sp.get("source");
    const limit = Math.min(parseInt(sp.get("limit") || "50"), 200);
    const before = sp.get("before");

    // Build WHERE conditions on the unified CTE
    const conditions: string[] = ["u.severity >= $1"];
    const params: (string | number)[] = [severityMin];
    let idx = 2;

    if (ticker) {
      conditions.push(`u.primary_ticker = $${idx}`);
      params.push(ticker.toUpperCase());
      idx++;
    }

    if (sector) {
      // Sector filtering only works on IBKR events (news_sector_map)
      conditions.push(`EXISTS (SELECT 1 FROM news_sector_map sm WHERE sm.news_event_id = u.raw_id AND u.source != 'NEWSWEB' AND sm.sector = $${idx})`);
      params.push(sector);
      idx++;
    }

    if (eventType) {
      conditions.push(`u.event_type = $${idx}`);
      params.push(eventType);
      idx++;
    }

    if (sourceFilter) {
      conditions.push(`u.source = $${idx}`);
      params.push(sourceFilter.toUpperCase());
      idx++;
    }

    if (before) {
      conditions.push(`u.published_at < $${idx}`);
      params.push(before);
      idx++;
    }

    conditions.push(`u.published_at > NOW() - INTERVAL '90 days'`);

    const where = conditions.join(" AND ");

    // Step 1: Unified CTE — merge news_events + newsweb_filings
    const result = await pool.query(`
      WITH unified AS (
        -- Source 1: IBKR news events
        SELECT
          e.id AS raw_id,
          e.id AS id,
          e.published_at,
          COALESCE(e.source, 'IBKR') AS source,
          e.headline,
          e.summary,
          e.event_type,
          COALESCE(e.severity, 2) AS severity,
          e.sentiment::float AS sentiment,
          e.confidence::float AS confidence,
          e.provider_code,
          e.url,
          e.structured_facts,
          -- Ticker from ticker map
          (SELECT tm.ticker FROM news_ticker_map tm
           WHERE tm.news_event_id = e.id
           ORDER BY tm.relevance_score DESC NULLS LAST LIMIT 1) AS primary_ticker,
          -- Full ticker array
          COALESCE(
            (SELECT json_agg(json_build_object(
              'ticker', tm.ticker,
              'relevance', tm.relevance_score::float,
              'direction', tm.impact_direction
            ) ORDER BY tm.relevance_score DESC NULLS LAST) FROM news_ticker_map tm WHERE tm.news_event_id = e.id),
            '[]'
          ) AS tickers,
          -- Sectors
          COALESCE(
            (SELECT json_agg(json_build_object(
              'sector', sm.sector,
              'impact', sm.impact_score::float
            )) FROM news_sector_map sm WHERE sm.news_event_id = e.id),
            '[]'
          ) AS sectors
        FROM news_events e

        UNION ALL

        -- Source 2: NewsWeb + MFN regulatory filings
        SELECT
          nf.id AS raw_id,
          nf.id + 1000000 AS id,
          nf.published_at,
          CASE WHEN nf.newsweb_id LIKE 'mfn-%' THEN 'MFN' ELSE 'NEWSWEB' END AS source,
          nf.headline,
          nf.ai_summary AS summary,
          nf.category AS event_type,
          COALESCE(nf.severity, 2) AS severity,
          nf.sentiment::float AS sentiment,
          nf.confidence::float AS confidence,
          NULL AS provider_code,
          nf.url,
          nf.structured_facts,
          upper(nf.ticker) AS primary_ticker,
          CASE WHEN nf.ticker IS NOT NULL THEN
            json_build_array(json_build_object(
              'ticker', upper(nf.ticker),
              'relevance', 1.0,
              'direction', CASE
                WHEN nf.sentiment::float > 0.2 THEN 'positive'
                WHEN nf.sentiment::float < -0.2 THEN 'negative'
                ELSE 'neutral'
              END
            ))
          ELSE '[]'::json END AS tickers,
          CASE WHEN nf.ticker IS NOT NULL THEN
            COALESCE(
              (SELECT json_build_array(json_build_object(
                'sector', s.sector,
                'impact', nf.sentiment::float
              )) FROM stocks s WHERE upper(s.ticker) = upper(nf.ticker) AND s.sector IS NOT NULL LIMIT 1),
              '[]'::json
            )
          ELSE '[]'::json END AS sectors
        FROM newsweb_filings nf
      )
      SELECT u.*
      FROM unified u
      WHERE ${where}
      ORDER BY u.published_at DESC
      LIMIT $${idx}
    `, [...params, limit]);

    // Step 2: Batch price lookup for primary tickers
    const priceLookups = new Map<string, string>();
    const eventDates = new Map<string, string>();
    for (const row of result.rows) {
      const eventId = String(row.id);
      const primaryTicker = row.primary_ticker;
      if (primaryTicker) {
        priceLookups.set(eventId, primaryTicker);
        eventDates.set(eventId, new Date(row.published_at).toISOString().slice(0, 10));
      } else {
        const tickers = row.tickers as { ticker: string; relevance: number }[];
        if (Array.isArray(tickers) && tickers.length > 0) {
          priceLookups.set(eventId, tickers[0].ticker);
          eventDates.set(eventId, new Date(row.published_at).toISOString().slice(0, 10));
        }
      }
    }

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

    // Step 4: Server-side dedup — same ticker + similar headline within 1h = keep higher severity
    const deduped: typeof events = [];
    const seen = new Map<string, number>(); // dedupKey → index in deduped array
    for (const ev of events) {
      const dedupKey = `${(ev.primaryTicker || "").toUpperCase()}|${ev.headline.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 80)}`;
      const existingIdx = seen.get(dedupKey);
      if (existingIdx != null) {
        // Keep the one with higher severity, or prefer NewsWeb over MFN (has body text)
        const existing = deduped[existingIdx];
        if (ev.severity > existing.severity || (ev.severity === existing.severity && ev.source === "NEWSWEB")) {
          deduped[existingIdx] = ev;
        }
      } else {
        seen.set(dedupKey, deduped.length);
        deduped.push(ev);
      }
    }

    return NextResponse.json({ events: deduped, count: deduped.length });
  } catch (err) {
    console.error("[NEWS API]", err);
    return NextResponse.json({ error: "Failed to fetch news" }, { status: 500 });
  }
}
