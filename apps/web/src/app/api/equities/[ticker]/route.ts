// apps/web/src/app/api/equities/[ticker]/route.ts
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
    name: x?.name ?? null,
    stack: x?.stack ?? null,
  };
}

async function getPublicTableColumns(pool: Pool, tableName: string): Promise<Set<string>> {
  const r = await pool.query(
    `
    select column_name
    from information_schema.columns
    where table_schema = 'public' and table_name = $1
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

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    return NextResponse.json({ error: "DATABASE_URL missing" }, { status: 500 });
  }

  const isSupabase =
    connectionString.includes("supabase.com") ||
    connectionString.includes("pooler.supabase.com");

  const pool = new Pool({
    connectionString,
    ssl: isSupabase ? { rejectUnauthorized: false } : undefined,
  });

  try {
    // 1) Introspect once so we never select columns that do not exist
    const cols = await getPublicTableColumns(pool, "prices_daily");

    // 2) Base columns that must exist for the app to function
    const selectParts: string[] = [
      "pd.date::date as date",
      "pd.open",
      "pd.high",
      "pd.low",
      "pd.close",
      "pd.volume",
      "upper(pd.ticker) as ticker",
    ];

    // 3) Optional columns depending on your merge schema
    if (cols.has("vwap")) selectParts.push("pd.vwap");
    if (cols.has("turnover")) selectParts.push("pd.turnover");
    if (cols.has("source")) selectParts.push("pd.source");
    if (cols.has("number_of_trades")) selectParts.push('pd.number_of_trades as "numberOfTrades"');
    if (cols.has("number_of_shares")) selectParts.push('pd.number_of_shares as "numberOfShares"');

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
      ticker: ticker.toUpperCase(),
      count: r.rows.length,
      rows: r.rows,
      selectedColumns: selectParts.map((s) => s.split(" as ")[0].trim()),
    });
  } catch (e: unknown) {
    let pricesDailyCols: string[] | null = null;
    try {
      const cols = await getPublicTableColumns(pool, "prices_daily");
      pricesDailyCols = Array.from(cols).sort();
    } catch {
      pricesDailyCols = null;
    }

    return NextResponse.json(
      {
        error: "equities api failed",
        pg: errShape(e),
        schema: {
          prices_daily_columns: pricesDailyCols,
        },
      },
      { status: 500 }
    );
  } finally {
    await pool.end().catch(() => {});
  }
}
