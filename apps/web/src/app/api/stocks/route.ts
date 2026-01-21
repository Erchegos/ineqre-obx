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
    // Try to detect table, but with better error handling
    let tableName: string;
    try {
      tableName = await getPriceTable();
    } catch (detectError) {
      console.error("Failed to detect price table, trying both:", detectError);
      // If detection fails, try prices_daily first, then obx_equities
      tableName = "prices_daily";
    }

    const buildQuery = (table: string) => `
      SELECT
        s.ticker,
        s.name,
        (ARRAY_AGG(p.close ORDER BY p.date DESC))[1] as last_close,
        (ARRAY_AGG(p.adj_close ORDER BY p.date DESC))[1] as last_adj_close,
        MIN(p.date) as start_date,
        MAX(p.date) as end_date,
        COUNT(*) as rows
      FROM stocks s
      INNER JOIN ${table} p ON s.ticker = p.ticker
      WHERE p.close IS NOT NULL
        AND p.close > 0
      GROUP BY s.ticker, s.name
      HAVING COUNT(*) >= 100
      ORDER BY s.ticker
    `;

    let result;
    try {
      result = await pool.query(buildQuery(tableName));
    } catch (firstError) {
      console.error(`Query failed with ${tableName}, trying alternative:`, firstError);
      // Try the other table name
      const altTable = tableName === "prices_daily" ? "obx_equities" : "prices_daily";
      try {
        result = await pool.query(buildQuery(altTable));
        tableName = altTable;
        console.log(`Successfully queried ${altTable}`);
      } catch (secondError) {
        console.error(`Both table queries failed:`, secondError);
        throw firstError; // Throw the original error
      }
    }

    console.log(`Successfully fetched ${result.rows.length} stocks from ${tableName}`);

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
