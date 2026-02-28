/**
 * Salmon Price History API
 * GET /api/seafood/salmon-price?days=365
 *
 * Returns salmon price history from commodity_prices table (SSB data)
 */

import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const days = parseInt(req.nextUrl.searchParams.get("days") || "365");

    const result = await pool.query(`
      SELECT date, close::float AS close, currency
      FROM commodity_prices
      WHERE symbol = 'SALMON'
        AND date >= NOW() - INTERVAL '${days} days'
      ORDER BY date ASC
    `);

    // Compute stats
    const prices = result.rows.map(r => r.close);
    const latest = prices[prices.length - 1] || 0;
    const oldest = prices[0] || 0;
    const high52w = Math.max(...prices);
    const low52w = Math.min(...prices);
    const avg = prices.length > 0 ? prices.reduce((a, b) => a + b, 0) / prices.length : 0;

    return NextResponse.json({
      history: result.rows.map(r => ({
        date: r.date,
        price: r.close,
      })),
      stats: {
        latest,
        changePct: oldest > 0 ? ((latest - oldest) / oldest) * 100 : 0,
        high52w,
        low52w,
        avg,
        currency: "NOK/kg",
        dataPoints: result.rows.length,
      },
    });
  } catch (err) {
    console.error("[SALMON PRICE]", err);
    return NextResponse.json({ error: "Failed to fetch salmon prices" }, { status: 500 });
  }
}
