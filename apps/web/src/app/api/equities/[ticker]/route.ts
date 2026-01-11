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

export async function GET(
  req: Request,
  ctx: { params: Promise<{ ticker: string }> }
) {
  const { ticker } = await ctx.params;

  const url = new URL(req.url);
  const limit = clampInt(url.searchParams.get("limit"), 1500, 1, 5000);

  const t = (ticker ?? "").trim();
  if (!t) {
    return NextResponse.json({ error: "ticker missing" }, { status: 400 });
  }

  try {
    const q = `
      select
        pd.date::date as date,
        pd.open,
        pd.high,
        pd.low,
        pd.close,
        pd.number_of_shares as volume,
        pd.vwap,
        pd.turnover,
        pd.number_of_trades as "numberOfTrades",
        pd.number_of_shares as "numberOfShares",
        upper(pd.ticker) as ticker,
        pd.source
      from public.prices_daily pd
      where upper(pd.ticker) = upper($1)
      order by pd.date asc
      limit $2
    `;

    const r = await pool.query(q, [t, limit]);

    return NextResponse.json({
      ticker: t.toUpperCase(),
      count: r.rows.length,
      rows: r.rows,
      source: "prices_daily",
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: "equities api failed", pg: errShape(e) },
      { status: 500 }
    );
  }
}
