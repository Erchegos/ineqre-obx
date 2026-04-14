"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import PageNav from "@/components/ui/PageNav";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  ResponsiveContainer, Tooltip, Legend,
} from "recharts";

/* ─── Types ─────────────────────────────────────────── */

type SectorData = {
  name: string;
  color: string;
  tickers: string[];
  stockCount: number;
  commodityDriver: {
    symbol: string;
    name: string;
    price: number | null;
    dailyPct: number | null;
    sparkline30d: number[];
  } | null;
  performance: {
    daily: number | null;
    weekly: number | null;
    monthly: number | null;
    ytd: number | null;
  };
  bestPerformer: { ticker: string; name: string; dailyPct: number | null } | null;
  worstPerformer: { ticker: string; name: string; dailyPct: number | null } | null;
  avgBeta: number | null;
  topStocks: { ticker: string; name: string; dailyPct: number | null; weeklyPct?: number | null; monthlyPct?: number | null; ytdPct?: number | null; beta: number | null }[];
};

/* ─── Helpers ───────────────────────────────────────── */

const ALL_SECTORS = [
  "Energy", "Seafood", "Shipping", "Materials", "Financials",
  "Technology", "Industrials", "Consumer Staples", "Real Estate", "Health Care",
];
const DEFAULT_SECTORS = ["Energy", "Seafood", "Shipping", "Materials", "Technology"];

const SECTOR_COLORS: Record<string, string> = {
  Energy: "#ef4444", Seafood: "#22c55e", Shipping: "#3b82f6", Materials: "#f59e0b",
  Financials: "#6366f1", Technology: "#06b6d4", Industrials: "#8b5cf6",
  "Consumer Staples": "#14b8a6", "Real Estate": "#a78bfa", "Health Care": "#ec4899",
};

function fmtPct(v: number | null | undefined): string {
  if (v == null || isNaN(v)) return "—";
  return (v >= 0 ? "+" : "") + v.toFixed(2) + "%";
}
function pctColor(v: number | null | undefined): string {
  if (v == null) return "rgba(255,255,255,0.3)";
  return v >= 0 ? "#10b981" : "#ef4444";
}

function Sparkline({ data, color = "#3b82f6", width = 100, height = 30 }: {
  data: number[]; color?: string; width?: number; height?: number;
}) {
  if (!data || data.length < 2) return <span style={{ display: "inline-block", width, height }} />;
  const min = Math.min(...data), max = Math.max(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((v - min) / range) * height;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const id = `sp-${color.replace("#", "")}`;
  return (
    <svg width={width} height={height} style={{ display: "block" }}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.18} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <polygon points={`0,${height} ${pts.join(" ")} ${width},${height}`} fill={`url(#${id})`} />
      <polyline points={pts.join(" ")} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" />
    </svg>
  );
}

/* ─── Tab-like Sector Selector ──────────────────────── */

function SectorSelector({ selected, onChange }: { selected: string[]; onChange: (s: string[]) => void }) {
  const [open, setOpen] = useState(false);

  const toggle = (name: string) => {
    if (selected.includes(name)) {
      if (selected.length > 1) onChange(selected.filter(s => s !== name));
    } else {
      onChange([...selected, name]);
    }
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      {selected.map(name => (
        <button
          key={name}
          onClick={() => toggle(name)}
          style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            padding: "5px 10px", background: "#0d1117",
            border: "1px solid #30363d", borderLeft: `3px solid ${SECTOR_COLORS[name] || "#3b82f6"}`,
            borderRadius: 5, fontSize: 11, fontWeight: 600, fontFamily: "monospace",
            color: "#e6edf3", cursor: "pointer", transition: "all 0.15s",
          }}
        >
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: SECTOR_COLORS[name] || "#3b82f6" }} />
          {name}
          <span style={{ color: "rgba(255,255,255,0.25)", fontSize: 10, marginLeft: 2 }}>×</span>
        </button>
      ))}
      <div style={{ position: "relative" }}>
        <button
          onClick={() => setOpen(!open)}
          style={{
            padding: "5px 12px", background: open ? "#161b22" : "transparent",
            border: `1px solid ${open ? "#3b82f6" : "#30363d"}`,
            borderRadius: 5, fontSize: 10, fontWeight: 600, fontFamily: "monospace",
            color: "#3b82f6", cursor: "pointer", letterSpacing: "0.05em",
          }}
        >
          + ADD SECTOR
        </button>
        {open && (
          <div style={{
            position: "absolute", top: "100%", left: 0, marginTop: 4, zIndex: 20,
            background: "#161b22", border: "1px solid #3b82f6", borderRadius: 6,
            padding: 4, minWidth: 180, boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
          }}>
            {ALL_SECTORS.filter(s => !selected.includes(s)).map(name => (
              <button
                key={name}
                onClick={() => { toggle(name); setOpen(false); }}
                style={{
                  display: "flex", alignItems: "center", gap: 8, width: "100%",
                  padding: "8px 10px", background: "transparent", border: "none",
                  color: "#e6edf3", fontSize: 11, fontWeight: 600, fontFamily: "monospace",
                  cursor: "pointer", borderRadius: 4, textAlign: "left",
                }}
                onMouseEnter={e => { e.currentTarget.style.background = "rgba(59,130,246,0.08)"; }}
                onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
              >
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: SECTOR_COLORS[name] || "#3b82f6" }} />
                {name}
              </button>
            ))}
            {ALL_SECTORS.filter(s => !selected.includes(s)).length === 0 && (
              <div style={{ padding: "8px 10px", fontSize: 10, color: "rgba(255,255,255,0.3)" }}>All sectors selected</div>
            )}
          </div>
        )}
      </div>
      {selected.length !== DEFAULT_SECTORS.length || !DEFAULT_SECTORS.every(s => selected.includes(s)) ? (
        <button
          onClick={() => onChange([...DEFAULT_SECTORS])}
          style={{
            padding: "5px 10px", background: "transparent",
            border: "1px solid #21262d", borderRadius: 4,
            fontSize: 9, fontWeight: 600, fontFamily: "monospace",
            color: "rgba(255,255,255,0.35)", cursor: "pointer", letterSpacing: "0.05em",
          }}
        >
          RESET
        </button>
      ) : null}
    </div>
  );
}

/* ─── Main Page ─────────────────────────────────────── */

export default function SectorsPage() {
  const [allSectors, setAllSectors] = useState<SectorData[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedNames, setSelectedNames] = useState<string[]>([...DEFAULT_SECTORS]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [period, setPeriod] = useState<"1D" | "1W" | "1M" | "YTD">("1D");

  useEffect(() => {
    fetch("/api/sectors/overview")
      .then(r => r.json())
      .then(d => { setAllSectors(d.sectors || []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const sectors = useMemo(() =>
    selectedNames.map(name => allSectors.find(s => s.name === name)).filter((s): s is SectorData => !!s),
    [allSectors, selectedNames]
  );

  const perfVal = (s: SectorData) =>
    period === "1D" ? s.performance.daily :
    period === "1W" ? s.performance.weekly :
    period === "1M" ? s.performance.monthly : s.performance.ytd;

  const stockPerfVal = (st: SectorData["topStocks"][0]) =>
    period === "1D" ? st.dailyPct :
    period === "1W" ? st.weeklyPct :
    period === "1M" ? st.monthlyPct : st.ytdPct;

  // Chart data
  const perfData = ["1D", "1W", "1M", "YTD"].map(p => {
    const obj: Record<string, string | number> = { period: p };
    sectors.forEach(s => {
      const val = p === "1D" ? s.performance.daily : p === "1W" ? s.performance.weekly :
        p === "1M" ? s.performance.monthly : s.performance.ytd;
      obj[s.name] = val ?? 0;
    });
    return obj;
  });

  // Sorted for rotation strip
  const sorted = [...sectors].sort((a, b) => (perfVal(b) ?? 0) - (perfVal(a) ?? 0));

  return (
    <div style={{ minHeight: "100vh", background: "#0a0a0a", color: "#e6edf3", fontFamily: "monospace" }}>
      <div style={{ padding: "0 24px" }}>
        <PageNav crumbs={[{ label: "Home", href: "/" }, { label: "Sectors" }]} actions={[{ label: "Commodities", href: "/commodities" }, { label: "News", href: "/news" }]} />
      </div>

      <div style={{ padding: "0 24px 40px", maxWidth: 1400, margin: "0 auto" }}>

        {/* ═══ HEADER ═══ */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Sector Intelligence</h1>
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", marginTop: 3 }}>
              {sectors.length} sectors · {sectors.reduce((n, s) => n + s.stockCount, 0)} stocks
            </div>
          </div>
          {/* Period toggle */}
          <div style={{ display: "flex", background: "#0d1117", borderRadius: 5, border: "1px solid #21262d", padding: 2 }}>
            {(["1D", "1W", "1M", "YTD"] as const).map(p => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                style={{
                  padding: "5px 12px", fontSize: 10, fontWeight: 700, fontFamily: "monospace",
                  border: "none", borderRadius: 3, cursor: "pointer", letterSpacing: "0.05em",
                  background: period === p ? "#3b82f6" : "transparent",
                  color: period === p ? "#fff" : "rgba(255,255,255,0.4)",
                  transition: "all 0.15s",
                }}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        {/* ═══ SECTOR SELECTOR ═══ */}
        <div style={{ marginBottom: 20 }}>
          <SectorSelector selected={selectedNames} onChange={setSelectedNames} />
        </div>

        {loading ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12 }}>
            <style>{`@keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}`}</style>
            {[0,1,2,3,4].map(i => <div key={i} style={{ height: 100, borderRadius: 8, border: "1px solid #21262d", background: "linear-gradient(90deg, #21262d 25%, #30363d 50%, #21262d 75%)", backgroundSize: "200% 100%", animation: "shimmer 1.5s ease-in-out infinite" }} />)}
          </div>
        ) : (
          <>
            {/* ═══ KPI STRIP ═══ */}
            <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(sectors.length, 6)}, 1fr)`, gap: 8, marginBottom: 20 }}>
              {sorted.map(s => {
                const val = perfVal(s);
                return (
                  <div key={s.name} style={{
                    background: "#161b22", border: "1px solid #30363d", borderRadius: 8,
                    padding: "14px 16px", textAlign: "center",
                    borderTop: `2px solid ${s.color}`,
                  }}>
                    <div style={{ fontSize: 10, fontWeight: 600, color: s.color, letterSpacing: "0.06em", marginBottom: 6 }}>{s.name}</div>
                    <div style={{ fontSize: 20, fontWeight: 800, color: pctColor(val), fontFamily: "monospace" }}>{fmtPct(val)}</div>
                    <div style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", marginTop: 4 }}>
                      {s.stockCount} stocks{s.avgBeta != null ? ` · β ${s.avgBeta.toFixed(2)}` : ""}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* ═══ PERFORMANCE CHART ═══ */}
            <div style={{ background: "#161b22", border: "1px solid #30363d", borderRadius: 8, padding: 16, marginBottom: 20 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.6)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 12 }}>
                Multi-Period Performance
              </div>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={perfData} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
                  <CartesianGrid stroke="#21262d" strokeDasharray="3 3" />
                  <XAxis dataKey="period" tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 10, fontFamily: "monospace" }} />
                  <YAxis tickFormatter={v => v.toFixed(1) + "%"} tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 10, fontFamily: "monospace" }} />
                  <Tooltip
                    contentStyle={{ background: "#0d1117", border: "1px solid #30363d", borderRadius: 6, fontSize: 11, fontFamily: "monospace" }}
                    formatter={(v: unknown) => [fmtPct(v as number), ""]}
                  />
                  <Legend wrapperStyle={{ fontSize: 10, fontFamily: "monospace" }} />
                  {sectors.map(s => (
                    <Bar key={s.name} dataKey={s.name} fill={s.color} radius={[3, 3, 0, 0]} opacity={0.85} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* ═══ SECTOR TABLE ═══ */}
            <div style={{ background: "#161b22", border: "1px solid #30363d", borderRadius: 8, overflow: "hidden", marginBottom: 20 }}>
              <div style={{ padding: "12px 16px", borderBottom: "1px solid #21262d" }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.6)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
                  Sector Overview
                </span>
              </div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      {["Sector", "Stocks", "1D", "1W", "1M", "YTD", "β Avg", "Best", "Worst", "Driver"].map(h => (
                        <th key={h} style={{
                          padding: "8px 12px", fontSize: 9, fontWeight: 600,
                          color: "rgba(255,255,255,0.5)", letterSpacing: "0.05em",
                          textTransform: "uppercase", textAlign: h === "Sector" || h === "Best" || h === "Worst" || h === "Driver" ? "left" : "right",
                          borderBottom: "1px solid #30363d", whiteSpace: "nowrap",
                        }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map(s => (
                      <tr
                        key={s.name}
                        style={{ cursor: "pointer", transition: "background 0.12s" }}
                        onClick={() => setExpanded(expanded === s.name ? null : s.name)}
                        onMouseEnter={e => { e.currentTarget.style.background = "rgba(59,130,246,0.04)"; }}
                        onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
                      >
                        <td style={{ padding: "10px 12px", borderBottom: "1px solid #21262d" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ width: 8, height: 8, borderRadius: "50%", background: s.color, flexShrink: 0 }} />
                            <span style={{ fontSize: 12, fontWeight: 700, color: "#e6edf3" }}>{s.name}</span>
                          </div>
                        </td>
                        <td style={{ padding: "10px 12px", textAlign: "right", borderBottom: "1px solid #21262d", fontSize: 11, color: "rgba(255,255,255,0.5)" }}>{s.stockCount}</td>
                        {([s.performance.daily, s.performance.weekly, s.performance.monthly, s.performance.ytd] as (number | null)[]).map((v, i) => (
                          <td key={i} style={{ padding: "10px 12px", textAlign: "right", borderBottom: "1px solid #21262d", fontSize: 12, fontWeight: 700, color: pctColor(v) }}>
                            {fmtPct(v)}
                          </td>
                        ))}
                        <td style={{ padding: "10px 12px", textAlign: "right", borderBottom: "1px solid #21262d", fontSize: 11, color: "rgba(255,255,255,0.5)" }}>
                          {s.avgBeta != null ? s.avgBeta.toFixed(2) : "—"}
                        </td>
                        <td style={{ padding: "10px 12px", borderBottom: "1px solid #21262d" }}>
                          {s.bestPerformer && (
                            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                              <span style={{ fontSize: 11, fontWeight: 700, color: "#10b981" }}>{s.bestPerformer.ticker}</span>
                              <span style={{ fontSize: 10, color: "#10b981" }}>{fmtPct(s.bestPerformer.dailyPct)}</span>
                            </div>
                          )}
                        </td>
                        <td style={{ padding: "10px 12px", borderBottom: "1px solid #21262d" }}>
                          {s.worstPerformer && (
                            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                              <span style={{ fontSize: 11, fontWeight: 700, color: "#ef4444" }}>{s.worstPerformer.ticker}</span>
                              <span style={{ fontSize: 10, color: "#ef4444" }}>{fmtPct(s.worstPerformer.dailyPct)}</span>
                            </div>
                          )}
                        </td>
                        <td style={{ padding: "10px 12px", borderBottom: "1px solid #21262d" }}>
                          {s.commodityDriver && (
                            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                              <span style={{ fontSize: 10, color: "rgba(255,255,255,0.5)" }}>{s.commodityDriver.name}</span>
                              <span style={{ fontSize: 10, fontWeight: 700, color: pctColor(s.commodityDriver.dailyPct) }}>{fmtPct(s.commodityDriver.dailyPct)}</span>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* ═══ EXPANDED SECTOR DETAIL ═══ */}
            {expanded && (() => {
              const s = sectors.find(sec => sec.name === expanded);
              if (!s) return null;
              const stocksSorted = [...s.topStocks].sort((a, b) => (stockPerfVal(b) ?? 0) - (stockPerfVal(a) ?? 0));
              return (
                <div style={{ background: "#161b22", border: "1px solid #30363d", borderTop: `2px solid ${s.color}`, borderRadius: 8, marginBottom: 20 }}>
                  {/* Detail header */}
                  <div style={{ padding: "14px 16px", borderBottom: "1px solid #21262d", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ width: 10, height: 10, borderRadius: "50%", background: s.color }} />
                      <span style={{ fontSize: 16, fontWeight: 700, color: "#fff" }}>{s.name}</span>
                      <span style={{ fontSize: 10, color: "rgba(255,255,255,0.35)" }}>{s.stockCount} stocks</span>
                    </div>
                    <button onClick={() => setExpanded(null)} style={{
                      background: "transparent", border: "1px solid #21262d", borderRadius: 4,
                      padding: "4px 10px", fontSize: 9, fontWeight: 600, fontFamily: "monospace",
                      color: "rgba(255,255,255,0.4)", cursor: "pointer",
                    }}>
                      CLOSE
                    </button>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: s.commodityDriver?.sparkline30d?.length ? "1fr 220px" : "1fr", gap: 16, padding: 16 }}>
                    {/* Stock table */}
                    <div style={{ overflowX: "auto" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse" }}>
                        <thead>
                          <tr>
                            {["Ticker", "Name", period, "β"].map(h => (
                              <th key={h} style={{
                                padding: "6px 10px", fontSize: 9, fontWeight: 600,
                                color: "rgba(255,255,255,0.5)", letterSpacing: "0.05em",
                                textTransform: "uppercase", textAlign: h === "Ticker" || h === "Name" ? "left" : "right",
                                borderBottom: "1px solid #30363d",
                              }}>
                                {h}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {stocksSorted.map(st => {
                            const val = stockPerfVal(st);
                            return (
                              <tr key={st.ticker}>
                                <td style={{ padding: "8px 10px", borderBottom: "1px solid #21262d" }}>
                                  <Link href={`/stocks/${st.ticker}`} style={{ color: "#3b82f6", fontWeight: 700, fontSize: 12, textDecoration: "none" }}>
                                    {st.ticker}
                                  </Link>
                                </td>
                                <td style={{ padding: "8px 10px", borderBottom: "1px solid #21262d", fontSize: 11, color: "rgba(255,255,255,0.5)", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                  {st.name}
                                </td>
                                <td style={{ padding: "8px 10px", textAlign: "right", borderBottom: "1px solid #21262d", fontSize: 12, fontWeight: 700, color: pctColor(val) }}>
                                  {fmtPct(val)}
                                </td>
                                <td style={{ padding: "8px 10px", textAlign: "right", borderBottom: "1px solid #21262d", fontSize: 11, color: "rgba(255,255,255,0.5)" }}>
                                  {st.beta != null ? st.beta.toFixed(2) : "—"}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    {/* Commodity driver sparkline */}
                    {s.commodityDriver?.sparkline30d && s.commodityDriver.sparkline30d.length > 2 && (
                      <div style={{ padding: "8px 0" }}>
                        <div style={{ fontSize: 9, fontWeight: 600, color: "rgba(255,255,255,0.4)", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 8 }}>
                          {s.commodityDriver.name} — 30D
                        </div>
                        <Sparkline data={s.commodityDriver.sparkline30d} color={s.color} width={200} height={80} />
                        <div style={{ marginTop: 6, display: "flex", alignItems: "baseline", gap: 8 }}>
                          {s.commodityDriver.price != null && (
                            <span style={{ fontSize: 14, fontWeight: 700, color: "#fff" }}>
                              {s.commodityDriver.price.toLocaleString("en-US", { maximumFractionDigits: 2 })}
                            </span>
                          )}
                          <span style={{ fontSize: 12, fontWeight: 700, color: pctColor(s.commodityDriver.dailyPct) }}>
                            {fmtPct(s.commodityDriver.dailyPct)}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}

            {/* ═══ HEATMAP ═══ */}
            <div style={{ background: "#161b22", border: "1px solid #30363d", borderRadius: 8, overflow: "hidden" }}>
              <div style={{ padding: "12px 16px", borderBottom: "1px solid #21262d" }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.6)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
                  Stock Heatmap — {period}
                </span>
              </div>
              <div style={{ padding: 16, display: "flex", flexWrap: "wrap", gap: 4 }}>
                {sectors.flatMap(s =>
                  s.topStocks.map(st => {
                    const val = stockPerfVal(st);
                    const abs = Math.abs(val ?? 0);
                    const intensity = Math.min(abs / 5, 1);
                    const bg = val == null ? "rgba(255,255,255,0.02)"
                      : val >= 0 ? `rgba(16,185,129,${0.06 + intensity * 0.25})`
                      : `rgba(239,68,68,${0.06 + intensity * 0.25})`;
                    return (
                      <Link key={`${s.name}-${st.ticker}`} href={`/stocks/${st.ticker}`} style={{ textDecoration: "none" }}>
                        <div style={{
                          background: bg, borderRadius: 4, padding: "8px 12px",
                          minWidth: 80, textAlign: "center", transition: "all 0.15s",
                          border: `1px solid ${val == null ? "#21262d" : val >= 0 ? "rgba(16,185,129,0.15)" : "rgba(239,68,68,0.15)"}`,
                        }}
                          onMouseEnter={e => { e.currentTarget.style.borderColor = "#3b82f6"; }}
                          onMouseLeave={e => { e.currentTarget.style.borderColor = val == null ? "#21262d" : val != null && val >= 0 ? "rgba(16,185,129,0.15)" : "rgba(239,68,68,0.15)"; }}
                        >
                          <div style={{ fontSize: 11, fontWeight: 700, color: "#e6edf3" }}>{st.ticker}</div>
                          <div style={{ fontSize: 11, fontWeight: 700, color: pctColor(val), marginTop: 2 }}>{fmtPct(val)}</div>
                        </div>
                      </Link>
                    );
                  })
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
