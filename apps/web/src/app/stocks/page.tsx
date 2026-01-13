// apps/web/src/app/stocks/page.tsx
import Link from "next/link";
import { pool } from "@/lib/db";
import { getPriceTable } from "@/lib/price-data-adapter";

export const dynamic = "force-dynamic";

type StockRow = {
  ticker: string;
  startDate: string | null;
  endDate: string | null;
  lastClose: number | null;
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

async function getStocks(): Promise<{ count: number; rows: StockRow[]; source: string }> {
  const tableName = await getPriceTable();
  
  const query = `
    WITH ticker_stats AS (
      SELECT 
        upper(ticker) as ticker,
        min(date) as start_date,
        max(date) as end_date,
        count(*) as row_count
      FROM public.${tableName}
      GROUP BY upper(ticker)
    ),
    latest_prices AS (
      SELECT DISTINCT ON (upper(ticker))
        upper(ticker) as ticker,
        close as last_close
      FROM public.${tableName}
      WHERE close IS NOT NULL
      ORDER BY upper(ticker), date DESC
    )
    SELECT 
      t.ticker,
      t.start_date::text as "startDate",
      t.end_date::text as "endDate",
      l.last_close as "lastClose",
      t.row_count as rows
    FROM ticker_stats t
    LEFT JOIN latest_prices l ON l.ticker = t.ticker
    ORDER BY t.ticker
  `;

  const result = await pool.query(query);
  
  const rows: StockRow[] = result.rows.map((r: any) => ({
    ticker: String(r.ticker ?? "").toUpperCase(),
    startDate: toDate10(r.startDate),
    endDate: toDate10(r.endDate),
    lastClose: toNum(r.lastClose),
    rows: Number(r.rows ?? 0),
  }));

  return { count: rows.length, rows, source: tableName };
}

function fmtNum(n: number | null): string {
  if (n === null) return "NA";
  if (!Number.isFinite(n)) return "NA";
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export default async function StocksPage() {
  let data: { count: number; rows: StockRow[]; source: string } | null = null;
  let err: string | null = null;

  try {
    data = await getStocks();
  } catch (e: any) {
    err = e?.message ?? String(e);
  }

  if (err) {
    return (
      <main className="mx-auto max-w-6xl px-6 py-10">
        <h1 className="text-2xl font-semibold">Stocks</h1>
        <p className="mt-4 text-sm text-red-400">
          Server error while loading stocks: {err}
        </p>
        <p className="mt-2 text-sm text-zinc-400">
          Check that DATABASE_URL is set and price tables exist.
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
          Source: {data?.source || "unknown"}
        </div>
      </div>

      <div className="mt-6 overflow-x-auto rounded-xl border border-zinc-800">
        <table className="min-w-full text-sm">
          <thead className="bg-zinc-950">
            <tr className="text-left text-zinc-300">
              <th className="px-4 py-3">Ticker</th>
              <th className="px-4 py-3">Last Close</th>
              <th className="px-4 py-3">Start Date</th>
              <th className="px-4 py-3">End Date</th>
              <th className="px-4 py-3">Rows</th>
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
                <td className="px-4 py-3">{fmtNum(r.lastClose)}</td>
                <td className="px-4 py-3">{r.startDate ?? "NA"}</td>
                <td className="px-4 py-3">{r.endDate ?? "NA"}</td>
                <td className="px-4 py-3">{r.rows.toLocaleString()}</td>
              </tr>
            ))}

            {!rows.length && (
              <tr>
                <td className="px-4 py-6 text-zinc-400" colSpan={5}>
                  No data found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}