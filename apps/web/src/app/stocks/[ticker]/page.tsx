"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import PriceChart from "@/components/PriceChart";
import PriceDrawdownChart from "@/components/price-drawdown-chart";

type AnalyticsData = {
  ticker: string;
  count: number;
  summary: {
    totalReturn: number;
    annualizedReturn: number;
    volatility: number;
    maxDrawdown: number;
    var95: number;
    cvar95: number;
    beta: number;
    sharpeRatio: number;
  };
  prices: Array<{ date: string; close: number }>;
  returns: Array<{ date: string; return: number }>;
  drawdown: Array<{ date: string; drawdown: number }>;
  dateRange: {
    start: string;
    end: string;
  };
};

function clampInt(v: string | null, def: number, min: number, max: number) {
  const n = v ? Number(v) : Number.NaN;
  if (!Number.isFinite(n)) return def;
  return Math.min(Math.max(Math.trunc(n), min), max);
}

function fmtPct(x: number | null, digits = 2): string {
  if (x === null || !Number.isFinite(x)) return "NA";
  return (x * 100).toFixed(digits) + "%";
}

function fmtNum(x: number | null, digits = 2): string {
  if (x === null || !Number.isFinite(x)) return "NA";
  return x.toFixed(digits);
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
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [error, setError] = useState<string | null>(null);

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

      try {
        const url = `/api/analytics/${encodeURIComponent(ticker)}?limit=${encodeURIComponent(
          String(limit)
        )}`;

        const res = await fetch(url, {
          method: "GET",
          headers: { accept: "application/json" },
          cache: "no-store",
        });

        if (!res.ok) {
          const text = await res.text();
          if (!cancelled) {
            setError(`Analytics API failed (${res.status} ${res.statusText}): ${text}`);
            setData(null);
          }
          return;
        }

        const json = (await res.json()) as AnalyticsData;

        if (!cancelled) {
          setData(json);
          setLoading(false);
        }
      } catch (e: any) {
        if (!cancelled) {
          setError(e?.message ?? String(e));
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
    <main style={{ padding: 24, maxWidth: 1400, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 24, flexWrap: "wrap" }}>
        <h1 style={{ fontSize: 32, fontWeight: 600, margin: 0, letterSpacing: "-0.02em" }}>
          {ticker || "?"}
        </h1>
        <Link
          href="/stocks"
          style={{ color: "rgba(255,255,255,0.6)", textDecoration: "none", fontSize: 14 }}
        >
          ← Back to stocks
        </Link>
        <div style={{ flex: 1 }} />
        
        {/* Volatility Analysis Link */}
        <Link
          href={`/volatility/${ticker}`}
          style={{
            padding: "8px 16px",
            borderRadius: 4,
            background: "rgba(100, 100, 100, 0.2)",
            border: "1px solid rgba(255, 255, 255, 0.2)",
            color: "rgba(255, 255, 255, 0.9)",
            fontSize: 13,
            fontWeight: 500,
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            textDecoration: "none",
            letterSpacing: "0.01em",
            transition: "all 0.15s",
          }}
        >
          Volatility Analysis
        </Link>
      </div>

      <div style={{ marginBottom: 20, color: "rgba(255,255,255,0.6)", fontSize: 13 }}>
        Sample size:&nbsp;
        <input
          type="number"
          min={20}
          max={5000}
          step={1}
          value={limit}
          onChange={(e) => setLimit(clampInt(e.target.value, 1500, 20, 5000))}
          style={{
            width: 90,
            padding: "6px 10px",
            borderRadius: 3,
            border: "1px solid rgba(255,255,255,0.15)",
            background: "rgba(0,0,0,0.3)",
            color: "white",
            outline: "none",
            fontSize: 13,
          }}
        />
        {" "}observations
      </div>

      {loading && (
        <div
          style={{
            padding: 20,
            borderRadius: 4,
            border: "1px solid rgba(255,255,255,0.1)",
            background: "rgba(255,255,255,0.02)",
            color: "rgba(255,255,255,0.6)",
            fontSize: 14,
          }}
        >
          Loading analytics...
        </div>
      )}

      {!loading && error && (
        <div
          style={{
            padding: 20,
            borderRadius: 4,
            border: "1px solid rgba(220, 80, 80, 0.3)",
            background: "rgba(120, 0, 0, 0.15)",
          }}
        >
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 6, color: "rgba(255, 150, 150, 1)" }}>
            Error
          </div>
          <div style={{ fontSize: 13, color: "rgba(255,255,255,0.7)" }}>{error}</div>
        </div>
      )}

      {!loading && data && !data.summary && (
        <div
          style={{
            padding: 20,
            borderRadius: 4,
            border: "1px solid rgba(200, 160, 80, 0.3)",
            background: "rgba(100, 70, 0, 0.15)",
          }}
        >
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8, color: "rgba(230, 200, 120, 1)" }}>
            Insufficient Data
          </div>
          <div style={{ color: "rgba(255,255,255,0.7)", lineHeight: 1.6, fontSize: 13 }}>
            This ticker has insufficient data for returns and volatility analytics.
            <br />
            Consider the{" "}
            <Link
              href={`/volatility/${ticker}`}
              style={{
                color: "rgba(147, 197, 253, 1)",
                textDecoration: "underline",
              }}
            >
              Volatility Analysis
            </Link>
            {" "}module (requires OHLC data).
          </div>
        </div>
      )}

      {!loading && data && data.summary && (
        <>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              gap: 12,
              marginBottom: 28,
            }}
          >
            <MetricCard
              label="Total Return"
              value={fmtPct(data.summary.totalReturn)}
              color={data.summary.totalReturn >= 0 ? "rgba(80,180,80,0.9)" : "rgba(200,80,80,0.9)"}
            />
            <MetricCard
              label="Annualized Return"
              value={fmtPct(data.summary.annualizedReturn)}
            />
            <MetricCard label="Volatility (Ann.)" value={fmtPct(data.summary.volatility)} />
            <MetricCard
              label="Max Drawdown"
              value={fmtPct(data.summary.maxDrawdown)}
              color="rgba(200,100,100,0.9)"
            />
            <MetricCard label="VaR (95%)" value={fmtPct(data.summary.var95)} />
            <MetricCard label="CVaR (95%)" value={fmtPct(data.summary.cvar95)} />
            <MetricCard label="Beta (vs OBX)" value={fmtNum(data.summary.beta, 3)} />
            <MetricCard label="Sharpe Ratio" value={fmtNum(data.summary.sharpeRatio, 3)} />
          </div>

          <div style={{ marginBottom: 24, color: "rgba(255,255,255,0.5)", fontSize: 12, letterSpacing: "0.02em" }}>
            Sample: {data.dateRange.start} to {data.dateRange.end} ({data.count} observations)
          </div>

          <div
            style={{
              marginBottom: 24,
              padding: 20,
              borderRadius: 4,
              border: "1px solid rgba(255,255,255,0.08)",
              background: "rgba(255,255,255,0.02)",
            }}
          >
            <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16, letterSpacing: "0.01em" }}>
              Price Series
            </h2>
            <PriceChart data={data.prices} height={320} />
          </div>

          <div
            style={{
              marginBottom: 24,
              padding: 20,
              borderRadius: 4,
              border: "1px solid rgba(255,255,255,0.08)",
              background: "rgba(255,255,255,0.02)",
            }}
          >
            <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16, letterSpacing: "0.01em" }}>
              Drawdown Analysis
            </h2>
            <PriceDrawdownChart data={data.drawdown} height={280} />
          </div>

          <div
            style={{
              padding: 20,
              borderRadius: 4,
              border: "1px solid rgba(255,255,255,0.08)",
              background: "rgba(255,255,255,0.02)",
            }}
          >
            <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16, letterSpacing: "0.01em" }}>
              Daily Returns (Recent 20)
            </h2>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ textAlign: "left" }}>
                    <th
                      style={{
                        padding: "10px 12px",
                        borderBottom: "1px solid rgba(255,255,255,0.1)",
                        color: "rgba(255,255,255,0.6)",
                        fontWeight: 500,
                        fontSize: 12,
                        letterSpacing: "0.03em",
                        textTransform: "uppercase",
                      }}
                    >
                      Date
                    </th>
                    <th
                      style={{
                        padding: "10px 12px",
                        borderBottom: "1px solid rgba(255,255,255,0.1)",
                        color: "rgba(255,255,255,0.6)",
                        fontWeight: 500,
                        fontSize: 12,
                        letterSpacing: "0.03em",
                        textTransform: "uppercase",
                      }}
                    >
                      Return
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.returns
                    .slice(-20)
                    .reverse()
                    .map((r) => (
                      <tr
                        key={r.date}
                        style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}
                      >
                        <td style={{ padding: "10px 12px", color: "rgba(255,255,255,0.7)" }}>
                          {r.date}
                        </td>
                        <td
                          style={{
                            padding: "10px 12px",
                            fontFamily: "monospace",
                            color:
                              r.return > 0
                                ? "rgba(80,180,80,1)"
                                : r.return < 0
                                ? "rgba(200,80,80,1)"
                                : "rgba(255,255,255,0.7)",
                          }}
                        >
                          {fmtPct(r.return, 4)}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </main>
  );
}

function MetricCard({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div
      style={{
        padding: 14,
        borderRadius: 3,
        border: "1px solid rgba(255,255,255,0.08)",
        background: "rgba(255,255,255,0.02)",
      }}
    >
      <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", marginBottom: 6, letterSpacing: "0.03em", textTransform: "uppercase" }}>
        {label}
      </div>
      <div
        style={{
          fontSize: 22,
          fontWeight: 600,
          color: color || "rgba(255,255,255,0.95)",
          fontFamily: "monospace",
        }}
      >
        {value}
      </div>
    </div>
  );
}