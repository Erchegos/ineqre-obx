// apps/web/src/app/stocks/page.tsx
import Link from "next/link";

export const dynamic = "force-dynamic";

type StockRow = {
  ticker: string;
  name: string | null;
  sector: string | null;
  exchange: string | null;
  currency: string | null;
  startDate: string | null;
  endDate: string | null;
  lastDate: string | null;
  rows: number | null;
  lastClose: number | null;
};

function formatDateCell(v: string | null) {
  if (!v) return "n/a";
  const d = new Date(`${v}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return v;
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

function formatNumCell(v: number | null) {
  if (v === null || v === undefined || !Number.isFinite(v)) return "n/a";
  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(v);
}

function formatIntCell(v: number | null) {
  if (v === null || v === undefined || !Number.isFinite(v)) return "n/a";
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(v);
}

function textCell(v: string | null) {
  if (!v) return "n/a";
  return v;
}

async function fetchStocks(limit = 5000): Promise<{ count: number; rows: StockRow[] }> {
  const res = await fetch(`/api/stocks?limit=${limit}`, {
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to load stocks (${res.status}): ${text}`);
  }

  const json = (await res.json()) as { count?: number; rows?: StockRow[] };

  return {
    count: typeof json.count === "number" ? json.count : 0,
    rows: Array.isArray(json.rows) ? json.rows : [],
  };
}

export default async function StocksPage() {
  const { count, rows } = await fetchStocks(5000);

  return (
    <main className="mx-auto w-full max-w-7xl px-6 py-10">
      <div className="mb-8">
        <h1 className="text-4xl font-semibold tracking-tight">Intelligence Equity Research</h1>
        <p className="mt-2 text-sm text-white/70">Open stocks universe</p>
        <p className="mt-4 text-sm text-white/70">Total: {count}</p>
      </div>

      <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/5 shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1100px] border-collapse">
            <thead className="bg-white/5">
              <tr className="text-left text-xs uppercase tracking-wide text-white/60">
                <th className="px-5 py-4">Ticker</th>
                <th className="px-5 py-4">Name</th>
                <th className="px-5 py-4">Sector</th>
                <th className="px-5 py-4">Exchange</th>
                <th className="px-5 py-4">Currency</th>
                <th className="px-5 py-4">Start date</th>
                <th className="px-5 py-4">End date</th>
                <th className="px-5 py-4 text-right">Data points</th>
                <th className="px-5 py-4">Last date</th>
                <th className="px-5 py-4 text-right">Last close</th>
              </tr>
            </thead>

            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td className="px-5 py-10 text-center text-sm text-white/60" colSpan={10}>
                    No rows returned.
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.ticker} className="border-t border-white/10 hover:bg-white/5">
                    <td className="px-5 py-4 font-medium">
                      <Link
                        href={`/stocks/${encodeURIComponent(r.ticker)}`}
                        className="text-white/90 hover:text-white"
                      >
                        {String(r.ticker ?? "").toUpperCase()}
                      </Link>
                    </td>

                    <td className="px-5 py-4 text-white/75">{textCell(r.name)}</td>
                    <td className="px-5 py-4 text-white/75">{textCell(r.sector)}</td>
                    <td className="px-5 py-4 text-white/75">{textCell(r.exchange)}</td>
                    <td className="px-5 py-4 text-white/75">{textCell(r.currency)}</td>

                    <td className="px-5 py-4 text-white/75">{formatDateCell(r.startDate)}</td>
                    <td className="px-5 py-4 text-white/75">{formatDateCell(r.endDate)}</td>

                    <td className="px-5 py-4 text-right tabular-nums text-white/85">
                      {formatIntCell(r.rows)}
                    </td>

                    <td className="px-5 py-4 text-white/75">{formatDateCell(r.lastDate)}</td>

                    <td className="px-5 py-4 text-right tabular-nums text-white/85">
                      {formatNumCell(r.lastClose)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="border-t border-white/10 px-5 py-3 text-xs text-white/50">
          Data source: db. Name and sector are null until you add a fundamentals source.
        </div>
      </div>
    </main>
  );
}
