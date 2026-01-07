import { NextResponse } from "next/server";
import { asc, gte, lte } from "drizzle-orm";
import { db } from "@/lib/db";
import { obxMarketProxy } from "@ineqre/db/schema";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const limitRaw = url.searchParams.get("limit");
  const limit = Math.min(Math.max(Number(limitRaw || 2000), 1), 10000);

  const where =
    from && to
      ? (row: any) => gte(obxMarketProxy.date, from) && lte(obxMarketProxy.date, to)
      : from
      ? gte(obxMarketProxy.date, from)
      : to
      ? lte(obxMarketProxy.date, to)
      : undefined;

  const q = db.select().from(obxMarketProxy).orderBy(asc(obxMarketProxy.date)).limit(limit);

  const rows = where ? await q.where(where as any) : await q;

  return NextResponse.json({ count: rows.length, rows });
}

