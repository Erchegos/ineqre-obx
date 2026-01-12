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
          headers: { "accept": "application/json" },
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

        const json = await res.json() as AnalyticsData;

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
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 20 }}>
        <h1 style={{ fontSize: 36, fontWeight: 800, margin: 0 }}>
          {ticker || "?"}
        </h1>
        <Link
          href="/stocks"
          style={{ color: "rgba(255,255,255,0.7)", textDecoration: "none" }}
        >
          ← Back to stocks
        </Link>
      </div>

      <div style={{ marginBottom: 16, color: "rgba(255,255,255,0.75)" }}>
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
      </div>

      {loading && (
        <div
          style={{
            padding: 20,
            borderRadius: 12,
            border: "1px solid rgba(255,255,255,0.12)",
            background: "rgba(255,255,255,0.04)",
          }}
        >
          Loading analytics...
        </div>
      )}

      {!loading && error && (
        <div
          style={{
            padding: 20,
            borderRadius: 12,
            border: "1px solid rgba(255,140,140,0.35)",
            background: "rgba(120,0,0,0.22)",
          }}
        >
          <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 8 }}>Error</div>
          <div>{error}</div>
        </div>
      )}

      {!loading && data && (
        <>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
              gap: 16,
              marginBottom: 24,
            }}
          >
            <MetricCard
              label="Total Return"
              value={fmtPct(data.summary.totalReturn)}
              color="rgba(100,200,100,0.9)"
            />
            <MetricCard
              label="Annualized Return"
              value={fmtPct(data.summary.annualizedReturn)}
            />
            <MetricCard
              label="Volatility (Ann.)"
              value={fmtPct(data.summary.volatility)}
            />
            <MetricCard
              label="Max Drawdown"
              value={fmtPct(data.summary.maxDrawdown)}
              color="rgba(255,140,140,0.9)"
            />
            <MetricCard
              label="VaR (95%)"
              value={fmtPct(data.summary.var95)}
            />
            <MetricCard
              label="CVaR (95%)"
              value={fmtPct(data.summary.cvar95)}
            />
            <MetricCard
              label="Beta (vs OBX)"
              value={fmtNum(data.summary.beta, 3)}
            />
            <MetricCard
              label="Sharpe Ratio"
              value={fmtNum(data.summary.sharpeRatio, 3)}
            />
          </div>

          <div style={{ marginBottom: 24, color: "rgba(255,255,255,0.7)", fontSize: 14 }}>
            Data range: {data.dateRange.start} to {data.dateRange.end} ({data.count} days)
          </div>

          <div
            style={{
              marginBottom: 24,
              padding: 20,
              borderRadius: 12,
              border: "1px solid rgba(255,255,255,0.12)",
              background: "rgba(255,255,255,0.03)",
            }}
          >
            <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 16 }}>
              Price History
            </h2>
            <PriceChart data={data.prices} height={320} />
          </div>

          <div
            style={{
              marginBottom: 24,
              padding: 20,
              borderRadius: 12,
              border: "1px solid rgba(255,255,255,0.12)",
              background: "rgba(255,255,255,0.03)",
            }}
          >
            <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 16 }}>
              Drawdown
            </h2>
            <PriceDrawdownChart data={data.drawdown} height={280} />
          </div>

          <div
            style={{
              padding: 20,
              borderRadius: 12,
              border: "1px solid rgba(255,255,255,0.12)",
              background: "rgba(255,255,255,0.03)",
            }}
          >
            <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 16 }}>
              Recent Daily Returns
            </h2>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                <thead>
                  <tr style={{ textAlign: "left" }}>
                    <th
                      style={{
                        padding: "10px 12px",
                        borderBottom: "1px solid rgba(255,255,255,0.08)",
                        color: "rgba(255,255,255,0.8)",
                        fontWeight: 700,
                      }}
                    >
                      Date
                    </th>
                    <th
                      style={{
                        padding: "10px 12px",
                        borderBottom: "1px solid rgba(255,255,255,0.08)",
                        color: "rgba(255,255,255,0.8)",
                        fontWeight: 700,
                      }}
                    >
                      Return
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.returns.slice(-20).reverse().map((r) => (
                    <tr
                      key={r.date}
                      style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}
                    >
                      <td style={{ padding: "10px 12px" }}>{r.date}</td>
                      <td
                        style={{
                          padding: "10px 12px",
                          color:
                            r.return > 0
                              ? "rgba(100,200,100,1)"
                              : r.return < 0
                              ? "rgba(255,140,140,1)"
                              : "inherit",
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
        padding: 16,
        borderRadius: 10,
        border: "1px solid rgba(255,255,255,0.12)",
        background: "rgba(255,255,255,0.03)",
      }}
    >
      <div style={{ fontSize: 12, color: "rgba(255,255,255,0.6)", marginBottom: 6 }}>
        {label}
      </div>
      <div
        style={{
          fontSize: 24,
          fontWeight: 700,
          color: color || "rgba(255,255,255,0.95)",
        }}
      >
        {value}
      </div>
    </div>
  );
}