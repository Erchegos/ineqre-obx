import { NextResponse } from "next/server";
import { and, asc, eq, gte, lte } from "drizzle-orm";
import { db } from "@/lib/db";
import { obxFeatures } from "@ineqre/db/schema";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ ticker: string }> }
) {
  const { ticker } = await ctx.params;

  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const limitRaw = url.searchParams.get("limit");
  const limit = Math.min(Math.max(Number(limitRaw || 500), 1), 5000);

  const conditions = [
    eq(obxFeatures.ticker, ticker.toUpperCase()),
    from ? gte(obxFeatures.date, from) : undefined,
    to ? lte(obxFeatures.date, to) : undefined,
  ].filter(Boolean) as any[];

  const rows = await db
    .select()
    .from(obxFeatures)
    .where(and(...conditions))
    .orderBy(asc(obxFeatures.date))
    .limit(limit);

  return NextResponse.json({ ticker: ticker.toUpperCase(), count: rows.length, rows });
}
