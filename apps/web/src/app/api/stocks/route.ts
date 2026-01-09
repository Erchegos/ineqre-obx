// apps/web/src/app/api/stocks/route.ts
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

function clampInt(v: string | null, def: number, min: number, max: number) {
  const n = v ? Number(v) : NaN;
  if (!Number.isFinite(n)) return def;
  return Math.min(Math.max(Math.trunc(n), min), max);
}

function toIsoDate(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v);
  return s.length >= 10 ? s.slice(0, 10) : s;
}

function toNum(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toInt(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? Math.trunc(v) : null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const limit = clampInt(url.searchParams.get("limit"), 5000, 1, 5000);

    // NOTE:
    // Name + sector are not in obx_equities, so returned as null for now.
    // Exchange + currency are constant for this dataset.
    const q = sql`
      with per_ticker as (
        select
          upper(e.ticker) as ticker,
          min(e.date)::date as "startDate",
          max(e.date)::date as "endDate",
          count(*)::int as "rows",
          (array_agg(e.close order by e.date desc))[1] as "lastClose"
        from public.obx_equities e
        group by upper(e.ticker)
      )
      select
        p.ticker as ticker,
        null::text as name,
        null::text as sector,
        'OSE'::text as exchange,
        'NOK'::text as currency,
        p."startDate" as "startDate",
        p."endDate" as "endDate",
        p."endDate" as "lastDate",
        p."rows" as "rows",
        p."lastClose" as "lastClose"
      from per_ticker p
      order by p.ticker asc
      limit ${limit}
    `;

    const result = await db.execute(q);
    const rows = ((result as any)?.rows ?? []) as Array<{
      ticker: unknown;
      name: unknown;
      sector: unknown;
      exchange: unknown;
      currency: unknown;
      startDate: unknown;
      endDate: unknown;
      lastDate: unknown;
      rows: unknown;
      lastClose: unknown;
    }>;

    const out = rows.map((r) => ({
      ticker: String(r.ticker ?? "").toUpperCase(),
      name: r.name === null || r.name === undefined ? null : String(r.name),
      sector: r.sector === null || r.sector === undefined ? null : String(r.sector),
      exchange: r.exchange === null || r.exchange === undefined ? null : String(r.exchange),
      currency: r.currency === null || r.currency === undefined ? null : String(r.currency),
      startDate: toIsoDate(r.startDate),
      endDate: toIsoDate(r.endDate),
      lastDate: toIsoDate(r.lastDate),
      rows: toInt(r.rows),
      lastClose: toNum(r.lastClose),
    }));

    return NextResponse.json({ count: out.length, rows: out });
  } catch (e: any) {
    return NextResponse.json(
      {
        error: e?.message ?? String(e),
        detail: e?.detail,
        code: e?.code,
        where: e?.where,
      },
      { status: 500 }
    );
  }
}
