import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getPriceTable } from "@/lib/price-data-adapter";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function errShape(e: unknown) {
  const x = e as any;
  return {
    message: x?.message ?? String(e),
    code: x?.code ?? null,
    detail: x?.detail ?? null,
    hint: x?.hint ?? null,
    where: x?.where ?? null,
    name: x?.name ?? null,
  };
}

export async function GET() {
  try {
    console.log('[STOCKS API] Starting query...');
    console.log('[STOCKS API] DATABASE_URL set:', !!process.env.DATABASE_URL);

    // Just use prices_daily directly - we know that's the table name
    const query = `
      SELECT
        s.ticker,
        s.name,
        (ARRAY_AGG(p.close ORDER BY p.date DESC))[1] as last_close,
        (ARRAY_AGG(p.adj_close ORDER BY p.date DESC))[1] as last_adj_close,
        MIN(p.date) as start_date,
        MAX(p.date) as end_date,
        COUNT(*) as rows
      FROM stocks s
      INNER JOIN prices_daily p ON s.ticker = p.ticker
      WHERE p.close IS NOT NULL
        AND p.close > 0
      GROUP BY s.ticker, s.name
      HAVING COUNT(*) >= 100
      ORDER BY s.ticker
    `;

    console.log('[STOCKS API] Executing query...');
    const result = await pool.query(query);
    console.log(`[STOCKS API] Successfully fetched ${result.rows.length} stocks from prices_daily`);

    const stocks = result.rows.map((row) => ({
      ticker: row.ticker,
      name: row.name || row.ticker,
      last_close: Number(row.last_close || 0),
      last_adj_close: row.last_adj_close ? Number(row.last_adj_close) : Number(row.last_close || 0),
      start_date: row.start_date instanceof Date
        ? row.start_date.toISOString().slice(0, 10)
        : String(row.start_date).slice(0, 10),
      end_date: row.end_date instanceof Date
        ? row.end_date.toISOString().slice(0, 10)
        : String(row.end_date).slice(0, 10),
      rows: Number(row.rows),
    }));

    return NextResponse.json(stocks);
  } catch (e: unknown) {
    console.error("Error fetching stocks:", e);

    return NextResponse.json(
      {
        error: "Failed to fetch stocks data",
        pg: errShape(e),
      },
      { status: 500 }
    );
  }
}
