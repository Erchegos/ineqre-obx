import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

function clampInt(v: string | null, def: number, min: number, max: number) {
  const n = v ? Number(v) : Number.NaN;
  if (!Number.isFinite(n)) return def;
  return Math.min(Math.max(Math.trunc(n), min), max);
}

function pgErrorPayload(e: unknown) {
  const anyE = e as any;
  return {
    message: anyE?.message ?? String(e),
    code: anyE?.code ?? null,
    detail: anyE?.detail ?? null,
    hint: anyE?.hint ?? null,
    where: anyE?.where ?? null
  };
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const limit = clampInt(url.searchParams.get("limit"), 5000, 1, 5000);

    const q = sql`
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
      limit ${limit}
    `;

    const res = await db.execute(q);
    const rows = ((res as any)?.rows ?? []) as any[];

    return NextResponse.json({ count: rows.length, rows });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: "stocks api failed", pg: pgErrorPayload(e) },
      { status: 500 }
    );
  }
}
