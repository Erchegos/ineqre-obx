import { NextResponse } from "next/server";
import { Pool } from "pg";

export const dynamic = "force-dynamic";

function clampInt(v: string | null, def: number, min: number, max: number) {
  const n = v ? Number(v) : Number.NaN;
  if (!Number.isFinite(n)) return def;
  return Math.min(Math.max(Math.trunc(n), min), max);
}

function errShape(e: unknown) {
  const x = e as any;
  return {
    message: x?.message ?? String(e),
    code: x?.code ?? null,
    detail: x?.detail ?? null,
    hint: x?.hint ?? null,
    where: x?.where ?? null,
  };
}

async function listColumns(pool: Pool, tableName: string) {
  const r = await pool.query(
    `
    select column_name, data_type
    from information_schema.columns
    where table_schema = 'public' and table_name = $1
    order by ordinal_position
    `,
    [tableName]
  );
  return r.rows;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = clampInt(url.searchParams.get("limit"), 5000, 1, 5000);

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    return NextResponse.json({ error: "DATABASE_URL missing" }, { status: 500 });
  }

  const pool = new Pool({
    connectionString,
    ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : undefined,
  });

  try {
    const q = `
      with px as (
        select
          upper(ticker) as ticker,
          min(date::date) as "startDate",
          max(date::date) as "endDate",
          count(*)::int as rows
        from public.prices_daily
        group by upper(ticker)
      )
      select
        upper(s.ticker) as ticker,
        s.name as name,
        s.sector as sector,
        s.exchange as exchange,
        s.currency as currency,
        s.is_active as "isActive",
        s.last_date::date as "lastDate",
        s.last_close as "lastClose",
        p."startDate" as "startDate",
        p."endDate" as "endDate",
        coalesce(p.rows, 0) as rows
      from public.stocks_latest s
      left join px p on p.ticker = upper(s.ticker)
      order by upper(s.ticker) asc
      limit $1
    `;

    const r = await pool.query(q, [limit]);

    return NextResponse.json({
      count: r.rows.length,
      rows: r.rows,
      source: "stocks_latest + prices_daily",
    });
  } catch (e: unknown) {
    // Include live schema introspection so we can fix the column mismatch immediately
    let pricesDailyCols: any[] | null = null;
    let stocksLatestCols: any[] | null = null;

    try {
      pricesDailyCols = await listColumns(pool, "prices_daily");
    } catch {
      pricesDailyCols = null;
    }

    try {
      stocksLatestCols = await listColumns(pool, "stocks_latest");
    } catch {
      stocksLatestCols = null;
    }

    return NextResponse.json(
      {
        error: "stocks api failed",
        pg: errShape(e),
        schema: {
          prices_daily: pricesDailyCols,
          stocks_latest: stocksLatestCols,
        },
      },
      { status: 500 }
    );
  } finally {
    await pool.end().catch(() => {});
  }
}
