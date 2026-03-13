import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const result = await pool.query(`
      SELECT
        s.ticker,
        s.name,
        s.sector,
        s.currency,
        pd.adj_close AS price,
        pd.price_date,
        ff.ep,
        ff.bm,
        ff.ev_ebitda,
        ff.dy,
        ff.sp,
        ff.mktcap
      FROM stocks s
      INNER JOIN LATERAL (
        SELECT adj_close, date AS price_date
        FROM prices_daily
        WHERE ticker = s.ticker
        ORDER BY date DESC
        LIMIT 1
      ) pd ON true
      LEFT JOIN LATERAL (
        SELECT ep, bm, ev_ebitda, dy, sp, mktcap
        FROM factor_fundamentals
        WHERE ticker = s.ticker
        ORDER BY date DESC
        LIMIT 1
      ) ff ON true
      WHERE s.asset_type = 'equity'
      ORDER BY s.ticker
    `);

    const rows = result.rows.map((r: any) => ({
      ticker: r.ticker,
      name: r.name,
      sector: r.sector || "Unknown",
      currency: r.currency,
      price: r.price ? parseFloat(r.price) : null,
      priceDate: r.price_date,
      ep: r.ep ? parseFloat(r.ep) : null,
      bm: r.bm ? parseFloat(r.bm) : null,
      evEbitda: r.ev_ebitda ? parseFloat(r.ev_ebitda) : null,
      dy: r.dy ? parseFloat(r.dy) : null,
      sp: r.sp ? parseFloat(r.sp) : null,
      mktcap: r.mktcap ? parseFloat(r.mktcap) : null,
    }));

    return NextResponse.json(
      { success: true, count: rows.length, data: rows },
      { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=7200" } }
    );
  } catch (error: any) {
    console.error("Error fetching bulk valuation data:", error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
