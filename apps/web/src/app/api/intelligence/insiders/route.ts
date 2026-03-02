/**
 * Intelligence Insiders API
 * GET /api/intelligence/insiders
 *
 * Returns recent insider trades from NewsWeb filings.
 * Uses newsweb_filings (category='insider_trade') with structured_facts
 * for parsed transaction details (person, type, shares, value).
 */

import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const days = parseInt(req.nextUrl.searchParams.get("days") || "30");

    const result = await pool.query(`
      SELECT
        nf.id,
        nf.ticker,
        nf.issuer_name,
        nf.published_at,
        nf.headline,
        nf.url,
        nf.severity,
        nf.sentiment,
        nf.structured_facts,
        nf.ai_summary,
        s.sector,
        s.name AS stock_name
      FROM newsweb_filings nf
      LEFT JOIN stocks s ON s.ticker = nf.ticker
      WHERE nf.category = 'insider_trade'
        AND nf.published_at >= NOW() - INTERVAL '1 day' * $1
      ORDER BY nf.published_at DESC
      LIMIT 100
    `, [days]);

    const trades = result.rows.map(r => {
      const facts = r.structured_facts || {};
      return {
        id: r.id,
        ticker: r.ticker,
        stockName: r.stock_name || r.issuer_name,
        sector: r.sector,
        publishedAt: r.published_at,
        headline: r.headline,
        url: r.url,
        severity: r.severity,
        sentiment: r.sentiment ? parseFloat(r.sentiment) : null,
        summary: r.ai_summary,
        // Parsed transaction details from structured_facts
        personName: facts.person_name || null,
        personRole: facts.person_role || null,
        transactionType: facts.transaction_type || null, // BUY, SELL, EXERCISE, GRANT
        shares: facts.shares ? Number(facts.shares) : null,
        pricePerShare: facts.price_per_share ? Number(facts.price_per_share) : null,
        totalValue: facts.total_value ? Number(facts.total_value) : null,
        importance: r.severity || 2,
      };
    });

    const buyCount = trades.filter(t => t.transactionType?.toUpperCase() === "BUY").length;
    const sellCount = trades.filter(t => t.transactionType?.toUpperCase() === "SELL").length;

    return NextResponse.json({
      trades,
      summary: { total: trades.length, buyCount, sellCount },
    });
  } catch (err) {
    console.error("[INTELLIGENCE INSIDERS]", err);
    return NextResponse.json({ error: "Failed to fetch insider data" }, { status: 500 });
  }
}
