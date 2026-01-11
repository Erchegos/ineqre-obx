import Link from "next/link";
import PriceChart, { type PriceChartPoint } from "@/components/PriceChart";
import { annualizedVolatility, maxDrawdown, var95 } from "@/lib/metrics";
console.log("TLS_REJECT", process.env.NODE_TLS_REJECT_UNAUTHORIZED);

export const dynamic = "force-dynamic";

type EquityRow = {
  date: string;
  close: number;
  ticker: string;
};

type ReturnRow = {
  date: string;
  r: number;
};

function toNum(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function computeLogReturns(rowsAsc: EquityRow[]): ReturnRow[] {
  const out: ReturnRow[] = [];
  for (let i = 1; i < rowsAsc.length; i++) {
    const prev = rowsAsc[i - 1].close;
    const curr = rowsAsc[i].close;
    if (!Number.isFinite(prev) || !Number.isFinite(curr) || prev <= 0 || curr <= 0) continue;
    out.push({ date: rowsAsc[i].date, r: Math.log(curr / prev) });
  }
  return out;
}

async function fetchEquity(ticker: string) {
  const base =
    process.env.NEXT_PUBLIC_BASE_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

  const res = await fetch(`${base}/api/equities/${encodeURIComponent(ticker)}?limit=1500`, {
    cache: "no-store",
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Failed to load equity data: ${res.status} ${txt}`);
  }

  const json = (await res.json()) as {
    ticker: string;
    count: number;
    rows: Array<{ date: string; close: unknown; ticker?: string }>;
  };

  const rows: EquityRow[] = (json.rows ?? [])
    .map((r) => {
      const c = toNum(r.close);
      if (c === null) return null;
      return {
        date: String(r.date).slice(0, 10),
        close: c,
        ticker: ticker.toUpperCase(),
      } satisfies EquityRow;
    })
    .filter((x): x is EquityRow => Boolean(x))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  return { ticker: ticker.toUpperCase(), rows };
}

export default async function StockPage({ params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await params;
  const { rows } = await fetchEquity(ticker);

  const chartData: PriceChartPoint[] = rows.map((r) => ({ date: r.date, close: r.close }));

  const rets = computeLogReturns(rows);
  const rvec = rets.map((x) => x.r);

  const volAnn = annualizedVolatility(rvec);
  const dd = maxDrawdown(rvec);
  const v = var95(rvec);

  const last = rows.at(-1);

  return (
    <div className="mx-auto max-w-5xl p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">{ticker.toUpperCase()}</h1>
          <p className="text-sm text-muted-foreground">
            Last close: {last ? last.close.toFixed(2) : "N/A"} NOK
          </p>
        </div>
        <Link href="/stocks" className="text-sm underline">
          Back to list
        </Link>
      </div>

      <div className="rounded-lg border p-4">
        <PriceChart data={chartData} />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="rounded-lg border p-4">
          <div className="text-sm text-muted-foreground">Annualized vol</div>
          <div className="text-xl font-semibold">{Number.isFinite(volAnn) ? (volAnn * 100).toFixed(2) : "N/A"}%</div>
        </div>
        <div className="rounded-lg border p-4">
          <div className="text-sm text-muted-foreground">Max drawdown</div>
          <div className="text-xl font-semibold">{Number.isFinite(dd) ? (dd * 100).toFixed(2) : "N/A"}%</div>
        </div>
        <div className="rounded-lg border p-4">
          <div className="text-sm text-muted-foreground">VaR 95%</div>
          <div className="text-xl font-semibold">{Number.isFinite(v) ? (v * 100).toFixed(2) : "N/A"}%</div>
        </div>
      </div>
    </div>
  );
}
