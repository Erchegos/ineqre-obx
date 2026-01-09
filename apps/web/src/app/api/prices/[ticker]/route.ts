import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

type RawRow = {
  date: unknown;
  open: unknown;
  high: unknown;
  low: unknown;
  close: unknown;
  volume: unknown;
};

type PriceRow = {
  date: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
};

function clampInt(v: string | null, def: number, min: number, max: number) {
  const n = v ? Number(v) : Number.NaN;
  if (!Number.isFinite(n)) return def;
  return Math.min(Math.max(Math.trunc(n), min), max);
}

function toNum(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function toISODate(d: unknown): string {
  // supports Date, string, etc
  const s = String(d);
  // if already YYYY-MM-DD
  if (s.length >= 10 && s[4] === "-" && s[7] === "-") return s.slice(0, 10);
  const dt = new Date(s);
  if (Number.isNaN(dt.getTime())) return s.slice(0, 10);
  return dt.toISOString().slice(0, 10);
}

export async function GET(req: Request, ctx: { params: Promise<{ ticker: string }> }) {
  try {
    const { ticker } = await ctx.params;
    const url = new URL(req.url);

    const limit = clampInt(url.searchParams.get("limit"), 1500, 1, 5000);

    // This endpoint reads from the raw prices table/view used elsewhere in your app.
    // Keep SQL generic to avoid tight coupling to drizzle schema until Phase 2 tables are live.
    const q = sql`
      select
        date::date as date,
        open,
        high,
        low,
        close,
        volume
      from public.prices_daily
      where upper(ticker) = upper(${ticker})
      order by date desc
      limit ${limit}
    `;

    const res = await db.execute(q);
    const rows = (((res as any)?.rows ?? []) as RawRow[]);

    // Reverse to ascending for chart consumers
    const ordered = rows.slice().reverse();

    const priceRows: PriceRow[] = ordered.map((r: RawRow) => ({
      date: toISODate(r.date),
      open: toNum(r.open),
      high: toNum(r.high),
      low: toNum(r.low),
      close: toNum(r.close),
      volume: toNum(r.volume),
    }));

    return NextResponse.json({
      ticker: ticker.toUpperCase(),
      count: priceRows.length,
      rows: priceRows,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
