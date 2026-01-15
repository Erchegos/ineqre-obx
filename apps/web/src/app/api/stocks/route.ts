import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

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
    // Get all tickers that have sufficient price data
    const query = `
      with ticker_stats as (
        select
          upper(ticker) as ticker,
          count(*) as row_count,
          max(date) as last_date
        from public.prices_daily
        where close is not null
          and close > 0
        group by upper(ticker)
      )
      select distinct t.ticker
      from ticker_stats t
      inner join public.stocks_latest s on upper(s.ticker) = t.ticker
      where t.row_count >= 100
        and t.last_date >= current_date - interval '90 days'
        and s.is_active = true
      order by t.ticker asc
    `;

    const result = await pool.query(query);

    // Return simple array of ticker strings
    const tickers = result.rows.map((row) => row.ticker);

    return NextResponse.json(tickers);
  } catch (e: unknown) {
    console.error("Error fetching stocks:", e);

    return NextResponse.json(
      {
        error: "Failed to fetch available tickers",
        pg: errShape(e),
      },
      { status: 500 }
    );
  }
}