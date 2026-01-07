import { NextResponse } from "next/server";
import { asc, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { obxEquities, obxFeatures } from "@ineqre/db/schema";

function toNum(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ ticker: string }> }
) {
  const { ticker: raw } = await ctx.params;
  const ticker = decodeURIComponent(raw || "").trim().toUpperCase();

  const url = new URL(_req.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 500), 1), 2000);

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
      ret1d: obxFeatures.ret1d,
      vol20d: obxFeatures.vol20d,
    })
    .from(obxEquities)
    .leftJoin(
      obxFeatures,
      eq(obxFeatures.ticker, obxEquities.ticker)
    )
    .where(eq(obxEquities.ticker, ticker))
    .orderBy(desc(obxEquities.date))
    .limit(limit);

  // UI expects oldest to newest for chart logic
  const ordered = rows.reverse();

  const priceRows = ordered.map((r) => ({
    date: new Date(r.date).toISOString().slice(0, 10),
    open: toNum(r.open),
    high: toNum(r.high),
    low: toNum(r.low),
    close: toNum(r.close) ?? 0,
    volume: toNum(r.numberOfShares),
    source: "db",
  }));

  const returns = ordered
    .filter((r) => r.ret1d !== null && r.ret1d !== undefined)
    .map((r) => ({
      date: new Date(r.date).toISOString().slice(0, 10),
      log_return: toNum(r.ret1d) ?? 0,
    }));

  const volatility = ordered
    .filter((r) => r.vol20d !== null && r.vol20d !== undefined)
    .map((r) => ({
      date: new Date(r.date).toISOString().slice(0, 10),
      volatility: toNum(r.vol20d) ?? 0,
    }));

  return NextResponse.json({
    ticker,
    rows: priceRows,
    returns,
    volatility,
  });
}
