"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";

type EquityRow = {
  date: string; // ISO
  open: string | number | null;
  high: string | number | null;
  low: string | number | null;
  close: string | number | null;
  volume: string | number | null;
  vwap?: string | number | null;
  turnover?: string | number | null;
  numberOfTrades?: string | number | null;
  numberOfShares?: string | number | null;
  ticker?: string;
  source?: string | null;
};

type EquityApiOk = {
  ticker: string;
  count: number;
  rows: EquityRow[];
  source?: string;
};

type EquityApiErr = {
  error: string;
  pg?: { message?: string; code?: string | null };
  [k: string]: any;
};

function clampInt(v: string | null, def: number, min: number, max: number) {
  const n = v ? Number(v) : Number.NaN;
  if (!Number.isFinite(n)) return def;
  return Math.min(Math.max(Math.trunc(n), min), max);
}

function toNum(x: any): number | null {
  if (x === null || x === undefined) return null;
  const n = typeof x === "number" ? x : Number(x);
  return Number.isFinite(n) ? n : null;
}

function fmtNum(x: any, digits = 2) {
  const n = toNum(x);
  if (n === null) return "NA";
  return n.toFixed(digits);
}

function fmtInt(x: any) {
  const n = toNum(x);
  if (n === null) return "NA";
  return Math.trunc(n).toLocaleString("en-US");
}

function fmtDate(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().slice(0, 10);
}

export default function StockTickerPage() {
  const params = useParams<{ ticker?: string }>();
  const searchParams = useSearchParams();

  const ticker = useMemo(() => {
    const t = params?.ticker;
    return typeof t === "string" && t.length ? decodeURIComponent(t).toUpperCase() : "";
  }, [params]);

  const initialLimit = useMemo(() => {
    return clampInt(searchParams.get("limit"), 1500, 20, 5000);
  }, [searchParams]);

  const [limit, setLimit] = useState<number>(initialLimit);

  const [loading, setLoading] = useState<boolean>(true);
  const [data, setData] = useState<EquityApiOk | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rawError, setRawError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (!ticker) {
        setLoading(false);
        setData(null);
        setError("Missing ticker in route params.");
        return;
      }

      setLoading(true);
      setError(null);
      setRawError(null);

      try {
        const url = `/api/equities/${encodeURIComponent(ticker)}?limit=${encodeURIComponent(
          String(limit)
        )}`;

        const res = await fetch(url, {
          method: "GET",
          headers: { "accept": "application/json" },
          cache: "no-store",
        });

        const text = await res.text();

        if (!res.ok) {
          // Try JSON first, otherwise keep raw body
          try {
            const j = JSON.parse(text) as EquityApiErr;
            const msg =
              j?.pg?.message ??
              j?.error ??
              `Equities API failed (${res.status} ${res.statusText}).`;
            if (!cancelled) {
              setError(msg);
              setRawError(text);
              setData(null);
            }
          } catch {
            if (!cancelled) {
              setError(`Equities API failed (${res.status} ${res.statusText}).`);
              setRawError(text);
              setData(null);
            }
          }
          return;
        }

        const json = JSON.parse(text) as EquityApiOk;

        if (!cancelled) {
          setData(json);
          setLoading(false);
        }
      } catch (e: any) {
        if (!cancelled) {
          setError(e?.message ?? String(e));
          setRawError(null);
          setData(null);
          setLoading(false);
        }
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [ticker, limit]);

  return (
    <main style={{ padding: 24 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
        <h1 style={{ fontSize: 36, fontWeight: 800, margin: 0 }}>
          Stock {ticker || "?"}
        </h1>
        <Link
          href="/stocks"
          style={{ color: "rgba(255,255,255,0.7)", textDecoration: "none" }}
        >
          Back to stocks
        </Link>
      </div>

      <div style={{ marginTop: 10, color: "rgba(255,255,255,0.75)" }}>
        Limit:&nbsp;
        <input
          type="number"
          min={20}
          max={5000}
          step={1}
          value={limit}
          onChange={(e) => setLimit(clampInt(e.target.value, 1500, 20, 5000))}
          style={{
            width: 110,
            padding: "6px 8px",
            borderRadius: 8,
            border: "1px solid rgba(255,255,255,0.12)",
            background: "rgba(0,0,0,0.25)",
            color: "white",
            outline: "none",
            marginLeft: 6,
          }}
        />
        {data?.source ? (
          <span style={{ marginLeft: 12, opacity: 0.7 }}>Source: {data.source}</span>
        ) : null}
      </div>

      {loading ? (
        <div
          style={{
            marginTop: 18,
            padding: 14,
            borderRadius: 12,
            border: "1px solid rgba(255,255,255,0.12)",
            background: "rgba(255,255,255,0.04)",
          }}
        >
          Loading…
        </div>
      ) : null}

      {!loading && error ? (
        <div
          style={{
            marginTop: 18,
            padding: 16,
            borderRadius: 12,
            border: "1px solid rgba(255,140,140,0.35)",
            background: "rgba(120,0,0,0.22)",
          }}
        >
          <div style={{ fontWeight: 800, fontSize: 20, marginBottom: 8 }}>
            Application error
          </div>
          <div style={{ opacity: 0.95 }}>{error}</div>
          {rawError ? (
            <pre
              style={{
                marginTop: 12,
                padding: 12,
                borderRadius: 10,
                background: "rgba(0,0,0,0.35)",
                overflowX: "auto",
                fontSize: 12,
                lineHeight: 1.35,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {rawError}
            </pre>
          ) : null}
          <div style={{ marginTop: 10, opacity: 0.85 }}>
            Direct check:&nbsp;
            <a
              href={`/api/equities/${encodeURIComponent(ticker || "")}?limit=20`}
              style={{ color: "rgba(130,190,255,1)", textDecoration: "none" }}
            >
              /api/equities/{ticker || ""}?limit=20
            </a>
          </div>
        </div>
      ) : null}

      {!loading && data ? (
        <div
          style={{
            marginTop: 18,
            borderRadius: 12,
            border: "1px solid rgba(255,255,255,0.12)",
            overflow: "hidden",
            background: "rgba(255,255,255,0.03)",
          }}
        >
          <div style={{ padding: 14, borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
            Rows: <b>{data.count}</b>
          </div>

          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
              <thead>
                <tr style={{ textAlign: "left" }}>
                  {[
                    "Date",
                    "Open",
                    "High",
                    "Low",
                    "Close",
                    "Volume",
                    "VWAP",
                    "Turnover",
                    "Trades",
                    "Shares",
                    "Source",
                  ].map((h) => (
                    <th
                      key={h}
                      style={{
                        padding: "10px 12px",
                        borderBottom: "1px solid rgba(255,255,255,0.08)",
                        color: "rgba(255,255,255,0.8)",
                        fontWeight: 700,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r, i) => (
                  <tr key={`${r.date}-${i}`} style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                    <td style={{ padding: "10px 12px", whiteSpace: "nowrap" }}>{fmtDate(r.date)}</td>
                    <td style={{ padding: "10px 12px" }}>{fmtNum(r.open, 2)}</td>
                    <td style={{ padding: "10px 12px" }}>{fmtNum(r.high, 2)}</td>
                    <td style={{ padding: "10px 12px" }}>{fmtNum(r.low, 2)}</td>
                    <td style={{ padding: "10px 12px" }}>{fmtNum(r.close, 2)}</td>
                    <td style={{ padding: "10px 12px" }}>{fmtInt(r.volume)}</td>
                    <td style={{ padding: "10px 12px" }}>{fmtNum(r.vwap, 4)}</td>
                    <td style={{ padding: "10px 12px" }}>{fmtNum(r.turnover, 2)}</td>
                    <td style={{ padding: "10px 12px" }}>{fmtInt(r.numberOfTrades)}</td>
                    <td style={{ padding: "10px 12px" }}>{fmtInt(r.numberOfShares)}</td>
                    <td style={{ padding: "10px 12px", opacity: 0.85 }}>
                      {r.source ?? "NA"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </main>
  );
}
