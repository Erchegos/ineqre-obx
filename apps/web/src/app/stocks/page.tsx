// apps/web/src/app/stocks/page.tsx
import Link from "next/link";

type StockRow = {
  ticker: string;
  name: string | null;
  sector: string | null;
  exchange: string | null;
  currency: string | null;
  isActive: boolean | null;
  lastDate: string | null;
  lastClose: unknown; // numeric from Postgres can arrive as string
};

function getBaseUrl() {
  const explicit = process.env.NEXT_PUBLIC_BASE_URL;
  if (explicit) return explicit.replace(/\/$/, "");
  const vercel = process.env.VERCEL_URL;
  if (vercel) return `https://${vercel}`;
  return "http://localhost:3000";
}

function fmt2(x: unknown) {
  if (x == null) return "";
  const n = typeof x === "number" ? x : Number(x);
  return Number.isFinite(n) ? n.toFixed(2) : "";
}

export default async function StocksPage() {
  const baseUrl = getBaseUrl();

  const res = await fetch(`${baseUrl}/api/stocks`, { cache: "no-store" });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to load stocks (${res.status}): ${text}`);
  }

  const json = (await res.json()) as { count?: number; rows?: StockRow[] };

  const rows: StockRow[] = Array.isArray(json.rows) ? json.rows : [];
  const total = typeof json.count === "number" ? json.count : rows.length;

  return (
    <main
      style={{
        padding: 24,
        fontFamily:
          "system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
      }}
    >
      <h1 style={{ fontSize: 44, fontWeight: 850, margin: "12px 0 4px" }}>
        Intelligence Equity Research
      </h1>
      <div style={{ opacity: 0.75, marginBottom: 18 }}>Open stocks universe</div>

      <div style={{ opacity: 0.75, marginBottom: 12 }}>Total: {total}</div>

      <div
        style={{
          borderRadius: 16,
          overflow: "hidden",
          border: "1px solid rgba(255,255,255,0.08)",
          background: "rgba(255,255,255,0.02)",
        }}
      >
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "rgba(255,255,255,0.04)" }}>
              <th style={th}>Ticker</th>
              <th style={th}>Name</th>
              <th style={th}>Sector</th>
              <th style={th}>Exchange</th>
              <th style={th}>Currency</th>
              <th style={th}>Active</th>
              <th style={th}>Last date</th>
              <th style={th}>Last close</th>
            </tr>
          </thead>

          <tbody>
            {rows.map((r) => (
              <tr
                key={r.ticker}
                style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}
              >
                <td style={tdMono}>
                  <Link
                    href={`/stocks/${encodeURIComponent(r.ticker)}`}
                    style={{ textDecoration: "none", opacity: 0.95 }}
                  >
                    {r.ticker}
                  </Link>
                </td>
                <td style={td}>{r.name ?? ""}</td>
                <td style={td}>{r.sector ?? ""}</td>
                <td style={td}>{r.exchange ?? ""}</td>
                <td style={td}>{r.currency ?? ""}</td>
                <td style={td}>{r.isActive ? "yes" : "no"}</td>
                <td style={tdMono}>{r.lastDate ?? ""}</td>
                <td style={td}>{fmt2(r.lastClose)}</td>
              </tr>
            ))}

            {!rows.length && (
              <tr>
                <td style={{ ...td, padding: 16 }} colSpan={8}>
                  No data returned from /api/stocks
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 12, opacity: 0.55, fontSize: 12 }}>
        Data source: Postgres (obx_equities)
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
