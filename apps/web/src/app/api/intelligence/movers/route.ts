/**
 * Intelligence Movers API
 * GET /api/intelligence/movers
 *
 * Returns top gainers and losers from the latest trading day.
 * Compares latest close vs previous close for all equity tickers.
 */

import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const limit = parseInt(req.nextUrl.searchParams.get("limit") || "10");

    const result = await pool.query(`
      WITH latest_two AS (
        SELECT
          pd.ticker,
          pd.close,
          pd.volume,
          pd.date,
          ROW_NUMBER() OVER (PARTITION BY pd.ticker ORDER BY pd.date DESC) AS rn
        FROM prices_daily pd
        JOIN stocks s ON s.ticker = pd.ticker AND s.asset_type = 'equity'
      )
      SELECT
        t1.ticker,
        s.name,
        s.sector,
        t1.close AS last_close,
        t2.close AS prev_close,
        t1.volume,
        t1.date AS trade_date,
        CASE WHEN t2.close > 0 THEN (t1.close - t2.close) / t2.close ELSE NULL END AS return_pct
      FROM latest_two t1
      JOIN latest_two t2 ON t2.ticker = t1.ticker AND t2.rn = 2
      JOIN stocks s ON s.ticker = t1.ticker
      WHERE t1.rn = 1 AND t2.close > 0
      ORDER BY abs((t1.close - t2.close) / t2.close) DESC
    `);

    const all = result.rows.map(r => ({
      ticker: r.ticker,
      name: r.name,
      sector: r.sector,
      lastClose: parseFloat(r.last_close),
      prevClose: parseFloat(r.prev_close),
      returnPct: r.return_pct ? parseFloat(r.return_pct) : 0,
      volume: r.volume ? parseInt(r.volume) : null,
      tradeDate: r.trade_date,
    }));

    const gainers = all.filter(m => m.returnPct > 0).slice(0, limit);
    const losers = all.filter(m => m.returnPct < 0).slice(0, limit);

    return NextResponse.json({
      gainers,
      losers,
      tradeDate: all[0]?.tradeDate || null,
      totalStocks: all.length,
    });
  } catch (err) {
    console.error("[INTELLIGENCE MOVERS]", err);
    return NextResponse.json({ error: "Failed to fetch movers" }, { status: 500 });
  }
}
