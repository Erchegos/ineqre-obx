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
    const tableName = await getPriceTable();

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
      INNER JOIN ${tableName} p ON s.ticker = p.ticker
      WHERE p.source = 'ibkr'
        AND p.close IS NOT NULL
        AND p.close > 0
      GROUP BY s.ticker, s.name
      HAVING COUNT(*) >= 510
        AND MAX(p.date) >= CURRENT_DATE - INTERVAL '30 days'
      ORDER BY s.ticker
    `;

    const result = await pool.query(query);

    const stocks = result.rows.map((row) => ({
      ticker: row.ticker,
      name: row.name || row.ticker,
      last_close: Number(row.last_close),
      last_adj_close: Number(row.last_adj_close || row.last_close),
      start_date: row.start_date instanceof Date
        ? row.start_date.toISOString().slice(0, 10)
        : String(row.start_date),
      end_date: row.end_date instanceof Date
        ? row.end_date.toISOString().slice(0, 10)
        : String(row.end_date),
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
