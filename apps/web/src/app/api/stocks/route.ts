// apps/web/src/app/api/stocks/route.ts
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

type StockRow = {
  ticker: string;
  lastDate: string;
  lastClose: number;
};

export async function GET() {
  try {
    const result = await db.execute(sql`
      select distinct on (e.ticker)
        e.ticker as "ticker",
        e.date::text as "lastDate",
        e.close::float8 as "lastClose"
      from public.obx_equities e
      order by e.ticker asc, e.date desc
    `);

    const rows = (result.rows ?? []) as unknown as StockRow[];

    return NextResponse.json({
      count: rows.length,
      rows,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
