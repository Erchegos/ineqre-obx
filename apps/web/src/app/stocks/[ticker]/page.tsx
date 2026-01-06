// apps/web/src/app/stocks/[ticker]/page.tsx
import Link from "next/link";

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

function pct(x: number) {
  return `${(x * 100).toFixed(2)}%`;
}

export default async function TickerPage({
  params,
}: {
  params: Promise<{ ticker: string }>;
}) {
  const { ticker: raw } = await params;
  const ticker = decodeURIComponent(raw || "").trim();

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
  const res = await fetch(`${baseUrl}/api/prices/${encodeURIComponent(ticker)}`, {
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to fetch prices (${res.status}): ${text}`);
  }

  const json = (await res.json()) as {
    ticker: string;
    rows: PriceRow[];
    returns: ReturnRow[];
    volatility: VolRow[];
  };

  const rows = json.rows ?? [];
  const returns = json.returns ?? [];
  const volatility = json.volatility ?? [];

  const lastReturn = returns.length ? returns[returns.length - 1].log_return : null;
  const lastVol = volatility.length ? volatility[volatility.length - 1].volatility : null;

  const dataSource =
    rows.length && rows.every((r) => r.source === "mock") ? "mock" : "real";

  // server-side sanity log (remove later)
  console.log({
    ticker,
    rows: rows.length,
    lastReturn,
    lastVol,
    dataSource,
  });

  return (
    <main style={{ padding: 24 }}>
      <div style={{ marginBottom: 12 }}>
        <Link href="/stocks" style={{ opacity: 0.85 }}>
          Back to stocks
        </Link>
      </div>

      <h1 style={{ fontSize: 32, fontWeight: 700, margin: "8px 0" }}>{ticker}</h1>

      <div
        style={{
          marginTop: 12,
          marginBottom: 16,
          padding: 16,
          borderRadius: 12,
          border: "1px solid rgba(255,255,255,0.08)",
          background: "rgba(255,255,255,0.03)",
          display: "flex",
          gap: 24,
          flexWrap: "wrap",
        }}
      >
        <div>
          <div style={{ opacity: 0.7, fontSize: 12 }}>Data source</div>
          <div style={{ fontSize: 16, fontWeight: 600 }}>{dataSource}</div>
        </div>

        <div>
          <div style={{ opacity: 0.7, fontSize: 12 }}>Last daily return</div>
          <div style={{ fontSize: 16, fontWeight: 600 }}>
            {lastReturn == null ? "n/a" : pct(lastReturn)}
          </div>
        </div>

        <div>
          <div style={{ opacity: 0.7, fontSize: 12 }}>20d volatility (daily)</div>
          <div style={{ fontSize: 16, fontWeight: 600 }}>
            {lastVol == null ? "n/a" : pct(lastVol)}
          </div>
        </div>

        <div>
          <div style={{ opacity: 0.7, fontSize: 12 }}>Daily rows</div>
          <div style={{ fontSize: 16, fontWeight: 600 }}>{rows.length}</div>
        </div>
      </div>

      <div
        style={{
          borderRadius: 12,
          overflow: "hidden",
          border: "1px solid rgba(255,255,255,0.08)",
        }}
      >
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "rgba(255,255,255,0.04)" }}>
              <th style={th}>Date</th>
              <th style={th}>Open</th>
              <th style={th}>High</th>
              <th style={th}>Low</th>
              <th style={th}>Close</th>
              <th style={th}>Volume</th>
              <th style={th}>Source</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.date} style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                <td style={tdMono}>{r.date}</td>
                <td style={td}>{fmt(r.open)}</td>
                <td style={td}>{fmt(r.high)}</td>
                <td style={td}>{fmt(r.low)}</td>
                <td style={td}>{fmt(r.close)}</td>
                <td style={td}>{r.volume ?? ""}</td>
                <td style={td}>{r.source}</td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td style={{ ...td, padding: 16 }} colSpan={7}>
                  No data
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}

const th: React.CSSProperties = {
  textAlign: "left",
  padding: "12px 14px",
  fontSize: 12,
  letterSpacing: 0.2,
  opacity: 0.8,
};

const td: React.CSSProperties = {
  padding: "10px 14px",
  fontSize: 13,
  opacity: 0.95,
};

const tdMono: React.CSSProperties = {
  ...td,
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
};

function fmt(x: number | null) {
  if (x == null) return "";
  return Number.isFinite(x) ? x.toFixed(2) : "";
}
