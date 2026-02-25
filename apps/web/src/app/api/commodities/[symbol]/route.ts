/**
 * Per-Commodity Detail API
 * GET /api/commodities/[symbol]
 *
 * Returns full price history and stock sensitivity for a single commodity.
 *
 * Query params:
 *   ?days=365    — history depth (default all)
 */

import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ symbol: string }> }
) {
  try {
    const { symbol } = await params;
    const sp = req.nextUrl.searchParams;
    const days = parseInt(sp.get("days") || "0");

    const upperSymbol = decodeURIComponent(symbol).toUpperCase();

    // Validate symbol
    if (!/^[A-Z0-9=]{1,10}$/.test(upperSymbol)) {
      return NextResponse.json({ error: "Invalid symbol" }, { status: 400 });
    }

    const dateFilter = days > 0 ? `AND date >= NOW() - INTERVAL '${days} days'` : "";

    // Price history
    const histResult = await pool.query(
      `SELECT date, open::float, high::float, low::float, close::float,
              volume::bigint AS volume, currency
       FROM commodity_prices
       WHERE symbol = $1 ${dateFilter}
       ORDER BY date ASC`,
      [upperSymbol]
    );

    if (histResult.rows.length === 0) {
      return NextResponse.json(
        { error: "No data for this commodity" },
        { status: 404 }
      );
    }

    // Stock sensitivities
    const sensResult = await pool.query(
      `SELECT
        css.ticker,
        css.beta::float,
        css.correlation_60d::float AS corr_60d,
        css.correlation_252d::float AS corr_252d,
        css.r_squared::float AS r_squared,
        css.as_of_date,
        s.name AS stock_name,
        s.sector
      FROM commodity_stock_sensitivity css
      LEFT JOIN stocks s ON upper(s.ticker) = upper(css.ticker)
      WHERE css.commodity_symbol = $1
      ORDER BY ABS(css.beta::float) DESC`,
      [upperSymbol]
    );

    // Stats
    const prices = histResult.rows;
    const closes = prices.map((r) => r.close);
    const latest = prices[prices.length - 1];
    const prevClose = prices.length > 1 ? prices[prices.length - 2].close : null;
    const dayReturn =
      prevClose && prevClose > 0
        ? ((latest.close - prevClose) / prevClose) * 100
        : null;

    // Simple moving averages
    const sma20 =
      closes.length >= 20
        ? closes.slice(-20).reduce((a, b) => a + b, 0) / 20
        : null;
    const sma50 =
      closes.length >= 50
        ? closes.slice(-50).reduce((a, b) => a + b, 0) / 50
        : null;

    // YTD return
    const yearStart = prices.find(
      (r) => r.date >= new Date().getFullYear() + "-01-01"
    );
    const ytdReturn =
      yearStart && yearStart.close > 0
        ? ((latest.close - yearStart.close) / yearStart.close) * 100
        : null;

    return NextResponse.json({
      symbol: upperSymbol,
      currency: latest.currency,
      latest: {
        date: latest.date,
        close: latest.close,
        dayReturnPct: dayReturn,
      },
      stats: {
        sma20,
        sma50,
        ytdReturnPct: ytdReturn,
        high52w: Math.max(...closes.slice(-252)),
        low52w: Math.min(...closes.slice(-252)),
        dataPoints: prices.length,
      },
      history: prices.map((r) => ({
        date: r.date,
        open: r.open,
        high: r.high,
        low: r.low,
        close: r.close,
        volume: r.volume ? Number(r.volume) : null,
      })),
      sensitivities: sensResult.rows.map((r) => ({
        ticker: r.ticker,
        stockName: r.stock_name,
        sector: r.sector,
        beta: r.beta,
        correlation60d: r.corr_60d,
        correlation252d: r.corr_252d,
        rSquared: r.r_squared,
        asOfDate: r.as_of_date,
      })),
    });
  } catch (err) {
    console.error("[COMMODITY DETAIL API]", err);
    return NextResponse.json(
      { error: "Failed to fetch commodity data" },
      { status: 500 }
    );
  }
}
