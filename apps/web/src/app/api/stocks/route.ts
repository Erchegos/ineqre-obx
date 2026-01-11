import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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
    name: x?.name ?? null,
    stack: x?.stack ?? null,
  };
}

function deployMeta() {
  const cs = process.env.DATABASE_URL ?? "";
  let host: string | null = null;
  try {
    host = new URL(cs).host;
  } catch {
    host = null;
  }

  return {
    vercelCommit: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
    nodeEnv: process.env.NODE_ENV ?? null,
    dbUrlHost: host,
  };
}

async function listColumns(tableName: string) {
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
      ...deployMeta(),
      count: r.rows.length,
      rows: r.rows,
      source: "stocks_latest + prices_daily",
    });
  } catch (e: unknown) {
    let pricesDailyCols: any[] | null = null;
    let stocksLatestCols: any[] | null = null;

    try {
      pricesDailyCols = await listColumns("prices_daily");
    } catch {
      pricesDailyCols = null;
    }

    try {
      stocksLatestCols = await listColumns("stocks_latest");
    } catch {
      stocksLatestCols = null;
    }

    return NextResponse.json(
      {
        ...deployMeta(),
        error: "stocks api failed",
        pg: errShape(e),
        schema: {
          prices_daily: pricesDailyCols,
          stocks_latest: stocksLatestCols,
        },
      },
      { status: 500 }
    );
  }
}
