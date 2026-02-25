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
 * Merges IBKR news (news_events) with NewsWeb filings (newsweb_filings).
 * Includes the stock's daily % price move on the event date.
 */

import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getPriceTable } from "@/lib/price-data-adapter";

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

    const tickerUpper = ticker.toUpperCase();
    const priceTable = await getPriceTable();

    // ── Query 1: IBKR news (existing) ────────────────────────
    const ibkrConditions: string[] = [
      "tm.ticker = $1",
      "e.severity >= $2",
      "e.published_at > NOW() - INTERVAL '90 days'",
    ];
    const ibkrParams: any[] = [tickerUpper, severityMin];
    let idx = 3;

    if (before) {
      ibkrConditions.push(`e.published_at < $${idx}`);
      ibkrParams.push(before);
      idx++;
    }

    const ibkrWhere = ibkrConditions.join(" AND ");

    const ibkrResult = await pool.query(
      `
      SELECT
        e.id, e.published_at, e.source, e.headline, e.summary,
        e.event_type, e.severity, e.sentiment::float, e.confidence::float,
        e.provider_code, e.url, e.structured_facts,
        tm.relevance_score::float AS relevance,
        tm.impact_direction,
        pd.close AS price_close,
        pd.prev_close,
        CASE WHEN pd.prev_close > 0
          THEN ((pd.close - pd.prev_close) / pd.prev_close * 100)::float
          ELSE NULL
        END AS day_return_pct,
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
      LEFT JOIN LATERAL (
        SELECT
          p1.close,
          (SELECT p2.close FROM public.${priceTable} p2
           WHERE upper(p2.ticker) = $1 AND p2.close IS NOT NULL
             AND p2.date < p1.date ORDER BY p2.date DESC LIMIT 1
          ) AS prev_close
        FROM public.${priceTable} p1
        WHERE upper(p1.ticker) = $1
          AND p1.close IS NOT NULL
          AND p1.date <= (e.published_at::date + INTERVAL '1 day')
          AND p1.date >= (e.published_at::date - INTERVAL '3 days')
        ORDER BY p1.date DESC
        LIMIT 1
      ) pd ON true
      WHERE ${ibkrWhere}
      ORDER BY e.published_at DESC
      LIMIT $${idx}
    `,
      [...ibkrParams, limit]
    );

    // ── Query 2: NewsWeb filings ─────────────────────────────
    const nwConditions: string[] = [
      "upper(nf.ticker) = $1",
      "COALESCE(nf.severity, 3) >= $2",
      "nf.published_at > NOW() - INTERVAL '90 days'",
    ];
    const nwParams: any[] = [tickerUpper, severityMin];
    let nwIdx = 3;

    if (before) {
      nwConditions.push(`nf.published_at < $${nwIdx}`);
      nwParams.push(before);
      nwIdx++;
    }

    const nwWhere = nwConditions.join(" AND ");

    const nwResult = await pool.query(
      `
      SELECT
        nf.id,
        nf.published_at,
        'newsweb' AS source,
        nf.headline,
        nf.body AS summary,
        nf.category AS event_type,
        COALESCE(nf.severity, 3) AS severity,
        nf.sentiment::float,
        nf.confidence::float,
        NULL AS provider_code,
        nf.url,
        nf.structured_facts,
        nf.issuer_name,
        pd.close AS price_close,
        pd.prev_close,
        CASE WHEN pd.prev_close > 0
          THEN ((pd.close - pd.prev_close) / pd.prev_close * 100)::float
          ELSE NULL
        END AS day_return_pct
      FROM newsweb_filings nf
      LEFT JOIN LATERAL (
        SELECT
          p1.close,
          (SELECT p2.close FROM public.${priceTable} p2
           WHERE upper(p2.ticker) = $1 AND p2.close IS NOT NULL
             AND p2.date < p1.date ORDER BY p2.date DESC LIMIT 1
          ) AS prev_close
        FROM public.${priceTable} p1
        WHERE upper(p1.ticker) = $1
          AND p1.close IS NOT NULL
          AND p1.date <= (nf.published_at::date + INTERVAL '1 day')
          AND p1.date >= (nf.published_at::date - INTERVAL '3 days')
        ORDER BY p1.date DESC
        LIMIT 1
      ) pd ON true
      WHERE ${nwWhere}
      ORDER BY nf.published_at DESC
      LIMIT $${nwIdx}
    `,
      [...nwParams, limit]
    );

    // ── Merge + sort by publishedAt DESC ─────────────────────
    const ibkrEvents = ibkrResult.rows.map((r) => ({
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
      dayReturnPct: r.day_return_pct != null ? Number(r.day_return_pct) : null,
      priceClose: r.price_close != null ? Number(r.price_close) : null,
      tickers: r.all_tickers,
      sectors: r.sectors,
    }));

    const nwEvents = nwResult.rows.map((r) => ({
      id: Number(r.id),
      publishedAt: r.published_at,
      source: "newsweb" as string,
      headline: r.headline,
      summary: r.summary ? (r.summary.length > 500 ? r.summary.slice(0, 497) + "..." : r.summary) : null,
      eventType: r.event_type,
      severity: r.severity,
      sentiment: r.sentiment,
      confidence: r.confidence,
      providerCode: null,
      url: r.url,
      structuredFacts: r.structured_facts,
      relevance: null,
      impactDirection: null,
      dayReturnPct: r.day_return_pct != null ? Number(r.day_return_pct) : null,
      priceClose: r.price_close != null ? Number(r.price_close) : null,
      tickers: [{ ticker: tickerUpper, relevance: 1.0, direction: "neutral" }],
      sectors: [],
    }));

    const allEvents = [...ibkrEvents, ...nwEvents]
      .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
      .slice(0, limit);

    return NextResponse.json({
      ticker: tickerUpper,
      events: allEvents,
      count: allEvents.length,
    });
  } catch (err) {
    console.error("[NEWS TICKER API]", err);
    return NextResponse.json(
      { error: "Failed to fetch ticker news" },
      { status: 500 }
    );
  }
}
