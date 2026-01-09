import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

function clampInt(v: string | null, def: number, min: number, max: number) {
  const n = v ? Number(v) : Number.NaN;
  if (!Number.isFinite(n)) return def;
  return Math.min(Math.max(Math.trunc(n), min), max);
}

function toISODate(d: unknown): string {
  const s = String(d);
  if (s.length >= 10 && s[4] === "-" && s[7] === "-") return s.slice(0, 10);
  const dt = new Date(s);
  if (Number.isNaN(dt.getTime())) return s.slice(0, 10);
  return dt.toISOString().slice(0, 10);
}

function toNum(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function GET(req: Request, ctx: { params: Promise<{ ticker: string }> }) {
  try {
    const { ticker } = await ctx.params;
    const url = new URL(req.url);

    const limit = clampInt(url.searchParams.get("limit"), 1000, 1, 5000);
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");

    const q = sql`
      select
        date::date as date,
        open,
        high,
        low,
        close,
        volume,
        vwap,
        turnover,
        number_of_trades as "numberOfTrades",
        number_of_shares as "numberOfShares",
        upper(ticker) as ticker
      from public.prices_daily
      where upper(ticker) = upper(${ticker})
        ${from ? sql`and date::date >= ${from}::date` : sql``}
        ${to ? sql`and date::date <= ${to}::date` : sql``}
      order by date asc
      limit ${limit}
    `;

    const res = await db.execute(q);
    const rowsRaw = ((res as any)?.rows ?? []) as any[];

    const rows = rowsRaw.map((r: any) => ({
      date: toISODate(r.date),
      open: toNum(r.open),
      high: toNum(r.high),
      low: toNum(r.low),
      close: toNum(r.close),
      volume: toNum(r.volume),
      vwap: toNum(r.vwap),
      turnover: toNum(r.turnover),
      numberOfTrades: toNum(r.numberOfTrades),
      numberOfShares: toNum(r.numberOfShares),
      ticker: String(r.ticker).toUpperCase()
    }));

    return NextResponse.json({
      ticker: String(ticker).toUpperCase(),
      count: rows.length,
      rows,
      source: "prices_daily"
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
