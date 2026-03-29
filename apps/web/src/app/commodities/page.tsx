"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import Link from "next/link";
import PageNav from "@/components/ui/PageNav";
import {
  Treemap, ScatterChart, Scatter, XAxis, YAxis, CartesianGrid,
  ResponsiveContainer, Cell, Tooltip, RadarChart, Radar,
  PolarGrid, PolarAngleAxis, PolarRadiusAxis, Legend,
  BarChart, Bar,
} from "recharts";

/* ─── Types ────────────────────────────────────────────── */
type Commodity = {
  symbol: string;
  name: string;
  currency: string;
  category: string;
  importance: number;
  unit: string;
  latest: { date: string; close: number };
  dayReturnPct: number | null;
  weeklyPct: number | null;
  monthlyPct: number | null;
  ytdPct: number | null;
  yoyPct: number | null;
  high52w: number | null;
  low52w: number | null;
  sparkline30d: number[];
  last5Days: { date: string; close: number; dayPct: number | null }[];
};

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
  topStocks: { ticker: string; name: string; dailyPct: number | null; beta: number | null }[];
};

type CorrData = {
  tickers: string[];
  labels: string[];
  matrix: number[][];
  period: number;
};

/* ─── Helpers ───────────────────────────────────────────── */
function fmt(v: number | null, dec = 2): string {
  if (v === null || isNaN(v)) return "—";
  return v.toFixed(dec);
}
function fmtPct(v: number | null): string {
  if (v === null || isNaN(v)) return "—";
  return (v >= 0 ? "+" : "") + v.toFixed(2) + "%";
}
function pctColor(v: number | null): string {
  if (v === null) return "rgba(255,255,255,0.5)";
  return v >= 0 ? "#22c55e" : "#ef4444";
}
function heatColor(pct: number | null): string {
  if (pct === null) return "#1a1f2e";
  const clamped = Math.max(-5, Math.min(5, pct));
  if (clamped > 0) {
    const t = clamped / 5;
    const g = Math.round(55 + t * 144);
    const b = Math.round(30 * (1 - t));
    return `rgb(${Math.round(10 + 20 * (1-t))},${g},${b})`;
  } else {
    const t = Math.abs(clamped) / 5;
    const r = Math.round(55 + t * 190);
    return `rgb(${r},${Math.round(20*(1-t))},${Math.round(20*(1-t))})`;
  }
}
function corrColor(v: number): string {
  if (isNaN(v)) return "#161b22";
  const clamped = Math.max(-1, Math.min(1, v));
  if (clamped >= 0) {
    const t = clamped;
    return `rgb(${Math.round(22 - 22 * t)},${Math.round(197 * t)},${Math.round(127 * t)})`;
  } else {
    const t = Math.abs(clamped);
    return `rgb(${Math.round(239 * t)},${Math.round(68 * (1 - t))},${Math.round(68 * (1 - t))})`;
  }
}

/* ─── Mini Sparkline ───────────────────────────────────── */
function Sparkline({ data, color = "#3b82f6", width = 80, height = 28 }: {
  data: number[]; color?: string; width?: number; height?: number;
}) {
  if (!data || data.length < 2) return <span style={{ display: "inline-block", width, height }} />;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((v - min) / range) * height;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return (
    <svg width={width} height={height} style={{ display: "block" }}>
      <polyline points={pts.join(" ")} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" />
    </svg>
  );
}

/* ─── Ticker Badge ─────────────────────────────────────── */
function TickerBadge({ c }: { c: Commodity }) {
  const isUp = (c.dayReturnPct ?? 0) >= 0;
  const bigMove = Math.abs(c.dayReturnPct ?? 0) >= 3;
  return (
    <Link href={`/commodities/${encodeURIComponent(c.symbol)}`} style={{ textDecoration: "none" }}>
      <div style={{
        display: "inline-flex", alignItems: "center", gap: 10,
        background: "#161b22", border: `1px solid ${bigMove ? (isUp ? "#22c55e55" : "#ef444455") : "#30363d"}`,
        borderRadius: 8, padding: "7px 12px", cursor: "pointer",
        boxShadow: bigMove ? `0 0 12px ${isUp ? "rgba(34,197,94,0.2)" : "rgba(239,68,68,0.2)"}` : "none",
        animation: bigMove ? "pulse-badge 2s infinite" : "none",
        transition: "all 0.2s",
      }}>
        <div>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", fontFamily: "monospace" }}>{c.symbol}</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#e6edf3", fontFamily: "monospace" }}>
            {c.latest?.close ? c.latest.close.toLocaleString("en-US", { maximumFractionDigits: 2 }) : "—"}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: pctColor(c.dayReturnPct), fontFamily: "monospace" }}>
            {fmtPct(c.dayReturnPct)}
          </div>
          <Sparkline data={c.sparkline30d} color={isUp ? "#22c55e" : "#ef4444"} width={60} height={20} />
        </div>
      </div>
    </Link>
  );
}

/* ─── Custom Treemap Cell ──────────────────────────────── */
function TreemapCell(props: {
  x?: number; y?: number; width?: number; height?: number;
  name?: string; symbol?: string; value?: number;
  dayReturnPct?: number | null; price?: number | null;
}) {
  const { x = 0, y = 0, width = 0, height = 0, name, symbol, dayReturnPct, price } = props;
  const bg = heatColor(dayReturnPct ?? null);
  const small = width < 80 || height < 50;
  const tiny = width < 50 || height < 35;
  return (
    <Link href={`/commodities/${encodeURIComponent(symbol || "")}`} style={{ textDecoration: "none" }}>
      <g>
        <rect x={x + 1} y={y + 1} width={width - 2} height={height - 2} fill={bg} rx={4} style={{ cursor: "pointer" }} />
        {!tiny && (
          <>
            <text x={x + 8} y={y + (small ? height / 2 - 5 : 22)} fill="#fff" fontSize={small ? 10 : 12} fontWeight={700} fontFamily="monospace">
              {name || symbol}
            </text>
            {!small && price !== null && (
              <text x={x + 8} y={y + 40} fill="rgba(255,255,255,0.7)" fontSize={10} fontFamily="monospace">
                {price?.toLocaleString("en-US", { maximumFractionDigits: 2 })}
              </text>
            )}
            <text x={x + 8} y={y + (small ? height / 2 + 8 : height - 10)} fill={pctColor(dayReturnPct ?? null)} fontSize={small ? 11 : 13} fontWeight={700} fontFamily="monospace">
              {fmtPct(dayReturnPct ?? null)}
            </text>
          </>
        )}
      </g>
    </Link>
  );
}

/* ─── Heat Pulse (5-day grid) ──────────────────────────── */
function HeatPulse({ commodities }: { commodities: Commodity[] }) {
  const [hovered, setHovered] = useState<{ sym: string; day: number; date: string; pct: number | null } | null>(null);
  const maxDays = Math.max(...commodities.map((c) => c.last5Days?.length || 0));
  const days = maxDays || 5;

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ borderCollapse: "collapse", width: "100%" }}>
        <thead>
          <tr>
            <th style={{ width: 80, textAlign: "left", fontSize: 9, color: "rgba(255,255,255,0.4)", fontFamily: "monospace", paddingBottom: 4 }}>
              COMMODITY
            </th>
            {Array.from({ length: days }).map((_, i) => {
              const dates = commodities.flatMap((c) => c.last5Days?.map((d) => d.date) || []);
              const uniqueDates = [...new Set(dates)].sort();
              const d = uniqueDates[i];
              const label = d ? new Date(d).toLocaleDateString("en-US", { weekday: "short", month: "numeric", day: "numeric" }) : `D${i + 1}`;
              return (
                <th key={i} style={{ textAlign: "center", fontSize: 9, color: "rgba(255,255,255,0.4)", fontFamily: "monospace", paddingBottom: 4, width: `${80 / days}%` }}>
                  {label}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {commodities.filter((c) => c.last5Days?.length).map((c) => (
            <tr key={c.symbol}>
              <td style={{ fontSize: 10, color: "rgba(255,255,255,0.6)", fontFamily: "monospace", paddingRight: 8, paddingBottom: 3 }}>
                <Link href={`/commodities/${encodeURIComponent(c.symbol)}`} style={{ color: "inherit", textDecoration: "none" }}>
                  {c.name}
                </Link>
              </td>
              {c.last5Days.map((day, i) => {
                const isHov = hovered?.sym === c.symbol && hovered?.day === i;
                return (
                  <td key={i}
                    onMouseEnter={() => setHovered({ sym: c.symbol, day: i, date: day.date, pct: day.dayPct })}
                    onMouseLeave={() => setHovered(null)}
                    style={{
                      height: 28, width: 36, background: heatColor(day.dayPct),
                      border: isHov ? "1.5px solid rgba(255,255,255,0.6)" : "1px solid #0a0a0a",
                      borderRadius: 3, cursor: "default", position: "relative", textAlign: "center",
                    }}>
                    {isHov && (
                      <div style={{
                        position: "absolute", bottom: "110%", left: "50%", transform: "translateX(-50%)",
                        background: "#0d1117", border: "1px solid #30363d", borderRadius: 6, padding: "4px 8px",
                        fontSize: 10, color: "#e6edf3", whiteSpace: "nowrap", zIndex: 10, fontFamily: "monospace",
                      }}>
                        {new Date(day.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })} · {fmtPct(day.dayPct)}
                      </div>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ─── Sector Card ──────────────────────────────────────── */
function SectorCard({ s }: { s: SectorData }) {
  return (
    <div style={{
      background: "#161b22", border: `1px solid #30363d`,
      borderLeft: `4px solid ${s.color}`,
      borderRadius: 8, padding: 16, cursor: "pointer",
      transition: "all 0.2s",
    }}
      className="sector-card"
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#e6edf3", fontFamily: "monospace" }}>{s.name}</div>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginTop: 2 }}>{s.stockCount} stocks</div>
        </div>
        {s.commodityDriver && (
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", fontFamily: "monospace" }}>{s.commodityDriver.name}</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: pctColor(s.commodityDriver.dailyPct), fontFamily: "monospace" }}>
              {fmtPct(s.commodityDriver.dailyPct)}
            </div>
          </div>
        )}
      </div>

      {s.commodityDriver?.sparkline30d && (
        <div style={{ marginBottom: 10 }}>
          <Sparkline
            data={s.commodityDriver.sparkline30d}
            color={s.color}
            width={220} height={32}
          />
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 6, marginBottom: 10 }}>
        {[
          { label: "1D", val: s.performance.daily },
          { label: "1W", val: s.performance.weekly },
          { label: "1M", val: s.performance.monthly },
          { label: "YTD", val: s.performance.ytd },
        ].map(({ label, val }) => (
          <div key={label} style={{ background: "#0d1117", borderRadius: 4, padding: "4px 6px", textAlign: "center" }}>
            <div style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", marginBottom: 2 }}>{label}</div>
            <div style={{ fontSize: 11, fontWeight: 700, color: pctColor(val), fontFamily: "monospace" }}>{fmtPct(val)}</div>
          </div>
        ))}
      </div>

      {(s.bestPerformer || s.worstPerformer) && (
        <div style={{ display: "flex", gap: 8 }}>
          {s.bestPerformer && (
            <div style={{ flex: 1, background: "rgba(34,197,94,0.06)", border: "1px solid rgba(34,197,94,0.2)", borderRadius: 4, padding: "4px 8px" }}>
              <div style={{ fontSize: 9, color: "rgba(255,255,255,0.4)" }}>BEST</div>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#22c55e", fontFamily: "monospace" }}>{s.bestPerformer.ticker} {fmtPct(s.bestPerformer.dailyPct)}</div>
            </div>
          )}
          {s.worstPerformer && (
            <div style={{ flex: 1, background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 4, padding: "4px 8px" }}>
              <div style={{ fontSize: 9, color: "rgba(255,255,255,0.4)" }}>WORST</div>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#ef4444", fontFamily: "monospace" }}>{s.worstPerformer.ticker} {fmtPct(s.worstPerformer.dailyPct)}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── Flow Diagram ─────────────────────────────────────── */
function FlowDiagram({ commodities }: { commodities: Commodity[] }) {
  const [hovered, setHovered] = useState<string | null>(null);
  const commNodes = [
    { sym: "BZ=F", label: "Brent", color: "#ef4444" },
    { sym: "CL=F", label: "WTI", color: "#f97316" },
    { sym: "NG=F", label: "Gas", color: "#f59e0b" },
    { sym: "ALI=F", label: "Aluminium", color: "#a855f7" },
    { sym: "GC=F", label: "Gold", color: "#eab308" },
    { sym: "SALMON", label: "Salmon", color: "#22c55e" },
  ];
  const stockNodes = [
    { ticker: "EQNR", comm: "BZ=F", color: "#ef4444" },
    { ticker: "DNO", comm: "BZ=F", color: "#ef4444" },
    { ticker: "MOWI", comm: "SALMON", color: "#22c55e" },
    { ticker: "SALM", comm: "SALMON", color: "#22c55e" },
    { ticker: "NHY", comm: "ALI=F", color: "#a855f7" },
    { ticker: "FRO", comm: "BZ=F", color: "#ef4444" },
    { ticker: "AKRBP", comm: "BZ=F", color: "#ef4444" },
    { ticker: "LSG", comm: "SALMON", color: "#22c55e" },
  ];

  const W = 560, H = 220;
  const lx = 60, rx = W - 60;
  const getCommY = (i: number) => 20 + (i * (H - 40)) / (commNodes.length - 1);
  const getStockY = (i: number) => 20 + (i * (H - 40)) / (stockNodes.length - 1);

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ overflow: "visible" }}>
      {stockNodes.map((s, j) => {
        const commIdx = commNodes.findIndex((c) => c.sym === s.comm);
        if (commIdx < 0) return null;
        const x1 = lx + 20, y1 = getCommY(commIdx);
        const x2 = rx - 20, y2 = getStockY(j);
        const mx = (x1 + x2) / 2;
        const isHighlighted = hovered === s.comm || hovered === s.ticker;
        const path = `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`;
        return (
          <path key={s.ticker} d={path} fill="none"
            stroke={s.color} strokeWidth={isHighlighted ? 2 : 1}
            opacity={hovered ? (isHighlighted ? 0.9 : 0.1) : 0.3}
            style={{ transition: "opacity 0.2s, stroke-width 0.2s" }}
          />
        );
      })}
      {commNodes.map((c, i) => {
        const y = getCommY(i);
        const commData = commodities.find((cd) => cd.symbol === c.sym);
        return (
          <g key={c.sym} onMouseEnter={() => setHovered(c.sym)} onMouseLeave={() => setHovered(null)} style={{ cursor: "pointer" }}>
            <circle cx={lx} cy={y} r={20} fill={hovered === c.sym ? c.color : "#161b22"} stroke={c.color} strokeWidth={hovered === c.sym ? 2 : 1.5} />
            <text x={lx} y={y + 4} textAnchor="middle" fill="#fff" fontSize={9} fontFamily="monospace" fontWeight={700}>{c.label}</text>
            {commData && (
              <text x={lx - 26} y={y + 4} textAnchor="end" fill={pctColor(commData.dayReturnPct)} fontSize={9} fontFamily="monospace">
                {fmtPct(commData.dayReturnPct)}
              </text>
            )}
          </g>
        );
      })}
      {stockNodes.map((s, j) => {
        const y = getStockY(j);
        return (
          <g key={s.ticker} onMouseEnter={() => setHovered(s.ticker)} onMouseLeave={() => setHovered(null)} style={{ cursor: "pointer" }}>
            <circle cx={rx} cy={y} r={18} fill={hovered === s.ticker ? s.color : "#161b22"} stroke={s.color} strokeWidth={hovered === s.ticker ? 2 : 1.5} />
            <text x={rx} y={y + 4} textAnchor="middle" fill="#fff" fontSize={9} fontFamily="monospace" fontWeight={700}>{s.ticker}</text>
          </g>
        );
      })}
      <text x={lx} y={H - 4} textAnchor="middle" fill="rgba(255,255,255,0.3)" fontSize={9} fontFamily="monospace">COMMODITIES</text>
      <text x={rx} y={H - 4} textAnchor="middle" fill="rgba(255,255,255,0.3)" fontSize={9} fontFamily="monospace">EQUITIES</text>
    </svg>
  );
}

/* ─── Correlation Matrix ───────────────────────────────── */
function CorrMatrix({ data }: { data: CorrData | null }) {
  if (!data) return <div style={{ color: "rgba(255,255,255,0.3)", fontFamily: "monospace", fontSize: 11 }}>Loading…</div>;
  const n = data.tickers.length;
  const cellSize = Math.min(52, Math.floor(560 / (n + 1)));
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={{ width: cellSize }} />
            {data.labels.map((l) => (
              <th key={l} style={{ width: cellSize, fontSize: 8, color: "rgba(255,255,255,0.5)", fontFamily: "monospace", textAlign: "center", padding: "0 2px 4px" }}>
                {l}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.matrix.map((row, i) => (
            <tr key={i}>
              <td style={{ fontSize: 8, color: "rgba(255,255,255,0.5)", fontFamily: "monospace", textAlign: "right", paddingRight: 4 }}>
                {data.labels[i]}
              </td>
              {row.map((v, j) => (
                <td key={j} style={{
                  width: cellSize, height: cellSize,
                  background: i === j ? "#30363d" : corrColor(v),
                  border: "1px solid #0a0a0a", borderRadius: 2, textAlign: "center",
                  fontSize: 8, color: "#fff", fontFamily: "monospace", fontWeight: 600,
                }}>
                  {i === j ? "—" : isNaN(v) ? "" : v.toFixed(2)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ─── Quotes Table ─────────────────────────────────────── */
type SortKey = "name" | "dayReturnPct" | "weeklyPct" | "monthlyPct" | "ytdPct" | "yoyPct";

function QuotesTable({ commodities }: { commodities: Commodity[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("dayReturnPct");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const sorted = [...commodities].sort((a, b) => {
    const av = a[sortKey] ?? -9999;
    const bv = b[sortKey] ?? -9999;
    const av2 = typeof av === "string" ? av : (av as number);
    const bv2 = typeof bv === "string" ? bv : (bv as number);
    return sortDir === "desc" ? (bv2 as number) - (av2 as number) : (av2 as number) - (bv2 as number);
  });

  const toggle = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => d === "desc" ? "asc" : "desc");
    else { setSortKey(key); setSortDir("desc"); }
  };

  const Th = ({ k, label }: { k: SortKey; label: string }) => (
    <th onClick={() => toggle(k)} style={{
      padding: "8px 12px", fontSize: 9, color: sortKey === k ? "#3b82f6" : "rgba(255,255,255,0.5)",
      textAlign: "right", cursor: "pointer", fontFamily: "monospace", letterSpacing: "0.05em",
      textTransform: "uppercase", userSelect: "none", borderBottom: "1px solid #30363d",
    }}>
      {label} {sortKey === k ? (sortDir === "desc" ? "↓" : "↑") : ""}
    </th>
  );

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ borderBottom: "1px solid #30363d" }}>
            <th style={{ padding: "8px 12px", fontSize: 9, color: "rgba(255,255,255,0.5)", textAlign: "left", fontFamily: "monospace", letterSpacing: "0.05em", textTransform: "uppercase" }}>Name</th>
            <th style={{ padding: "8px 12px", fontSize: 9, color: "rgba(255,255,255,0.5)", textAlign: "right", fontFamily: "monospace", letterSpacing: "0.05em", textTransform: "uppercase" }}>Price</th>
            <Th k="dayReturnPct" label="1D %" />
            <Th k="weeklyPct" label="1W %" />
            <Th k="monthlyPct" label="1M %" />
            <Th k="ytdPct" label="YTD %" />
            <Th k="yoyPct" label="YoY %" />
            <th style={{ padding: "8px 12px", fontSize: 9, color: "rgba(255,255,255,0.5)", textAlign: "right", fontFamily: "monospace", borderBottom: "1px solid #30363d" }}>30D Chart</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((c) => (
            <tr key={c.symbol} style={{ borderBottom: "1px solid #21262d", cursor: "pointer" }}
              className="quote-row"
              onClick={() => window.location.href = `/commodities/${encodeURIComponent(c.symbol)}`}
            >
              <td style={{ padding: "8px 12px" }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#e6edf3", fontFamily: "monospace" }}>{c.name}</div>
                <div style={{ fontSize: 9, color: "rgba(255,255,255,0.4)" }}>{c.symbol} · {c.unit}</div>
              </td>
              <td style={{ padding: "8px 12px", textAlign: "right", fontSize: 12, fontWeight: 600, color: "#e6edf3", fontFamily: "monospace" }}>
                {c.latest?.close?.toLocaleString("en-US", { maximumFractionDigits: 2 })}
              </td>
              {([c.dayReturnPct, c.weeklyPct, c.monthlyPct, c.ytdPct, c.yoyPct] as (number | null)[]).map((v, i) => (
                <td key={i} style={{ padding: "8px 12px", textAlign: "right", fontFamily: "monospace", fontSize: 12, fontWeight: 600, color: pctColor(v) }}>
                  {fmtPct(v)}
                </td>
              ))}
              <td style={{ padding: "8px 12px", textAlign: "right" }}>
                <Sparkline data={c.sparkline30d} color={(c.dayReturnPct ?? 0) >= 0 ? "#22c55e" : "#ef4444"} width={100} height={24} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ─── Scatter Chart Tab ────────────────────────────────── */
function ScatterTab({ commodities }: { commodities: Commodity[] }) {
  const [xKey, setXKey] = useState<"ytdPct" | "monthlyPct" | "yoyPct">("ytdPct");
  const [yKey, setYKey] = useState<"monthlyPct" | "weeklyPct" | "dayReturnPct">("monthlyPct");

  const CAT_COLORS: Record<string, string> = {
    Energy: "#ef4444", Metals: "#f59e0b", Seafood: "#22c55e",
    Agriculture: "#84cc16", Materials: "#a855f7",
  };

  const data = commodities.map((c) => ({
    name: c.name,
    symbol: c.symbol,
    x: c[xKey] ?? 0,
    y: c[yKey] ?? 0,
    z: c.importance,
    color: CAT_COLORS[c.category] || "#3b82f6",
  }));

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <span style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", fontFamily: "monospace" }}>X:</span>
          {(["ytdPct", "monthlyPct", "yoyPct"] as const).map((k) => (
            <button key={k} onClick={() => setXKey(k)} style={{
              background: xKey === k ? "#3b82f6" : "#21262d",
              border: "1px solid #30363d", borderRadius: 4, padding: "3px 10px",
              color: xKey === k ? "#fff" : "rgba(255,255,255,0.6)", fontSize: 10, cursor: "pointer", fontFamily: "monospace",
            }}>
              {k === "ytdPct" ? "YTD" : k === "monthlyPct" ? "1M" : "YoY"}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <span style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", fontFamily: "monospace" }}>Y:</span>
          {(["monthlyPct", "weeklyPct", "dayReturnPct"] as const).map((k) => (
            <button key={k} onClick={() => setYKey(k)} style={{
              background: yKey === k ? "#3b82f6" : "#21262d",
              border: "1px solid #30363d", borderRadius: 4, padding: "3px 10px",
              color: yKey === k ? "#fff" : "rgba(255,255,255,0.6)", fontSize: 10, cursor: "pointer", fontFamily: "monospace",
            }}>
              {k === "monthlyPct" ? "1M" : k === "weeklyPct" ? "1W" : "1D"}
            </button>
          ))}
        </div>
      </div>
      <ResponsiveContainer width="100%" height={340}>
        <ScatterChart margin={{ top: 10, right: 30, bottom: 10, left: 10 }}>
          <CartesianGrid stroke="#21262d" strokeDasharray="3 3" />
          <XAxis dataKey="x" name={xKey} type="number" domain={["auto", "auto"]}
            tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 10, fontFamily: "monospace" }}
            tickFormatter={(v) => v.toFixed(1) + "%"}
            label={{ value: xKey === "ytdPct" ? "YTD%" : xKey === "monthlyPct" ? "1M%" : "YoY%", fill: "rgba(255,255,255,0.4)", fontSize: 10, position: "insideBottom", offset: -5 }}
          />
          <YAxis dataKey="y" name={yKey} type="number" domain={["auto", "auto"]}
            tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 10, fontFamily: "monospace" }}
            tickFormatter={(v) => v.toFixed(1) + "%"}
          />
          <Tooltip
            cursor={{ stroke: "#3b82f6", strokeWidth: 1 }}
            content={({ payload }) => {
              if (!payload?.[0]) return null;
              const d = payload[0].payload;
              return (
                <div style={{ background: "#0d1117", border: "1px solid #30363d", borderRadius: 6, padding: "8px 12px", fontSize: 11, fontFamily: "monospace" }}>
                  <div style={{ fontWeight: 700, color: "#e6edf3", marginBottom: 4 }}>{d.name}</div>
                  <div style={{ color: "rgba(255,255,255,0.5)" }}>X: <span style={{ color: pctColor(d.x) }}>{fmtPct(d.x)}</span></div>
                  <div style={{ color: "rgba(255,255,255,0.5)" }}>Y: <span style={{ color: pctColor(d.y) }}>{fmtPct(d.y)}</span></div>
                </div>
              );
            }}
          />
          <Scatter data={data} shape={(props: { cx?: number; cy?: number; payload?: { name: string; z?: number; color?: string } }) => {
            const { cx = 0, cy = 0, payload = { name: "", z: 30, color: "#3b82f6" } } = props;
            const r = Math.sqrt((payload.z ?? 30) / 3);
            return (
              <g>
                <circle cx={cx} cy={cy} r={r} fill={payload.color} opacity={0.75} />
                <text x={cx} y={cy - r - 3} textAnchor="middle" fill="rgba(255,255,255,0.7)" fontSize={9} fontFamily="monospace">{payload.name}</text>
              </g>
            );
          }}>
            {data.map((d, i) => <Cell key={i} fill={d.color} />)}
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 8 }}>
        {Object.entries({ Energy: "#ef4444", Metals: "#f59e0b", Seafood: "#22c55e" }).map(([cat, col]) => (
          <div key={cat} style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <div style={{ width: 10, height: 10, borderRadius: "50%", background: col }} />
            <span style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", fontFamily: "monospace" }}>{cat}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── Sectors Radar Tab ────────────────────────────────── */
function SectorsTab({ sectors }: { sectors: SectorData[] }) {
  const perfData = sectors.map((s) => ({
    name: s.name,
    "1D": s.performance.daily ?? 0,
    "1W": s.performance.weekly ?? 0,
    "1M": s.performance.monthly ?? 0,
    YTD: s.performance.ytd ?? 0,
    color: s.color,
  }));

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", fontFamily: "monospace", marginBottom: 12 }}>SECTOR PERFORMANCE</div>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={["1D", "1W", "1M", "YTD"].map((period) => {
            const obj: Record<string, string | number> = { period };
            sectors.forEach((s) => {
              const k = period as "1D" | "1W" | "1M" | "YTD";
              const val = k === "1D" ? s.performance.daily :
                k === "1W" ? s.performance.weekly :
                k === "1M" ? s.performance.monthly : s.performance.ytd;
              obj[s.name] = val ?? 0;
            });
            return obj;
          })} margin={{ top: 10, right: 20, bottom: 10, left: 10 }}>
            <CartesianGrid stroke="#21262d" strokeDasharray="3 3" />
            <XAxis dataKey="period" tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 10, fontFamily: "monospace" }} />
            <YAxis tickFormatter={(v) => v.toFixed(1) + "%"} tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 10, fontFamily: "monospace" }} />
            <Tooltip
              contentStyle={{ background: "#0d1117", border: "1px solid #30363d", borderRadius: 6, fontSize: 11, fontFamily: "monospace" }}
              formatter={(v: unknown) => [fmtPct(v as number), ""]}
            />
            {sectors.map((s) => (
              <Bar key={s.name} dataKey={s.name} fill={s.color} radius={[2, 2, 0, 0]} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 12 }}>
        {sectors.map((s) => (
          <div key={s.name} style={{ background: "#161b22", border: `1px solid ${s.color}30`, borderLeft: `3px solid ${s.color}`, borderRadius: 8, padding: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: s.color, fontFamily: "monospace", marginBottom: 8 }}>{s.name}</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {s.tickers.map((t) => (
                <Link key={t} href={`/stocks/${t}`} style={{
                  background: "#0d1117", border: "1px solid #21262d", borderRadius: 3,
                  padding: "2px 6px", fontSize: 10, color: "rgba(255,255,255,0.6)", fontFamily: "monospace",
                  textDecoration: "none", transition: "all 0.15s",
                }}>
                  {t}
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── Main Page ────────────────────────────────────────── */
export default function CommoditiesPage() {
  const [commodities, setCommodities] = useState<Commodity[]>([]);
  const [sectors, setSectors] = useState<SectorData[]>([]);
  const [corrData, setCorrData] = useState<CorrData | null>(null);
  const [corrPeriod, setCorrPeriod] = useState(90);
  const [corrEquities, setCorrEquities] = useState(false);
  const [tab, setTab] = useState<"dashboard" | "quotes" | "scatter" | "correlations" | "sectors">("dashboard");
  const [loading, setLoading] = useState(true);
  const [corrLoading, setCorrLoading] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch("/api/commodities?days=90").then((r) => r.json()),
      fetch("/api/sectors/overview").then((r) => r.json()),
    ]).then(([commData, sectData]) => {
      setCommodities(commData.commodities || []);
      setSectors(sectData.sectors || []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const loadCorr = useCallback(() => {
    setCorrLoading(true);
    const eq = corrEquities ? "&equities=EQNR,MOWI,NHY,FRO" : "";
    fetch(`/api/commodities/correlation?days=${corrPeriod}${eq}`)
      .then((r) => r.json())
      .then((data) => { setCorrData(data); setCorrLoading(false); })
      .catch(() => setCorrLoading(false));
  }, [corrPeriod, corrEquities]);

  useEffect(() => {
    if (tab === "correlations") loadCorr();
  }, [tab, corrPeriod, corrEquities, loadCorr]);

  // Filter to commodities that have data
  const hasData = commodities.filter((c) => c.latest?.close);

  // Treemap data (group by category)
  const treemapData = {
    name: "commodities",
    children: (() => {
      const byCategory: Record<string, Commodity[]> = {};
      for (const c of hasData) {
        if (!byCategory[c.category]) byCategory[c.category] = [];
        byCategory[c.category].push(c);
      }
      return Object.entries(byCategory).map(([cat, comms]) => ({
        name: cat,
        children: comms.map((c) => ({
          name: c.name,
          symbol: c.symbol,
          value: c.importance,
          dayReturnPct: c.dayReturnPct,
          price: c.latest?.close,
        })),
      }));
    })(),
  };

  return (
    <>
      <style>{`
        @keyframes pulse-badge {
          0%, 100% { box-shadow: 0 0 8px rgba(59,130,246,0.2); }
          50% { box-shadow: 0 0 16px rgba(59,130,246,0.4); }
        }
        .sector-card:hover { transform: translateY(-2px); box-shadow: 0 6px 20px rgba(59,130,246,0.1); }
        .quote-row:hover { background: rgba(59,130,246,0.05); }
        .tab-btn:hover { color: #e6edf3 !important; }
      `}</style>

      <div style={{ minHeight: "100vh", background: "#0a0a0a", color: "#e6edf3", fontFamily: "monospace" }}>
        {/* Header */}
        <div style={{ borderBottom: "1px solid #21262d", padding: "12px 24px", display: "flex", alignItems: "center", gap: 16, background: "#0d1117" }}>
          <PageNav crumbs={[{ label: "Home", href: "/" }, { label: "Commodities" }]} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 700 }}>COMMODITY & SECTOR TERMINAL</div>
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)" }}>
              {hasData.length} commodities · Energy · Seafood · Shipping · Materials
            </div>
          </div>
          <Link href="/sectors" style={{ background: "#21262d", border: "1px solid #30363d", borderRadius: 5, padding: "5px 12px", color: "rgba(255,255,255,0.7)", textDecoration: "none", fontSize: 11 }}>
            Sector Intelligence →
          </Link>
        </div>

        {/* Ticker Strip */}
        {hasData.length > 0 && (
          <div style={{ borderBottom: "1px solid #21262d", padding: "10px 24px", background: "#0d1117", overflowX: "auto" }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "nowrap" }}>
              {hasData.map((c) => <TickerBadge key={c.symbol} c={c} />)}
            </div>
          </div>
        )}

        {/* Tabs */}
        <div style={{ borderBottom: "1px solid #21262d", padding: "0 24px", background: "#0d1117" }}>
          <div style={{ display: "flex", gap: 0 }}>
            {(["dashboard", "quotes", "scatter", "correlations", "sectors"] as const).map((t) => (
              <button key={t} onClick={() => setTab(t)} className="tab-btn" style={{
                background: "none", border: "none", padding: "10px 16px",
                fontSize: 11, cursor: "pointer", fontFamily: "monospace", textTransform: "uppercase", letterSpacing: "0.06em",
                color: tab === t ? "#3b82f6" : "rgba(255,255,255,0.5)",
                borderBottom: tab === t ? "2px solid #3b82f6" : "2px solid transparent",
                transition: "all 0.15s",
              }}>
                {t}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div style={{ padding: 40, textAlign: "center", color: "rgba(255,255,255,0.4)", fontSize: 13 }}>Loading commodity data…</div>
        ) : (
          <div style={{ padding: "24px", maxWidth: 1400, margin: "0 auto" }}>

            {/* DASHBOARD TAB */}
            {tab === "dashboard" && (
              <div>
                {/* Treemap */}
                <div style={{ background: "#161b22", border: "1px solid #30363d", borderRadius: 8, padding: 16, marginBottom: 20 }}>
                  <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                    Market Heatmap — sized by importance, colored by daily return
                  </div>
                  <ResponsiveContainer width="100%" height={340}>
                    <Treemap
                      data={treemapData.children}
                      dataKey="value"
                      aspectRatio={4 / 3}
                      content={<TreemapCell />}
                    />
                  </ResponsiveContainer>
                </div>

                {/* Heat Pulse */}
                <div style={{ background: "#161b22", border: "1px solid #30363d", borderRadius: 8, padding: 16, marginBottom: 20 }}>
                  <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                    5-Day Return Pulse
                  </div>
                  <HeatPulse commodities={hasData} />
                </div>

                {/* Sector Cards */}
                <div style={{ marginBottom: 20 }}>
                  <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                    Sector Intelligence
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 12 }}>
                    {sectors.map((s) => <SectorCard key={s.name} s={s} />)}
                  </div>
                </div>

                {/* Flow Diagram */}
                <div style={{ background: "#161b22", border: "1px solid #30363d", borderRadius: 8, padding: 16 }}>
                  <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                    Commodity → Equity Flow
                  </div>
                  <FlowDiagram commodities={hasData} />
                </div>
              </div>
            )}

            {/* QUOTES TAB */}
            {tab === "quotes" && (
              <div style={{ background: "#161b22", border: "1px solid #30363d", borderRadius: 8, padding: 16 }}>
                <QuotesTable commodities={hasData} />
              </div>
            )}

            {/* SCATTER TAB */}
            {tab === "scatter" && (
              <div style={{ background: "#161b22", border: "1px solid #30363d", borderRadius: 8, padding: 16 }}>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                  Commodity Return Scatter
                </div>
                <ScatterTab commodities={hasData} />
              </div>
            )}

            {/* CORRELATIONS TAB */}
            {tab === "correlations" && (
              <div style={{ background: "#161b22", border: "1px solid #30363d", borderRadius: 8, padding: 16 }}>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16, alignItems: "center" }}>
                  <span style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", textTransform: "uppercase", letterSpacing: "0.08em" }}>Correlation Matrix</span>
                  <div style={{ flex: 1 }} />
                  {[30, 60, 90, 180].map((d) => (
                    <button key={d} onClick={() => setCorrPeriod(d)} style={{
                      background: corrPeriod === d ? "#3b82f6" : "#21262d",
                      border: "1px solid #30363d", borderRadius: 4, padding: "4px 10px",
                      color: corrPeriod === d ? "#fff" : "rgba(255,255,255,0.6)", fontSize: 10, cursor: "pointer", fontFamily: "monospace",
                    }}>
                      {d}D
                    </button>
                  ))}
                  <button onClick={() => setCorrEquities((v) => !v)} style={{
                    background: corrEquities ? "#3b82f6" : "#21262d",
                    border: "1px solid #30363d", borderRadius: 4, padding: "4px 10px",
                    color: corrEquities ? "#fff" : "rgba(255,255,255,0.6)", fontSize: 10, cursor: "pointer", fontFamily: "monospace",
                  }}>
                    + Equities
                  </button>
                </div>
                {corrLoading ? (
                  <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 11, padding: 20 }}>Computing correlations…</div>
                ) : (
                  <CorrMatrix data={corrData} />
                )}
              </div>
            )}

            {/* SECTORS TAB */}
            {tab === "sectors" && (
              <div style={{ background: "#161b22", border: "1px solid #30363d", borderRadius: 8, padding: 16 }}>
                <SectorsTab sectors={sectors} />
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
