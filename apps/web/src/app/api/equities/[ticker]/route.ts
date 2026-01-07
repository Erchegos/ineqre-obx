import { NextResponse } from "next/server";
import { and, asc, eq, gte, lte } from "drizzle-orm";
import { db } from "@/lib/db";
import { obxEquities } from "@ineqre/db/schema";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ ticker: string }> }
) {
  const { ticker: raw } = await ctx.params;
  const ticker = decodeURIComponent(raw || "").trim();

  const url = new URL(_req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const limitRaw = url.searchParams.get("limit");

  const limit = Math.min(Math.max(Number(limitRaw ?? 1000), 1), 5000);

  const clauses = [eq(obxEquities.ticker, ticker.toUpperCase())];
  if (from) clauses.push(gte(obxEquities.date, from));
  if (to) clauses.push(lte(obxEquities.date, to));

  const where = and(...clauses);

  const rows = await db
    .select()
    .from(obxEquities)
    .where(where)
    .orderBy(asc(obxEquities.date))
    .limit(limit);

  return NextResponse.json({ ticker, count: rows.length, rows });
}
