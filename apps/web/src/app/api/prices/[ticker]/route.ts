// apps/web/src/app/api/prices/[ticker]/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

type PriceRow = {
  date: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
  volume: number | null;
  source: string;
};

type ReturnRow = { date: string; log_return: number };
type VolRow = { date: string; volatility: number };

function computeLogReturns(rows: PriceRow[]): ReturnRow[] {
  const out: ReturnRow[] = [];
  for (let i = 1; i < rows.length; i++) {
    const p0 = rows[i - 1].close;
    const p1 = rows[i].close;
    if (Number.isFinite(p0) && Number.isFinite(p1) && p0 > 0 && p1 > 0) {
      out.push({ date: rows[i].date, log_return: Math.log(p1 / p0) });
    }
  }
  return out;
}

function computeVolatility(returns: ReturnRow[], window = 20): VolRow[] {
  const out: VolRow[] = [];
  if (returns.length < window) return out;

  for (let i = window - 1; i < returns.length; i++) {
    const slice = returns.slice(i - window + 1, i + 1);
    const mean = slice.reduce((s, r) => s + r.log_return, 0) / slice.length;

    const variance =
      slice.reduce((s, r) => s + (r.log_return - mean) ** 2, 0) /
      (slice.length - 1);

    out.push({ date: returns[i].date, volatility: Math.sqrt(variance) });
  }

  return out;
}

function withTimeout<T>(p: PromiseLike<T>, ms: number): Promise<T> {
  return Promise.race([
    Promise.resolve(p),
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error("supabase query timeout")), ms)
    ),
  ]);
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ ticker: string }> }
) {
  try {
    const { ticker: raw } = await ctx.params;
    const ticker = decodeURIComponent(raw || "").trim();

    if (!ticker) {
      return NextResponse.json({ error: "ticker is required" }, { status: 400 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json(
        {
          error: "supabase env missing",
          missing: {
            NEXT_PUBLIC_SUPABASE_URL: !supabaseUrl,
            SUPABASE_SERVICE_ROLE_KEY: !process.env.SUPABASE_SERVICE_ROLE_KEY,
            SUPABASE_KEY: !process.env.SUPABASE_KEY,
            NEXT_PUBLIC_SUPABASE_ANON_KEY: !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
          },
        },
        { status: 500 }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    const timeoutMs = 8000;

    const query = supabase
      .from("prices_daily")
      .select("date, open, high, low, close, volume, source")
      .eq("ticker", ticker)
      .order("date", { ascending: true })
      .limit(5000);

    const result = await withTimeout(query, timeoutMs);

    const { data, error } = result as unknown as {
      data: PriceRow[] | null;
      error: { message: string } | null;
    };

    if (error) {
      return NextResponse.json({ error: error.message, ticker }, { status: 500 });
    }

    const rowsAll: PriceRow[] = (data ?? []).filter(
      (r) => r && typeof r.date === "string" && Number.isFinite(r.close)
    );

    // Prefer real data over mock when mixed
    const hasReal = rowsAll.some((r) => r.source !== "mock");
    const rows = hasReal ? rowsAll.filter((r) => r.source !== "mock") : rowsAll;

    const returns = computeLogReturns(rows);
    const volatility = computeVolatility(returns, 20);

    return NextResponse.json({ ticker, rows, returns, volatility });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
