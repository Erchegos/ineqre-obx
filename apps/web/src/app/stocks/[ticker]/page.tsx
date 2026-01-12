// apps/web/src/app/stocks/[ticker]/page.tsx
import Link from "next/link";
import { headers } from "next/headers";

export const dynamic = "force-dynamic";

function clampInt(v: string | null, def: number, min: number, max: number) {
  const n = v ? Number(v) : Number.NaN;
  if (!Number.isFinite(n)) return def;
  return Math.min(Math.max(Math.trunc(n), min), max);
}

function getRequestBaseUrl() {
  const h = headers();

  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.includes("localhost") ? "http" : "https");

  return `${proto}://${host}`;
}

type EquityRow = {
  date: string;
  open: string | number | null;
  high: string | number | null;
  low: string | number | null;
  close: string | number | null;
  volume?: string | number | null;
  vwap?: string | number | null;
  turnover?: string | number | null;
  source?: string | null;
  ticker?: string;
};

type EquityApiOk = {
  ticker?: string;
  count: number;
  rows: EquityRow[];
  source?: string;
};

async function fetchEquity(base: string, ticker: string, limit: number): Promise<EquityApiOk> {
  const url = `${base}/api/equities/${encodeURIComponent(ticker)}?limit=${limit}`;
  const res = await fetch(url, { cache: "no-store" });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Equities API failed (${res.status} ${res.statusText}). URL=${url}. Body=${body.slice(0, 2000)}`
    );
  }

  return (await res.json()) as EquityApiOk;
}

export default async function StockPage({
  params,
  searchParams,
}: {
  params: { ticker?: string };
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const base = getRequestBaseUrl();

  const rawTicker = params?.ticker;
  const ticker =
    typeof rawTicker === "string" && rawTicker.length > 0 ? decodeURIComponent(rawTicker).toUpperCase() : "";

  const limitParam = typeof searchParams?.limit === "string" ? searchParams.limit : null;
  const limit = clampInt(limitParam, 1500, 20, 5000);

  let data: EquityApiOk | null = null;
  let error: string | null = null;

  if (!ticker) {
    error = `Missing ticker in route params. params=${JSON.stringify(params)}`;
  } else {
    try {
      data = await fetchEquity(base, ticker, limit);
    } catch (e: unknown) {
      error = (e as any)?.message ?? String(e);
    }
  }

  return (
    <main style={{ padding: 24 }}>
      <div style={{ display: "flex", gap: 12, alignItems: "baseline" }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0 }}>Stock {ticker || "?"}</h1>
        <span style={{ opacity: 0.7 }}>
          <Link href="/stocks">Back to stocks</Link>
        </span>
      </div>

      <div style={{ marginTop: 10, opacity: 0.8 }}>
        Limit: {limit}
        {" | "}
        Base: {base}
        {data?.source ? ` | Source: ${data.source}` : ""}
        {data ? ` | Rows: ${data.count}` : ""}
      </div>

      {error ? (
        <div
          style={{
            marginTop: 16,
            padding: 14,
            borderRadius: 12,
            border: "1px solid rgba(255,255,255,0.12)",
            background: "rgba(255,0,0,0.06)",
            overflow: "auto",
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Application error</div>
          <div style={{ whiteSpace: "pre-wrap", fontFamily: "ui-monospace" }}>{error}</div>

          {ticker ? (
            <div style={{ marginTop: 10, opacity: 0.85 }}>
              Direct check:{" "}
              <a href={`/api/equities/${encodeURIComponent(ticker)}?limit=20`}>
                /api/equities/{ticker}?limit=20
              </a>
            </div>
          ) : null}
        </div>
      ) : null}

      {data && !error ? (
        <div
          style={{
            marginTop: 14,
            borderRadius: 12,
            border: "1px solid rgba(255,255,255,0.12)",
            overflow: "hidden",
          }}
        >
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "rgba(255,255,255,0.04)" }}>
                <th style={{ textAlign: "left", padding: 10 }}>Date</th>
                <th style={{ textAlign: "right", padding: 10 }}>Open</th>
                <th style={{ textAlign: "right", padding: 10 }}>High</th>
                <th style={{ textAlign: "right", padding: 10 }}>Low</th>
                <th style={{ textAlign: "right", padding: 10 }}>Close</th>
                <th style={{ textAlign: "right", padding: 10 }}>Volume</th>
                <th style={{ textAlign: "right", padding: 10 }}>VWAP</th>
                <th style={{ textAlign: "left", padding: 10 }}>Source</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.slice(0, 200).map((r, i) => (
                <tr key={`${r.date}-${i}`} style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}>
                  <td style={{ padding: 10 }}>{String(r.date).slice(0, 10)}</td>
                  <td style={{ padding: 10, textAlign: "right" }}>{r.open ?? ""}</td>
                  <td style={{ padding: 10, textAlign: "right" }}>{r.high ?? ""}</td>
                  <td style={{ padding: 10, textAlign: "right" }}>{r.low ?? ""}</td>
                  <td style={{ padding: 10, textAlign: "right" }}>{r.close ?? ""}</td>
                  <td style={{ padding: 10, textAlign: "right" }}>{r.volume ?? ""}</td>
                  <td style={{ padding: 10, textAlign: "right" }}>{r.vwap ?? ""}</td>
                  <td style={{ padding: 10 }}>{r.source ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </main>
  );
}
