// apps/web/src/app/api/equities/[ticker]/route.ts
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

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

export async function GET(
  req: Request,
  ctx: { params: Promise<{ ticker: string }> }
) {
  const { ticker } = await ctx.params;
  const url = new URL(req.url);
  const limit = clampInt(url.searchParams.get("limit"), 1500, 1, 5000);

  try {
    // Only select columns that exist in public.prices_daily in production.
    // number_of_shares and number_of_trades are NOT present, so do not reference them.
    const q = sql`
      select
        pd.date::date as date,
        pd.open,
        pd.high,
        pd.low,
        pd.close,
        pd.volume,
        pd.vwap,
        pd.turnover,
        upper(pd.ticker) as ticker,
        pd.source
      from public.prices_daily pd
      where upper(pd.ticker) = upper(${ticker})
      order by pd.date asc
      limit ${limit};
    `;

    const r = await db.execute(q);

    return NextResponse.json({
      ticker: ticker.toUpperCase(),
      count: r.rows.length,
      rows: r.rows,
      source: "prices_daily",
    });
  } catch (e: unknown) {
    return NextResponse.json(
      {
        error: "equities api failed",
        pg: errShape(e),
      },
      { status: 500 }
    );
  }
}
