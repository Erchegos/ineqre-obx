/**
 * "Why Did It Move?" API — Enhanced Multi-Source
 * GET /api/news/explain/[ticker]
 *
 * Query params:
 *   ?days=30           — lookback window (default 30, max 90)
 *   ?sigma=2           — move threshold in std devs (default 2)
 *
 * Finds significant price moves (>Nσ) and correlates them with:
 *   1. IBKR news events (±24h)
 *   2. NewsWeb regulatory filings (±48h)
 *   3. Insider transactions (±3 days)
 *   4. Short position changes (same day)
 *   5. OBX market context (systematic move?)
 *   6. Commodity price moves (for energy/materials stocks)
 */

import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getPriceTable } from "@/lib/price-data-adapter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Commodity symbols relevant to OSE sectors
const SECTOR_COMMODITY_MAP: Record<string, string[]> = {
  Energy: ["BZ=F", "CL=F", "NG=F"],
  "Oil & Gas": ["BZ=F", "CL=F", "NG=F"],
  "Oil Service": ["BZ=F", "CL=F"],
  Materials: ["ALI=F", "GC=F", "SI=F"],
  Shipping: ["BZ=F"],
};

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
    const priceTable = await getPriceTable();

    // ── 1. Get significant moves ──────────────────────────────────
    const priceResult = await pool.query(
      `
      WITH daily AS (
        SELECT
          date,
          COALESCE(adj_close, close) AS adj_close,
          LAG(COALESCE(adj_close, close)) OVER (ORDER BY date) AS prev_close
        FROM ${priceTable}
        WHERE upper(ticker) = $1
          AND close IS NOT NULL AND close > 0
          AND date > NOW() - INTERVAL '${days + 60} days'
        ORDER BY date
      ),
      returns AS (
        SELECT
          date,
          adj_close,
          (adj_close - prev_close) / NULLIF(prev_close, 0) AS daily_return
        FROM daily
        WHERE prev_close IS NOT NULL AND prev_close > 0
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

    if (priceResult.rows.length === 0) {
      return NextResponse.json(
        {
          ticker: upperTicker,
          sigma,
          days,
          moves: [],
          totalMoves: 0,
          explainedMoves: 0,
          unexplainedMoves: 0,
        },
        { headers: { "Cache-Control": "public, s-maxage=120, stale-while-revalidate=600" } }
      );
    }

    // Collect all move dates for batch queries
    const moveDates = priceResult.rows.map((r) => r.date);
    const minDate = new Date(
      Math.min(...moveDates.map((d: string) => new Date(d).getTime())) - 3 * 86400000
    )
      .toISOString()
      .split("T")[0];
    const maxDate = new Date(
      Math.max(...moveDates.map((d: string) => new Date(d).getTime())) + 3 * 86400000
    )
      .toISOString()
      .split("T")[0];

    // ── 2. Get stock sector for commodity lookup ──────────────────
    const sectorResult = await pool.query(
      `SELECT sector FROM stocks WHERE upper(ticker) = $1 LIMIT 1`,
      [upperTicker]
    );
    const sector = sectorResult.rows[0]?.sector || null;
    const commoditySymbols = sector
      ? SECTOR_COMMODITY_MAP[sector] || []
      : [];

    // ── 3. Batch fetch ALL correlated data in parallel ────────────
    const [ibkrNews, nwFilings, insiderTx, shortChanges, obxReturns, commodityMoves] =
      await Promise.all([
        // 3a. IBKR news events (wide range, filter per-move later)
        pool.query(
          `
          SELECT
            e.id, e.published_at, e.headline, e.summary,
            e.event_type, e.severity, e.sentiment::float, e.confidence::float,
            e.source, e.provider_code, e.url,
            tm.relevance_score::float AS relevance,
            tm.impact_direction
          FROM news_events e
          JOIN news_ticker_map tm ON tm.news_event_id = e.id
          WHERE tm.ticker = $1
            AND e.published_at BETWEEN ($2::date - INTERVAL '2 days')
                                     AND ($3::date + INTERVAL '2 days')
          ORDER BY e.published_at DESC
        `,
          [upperTicker, minDate, maxDate]
        ),

        // 3b. NewsWeb filings (wider ±48h window for regulatory)
        pool.query(
          `
          SELECT
            nf.id,
            nf.published_at,
            nf.headline,
            LEFT(nf.body, 300) AS summary,
            nf.category,
            COALESCE(nf.severity, 3) AS severity,
            nf.sentiment::float,
            nf.url,
            nf.issuer_name
          FROM newsweb_filings nf
          WHERE upper(nf.ticker) = $1
            AND nf.published_at BETWEEN ($2::date - INTERVAL '3 days')
                                     AND ($3::date + INTERVAL '2 days')
          ORDER BY nf.published_at DESC
        `,
          [upperTicker, minDate, maxDate]
        ),

        // 3c. Insider transactions (±3 days)
        pool.query(
          `
          SELECT
            it.id,
            it.transaction_date,
            it.person_name,
            it.person_role,
            it.transaction_type,
            it.shares,
            it.price_per_share::float,
            it.total_value_nok::float,
            it.holdings_after,
            it.is_related_party,
            nf.headline AS filing_headline,
            nf.url AS filing_url
          FROM insider_transactions it
          LEFT JOIN newsweb_filings nf ON nf.id = it.filing_id
          WHERE upper(it.ticker) = $1
            AND it.transaction_date BETWEEN $2::date AND $3::date
          ORDER BY it.transaction_date DESC
        `,
          [upperTicker, minDate, maxDate]
        ),

        // 3d. Short position changes
        pool.query(
          `
          SELECT
            sp.date,
            sp.short_pct::float,
            sp.prev_short_pct::float,
            sp.change_pct::float,
            sp.active_positions,
            sp.total_short_shares::float
          FROM short_positions sp
          WHERE upper(sp.ticker) = $1
            AND sp.date BETWEEN $2::date AND $3::date
          ORDER BY sp.date DESC
        `,
          [upperTicker, minDate, maxDate]
        ),

        // 3e. OBX index returns on move dates
        pool.query(
          `
          SELECT
            date,
            ret_1d::float AS obx_return
          FROM obx_features
          WHERE ticker = 'OBX'
            AND date BETWEEN $1::date AND $2::date
          ORDER BY date DESC
        `,
          [minDate, maxDate]
        ),

        // 3f. Commodity price moves (if sector is relevant)
        commoditySymbols.length > 0
          ? pool.query(
              `
              SELECT
                cp.symbol,
                cp.date,
                cp.close::float,
                LAG(cp.close::float) OVER (PARTITION BY cp.symbol ORDER BY cp.date) AS prev_close
              FROM commodity_prices cp
              WHERE cp.symbol = ANY($1)
                AND cp.date BETWEEN ($2::date - INTERVAL '5 days') AND $3::date
              ORDER BY cp.symbol, cp.date
            `,
              [commoditySymbols, minDate, maxDate]
            )
          : Promise.resolve({ rows: [] }),
      ]);

    // ── 4. Index data for fast lookups ────────────────────────────
    const obxByDate = new Map<string, number>();
    for (const r of obxReturns.rows) {
      obxByDate.set(dateKey(r.date), r.obx_return);
    }

    const shortByDate = new Map<string, (typeof shortChanges.rows)[0]>();
    for (const r of shortChanges.rows) {
      shortByDate.set(dateKey(r.date), r);
    }

    // Commodity returns by date → { symbol → return% }
    const commodityReturnsByDate = new Map<string, Record<string, number>>();
    for (const r of commodityMoves.rows) {
      if (r.prev_close && r.prev_close > 0) {
        const ret = ((r.close - r.prev_close) / r.prev_close) * 100;
        const dk = dateKey(r.date);
        if (!commodityReturnsByDate.has(dk)) commodityReturnsByDate.set(dk, {});
        commodityReturnsByDate.get(dk)![r.symbol] = ret;
      }
    }

    // ── 5. Assemble moves with all explanations ───────────────────
    const moves = priceResult.rows.map((row) => {
      const moveDate = new Date(row.date);
      const moveDateMs = moveDate.getTime();
      const dk = dateKey(row.date);

      // 5a. IBKR news within ±24h
      const correlatedNews = ibkrNews.rows
        .filter((n) => {
          const pubMs = new Date(n.published_at).getTime();
          return Math.abs(pubMs - moveDateMs) <= 24 * 3600 * 1000;
        })
        .map((n) => ({
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
          url: n.url,
          relevance: n.relevance,
          impactDirection: n.impact_direction,
        }));

      // 5b. NewsWeb filings within ±48h
      const correlatedFilings = nwFilings.rows
        .filter((f) => {
          const pubMs = new Date(f.published_at).getTime();
          return Math.abs(pubMs - moveDateMs) <= 48 * 3600 * 1000;
        })
        .map((f) => ({
          id: Number(f.id),
          publishedAt: f.published_at,
          headline: f.headline,
          summary: f.summary,
          eventType: f.category || "other",
          severity: f.severity,
          sentiment: f.sentiment,
          confidence: null,
          source: "newsweb",
          providerCode: null,
          url: f.url,
          relevance: null,
          impactDirection: null,
        }));

      // 5c. Insider transactions within ±3 days
      const correlatedInsiders = insiderTx.rows
        .filter((it) => {
          const txMs = new Date(it.transaction_date).getTime();
          return Math.abs(txMs - moveDateMs) <= 3 * 86400 * 1000;
        })
        .map((it) => ({
          personName: it.person_name,
          personRole: it.person_role,
          transactionType: it.transaction_type,
          shares: Number(it.shares),
          pricePerShare: it.price_per_share,
          totalValueNok: it.total_value_nok,
          holdingsAfter: it.holdings_after ? Number(it.holdings_after) : null,
          isRelatedParty: it.is_related_party,
          transactionDate: it.transaction_date,
          filingHeadline: it.filing_headline,
          filingUrl: it.filing_url,
        }));

      // 5d. Short position change
      const shortData = shortByDate.get(dk);
      const shortContext =
        shortData && shortData.change_pct != null
          ? {
              shortPct: shortData.short_pct,
              prevShortPct: shortData.prev_short_pct,
              changePct: shortData.change_pct,
              activePositions: shortData.active_positions,
              significant: Math.abs(shortData.change_pct) >= 0.1,
            }
          : null;

      // 5e. OBX market return
      const obxReturn = obxByDate.get(dk);
      const dailyReturn = parseFloat(row.daily_return);
      const obxContext =
        obxReturn != null
          ? {
              obxReturn,
              isSystematic:
                Math.sign(obxReturn) === Math.sign(dailyReturn) &&
                Math.abs(obxReturn) > 0.005,
              obxMagnitude: Math.abs(obxReturn),
            }
          : null;

      // 5f. Commodity context
      const commodities = commodityReturnsByDate.get(dk);
      const commodityContext =
        commodities && Object.keys(commodities).length > 0
          ? Object.entries(commodities)
              .filter(([, ret]) => Math.abs(ret) > 0.5)
              .map(([symbol, ret]) => ({
                symbol,
                returnPct: ret,
                aligned: Math.sign(ret) === Math.sign(dailyReturn),
              }))
          : [];

      // ── Determine explanation status ─────────────────────────
      const allNewsEvents = [...correlatedNews, ...correlatedFilings];
      const hasNews = allNewsEvents.length > 0;
      const hasInsider = correlatedInsiders.length > 0;
      const hasShortChange = shortContext?.significant || false;
      const hasSystematic = obxContext?.isSystematic || false;
      const hasCommodity = commodityContext.length > 0 && commodityContext.some((c) => c.aligned);

      const explained = hasNews || hasInsider || hasShortChange;

      // Generate context labels for the move
      const contextLabels: string[] = [];
      if (hasNews) contextLabels.push(`${allNewsEvents.length} NEWS`);
      if (hasInsider)
        contextLabels.push(
          `${correlatedInsiders.length} INSIDER${correlatedInsiders.length > 1 ? "S" : ""}`
        );
      if (hasShortChange) contextLabels.push("SHORT Δ");
      if (hasSystematic) contextLabels.push("MARKET");
      if (hasCommodity) contextLabels.push("COMMODITY");

      return {
        date: row.date,
        price: parseFloat(row.adj_close),
        dailyReturn,
        zScore: parseFloat(row.z_score),
        direction: dailyReturn >= 0 ? ("up" as const) : ("down" as const),
        // News + filings combined
        newsEvents: allNewsEvents,
        // New: additional context
        insiderTransactions: correlatedInsiders,
        shortContext,
        marketContext: obxContext,
        commodityContext,
        // Explanation status
        explained,
        contextLabels,
        explainedBy: {
          news: hasNews,
          insider: hasInsider,
          shortChange: hasShortChange,
          systematic: hasSystematic,
          commodity: hasCommodity,
        },
      };
    });

    const response = {
      ticker: upperTicker,
      sigma,
      days,
      moves,
      totalMoves: moves.length,
      explainedMoves: moves.filter((m) => m.explained).length,
      unexplainedMoves: moves.filter((m) => !m.explained).length,
      partiallyExplained: moves.filter(
        (m) =>
          !m.explained &&
          (m.marketContext?.isSystematic || m.commodityContext.length > 0)
      ).length,
    };

    return NextResponse.json(response, {
      headers: {
        "Cache-Control": "public, s-maxage=120, stale-while-revalidate=600",
      },
    });
  } catch (err) {
    console.error("[NEWS EXPLAIN API]", err);
    return NextResponse.json(
      { error: "Failed to analyze moves" },
      { status: 500 }
    );
  }
}

function dateKey(d: string | Date): string {
  const dt = typeof d === "string" ? d : d.toISOString();
  return dt.slice(0, 10);
}
