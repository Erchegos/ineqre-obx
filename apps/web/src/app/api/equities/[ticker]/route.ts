import { NextResponse } from "next/server";
import { and, asc, eq, gte, lte } from "drizzle-orm";
import { db } from "@/lib/db";
import { obxEquities } from "@ineqre/db/schema";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ ticker: string }> }
) {
  const { ticker } = await ctx.params;

  const url = new URL(_req.url);
  const from = url.searchParams.get("from"); // YYYY-MM-DD
  const to = url.searchParams.get("to"); // YYYY-MM-DD
  const limitRaw = url.searchParams.get("limit");

  const limit = Math.min(Math.max(Number(limitRaw ?? 1000) || 1000, 1), 5000);

  const conditions = [
    eq(obxEquities.ticker, ticker.toUpperCase()),
    from ? gte(obxEquities.date, from) : undefined,
    to ? lte(obxEquities.date, to) : undefined,
  ].filter(Boolean) as any[];

  const rows = await db
    .select({
      date: obxEquities.date,
      open: obxEquities.open,
      high: obxEquities.high,
      low: obxEquities.low,
      close: obxEquities.close,
      numberOfShares: obxEquities.numberOfShares,
      numberOfTrades: obxEquities.numberOfTrades,
      turnover: obxEquities.turnover,
      vwap: obxEquities.vwap,
      ticker: obxEquities.ticker,
    })
    .from(obxEquities)
    .where(and(...conditions))
    .orderBy(asc(obxEquities.date))
    .limit(limit);

  return NextResponse.json({
    ticker: ticker.toUpperCase(),
    count: rows.length,
    rows,
  });
}
