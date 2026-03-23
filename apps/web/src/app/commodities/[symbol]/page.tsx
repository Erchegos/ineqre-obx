"use client";

import Link from "next/link";
import { useEffect, useState, useMemo } from "react";
import { use } from "react";
import {
  ComposedChart, Area, Line, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, LineChart, ReferenceLine,
} from "recharts";
import { COMMODITY_META } from "@/lib/sectorMapping";

interface PriceRow {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
}

interface Sensitivity {
  ticker: string;
  stockName: string;
  sector: string;
  beta: number;
  correlation60d: number;
  correlation252d: number;
  rSquared: number;
}

interface CommodityDetail {
  symbol: string;
  currency: string;
  latest: { date: string; close: number; dayReturnPct: number | null };
  stats: {
    sma20: number | null;
    sma50: number | null;
    sma200: number | null;
    ytdReturnPct: number | null;
    high52w: number;
    low52w: number;
    dataPoints: number;
  };
  history: PriceRow[];
  sensitivities: Sensitivity[];
}

function fmtPct(v: number | null, dec = 2) {
  if (v === null || v === undefined) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(dec)}%`;
}
function pctColor(v: number | null) {
  if (v === null || v === undefined) return "rgba(255,255,255,0.35)";
  return v >= 0 ? "#10b981" : "#ef4444";
}
function fmtPrice(v: number | null | undefined) {
  if (v === null || v === undefined) return "—";
  if (v >= 1000) return v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (v >= 10) return v.toFixed(2);
  return v.toFixed(4);
}

type Timeframe = "1M" | "3M" | "6M" | "1Y" | "2Y" | "ALL";

export default function CommodityDetailPage({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = use(params);
  const decodedSymbol = decodeURIComponent(symbol).toUpperCase();
  const meta = COMMODITY_META[decodedSymbol];

  const [data, setData] = useState<CommodityDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [timeframe, setTimeframe] = useState<Timeframe>("1Y");
  const [showSMA, setShowSMA] = useState(true);
  const [sortCol, setSortCol] = useState<string>("beta");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/commodities/${encodeURIComponent(decodedSymbol)}`);
        if (res.ok) setData(await res.json());
      } catch (e) {
        console.error("Failed to load commodity", e);
      }
      setLoading(false);
    }
    load();
  }, [decodedSymbol]);

  // Filter history by timeframe
  const filteredHistory = useMemo(() => {
    if (!data?.history) return [];
    const now = new Date();
    const cutoffs: Record<Timeframe, Date> = {
      "1M": new Date(now.getTime() - 30 * 86400000),
      "3M": new Date(now.getTime() - 90 * 86400000),
      "6M": new Date(now.getTime() - 180 * 86400000),
      "1Y": new Date(now.getTime() - 365 * 86400000),
      "2Y": new Date(now.getTime() - 730 * 86400000),
      "ALL": new Date(0),
    };
    const cutoff = cutoffs[timeframe];
    return data.history.filter(r => new Date(r.date) >= cutoff);
  }, [data?.history, timeframe]);

  // Add SMAs to chart data
  const chartData = useMemo(() => {
    if (!data?.history) return [];
    const allCloses = data.history.map(r => r.close);
    return filteredHistory.map(r => {
      const idx = data.history.findIndex(h => h.date === r.date);
      const sma20 = idx >= 19 ? allCloses.slice(idx - 19, idx + 1).reduce((a, b) => a + b, 0) / 20 : null;
      const sma50 = idx >= 49 ? allCloses.slice(idx - 49, idx + 1).reduce((a, b) => a + b, 0) / 50 : null;
      const sma200 = idx >= 199 ? allCloses.slice(idx - 199, idx + 1).reduce((a, b) => a + b, 0) / 200 : null;
      return {
        date: typeof r.date === "string" ? r.date.slice(0, 10) : new Date(r.date).toISOString().slice(0, 10),
        close: r.close,
        high: r.high,
        low: r.low,
        open: r.open,
        volume: r.volume,
        sma20,
        sma50,
        sma200,
      };
    });
  }, [data?.history, filteredHistory]);

  // Sorted sensitivities
  const sortedSens = useMemo(() => {
    if (!data?.sensitivities) return [];
    const arr = [...data.sensitivities];
    arr.sort((a, b) => {
      const ak = sortCol === "beta" ? Math.abs(a.beta) : (a as unknown as Record<string, unknown>)[sortCol] as number ?? 0;
      const bk = sortCol === "beta" ? Math.abs(b.beta) : (b as unknown as Record<string, unknown>)[sortCol] as number ?? 0;
      return sortDir === "asc" ? ak - bk : bk - ak;
    });
    return arr;
  }, [data?.sensitivities, sortCol, sortDir]);

  const toggleSort = (col: string) => {
    if (sortCol === col) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortCol(col); setSortDir("desc"); }
  };

  const SECTOR_COLORS: Record<string, string> = {
    Energy: "#ef4444", Seafood: "#22c55e", Shipping: "#3b82f6", Materials: "#f59e0b",
  };

  if (loading) {
    return (
      <div style={{ fontFamily: "monospace", background: "#0a0a0a", minHeight: "100vh", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}>
        Loading {decodedSymbol}...
      </div>
    );
  }

  if (!data) {
    return (
      <div style={{ fontFamily: "monospace", background: "#0a0a0a", minHeight: "100vh", color: "#fff", padding: 40 }}>
        <Link href="/commodities" style={{ color: "#3b82f6" }}>← Back to Commodities</Link>
        <h1 style={{ marginTop: 20 }}>No data for {decodedSymbol}</h1>
      </div>
    );
  }

  return (
    <div style={{ fontFamily: "monospace", background: "#0a0a0a", minHeight: "100vh", color: "#fff" }}>
      {/* Header */}
      <div style={{ padding: "16px 24px", borderBottom: "1px solid #30363d", display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        <Link href="/commodities" style={{ color: "rgba(255,255,255,0.5)", textDecoration: "none", fontSize: 12 }}>
          ← Commodities
        </Link>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>
          {meta?.name || decodedSymbol}
        </h1>
        {meta && (
          <span style={{
            fontSize: 9, fontWeight: 600, padding: "2px 8px", borderRadius: 4,
            background: `${meta.category === "Energy" ? "#ef4444" : meta.category === "Metals" ? "#f59e0b" : meta.category === "Seafood" ? "#22c55e" : "#a855f7"}22`,
            color: meta.category === "Energy" ? "#ef4444" : meta.category === "Metals" ? "#f59e0b" : meta.category === "Seafood" ? "#22c55e" : "#a855f7",
          }}>
            {meta.category}
          </span>
        )}
      </div>

      <div style={{ padding: "20px 24px", maxWidth: 1400, margin: "0 auto" }}>
        {/* Hero Section */}
        <div style={{ background: "#161b22", border: "1px solid #30363d", borderRadius: 8, padding: 20, marginBottom: 20 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 16, flexWrap: "wrap" }}>
            <span style={{ fontSize: 36, fontWeight: 800 }}>{fmtPrice(data.latest.close)}</span>
            <span style={{ fontSize: 14, color: "rgba(255,255,255,0.5)" }}>{data.currency}{meta ? ` · ${meta.unit}` : ""}</span>
            <span style={{ fontSize: 18, fontWeight: 700, color: pctColor(data.latest.dayReturnPct) }}>
              {fmtPct(data.latest.dayReturnPct)}
            </span>
          </div>
          {/* Stats strip */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 8, marginTop: 16 }}>
            {[
              { label: "52W HIGH", val: fmtPrice(data.stats.high52w) },
              { label: "52W LOW", val: fmtPrice(data.stats.low52w) },
              { label: "SMA 20", val: fmtPrice(data.stats.sma20) },
              { label: "SMA 50", val: fmtPrice(data.stats.sma50) },
              { label: "SMA 200", val: fmtPrice(data.stats.sma200) },
              { label: "YTD", val: fmtPct(data.stats.ytdReturnPct), color: pctColor(data.stats.ytdReturnPct) },
            ].map(s => (
              <div key={s.label} style={{ background: "#0d1117", borderRadius: 4, padding: "8px 10px" }}>
                <div style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", letterSpacing: "0.05em", textTransform: "uppercase" }}>{s.label}</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: (s as { color?: string }).color || "#fff" }}>{s.val}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Price Chart */}
        <div style={{ background: "#161b22", border: "1px solid #30363d", borderRadius: 8, padding: 16, marginBottom: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.6)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
              PRICE HISTORY
            </div>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              {(["1M", "3M", "6M", "1Y", "2Y", "ALL"] as Timeframe[]).map(tf => (
                <button key={tf} onClick={() => setTimeframe(tf)} style={{
                  padding: "4px 10px", fontSize: 9, fontFamily: "monospace", fontWeight: 600,
                  background: timeframe === tf ? "#3b82f6" : "transparent",
                  border: `1px solid ${timeframe === tf ? "#3b82f6" : "#30363d"}`,
                  color: timeframe === tf ? "#fff" : "rgba(255,255,255,0.5)",
                  borderRadius: 4, cursor: "pointer",
                }}>
                  {tf}
                </button>
              ))}
              <button onClick={() => setShowSMA(!showSMA)} style={{
                padding: "4px 10px", fontSize: 9, fontFamily: "monospace", fontWeight: 600,
                background: showSMA ? "#3b82f6" : "transparent",
                border: `1px solid ${showSMA ? "#3b82f6" : "#30363d"}`,
                color: showSMA ? "#fff" : "rgba(255,255,255,0.5)",
                borderRadius: 4, cursor: "pointer", marginLeft: 8,
              }}>
                SMA
              </button>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={400}>
            <ComposedChart data={chartData} margin={{ top: 10, right: 20, bottom: 10, left: 20 }}>
              <CartesianGrid stroke="#30363d" strokeOpacity={0.3} strokeDasharray="3 3" />
              <XAxis dataKey="date" tick={{ fontSize: 9, fill: "rgba(255,255,255,0.4)" }}
                tickFormatter={(v: string) => v.slice(5)} interval="preserveStartEnd" />
              <YAxis domain={["auto", "auto"]} tick={{ fontSize: 9, fill: "rgba(255,255,255,0.5)" }}
                tickFormatter={(v: number) => fmtPrice(v)} />
              <Tooltip
                contentStyle={{ background: "#161b22", border: "1px solid #30363d", borderRadius: 4, fontFamily: "monospace", fontSize: 10 }}
                labelStyle={{ color: "#fff", fontWeight: 700 }}
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                formatter={((v: any, name: any) => [fmtPrice(v ?? 0), name]) as any}
              />
              <Area type="monotone" dataKey="close" stroke="#3b82f6" fill="rgba(59,130,246,0.08)" strokeWidth={1.5} dot={false} name="Close" />
              {showSMA && (
                <>
                  <Line type="monotone" dataKey="sma20" stroke="#60a5fa" strokeWidth={1} strokeDasharray="4 2" dot={false} name="SMA20" connectNulls />
                  <Line type="monotone" dataKey="sma50" stroke="#f59e0b" strokeWidth={1} strokeDasharray="4 2" dot={false} name="SMA50" connectNulls />
                  <Line type="monotone" dataKey="sma200" stroke="#ef4444" strokeWidth={1} strokeDasharray="6 3" dot={false} name="SMA200" connectNulls />
                </>
              )}
              <Bar dataKey="volume" yAxisId="volume" fill="rgba(255,255,255,0.06)" barSize={2} />
              <YAxis yAxisId="volume" orientation="right" hide domain={[0, "auto"]} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {/* Equity Sensitivity Table */}
        {sortedSens.length > 0 && (
          <div style={{ background: "#161b22", border: "1px solid #30363d", borderRadius: 8, padding: 16, marginBottom: 20 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.6)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 12 }}>
              EQUITY SENSITIVITY — {sortedSens.length} STOCKS
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid #30363d" }}>
                    {[
                      { key: "ticker", label: "Ticker", align: "left" as const },
                      { key: "stockName", label: "Company", align: "left" as const },
                      { key: "sector", label: "Sector", align: "left" as const },
                      { key: "beta", label: "Beta", align: "right" as const },
                      { key: "rSquared", label: "R²", align: "right" as const },
                      { key: "correlation60d", label: "Corr 60D", align: "right" as const },
                      { key: "correlation252d", label: "Corr 252D", align: "right" as const },
                    ].map(h => (
                      <th key={h.key} onClick={() => toggleSort(h.key)} style={{
                        padding: "8px 12px", textAlign: h.align, fontSize: 9, fontWeight: 600,
                        color: sortCol === h.key ? "#3b82f6" : "rgba(255,255,255,0.5)",
                        letterSpacing: "0.05em", textTransform: "uppercase", fontFamily: "monospace",
                        cursor: "pointer", userSelect: "none",
                      }}>
                        {h.label} {sortCol === h.key ? (sortDir === "asc" ? "↑" : "↓") : ""}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedSens.map(s => (
                    <tr key={s.ticker}
                      onClick={() => window.location.href = `/stocks/${s.ticker}`}
                      onMouseEnter={e => (e.currentTarget.style.background = "rgba(59,130,246,0.08)")}
                      onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                      role="button" tabIndex={0}
                      style={{ borderBottom: "1px solid #21262d", cursor: "pointer" }}>
                      <td style={{ padding: "8px 12px", fontSize: 11, fontWeight: 700 }}>
                        <Link href={`/stocks/${s.ticker}`} style={{ color: "#3b82f6", textDecoration: "none" }}>{s.ticker}</Link>
                      </td>
                      <td style={{ padding: "8px 12px", fontSize: 10, color: "rgba(255,255,255,0.6)" }}>{s.stockName}</td>
                      <td style={{ padding: "8px 12px", fontSize: 10 }}>
                        <span style={{
                          padding: "2px 6px", borderRadius: 3, fontSize: 9, fontWeight: 600,
                          background: `${SECTOR_COLORS[s.sector] || "#666"}22`,
                          color: SECTOR_COLORS[s.sector] || "#999",
                        }}>
                          {s.sector}
                        </span>
                      </td>
                      <td style={{
                        padding: "8px 12px", fontSize: 11, fontWeight: 700, textAlign: "right",
                        color: s.beta >= 0 ? "#10b981" : "#ef4444",
                      }}>
                        {s.beta.toFixed(3)}
                      </td>
                      <td style={{ padding: "8px 12px", fontSize: 10, textAlign: "right", color: "rgba(255,255,255,0.6)" }}>
                        {s.rSquared?.toFixed(3) || "—"}
                      </td>
                      <td style={{ padding: "8px 12px", fontSize: 10, textAlign: "right", color: "rgba(255,255,255,0.6)" }}>
                        {s.correlation60d?.toFixed(3) || "—"}
                      </td>
                      <td style={{ padding: "8px 12px", fontSize: 10, textAlign: "right", color: "rgba(255,255,255,0.6)" }}>
                        {s.correlation252d?.toFixed(3) || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Forward Curve (salmon only) */}
        {decodedSymbol === "SALMON" && <SalmonForwardCurve />}
      </div>
    </div>
  );
}

function SalmonForwardCurve() {
  const [forwardData, setForwardData] = useState<{ period: string; price: number; change: number | null }[]>([]);

  useEffect(() => {
    fetch("/api/seafood/forward-prices")
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d?.forwards) setForwardData(d.forwards);
      })
      .catch(() => {});
  }, []);

  if (forwardData.length === 0) return null;

  return (
    <div style={{ background: "#161b22", border: "1px solid #30363d", borderRadius: 8, padding: 16 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.6)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 12 }}>
        FISH POOL FORWARD CURVE (EUR/TONNE)
      </div>
      <ResponsiveContainer width="100%" height={300}>
        <ComposedChart data={forwardData} margin={{ top: 10, right: 20, bottom: 30, left: 20 }}>
          <CartesianGrid stroke="#30363d" strokeOpacity={0.3} strokeDasharray="3 3" />
          <XAxis dataKey="period" tick={{ fontSize: 9, fill: "rgba(255,255,255,0.5)" }} angle={-45} textAnchor="end" />
          <YAxis tick={{ fontSize: 9, fill: "rgba(255,255,255,0.5)" }}
            tickFormatter={(v: number) => `€${v.toLocaleString()}`} />
          <Tooltip
            contentStyle={{ background: "#161b22", border: "1px solid #30363d", borderRadius: 4, fontFamily: "monospace", fontSize: 10 }}
            formatter={((v: any) => [`€${(v ?? 0).toLocaleString()}`, "Forward Price"]) as any}
          />
          <Bar dataKey="price" fill="#3b82f6" fillOpacity={0.6} radius={[3, 3, 0, 0]} name="Forward Price" />
          <Line type="monotone" dataKey="price" stroke="#3b82f6" strokeWidth={2} dot={{ fill: "#3b82f6", r: 3 }} name="Curve" />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
