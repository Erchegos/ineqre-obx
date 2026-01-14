import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

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

async function getPublicTableColumns(tableName: string): Promise<Set<string>> {
  const r = await pool.query(
    `
    select column_name
    from information_schema.columns
    where table_schema = 'public'
      and table_name = $1
    `,
    [tableName]
  );
  return new Set(r.rows.map((x: any) => String(x.column_name)));
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ ticker: string }> }
) {
  const { ticker } = await ctx.params;

  const url = new URL(req.url);
  const limit = clampInt(url.searchParams.get("limit"), 1500, 1, 5000);

  const connectionString = process.env.DATABASE_URL ?? "";
  const dbUrlHost = (() => {
    try {
      const u = new URL(connectionString);
      return `${u.host}${u.port ? `:${u.port}` : ""}`;
    } catch {
      return null;
    }
  })();

  const meta = {
    vercelCommit: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
    nodeEnv: process.env.NODE_ENV ?? null,
    dbUrlHost,
  };

  try {
    const cols = await getPublicTableColumns("prices_daily");

    const has = (c: string) => cols.has(c);

    const selectParts: string[] = [
      "pd.date::date as date",
      "pd.open",
      "pd.high",
      "pd.low",
      "pd.close",
      // volume + source are present in your working stocks query
      has("volume") ? "pd.volume" : "null::numeric as volume",
      "upper(pd.ticker) as ticker",
      has("source") ? "pd.source" : "null::text as source",
      // optional
      has("vwap") ? "pd.vwap" : "null::numeric as vwap",
      has("turnover") ? "pd.turnover" : "null::numeric as turnover",
      has("number_of_trades")
        ? 'pd.number_of_trades as "numberOfTrades"'
        : 'null::int as "numberOfTrades"',
      has("number_of_shares")
        ? 'pd.number_of_shares as "numberOfShares"'
        : 'null::int as "numberOfShares"',
    ];

    const q = `
      select
        ${selectParts.join(",\n        ")}
      from public.prices_daily pd
      where upper(pd.ticker) = upper($1)
      order by pd.date asc
      limit $2
    `;

    const r = await pool.query(q, [ticker, limit]);

    return NextResponse.json({
      ...meta,
      ticker: ticker.toUpperCase(),
      count: r.rows.length,
      rows: r.rows,
      source: "prices_daily",
      selected: selectParts,
      pricesDailyColumns: Array.from(cols).sort(),
    });
  } catch (e: unknown) {
    let pricesDailyColumns: string[] | null = null;
    try {
      const cols = await getPublicTableColumns("prices_daily");
      pricesDailyColumns = Array.from(cols).sort();
    } catch {
      pricesDailyColumns = null;
    }

    return NextResponse.json(
      {
        ...meta,
        error: "equities api failed",
        pg: errShape(e),
        schema: { prices_daily_columns: pricesDailyColumns },
      },
      { status: 500 }
    );
  }
}
