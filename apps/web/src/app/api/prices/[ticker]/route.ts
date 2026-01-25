import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { rateLimit } from "@/lib/rate-limit";
import { tickerSchema, clampInt } from "@/lib/validation";
import { secureJsonResponse, safeErrorResponse } from "@/lib/security";

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

function toNum(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function toISODate(d: unknown): string {
  const s = String(d);
  if (s.length >= 10 && s[4] === "-" && s[7] === "-") return s.slice(0, 10);
  const dt = new Date(s);
  if (Number.isNaN(dt.getTime())) return s.slice(0, 10);
  return dt.toISOString().slice(0, 10);
}

/**
 * GET /api/prices/[ticker]
 *
 * Get historical prices for a stock. Public endpoint.
 *
 * Security measures:
 * - Rate limiting (200 req/min per IP)
 * - Ticker validation (alphanumeric only, max 10 chars)
 * - Limit parameter bounds checking
 * - Parameterized SQL queries
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ ticker: string }> }) {
  // Rate limiting
  const rateLimitResult = rateLimit(req, 'read');
  if (rateLimitResult) return rateLimitResult;

  try {
    const { ticker: rawTicker } = await ctx.params;

    // Validate ticker parameter
    const tickerResult = tickerSchema.safeParse(rawTicker);
    if (!tickerResult.success) {
      return secureJsonResponse(
        { error: 'Invalid ticker format' },
        { status: 400 }
      );
    }
    const ticker = tickerResult.data;

    const url = new URL(req.url);
    const limit = clampInt(
      parseInt(url.searchParams.get("limit") || "1500", 10),
      1,
      5000
    );

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

    return secureJsonResponse({
      ticker: ticker.toUpperCase(),
      count: priceRows.length,
      rows: priceRows,
    });
  } catch (e: unknown) {
    return safeErrorResponse(e, 'Failed to fetch price data');
  }
}
