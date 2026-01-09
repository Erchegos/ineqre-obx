import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

function clampInt(v: string | null, def: number, min: number, max: number) {
  const n = v ? Number(v) : Number.NaN;
  if (!Number.isFinite(n)) return def;
  return Math.min(Math.max(Math.trunc(n), min), max);
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const limit = clampInt(url.searchParams.get("limit"), 5000, 1, 5000);

    const q = sql`
      select
        upper(ticker) as ticker,
        name,
        sector,
        exchange,
        currency,
        start_date::date as "startDate",
        end_date::date as "endDate",
        last_date::date as "lastDate",
        last_close as "lastClose",
        rows::int as rows
      from public.stocks_latest
      order by ticker asc
      limit ${limit}
    `;

    const res = await db.execute(q);
    const rows = ((res as any)?.rows ?? []) as any[];

    return NextResponse.json({
      count: rows.length,
      rows,
      source: "stocks_latest"
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
