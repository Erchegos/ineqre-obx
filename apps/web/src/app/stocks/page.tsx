// apps/web/src/app/stocks/page.tsx
import Link from "next/link";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

type StockRow = {
  ticker: string;
  name: string | null;
  sector: string | null;
  exchange: string | null;
  currency: string | null;
  isActive: boolean | null;
  lastDate: string | null;
  lastClose: number | null;
  startDate: string | null;
  endDate: string | null;
  rows: number;
};

function toNum(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function toDate10(v: unknown): string | null {
  if (!v) return null;
  const s = String(v);
  return s.length >= 10 ? s.slice(0, 10) : s;
}

async function getStocks(limit = 5000): Promise<{ count: number; rows: StockRow[] }> {
  const q = sql`
    with px as (
      select
        upper(ticker) as ticker,
        min(date::date) as "startDate",
        max(date::date) as "endDate",
        count(*)::int as rows
      from public.prices_daily
      group by upper(ticker)
    )
    select
      upper(s.ticker) as ticker,
      s.name as name,
      s.sector as sector,
      s.exchange as exchange,
      s.currency as currency,
      s.is_active as "isActive",
      s.last_date::date as "lastDate",
      s.last_close as "lastClose",
      p."startDate" as "startDate",
      p."endDate" as "endDate",
      coalesce(p.rows, 0) as rows
    from public.stocks_latest s
    left join px p on p.ticker = upper(s.ticker)
    order by upper(s.ticker) asc
    limit ${limit}
  `;

  const res = await db.execute(q);
  const raw = ((res as any)?.rows ?? []) as any[];

  const rows: StockRow[] = raw.map((r) => ({
    ticker: String(r.ticker ?? "").toUpperCase(),
    name: r.name ?? null,
    sector: r.sector ?? null,
    exchange: r.exchange ?? null,
    currency: r.currency ?? null,
    isActive: r.isActive ?? null,
    lastDate: toDate10(r.lastDate),
    lastClose: toNum(r.lastClose),
    startDate: toDate10(r.startDate),
    endDate: toDate10(r.endDate),
    rows: typeof r.rows === "number" ? r.rows : Number(r.rows ?? 0),
  }));

  return { count: rows.length, rows };
}

function fmtNum(n: number | null): string {
  if (n === null) return "NA";
  if (!Number.isFinite(n)) return "NA";
  return n.toLocaleString("en-US", { maximumFractionDigits: 6 });
}

export default async function StocksPage() {
  let data: { count: number; rows: StockRow[] } | null = null;
  let err: string | null = null;

  try {
    data = await getStocks(5000);
  } catch (e: any) {
    err = e?.message ?? String(e);
  }

  if (err) {
    return (
      <main className="mx-auto max-w-6xl px-6 py-10">
        <h1 className="text-2xl font-semibold">Stocks</h1>
        <p className="mt-4 text-sm text-red-400">
          Server error while loading stocks. {err}
        </p>
        <p className="mt-2 text-sm text-zinc-400">
          Action: verify DATABASE_URL, DNS reachability to Supabase, and that public.stocks_latest and public.prices_daily exist.
        </p>
      </main>
    );
  }

  const rows = data?.rows ?? [];

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Stocks</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Universe: {data?.count ?? 0} tickers
          </p>
        </div>

        <div className="text-sm text-zinc-400">
          Source: stocks_latest + prices_daily
        </div>
      </div>

      <div className="mt-6 overflow-x-auto rounded-xl border border-zinc-800">
        <table className="min-w-full text-sm">
          <thead className="bg-zinc-950">
            <tr className="text-left text-zinc-300">
              <th className="px-4 py-3">Ticker</th>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Sector</th>
              <th className="px-4 py-3">Exchange</th>
              <th className="px-4 py-3">Currency</th>
              <th className="px-4 py-3">Last date</th>
              <th className="px-4 py-3">Last close</th>
              <th className="px-4 py-3">Start</th>
              <th className="px-4 py-3">End</th>
              <th className="px-4 py-3">Rows</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>

          <tbody>
            {rows.map((r) => (
              <tr key={r.ticker} className="border-t border-zinc-800 hover:bg-zinc-950">
                <td className="px-4 py-3 font-medium">
                  <Link
                    href={`/stocks/${encodeURIComponent(r.ticker)}`}
                    className="text-blue-400 hover:underline"
                  >
                    {r.ticker}
                  </Link>
                </td>
                <td className="px-4 py-3">{r.name ?? "NA"}</td>
                <td className="px-4 py-3">{r.sector ?? "NA"}</td>
                <td className="px-4 py-3">{r.exchange ?? "NA"}</td>
                <td className="px-4 py-3">{r.currency ?? "NA"}</td>
                <td className="px-4 py-3">{r.lastDate ?? "NA"}</td>
                <td className="px-4 py-3">{fmtNum(r.lastClose)}</td>
                <td className="px-4 py-3">{r.startDate ?? "NA"}</td>
                <td className="px-4 py-3">{r.endDate ?? "NA"}</td>
                <td className="px-4 py-3">{Number.isFinite(r.rows) ? r.rows.toLocaleString() : "0"}</td>
                <td className="px-4 py-3">
                  {r.isActive === null ? "NA" : r.isActive ? "active" : "inactive"}
                </td>
              </tr>
            ))}

            {!rows.length && (
              <tr>
                <td className="px-4 py-6 text-zinc-400" colSpan={11}>
                  No rows returned. Validate that public.stocks_latest is populated.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}
