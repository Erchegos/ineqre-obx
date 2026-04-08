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

    // ── Build NewsWeb query params ────────────────────────────
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

    // Pre-compute price series with LAG once per ticker (shared by both queries).
    // This replaces per-row nested LATERAL subqueries (N×subquery) with a single
    // index scan + window function, then a simple range lookup per event.
    const priceSeriesQuery = `
      SELECT
        date,
        close,
        LAG(close) OVER (ORDER BY date) AS prev_close
      FROM public.${priceTable}
      WHERE upper(ticker) = $1
        AND close IS NOT NULL
        AND date >= NOW() - INTERVAL '95 days'
      ORDER BY date
    `;

    // ── Run BOTH event queries + price series in parallel ───────────────────────
    const [ibkrResult, nwResult, priceSeriesResult] = await Promise.all([
      pool.query(
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
        WHERE ${ibkrWhere}
        ORDER BY e.published_at DESC
        LIMIT $${idx}
      `,
        [...ibkrParams, limit]
      ),
      pool.query(
        `
        SELECT
          nf.id,
          nf.published_at,
          CASE WHEN nf.newsweb_id LIKE 'mfn-%' THEN 'MFN' ELSE 'NEWSWEB' END AS source,
          nf.headline,
          LEFT(nf.body, 500) AS summary,
          nf.category AS event_type,
          COALESCE(nf.severity, 3) AS severity,
          nf.sentiment::float,
          nf.confidence::float,
          NULL AS provider_code,
          nf.url,
          nf.structured_facts,
          nf.issuer_name
        FROM newsweb_filings nf
        WHERE ${nwWhere}
        ORDER BY nf.published_at DESC
        LIMIT $${nwIdx}
      `,
        [...nwParams, limit]
      ),
      pool.query(priceSeriesQuery, [tickerUpper]),
    ]);

    // Build a sorted array for efficient nearest-price lookup
    type PriceRow = { date: Date; close: number; prev_close: number | null };
    const priceSeries: PriceRow[] = priceSeriesResult.rows.map((r) => ({
      date: r.date instanceof Date ? r.date : new Date(r.date),
      close: Number(r.close),
      prev_close: r.prev_close != null ? Number(r.prev_close) : null,
    }));

    // Find the latest price row within [eventDate-3d, eventDate+1d]
    const findPrice = (publishedAt: Date): { close: number; prev_close: number | null } | null => {
      const evMs = publishedAt.getTime();
      const minMs = evMs - 3 * 86400_000;
      const maxMs = evMs + 1 * 86400_000;
      let best: PriceRow | null = null;
      for (const row of priceSeries) {
        const ms = row.date.getTime();
        if (ms >= minMs && ms <= maxMs) {
          if (!best || ms > best.date.getTime()) best = row;
        }
      }
      return best ? { close: best.close, prev_close: best.prev_close } : null;
    };

    // ── Merge + sort by publishedAt DESC ─────────────────────
    const ibkrEvents = ibkrResult.rows.map((r) => {
      const pd = findPrice(new Date(r.published_at));
      const dayReturnPct =
        pd && pd.prev_close && pd.prev_close > 0
          ? ((pd.close - pd.prev_close) / pd.prev_close) * 100
          : null;
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
        structuredFacts: r.structured_facts,
        relevance: r.relevance,
        impactDirection: r.impact_direction,
        dayReturnPct,
        priceClose: pd ? pd.close : null,
        tickers: r.all_tickers,
        sectors: r.sectors,
      };
    });

    const nwEvents = nwResult.rows.map((r) => {
      const pd = findPrice(new Date(r.published_at));
      const dayReturnPct =
        pd && pd.prev_close && pd.prev_close > 0
          ? ((pd.close - pd.prev_close) / pd.prev_close) * 100
          : null;
      return {
        id: Number(r.id),
        publishedAt: r.published_at,
        source: r.source as string,
        headline: r.headline,
        summary: r.summary || null,
        eventType: r.event_type,
        severity: r.severity,
        sentiment: r.sentiment,
        confidence: r.confidence,
        providerCode: null,
        url: r.url,
        structuredFacts: r.structured_facts,
        relevance: null,
        impactDirection: null,
        dayReturnPct,
        priceClose: pd ? pd.close : null,
        tickers: [{ ticker: tickerUpper, relevance: 1.0, direction: "neutral" }],
        sectors: [],
      };
    });

    const allEvents = [...ibkrEvents, ...nwEvents]
      .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
      .slice(0, limit);

    return NextResponse.json(
      {
        ticker: tickerUpper,
        events: allEvents,
        count: allEvents.length,
      },
      {
        headers: {
          "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
        },
      }
    );
  } catch (err) {
    console.error("[NEWS TICKER API]", err);
    return NextResponse.json(
      { error: "Failed to fetch ticker news" },
      { status: 500 }
    );
  }
}
