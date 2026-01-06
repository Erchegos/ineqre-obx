// apps/web/src/app/stocks/page.tsx
import Link from "next/link";

type Stock = {
  ticker: string;
  name: string;
  sector: string | null;
  exchange: string | null;
  currency: string | null;
  is_active: boolean | null;
};

type StocksResponse = {
  count: number;
  stocks: Stock[];
};

function getBaseUrl() {
  // Preferred: explicit override (set in Vercel)
  const explicit = process.env.NEXT_PUBLIC_BASE_URL;
  if (explicit) return explicit.replace(/\/$/, "");

  // Vercel: VERCEL_URL is like "www.ineqre.no" (no protocol)
  const vercelUrl = process.env.VERCEL_URL;
  if (vercelUrl) return `https://${vercelUrl}`;

  // Local dev fallback
 return "https://www.ineqre.no";

}

async function getStocks(): Promise<StocksResponse> {
  const baseUrl = getBaseUrl();

  const res = await fetch(`${baseUrl}/api/stocks`, {
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to load stocks (${res.status}): ${text}`);
  }

  return res.json();
}

export default async function StocksPage() {
  const { count, stocks } = await getStocks();

  return (
    <main style={{ padding: 24 }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 12 }}>
        Intelligence Equity Research
      </h1>

      <div style={{ opacity: 0.8, marginBottom: 16 }}>Open stocks universe</div>

      <div style={{ opacity: 0.7, fontSize: 12, marginBottom: 10 }}>
        Total: {count}
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
              <th style={th}>Ticker</th>
              <th style={th}>Name</th>
              <th style={th}>Sector</th>
              <th style={th}>Exchange</th>
              <th style={th}>Currency</th>
              <th style={th}>Active</th>
            </tr>
          </thead>
          <tbody>
            {stocks.map((s) => (
              <tr
                key={s.ticker}
                style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}
              >
                <td style={tdMono}>
                  <Link href={`/stocks/${encodeURIComponent(s.ticker)}`}>
                    {s.ticker}
                  </Link>
                </td>
                <td style={td}>{s.name}</td>
                <td style={td}>{s.sector ?? ""}</td>
                <td style={td}>{s.exchange ?? ""}</td>
                <td style={td}>{s.currency ?? ""}</td>
                <td style={td}>{s.is_active == null ? "" : s.is_active ? "yes" : "no"}</td>
              </tr>
            ))}

            {!stocks.length && (
              <tr>
                <td style={{ ...td, padding: 16 }} colSpan={6}>
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
