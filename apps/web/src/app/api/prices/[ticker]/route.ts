// apps/web/src/app/api/prices/[ticker]/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

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

function json(
  body: unknown,
  status = 200,
  extraHeaders?: Record<string, string>
) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      ...(extraHeaders ?? {}),
    },
  });
}

function getSupabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;

  // Prefer server-only keys, fall back to anon for read-only use if needed
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  return { url, key };
}

async function withTimeout<T>(p: Promise<T>, timeoutMs: number): Promise<T> {
  return await Promise.race([
    p,
    new Promise<T>((_resolve, reject) =>
      setTimeout(() => reject(new Error("supabase query timeout")), timeoutMs)
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
      return json({ error: "ticker is required" }, 400);
    }

    const { url: supabaseUrl, key: supabaseKey } = getSupabaseConfig();

    if (!supabaseUrl || !supabaseKey) {
      // Do not crash SSR pages with opaque digests; return explicit JSON error.
      return json(
        {
          error: "Supabase environment variables missing",
          missing: {
            NEXT_PUBLIC_SUPABASE_URL: !supabaseUrl,
            SUPABASE_SERVICE_ROLE_KEY: !process.env.SUPABASE_SERVICE_ROLE_KEY,
            SUPABASE_KEY: !process.env.SUPABASE_KEY,
            NEXT_PUBLIC_SUPABASE_ANON_KEY:
              !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
          },
        },
        500
      );
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    const timeoutMs = Number(process.env.SUPABASE_QUERY_TIMEOUT_MS ?? 6000);

    const query = supabase
      .from("prices_daily")
      .select("date, open, high, low, close, volume, source")
      .eq("ticker", ticker)
      .order("date", { ascending: true })
      .limit(5000);

    const result = await withTimeout(query, timeoutMs);

    // Supabase client returns { data, error }
    const data = (result as any).data as PriceRow[] | null;
    const error = (result as any).error as { message?: string } | null;

    if (error) {
      return json(
        {
          error: error.message ?? "supabase query error",
          ticker,
        },
        500
      );
    }

    const rowsAll: PriceRow[] = Array.isArray(data) ? data : [];

    // Prefer real over mock, but keep mock if that is all we have
    const hasReal = rowsAll.some((r) => r.source && r.source !== "mock");
    const rows = hasReal ? rowsAll.filter((r) => r.source !== "mock") : rowsAll;

    const returns = computeLogReturns(rows);
    const volatility = computeVolatility(returns, 20);

    return json({
      ticker,
      rows,
      returns,
      volatility,
    });
  } catch (e: any) {
    return json(
      {
        error: e?.message ?? "unknown error",
      },
      500
    );
  }
}
