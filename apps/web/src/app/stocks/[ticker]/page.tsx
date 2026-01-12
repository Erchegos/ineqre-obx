// apps/web/src/app/stocks/[ticker]/page.tsx
import Link from "next/link";
import { headers } from "next/headers";

export const dynamic = "force-dynamic";

type EquityRow = {
  date: string;
  open: string | number | null;
  high: string | number | null;
  low: string | number | null;
  close: string | number | null;
  volume: string | number | null;
  vwap: string | number | null;
  turnover: string | number | null;
  numberOfTrades: string | number | null;
  numberOfShares: string | number | null;
  ticker: string;
  source?: string | null;
};

type EquitiesApiResponse =
  | {
      vercelCommit?: string;
      nodeEnv?: string;
      dbUrlHost?: string;
      ticker: string;
      count: number;
      rows: EquityRow[];
      selectedColumns?: string[];
      source?: string;
    }
  | {
      error: string;
      pg?: any;
      schema?: any;
    };

function clampInt(v: string | undefined, def: number, min: number, max: number) {
  const n = v ? Number(v) : Number.NaN;
  if (!Number.isFinite(n)) return def;
  return Math.min(Math.max(Math.trunc(n), min), max);
}

function fmtDate(d: string | null | undefined) {
  if (!d) return "NA";
  const x = new Date(d);
  if (Number.isNaN(x.getTime())) return String(d);
  return x.toISOString().slice(0, 10);
}

function fmtNum(x: any) {
  if (x === null || x === undefined) return "NA";
  const n = typeof x === "string" ? Number(x) : x;
  if (!Number.isFinite(n)) return String(x);
  return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

async function getBaseUrl() {
  // Next 16 returns Promise<ReadonlyHeaders> in some setups
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.includes("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export default async function StockTickerPage({
  params,
  searchParams,
}: {
  params: { ticker?: string };
  searchParams?: { limit?: string };
}) {
  const tickerRaw = params?.ticker ?? "";
  const ticker = String(tickerRaw).trim().toUpperCase();

  const limit = clampInt(searchParams?.limit, 1500, 1, 5000);

  if (!ticker) {
    return (
      <main style={{ padding: 24 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0 }}>Stock</h1>
        <p style={{ opacity: 0.8, marginTop: 8 }}>
          <Link href="/stocks">Back to stocks</Link>
        </p>

        <div
          style={{
            marginTop: 16,
            padding: 16,
            borderRadius: 12,
            border: "1px solid rgba(255,255,255,0.12)",
            background: "rgba(255, 0, 0, 0.08)",
          }}
        >
          <div style={{ fontWeight: 700 }}>Application error</div>
          <div style={{ marginTop: 6 }}>Missing ticker in route params.</div>
        </div>
      </main>
    );
  }

  const base = await getBaseUrl();

  // Use SAME ORIGIN in production to avoid Vercel Deployment Protection 401s.
  // Relative fetch is the most reliable path.
  const url = `/api/equities/${encodeURIComponent(ticker)}?limit=${limit}`;

  let data: EquitiesApiResponse | null = null;
  let errorText: string | null = null;

  try {
    const res = await fetch(url, { cache: "no-store" });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      errorText = `Equities API failed (${res.status} ${res.statusText}). URL=${url}. Body=${body.slice(0, 800)}`;
    } else {
      data = (await res.json()) as EquitiesApiResponse;
      if ((data as any)?.error) {
        errorText = `Equities API returned error payload. URL=${url}. error=${(data as any).error}`;
      }
    }
  } catch (e: any) {
    errorText = `Network failure calling equities API. URL=${url}. message=${e?.message ?? String(e)}`;
  }

  const rows = (data && "rows" in data ? data.rows : []) ?? [];
  const count = (data && "count" in data ? data.count : 0) ?? 0;
  const source = (data && "source" in data ? data.source : null) ?? "prices_daily";

  const startDate = rows.length ? rows[0]?.date : null;
  const endDate = rows.length ? rows[rows.length - 1]?.date : null;
  const last = rows.length ? rows[rows.length - 1] : null;

  return (
    <main style={{ padding: 24 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 16 }}>
        <h1 style={{ fontSize: 34, fontWeight: 800, margin: 0 }}>Stock {ticker}</h1>
        <Link href="/stocks" style={{ opacity: 0.8 }}>
          Back to stocks
        </Link>
      </div>

      <div style={{ marginTop: 10, opacity: 0.8 }}>
        Limit: {limit} | Base: {base}
      </div>

      {errorText ? (
        <div
          style={{
            marginTop: 16,
            padding: 16,
            borderRadius: 12,
            border: "1px solid rgba(255,255,255,0.12)",
            background: "rgba(255, 0, 0, 0.08)",
            whiteSpace: "pre-wrap",
          }}
        >
          <div style={{ fontWeight: 800, fontSize: 18 }}>Application error</div>
          <div style={{ marginTop: 8 }}>{errorText}</div>
          <div style={{ marginTop: 10, opacity: 0.9 }}>
            Direct check:{" "}
            <a href={url} style={{ textDecoration: "underline" }}>
              {url}
            </a>
          </div>
        </div>
      ) : (
        <>
          <div
            style={{
              marginTop: 16,
              padding: 16,
              borderRadius: 12,
              border: "1px solid rgba(255,255,255,0.12)",
              background: "rgba(255,255,255,0.04)",
            }}
          >
            <div style={{ display: "flex", flexWrap: "wrap", gap: 18, rowGap: 10 }}>
              <div>
                <div style={{ opacity: 0.75, fontSize: 12 }}>Source</div>
                <div style={{ fontWeight: 700 }}>{source}</div>
              </div>
              <div>
                <div style={{ opacity: 0.75, fontSize: 12 }}>Rows</div>
                <div style={{ fontWeight: 700 }}>{count}</div>
              </div>
              <div>
                <div style={{ opacity: 0.75, fontSize: 12 }}>Start</div>
                <div style={{ fontWeight: 700 }}>{fmtDate(startDate)}</div>
              </div>
              <div>
                <div style={{ opacity: 0.75, fontSize: 12 }}>End</div>
                <div style={{ fontWeight: 700 }}>{fmtDate(endDate)}</div>
              </div>
              <div>
                <div style={{ opacity: 0.75, fontSize: 12 }}>Last close</div>
                <div style={{ fontWeight: 700 }}>{fmtNum(last?.close)}</div>
              </div>
              <div>
                <div style={{ opacity: 0.75, fontSize: 12 }}>Last volume</div>
                <div style={{ fontWeight: 700 }}>{fmtNum(last?.volume)}</div>
              </div>
            </div>
          </div>

          <div
            style={{
              marginTop: 16,
              borderRadius: 12,
              border: "1px solid rgba(255,255,255,0.12)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                padding: 12,
                background: "rgba(255,255,255,0.04)",
                borderBottom: "1px solid rgba(255,255,255,0.12)",
                fontWeight: 800,
              }}
            >
              First 30 rows (chronological)
            </div>

            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ textAlign: "left", opacity: 0.85 }}>
                    {[
                      "date",
                      "open",
                      "high",
                      "low",
                      "close",
                      "volume",
                      "vwap",
                      "turnover",
                      "numberOfTrades",
                      "numberOfShares",
                      "source",
                    ].map((k) => (
                      <th key={k} style={{ padding: "10px 12px", borderBottom: "1px solid rgba(255,255,255,0.10)" }}>
                        {k}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 30).map((r, i) => (
                    <tr key={`${r.date}-${i}`} style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                      <td style={{ padding: "10px 12px" }}>{fmtDate(r.date)}</td>
                      <td style={{ padding: "10px 12px" }}>{fmtNum(r.open)}</td>
                      <td style={{ padding: "10px 12px" }}>{fmtNum(r.high)}</td>
                      <td style={{ padding: "10px 12px" }}>{fmtNum(r.low)}</td>
                      <td style={{ padding: "10px 12px" }}>{fmtNum(r.close)}</td>
                      <td style={{ padding: "10px 12px" }}>{fmtNum(r.volume)}</td>
                      <td style={{ padding: "10px 12px" }}>{fmtNum(r.vwap)}</td>
                      <td style={{ padding: "10px 12px" }}>{fmtNum(r.turnover)}</td>
                      <td style={{ padding: "10px 12px" }}>{fmtNum(r.numberOfTrades)}</td>
                      <td style={{ padding: "10px 12px" }}>{fmtNum(r.numberOfShares)}</td>
                      <td style={{ padding: "10px 12px" }}>{r.source ?? "NA"}</td>
                    </tr>
                  ))}
                  {rows.length === 0 ? (
                    <tr>
                      <td style={{ padding: "12px" }} colSpan={11}>
                        No rows returned for {ticker}.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </main>
  );
}
