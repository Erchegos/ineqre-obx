"use client";

import React, { useEffect, useState, useMemo, useCallback, useRef } from "react";
import Link from "next/link";
import PageNav from "@/components/ui/PageNav";
import { useAuth } from "@/lib/useAuth";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

type Tab = "dashboard" | "sensitivity" | "company" | "portfolio" | "forwards" | "pairs";

type RateCard = {
  pair: string;
  spot: number | null;
  date: string | null;
  change1d: number | null;
  change1w: number | null;
  change1m: number | null;
  changeYtd: number | null;
  vol20d: number | null;
  vol63d: number | null;
  sparkline: { date: string; rate: number }[];
};

type NokIndexPoint = { date: string; index: number; change1d: number };

type ExposureHeatmapRow = {
  ticker: string;
  usd: number;
  eur: number;
  gbp: number;
  sek: number;
};

type SensitivityRow = {
  ticker: string;
  betaMarket: number;
  betaUsd: number;
  betaEur: number;
  betaGbp: number;
  betaSek: number;
  tstatUsd: number;
  tstatEur: number;
  tstatGbp: number;
  tstatSek: number;
  rSquared: number;
  rSquaredFxOnly: number;
};

type ForwardTenor = {
  tenor: string;
  days: number;
  spot: number;
  forward: number;
  forwardPoints: number;
  forwardPointsBps: number;
  annualizedCarryPct: number;
  hedgeCostBps: number;
  nokRate: number;
  foreignRate: number;
  basisDecomposition?: {
    oisBasisBps: number;
    implementableBasisHigh: number;
    implementableBasisMid: number;
    hasArbitrageHigh: boolean;
    hasArbitrageMid: boolean;
  };
};

type PortfolioConfig = {
  id: string;
  name: string;
  tickers: string[];
  weights: number[];
  mode?: string;
};

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

const CCY_COLORS: Record<string, string> = {
  USD: "#10b981",
  EUR: "#2196F3",
  GBP: "#9C27B0",
  SEK: "#FF9800",
  NOK: "#F44336",
  DKK: "#00BCD4",
};

const PAIR_LABELS: Record<string, string> = {
  NOKUSD: "USD/NOK",
  NOKEUR: "EUR/NOK",
  NOKGBP: "GBP/NOK",
  NOKSEK: "SEK/NOK",
  NOKDKK: "DKK/NOK",
};

const tabBtn = (active: boolean): React.CSSProperties => ({
  padding: "10px 14px", cursor: "pointer", fontSize: 10, letterSpacing: "0.06em", fontWeight: 700,
  color: active ? "#3b82f6" : "rgba(255,255,255,0.5)",
  borderBottom: active ? "2px solid #3b82f6" : "2px solid transparent",
  background: "transparent", border: "none", borderRadius: 0,
  fontFamily: "monospace", whiteSpace: "nowrap", flexShrink: 0,
});

const S: Record<string, React.CSSProperties> = {
  page: { background: "#0a0a0a", color: "#fff", minHeight: "100vh", fontFamily: "monospace", fontSize: 13, overflowX: "hidden" as const },
  header: { padding: "20px 16px 12px", borderBottom: "1px solid #30363d" },
  title: { fontSize: 18, fontWeight: 700, color: "#fff", letterSpacing: 2 },
  subtitle: { fontSize: 12, color: "rgba(255,255,255,0.5)", marginTop: 2 },
  tabs: { display: "flex", gap: 0, borderBottom: "1px solid #30363d", padding: "0 16px", overflowX: "auto" as const, WebkitOverflowScrolling: "touch" as any },
  content: { padding: "20px 16px", maxWidth: 1400, margin: "0 auto", overflowX: "hidden" as const, boxSizing: "border-box" as const },
  card: { background: "#161b22", border: "1px solid #30363d", borderRadius: 8, padding: 16, marginBottom: 12, boxSizing: "border-box" as const, minWidth: 0 },
  cardTitle: { fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.6)", letterSpacing: "0.08em", textTransform: "uppercase" as const, marginBottom: 8, fontFamily: "monospace" },
  grid2: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(280px, 100%), 1fr))", gap: 12 },
  grid3: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(260px, 100%), 1fr))", gap: 12 },
  grid5: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(140px, 100%), 1fr))", gap: 10 },
  accent: { color: "#3b82f6" },
  green: { color: "#10b981" },
  red: { color: "#ef4444" },
  dim: { color: "rgba(255,255,255,0.5)" },
  badge: { display: "inline-block", padding: "2px 8px", borderRadius: 3, fontSize: 10, fontWeight: 700, letterSpacing: 0.5 },
  table: { width: "100%", borderCollapse: "collapse" as const, fontSize: 11, fontFamily: "monospace" },
  th: { textAlign: "left" as const, padding: "8px 6px", borderBottom: "1px solid #30363d", color: "rgba(255,255,255,0.5)", fontWeight: 600, fontSize: 9, letterSpacing: "0.05em", cursor: "pointer", userSelect: "none" as const, textTransform: "uppercase" as const },
  td: { padding: "6px 6px", borderBottom: "1px solid #30363d" },
  input: { background: "#0d1117", border: "1px solid #30363d", borderRadius: 5, color: "#fff", padding: "8px 10px", fontSize: 12, fontFamily: "monospace", boxSizing: "border-box" as const },
  select: { background: "#0d1117", border: "1px solid #30363d", borderRadius: 5, color: "#fff", padding: "8px 10px", fontSize: 12, fontFamily: "monospace" },
  button: { background: "linear-gradient(135deg, #3b82f6, #2563eb)", color: "#fff", border: "none", borderRadius: 6, padding: "8px 20px", fontSize: 11, fontWeight: 700, cursor: "pointer", letterSpacing: "0.05em", fontFamily: "monospace" },
  slider: { width: "100%", accentColor: "#3b82f6" },
};

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function fmtRate(v: number | null, dec = 4): string {
  if (v == null) return "\u2014";
  return v.toFixed(dec);
}

function fmtPct(v: number | null, dec = 2): string {
  if (v == null) return "\u2014";
  return `${v >= 0 ? "+" : ""}${v.toFixed(dec)}%`;
}

function fmtBps(v: number | null): string {
  if (v == null) return "\u2014";
  return `${v.toFixed(1)} bps`;
}

function changeColor(v: number | null): string {
  if (v == null) return "rgba(255,255,255,0.4)";
  return v > 0 ? "#10b981" : v < 0 ? "#ef4444" : "rgba(255,255,255,0.5)";
}

function sigStar(t: number): string {
  const at = Math.abs(t);
  if (at > 2.576) return " \u2605\u2605\u2605";
  if (at > 1.96) return " \u2605\u2605";
  if (at > 1.645) return " \u2605";
  return "";
}

/** Returns significance stars + spurious flag when fundamental exposure is ~0% */
function sigStarChecked(t: number, fundamentalNetExposure: number | undefined): { stars: string; spurious: boolean } {
  const stars = sigStar(t);
  // If statistically significant but company has ~0% fundamental exposure, flag as likely spurious
  // Exposure values are decimals (0.55 = 55%), so 0.02 = 2% threshold
  const spurious = stars.length > 0 && fundamentalNetExposure !== undefined && Math.abs(fundamentalNetExposure) < 0.02;
  return { stars, spurious };
}

function exposureColor(v: number): string {
  const abs = Math.abs(v);
  if (abs < 0.05) return "transparent";
  const intensity = Math.min(abs * 2, 1);
  return v > 0 ? `rgba(59,130,246,${intensity * 0.4})` : `rgba(239,68,68,${intensity * 0.4})`;
}

/* Mini SVG sparkline */
function Sparkline({ data, width = 120, height = 32, color = "#3b82f6" }: { data: number[]; width?: number; height?: number; color?: string }) {
  if (data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((v - min) / range) * (height - 4) - 2;
    return `${x},${y}`;
  }).join(" ");
  return (
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{ display: "block", width: "100%", height }}>
      <polyline points={points} fill="none" stroke={color} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/* Area sparkline with fill — uses viewBox for responsive width */
function AreaSparkline({ data, width = 500, height = 140, color = "#3b82f6" }: { data: number[]; width?: number; height?: number; color?: string }) {
  if (data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((v - min) / range) * (height - 8) - 4;
    return { x, y };
  });
  const linePoints = pts.map(p => `${p.x},${p.y}`).join(" ");
  const areaPoints = `0,${height} ${linePoints} ${width},${height}`;
  const lastPt = pts[pts.length - 1];
  return (
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{ display: "block", width: "100%", height }}>
      <defs>
        <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.3} />
          <stop offset="100%" stopColor={color} stopOpacity={0.02} />
        </linearGradient>
      </defs>
      <polygon points={areaPoints} fill="url(#areaGrad)" />
      <polyline points={linePoints} fill="none" stroke={color} strokeWidth={2} vectorEffect="non-scaling-stroke" />
      {lastPt && (
        <circle cx={lastPt.x} cy={lastPt.y} r={4} fill={color} />
      )}
    </svg>
  );
}

/* CarryPnlChart */
function CarryPnlChart({ data }: { data: { date: string; carry: number; spot: number; total: number }[] }) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  if (!data || data.length < 2) return null;

  const W = 600, H = 190;
  const PAD = { top: 18, right: 20, bottom: 30, left: 50 };
  const chartW = W - PAD.left - PAD.right;
  const chartH = H - PAD.top - PAD.bottom;

  const allVals = data.flatMap(d => [d.carry, d.spot, d.total]);
  const minV = Math.min(...allVals);
  const maxV = Math.max(...allVals);
  const range = maxV - minV || 0.01;
  const padded = range * 0.15;
  const yMin = minV - padded;
  const yMax = maxV + padded;

  const xOf = (i: number) => PAD.left + (i / (data.length - 1)) * chartW;
  const yOf = (v: number) => PAD.top + (1 - (v - yMin) / (yMax - yMin)) * chartH;

  const toPath = (key: "carry" | "spot" | "total") =>
    data.map((d, i) => `${i === 0 ? "M" : "L"}${xOf(i).toFixed(1)},${yOf(d[key]).toFixed(1)}`).join(" ");

  const yTickCount = 4;
  const yTickVals = Array.from({ length: yTickCount + 1 }, (_, i) => yMin + (i / yTickCount) * (yMax - yMin));
  const xTickIdxs = [0, Math.floor(data.length * 0.25), Math.floor(data.length * 0.5), Math.floor(data.length * 0.75), data.length - 1];
  const fmtDate = (s: string) => { const d = new Date(s); return `${d.getDate()} ${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][d.getMonth()]}`; };
  const zeroY = yOf(0);

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const scale = W / rect.width; // viewBox → rendered px
    const x = (e.clientX - rect.left) * scale - PAD.left;
    const pct = Math.max(0, Math.min(1, x / chartW));
    setHoverIdx(Math.round(pct * (data.length - 1)));
  };

  const hd = hoverIdx !== null ? data[hoverIdx] : null;
  // tooltip position in % of rendered container width (not SVG coords)
  const tooltipPct = hoverIdx !== null ? xOf(hoverIdx) / W : 0;
  const flipTooltip = tooltipPct > 0.6;

  return (
    <div style={{ position: "relative", userSelect: "none" as const }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ display: "block", width: "100%", height: "auto" }}
        onMouseMove={handleMouseMove} onMouseLeave={() => setHoverIdx(null)}>
        {/* Y-axis gridlines + labels */}
        {yTickVals.map((v, i) => {
          const y = yOf(v);
          return (
            <g key={i}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y} y2={y} stroke="rgba(255,255,255,0.06)" strokeWidth={1} />
              <text x={PAD.left - 4} y={y + 3.5} textAnchor="end" fontSize={9} fill="rgba(255,255,255,0.35)" fontFamily="monospace">
                {v >= 0 ? "+" : ""}{v.toFixed(1)}%
              </text>
            </g>
          );
        })}
        {/* Zero reference */}
        {zeroY >= PAD.top && zeroY <= PAD.top + chartH && (
          <line x1={PAD.left} x2={W - PAD.right} y1={zeroY} y2={zeroY}
            stroke="rgba(255,255,255,0.22)" strokeWidth={1} strokeDasharray="4,3" />
        )}
        {/* X-axis dates */}
        {xTickIdxs.map((idx, i) => (
          <text key={i} x={xOf(idx)} y={H - 6} textAnchor="middle" fontSize={9} fill="rgba(255,255,255,0.32)" fontFamily="monospace">
            {fmtDate(data[idx].date)}
          </text>
        ))}
        {/* Series lines */}
        <path d={toPath("carry")} fill="none" stroke="#10b981" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
        <path d={toPath("spot")} fill="none" stroke="#60a5fa" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
        <path d={toPath("total")} fill="none" stroke="rgba(255,255,255,0.88)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        {/* Hover */}
        {hoverIdx !== null && hd && (
          <>
            <line x1={xOf(hoverIdx)} x2={xOf(hoverIdx)} y1={PAD.top} y2={PAD.top + chartH}
              stroke="rgba(255,255,255,0.18)" strokeWidth={1} strokeDasharray="3,2" />
            <circle cx={xOf(hoverIdx)} cy={yOf(hd.carry)} r={3.5} fill="#10b981" />
            <circle cx={xOf(hoverIdx)} cy={yOf(hd.spot)} r={3.5} fill="#60a5fa" />
            <circle cx={xOf(hoverIdx)} cy={yOf(hd.total)} r={4} fill="white" />
          </>
        )}
      </svg>
      {/* Floating tooltip */}
      {hoverIdx !== null && hd && (
        <div style={{ position: "absolute", top: 4,
          left: flipTooltip ? `calc(${(tooltipPct * 100).toFixed(1)}% - 140px)` : `calc(${(tooltipPct * 100).toFixed(1)}% + 8px)`,
          background: "#161b22", border: "1px solid #30363d", borderRadius: 6, padding: "8px 10px",
          fontSize: 10, fontFamily: "monospace", pointerEvents: "none", minWidth: 124, zIndex: 10 }}>
          <div style={{ color: "rgba(255,255,255,0.45)", marginBottom: 6, fontSize: 9 }}>{hd.date}</div>
          <div style={{ display: "flex", flexDirection: "column" as const, gap: 3 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 14 }}>
              <span style={{ color: "#10b981" }}>Carry</span>
              <span style={{ color: "#10b981", fontWeight: 600 }}>{hd.carry >= 0 ? "+" : ""}{hd.carry.toFixed(2)}%</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 14 }}>
              <span style={{ color: "#60a5fa" }}>Spot</span>
              <span style={{ color: "#60a5fa", fontWeight: 600 }}>{hd.spot >= 0 ? "+" : ""}{hd.spot.toFixed(2)}%</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 14,
              borderTop: "1px solid #30363d", paddingTop: 4, marginTop: 2 }}>
              <span style={{ color: "rgba(255,255,255,0.85)", fontWeight: 700 }}>Total</span>
              <span style={{ color: "rgba(255,255,255,0.85)", fontWeight: 700 }}>{hd.total >= 0 ? "+" : ""}{hd.total.toFixed(2)}%</span>
            </div>
          </div>
        </div>
      )}
      {/* Legend */}
      <div style={{ display: "flex", gap: 16, fontSize: 10, marginTop: 4, paddingLeft: PAD.left }}>
        {[
          { color: "#10b981", label: "Carry income" },
          { color: "#60a5fa", label: "Spot return" },
          { color: "rgba(255,255,255,0.85)", label: "Total P&L", bold: true },
        ].map(({ color, label, bold }) => (
          <span key={label} style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ display: "inline-block", width: 16, height: 2, background: color, borderRadius: 1 }} />
            <span style={{ color: bold ? "rgba(255,255,255,0.7)" : "rgba(255,255,255,0.5)", fontWeight: bold ? 600 : 400 }}>{label}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/* SortHeader */
function SortHeader({ label, col, sort, onSort }: { label: string; col: string; sort: { col: string; asc: boolean }; onSort: (col: string) => void }) {
  const active = sort.col === col;
  return (
    <th style={{ ...S.th, color: active ? "#3b82f6" : "rgba(255,255,255,0.5)" }} onClick={() => onSort(col)}>
      {label} {active ? (sort.asc ? "\u25B2" : "\u25BC") : ""}
    </th>
  );
}

function HelpToggle({ id, label, children, showHelp, setShowHelp }: {
  id: string; label?: string; children: React.ReactNode;
  showHelp: Record<string, boolean>; setShowHelp: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
}) {
  const open = !!showHelp[id];
  return (
    <div style={{ marginTop: 4, marginBottom: open ? 10 : 4 }}>
      <span
        onClick={() => setShowHelp(p => ({ ...p, [id]: !p[id] }))}
        style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", cursor: "pointer", userSelect: "none" as const, display: "inline-flex", alignItems: "center", gap: 4, fontFamily: "monospace" }}
      >
        <span style={{ fontSize: 8, color: open ? "#3b82f6" : "rgba(255,255,255,0.35)", transition: "transform 0.15s", display: "inline-block", transform: open ? "rotate(90deg)" : "rotate(0deg)" }}>{"\u25B6"}</span>
        {label || "What do these numbers mean?"}
      </span>
      {open && (
        <div style={{ marginTop: 6, padding: 10, background: "#0d1117", borderRadius: 4, border: "1px solid #21262d", fontSize: 11, color: "rgba(255,255,255,0.5)", lineHeight: 1.6, fontFamily: "monospace" }}>
          {children}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Pairs Trading Chart Sub-Components (stateless, defined outside     */
/* main component to avoid identity issues during playback)           */
/* ------------------------------------------------------------------ */

function PairsZChart({ series, activeTrade, entryZ = 1.8, stopZ = 2.8, trades = [], showDots = false }:
  { series: any[]; activeTrade: any; entryZ?: number; stopZ?: number; trades?: any[]; showDots?: boolean }) {
  if (series.length < 2) return null;
  const WIN = 90;
  const shown = series.length > WIN ? series.slice(-WIN) : series;
  const shownStart = shown[0].date, shownEnd = shown[shown.length - 1].date;
  const W = 700, H = 190;
  const PAD = { top: 16, right: 16, bottom: 28, left: 46 };
  const cW = W - PAD.left - PAD.right, cH = H - PAD.top - PAD.bottom;
  const zvals = shown.map((s: any) => s.zscore);
  const absMax = Math.max(Math.ceil(stopZ) + 0.3, Math.max(...zvals.map(Math.abs)));
  const yMin = -absMax, yMax = absMax;
  const xOf = (i: number) => PAD.left + (i / Math.max(1, shown.length - 1)) * cW;
  const yOf = (v: number) => PAD.top + (1 - (v - yMin) / (yMax - yMin)) * cH;
  // Map a date string → x coordinate
  const dateToX = (d: string): number | null => {
    const idx = shown.findIndex((s: any) => s.date >= d);
    return idx >= 0 ? xOf(idx) : null;
  };
  const linePts = shown.map((s: any, i: number) => `${i === 0 ? "M" : "L"}${xOf(i).toFixed(1)},${yOf(s.zscore).toFixed(1)}`).join(" ");
  const fmtD = (s: string) => { const d = new Date(s); return `${d.getDate()} ${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][d.getMonth()]}`; };
  const xTicks = [0, Math.floor(shown.length*0.25), Math.floor(shown.length*0.5), Math.floor(shown.length*0.75), shown.length-1];
  // Reference grid lines — subtle
  const gridLines = [0, entryZ * 0.5, -entryZ * 0.5];
  // Position shading
  const posRects: React.ReactElement[] = [];
  if (activeTrade) {
    let start = -1;
    for (let i = 0; i < shown.length; i++) {
      if (shown[i].date >= activeTrade.entryDate && start === -1) start = i;
    }
    if (start >= 0) {
      const x1 = xOf(start), x2 = xOf(shown.length - 1);
      posRects.push(<rect key="pos" x={x1} y={PAD.top} width={Math.max(0, x2 - x1)} height={cH}
        fill={activeTrade.direction === "long" ? "rgba(16,185,129,0.10)" : "rgba(239,68,68,0.10)"} />);
    }
  }
  // Trade entry/exit dots
  const tradeDots: React.ReactElement[] = [];
  if (showDots) {
    for (const t of trades) {
      if (t.exitDate > shownEnd) continue;
      // Entry dot
      if (t.entryDate >= shownStart && t.entryDate <= shownEnd) {
        const ex = dateToX(t.entryDate);
        const entryPt = shown.find((s: any) => s.date >= t.entryDate);
        if (ex !== null && entryPt) {
          const ey = yOf(entryPt.zscore);
          const col = t.direction === "long" ? "#10b981" : "#ef4444";
          tradeDots.push(
            <g key={`entry-${t.entryDate}`}>
              <circle cx={ex} cy={ey} r={5} fill={col} opacity={0.9} />
              <circle cx={ex} cy={ey} r={5} fill="none" stroke="#fff" strokeWidth={0.8} opacity={0.5} />
              <text x={ex} y={ey - 8} textAnchor="middle" fontSize={7} fill={col} fontFamily="monospace" fontWeight={700}>
                {t.direction === "long" ? "▲" : "▼"}
              </text>
            </g>
          );
        }
      }
      // Exit dot
      if (t.exitDate >= shownStart && t.exitDate <= shownEnd) {
        const xx = dateToX(t.exitDate);
        const exitPt = shown.find((s: any) => s.date >= t.exitDate);
        if (xx !== null && exitPt) {
          const xy = yOf(exitPt.zscore);
          const isStop = t.exitReason === "stop";
          tradeDots.push(
            <g key={`exit-${t.exitDate}-${t.entryDate}`}>
              <circle cx={xx} cy={xy} r={4} fill={isStop ? "#f59e0b" : "rgba(255,255,255,0.85)"} opacity={0.9} />
              <circle cx={xx} cy={xy} r={4} fill="none" stroke={isStop ? "#f59e0b" : "#fff"} strokeWidth={0.8} opacity={0.4} />
              {isStop && <text x={xx} y={xy - 8} textAnchor="middle" fontSize={7} fill="#f59e0b" fontFamily="monospace">✕</text>}
            </g>
          );
        }
      }
    }
  }
  const lastPt = shown[shown.length - 1];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ display: "block", width: "100%", height: "auto" }}>
      <defs>
        <linearGradient id="zcGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.15" />
          <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
        </linearGradient>
      </defs>
      {posRects}
      {/* Subtle entry zone bands */}
      <rect x={PAD.left} y={yOf(entryZ)} width={cW} height={yOf(-entryZ) - yOf(entryZ)} fill="rgba(16,185,129,0.04)" />
      {/* Grid lines */}
      {gridLines.map(v => (
        <line key={v} x1={PAD.left} x2={W-PAD.right} y1={yOf(v)} y2={yOf(v)}
          stroke={v===0 ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.04)"} strokeWidth={v===0?1:0.8} strokeDasharray={v!==0?"3 4":undefined} />
      ))}
      {/* Zero line label */}
      <text x={PAD.left-4} y={yOf(0)+3.5} textAnchor="end" fontSize={8} fill="rgba(255,255,255,0.25)" fontFamily="monospace">0</text>
      {/* Dynamic entry lines */}
      <line x1={PAD.left} x2={W-PAD.right} y1={yOf(entryZ)} y2={yOf(entryZ)} stroke="#10b981" strokeWidth={1.2} opacity={0.65} strokeDasharray="5 3" />
      <line x1={PAD.left} x2={W-PAD.right} y1={yOf(-entryZ)} y2={yOf(-entryZ)} stroke="#10b981" strokeWidth={1.2} opacity={0.65} strokeDasharray="5 3" />
      <text x={PAD.left-4} y={yOf(entryZ)+3.5} textAnchor="end" fontSize={7.5} fill="#10b981" fontFamily="monospace" opacity={0.8}>+{entryZ}</text>
      <text x={PAD.left-4} y={yOf(-entryZ)+3.5} textAnchor="end" fontSize={7.5} fill="#10b981" fontFamily="monospace" opacity={0.8}>-{entryZ}</text>
      {/* Dynamic stop lines */}
      <line x1={PAD.left} x2={W-PAD.right} y1={yOf(stopZ)} y2={yOf(stopZ)} stroke="#ef4444" strokeWidth={1} opacity={0.55} strokeDasharray="3 3" />
      <line x1={PAD.left} x2={W-PAD.right} y1={yOf(-stopZ)} y2={yOf(-stopZ)} stroke="#ef4444" strokeWidth={1} opacity={0.55} strokeDasharray="3 3" />
      <text x={PAD.left-4} y={yOf(stopZ)+3.5} textAnchor="end" fontSize={7.5} fill="#ef4444" fontFamily="monospace" opacity={0.7}>+{stopZ}</text>
      <text x={PAD.left-4} y={yOf(-stopZ)+3.5} textAnchor="end" fontSize={7.5} fill="#ef4444" fontFamily="monospace" opacity={0.7}>-{stopZ}</text>
      {/* Area fill under z-line */}
      <path d={linePts + ` L${xOf(shown.length-1)},${yOf(0)} L${xOf(0)},${yOf(0)} Z`} fill="url(#zcGrad)" />
      {/* Z-score line */}
      <path d={linePts} fill="none" stroke="#3b82f6" strokeWidth={1.5} />
      {/* Trade dots */}
      {tradeDots}
      {/* Current bar cursor */}
      <line x1={xOf(shown.length-1)} x2={xOf(shown.length-1)} y1={PAD.top} y2={PAD.top+cH} stroke="rgba(255,255,255,0.3)" strokeWidth={1} strokeDasharray="2 2" />
      {lastPt && <circle cx={xOf(shown.length-1)} cy={yOf(lastPt.zscore)} r={3.5} fill="#3b82f6" stroke="rgba(255,255,255,0.5)" strokeWidth={1} />}
      {/* Date ticks */}
      {xTicks.map(i => shown[i] && (
        <text key={i} x={xOf(i)} y={H-4} textAnchor="middle" fontSize={8} fill="rgba(255,255,255,0.25)" fontFamily="monospace">{fmtD(shown[i].date)}</text>
      ))}
    </svg>
  );
}

function PairsEquityChart({ curve }: { curve: { date: string; value: number }[] }) {
  if (curve.length < 2) return null;
  const W = 400, H = 150;
  const PAD = { top: 14, right: 52, bottom: 22, left: 46 };
  const cW = W-PAD.left-PAD.right, cH = H-PAD.top-PAD.bottom;

  // Work in % return space (value - 100)
  const rets = curve.map(e => e.value - 100);
  const rMin = Math.min(...rets, -1), rMax = Math.max(...rets, 1);
  const range = rMax - rMin || 1;
  const xOf = (i: number) => PAD.left + (i / Math.max(1, curve.length-1)) * cW;
  const yOf = (r: number) => PAD.top + (1 - (r-rMin)/range) * cH;

  const linePts = curve.map((e,i) => `${i===0?"M":"L"}${xOf(i).toFixed(1)},${yOf(rets[i]).toFixed(1)}`).join(" ");
  const aB = PAD.top + cH;
  const zero0Y = yOf(0);
  const areaPts = `${PAD.left},${zero0Y} ${curve.map((e,i)=>`${xOf(i).toFixed(1)},${yOf(rets[i]).toFixed(1)}`).join(" ")} ${xOf(curve.length-1)},${zero0Y}`;
  const endRet = rets[rets.length-1];
  const lc = endRet >= 0 ? "#10b981" : "#ef4444";

  // Y-axis ticks in % — pick ~4 nice values
  const tickStep = Math.max(0.05, parseFloat((range / 4).toPrecision(1)));
  const tickStart = Math.ceil(rMin / tickStep) * tickStep;
  const yTicks: number[] = [];
  for (let t = tickStart; t <= rMax + 0.001; t += tickStep) yTicks.push(Math.round(t * 1000) / 1000);

  // Date ticks
  const fmtD = (s: string) => { const d = new Date(s); return `${d.getDate()} ${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][d.getMonth()]}`; };
  const xTicks = [0, Math.floor(curve.length*0.33), Math.floor(curve.length*0.66), curve.length-1];

  const lastX = xOf(curve.length-1), lastY = yOf(endRet);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ display: "block", width: "100%", height: "auto" }}>
      <defs>
        <linearGradient id="pEqG" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={lc} stopOpacity={0.3} />
          <stop offset="100%" stopColor={lc} stopOpacity={0.02} />
        </linearGradient>
      </defs>
      {/* Zero line */}
      {zero0Y >= PAD.top && zero0Y <= PAD.top+cH && (
        <line x1={PAD.left} x2={W-PAD.right} y1={zero0Y} y2={zero0Y} stroke="rgba(255,255,255,0.2)" strokeWidth={0.8} strokeDasharray="3 3" />
      )}
      {/* Y-axis ticks */}
      {yTicks.map(t => {
        const y = yOf(t);
        if (y < PAD.top - 2 || y > PAD.top+cH+2) return null;
        const label = (t >= 0 ? "+" : "") + t.toFixed(t === Math.floor(t) ? 0 : 1) + "%";
        return (
          <g key={t}>
            <line x1={PAD.left-3} x2={PAD.left} y1={y} y2={y} stroke="rgba(255,255,255,0.2)" strokeWidth={0.6} />
            <text x={PAD.left-5} y={y+3.5} textAnchor="end" fontSize={8} fill={t === 0 ? "rgba(255,255,255,0.35)" : "rgba(255,255,255,0.25)"} fontFamily="monospace">{label}</text>
          </g>
        );
      })}
      {/* X-axis date ticks */}
      {xTicks.map(i => curve[i] && (
        <text key={i} x={xOf(i)} y={H-4} textAnchor="middle" fontSize={7} fill="rgba(255,255,255,0.2)" fontFamily="monospace">{fmtD(curve[i].date)}</text>
      ))}
      <polygon points={areaPts} fill="url(#pEqG)" />
      <path d={linePts} fill="none" stroke={lc} strokeWidth={2} />
      <circle cx={lastX} cy={lastY} r={3.5} fill={lc} />
      {/* Final return label */}
      <text x={lastX+6} y={lastY+4} fontSize={10} fontWeight={700} fill={lc} fontFamily="monospace">
        {endRet >= 0 ? "+" : ""}{endRet.toFixed(2)}%
      </text>
    </svg>
  );
}

function PairsBetaChart({ series }: { series: any[] }) {
  if (series.length < 2) return null;
  const WIN = 90;
  const shown = series.length > WIN ? series.slice(-WIN) : series;
  const W = 400, H = 130;
  const PAD = { top: 10, right: 12, bottom: 20, left: 54 };
  const cW = W-PAD.left-PAD.right, cH = H-PAD.top-PAD.bottom;
  const bvals = shown.map((s: any) => s.beta);
  const bMin = Math.min(...bvals)-0.001, bMax = Math.max(...bvals)+0.001;
  const range = bMax - bMin || 0.001;
  const xOf = (i: number) => PAD.left + (i / Math.max(1, shown.length-1)) * cW;
  const yOf = (v: number) => PAD.top + (1-(v-bMin)/range)*cH;
  const linePts = shown.map((s: any, i: number) => `${i===0?"M":"L"}${xOf(i).toFixed(1)},${yOf(s.beta).toFixed(1)}`).join(" ");
  const aB = PAD.top+cH;
  const areaPts = `${PAD.left},${aB} ${shown.map((s: any,i: number)=>`${xOf(i).toFixed(1)},${yOf(s.beta).toFixed(1)}`).join(" ")} ${xOf(shown.length-1)},${aB}`;
  const lastBeta = shown[shown.length-1].beta;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ display: "block", width: "100%", height: "auto" }}>
      <defs>
        <linearGradient id="pBetaG" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.2} />
          <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.02} />
        </linearGradient>
      </defs>
      <polygon points={areaPts} fill="url(#pBetaG)" />
      <path d={linePts} fill="none" stroke="#3b82f6" strokeWidth={1.5} />
      <circle cx={xOf(shown.length-1)} cy={yOf(lastBeta)} r={3} fill="#3b82f6" />
      <text x={PAD.left-4} y={PAD.top+3.5} textAnchor="end" fontSize={8} fill="rgba(255,255,255,0.3)" fontFamily="monospace">{bMax.toFixed(4)}</text>
      <text x={PAD.left-4} y={PAD.top+cH+3.5} textAnchor="end" fontSize={8} fill="rgba(255,255,255,0.3)" fontFamily="monospace">{bMin.toFixed(4)}</text>
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Page Component                                                      */
/* ------------------------------------------------------------------ */

export default function FXTerminalPage() {
  /* Auth */
  const { token, profile, ready: _authReady, login: authLogin, logout: authLogout } = useAuth();

  /* State */
  const [tab, setTab] = useState<Tab>("dashboard");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /* Dashboard state */
  const [rateCards, setRateCards] = useState<RateCard[]>([]);
  const [nokIndex, setNokIndex] = useState<NokIndexPoint[]>([]);
  const [nokIndexCurrent, setNokIndexCurrent] = useState<NokIndexPoint | null>(null);
  const [_regimes, setRegimes] = useState<Record<string, { regime: string; confidence: number }>>({});
  const [correlationMatrix, setCorrelationMatrix] = useState<Record<string, Record<string, number>>>({});
  const [exposureHeatmap, setExposureHeatmap] = useState<ExposureHeatmapRow[]>([]);

  /* Sensitivity state */
  const [allSensitivity, setAllSensitivity] = useState<SensitivityRow[]>([]);
  const [selectedSensTicker, setSelectedSensTicker] = useState<string | null>(null);
  const [sensDetail, setSensDetail] = useState<any>(null);
  const [sensSort, setSensSort] = useState<{ col: string; asc: boolean }>({ col: "betaFxTotal", asc: false });

  /* Company state */
  const [companyTicker, setCompanyTicker] = useState("EQNR");
  const [companyData, setCompanyData] = useState<any>(null);
  const [forwardData, setForwardData] = useState<{ pair: string; forwards: ForwardTenor[] } | null>(null);
  const [hedgeResult, setHedgeResult] = useState<any>(null);
  const [hedgeNotional, setHedgeNotional] = useState(500000);
  const [hedgeRatio, setHedgeRatio] = useState(50);
  const [hedgeTenor, setHedgeTenor] = useState("3M");
  const [hedgeCurrency, setHedgeCurrency] = useState("USD");

  /* Portfolio state */
  const [pfTickers, setPfTickers] = useState("EQNR,MOWI,FRO,DNB");
  const [pfWeights, setPfWeights] = useState("0.3,0.25,0.25,0.2");
  const [pfResult, setPfResult] = useState<any>(null);
  const [pfLoading, setPfLoading] = useState(false);
  const [savedConfigs, setSavedConfigs] = useState<PortfolioConfig[]>([]);
  const [configsLoading, setConfigsLoading] = useState(false);
  const [selectedConfigId, setSelectedConfigId] = useState<string | null>(null);
  const [normalizeWeights, setNormalizeWeights] = useState(true);
  const [editingWeightIdx, setEditingWeightIdx] = useState<number | null>(null);
  const [editingWeightVal, setEditingWeightVal] = useState("");
  const [pfTickerSearch, setPfTickerSearch] = useState("");
  const [pfSearchFocused, setPfSearchFocused] = useState(false);

  /* Portfolio auth state (for login modal) */
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [authUser, setAuthUser] = useState("");
  const [authPass, setAuthPass] = useState("");
  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);

  /* Forwards state */
  const [fwdPair, setFwdPair] = useState("NOKEUR");
  const [fwdForwards, setFwdForwards] = useState<ForwardTenor[]>([]);
  const [interestRates, setInterestRates] = useState<Record<string, any[]>>({});
  const [carryData, setCarryData] = useState<any>(null);

  /* CIP / Basis state (Rime, Schrimpf & Syrstad 2022) */
  const [qeWarningDismissed, setQeWarningDismissed] = useState(false);
  const [basisData, setBasisData] = useState<any>(null);
  const [basisPair, setBasisPair] = useState("NOKUSD");
  const [basisTenor, setBasisTenor] = useState("3M");
  const [basisMode, setBasisMode] = useState<"OIS" | "IMPLEMENTABLE">("OIS");
  const [fundingRegimes, setFundingRegimes] = useState<any[]>([]);
  const [arbData, setArbData] = useState<any>(null);
  const [arbTenor, setArbTenor] = useState("3M");

  /* Pairs trading live simulation */
  const [pairsSelectedPair, setPairsSelectedPair] = useState("NOKGBP_NOKEUR");
  const [pairsData, setPairsData] = useState<any>(null);
  const [pairsDataLoading, setPairsDataLoading] = useState(false);
  const [pairsShowGuide, setPairsShowGuide] = useState(false);
  const [pairsPlayIdx, setPairsPlayIdx] = useState(-1); // -1 = not started, blank slate
  const [pairsIsPlaying, setPairsIsPlaying] = useState(false);
  const [pairsSpeed, setPairsSpeed] = useState(5);
  const pairsIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  /* Friction / cost parameters */
  const [pairsDays, setPairsDays] = useState(1260);           // history window in trading days — default 5Y
  const [pairsPosSize, setPairsPosSize] = useState(10);       // % of NAV per trade
  const [pairsBidAskBps, setPairsBidAskBps] = useState(1.0); // bps per side — institutional major FX (EUR/USD ~0.5, GBP pairs ~1.0)
  const [pairsSlippageBps, setPairsSlippageBps] = useState(0.5); // bps — FX is the world's most liquid market ($7.5T/day)
  const [pairsCommBps, setPairsCommBps] = useState(0.5);     // bps — prime broker rate for major pairs
  /* Signal threshold parameters */
  const [pairsEntryZ, setPairsEntryZ] = useState(1.6);       // entry z-score threshold
  const [pairsExitZ, setPairsExitZ] = useState(0.6);         // exit z-score threshold
  const [pairsStopZ, setPairsStopZ] = useState(2.8);         // stop-loss z-score threshold
  const [pairsShowDots, setPairsShowDots] = useState(true);  // show entry/exit dots on chart
  const pairsDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [expSort, setExpSort] = useState<{ col: string; asc: boolean }>({ col: "ticker", asc: true });
  const [showHelp, setShowHelp] = useState<Record<string, boolean>>({});
  const [showHowTo, setShowHowTo] = useState(false);
  const [hedgeChartMouse, setHedgeChartMouse] = useState<{ x: number; idx: number } | null>(null);
  const [sensChartMode, setSensChartMode] = useState<"statistical" | "fundamental">("statistical");
  const [sensChartMouse, setSensChartMouse] = useState<{ x: number; pct: number } | null>(null);

  /* Ref to track whether hedge calc has been auto-run for the current company load */
  const hedgeAutoRanRef = useRef<string>("");

  /* ─── Data Loading ──────────────────────────────────────────── */

  useEffect(() => {
    const sf = async (url: string) => {
      try {
        const r = await fetch(url);
        return r.ok ? r.json() : null;
      } catch { return null; }
    };
    async function load() {
      try {
        const dash = await sf("/api/fx/dashboard");
        if (dash) {
          setRateCards(dash.rateCards || []);
          setNokIndex(dash.nokIndex || []);
          setNokIndexCurrent(dash.nokIndexCurrent || null);
          setRegimes(dash.regimes || {});
          setCorrelationMatrix(dash.correlationMatrix || {});
          setExposureHeatmap(dash.exposureHeatmap || []);
          setFundingRegimes(dash.fundingRegimes || []);
        }
        setLoading(false);

        // Load supplementary: all tickers' regression data for sensitivity table
        if (dash?.exposureHeatmap) {
          const sensTickers = dash.exposureHeatmap.map((r: ExposureHeatmapRow) => r.ticker);
          const sensRows: SensitivityRow[] = [];
          // Fetch regression for each ticker (batch)
          for (const t of sensTickers) {
            const d = await sf(`/api/fx/sensitivity/${t}`);
            if (d?.statistical) {
              sensRows.push({
                ticker: t,
                betaMarket: d.statistical.betaMarket,
                betaUsd: d.statistical.betaUsd,
                betaEur: d.statistical.betaEur,
                betaGbp: d.statistical.betaGbp,
                betaSek: d.statistical.betaSek,
                tstatUsd: d.statistical.tstatUsd,
                tstatEur: d.statistical.tstatEur,
                tstatGbp: d.statistical.tstatGbp,
                tstatSek: d.statistical.tstatSek,
                rSquared: d.statistical.rSquared,
                rSquaredFxOnly: d.statistical.rSquaredFxOnly,
              });
            }
          }
          setAllSensitivity(sensRows);
        }

        // Load interest rates
        const irData = await sf("/api/fx/interest-rates");
        if (irData?.currencies) setInterestRates(irData.currencies);

      } catch (err: any) {
        setError(err.message);
        setLoading(false);
      }
    }
    load();
  }, []);

  /* Load company detail when ticker changes — auto-run hedge calc */
  useEffect(() => {
    if (tab !== "company" || !companyTicker) return;
    const sf = async (url: string) => {
      try { const r = await fetch(url); return r.ok ? r.json() : null; } catch { return null; }
    };
    async function loadCompany() {
      const [sens, exp, fwd] = await Promise.all([
        sf(`/api/fx/sensitivity/${companyTicker}`),
        sf(`/api/fx/exposure/${companyTicker}`),
        sf(`/api/fx/rates/forward?pair=NOK${hedgeCurrency}`),
      ]);
      setCompanyData({ sensitivity: sens, exposure: exp });
      if (fwd) setForwardData(fwd);
      // Auto-run hedge calculator after loading data
      hedgeAutoRanRef.current = `${companyTicker}-${hedgeCurrency}`;
      try {
        const r = await fetch("/api/fx/hedge-calculator", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ticker: companyTicker,
            notional: hedgeNotional,
            hedgeRatio: hedgeRatio / 100,
            tenor: hedgeTenor,
            currency: hedgeCurrency,
          }),
        });
        if (r.ok) setHedgeResult(await r.json());
      } catch {}
    }
    loadCompany();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, companyTicker, hedgeCurrency]);

  /* Load sensitivity detail */
  useEffect(() => {
    if (!selectedSensTicker) return;
    const sf = async (url: string) => {
      try { const r = await fetch(url); return r.ok ? r.json() : null; } catch { return null; }
    };
    sf(`/api/fx/sensitivity/${selectedSensTicker}`).then(setSensDetail);
  }, [selectedSensTicker]);

  /* Load forwards tab data */
  useEffect(() => {
    if (tab !== "forwards") return;
    const sf = async (url: string) => {
      try { const r = await fetch(url); return r.ok ? r.json() : null; } catch { return null; }
    };
    async function loadForwards() {
      const [fwd, carry] = await Promise.all([
        sf(`/api/fx/rates/forward?pair=${fwdPair}`),
        sf(`/api/fx/carry?pair=${fwdPair}&days=252`),
      ]);
      if (fwd) setFwdForwards(fwd.forwards || []);
      if (carry) setCarryData(carry);
    }
    loadForwards();
  }, [tab, fwdPair]);

  /* Load CIP cross-currency basis series */
  useEffect(() => {
    if (tab !== "forwards") return;
    const sf = async (url: string) => {
      try { const r = await fetch(url); return r.ok ? r.json() : null; } catch { return null; }
    };
    setBasisData(null);
    sf(`/api/fx/basis?pair=${basisPair}&tenor=${basisTenor}`).then(setBasisData);
  }, [tab, basisPair, basisTenor]);

  /* Load CIP arb monitor */
  useEffect(() => {
    if (tab !== "forwards") return;
    const sf = async (url: string) => {
      try { const r = await fetch(url); return r.ok ? r.json() : null; } catch { return null; }
    };
    sf(`/api/fx/arb-monitor?tenor=${arbTenor}`).then(setArbData);
  }, [tab, arbTenor]);

  /* Pairs trading: build fetch URL including friction params */
  const pairsFetchUrl = useMemo(() => {
    const [pY, pX] = pairsSelectedPair.split("_");
    const totalCostBps = (pairsBidAskBps * 2 + pairsSlippageBps + pairsCommBps).toFixed(1);
    return `/api/fx/pairs-trade?pairY=${pY}&pairX=${pX}&delta=0.00001&ve=0.001&days=${pairsDays}&pos=${pairsPosSize}&cost=${totalCostBps}&entryz=${pairsEntryZ}&exitz=${pairsExitZ}&stopz=${pairsStopZ}`;
  }, [pairsSelectedPair, pairsDays, pairsPosSize, pairsBidAskBps, pairsSlippageBps, pairsCommBps, pairsEntryZ, pairsExitZ, pairsStopZ]);

  /* Pairs trading: load dataset when tab opens, pair changes, or friction params change */
  useEffect(() => {
    if (tab !== "pairs") return;
    setPairsIsPlaying(false);
    setPairsDataLoading(true);
    // Keep old data visible while loading — don't blank it
    const ctrl = new AbortController();
    fetch(pairsFetchUrl, { signal: ctrl.signal })
      .then(r => r.json())
      .then(d => {
        if (!d.error) {
          setPairsData(d);
          setPairsPlayIdx(-1); // blank slate — user must press PLAY
        }
      })
      .catch(() => {})
      .finally(() => setPairsDataLoading(false));
    return () => ctrl.abort();
  }, [tab, pairsFetchUrl]);

  /* Pairs trading: playback engine */
  useEffect(() => {
    if (pairsIntervalRef.current) clearInterval(pairsIntervalRef.current);
    if (!pairsIsPlaying || !pairsData) return;
    pairsIntervalRef.current = setInterval(() => {
      setPairsPlayIdx(prev => {
        const next = prev + pairsSpeed;
        if (next >= (pairsData.series?.length ?? 0) - 1) {
          setPairsIsPlaying(false);
          return (pairsData.series?.length ?? 1) - 1;
        }
        return next;
      });
    }, 80);
    return () => { if (pairsIntervalRef.current) clearInterval(pairsIntervalRef.current); };
  }, [pairsIsPlaying, pairsSpeed, pairsData]);

  /* Load saved portfolio configs when logged in and on portfolio tab */
  useEffect(() => {
    if (tab !== "portfolio" || !token) return;
    setConfigsLoading(true);
    fetch("/api/portfolio/configs", {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => {
        if (r.status === 401) { authLogout(); return null; }
        return r.ok ? r.json() : null;
      })
      .then(data => {
        if (data?.configs) setSavedConfigs(data.configs);
        setConfigsLoading(false);
      })
      .catch(() => setConfigsLoading(false));
  }, [tab, token, authLogout]);

  /* Hedge calculator */
  const runHedge = useCallback(async () => {
    setQeWarningDismissed(false);
    try {
      const r = await fetch("/api/fx/hedge-calculator", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticker: companyTicker,
          notional: hedgeNotional,
          hedgeRatio: hedgeRatio / 100,
          tenor: hedgeTenor,
          currency: hedgeCurrency,
        }),
      });
      if (r.ok) setHedgeResult(await r.json());
    } catch {}
  }, [companyTicker, hedgeNotional, hedgeRatio, hedgeTenor, hedgeCurrency]);

  /* Portfolio analysis */
  const runPortfolio = useCallback(async () => {
    setPfLoading(true);
    try {
      const tickers = pfTickers.split(",").map(t => t.trim()).filter(Boolean);
      const weights = pfWeights.split(",").map(w => parseFloat(w.trim())).filter(w => !isNaN(w));
      const r = await fetch("/api/fx/portfolio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tickers, weights }),
      });
      if (r.ok) setPfResult(await r.json());
    } catch {}
    setPfLoading(false);
  }, [pfTickers, pfWeights]);

  /* Portfolio login */
  async function handlePortfolioLogin() {
    setAuthLoading(true);
    setAuthError("");
    try {
      const res = await fetch("/api/portfolio/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: authUser, password: authPass }),
      });
      if (res.ok) {
        const data = await res.json();
        authLogin(data.token, data.profile);
        setShowLoginModal(false);
        setAuthUser("");
        setAuthPass("");
      } else {
        setAuthError("Invalid credentials");
      }
    } catch {
      setAuthError("Connection error");
    }
    setAuthLoading(false);
  }

  /* Select a saved portfolio config */
  function selectConfig(cfg: PortfolioConfig) {
    setSelectedConfigId(cfg.id);
    const tStr = cfg.tickers.join(",");
    const wStr = cfg.weights.map(w => w.toFixed(4)).join(",");
    setPfTickers(tStr);
    setPfWeights(wStr);
    setPfResult(null);
  }

  /* Sorted sensitivity */
  const sortedSensitivity = useMemo(() => {
    const arr = [...allSensitivity];
    const { col, asc } = sensSort;
    return arr.sort((a, b) => {
      let va: number, vb: number;
      if (col === "betaFxTotal") {
        va = Math.abs(a.betaUsd) + Math.abs(a.betaEur) + Math.abs(a.betaGbp) + Math.abs(a.betaSek);
        vb = Math.abs(b.betaUsd) + Math.abs(b.betaEur) + Math.abs(b.betaGbp) + Math.abs(b.betaSek);
      } else {
        va = (a as any)[col] ?? 0;
        vb = (b as any)[col] ?? 0;
      }
      return asc ? va - vb : vb - va;
    });
  }, [allSensitivity, sensSort]);

  /* Sorted exposure heatmap */
  const sortedExposure = useMemo(() => {
    const arr = [...exposureHeatmap];
    const { col, asc } = expSort;
    return arr.sort((a, b) => {
      const va = col === "ticker" ? a.ticker : (a as any)[col] ?? 0;
      const vb = col === "ticker" ? b.ticker : (b as any)[col] ?? 0;
      if (typeof va === "string") return asc ? va.localeCompare(vb as string) : (vb as string).localeCompare(va);
      return asc ? (va as number) - (vb as number) : (vb as number) - (va as number);
    });
  }, [exposureHeatmap, expSort]);

  /* Dashboard insights generation */
  const dashboardInsights = useMemo(() => {
    const insights: { label: string; detail: string; color: string }[] = [];

    // NOK trend vs EUR (most important for OSE)
    const eurCard = rateCards.find(r => r.pair === "NOKEUR");
    if (eurCard?.change1m != null) {
      const dir = eurCard.change1m > 0 ? "strengthening" : "weakening";
      insights.push({
        label: `NOK ${dir} vs EUR`,
        detail: `${fmtPct(eurCard.change1m, 1)} over 1M`,
        color: eurCard.change1m > 0 ? "#10b981" : "#ef4444",
      });
    }

    // USD vol
    const usdCard = rateCards.find(r => r.pair === "NOKUSD");
    if (usdCard?.vol20d != null && usdCard.vol63d != null) {
      const elevated = usdCard.vol20d > usdCard.vol63d * 1.2;
      if (elevated) {
        insights.push({ label: "USD vol elevated", detail: `20D: ${usdCard.vol20d.toFixed(1)}% vs 63D: ${usdCard.vol63d.toFixed(1)}%`, color: "#FF9800" });
      } else {
        insights.push({ label: "USD vol subdued", detail: `20D: ${usdCard.vol20d.toFixed(1)}% vs 63D: ${usdCard.vol63d.toFixed(1)}%`, color: "#2196F3" });
      }
    }

    // Biggest mover (1D)
    const sorted1d = [...rateCards].filter(r => r.change1d != null).sort((a, b) => Math.abs(b.change1d!) - Math.abs(a.change1d!));
    if (sorted1d.length > 0) {
      const top = sorted1d[0];
      const ccy = top.pair.replace("NOK", "");
      insights.push({
        label: `${ccy} biggest 1D move`,
        detail: fmtPct(top.change1d, 2),
        color: changeColor(top.change1d),
      });
    }

    // Rate differential hint
    if (usdCard?.spot != null && eurCard?.spot != null) {
      insights.push({
        label: "Carry advantage",
        detail: "NOK rates above USD/EUR - positive carry on FX hedges",
        color: "#10b981",
      });
    }

    return insights;
  }, [rateCards]);

  /* Key metrics for dashboard */
  const keyMetrics = useMemo(() => {
    const validCards = rateCards.filter(r => r.change1m != null);
    if (validCards.length === 0) return null;

    const strongest = [...validCards].sort((a, b) => (b.change1m ?? 0) - (a.change1m ?? 0))[0];
    const weakest = [...validCards].sort((a, b) => (a.change1m ?? 0) - (b.change1m ?? 0))[0];
    const highVol = [...rateCards].filter(r => r.vol20d != null).sort((a, b) => (b.vol20d ?? 0) - (a.vol20d ?? 0))[0];
    const lowVol = [...rateCards].filter(r => r.vol20d != null).sort((a, b) => (a.vol20d ?? 0) - (b.vol20d ?? 0))[0];

    return { strongest, weakest, highVol, lowVol };
  }, [rateCards]);

  /* "What to Watch" insights from data */
  const whatToWatch = useMemo(() => {
    const items: string[] = [];

    // Highest net USD exposure
    const usdSorted = [...exposureHeatmap].sort((a, b) => Math.abs(b.usd) - Math.abs(a.usd));
    if (usdSorted.length > 0) {
      const top = usdSorted[0];
      items.push(`Highest net USD exposure: ${top.ticker} (${(top.usd * 100).toFixed(0)}%) -- most sensitive to NOK/USD moves`);
    }

    // Most FX-sensitive stock
    if (allSensitivity.length > 0) {
      const fxSorted = [...allSensitivity].sort((a, b) => {
        const totA = Math.abs(a.betaUsd) + Math.abs(a.betaEur) + Math.abs(a.betaGbp) + Math.abs(a.betaSek);
        const totB = Math.abs(b.betaUsd) + Math.abs(b.betaEur) + Math.abs(b.betaGbp) + Math.abs(b.betaSek);
        return totB - totA;
      });
      const top = fxSorted[0];
      const total = (Math.abs(top.betaUsd) + Math.abs(top.betaEur) + Math.abs(top.betaGbp) + Math.abs(top.betaSek)).toFixed(3);
      items.push(`Most FX-sensitive stock: ${top.ticker} (|FX beta| = ${total}) -- significant currency risk in returns`);
    }

    // NOK TWI trend
    if (nokIndex.length > 20) {
      const recent = nokIndex.slice(-20);
      const first = recent[0].index;
      const last = recent[recent.length - 1].index;
      const change = ((last - first) / first) * 100;
      const dir = change > 0 ? "appreciating" : "depreciating";
      items.push(`NOK TWI ${dir} over 20D (${change >= 0 ? "+" : ""}${change.toFixed(2)}%) -- monitor for trend reversal or continuation`);
    }

    // EUR exposure concentration
    const eurSorted = [...exposureHeatmap].filter(r => Math.abs(r.eur) > 0.1);
    if (eurSorted.length >= 3) {
      items.push(`${eurSorted.length} stocks have >10% EUR exposure -- sector-wide risk if EUR/NOK moves sharply`);
    }

    return items;
  }, [exposureHeatmap, allSensitivity, nokIndex]);

  /* ─── Loading / Error ──────────────────────────────────────── */

  if (loading) {
    return (
      <div style={S.page}>
        <div style={{ ...S.header, textAlign: "center", paddingTop: 80 }}>
          <div style={{ ...S.title, color: "#3b82f6" }}>FX TERMINAL</div>
          <div style={{ ...S.subtitle, marginTop: 20 }}>Loading currency data...</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={S.page}>
        <div style={{ ...S.header, textAlign: "center", paddingTop: 80 }}>
          <div style={{ ...S.title, color: "#ef4444" }}>Error</div>
          <div style={{ ...S.subtitle, marginTop: 10 }}>{error}</div>
          <Link href="/" style={{ color: "#3b82f6", marginTop: 20, display: "inline-block", textDecoration: "none", fontFamily: "monospace", fontSize: 12 }}>Home</Link>
        </div>
      </div>
    );
  }

  /* ─── TABS ─────────────────────────────────────────────────── */

  const TABS: { key: Tab; label: string }[] = [
    { key: "dashboard", label: "DASHBOARD" },
    { key: "sensitivity", label: "SENSITIVITY" },
    { key: "company", label: "COMPANY" },
    { key: "portfolio", label: "PORTFOLIO" },
    { key: "forwards", label: "FORWARDS" },
    { key: "pairs", label: "PAIRS TRADING" },
  ];

  return (
    <div style={S.page}>
      {/* Header */}
      <div style={S.header}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", minWidth: 0 }}>
          <PageNav crumbs={[{ label: "Home", href: "/" }, { label: "FX Terminal" }]} />
          <span style={{ width: 6, flexShrink: 0 }} />
          {nokIndexCurrent && (
            <span style={{ ...S.badge, background: "rgba(59,130,246,0.15)", color: "#3b82f6", flexShrink: 0 }}>
              NOK TWI: {nokIndexCurrent.index.toFixed(2)} ({fmtPct(nokIndexCurrent.change1d)})
            </span>
          )}
          {profile && (
            <span style={{ fontSize: 10, fontFamily: "monospace", fontWeight: 600, padding: "2px 8px", background: "rgba(59,130,246,0.1)", borderRadius: 3, border: "1px solid rgba(59,130,246,0.2)", color: "#3b82f6", marginLeft: "auto", flexShrink: 0 }}>
              {profile}
            </span>
          )}
        </div>
        <div style={S.subtitle}>Multi-currency risk analytics for NOK portfolios</div>
      </div>

      {/* Tab bar */}
      <div style={S.tabs}>
        {TABS.map(t => (
          <button key={t.key} style={tabBtn(tab === t.key)} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={S.content}>
        <style>{`@keyframes fx-fade-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } } .fx-tab { animation: fx-fade-in 0.25s ease-out; }`}</style>
        {tab === "dashboard" && <div key="dashboard" className="fx-tab">{renderDashboard()}</div>}
        {tab === "sensitivity" && <div key="sensitivity" className="fx-tab">{renderSensitivity()}</div>}
        {tab === "company" && <div key="company" className="fx-tab">{renderCompany()}</div>}
        {tab === "portfolio" && <div key="portfolio" className="fx-tab">{renderPortfolio()}</div>}
        {tab === "forwards" && <div key="forwards" className="fx-tab">{renderForwards()}</div>}
        {tab === "pairs" && <div key="pairs" className="fx-tab">{renderPairs()}</div>}
      </div>
    </div>
  );

  /* ================================================================ */
  /* TAB 1: DASHBOARD                                                  */
  /* ================================================================ */

  function renderDashboard() {
    return (
      <>
        {/* Market Summary */}
        {dashboardInsights.length > 0 && (
          <div style={{ ...S.card, background: "#0d1117", border: "1px solid #21262d", marginBottom: 16, boxSizing: "border-box" as const }}>
            <div style={{ ...S.cardTitle, color: "#3b82f6", fontSize: 12, marginBottom: 10 }}>MARKET SUMMARY</div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", minWidth: 0 }}>
              {dashboardInsights.map((ins, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 12px", background: "#0d1117", borderRadius: 4, border: "1px solid #21262d", minWidth: 0, maxWidth: "100%", boxSizing: "border-box" as const }}>
                  <div style={{ width: 6, height: 6, borderRadius: "50%", background: ins.color, flexShrink: 0 }} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "#fff", wordBreak: "break-word" as const }}>{ins.label}</div>
                    <div style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", wordBreak: "break-word" as const }}>{ins.detail}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Rate strip */}
        <div style={S.grid5}>
          {rateCards.map((rc) => (
            <div key={rc.pair} style={S.card}>
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", letterSpacing: 1, marginBottom: 4 }}>
                {PAIR_LABELS[rc.pair] || rc.pair}
              </div>
              <div style={{ fontSize: 18, fontWeight: 700, color: "#fff" }}>
                {fmtRate(rc.spot)}
              </div>
              <div style={{ fontSize: 11, color: changeColor(rc.change1d), marginTop: 2 }}>
                {fmtPct(rc.change1d)} <span style={{ color: "rgba(255,255,255,0.35)" }}>1D</span>
              </div>
              <div style={{ display: "flex", gap: 8, fontSize: 10, color: "rgba(255,255,255,0.4)", marginTop: 4, flexWrap: "wrap" }}>
                <span>1W: <span style={{ color: changeColor(rc.change1w) }}>{fmtPct(rc.change1w, 1)}</span></span>
                <span>1M: <span style={{ color: changeColor(rc.change1m) }}>{fmtPct(rc.change1m, 1)}</span></span>
                <span>YTD: <span style={{ color: changeColor(rc.changeYtd) }}>{fmtPct(rc.changeYtd, 1)}</span></span>
              </div>
              <div style={{ marginTop: 6 }}>
                <Sparkline
                  data={rc.sparkline.map(s => s.rate)}
                  color={CCY_COLORS[rc.pair.replace("NOK", "")] || "#3b82f6"}
                  width={120}
                  height={28}
                />
              </div>
              <div style={{ display: "flex", gap: 8, fontSize: 9, color: "rgba(255,255,255,0.35)", marginTop: 4 }}>
                <span>&sigma;20D: {rc.vol20d != null ? `${rc.vol20d.toFixed(1)}%` : "\u2014"}</span>
                <span>&sigma;63D: {rc.vol63d != null ? `${rc.vol63d.toFixed(1)}%` : "\u2014"}</span>
              </div>
            </div>
          ))}
        </div>

        {/* Key Metrics row */}
        {keyMetrics && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10, marginBottom: 12 }}>
            {[
              { label: "STRONGEST (1M)", pair: keyMetrics.strongest?.pair, value: keyMetrics.strongest?.change1m, color: "#10b981" },
              { label: "WEAKEST (1M)", pair: keyMetrics.weakest?.pair, value: keyMetrics.weakest?.change1m, color: "#ef4444" },
              { label: "HIGHEST VOL", pair: keyMetrics.highVol?.pair, value: keyMetrics.highVol?.vol20d, color: "#FF9800", suffix: "%" },
              { label: "LOWEST VOL", pair: keyMetrics.lowVol?.pair, value: keyMetrics.lowVol?.vol20d, color: "#2196F3", suffix: "%" },
            ].map((m) => (
              <div key={m.label} style={{ ...S.card, padding: 12 }}>
                <div style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", letterSpacing: 1 }}>{m.label}</div>
                <div style={{ fontSize: 11, color: m.color, fontWeight: 600, marginTop: 2 }}>
                  {m.pair ? (PAIR_LABELS[m.pair] || m.pair.replace("NOK", "")) : "\u2014"}
                </div>
                <div style={{ fontSize: 16, fontWeight: 700, color: "#fff", marginTop: 2 }}>
                  {m.value != null ? (m.suffix ? `${m.value.toFixed(1)}${m.suffix}` : fmtPct(m.value, 2)) : "\u2014"}
                </div>
              </div>
            ))}
          </div>
        )}

        <div style={S.grid2}>
          {/* NOK TWI Chart — enhanced area chart */}
          <div style={S.card}>
            <div style={S.cardTitle}>NOK TRADE-WEIGHTED INDEX (90D)</div>
            {nokIndex.length > 2 ? (
              <AreaSparkline
                data={nokIndex.map(p => p.index)}
                width={500}
                height={140}
                color="#3b82f6"
              />
            ) : (
              <div style={S.dim}>No TWI data available</div>
            )}
          </div>

          {/* Cross-pair correlation matrix */}
          <div style={S.card}>
            <div style={S.cardTitle}>63-DAY CORRELATION MATRIX</div>
            {Object.keys(correlationMatrix).length > 0 ? (
              <div style={{ overflowX: "auto" }}>
              <table style={S.table}>
                <thead>
                  <tr>
                    <th style={S.th}></th>
                    {Object.keys(correlationMatrix).map(p => {
                      const label = p === "NOK" ? "NOK" : p.replace("NOK", "");
                      return (
                        <th key={p} style={{ ...S.th, textAlign: "center", color: CCY_COLORS[label] || "rgba(255,255,255,0.5)" }}>
                          {label}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(correlationMatrix).map(([p1, row]) => {
                    const label = p1 === "NOK" ? "NOK" : p1.replace("NOK", "");
                    return (
                    <tr key={p1}>
                      <td style={{ ...S.td, fontWeight: 600, color: CCY_COLORS[label] || "rgba(255,255,255,0.5)" }}>
                        {label}
                      </td>
                      {Object.values(row).map((v, i) => (
                        <td
                          key={i}
                          style={{
                            ...S.td,
                            textAlign: "center",
                            background: `rgba(59,130,246,${Math.abs(v as number) * 0.3})`,
                            color: "#fff",
                          }}
                        >
                          {(v as number).toFixed(2)}
                        </td>
                      ))}
                    </tr>
                    );
                  })}
                </tbody>
              </table>
              </div>
            ) : (
              <div style={S.dim}>No correlation data</div>
            )}
          </div>
        </div>

        {/* Pairs Trading Teaser */}
        <div style={{ ...S.card, border: "1px solid rgba(59,130,246,0.25)", background: "linear-gradient(135deg, rgba(59,130,246,0.04) 0%, rgba(16,185,129,0.04) 100%)", position: "relative" as const, overflow: "hidden" }}>
          {/* Background accent */}
          <div style={{ position: "absolute" as const, top: -30, right: -30, width: 160, height: 160, borderRadius: "50%", background: "radial-gradient(circle, rgba(59,130,246,0.07) 0%, transparent 70%)", pointerEvents: "none" as const }} />

          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", color: "rgba(255,255,255,0.35)" }}>NEW</div>
                <div style={{ fontSize: 13, fontWeight: 800, color: "#fff", letterSpacing: 1 }}>KALMAN PAIRS TRADING SIMULATOR</div>
              </div>
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.55)", lineHeight: 1.65, marginBottom: 14, maxWidth: 560 }}>
                Adaptive Kalman filter detects cointegration breakdowns between NOK-denominated FX pairs.
                Live z-score simulation with realistic friction parameters — backtest any pair combination over 5 years of Norges Bank data.
              </div>

              {/* Feature pills */}
              <div style={{ display: "flex", flexWrap: "wrap" as const, gap: 6, marginBottom: 16 }}>
                {[
                  { label: "Adaptive β hedge ratio", color: "#3b82f6" },
                  { label: "60-bar rolling z-score", color: "#3b82f6" },
                  { label: "Vol-targeted P&L", color: "#10b981" },
                  { label: "Live position monitor", color: "#10b981" },
                  { label: "Real-world friction sliders", color: "#f59e0b" },
                  { label: "5-year backtest", color: "#f59e0b" },
                ].map((f) => (
                  <div key={f.label} style={{ fontSize: 9, fontWeight: 600, letterSpacing: "0.06em", color: f.color, background: `${f.color}18`, border: `1px solid ${f.color}30`, borderRadius: 4, padding: "3px 8px" }}>
                    {f.label}
                  </div>
                ))}
              </div>

              {/* Mini stat row */}
              <div style={{ display: "flex", gap: 20 }}>
                {[
                  { label: "PAIRS AVAILABLE", value: "10" },
                  { label: "DATA HISTORY", value: "5Y" },
                  { label: "ENTRY SIGNAL", value: `±${pairsEntryZ}σ` },
                  { label: "COST MODEL", value: "Realistic bps" },
                ].map((s) => (
                  <div key={s.label}>
                    <div style={{ fontSize: 8, color: "rgba(255,255,255,0.3)", letterSpacing: "0.08em", marginBottom: 2 }}>{s.label}</div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#fff", fontFamily: "monospace" }}>{s.value}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* CTA button */}
            <div style={{ flexShrink: 0, display: "flex", alignItems: "center" }}>
              <button
                onClick={() => setTab("pairs")}
                style={{ background: "linear-gradient(135deg, #3b82f6, #2563eb)", color: "#fff", border: "none", borderRadius: 7, padding: "12px 22px", fontSize: 12, fontWeight: 800, letterSpacing: 1, cursor: "pointer", fontFamily: "monospace", whiteSpace: "nowrap" as const, boxShadow: "0 0 20px rgba(59,130,246,0.3)" }}
              >
                ▶ OPEN SIMULATOR
              </button>
            </div>
          </div>
        </div>

        {/* Exposure heatmap */}
        <div style={S.card}>
          <div style={S.cardTitle}>OSE FX EXPOSURE HEATMAP (NET REVENUE - COST)</div>
          {sortedExposure.length > 0 ? (
            <div style={{ overflowX: "auto" as const }}>
            <table style={S.table}>
              <thead>
                <tr>
                  <SortHeader label="TICKER" col="ticker" sort={expSort} onSort={(c) => setExpSort(p => ({ col: c, asc: p.col === c ? !p.asc : true }))} />
                  <SortHeader label="USD" col="usd" sort={expSort} onSort={(c) => setExpSort(p => ({ col: c, asc: p.col === c ? !p.asc : false }))} />
                  <SortHeader label="EUR" col="eur" sort={expSort} onSort={(c) => setExpSort(p => ({ col: c, asc: p.col === c ? !p.asc : false }))} />
                  <SortHeader label="GBP" col="gbp" sort={expSort} onSort={(c) => setExpSort(p => ({ col: c, asc: p.col === c ? !p.asc : false }))} />
                  <SortHeader label="SEK" col="sek" sort={expSort} onSort={(c) => setExpSort(p => ({ col: c, asc: p.col === c ? !p.asc : false }))} />
                </tr>
              </thead>
              <tbody>
                {sortedExposure.map((row) => (
                  <tr
                    key={row.ticker}
                    style={{ cursor: "pointer" }}
                    onClick={() => { setCompanyTicker(row.ticker); setTab("company"); }}
                  >
                    <td style={{ ...S.td, fontWeight: 600, color: "#3b82f6" }}>{row.ticker}</td>
                    {(["usd", "eur", "gbp", "sek"] as const).map((ccy) => (
                      <td
                        key={ccy}
                        style={{
                          ...S.td,
                          textAlign: "center",
                          background: exposureColor(row[ccy]),
                          color: row[ccy] > 0 ? "#10b981" : row[ccy] < 0 ? "#ef4444" : "rgba(255,255,255,0.4)",
                          fontWeight: 600,
                        }}
                      >
                        {(row[ccy] * 100).toFixed(0)}%
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          ) : (
            <div style={S.dim}>Run seed-fx-exposures.ts to populate</div>
          )}
        </div>
      </>
    );
  }

  /* ================================================================ */
  /* TAB 2: SENSITIVITY ENGINE                                         */
  /* ================================================================ */

  function renderSensitivity() {
    return (
      <>
        <div style={S.card}>
          <div style={S.cardTitle}>MULTI-CURRENCY FX BETAS (252D ROLLING REGRESSION)</div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", marginBottom: 6 }}>
            How sensitive is each stock to currency moves? Click a row for detailed breakdown.
          </div>
          {sortedSensitivity.length > 0 ? (
            <div style={{ overflowX: "auto" }}>
            <table style={S.table}>
              <thead>
                <tr>
                  <SortHeader label="TICKER" col="ticker" sort={sensSort} onSort={(c) => setSensSort(p => ({ col: c, asc: p.col === c ? !p.asc : true }))} />
                  <SortHeader label="FX SENSITIVITY" col="betaFxTotal" sort={sensSort} onSort={(c) => setSensSort(p => ({ col: c, asc: p.col === c ? !p.asc : false }))} />
                  <SortHeader label="MARKET" col="betaMarket" sort={sensSort} onSort={(c) => setSensSort(p => ({ col: c, asc: p.col === c ? !p.asc : false }))} />
                  <SortHeader label="USD" col="betaUsd" sort={sensSort} onSort={(c) => setSensSort(p => ({ col: c, asc: p.col === c ? !p.asc : false }))} />
                  <SortHeader label="EUR" col="betaEur" sort={sensSort} onSort={(c) => setSensSort(p => ({ col: c, asc: p.col === c ? !p.asc : false }))} />
                  <SortHeader label="GBP" col="betaGbp" sort={sensSort} onSort={(c) => setSensSort(p => ({ col: c, asc: p.col === c ? !p.asc : false }))} />
                  <SortHeader label="SEK" col="betaSek" sort={sensSort} onSort={(c) => setSensSort(p => ({ col: c, asc: p.col === c ? !p.asc : false }))} />
                  <SortHeader label="FIT" col="rSquared" sort={sensSort} onSort={(c) => setSensSort(p => ({ col: c, asc: p.col === c ? !p.asc : false }))} />
                  <SortHeader label="FX FIT" col="rSquaredFxOnly" sort={sensSort} onSort={(c) => setSensSort(p => ({ col: c, asc: p.col === c ? !p.asc : false }))} />
                </tr>
              </thead>
              <tbody>
                {sortedSensitivity.map((row) => {
                  const exp = exposureHeatmap.find((e) => e.ticker === row.ticker);
                  const chkUsd = sigStarChecked(row.tstatUsd, exp?.usd);
                  const chkEur = sigStarChecked(row.tstatEur, exp?.eur);
                  const chkGbp = sigStarChecked(row.tstatGbp, exp?.gbp);
                  const chkSek = sigStarChecked(row.tstatSek, exp?.sek);
                  return (
                  <tr
                    key={row.ticker}
                    style={{ cursor: "pointer", background: selectedSensTicker === row.ticker ? "rgba(59,130,246,0.08)" : undefined }}
                    onClick={() => setSelectedSensTicker(row.ticker)}
                  >
                    <td style={{ ...S.td, fontWeight: 600, color: "#3b82f6" }}>{row.ticker}</td>
                    <td style={{ ...S.td, textAlign: "center", fontWeight: 700 }}>
                      {(Math.abs(row.betaUsd) + Math.abs(row.betaEur) + Math.abs(row.betaGbp) + Math.abs(row.betaSek)).toFixed(3)}
                    </td>
                    <td style={S.td}>{row.betaMarket.toFixed(3)}</td>
                    <td style={{ ...S.td, color: CCY_COLORS.USD }}>
                      {row.betaUsd.toFixed(3)}{chkUsd.spurious ? <span title="Likely spurious — 0% fundamental exposure" style={{ opacity: 0.3 }}>{chkUsd.stars}</span> : chkUsd.stars}
                    </td>
                    <td style={{ ...S.td, color: CCY_COLORS.EUR }}>
                      {row.betaEur.toFixed(3)}{chkEur.spurious ? <span title="Likely spurious — 0% fundamental exposure" style={{ opacity: 0.3 }}>{chkEur.stars}</span> : chkEur.stars}
                    </td>
                    <td style={{ ...S.td, color: CCY_COLORS.GBP }}>
                      {row.betaGbp.toFixed(3)}{chkGbp.spurious ? <span title="Likely spurious — 0% fundamental exposure" style={{ opacity: 0.3 }}>{chkGbp.stars}</span> : chkGbp.stars}
                    </td>
                    <td style={{ ...S.td, color: CCY_COLORS.SEK }}>
                      {row.betaSek.toFixed(3)}{chkSek.spurious ? <span title="Likely spurious — 0% fundamental exposure" style={{ opacity: 0.3 }}>{chkSek.stars}</span> : chkSek.stars}
                    </td>
                    <td style={S.td}>{(row.rSquared * 100).toFixed(1)}%</td>
                    <td style={S.td}>{(row.rSquaredFxOnly * 100).toFixed(1)}%</td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
          ) : (
            <div style={S.dim}>Run calculate-fx-regressions.ts to populate regression data</div>
          )}

          {sortedSensitivity.length > 0 && (
            <HelpToggle id="sens-columns" label="Column guide" showHelp={showHelp} setShowHelp={setShowHelp}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "4px 24px" }}>
                <div><span style={{ color: "rgba(255,255,255,0.5)", fontWeight: 600 }}>FX SENSITIVITY</span> &mdash; Sum of absolute currency betas. Higher = more total FX exposure.</div>
                <div><span style={{ color: "rgba(255,255,255,0.5)", fontWeight: 600 }}>MARKET</span> &mdash; Beta vs OBX index. 1.0 = stock moves 1:1 with the market.</div>
                <div><span style={{ color: CCY_COLORS.USD, fontWeight: 600 }}>USD</span> / <span style={{ color: CCY_COLORS.EUR, fontWeight: 600 }}>EUR</span> / <span style={{ color: CCY_COLORS.GBP, fontWeight: 600 }}>GBP</span> / <span style={{ color: CCY_COLORS.SEK, fontWeight: 600 }}>SEK</span> &mdash; Sensitivity to each currency pair vs NOK. Positive = stock rises when NOK weakens.</div>
                <div><span style={{ color: "rgba(255,255,255,0.5)", fontWeight: 600 }}>FIT (R&sup2;)</span> &mdash; How much of the stock&apos;s movement is explained by market + currencies combined (0-100%).</div>
                <div><span style={{ color: "rgba(255,255,255,0.5)", fontWeight: 600 }}>FX FIT</span> &mdash; How much is explained by currencies alone, excluding the market factor.</div>
                <div><span style={{ color: "rgba(255,255,255,0.5)", fontWeight: 600 }}>Stars</span> &mdash; {"\u2605"} = likely real (95%), {"\u2605\u2605"} = strong (99%), {"\u2605\u2605\u2605"} = very strong (99.9%). No star = may be noise. <span style={{ opacity: 0.4 }}>Dimmed stars</span> = statistically significant but company has ~0% fundamental exposure in that currency (likely spurious correlation from multi-currency regression).</div>
              </div>
            </HelpToggle>
          )}
        </div>

        {/* Detail panel for selected ticker */}
        {selectedSensTicker && sensDetail && (
          <div style={S.card}>
            <div style={S.cardTitle}>{selectedSensTicker} &mdash; DETAILED FX SENSITIVITY</div>

            <HelpToggle id="sens-detail-intro" label="Statistical vs Fundamental — what's the difference?" showHelp={showHelp} setShowHelp={setShowHelp}>
              <strong style={{ color: "rgba(255,255,255,0.5)" }}>Statistical</strong> = how the stock price actually moves with currencies (regression on 252 trading days).
              <strong style={{ color: "rgba(255,255,255,0.5)" }}> Fundamental</strong> = where the company earns and spends money (from annual reports). Large gaps suggest active hedging or pricing power.
            </HelpToggle>
            <div style={S.grid2}>
              {/* Statistical betas */}
              {sensDetail.statistical && (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.5)", marginBottom: 6 }}>STATISTICAL (REGRESSION)</div>
                  <table style={S.table}>
                    <thead>
                      <tr>
                        <th style={S.th}>CURRENCY</th>
                        <th style={S.th}>BETA</th>
                        <th style={S.th}>T-STAT</th>
                        <th style={S.th}>SIG</th>
                      </tr>
                    </thead>
                    <tbody>
                      {["Market", "Usd", "Eur", "Gbp", "Sek"].map((c) => {
                        const beta = sensDetail.statistical[`beta${c}`];
                        const tstat = sensDetail.statistical[`tstat${c}`];
                        const detailExp = exposureHeatmap.find((e) => e.ticker === selectedSensTicker);
                        const fundExp = c === "Market" ? undefined : detailExp?.[c.toLowerCase() as "usd" | "eur" | "gbp" | "sek"];
                        const chk = c === "Market" ? { stars: sigStar(tstat || 0), spurious: false } : sigStarChecked(tstat || 0, fundExp);
                        return (
                          <tr key={c}>
                            <td style={{ ...S.td, color: CCY_COLORS[c.toUpperCase()] || "rgba(255,255,255,0.5)", fontWeight: 600 }}>
                              {c === "Market" ? "OBX" : c.toUpperCase()}
                            </td>
                            <td style={S.td}>{beta?.toFixed(4)}</td>
                            <td style={S.td}>{tstat?.toFixed(2)}</td>
                            <td style={S.td}>
                              {chk.spurious
                                ? <span title="Likely spurious — 0% fundamental exposure" style={{ opacity: 0.3 }}>{chk.stars} <span style={{ fontSize: 9 }}>?</span></span>
                                : chk.stars}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <div style={{ marginTop: 8, fontSize: 11, color: "rgba(255,255,255,0.4)" }}>
                    R&sup2;: {(sensDetail.statistical.rSquared * 100).toFixed(1)}% | R&sup2; FX only: {(sensDetail.statistical.rSquaredFxOnly * 100).toFixed(1)}%
                  </div>
                  <HelpToggle id="sens-stat-help" showHelp={showHelp} setShowHelp={setShowHelp}>
                    <strong style={{ color: "rgba(255,255,255,0.5)" }}>Beta</strong> = stock return per 1% currency move. <strong style={{ color: "rgba(255,255,255,0.5)" }}>T-stat</strong> = statistical reliability (higher is better, |t|&gt;2 is significant).
                    <strong style={{ color: "rgba(255,255,255,0.5)" }}> R&sup2;</strong> = % of stock variance explained. <strong style={{ color: "rgba(255,255,255,0.5)" }}>R&sup2; FX only</strong> = portion explained by currencies after removing market effect.
                  </HelpToggle>
                </div>
              )}

              {/* Fundamental exposure */}
              {sensDetail.fundamental && (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.5)", marginBottom: 6 }}>FUNDAMENTAL (ANNUAL REPORT)</div>
                  <table style={S.table}>
                    <thead>
                      <tr>
                        <th style={S.th}>CURRENCY</th>
                        <th style={S.th}>REVENUE</th>
                        <th style={S.th}>COST</th>
                        <th style={S.th}>NET</th>
                      </tr>
                    </thead>
                    <tbody>
                      {["usd", "eur", "gbp", "nok", "sek"].map((c) => (
                        <tr key={c}>
                          <td style={{ ...S.td, color: CCY_COLORS[c.toUpperCase()] || "rgba(255,255,255,0.5)", fontWeight: 600 }}>
                            {c.toUpperCase()}
                          </td>
                          <td style={S.td}>{(sensDetail.fundamental.revenue[c] * 100).toFixed(1)}%</td>
                          <td style={S.td}>{(sensDetail.fundamental.cost[c] * 100).toFixed(1)}%</td>
                          <td style={{ ...S.td, fontWeight: 600, color: (sensDetail.fundamental.revenue[c] - sensDetail.fundamental.cost[c]) > 0 ? "#10b981" : "#ef4444" }}>
                            {((sensDetail.fundamental.revenue[c] - sensDetail.fundamental.cost[c]) * 100).toFixed(1)}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div style={{ marginTop: 8, fontSize: 11, color: "rgba(255,255,255,0.4)" }}>
                    Source: {sensDetail.fundamental.source} | FY{sensDetail.fundamental.fiscalYear}
                  </div>
                  <HelpToggle id="sens-fund-help" showHelp={showHelp} setShowHelp={setShowHelp}>
                    <strong style={{ color: "rgba(255,255,255,0.5)" }}>Revenue</strong> = % of sales in each currency.
                    <strong style={{ color: "rgba(255,255,255,0.5)" }}> Cost</strong> = % of expenses in each currency.
                    <strong style={{ color: "rgba(255,255,255,0.5)" }}> Net</strong> = revenue minus cost &mdash; positive means a natural long position (weak NOK benefits earnings).
                  </HelpToggle>
                </div>
              )}
            </div>

            {/* ===== FX WEIGHTED EXPOSURE IMPACT CHART ===== */}
            {sensDetail.fundamental && (() => {
              // Only show currencies with meaningful net exposure
              const allCcys = ["usd", "eur", "gbp", "sek"] as const;
              const fxMoves = [-20, -15, -10, -5, 0, 5, 10, 15, 20];
              const series = allCcys
                .map((key) => {
                  const netExp = (sensDetail.fundamental.revenue[key] ?? 0) - (sensDetail.fundamental.cost[key] ?? 0);
                  return {
                    ccy: key.toUpperCase(),
                    color: CCY_COLORS[key.toUpperCase()] ?? "rgba(255,255,255,0.4)",
                    netExp,
                    // earnings impact % = net exposure (fraction) × FX move %
                    pts: fxMoves.map((m) => ({ x: m, y: netExp * m })),
                  };
                })
                .filter((s) => Math.abs(s.netExp) >= 0.01); // skip near-zero

              // Combined total impact
              const combinedPts = fxMoves.map((m, i) => ({ x: m, y: series.reduce((sum, s) => sum + s.pts[i].y, 0) }));

              const W = 600, H = 160, PL = 46, PR = 12, PT = 12, PB = 26;
              const cW = W - PL - PR, cH = H - PT - PB;
              const allVals = [...series.flatMap((s) => s.pts.map((p) => p.y)), ...combinedPts.map((p) => p.y)];
              const rawMin = Math.min(...allVals), rawMax = Math.max(...allVals);
              const pad = (rawMax - rawMin) * 0.12 || 0.5;
              const yMin = rawMin - pad, yMax = rawMax + pad;
              const toX = (v: number) => PL + ((v + 20) / 40) * cW;
              const toY = (v: number) => PT + (1 - (v - yMin) / (yMax - yMin)) * cH;
              const zeroY = toY(0);
              const curvePath = (pts: { x: number; y: number }[]) => {
                if (pts.length < 2) return "";
                let d = `M ${toX(pts[0].x)} ${toY(pts[0].y)}`;
                for (let i = 1; i < pts.length; i++) {
                  const x0 = toX(pts[i - 1].x), y0 = toY(pts[i - 1].y);
                  const x1 = toX(pts[i].x), y1 = toY(pts[i].y);
                  d += ` C ${x0 + (x1 - x0) / 3} ${y0} ${x1 - (x1 - x0) / 3} ${y1} ${x1} ${y1}`;
                }
                return d;
              };
              const fmtPct = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
              const hovered = sensChartMouse
                ? fxMoves.reduce((b, m) => Math.abs(m - sensChartMouse.pct) < Math.abs(b - sensChartMouse.pct) ? m : b, fxMoves[0])
                : null;
              const hovIdx = hovered !== null ? fxMoves.indexOf(hovered) : -1;
              const hvX = hovered !== null ? toX(hovered) : null;
              return (
                <div style={{ marginTop: 12, background: "#0d1117", borderRadius: 6, border: "1px solid #21262d", padding: "10px 12px 8px" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                    <div style={{ fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.4)", letterSpacing: "0.08em", textTransform: "uppercase" as const }}>
                      Earnings impact % — weighted FX exposure per currency move
                    </div>
                    <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                      {series.map((s) => (
                        <span key={s.ccy} style={{ fontSize: 8, color: s.color }}>
                          <span style={{ display: "inline-block", width: 7, height: 1.5, background: s.color, verticalAlign: "middle", marginRight: 2 }} />
                          {s.ccy} ({s.netExp >= 0 ? "+" : ""}{(s.netExp * 100).toFixed(1)}%)
                        </span>
                      ))}
                      <span style={{ fontSize: 8, color: "rgba(255,255,255,0.3)" }}>
                        <span style={{ display: "inline-block", width: 7, height: 1.5, background: "rgba(255,255,255,0.35)", verticalAlign: "middle", marginRight: 2, borderTop: "1px dashed rgba(255,255,255,0.35)" }} />Total
                      </span>
                    </div>
                  </div>
                  <svg
                    viewBox={`0 0 ${W} ${H}`}
                    style={{ width: "100%", display: "block", cursor: "crosshair" }}
                    onMouseMove={(e) => {
                      const rect = (e.currentTarget as SVGElement).getBoundingClientRect();
                      const svgX = ((e.clientX - rect.left) / rect.width) * W;
                      setSensChartMouse({ x: svgX, pct: -20 + ((svgX - PL) / cW) * 40 });
                    }}
                    onMouseLeave={() => setSensChartMouse(null)}
                  >
                    <defs><clipPath id="scClip"><rect x={PL} y={PT} width={cW} height={cH} /></clipPath></defs>

                    {/* Vertical grid + x-axis */}
                    {[-20, -10, 0, 10, 20].map((v) => (
                      <g key={v}>
                        <line x1={toX(v)} y1={PT} x2={toX(v)} y2={PT + cH} stroke="#1a1f27" strokeWidth={1} />
                        <text x={toX(v)} y={H - 4} textAnchor="middle" fill="rgba(255,255,255,0.2)" fontSize={7} fontFamily="monospace">{v > 0 ? `+${v}` : v}%</text>
                      </g>
                    ))}

                    {/* Zero line */}
                    {zeroY >= PT && zeroY <= PT + cH && (
                      <line x1={PL} y1={zeroY} x2={PL + cW} y2={zeroY} stroke="rgba(255,255,255,0.1)" strokeWidth={1} strokeDasharray="3 3" />
                    )}

                    {/* Y-axis labels */}
                    {[0.25, 0.5, 0.75].map((t, i) => {
                      const v = yMin + t * (yMax - yMin);
                      return <text key={i} x={PL - 3} y={toY(v) + 3} textAnchor="end" fill="rgba(255,255,255,0.2)" fontSize={7} fontFamily="monospace">{fmtPct(v)}</text>;
                    })}

                    {/* Per-currency lines */}
                    {series.map((s) => (
                      <path key={s.ccy} d={curvePath(s.pts)} fill="none" stroke={s.color} strokeWidth={1.5} clipPath="url(#scClip)" />
                    ))}

                    {/* Total combined line (dashed white) */}
                    <path d={curvePath(combinedPts)} fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth={1.2} strokeDasharray="4 2" clipPath="url(#scClip)" />

                    {/* Crosshair + tooltip */}
                    {hovered !== null && hvX !== null && hovIdx >= 0 && (() => {
                      const tipH = 26 + (series.length + 1) * 13;
                      const tipW = 140;
                      const tipX = hvX + 8 + tipW > W - PR ? hvX - tipW - 8 : hvX + 8;
                      const tipY = PT + 2;
                      return (
                        <>
                          <line x1={hvX} y1={PT} x2={hvX} y2={PT + cH} stroke="rgba(255,255,255,0.15)" strokeWidth={1} />
                          {series.map((s) => <circle key={s.ccy} cx={hvX} cy={toY(s.pts[hovIdx].y)} r={2.5} fill={s.color} />)}
                          <circle cx={hvX} cy={toY(combinedPts[hovIdx].y)} r={2} fill="rgba(255,255,255,0.5)" />
                          <rect x={tipX} y={tipY} width={tipW} height={tipH} rx={3} fill="#0d1117" stroke="#30363d" strokeWidth={0.8} />
                          <text x={tipX + 7} y={tipY + 12} fill="rgba(255,255,255,0.6)" fontSize={8} fontFamily="monospace" fontWeight={700}>
                            {hovered > 0 ? "+" : ""}{hovered}% move vs NOK
                          </text>
                          {series.map((s, i) => (
                            <text key={s.ccy} x={tipX + 7} y={tipY + 25 + i * 13} fill={s.color} fontSize={8} fontFamily="monospace">
                              {s.ccy}  {fmtPct(s.pts[hovIdx].y)} earnings
                            </text>
                          ))}
                          <text x={tipX + 7} y={tipY + 25 + series.length * 13} fill="rgba(255,255,255,0.5)" fontSize={8} fontFamily="monospace">
                            Total  {fmtPct(combinedPts[hovIdx].y)}
                          </text>
                        </>
                      );
                    })()}
                  </svg>
                  <div style={{ fontSize: 8, color: "rgba(255,255,255,0.18)", marginTop: 2 }}>
                    Net exposure (revenue − cost) × FX move % = estimated earnings impact. Source: {sensDetail.fundamental.source} FY{sensDetail.fundamental.fiscalYear}
                  </div>
                </div>
              );
            })()}

            {/* Divergence alerts */}
            {sensDetail.divergences?.length > 0 && (
              <div style={{ marginTop: 12, padding: 14, background: "rgba(59,130,246,0.06)", borderRadius: 4, border: "1px solid rgba(59,130,246,0.15)" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#3b82f6", marginBottom: 2 }}>STATISTICAL vs FUNDAMENTAL GAPS</div>
                <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginBottom: 10 }}>
                  Comparing how the stock actually moves with currencies (regression) vs what the company reports (annual report).
                  Difference = beta minus reported net exposure. A positive difference means the market sees more sensitivity than the company reports.
                </div>
                <table style={{ ...S.table, background: "transparent" }}>
                  <thead>
                    <tr>
                      <th style={{ ...S.th, width: 70 }}>CURRENCY</th>
                      <th style={S.th}>MARKET BETA</th>
                      <th style={S.th}>REPORTED NET</th>
                      <th style={S.th}>DIFFERENCE</th>
                      <th style={S.th}>ASSESSMENT</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sensDetail.divergences.map((d: any) => {
                      const diff = d.difference ?? (d.statistical - d.fundamental);
                      return (
                        <tr key={d.currency}>
                          <td style={{ ...S.td, color: CCY_COLORS[d.currency] || "rgba(255,255,255,0.5)", fontWeight: 600 }}>{d.currency}</td>
                          <td style={S.td}>{d.statistical >= 0 ? "+" : ""}{d.statistical.toFixed(3)}</td>
                          <td style={S.td}>{d.fundamental >= 0 ? "+" : ""}{(d.fundamental * 100).toFixed(1)}%</td>
                          <td style={{ ...S.td, fontWeight: 600, color: Math.abs(diff) > 0.3 ? "#ef4444" : "#3b82f6" }}>
                            {diff >= 0 ? "+" : ""}{diff.toFixed(3)}
                          </td>
                          <td style={{ ...S.td, fontSize: 10, color: "rgba(255,255,255,0.6)" }}>
                            {d.assessment || (Math.abs(d.statistical) < Math.abs(d.fundamental) ? "May be actively hedging" : "Market prices in more exposure")}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Rolling beta sparklines */}
            {sensDetail.rollingHistory?.length > 2 && (
              <div style={{ marginTop: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.5)", marginBottom: 2 }}>ROLLING BETAS (LAST 2Y)</div>
                <HelpToggle id="sens-rolling-help" showHelp={showHelp} setShowHelp={setShowHelp}>
                  How the currency sensitivity has changed over time. Stable lines = consistent exposure. Large swings = changing business mix, hedging changes, or regime shifts.
                </HelpToggle>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12 }}>
                  {(["Usd", "Eur", "Gbp", "Sek"] as const).map((c) => (
                    <div key={c}>
                      <div style={{ fontSize: 10, color: CCY_COLORS[c.toUpperCase()], marginBottom: 4 }}>{c.toUpperCase()}</div>
                      <Sparkline
                        data={sensDetail.rollingHistory.map((r: any) => r[`beta${c}`])}
                        color={CCY_COLORS[c.toUpperCase()]}
                        width={180}
                        height={40}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </>
    );
  }

  /* ================================================================ */
  /* TAB 3: COMPANY DEEP DIVE                                          */
  /* ================================================================ */

  function renderCompany() {
    const exp = companyData?.exposure?.detailed?.[0];
    const _sens = companyData?.sensitivity;

    return (
      <>
        {/* Ticker selector */}
        <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 16 }}>
          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.5)" }}>TICKER:</span>
          <select
            style={S.select}
            value={companyTicker}
            onChange={(e) => setCompanyTicker(e.target.value)}
          >
            {exposureHeatmap.map(r => (
              <option key={r.ticker} value={r.ticker}>{r.ticker}</option>
            ))}
          </select>
        </div>

        {exp ? (
          <>
            {/* Revenue / Cost waterfalls */}
            <div style={S.grid2}>
              <div style={S.card}>
                <div style={S.cardTitle}>REVENUE BY CURRENCY</div>
                {(["usd", "eur", "gbp", "nok", "sek", "other"] as const).map((c) => {
                  const pct = exp.revenue[c] * 100;
                  return (
                    <div key={c} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                      <span style={{ width: 40, fontSize: 10, color: CCY_COLORS[c.toUpperCase()] || "rgba(255,255,255,0.5)", fontWeight: 600 }}>{c.toUpperCase()}</span>
                      <div style={{ flex: 1, height: 16, background: "#0d1117", borderRadius: 2, overflow: "hidden" }}>
                        <div style={{
                          width: `${pct}%`,
                          height: "100%",
                          background: CCY_COLORS[c.toUpperCase()] || "rgba(255,255,255,0.35)",
                          opacity: 0.7,
                        }} />
                      </div>
                      <span style={{ width: 44, textAlign: "right", fontSize: 11 }}>{pct.toFixed(1)}%</span>
                    </div>
                  );
                })}
              </div>

              <div style={S.card}>
                <div style={S.cardTitle}>COST BY CURRENCY</div>
                {(["usd", "eur", "gbp", "nok", "sek", "other"] as const).map((c) => {
                  const pct = exp.cost[c] * 100;
                  return (
                    <div key={c} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                      <span style={{ width: 40, fontSize: 10, color: CCY_COLORS[c.toUpperCase()] || "rgba(255,255,255,0.5)", fontWeight: 600 }}>{c.toUpperCase()}</span>
                      <div style={{ flex: 1, height: 16, background: "#0d1117", borderRadius: 2, overflow: "hidden" }}>
                        <div style={{
                          width: `${pct}%`,
                          height: "100%",
                          background: CCY_COLORS[c.toUpperCase()] || "rgba(255,255,255,0.35)",
                          opacity: 0.5,
                        }} />
                      </div>
                      <span style={{ width: 44, textAlign: "right", fontSize: 11 }}>{pct.toFixed(1)}%</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Net exposure + EBITDA/EPS sensitivity */}
            <div style={S.grid2}>
              <div style={S.card}>
                <div style={S.cardTitle}>NET CURRENCY EXPOSURE</div>
                {(["usd", "eur", "gbp", "sek"] as const).map((c) => {
                  const net = exp.netExposure[c];
                  const pctAbs = Math.min(Math.abs(net) * 100, 50);
                  return (
                    <div key={c} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                      <span style={{ width: 40, fontSize: 10, color: CCY_COLORS[c.toUpperCase()], fontWeight: 600 }}>{c.toUpperCase()}</span>
                      <div style={{ flex: 1, height: 16, background: "#0d1117", borderRadius: 2, position: "relative", overflow: "hidden" }}>
                        <div style={{
                          position: "absolute",
                          left: net >= 0 ? "50%" : `${50 - pctAbs}%`,
                          width: `${pctAbs}%`,
                          height: "100%",
                          background: net >= 0 ? "#10b981" : "#ef4444",
                          opacity: 0.5,
                          borderRadius: 2,
                        }} />
                        <div style={{ position: "absolute", left: "50%", top: 0, width: 1, height: "100%", background: "#30363d" }} />
                      </div>
                      <span style={{ width: 54, textAlign: "right", fontSize: 11, color: net >= 0 ? "#10b981" : "#ef4444", fontWeight: 600 }}>
                        {net >= 0 ? "+" : ""}{(net * 100).toFixed(1)}%
                      </span>
                    </div>
                  );
                })}
              </div>

              <div style={S.card}>
                <div style={S.cardTitle}>EBITDA / EPS SENSITIVITY</div>
                <table style={S.table}>
                  <thead>
                    <tr>
                      <th style={S.th}>IF +10% MOVE</th>
                      <th style={S.th}>EBITDA IMPACT</th>
                      <th style={S.th}>EPS IMPACT</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(["Usd", "Eur", "Gbp"] as const).map((c) => (
                      <tr key={c}>
                        <td style={{ ...S.td, color: CCY_COLORS[c.toUpperCase()], fontWeight: 600 }}>
                          {c.toUpperCase()}/NOK +10%
                        </td>
                        <td style={{ ...S.td, color: exp.sensitivity[`ebitda${c}`] > 0 ? "#10b981" : "#ef4444" }}>
                          {fmtPct(exp.sensitivity[`ebitda${c}`] * 10, 1)}
                        </td>
                        <td style={{ ...S.td, color: exp.sensitivity[`eps${c}`] > 0 ? "#10b981" : "#ef4444" }}>
                          {fmtPct(exp.sensitivity[`eps${c}`] * 10, 1)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Forward rate panel */}
            {forwardData && (
              <div style={S.card}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={S.cardTitle}>FORWARD RATES &mdash; WHAT&apos;S PRICED IN</div>
                  <select style={S.select} value={hedgeCurrency} onChange={(e) => setHedgeCurrency(e.target.value)}>
                    <option value="USD">USD</option>
                    <option value="EUR">EUR</option>
                    <option value="GBP">GBP</option>
                    <option value="SEK">SEK</option>
                  </select>
                </div>
                <div style={{ overflowX: "auto" as const }}>
                <table style={S.table}>
                  <thead>
                    <tr>
                      <th style={S.th}>TENOR</th>
                      <th style={S.th}>SPOT</th>
                      <th style={S.th}>FORWARD</th>
                      <th style={S.th}>FWD PTS (BPS)</th>
                      <th style={S.th}>CARRY (ANN)</th>
                      <th style={S.th}>HEDGE COST</th>
                    </tr>
                  </thead>
                  <tbody>
                    {forwardData.forwards.map((f) => (
                      <tr key={f.tenor}>
                        <td style={{ ...S.td, fontWeight: 600 }}>{f.tenor}</td>
                        <td style={S.td}>{f.spot.toFixed(4)}</td>
                        <td style={S.td}>{f.forward.toFixed(4)}</td>
                        <td style={{ ...S.td, color: f.forwardPointsBps > 0 ? "#10b981" : "#ef4444" }}>
                          {f.forwardPointsBps >= 0 ? "+" : ""}{f.forwardPointsBps.toFixed(1)}
                        </td>
                        <td style={{ ...S.td, color: f.annualizedCarryPct > 0 ? "#10b981" : "#ef4444" }}>
                          {fmtPct(f.annualizedCarryPct, 2)}
                        </td>
                        <td style={S.td}>{fmtBps(f.hedgeCostBps)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              </div>
            )}

            {/* Hedge calculator */}
            <div style={S.card}>
              <div style={S.cardTitle}>HEDGE CALCULATOR &mdash; {companyTicker}</div>
              <div style={{ display: "flex", gap: 16, alignItems: "flex-end", marginBottom: 16, flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginBottom: 4 }}>TOTAL EXPOSURE (NOK)</div>
                  <input
                    type="number"
                    style={{ ...S.input, width: 140 }}
                    value={hedgeNotional}
                    onChange={(e) => setHedgeNotional(parseFloat(e.target.value) || 0)}
                  />
                </div>
                <div>
                  <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginBottom: 4 }}>HEDGE RATIO: {hedgeRatio}%</div>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={hedgeRatio}
                    onChange={(e) => setHedgeRatio(parseInt(e.target.value))}
                    style={{ ...S.slider, width: 200, maxWidth: "100%" }}
                  />
                </div>
                <div>
                  <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginBottom: 4 }}>TENOR</div>
                  <select style={S.select} value={hedgeTenor} onChange={(e) => setHedgeTenor(e.target.value)}>
                    <option value="1M">1M</option>
                    <option value="3M">3M</option>
                    <option value="6M">6M</option>
                    <option value="12M">12M</option>
                  </select>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginBottom: 4 }}>CURRENCY</div>
                  <select style={S.select} value={hedgeCurrency} onChange={(e) => setHedgeCurrency(e.target.value)}>
                    <option value="USD">USD</option>
                    <option value="EUR">EUR</option>
                    <option value="GBP">GBP</option>
                  </select>
                </div>
                <button style={S.button} onClick={runHedge}>CALCULATE</button>
              </div>

              {/* Quarter-end basis widening warning */}
              {hedgeResult?.quarterEndWarning?.crosses && !qeWarningDismissed && (() => {
                const qe = hedgeResult.quarterEndWarning;
                // Compute days dynamically so it stays current without recalculating
                const daysNow = qe.quarterEndDate
                  ? Math.round((new Date(qe.quarterEndDate).getTime() - Date.now()) / 86400000)
                  : qe.daysUntilQE;
                const [qeExpanded, setQeExpanded] = [
                  (showHelp["qe-warning"] ?? false),
                  (v: boolean) => setShowHelp(p => ({ ...p, "qe-warning": v })),
                ];
                return (
                  <div style={{ marginBottom: 16, background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.35)", borderRadius: 6, overflow: "hidden" }}>
                    {/* Collapsed header — always visible */}
                    <div
                      onClick={() => setQeExpanded(!qeExpanded)}
                      style={{ padding: "9px 14px", display: "flex", gap: 10, alignItems: "center", cursor: "pointer" }}
                    >
                      <span style={{ fontSize: 13, flexShrink: 0 }}>⚠</span>
                      <span style={{ fontSize: 11, fontWeight: 700, color: "#f59e0b", letterSpacing: "0.05em", flex: 1 }}>
                        QUARTER-END CROSSING — {qe.quarterEndLabel}
                        <span style={{ fontWeight: 400, color: "rgba(245,158,11,0.7)", marginLeft: 8 }}>{daysNow}d away</span>
                      </span>
                      <span style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", marginRight: 6 }}>{qeExpanded ? "▲ hide" : "▼ details"}</span>
                      <button
                        onClick={(e) => { e.stopPropagation(); setQeWarningDismissed(true); }}
                        style={{ background: "none", border: "none", color: "rgba(255,255,255,0.4)", cursor: "pointer", fontSize: 13, padding: 0, lineHeight: 1, flexShrink: 0 }}
                      >✕</button>
                    </div>
                    {/* Expanded body */}
                    {qeExpanded && (
                      <div style={{ padding: "0 14px 12px 37px", borderTop: "1px solid rgba(245,158,11,0.2)" }}>
                        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.7)", lineHeight: 1.6, paddingTop: 10 }}>
                          Banks compress balance sheets for regulatory reporting snapshots, historically widening the cross-currency basis by{" "}
                          <span style={{ color: "#f59e0b", fontWeight: 700 }}>
                            {qe.estimatedBasisWideningBps?.low}–{qe.estimatedBasisWideningBps?.high} bps
                          </span>{" "}
                          (median {qe.estimatedBasisWideningBps?.median} bps).
                        </div>
                        {qe.recommendation && (
                          <div style={{ marginTop: 6, fontSize: 10, color: "rgba(255,255,255,0.5)", lineHeight: 1.5 }}>
                            {qe.recommendation}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })()}

              {hedgeResult && (
                <div>
                  {/* ===== EXECUTION ORDER — What exactly to do ===== */}
                  {hedgeResult.execution && hedgeResult.execution.amountFCY > 0 && (
                    <div style={{ marginBottom: 16, padding: 16, background: "rgba(59,130,246,0.06)", borderRadius: 6, border: "1px solid rgba(59,130,246,0.2)" }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "#3b82f6", marginBottom: 10, letterSpacing: "0.05em" }}>
                        YOUR ORDER
                      </div>

                      {/* The one-line summary */}
                      <div style={{ fontSize: 15, fontWeight: 700, color: "#fff", marginBottom: 12, lineHeight: 1.5 }}>
                        <span style={{ color: hedgeResult.execution.action === "SELL" ? "#ef4444" : "#10b981" }}>
                          {hedgeResult.execution.actionVerb}
                        </span>{" "}
                        {hedgeCurrency}{" "}
                        {Math.round(hedgeResult.execution.amountFCY).toLocaleString("no-NO")}{" "}
                        forward at{" "}
                        <span style={{ color: "#3b82f6" }}>{hedgeResult.execution.forwardRate?.toFixed(4)}</span>{" "}
                        for {hedgeTenor} (settling {hedgeResult.execution.settlementDate})
                      </div>

                      {/* Contract details grid */}
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 8, marginBottom: 12 }}>
                        <div style={{ background: "#0d1117", borderRadius: 4, padding: "8px 12px", border: "1px solid #21262d" }}>
                          <div style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", letterSpacing: "0.05em" }}>YOU {hedgeResult.execution.action === "SELL" ? "DELIVER" : "RECEIVE"}</div>
                          <div style={{ fontSize: 14, fontWeight: 700, color: CCY_COLORS[hedgeCurrency] || "#fff" }}>
                            {hedgeCurrency} {Math.round(hedgeResult.execution.amountFCY).toLocaleString("no-NO")}
                          </div>
                        </div>
                        <div style={{ background: "#0d1117", borderRadius: 4, padding: "8px 12px", border: "1px solid #21262d" }}>
                          <div style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", letterSpacing: "0.05em" }}>YOU {hedgeResult.execution.action === "SELL" ? "RECEIVE" : "DELIVER"}</div>
                          <div style={{ fontSize: 14, fontWeight: 700, color: CCY_COLORS.NOK || "#F44336" }}>
                            NOK {Math.round(hedgeResult.execution.settlementNOK).toLocaleString("no-NO")}
                          </div>
                        </div>
                        <div style={{ background: "#0d1117", borderRadius: 4, padding: "8px 12px", border: "1px solid #21262d" }}>
                          <div style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", letterSpacing: "0.05em" }}>FORWARD RATE</div>
                          <div style={{ fontSize: 14, fontWeight: 700 }}>{hedgeResult.execution.forwardRate?.toFixed(4)}</div>
                        </div>
                        <div style={{ background: "#0d1117", borderRadius: 4, padding: "8px 12px", border: "1px solid #21262d" }}>
                          <div style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", letterSpacing: "0.05em" }}>HEDGE COST</div>
                          <div style={{ fontSize: 14, fontWeight: 700, color: "#f59e0b" }}>
                            NOK {Math.round(hedgeResult.execution.hedgeCostNOK).toLocaleString("no-NO")}
                          </div>
                          <div style={{ fontSize: 9, color: "rgba(255,255,255,0.35)" }}>{hedgeResult.costBpsAnnualized?.toFixed(0)} bps/year</div>
                        </div>
                        <div style={{ background: "#0d1117", borderRadius: 4, padding: "8px 12px", border: "1px solid #21262d" }}>
                          <div style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", letterSpacing: "0.05em" }}>BREAK-EVEN</div>
                          <div style={{ fontSize: 14, fontWeight: 700 }}>{fmtPct(hedgeResult.breakEvenPct, 2)}</div>
                          <div style={{ fontSize: 9, color: "rgba(255,255,255,0.35)" }}>NOK must move this much for hedge to pay off</div>
                        </div>
                        <div style={{ background: "#0d1117", borderRadius: 4, padding: "8px 12px", border: "1px solid #21262d" }}>
                          <div style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", letterSpacing: "0.05em" }}>VOL REDUCTION</div>
                          <div style={{ fontSize: 14, fontWeight: 700, color: "#10b981" }}>{hedgeResult.volReductionPct?.toFixed(1)}%</div>
                        </div>
                      </div>

                      {/* Upfront cost note */}
                      <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", lineHeight: 1.5 }}>
                        No upfront payment. The forward is a binding agreement &mdash; on {hedgeResult.execution.settlementDate} you exchange currencies at the agreed rate regardless of where spot is.
                      </div>
                    </div>
                  )}

                  {/* ===== RECOMMENDED PRODUCT ===== */}
                  {hedgeResult.execution && (
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12, marginBottom: 16 }}>
                      <div style={{ background: "#0d1117", borderRadius: 6, padding: 14, border: "1px solid #21262d" }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: "#10b981", letterSpacing: "0.05em", marginBottom: 6 }}>RECOMMENDED</div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: "#fff", marginBottom: 4 }}>{hedgeResult.execution.recommendedProduct}</div>
                        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", lineHeight: 1.5 }}>
                          {hedgeResult.execution.productExplanation}
                        </div>
                      </div>
                      <div style={{ background: "#0d1117", borderRadius: 6, padding: 14, border: "1px solid #21262d" }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.4)", letterSpacing: "0.05em", marginBottom: 6 }}>ALTERNATIVE</div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: "rgba(255,255,255,0.7)", marginBottom: 4 }}>{hedgeResult.execution.alternativeProduct}</div>
                        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", lineHeight: 1.5 }}>
                          {hedgeResult.execution.alternativeExplanation}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* ===== HOW TO EXECUTE ===== */}
                  {hedgeResult.execution && (
                    <div style={{ marginBottom: 16, borderRadius: 6, border: "1px solid #21262d", overflow: "hidden" }}>
                      <button
                        onClick={() => setShowHowTo(v => !v)}
                        style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", background: "#0d1117", border: "none", cursor: "pointer", fontFamily: "monospace" }}
                      >
                        <span style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.5)", letterSpacing: "0.05em" }}>HOW TO EXECUTE</span>
                        <span style={{ fontSize: 10, color: showHowTo ? "#3b82f6" : "rgba(255,255,255,0.35)", transition: "transform 0.15s", display: "inline-block", transform: showHowTo ? "rotate(90deg)" : "rotate(0deg)" }}>▶</span>
                      </button>
                      {showHowTo && (
                        <div style={{ padding: 14, background: "#0d1117", borderTop: "1px solid #21262d" }}>
                          <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "6px 12px", fontSize: 11, color: "rgba(255,255,255,0.6)", lineHeight: 1.5 }}>
                            <div style={{ fontWeight: 700, color: "#3b82f6" }}>1.</div>
                            <div><b style={{ color: "rgba(255,255,255,0.8)" }}>Call your bank&apos;s FX desk</b> (DNB Markets, Nordea Markets, SEB, or your primary bank). Ask for a quote on a {hedgeTenor} {hedgeCurrency}/NOK forward for {hedgeCurrency} {Math.round(hedgeResult.execution.amountFCY).toLocaleString("no-NO")}.</div>
                            <div style={{ fontWeight: 700, color: "#3b82f6" }}>2.</div>
                            <div><b style={{ color: "rgba(255,255,255,0.8)" }}>Compare the quoted rate</b> to the theoretical forward of {hedgeResult.execution.forwardRate?.toFixed(4)}. Bank quotes include a spread &mdash; expect 2-10 pips markup depending on relationship and size.</div>
                            <div style={{ fontWeight: 700, color: "#3b82f6" }}>3.</div>
                            <div><b style={{ color: "rgba(255,255,255,0.8)" }}>Confirm the trade</b> verbally or via the bank&apos;s e-trading platform (e.g., DNB FX Online, Nordea Markets Online). You&apos;ll receive a trade confirmation by email.</div>
                            <div style={{ fontWeight: 700, color: "#3b82f6" }}>4.</div>
                            <div><b style={{ color: "rgba(255,255,255,0.8)" }}>On settlement date ({hedgeResult.execution.settlementDate})</b>, the exchange happens automatically. Your bank debits/credits the agreed amounts. No action needed on your part.</div>
                          </div>
                          <div style={{ marginTop: 10, fontSize: 10, color: "rgba(255,255,255,0.35)", lineHeight: 1.5 }}>
                            Minimum size: Most banks require {">"}NOK 100,000 for FX forwards. No upfront margin for standard corporate forwards (credit line based). ISDA/GMSLA agreement may be required for first-time hedging.
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* ===== SCENARIO TABLE ===== */}
                  <HelpToggle id="hedge-scenarios" label="Scenario analysis" showHelp={showHelp} setShowHelp={setShowHelp}>
                    How does the hedge perform if {hedgeCurrency}/NOK moves?
                    Negative = NOK strengthens (hedge protects you). Positive = NOK weakens (you give up upside).
                    SAVINGS = how much better off you are hedged vs unhedged. Green = hedge helped.
                  </HelpToggle>
                  <table style={S.table}>
                    <thead>
                      <tr>
                        <th style={S.th}>{hedgeCurrency}/NOK MOVE</th>
                        <th style={S.th}>UNHEDGED P&amp;L</th>
                        <th style={S.th}>HEDGED P&amp;L</th>
                        <th style={S.th}>SAVINGS</th>
                      </tr>
                    </thead>
                    <tbody>
                      {hedgeResult.scenarios?.map((s: any) => (
                        <tr key={s.fxMovePct}>
                          <td style={{ ...S.td, fontWeight: 600 }}>{s.fxMovePct >= 0 ? "+" : ""}{s.fxMovePct}%</td>
                          <td style={{ ...S.td, color: s.unhedgedPnl >= 0 ? "#10b981" : "#ef4444" }}>
                            {Math.round(s.unhedgedPnl).toLocaleString("no-NO")} NOK
                          </td>
                          <td style={{ ...S.td, color: s.hedgedPnl >= 0 ? "#10b981" : "#ef4444" }}>
                            {Math.round(s.hedgedPnl).toLocaleString("no-NO")} NOK
                          </td>
                          <td style={{ ...S.td, color: s.savings > 0 ? "#10b981" : "#ef4444" }}>
                            {s.savings > 0 ? "+" : ""}{Math.round(s.savings).toLocaleString("no-NO")} NOK
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  {/* ===== HEDGE P&L CHART ===== */}
                  {hedgeResult.scenarios && hedgeResult.scenarios.length > 0 && (() => {
                    const scens: { fxMovePct: number; unhedgedPnl: number; hedgedPnl: number; savings: number }[] = hedgeResult.scenarios;
                    const W = 600, H = 180, PL = 58, PR = 12, PT = 14, PB = 28;
                    const cW = W - PL - PR, cH = H - PT - PB;
                    const allVals = scens.flatMap(s => [s.unhedgedPnl, s.hedgedPnl, s.savings]);
                    const rawMin = Math.min(...allVals), rawMax = Math.max(...allVals);
                    const pad = (rawMax - rawMin) * 0.08 || 1;
                    const yMin = rawMin - pad, yMax = rawMax + pad;
                    const xMin = scens[0].fxMovePct, xMax = scens[scens.length - 1].fxMovePct;
                    const toX = (v: number) => PL + ((v - xMin) / (xMax - xMin)) * cW;
                    const toY = (v: number) => PT + (1 - (v - yMin) / (yMax - yMin)) * cH;
                    const zeroY = toY(0);
                    const zeroX = toX(0);
                    const fmtK = (v: number) => {
                      const abs = Math.abs(v);
                      const sign = v < 0 ? "-" : v > 0 ? "+" : "";
                      if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1)}M`;
                      if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(0)}K`;
                      return `${sign}${Math.round(abs)}`;
                    };
                    const curvePath = (pts: { x: number; y: number }[]) => {
                      if (pts.length < 2) return "";
                      let d = `M ${pts[0].x} ${pts[0].y}`;
                      for (let i = 1; i < pts.length; i++) {
                        const p0 = pts[i - 1], p1 = pts[i];
                        const cp1x = p0.x + (p1.x - p0.x) / 3;
                        const cp2x = p1.x - (p1.x - p0.x) / 3;
                        d += ` C ${cp1x} ${p0.y} ${cp2x} ${p1.y} ${p1.x} ${p1.y}`;
                      }
                      return d;
                    };
                    const unhedgedPts = scens.map(s => ({ x: toX(s.fxMovePct), y: toY(s.unhedgedPnl) }));
                    const hedgedPts = scens.map(s => ({ x: toX(s.fxMovePct), y: toY(s.hedgedPnl) }));
                    const savingsPts = scens.map(s => ({ x: toX(s.fxMovePct), y: toY(s.savings) }));
                    const areaD = curvePath(unhedgedPts) + " L " + hedgedPts.slice().reverse().map(p => `${p.x} ${p.y}`).join(" L ") + " Z";
                    const yTickVals = Array.from({ length: 5 }, (_, i) => yMin + (i / 4) * (yMax - yMin));
                    const hovered = hedgeChartMouse ? scens[hedgeChartMouse.idx] : null;
                    const hvX = hovered ? toX(hovered.fxMovePct) : null;
                    return (
                      <div style={{ marginTop: 12, background: "#0d1117", borderRadius: 6, border: "1px solid #21262d", padding: "10px 12px 8px" }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                          <div style={{ fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.4)", letterSpacing: "0.08em", textTransform: "uppercase" as const }}>P&L chart — {hedgeCurrency}/NOK move scenarios</div>
                          <div style={{ display: "flex", gap: 12, fontSize: 9, color: "rgba(255,255,255,0.4)" }}>
                            <span><span style={{ display: "inline-block", width: 8, height: 1.5, background: "#ef4444", verticalAlign: "middle", marginRight: 3 }} />Unhedged</span>
                            <span><span style={{ display: "inline-block", width: 8, height: 1.5, background: "#3b82f6", verticalAlign: "middle", marginRight: 3 }} />Hedged</span>
                            <span><span style={{ display: "inline-block", width: 8, height: 1.5, background: "#10b981", verticalAlign: "middle", marginRight: 3, opacity: 0.7 }} />Savings</span>
                          </div>
                        </div>
                        <svg
                          viewBox={`0 0 ${W} ${H}`}
                          style={{ width: "100%", display: "block", cursor: "crosshair" }}
                          onMouseMove={(e) => {
                            const rect = (e.currentTarget as SVGElement).getBoundingClientRect();
                            const svgX = ((e.clientX - rect.left) / rect.width) * W;
                            const fxVal = xMin + ((svgX - PL) / cW) * (xMax - xMin);
                            let best = 0, bestDist = Infinity;
                            scens.forEach((s, i) => { const d = Math.abs(s.fxMovePct - fxVal); if (d < bestDist) { bestDist = d; best = i; } });
                            setHedgeChartMouse({ x: svgX, idx: best });
                          }}
                          onMouseLeave={() => setHedgeChartMouse(null)}
                        >
                          <defs>
                            <linearGradient id="hpGrad" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor="#10b981" stopOpacity={0.12} />
                              <stop offset="100%" stopColor="#10b981" stopOpacity={0.01} />
                            </linearGradient>
                            <clipPath id="hpClip"><rect x={PL} y={PT} width={cW} height={cH} /></clipPath>
                          </defs>

                          {/* Grid + Y-axis */}
                          {yTickVals.map((v, i) => {
                            const y = toY(v);
                            return (
                              <g key={i}>
                                <line x1={PL} y1={y} x2={PL + cW} y2={y} stroke="#1a1f27" strokeWidth={1} />
                                <text x={PL - 3} y={y + 3} textAnchor="end" fill="rgba(255,255,255,0.25)" fontSize={7} fontFamily="monospace">{fmtK(v)}</text>
                              </g>
                            );
                          })}

                          {/* X-axis labels */}
                          {scens.map((s) => (
                            <text key={s.fxMovePct} x={toX(s.fxMovePct)} y={H - 4} textAnchor="middle" fill="rgba(255,255,255,0.22)" fontSize={7} fontFamily="monospace">
                              {s.fxMovePct > 0 ? `+${s.fxMovePct}` : s.fxMovePct}%
                            </text>
                          ))}

                          {/* Zero P&L line */}
                          {zeroY >= PT && zeroY <= PT + cH && (
                            <line x1={PL} y1={zeroY} x2={PL + cW} y2={zeroY} stroke="rgba(255,255,255,0.12)" strokeWidth={1} strokeDasharray="3 3" />
                          )}
                          {/* Zero FX move line */}
                          {zeroX >= PL && zeroX <= PL + cW && (
                            <line x1={zeroX} y1={PT} x2={zeroX} y2={PT + cH} stroke="rgba(255,255,255,0.08)" strokeWidth={1} strokeDasharray="2 3" />
                          )}

                          {/* Protection fill */}
                          <path d={areaD} fill="url(#hpGrad)" clipPath="url(#hpClip)" />

                          {/* Lines */}
                          <path d={curvePath(savingsPts)} fill="none" stroke="#10b981" strokeWidth={1} strokeDasharray="4 3" strokeOpacity={0.7} clipPath="url(#hpClip)" />
                          <path d={curvePath(hedgedPts)} fill="none" stroke="#3b82f6" strokeWidth={1.5} clipPath="url(#hpClip)" />
                          <path d={curvePath(unhedgedPts)} fill="none" stroke="#ef4444" strokeWidth={1.5} clipPath="url(#hpClip)" />

                          {/* Crosshair */}
                          {hovered && hvX != null && (() => {
                            const tipW = 136, tipH = 66;
                            const tipX = hvX + 8 + tipW > W - PR ? hvX - tipW - 8 : hvX + 8;
                            const tipY = PT + 2;
                            return (
                              <>
                                <line x1={hvX} y1={PT} x2={hvX} y2={PT + cH} stroke="rgba(255,255,255,0.15)" strokeWidth={1} />
                                <circle cx={hvX} cy={toY(hovered.unhedgedPnl)} r={2.5} fill="#ef4444" />
                                <circle cx={hvX} cy={toY(hovered.hedgedPnl)} r={2.5} fill="#3b82f6" />
                                <circle cx={hvX} cy={toY(hovered.savings)} r={2} fill="#10b981" />
                                <rect x={tipX} y={tipY} width={tipW} height={tipH} rx={3} fill="#0d1117" stroke="#30363d" strokeWidth={0.8} />
                                <text x={tipX + 7} y={tipY + 12} fill="rgba(255,255,255,0.6)" fontSize={8} fontFamily="monospace" fontWeight={700}>
                                  {hovered.fxMovePct > 0 ? "+" : ""}{hovered.fxMovePct}% {hedgeCurrency}/NOK
                                </text>
                                <text x={tipX + 7} y={tipY + 26} fill="#ef4444" fontSize={8} fontFamily="monospace">Unhedged   {fmtK(hovered.unhedgedPnl)} NOK</text>
                                <text x={tipX + 7} y={tipY + 38} fill="#3b82f6" fontSize={8} fontFamily="monospace">Hedged     {fmtK(hovered.hedgedPnl)} NOK</text>
                                <text x={tipX + 7} y={tipY + 50} fill="#10b981" fontSize={8} fontFamily="monospace">Savings    {fmtK(hovered.savings)} NOK</text>
                                <text x={tipX + 7} y={tipY + 62} fill={hovered.savings > 0 ? "#10b981" : "#f59e0b"} fontSize={7} fontFamily="monospace">
                                  {hovered.savings > 0 ? "▲ hedge protects" : "▼ hedge costs upside"}
                                </text>
                              </>
                            );
                          })()}
                        </svg>
                      </div>
                    );
                  })()}

                  {/* Plain-language summary */}
                  <div style={{ marginTop: 12, padding: 10, background: "#0d1117", borderRadius: 4, border: "1px solid #21262d", fontSize: 12, color: "rgba(255,255,255,0.6)", lineHeight: 1.6 }}>
                    <b style={{ color: "rgba(255,255,255,0.8)" }}>Bottom line:</b>{" "}
                    {hedgeResult.execution && hedgeResult.execution.amountFCY > 0
                      ? <>
                          {hedgeResult.execution.actionVerb} {hedgeCurrency} {Math.round(hedgeResult.execution.amountFCY).toLocaleString("no-NO")} forward at {hedgeResult.execution.forwardRate?.toFixed(4)} for {hedgeTenor}.
                          {" "}This costs NOK {Math.round(hedgeResult.execution.hedgeCostNOK).toLocaleString("no-NO")} ({hedgeResult.costBpsAnnualized?.toFixed(0)} bps/year annualized).
                          {hedgeResult.volReductionPct >= 5
                            ? ` Reduces your cashflow volatility by ${hedgeResult.volReductionPct?.toFixed(0)}%.`
                            : ` Minimal vol reduction — consider whether the cost is justified.`}
                          {" "}Call your bank&apos;s FX desk to get a live quote.
                        </>
                      : <>
                          No hedgeable exposure detected for {companyTicker} in {hedgeCurrency}. Check the exposure data above.
                        </>
                    }
                  </div>
                </div>
              )}
            </div>
          </>
        ) : (
          <div style={{ ...S.card, textAlign: "center" }}>
            <div style={S.dim}>
              {companyData === null ? "Loading..." : "No exposure data for this ticker. Run seed-fx-exposures.ts to populate."}
            </div>
          </div>
        )}
      </>
    );
  }

  /* ================================================================ */
  /* TAB 4: PORTFOLIO FX RISK                                          */
  /* ================================================================ */

  function renderPortfolio() {
    // Parse current tickers/weights for holdings table
    const holdingTickers = pfTickers.split(",").map(t => t.trim()).filter(Boolean);
    const holdingWeights = pfWeights.split(",").map(w => parseFloat(w.trim())).filter(w => !isNaN(w));

    return (
      <>
        {/* Login modal (same pattern as portfolio optimizer) */}
        {showLoginModal && (
          <div
            style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}
            onClick={() => setShowLoginModal(false)}
          >
            <form
              style={{ ...S.card, padding: 28, width: 340, background: "#0d1117" }}
              onSubmit={(e) => { e.preventDefault(); handlePortfolioLogin(); }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{ textAlign: "center", marginBottom: 20 }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: "#3b82f6" }}>Sign In</div>
                <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginTop: 4 }}>Sign in to load saved portfolios</div>
              </div>
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginBottom: 4, letterSpacing: 1 }}>USERNAME</div>
              <input
                type="text" value={authUser} onChange={(e) => setAuthUser(e.target.value)}
                placeholder="Enter username" autoFocus autoComplete="username"
                style={{ ...S.input, width: "100%", padding: "10px 12px", marginBottom: 12, boxSizing: "border-box" as const }}
              />
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginBottom: 4, letterSpacing: 1 }}>PASSWORD</div>
              <input
                type="password" value={authPass} onChange={(e) => setAuthPass(e.target.value)}
                placeholder="Enter password" autoComplete="current-password"
                style={{ ...S.input, width: "100%", padding: "10px 12px", marginBottom: 12, boxSizing: "border-box" as const }}
              />
              <button
                type="submit" disabled={authLoading || !authPass || !authUser}
                style={{ ...S.button, width: "100%", padding: "11px 0", marginTop: 4, opacity: (authLoading || !authPass || !authUser) ? 0.5 : 1 }}
              >
                {authLoading ? "Signing in..." : "SIGN IN"}
              </button>
              {authError && <div style={{ color: "#ef4444", fontSize: 11, marginTop: 10, textAlign: "center" }}>{authError}</div>}
            </form>
          </div>
        )}

        {/* Portfolio selector header */}
        <div style={S.card}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <div style={S.cardTitle}>PORTFOLIO FX RISK ANALYSIS</div>
            {token && profile ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ ...S.badge, background: "rgba(59,130,246,0.15)", color: "#10b981" }}>{profile}</span>
                <span style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", cursor: "pointer", textDecoration: "underline" }} onClick={() => {
                  authLogout();
                  setPfTickers("EQNR,MOWI,FRO,DNB");
                  setPfWeights("0.3,0.25,0.25,0.2");
                  setPfResult(null);
                  setSelectedConfigId(null);
                  setSavedConfigs([]);
                }}>logout</span>
              </div>
            ) : (
              <button
                style={{ ...S.button, background: "transparent", border: "1px solid #3b82f6", color: "#3b82f6", fontSize: 10 }}
                onClick={() => setShowLoginModal(true)}
              >
                SIGN IN TO LOAD PORTFOLIOS
              </button>
            )}
          </div>

          {/* Saved portfolio cards */}
          {token && !configsLoading && savedConfigs.length > 0 && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
              {savedConfigs.map((cfg) => {
                const active = selectedConfigId === cfg.id;
                return (
                  <div
                    key={cfg.id}
                    onClick={() => selectConfig(cfg)}
                    style={{
                      padding: "8px 14px", minWidth: 120,
                      background: active ? "rgba(59,130,246,0.12)" : "#0d1117",
                      border: active ? "1px solid #3b82f6" : "1px solid #30363d",
                      borderRadius: 4, cursor: "pointer", transition: "all 0.15s",
                    }}
                  >
                    <div style={{ fontSize: 12, fontWeight: 700, color: active ? "#3b82f6" : "#fff" }}>{cfg.name}</div>
                    <div style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", marginTop: 2 }}>
                      {cfg.tickers.length} stocks{cfg.mode ? ` \u00B7 ${cfg.mode}` : ""}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {token && configsLoading && <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginBottom: 8 }}>Loading portfolios...</div>}
          {token && !configsLoading && savedConfigs.length === 0 && (
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginBottom: 8 }}>
              No saved portfolios. <Link href="/portfolio" style={{ color: "#3b82f6" }}>Create one in the Portfolio Optimizer</Link>
            </div>
          )}

          {/* Add ticker search */}
          <div style={{ position: "relative", marginBottom: 10 }}>
            <div style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", marginBottom: 4, letterSpacing: "0.05em", textTransform: "uppercase" as const }}>ADD TICKER</div>
            <input
              type="text"
              placeholder="Search ticker to add..."
              value={pfTickerSearch}
              onChange={(e) => setPfTickerSearch(e.target.value.toUpperCase())}
              onFocus={() => setPfSearchFocused(true)}
              onBlur={() => setTimeout(() => setPfSearchFocused(false), 200)}
              style={{ ...S.input, width: 250, padding: "6px 10px" }}
            />
            {pfSearchFocused && pfTickerSearch.length >= 1 && (() => {
              const available = exposureHeatmap
                .map(r => r.ticker)
                .filter(t => !holdingTickers.includes(t) && t.includes(pfTickerSearch))
                .slice(0, 8);
              if (available.length === 0) return null;
              return (
                <div style={{
                  position: "absolute", top: "100%", left: 0, zIndex: 20, marginTop: 2,
                  background: "#161b22", border: "1px solid #3b82f6", borderRadius: 6,
                  maxHeight: 200, overflowY: "auto", width: 250,
                  boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
                }}>
                  {available.map(t => (
                    <div
                      key={t}
                      style={{ padding: "6px 12px", fontSize: 11, fontFamily: "monospace", cursor: "pointer", borderBottom: "1px solid #21262d" }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(59,130,246,0.08)")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                      onMouseDown={() => {
                        const newTickers = [...holdingTickers, t];
                        const newWeight = normalizeWeights ? 0 : 0.1;
                        const newWeights = [...holdingWeights, newWeight];
                        if (normalizeWeights && newWeights.length > 1) {
                          const eq = 1 / newWeights.length;
                          for (let j = 0; j < newWeights.length; j++) newWeights[j] = eq;
                        }
                        setPfTickers(newTickers.join(","));
                        setPfWeights(newWeights.map(v => v.toFixed(4)).join(","));
                        setPfTickerSearch("");
                        setPfResult(null);
                      }}
                    >
                      {t}
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>

          {/* Editable holdings table */}
          {holdingTickers.length > 0 && (() => {
            const applyWeight = (idx: number, pctVal: number) => {
              const wArr = [...holdingWeights];
              wArr[idx] = Math.max(0, pctVal / 100);
              if (normalizeWeights) {
                const total = wArr.reduce((a, b) => a + b, 0);
                if (total > 1.0001) {
                  const excess = total - 1;
                  const others = wArr.filter((_, j) => j !== idx && wArr[j] > 0).length;
                  if (others > 0) {
                    const cut = excess / others;
                    for (let j = 0; j < wArr.length; j++) {
                      if (j !== idx) wArr[j] = Math.max(0, wArr[j] - cut);
                    }
                  }
                }
              }
              setPfWeights(wArr.map(v => v.toFixed(4)).join(","));
            };
            const commitEdit = () => {
              if (editingWeightIdx === null) return;
              const parsed = parseFloat(editingWeightVal.replace(",", "."));
              applyWeight(editingWeightIdx, isNaN(parsed) ? 0 : parsed);
              setEditingWeightIdx(null);
            };
            return (
            <>
              <table style={{ ...S.table }}>
                <thead>
                  <tr>
                    <th style={S.th}>TICKER</th>
                    <th style={{ ...S.th, textAlign: "right", width: 90 }}>WEIGHT %</th>
                    <th style={S.th}>ALLOCATION</th>
                    <th style={{ ...S.th, width: 30 }} />
                  </tr>
                </thead>
                <tbody>
                  {holdingTickers.map((t, i) => {
                    const w = holdingWeights[i] ?? 0;
                    const maxSlider = normalizeWeights ? 100 : 200;
                    return (
                      <tr key={t}>
                        <td style={{ ...S.td, fontWeight: 600, color: "#3b82f6" }}>{t}</td>
                        <td style={{ ...S.td, textAlign: "right" }}>
                          <input
                            type="text"
                            inputMode="decimal"
                            value={editingWeightIdx === i ? editingWeightVal : (w * 100).toFixed(1)}
                            onFocus={(e) => {
                              setEditingWeightIdx(i);
                              setEditingWeightVal((w * 100).toFixed(1));
                              e.target.select();
                            }}
                            onBlur={commitEdit}
                            onKeyDown={(e) => { if (e.key === "Enter") { e.currentTarget.blur(); } }}
                            onChange={(e) => {
                              setEditingWeightVal(e.target.value);
                            }}
                            style={{
                              ...S.input,
                              width: 70,
                              textAlign: "right" as const,
                              padding: "4px 6px",
                              fontSize: 11,
                            }}
                          />
                        </td>
                        <td style={{ ...S.td, position: "relative" }}>
                          <div style={{ position: "relative", height: 16 }}>
                            <div style={{ position: "absolute", inset: 0, background: "#0d1117", borderRadius: 3, overflow: "hidden" }}>
                              <div style={{
                                width: `${Math.min((w * 100 / maxSlider) * 100, 100)}%`,
                                height: "100%",
                                background: "linear-gradient(90deg, rgba(59,130,246,0.3), rgba(59,130,246,0.6))",
                                borderRadius: 3,
                                transition: "width 0.25s ease-out",
                              }} />
                            </div>
                            <input
                              type="range"
                              min={0}
                              max={maxSlider}
                              step={0.5}
                              value={w * 100}
                              onChange={(e) => applyWeight(i, parseFloat(e.target.value))}
                              style={{
                                position: "absolute", inset: 0, width: "100%", height: "100%",
                                opacity: 0, cursor: "pointer", margin: 0,
                              }}
                            />
                          </div>
                        </td>
                        <td style={{ ...S.td, textAlign: "center" }}>
                          <span
                            style={{ fontSize: 12, color: "rgba(255,255,255,0.3)", cursor: "pointer", fontFamily: "monospace" }}
                            onMouseEnter={(e) => (e.currentTarget.style.color = "#ef4444")}
                            onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.3)")}
                            onClick={() => {
                              const newTickers = holdingTickers.filter((_, j) => j !== i);
                              const newWeights = holdingWeights.filter((_, j) => j !== i);
                              if (normalizeWeights && newTickers.length > 0) {
                                const total = newWeights.reduce((a, b) => a + b, 0);
                                if (total > 0) {
                                  for (let j = 0; j < newWeights.length; j++) newWeights[j] /= total;
                                }
                              }
                              setPfTickers(newTickers.join(","));
                              setPfWeights(newWeights.map(v => v.toFixed(4)).join(","));
                              setPfResult(null);
                            }}
                          >
                            &times;
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                  <tr>
                    <td style={{ ...S.td, color: "rgba(255,255,255,0.5)", fontWeight: 600 }}>TOTAL</td>
                    <td style={{ ...S.td, textAlign: "right", fontWeight: 700, color: Math.abs(holdingWeights.reduce((a, b) => a + b, 0) - 1) < 0.01 ? "#10b981" : normalizeWeights ? "#ef4444" : "rgba(255,255,255,0.5)" }}>
                      {(holdingWeights.reduce((a, b) => a + b, 0) * 100).toFixed(1)}%
                    </td>
                    <td style={S.td} />
                    <td style={S.td} />
                  </tr>
                </tbody>
              </table>

              <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10, flexWrap: "wrap" }}>
                <button style={S.button} onClick={runPortfolio} disabled={pfLoading || holdingTickers.length < 2}>
                  {pfLoading ? "ANALYZING..." : "ANALYZE FX RISK"}
                </button>
                <button
                  style={{ ...S.button, background: "#21262d", border: "1px solid #30363d", color: "rgba(255,255,255,0.6)", padding: "6px 14px", fontSize: 10 }}
                  onClick={() => {
                    const n = holdingTickers.length;
                    const eq = Array(n).fill(1 / n);
                    setPfWeights(eq.map((v: number) => v.toFixed(4)).join(","));
                  }}
                >
                  EQUAL WEIGHT
                </button>
                <div
                  style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", marginLeft: "auto" }}
                  onClick={() => setNormalizeWeights(!normalizeWeights)}
                >
                  <div style={{
                    width: 32, height: 16, borderRadius: 8,
                    background: normalizeWeights ? "#3b82f6" : "#30363d",
                    position: "relative", transition: "background 0.2s",
                  }}>
                    <div style={{
                      width: 12, height: 12, borderRadius: 6,
                      background: "#fff",
                      position: "absolute", top: 2,
                      left: normalizeWeights ? 18 : 2,
                      transition: "left 0.2s",
                    }} />
                  </div>
                  <span style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", fontFamily: "monospace" }}>
                    CAP AT 100%
                  </span>
                </div>
              </div>
            </>
          );})()}
          {holdingTickers.length === 0 && (
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", padding: "12px 0" }}>
              Add tickers above to build your portfolio
            </div>
          )}
        </div>

        {pfResult && (
          <>
            {/* FX VaR cards */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10, marginBottom: 12 }}>
              {[
                { label: "1D VaR 95%", value: pfResult.fxVaR?.var95_1d, suffix: "%" },
                { label: "1D VaR 99%", value: pfResult.fxVaR?.var99_1d, suffix: "%" },
                { label: "1M VaR 95%", value: pfResult.fxVaR?.var95_1m, suffix: "%" },
                { label: "1M VaR 99%", value: pfResult.fxVaR?.var99_1m, suffix: "%" },
              ].map((v) => (
                <div key={v.label} style={S.card}>
                  <div style={{ fontSize: 10, color: "rgba(255,255,255,0.5)" }}>{v.label}</div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: "#ef4444" }}>
                    {v.value != null ? `${v.value.toFixed(2)}${v.suffix}` : "\u2014"}
                  </div>
                </div>
              ))}
            </div>

            <div style={S.grid2}>
              {/* Aggregate exposure */}
              <div style={S.card}>
                <div style={S.cardTitle}>WEIGHTED FX EXPOSURE</div>
                {pfResult.weightedExposure && (["usd", "eur", "gbp", "sek"] as const).map((c) => {
                  const v = pfResult.weightedExposure[c];
                  const pctAbs = Math.min(Math.abs(v) * 100, 50);
                  return (
                    <div key={c} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                      <span style={{ width: 40, fontSize: 10, color: CCY_COLORS[c.toUpperCase()], fontWeight: 600 }}>{c.toUpperCase()}</span>
                      <div style={{ flex: 1, height: 16, background: "#0d1117", borderRadius: 2, position: "relative", overflow: "hidden" }}>
                        <div style={{
                          position: "absolute",
                          left: v >= 0 ? "50%" : `${50 - pctAbs}%`,
                          width: `${pctAbs}%`,
                          height: "100%",
                          background: v >= 0 ? "#10b981" : "#ef4444",
                          opacity: 0.5,
                        }} />
                      </div>
                      <span style={{ width: 50, textAlign: "right", fontSize: 11, color: v >= 0 ? "#10b981" : "#ef4444" }}>
                        {(v * 100).toFixed(1)}%
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* Currency contributions */}
              <div style={S.card}>
                <div style={S.cardTitle}>CURRENCY RISK CONTRIBUTION</div>
                {pfResult.fxVaR?.currencyContributions && Object.entries(pfResult.fxVaR.currencyContributions).map(([c, v]) => (
                  <div key={c} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                    <span style={{ width: 40, fontSize: 10, color: CCY_COLORS[c.toUpperCase()], fontWeight: 600 }}>{c.toUpperCase()}</span>
                    <div style={{ flex: 1, height: 16, background: "#0d1117", borderRadius: 2, overflow: "hidden" }}>
                      <div style={{ width: `${v as number}%`, height: "100%", background: CCY_COLORS[c.toUpperCase()] || "rgba(255,255,255,0.5)", opacity: 0.6 }} />
                    </div>
                    <span style={{ width: 44, textAlign: "right", fontSize: 11 }}>{(v as number).toFixed(1)}%</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Per-stock FX risk contribution */}
            <div style={S.card}>
              <div style={S.cardTitle}>PER-STOCK FX RISK CONTRIBUTION</div>
              <div style={{ overflowX: "auto" as const }}>
              <table style={S.table}>
                <thead>
                  <tr>
                    <th style={S.th}>TICKER</th>
                    <th style={S.th}>WEIGHT</th>
                    <th style={S.th}>|&beta; FX|</th>
                    <th style={S.th}>RISK CONTRIB</th>
                    <th style={S.th}>&beta; USD</th>
                    <th style={S.th}>&beta; EUR</th>
                    <th style={S.th}>&beta; GBP</th>
                    <th style={S.th}>&beta; SEK</th>
                  </tr>
                </thead>
                <tbody>
                  {pfResult.perStock?.map((s: any) => (
                    <tr key={s.ticker}>
                      <td style={{ ...S.td, fontWeight: 600, color: "#3b82f6" }}>{s.ticker}</td>
                      <td style={S.td}>{(s.weight * 100).toFixed(1)}%</td>
                      <td style={S.td}>{s.fxBetaTotal.toFixed(3)}</td>
                      <td style={{ ...S.td, fontWeight: 600 }}>{(s.riskContribution * 100).toFixed(2)}%</td>
                      <td style={{ ...S.td, color: CCY_COLORS.USD }}>{s.betas.usd.toFixed(3)}</td>
                      <td style={{ ...S.td, color: CCY_COLORS.EUR }}>{s.betas.eur.toFixed(3)}</td>
                      <td style={{ ...S.td, color: CCY_COLORS.GBP }}>{s.betas.gbp.toFixed(3)}</td>
                      <td style={{ ...S.td, color: CCY_COLORS.SEK }}>{s.betas.sek.toFixed(3)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </div>

            {/* Stress scenarios */}
            <div style={S.card}>
              <div style={S.cardTitle}>STRESS SCENARIOS</div>
              <HelpToggle id="stress-help" label="How are stress impacts calculated?" showHelp={showHelp} setShowHelp={setShowHelp}>
                Estimated earnings impact based on your portfolio&apos;s weighted FX exposure. E.g. if portfolio has 40% net USD exposure and NOK weakens 5%, earnings impact is ~2%.
              </HelpToggle>
              <table style={S.table}>
                <thead>
                  <tr>
                    <th style={S.th}>SCENARIO</th>
                    <th style={S.th}>USD IMPACT</th>
                    <th style={S.th}>EUR IMPACT</th>
                    <th style={S.th}>TOTAL IMPACT</th>
                  </tr>
                </thead>
                <tbody>
                  {pfResult.stressScenarios?.map((s: any) => (
                    <tr key={s.scenario}>
                      <td style={{ ...S.td, fontWeight: 600 }}>{s.scenario}</td>
                      <td style={{ ...S.td, color: s.usdImpact >= 0 ? "#10b981" : "#ef4444" }}>
                        {fmtPct(s.usdImpact * 100, 1)}
                      </td>
                      <td style={{ ...S.td, color: s.eurImpact >= 0 ? "#10b981" : "#ef4444" }}>
                        {fmtPct(s.eurImpact * 100, 1)}
                      </td>
                      <td style={{ ...S.td, fontWeight: 700, color: s.totalImpact >= 0 ? "#10b981" : "#ef4444" }}>
                        {fmtPct(s.totalImpact * 100, 1)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </>
    );
  }

  /* ================================================================ */
  /* TAB 5: FORWARDS & CARRY                                           */
  /* ================================================================ */

  function renderForwards() {
    return (
      <>
        {/* CB Funding Regimes — compact strip */}
        {fundingRegimes.length > 0 && (
          <div style={{ ...S.card, padding: "10px 14px", marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span style={{ fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.35)", letterSpacing: "0.08em", flexShrink: 0 }}>CB BALANCE SHEET / GDP</span>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", flex: 1 }}>
                {fundingRegimes.map((r: any) => (
                  <div key={r.currency} style={{ display: "flex", alignItems: "center", gap: 5, padding: "4px 8px", background: "#0d1117", borderRadius: 4, border: `1px solid ${r.color}40` }}>
                    <div style={{ width: 6, height: 6, borderRadius: "50%", background: r.color, flexShrink: 0 }} />
                    <span style={{ fontSize: 10, fontWeight: 700, color: CCY_COLORS[r.currency] || "#fff" }}>{r.currency}</span>
                    <span style={{ fontSize: 11, fontWeight: 800, color: "#fff" }}>{r.balanceSheetPctGdp?.toFixed(0)}%</span>
                    <span style={{ fontSize: 9, color: r.color, fontWeight: 600 }}>{r.regime.split(" ")[0]}</span>
                  </div>
                ))}
              </div>
              <span style={{ fontSize: 9, color: "rgba(255,255,255,0.2)", flexShrink: 0 }}>Expansive CB regimes compress FX funding spreads</span>
            </div>
          </div>
        )}

        {/* Pair selector */}
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 16, flexWrap: "wrap" }}>
          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", flexShrink: 0 }}>PAIR:</span>
          {["NOKUSD", "NOKEUR", "NOKGBP", "NOKSEK", "NOKDKK"].map((p) => (
            <div
              key={p}
              style={{
                ...S.badge,
                background: fwdPair === p ? "rgba(59,130,246,0.2)" : "#0d1117",
                color: fwdPair === p ? "#3b82f6" : "rgba(255,255,255,0.5)",
                cursor: "pointer",
                border: fwdPair === p ? "1px solid #3b82f6" : "1px solid #30363d",
              }}
              onClick={() => setFwdPair(p)}
            >
              {PAIR_LABELS[p] || p}
            </div>
          ))}
        </div>

        {/* Forward curve */}
        <div style={S.card}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
            <div style={{ ...S.cardTitle, marginBottom: 0, flex: 1 }}>FORWARD CURVE &mdash; {PAIR_LABELS[fwdPair]}</div>
            <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
              <span style={{ fontSize: 9, color: "rgba(255,255,255,0.3)" }}>BASIS:</span>
              {(["OIS", "IMPLEMENTABLE"] as const).map(m => (
                <div
                  key={m}
                  onClick={() => setBasisMode(m)}
                  style={{ ...S.badge, cursor: "pointer", background: basisMode === m ? "rgba(59,130,246,0.2)" : "#0d1117", color: basisMode === m ? "#3b82f6" : "rgba(255,255,255,0.35)", border: basisMode === m ? "1px solid #3b82f6" : "1px solid #30363d", fontSize: 9 }}
                >
                  {m}
                </div>
              ))}
            </div>
          </div>
          <HelpToggle id="fwd-curve-help" label="How are forward rates calculated?" showHelp={showHelp} setShowHelp={setShowHelp}>
            Forward rates are derived from interest rate parity (IRP): the forward price reflects the interest rate differential between the two currencies.
            Hedge cost shows the annualized cost of locking in the forward rate to eliminate currency risk.
            OIS basis = raw LOOP deviation. IMPLEMENTABLE = after subtracting the CP-OIS funding spread (~19 bps for high-rated banks, Rime et al. 2022).
          </HelpToggle>
          {fwdForwards.length > 0 ? (
            <div style={{ overflowX: "auto" as const }}>
            <table style={S.table}>
              <thead>
                <tr>
                  <th style={S.th}>TENOR</th>
                  <th style={S.th}>SPOT</th>
                  <th style={S.th}>FORWARD</th>
                  <th style={S.th}>FWD POINTS</th>
                  <th style={S.th}>FWD PTS (BPS)</th>
                  <th style={S.th}>CARRY (ANN %)</th>
                  <th style={S.th}>NOK RATE</th>
                  <th style={S.th}>FOREIGN RATE</th>
                  <th style={S.th}>HEDGE COST</th>
                  <th style={{ ...S.th, color: "#3b82f6" }}>{basisMode} BASIS</th>
                </tr>
              </thead>
              <tbody>
                {fwdForwards.map((f) => {
                  const bd = f.basisDecomposition;
                  const basisVal = bd
                    ? basisMode === "OIS"
                      ? bd.oisBasisBps
                      : bd.implementableBasisHigh
                    : null;
                  const basisColor = basisVal == null ? "rgba(255,255,255,0.4)" : basisVal < -5 ? "#ef4444" : basisVal > 5 ? "#10b981" : "rgba(255,255,255,0.6)";
                  return (
                  <tr key={f.tenor}>
                    <td style={{ ...S.td, fontWeight: 600 }}>{f.tenor}</td>
                    <td style={S.td}>{f.spot.toFixed(4)}</td>
                    <td style={{ ...S.td, fontWeight: 600 }}>{f.forward.toFixed(4)}</td>
                    <td style={{ ...S.td, color: f.forwardPoints > 0 ? "#10b981" : "#ef4444" }}>
                      {f.forwardPoints >= 0 ? "+" : ""}{f.forwardPoints.toFixed(4)}
                    </td>
                    <td style={{ ...S.td, color: f.forwardPointsBps > 0 ? "#10b981" : "#ef4444" }}>
                      {f.forwardPointsBps >= 0 ? "+" : ""}{f.forwardPointsBps.toFixed(1)}
                    </td>
                    <td style={{ ...S.td, color: f.annualizedCarryPct > 0 ? "#10b981" : "#ef4444" }}>
                      {fmtPct(f.annualizedCarryPct)}
                    </td>
                    <td style={S.td}>{f.nokRate.toFixed(2)}%</td>
                    <td style={S.td}>{f.foreignRate.toFixed(2)}%</td>
                    <td style={S.td}>{fmtBps(f.hedgeCostBps)}</td>
                    <td style={{ ...S.td, color: basisColor, fontWeight: 600 }}>
                      {basisVal != null ? `${basisVal >= 0 ? "+" : ""}${basisVal.toFixed(1)} bps` : "—"}
                      {bd && basisMode === "IMPLEMENTABLE" && bd.hasArbitrageHigh && (
                        <span title="Positive implementable basis — potential arbitrage for high-rated banks" style={{ marginLeft: 4, color: "#10b981", fontSize: 9 }}>ARB</span>
                      )}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
          ) : (
            <div style={S.dim}>Loading forward rates... (Ensure interest_rates table is seeded)</div>
          )}
        </div>

        <div style={S.grid2}>
          {/* Interest rate table */}
          <div style={S.card}>
            <div style={S.cardTitle}>INTEREST RATES BY CURRENCY</div>
            {Object.keys(interestRates).length > 0 ? (
              <table style={S.table}>
                <thead>
                  <tr>
                    <th style={S.th}>CURRENCY</th>
                    <th style={S.th}>TENOR</th>
                    <th style={S.th}>RATE</th>
                    <th style={S.th}>SOURCE</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(interestRates).flatMap(([ccy, rates]) =>
                    (rates as any[]).map((r, i) => (
                      <tr key={`${ccy}-${i}`}>
                        {i === 0 && (
                          <td style={{ ...S.td, fontWeight: 600, color: CCY_COLORS[ccy] || "rgba(255,255,255,0.5)" }} rowSpan={rates.length}>
                            {ccy}
                          </td>
                        )}
                        <td style={S.td}>{r.tenor}</td>
                        <td style={{ ...S.td, fontWeight: 600 }}>{r.rate.toFixed(2)}%</td>
                        <td style={{ ...S.td, color: "rgba(255,255,255,0.35)" }}>{r.source}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            ) : (
              <div style={S.dim}>Run seed-fx-interest-rates.ts to populate</div>
            )}
          </div>

          {/* Carry trade metrics */}
          <div style={S.card}>
            <div style={S.cardTitle}>CARRY TRADE &mdash; {PAIR_LABELS[fwdPair]}</div>
            <HelpToggle id="carry-intro" label="What is a carry trade?" showHelp={showHelp} setShowHelp={setShowHelp}>
              A carry trade earns the interest rate differential between two currencies. Borrow in the low-rate currency, invest in the high-rate one.
              {carryData?.carry > 0
                ? ` NOK currently yields more than ${fwdPair.replace("NOK", "")}, so holding NOK earns carry income \u2014 but currency depreciation can erase gains.`
                : carryData?.carry < 0
                ? ` ${fwdPair.replace("NOK", "")} currently yields more than NOK, meaning borrowing NOK to invest in ${fwdPair.replace("NOK", "")} earns carry income.`
                : ""}
            </HelpToggle>
            {carryData ? (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12, marginBottom: 14 }}>
                  <div style={{ padding: 10, background: "#0d1117", borderRadius: 4, border: "1px solid #21262d" }}>
                    <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginBottom: 4 }}>ANNUALIZED CARRY</div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: carryData.carry > 0 ? "#10b981" : "#ef4444" }}>
                      {fmtPct(carryData.carry)}
                    </div>
                    <div style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", marginTop: 2 }}>Interest rate differential</div>
                  </div>
                  <div style={{ padding: 10, background: "#0d1117", borderRadius: 4, border: "1px solid #21262d" }}>
                    <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginBottom: 4 }}>CARRY SHARPE</div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: (carryData.carrySharpe ?? 0) > 0.5 ? "#10b981" : (carryData.carrySharpe ?? 0) > 0 ? "#3b82f6" : "#ef4444" }}>
                      {carryData.carrySharpe?.toFixed(2)}
                    </div>
                    <div style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", marginTop: 2 }}>Carry / spot volatility</div>
                  </div>
                  <div style={{ padding: 10, background: "#0d1117", borderRadius: 4, border: "1px solid #21262d" }}>
                    <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginBottom: 4 }}>SPOT VOLATILITY</div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: "#fff" }}>
                      {carryData.spotVol?.toFixed(1)}%
                    </div>
                    <div style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", marginTop: 2 }}>Annualized FX volatility</div>
                  </div>
                  <div style={{ padding: 10, background: "#0d1117", borderRadius: 4, border: "1px solid #21262d" }}>
                    <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginBottom: 4 }}>CARRY-TO-VOL</div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: "#fff" }}>
                      {carryData.spotVol > 0 ? (Math.abs(carryData.carry) / carryData.spotVol * 100).toFixed(0) : "\u2014"}%
                    </div>
                    <div style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", marginTop: 2 }}>How much carry vs risk</div>
                  </div>
                </div>

                {/* Net carry decomposition (Rime et al. 2022 — Table 1 CP-OIS spreads) */}
                {carryData.carryDecomposition && (
                  <div style={{ padding: 10, background: "#0d1117", borderRadius: 4, border: "1px solid #21262d", marginBottom: 10 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.5)", marginBottom: 8 }}>NET CARRY AFTER FUNDING (RIME ET AL. 2022)</div>
                    <table style={{ ...S.table, marginBottom: 0 }}>
                      <thead>
                        <tr>
                          <th style={S.th}>CARRY TYPE</th>
                          <th style={{ ...S.th, textAlign: "right" as const }}>VALUE</th>
                          <th style={{ ...S.th, textAlign: "right" as const }}>STATUS</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[
                          {
                            label: "GROSS CARRY (OIS)",
                            value: carryData.carryDecomposition.grossCarryBps,
                            desc: "Interest rate differential",
                            attractive: null,
                          },
                          {
                            label: "NET (HIGH-RATED BANK)",
                            value: carryData.carryDecomposition.netCarryHighRatedBps,
                            desc: "−19 bps CP-OIS (A-1/P-1)",
                            attractive: carryData.carryDecomposition.isAttractiveHighRated,
                          },
                          {
                            label: "NET (MID-RATED BANK)",
                            value: carryData.carryDecomposition.netCarryMidRatedBps,
                            desc: "−36 bps CP-OIS (A-2/P-2)",
                            attractive: carryData.carryDecomposition.isAttractiveMidRated,
                          },
                        ].map(row => (
                          <tr key={row.label}>
                            <td style={S.td}>
                              <div style={{ fontSize: 10, fontWeight: 600 }}>{row.label}</div>
                              <div style={{ fontSize: 9, color: "rgba(255,255,255,0.35)" }}>{row.desc}</div>
                            </td>
                            <td style={{ ...S.td, textAlign: "right" as const, fontWeight: 700, color: (row.value ?? 0) > 0 ? "#10b981" : "#ef4444" }}>
                              {row.value != null ? `${row.value >= 0 ? "+" : ""}${row.value.toFixed(1)} bps` : "—"}
                            </td>
                            <td style={{ ...S.td, textAlign: "right" as const }}>
                              {row.attractive === null ? (
                                <span style={{ ...S.badge, background: "rgba(59,130,246,0.15)", color: "#3b82f6" }}>GROSS</span>
                              ) : row.attractive ? (
                                <span style={{ ...S.badge, background: "rgba(16,185,129,0.15)", color: "#10b981" }}>ATTRACTIVE</span>
                              ) : (
                                <span style={{ ...S.badge, background: "rgba(239,68,68,0.1)", color: "#ef4444" }}>UNATTRACTIVE</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div style={{ marginTop: 6, fontSize: 9, color: "rgba(255,255,255,0.3)", lineHeight: 1.5 }}>
                      Break-even funding spread: {carryData.carryDecomposition.breakEvenSpreadBps} bps. CP-OIS from Rime, Schrimpf &amp; Syrstad (2022) Table 1.
                    </div>
                  </div>
                )}

                <div style={{ padding: 10, background: "#0d1117", borderRadius: 4, border: "1px solid #21262d", marginBottom: 14 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.5)", marginBottom: 6 }}>RATE DIFFERENTIAL BREAKDOWN</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                        <span style={{ fontSize: 12 }}>
                          <span style={{ color: "#F44336", fontWeight: 600 }}>NOK</span>
                          <span style={{ color: "rgba(255,255,255,0.5)" }}> (3M Nibor)</span>
                        </span>
                        <span style={{ fontSize: 14, fontWeight: 700, color: "#F44336" }}>{carryData.rates?.nokRate?.toFixed(2)}%</span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                        <span style={{ fontSize: 12 }}>
                          <span style={{ color: CCY_COLORS[fwdPair.replace("NOK", "")] || "rgba(255,255,255,0.5)", fontWeight: 600 }}>{fwdPair.replace("NOK", "")}</span>
                          <span style={{ color: "rgba(255,255,255,0.5)" }}> (3M rate)</span>
                        </span>
                        <span style={{ fontSize: 14, fontWeight: 700, color: CCY_COLORS[fwdPair.replace("NOK", "")] || "rgba(255,255,255,0.5)" }}>
                          {carryData.rates?.foreignRate?.toFixed(2)}%
                        </span>
                      </div>
                      <div style={{ height: 1, background: "#30363d", margin: "4px 0" }} />
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span style={{ fontSize: 12, color: "rgba(255,255,255,0.5)" }}>Carry (NOK - {fwdPair.replace("NOK", "")})</span>
                        <span style={{ fontSize: 14, fontWeight: 700, color: carryData.rates?.differential > 0 ? "#10b981" : "#ef4444" }}>
                          {fmtPct(carryData.rates?.differential, 2)}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Cumulative P&L chart */}
                {carryData.cumulativePnl?.length > 2 && (
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.5)", marginBottom: 6 }}>CUMULATIVE P&amp;L (CARRY + SPOT RETURN)</div>
                    <CarryPnlChart data={carryData.cumulativePnl} />
                  </div>
                )}
              </>
            ) : (
              <div style={S.dim}>Loading carry data...</div>
            )}
          </div>
        </div>

        {/* CIP Arbitrage Monitor (Rime, Schrimpf & Syrstad 2022 — Section 2.1, Table 3) */}
        <div style={S.card}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
            <div style={{ ...S.cardTitle, marginBottom: 0, flex: 1 }}>CIP ARBITRAGE MONITOR</div>
            <div style={{ display: "flex", gap: 4 }}>
              {["1M", "3M", "6M"].map(t => (
                <div
                  key={t}
                  onClick={() => setArbTenor(t)}
                  style={{ ...S.badge, cursor: "pointer", background: arbTenor === t ? "rgba(59,130,246,0.2)" : "#0d1117", color: arbTenor === t ? "#3b82f6" : "rgba(255,255,255,0.4)", border: arbTenor === t ? "1px solid #3b82f6" : "1px solid #30363d" }}
                >
                  {t}
                </div>
              ))}
            </div>
          </div>
          <HelpToggle id="arb-monitor-help" label="What is CIP arbitrage?" showHelp={showHelp} setShowHelp={setShowHelp}>
            CIP arbitrage profit = forward premium minus the cost of dollar funding (OIS + CP-OIS spread). High-rated banks (A-1/P-1) pay ~19 bps above OIS; mid-rated (A-2/P-2) pay ~36 bps (Rime et al. 2022, Table 1). Positive profit signals a genuine covered interest arbitrage opportunity, though balance-sheet constraints may prevent exploitation.
          </HelpToggle>
          {arbData?.results ? (
            <div style={{ overflowX: "auto" as const }}>
              <table style={S.table}>
                <thead>
                  <tr>
                    <th style={S.th}>PAIR</th>
                    <th style={{ ...S.th, textAlign: "right" as const }}>SPOT</th>
                    <th style={{ ...S.th, textAlign: "right" as const }}>FWD PREMIUM</th>
                    <th style={{ ...S.th, textAlign: "right" as const }}>OIS BASIS</th>
                    <th style={{ ...S.th, textAlign: "right" as const }}>ARB PROFIT (HIGH)</th>
                    <th style={{ ...S.th, textAlign: "right" as const }}>ARB PROFIT (MID)</th>
                    <th style={{ ...S.th, textAlign: "center" as const }}>SIGNAL</th>
                  </tr>
                </thead>
                <tbody>
                  {arbData.results.map((p: any) => {
                    const signalColor = p.signal === "POSITIVE_ARB" ? "#10b981" : p.signal === "MARGINAL" ? "#f59e0b" : "rgba(255,255,255,0.4)";
                    const signalLabel = p.signal === "POSITIVE_ARB" ? "POSITIVE ARB" : p.signal === "MARGINAL" ? "MARGINAL" : "NO ARB";
                    return (
                      <tr key={p.pair}>
                        <td style={{ ...S.td, fontWeight: 600, color: CCY_COLORS[p.pair.replace("NOK", "")] || "#fff" }}>
                          {PAIR_LABELS[p.pair] || p.pair}
                        </td>
                        <td style={{ ...S.td, textAlign: "right" as const }}>{p.spot?.toFixed(4)}</td>
                        <td style={{ ...S.td, textAlign: "right" as const, color: (p.forwardPremiumBps ?? 0) > 0 ? "#10b981" : "#ef4444" }}>
                          {p.forwardPremiumBps != null ? `${p.forwardPremiumBps >= 0 ? "+" : ""}${p.forwardPremiumBps.toFixed(1)} bps` : "—"}
                        </td>
                        <td style={{ ...S.td, textAlign: "right" as const, color: (p.oisBasisBps ?? 0) < 0 ? "#ef4444" : "#10b981" }}>
                          {p.oisBasisBps != null ? `${p.oisBasisBps >= 0 ? "+" : ""}${p.oisBasisBps.toFixed(1)} bps` : "—"}
                        </td>
                        <td style={{ ...S.td, textAlign: "right" as const, fontWeight: 700, color: (p.arbProfitHighRatedBps ?? 0) > 0 ? "#10b981" : "#ef4444" }}>
                          {p.arbProfitHighRatedBps != null ? `${p.arbProfitHighRatedBps >= 0 ? "+" : ""}${p.arbProfitHighRatedBps.toFixed(1)} bps` : "—"}
                        </td>
                        <td style={{ ...S.td, textAlign: "right" as const, color: (p.arbProfitMidRatedBps ?? 0) > 0 ? "#10b981" : "#ef4444" }}>
                          {p.arbProfitMidRatedBps != null ? `${p.arbProfitMidRatedBps >= 0 ? "+" : ""}${p.arbProfitMidRatedBps.toFixed(1)} bps` : "—"}
                        </td>
                        <td style={{ ...S.td, textAlign: "center" as const }}>
                          <span style={{ ...S.badge, background: `${signalColor}18`, color: signalColor, border: `1px solid ${signalColor}40` }}>
                            {signalLabel}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div style={{ marginTop: 8, fontSize: 9, color: "rgba(255,255,255,0.3)", lineHeight: 1.5 }}>
                ARB PROFIT = forward premium − (USD OIS rate + CP-OIS spread − foreign CB deposit rate). Positive &gt;5 bps = POSITIVE ARB. 0–5 bps = MARGINAL.
              </div>

              {/* Collapsible beginner glossary */}
              <HelpToggle id="arb-glossary" label="Explain CIP, OIS and CP-OIS in plain English" showHelp={showHelp} setShowHelp={setShowHelp}>
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

                  <div>
                    <div style={{ fontWeight: 700, color: "rgba(255,255,255,0.7)", marginBottom: 4, fontSize: 11 }}>What is CIP — Covered Interest Parity?</div>
                    <div style={{ lineHeight: 1.7 }}>
                      CIP is a fundamental rule of finance: if you borrow in one currency, swap it into another, invest it, then swap back at the end — you should break even. No free lunch.<br/>
                      <span style={{ color: "rgba(255,255,255,0.5)" }}>Example: Borrow USD → convert to NOK via FX swap → invest in NOK → convert back to USD at a pre-agreed rate. If CIP holds perfectly, the gain from the higher NOK interest rate is exactly offset by the cost of the FX swap. The "basis" measures how far reality deviates from this ideal.</span>
                    </div>
                  </div>

                  <div>
                    <div style={{ fontWeight: 700, color: "rgba(255,255,255,0.7)", marginBottom: 4, fontSize: 11 }}>What is the Forward Premium?</div>
                    <div style={{ lineHeight: 1.7 }}>
                      The forward rate is a pre-agreed exchange rate for a future date. The forward premium is how much more expensive (or cheaper) the forward rate is vs. the current spot rate, expressed as an annual percentage in basis points (100 bps = 1%).<br/>
                      <span style={{ color: "rgba(255,255,255,0.5)" }}>For USD/NOK at +38 bps: if you agree today to buy USD in 6 months, it costs you about 0.38% per year more than buying USD right now. This reflects the fact that NOK interest rates are currently lower than USD rates.</span>
                    </div>
                  </div>

                  <div>
                    <div style={{ fontWeight: 700, color: "rgba(255,255,255,0.7)", marginBottom: 4, fontSize: 11 }}>What is the OIS Rate?</div>
                    <div style={{ lineHeight: 1.7 }}>
                      OIS stands for Overnight Index Swap. It is the market&apos;s best estimate of the risk-free borrowing rate for a given currency over a period — essentially the average expected central bank rate. USD OIS tracks SOFR (the rate US banks pay each other overnight).<br/>
                      <span style={{ color: "rgba(255,255,255,0.5)" }}>The OIS rate is considered near-risk-free. USD OIS is currently around 4.5%. This is the baseline cost of funding in dollars before any bank credit premium is added.</span>
                    </div>
                  </div>

                  <div>
                    <div style={{ fontWeight: 700, color: "rgba(255,255,255,0.7)", marginBottom: 4, fontSize: 11 }}>What is the CP-OIS Spread?</div>
                    <div style={{ lineHeight: 1.7 }}>
                      Most banks do not borrow at the pure OIS rate. They borrow by issuing short-term commercial paper (CP) — essentially short-term IOUs sold to money market funds. The CP rate is always somewhat above OIS because investors demand a small premium for lending to a bank rather than a central bank.<br/>
                      <span style={{ color: "rgba(255,255,255,0.5)" }}>High-rated banks (strongest credit, A-1/P-1 rating): ~19 bps above OIS.<br/>Mid-rated banks (A-2/P-2 rating): ~36 bps above OIS.<br/>So a high-rated bank borrowing USD for 6 months pays roughly 4.5% + 0.19% = 4.69% per year.</span>
                    </div>
                  </div>

                  <div>
                    <div style={{ fontWeight: 700, color: "rgba(255,255,255,0.7)", marginBottom: 4, fontSize: 11 }}>Why does the table show NO ARB everywhere?</div>
                    <div style={{ lineHeight: 1.7 }}>
                      For a CIP arbitrage to work, the forward premium must exceed the cost of funding in USD. Currently USD rates (~4.5%) are much higher than NOK rates (~4.5% too, but the forward premium reflects only the small differential). After paying the CP-OIS funding spread on top, the total USD funding cost (~4.7%) swamps any profit from the trade.<br/>
                      <span style={{ color: "rgba(255,255,255,0.5)" }}>CIP deviations that generate real profit are rare and typically only appear during credit stress events (like March 2020 or quarter-ends) when the basis widens sharply. In normal times, the numbers here will show NO ARB — which is the expected, healthy result.</span>
                    </div>
                  </div>

                  <div>
                    <div style={{ fontWeight: 700, color: "rgba(255,255,255,0.7)", marginBottom: 4, fontSize: 11 }}>What is the OIS Basis (CIP Deviation)?</div>
                    <div style={{ lineHeight: 1.7 }}>
                      The OIS basis measures how far the forward premium deviates from the pure interest rate differential. A perfectly functioning market would give a basis of exactly 0. A negative basis (the common case) means FX swaps are relatively cheap — banks implicitly subsidise dollar funding via the swap market rather than issuing CP directly.<br/>
                      <span style={{ color: "rgba(255,255,255,0.5)" }}>The small negative numbers here (−1 to −5 bps) are typical of a well-functioning market. During the 2008 crisis or COVID-19 shock, this number reached −100 bps or more.</span>
                    </div>
                  </div>

                </div>
              </HelpToggle>
            </div>
          ) : (
            <div style={S.dim}>Loading arbitrage data... (Ensure interest_rates table is seeded)</div>
          )}
        </div>
      </>
    );
  }

  /* ================================================================ */
  /* TAB 6: PAIRS TRADING                                             */
  /* ================================================================ */
  /* TAB 6: PAIRS TRADING — LIVE SIMULATION                          */
  /* ================================================================ */

  function renderPairs() {
    const PAIR_CONFIGS = [
      { key: "NOKGBP_NOKEUR", labelY: "GBP/NOK", labelX: "EUR/NOK", short: "GBP ↔ EUR", color: "#10b981", desc: "Most divergent — post-Brexit BoE vs ECB dynamics" },
      { key: "NOKEUR_NOKUSD", labelY: "EUR/NOK", labelX: "USD/NOK", short: "EUR ↔ USD", color: "#3b82f6", desc: "Fed vs ECB policy divergence — global risk appetite" },
      { key: "NOKGBP_NOKUSD", labelY: "GBP/NOK", labelX: "USD/NOK", short: "GBP ↔ USD", color: "#9C27B0", desc: "Tightly co-integrated — low divergence, few signals" },
    ];
    const config = PAIR_CONFIGS.find(p => p.key === pairsSelectedPair) ?? PAIR_CONFIGS[0];
    const series: any[] = pairsData?.series ?? [];
    const allTrades: any[] = pairsData?.trades ?? [];
    const hasStarted = pairsPlayIdx >= 0;
    const liveSeries = hasStarted ? series.slice(0, pairsPlayIdx + 1) : [];
    const currentPt = liveSeries[liveSeries.length - 1] ?? null;

    // Active trade at current sim point
    const activeTrade = currentPt
      ? allTrades.find((t: any) => t.entryDate <= currentPt.date && t.exitDate > currentPt.date) ?? null
      : null;

    // Completed trades up to now
    const completedTrades = currentPt
      ? allTrades.filter((t: any) => t.exitDate <= currentPt.date)
      : [];

    // Running equity from closed trades — start at first trade (not series[0]) to avoid long flat burn-in line
    let equityVal = 100;
    const equityCurve: { date: string; value: number }[] = completedTrades.length > 0
      ? [{ date: completedTrades[0].entryDate, value: 100 }]
      : [];
    for (const t of completedTrades) {
      equityVal *= (1 + t.pnlPct / 100);
      equityCurve.push({ date: t.exitDate, value: Math.round(equityVal * 100) / 100 });
    }

    // Friction totals for display
    const totalCostBps = pairsBidAskBps * 2 + pairsSlippageBps + pairsCommBps;

    // Unrealized P&L — same z-score anchored formula as closed trades
    let unrealPnl = 0;
    if (activeTrade && currentPt) {
      const zChange = currentPt.zscore - activeTrade.entryZ;
      const directedZCapture = activeTrade.direction === "long" ? zChange : -zChange;
      const sv = activeTrade.entrySpreadVol || 0.01;
      const fixedCostInZ = sv > 1e-8 ? (5 / 10000) / sv : 0.15;
      const costInZ = Math.max(fixedCostInZ, 0.15);
      unrealPnl = (directedZCapture - costInZ) * (pairsPosSize / 10);
    }

    const totalEquity = equityVal * (1 + unrealPnl / 100);
    const totalReturn = totalEquity - 100;
    const wins = completedTrades.filter((t: any) => t.pnlPct > 0).length;
    const winRate = completedTrades.length > 0 ? wins / completedTrades.length * 100 : 0;
    let maxDD = 0, peak = 100;
    for (const e of equityCurve) { if (e.value > peak) peak = e.value; const dd = (e.value - peak) / peak * 100; if (dd < maxDD) maxDD = dd; }
    const progress = (hasStarted && series.length > 0) ? (pairsPlayIdx / (series.length - 1)) * 100 : 0;
    const posColor = activeTrade ? (activeTrade.direction === "long" ? "#10b981" : "#ef4444") : "#30363d";
    const posBg = activeTrade ? (activeTrade.direction === "long" ? "rgba(16,185,129,0.07)" : "rgba(239,68,68,0.07)") : "transparent";
    const holdDays = activeTrade && currentPt ? liveSeries.filter((s: any) => s.date >= activeTrade.entryDate).length : 0;
    const proxStart = pairsEntryZ * 0.67;  // starts filling at ~2/3 of entry threshold
    const longProx = currentPt ? Math.max(0, Math.min(1, (-currentPt.zscore - proxStart) / (pairsEntryZ - proxStart))) : 0;
    const shortProx = currentPt ? Math.max(0, Math.min(1, (currentPt.zscore - proxStart) / (pairsEntryZ - proxStart))) : 0;

    return (
      <>
        <style>{`
          @keyframes pGlow { 0%,100% { box-shadow: 0 0 8px ${posColor}50; } 50% { box-shadow: 0 0 22px ${posColor}90, 0 0 40px ${posColor}30; } }
          @keyframes pBlink { 0%,100% { opacity:1; } 50% { opacity:0.15; } }
          @keyframes pSlide { from { opacity:0; transform:translateY(-5px); } to { opacity:1; transform:translateY(0); } }
        `}</style>

        {/* Pair selector + timeframe */}
        <div style={{ display: "flex", alignItems: "stretch", borderBottom: "1px solid #30363d", marginBottom: 0, flexWrap: "wrap" as const }}>
          {PAIR_CONFIGS.map(p => (
            <button key={p.key} onClick={() => { if (pairsSelectedPair !== p.key) { setPairsSelectedPair(p.key); setPairsIsPlaying(false); } }}
              style={{ padding: "10px 18px", background: pairsSelectedPair === p.key ? "rgba(59,130,246,0.1)" : "transparent",
                border: "none", borderBottom: pairsSelectedPair === p.key ? `2px solid ${p.color}` : "2px solid transparent",
                color: pairsSelectedPair === p.key ? "#fff" : "rgba(255,255,255,0.35)", cursor: "pointer",
                fontSize: 11, fontWeight: 700, fontFamily: "monospace", letterSpacing: "0.06em", whiteSpace: "nowrap" as const }}>
              {p.short}
            </button>
          ))}
          {/* Separator */}
          <div style={{ width: 1, background: "#30363d", margin: "8px 8px" }} />
          {/* Timeframe buttons */}
          {([{ label: "3Y", days: 756 }, { label: "5Y", days: 1260 }] as { label: string; days: number }[]).map(tf => (
            <button key={tf.days} onClick={() => { setPairsDays(tf.days); setPairsIsPlaying(false); }}
              style={{ padding: "10px 14px", background: pairsDays === tf.days ? "rgba(59,130,246,0.1)" : "transparent",
                border: "none", borderBottom: pairsDays === tf.days ? "2px solid #3b82f6" : "2px solid transparent",
                color: pairsDays === tf.days ? "#3b82f6" : "rgba(255,255,255,0.3)", cursor: "pointer",
                fontSize: 10, fontWeight: 700, fontFamily: "monospace", letterSpacing: "0.06em" }}>
              {tf.label}
            </button>
          ))}
          <div style={{ padding: "0 14px", fontSize: 9, color: "rgba(255,255,255,0.25)", alignSelf: "center", marginLeft: "auto" }}>
            {config.desc} · δ=1e-5 · 60-bar rolling z · ±{pairsEntryZ}σ ENTRY · ±{pairsExitZ}σ EXIT · ±{pairsStopZ}σ STOP
          </div>
        </div>

        {/* How it works — collapsible guide */}
        <div style={{ margin: "8px 0 0", borderRadius: 6, overflow: "hidden", border: "1px solid #21262d" }}>
          <button onClick={() => setPairsShowGuide(v => !v)}
            style={{ width: "100%", background: "#0d1117", border: "none", padding: "9px 14px", cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "space-between", fontFamily: "monospace" }}>
            <span style={{ fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.45)", letterSpacing: "0.08em", textTransform: "uppercase" as const }}>
              ℹ HOW IT WORKS — Kalman Filter Pairs Trading Guide
            </span>
            <span style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", letterSpacing: "0.05em" }}>
              {pairsShowGuide ? "▲ COLLAPSE" : "▼ EXPAND"}
            </span>
          </button>
          {pairsShowGuide && (
            <div style={{ background: "#0a0f16", padding: "16px 20px", borderTop: "1px solid #21262d", fontSize: 11, color: "rgba(255,255,255,0.65)", lineHeight: 1.65 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 20 }}>

                {/* Col 1: Strategy */}
                <div>
                  <div style={{ fontSize: 9, fontWeight: 700, color: "#3b82f6", letterSpacing: "0.1em", textTransform: "uppercase" as const, marginBottom: 10 }}>
                    THE STRATEGY
                  </div>
                  <p style={{ margin: "0 0 8px", color: "rgba(255,255,255,0.7)" }}>
                    <strong style={{ color: "#fff" }}>Pairs trading</strong> exploits the historical co-movement between two FX rates that share the same base currency (NOK). When one rate temporarily diverges from the other, we bet on reversion to their long-run equilibrium.
                  </p>
                  <p style={{ margin: "0 0 8px" }}>
                    Instead of a fixed hedge ratio, this simulator uses a <strong style={{ color: "#10b981" }}>Kalman filter</strong> — a Bayesian algorithm that continuously updates the estimated relationship between the two pairs as macro conditions evolve. This adapts to regime changes (e.g. post-Brexit BoE policy vs ECB).
                  </p>
                  <p style={{ margin: 0 }}>
                    The pairs are NOK-denominated: <strong style={{ color: "#10b981" }}>GBP/NOK vs EUR/NOK</strong> (most signals), <strong style={{ color: "#3b82f6" }}>EUR/NOK vs USD/NOK</strong> (Fed/ECB divergence), and <strong style={{ color: "#9C27B0" }}>GBP/NOK vs USD/NOK</strong> (tightly co-integrated, fewer trades).
                  </p>
                </div>

                {/* Col 2: Signals & Charts */}
                <div>
                  <div style={{ fontSize: 9, fontWeight: 700, color: "#10b981", letterSpacing: "0.1em", textTransform: "uppercase" as const, marginBottom: 10 }}>
                    READING THE CHARTS
                  </div>
                  <div style={{ marginBottom: 10 }}>
                    <span style={{ color: "#fff", fontWeight: 700 }}>Z-Score chart (top left)</span>
                    <span style={{ color: "rgba(255,255,255,0.55)" }}> — Shows the normalised spread between the two pairs over the last 90 days. The z-score measures how many standard deviations the spread is from its rolling mean. Dashed green lines = entry thresholds; dashed red lines = stop-loss. <strong style={{ color: "#10b981" }}>Green dot</strong> = long entry, <strong style={{ color: "#ef4444" }}>red dot</strong> = short entry, <strong style={{ color: "#9E9E9E" }}>white dot</strong> = take-profit exit.</span>
                  </div>
                  <div style={{ marginBottom: 10 }}>
                    <span style={{ color: "#fff", fontWeight: 700 }}>Equity curve (bottom left)</span>
                    <span style={{ color: "rgba(255,255,255,0.55)" }}> — Compounded P&L of all closed trades indexed to 100. Does not include open unrealised P&L.</span>
                  </div>
                  <div style={{ marginBottom: 10 }}>
                    <span style={{ color: "#fff", fontWeight: 700 }}>Rolling hedge ratio β (bottom centre)</span>
                    <span style={{ color: "rgba(255,255,255,0.55)" }}> — The Kalman filter's current estimate of how many units of X to short per unit of Y. β drifting away from 1.0 signals a regime change — the two pairs are no longer moving in lockstep.</span>
                  </div>
                  <div>
                    <span style={{ color: "#fff", fontWeight: 700 }}>Position monitor (top right)</span>
                    <span style={{ color: "rgba(255,255,255,0.55)" }}> — Bell-curve shows current z-score position vs entry/stop thresholds. <strong style={{ color: "#10b981" }}>LONG</strong> = bought the spread (z too negative, expect reversion up). <strong style={{ color: "#ef4444" }}>SHORT</strong> = sold the spread (z too positive, expect reversion down).</span>
                  </div>
                </div>

                {/* Col 3: Parameters */}
                <div>
                  <div style={{ fontSize: 9, fontWeight: 700, color: "#f59e0b", letterSpacing: "0.1em", textTransform: "uppercase" as const, marginBottom: 10 }}>
                    PARAMETERS & CONTROLS
                  </div>
                  <div style={{ display: "flex", flexDirection: "column" as const, gap: 7 }}>
                    {[
                      { label: "Entry z (±σ)", color: "#10b981", desc: "How far the spread must deviate before entering a trade. Lower = more trades, higher noise. Higher = fewer trades, cleaner signals. Default ±1.6σ." },
                      { label: "Exit z (±σ)", color: "#3b82f6", desc: "How close the spread must revert before closing at profit. 0 = full mean reversion. Higher = exit earlier, smaller gains per trade. Default ±0.6σ." },
                      { label: "Stop loss (±σ)", color: "#ef4444", desc: "Maximum adverse spread move before cutting the loss. Should be >entry to give the trade room. Default ±2.8σ." },
                      { label: "Position size", color: "#f59e0b", desc: "% of NAV allocated per trade. Scales all P&L figures linearly. 10% NAV at 1σ capture ≈ 1% portfolio P&L." },
                      { label: "Friction costs", color: "rgba(255,255,255,0.5)", desc: "Bid-ask spread + slippage + commission. Deducted from every trade. Institutional FX: bid-ask ~1 bps/side, total ~3 bps round-trip." },
                      { label: "Speed (1x–10x)", color: "rgba(255,255,255,0.5)", desc: "Simulation playback speed. 1x = 1 bar per tick, 10x = 10 bars. Use 5x for a quick overview, 1x to watch individual trades form." },
                    ].map(({ label, color, desc }) => (
                      <div key={label} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                        <span style={{ color, fontWeight: 700, minWidth: 100, fontSize: 10, flexShrink: 0, paddingTop: 1 }}>{label}</span>
                        <span style={{ color: "rgba(255,255,255,0.5)", fontSize: 10 }}>{desc}</span>
                      </div>
                    ))}
                  </div>
                  <div style={{ marginTop: 12, padding: "8px 10px", background: "rgba(59,130,246,0.07)", borderRadius: 4, border: "1px solid rgba(59,130,246,0.2)", fontSize: 10, color: "rgba(255,255,255,0.5)" }}>
                    <strong style={{ color: "#3b82f6" }}>Workflow:</strong> Adjust parameters → press <strong style={{ color: "#fff" }}>RESET</strong> to apply → press <strong style={{ color: "#10b981" }}>PLAY</strong> to run. Pressing PLAY at end auto-resets and replays.
                  </div>
                </div>

              </div>
            </div>
          )}
        </div>

        {/* Friction & cost parameters */}
        <div style={{ background: "#0d1117", border: "1px solid #21262d", borderRadius: 6, padding: "12px 16px", margin: "8px 0 4px" }}>
          <div style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", letterSpacing: "0.08em", marginBottom: 10, textTransform: "uppercase" as const }}>
            Real-World Friction Parameters
            <span style={{ marginLeft: 12, color: "#f59e0b", fontSize: 9 }}>
              TOTAL COST: {totalCostBps.toFixed(1)} bps/trade = {(totalCostBps / 100).toFixed(3)}% · POSITION: {pairsPosSize}% NAV
            </span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
            {/* Position Size */}
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: "rgba(255,255,255,0.45)", marginBottom: 4 }}>
                <span>POSITION SIZE</span>
                <span style={{ color: "#3b82f6", fontWeight: 700 }}>{pairsPosSize}% NAV</span>
              </div>
              <input type="range" min={2} max={40} step={1} value={pairsPosSize}
                onChange={e => setPairsPosSize(+e.target.value)}
                style={{ ...S.slider, display: "block", width: "100%" }} />
              <div style={{ fontSize: 8, color: "rgba(255,255,255,0.2)", marginTop: 2 }}>Higher → larger returns & risk</div>
            </div>
            {/* Bid-Ask */}
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: "rgba(255,255,255,0.45)", marginBottom: 4 }}>
                <span>BID/ASK SPREAD</span>
                <span style={{ color: "#f59e0b", fontWeight: 700 }}>{pairsBidAskBps.toFixed(1)} bps/side</span>
              </div>
              <input type="range" min={0.5} max={10} step={0.5} value={pairsBidAskBps}
                onChange={e => setPairsBidAskBps(+e.target.value)}
                style={{ ...S.slider, display: "block", width: "100%" }} />
              <div style={{ fontSize: 8, color: "rgba(255,255,255,0.2)", marginTop: 2 }}>×2 round-trip = {(pairsBidAskBps * 2).toFixed(1)} bps · EUR/USD ~0.5, GBP ~1.0</div>
            </div>
            {/* Slippage */}
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: "rgba(255,255,255,0.45)", marginBottom: 4 }}>
                <span>MARKET IMPACT</span>
                <span style={{ color: "#f59e0b", fontWeight: 700 }}>{pairsSlippageBps.toFixed(1)} bps</span>
              </div>
              <input type="range" min={0} max={10} step={0.5} value={pairsSlippageBps}
                onChange={e => setPairsSlippageBps(+e.target.value)}
                style={{ ...S.slider, display: "block", width: "100%" }} />
              <div style={{ fontSize: 8, color: "rgba(255,255,255,0.2)", marginTop: 2 }}>Minimal in FX — $7.5T daily volume</div>
            </div>
            {/* Commission */}
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: "rgba(255,255,255,0.45)", marginBottom: 4 }}>
                <span>COMMISSION</span>
                <span style={{ color: "#f59e0b", fontWeight: 700 }}>{pairsCommBps.toFixed(1)} bps</span>
              </div>
              <input type="range" min={0} max={5} step={0.25} value={pairsCommBps}
                onChange={e => setPairsCommBps(+e.target.value)}
                style={{ ...S.slider, display: "block", width: "100%" }} />
              <div style={{ fontSize: 8, color: "rgba(255,255,255,0.2)", marginTop: 2 }}>Prime broker / clearing fees</div>
            </div>
          </div>
        </div>

        {/* Signal Threshold card — separate from friction */}
        <div style={{ background: "#0d1117", border: "1px solid #21262d", borderRadius: 6, padding: "12px 16px", margin: "6px 0 0" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <span style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", letterSpacing: "0.08em", textTransform: "uppercase" as const }}>Signal Thresholds</span>
            <span style={{ fontSize: 8, color: "rgba(255,255,255,0.2)" }}>Adjust then RESET + PLAY to re-run</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 20 }}>
            {/* Entry Z */}
            {(() => {
              const pct = ((pairsEntryZ - 1.0) / (3.0 - 1.0)) * 100;
              return (
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
                    <span style={{ fontSize: 9, color: "rgba(255,255,255,0.5)", letterSpacing: "0.06em" }}>ENTRY</span>
                    <span style={{ fontSize: 16, fontWeight: 800, color: "#10b981", fontFamily: "monospace" }}>±{pairsEntryZ.toFixed(1)}<span style={{ fontSize: 9, fontWeight: 400, color: "rgba(16,185,129,0.7)" }}>σ</span></span>
                  </div>
                  <div style={{ position: "relative", height: 20, display: "flex", alignItems: "center" }}>
                    <div style={{ position: "absolute", left: 0, right: 0, height: 4, borderRadius: 2, background: `linear-gradient(to right, #10b981 ${pct}%, rgba(255,255,255,0.08) ${pct}%)` }} />
                    <input type="range" min={1.0} max={3.0} step={0.1} value={pairsEntryZ}
                      onChange={e => { setPairsEntryZ(+e.target.value); setPairsIsPlaying(false); setPairsPlayIdx(-1); }}
                      className="pairs-range pairs-range-green"
                      style={{ position: "absolute", left: 0, right: 0, width: "100%", opacity: 0, cursor: "pointer", height: 20, margin: 0 }} />
                  </div>
                  <div style={{ fontSize: 7.5, color: "rgba(255,255,255,0.18)", marginTop: 4 }}>Lower = more signals · min 1.0σ</div>
                </div>
              );
            })()}
            {/* Exit Z */}
            {(() => {
              const pct = ((pairsExitZ - 0.0) / (1.5 - 0.0)) * 100;
              return (
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
                    <span style={{ fontSize: 9, color: "rgba(255,255,255,0.5)", letterSpacing: "0.06em" }}>EXIT (TAKE PROFIT)</span>
                    <span style={{ fontSize: 16, fontWeight: 800, color: "#3b82f6", fontFamily: "monospace" }}>±{pairsExitZ.toFixed(1)}<span style={{ fontSize: 9, fontWeight: 400, color: "rgba(59,130,246,0.7)" }}>σ</span></span>
                  </div>
                  <div style={{ position: "relative", height: 20, display: "flex", alignItems: "center" }}>
                    <div style={{ position: "absolute", left: 0, right: 0, height: 4, borderRadius: 2, background: `linear-gradient(to right, #3b82f6 ${pct}%, rgba(255,255,255,0.08) ${pct}%)` }} />
                    <input type="range" min={0.0} max={1.5} step={0.1} value={pairsExitZ}
                      onChange={e => { setPairsExitZ(+e.target.value); setPairsIsPlaying(false); setPairsPlayIdx(-1); }}
                      style={{ position: "absolute", left: 0, right: 0, width: "100%", opacity: 0, cursor: "pointer", height: 20, margin: 0 }} />
                  </div>
                  <div style={{ fontSize: 7.5, color: "rgba(255,255,255,0.18)", marginTop: 4 }}>0 = full reversion · higher = quicker exit</div>
                </div>
              );
            })()}
            {/* Stop Z */}
            {(() => {
              const pct = ((pairsStopZ - 1.5) / (5.0 - 1.5)) * 100;
              return (
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
                    <span style={{ fontSize: 9, color: "rgba(255,255,255,0.5)", letterSpacing: "0.06em" }}>STOP LOSS</span>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                      <span style={{ fontSize: 10, color: "rgba(255,255,255,0.25)", fontFamily: "monospace" }}>+{(pairsStopZ - pairsEntryZ).toFixed(1)}σ buffer</span>
                      <span style={{ fontSize: 16, fontWeight: 800, color: "#ef4444", fontFamily: "monospace" }}>±{pairsStopZ.toFixed(1)}<span style={{ fontSize: 9, fontWeight: 400, color: "rgba(239,68,68,0.7)" }}>σ</span></span>
                    </div>
                  </div>
                  <div style={{ position: "relative", height: 20, display: "flex", alignItems: "center" }}>
                    <div style={{ position: "absolute", left: 0, right: 0, height: 4, borderRadius: 2, background: `linear-gradient(to right, #ef4444 ${pct}%, rgba(255,255,255,0.08) ${pct}%)` }} />
                    <input type="range" min={1.5} max={5.0} step={0.1} value={pairsStopZ}
                      onChange={e => { setPairsStopZ(+e.target.value); setPairsIsPlaying(false); setPairsPlayIdx(-1); }}
                      style={{ position: "absolute", left: 0, right: 0, width: "100%", opacity: 0, cursor: "pointer", height: 20, margin: 0 }} />
                  </div>
                  <div style={{ fontSize: 7.5, color: "rgba(255,255,255,0.18)", marginTop: 4 }}>Wider = fewer stops · risk per trade ↑</div>
                </div>
              );
            })()}
          </div>
        </div>

        {/* Control bar */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 0 16px", flexWrap: "wrap" as const }}>
          <button onClick={() => {
              const atEnd = hasStarted && pairsPlayIdx >= series.length - 1;
              if (pairsPlayIdx < 0 || atEnd) {
                // First play or replay from end — auto-reset then start
                setPairsIsPlaying(false);
                const firstTrade = [...(pairsData?.trades ?? [])].sort((a, b) => a.entryDate.localeCompare(b.entryDate))[0];
                const startIdx = firstTrade
                  ? Math.max(0, (pairsData?.series ?? []).findIndex((s: any) => s.date >= firstTrade.entryDate) - 5)
                  : 0;
                setTimeout(() => { setPairsPlayIdx(startIdx); setPairsIsPlaying(true); }, 50);
              } else {
                setPairsIsPlaying(p => !p);
              }
            }}
            disabled={!pairsData}
            style={{ ...S.button, padding: "8px 20px", minWidth: 96, opacity: !pairsData ? 0.5 : 1, fontSize: 12, letterSpacing: 1 }}>
            {pairsIsPlaying ? "⏸ PAUSE" : "▶  PLAY"}
          </button>
          <button onClick={() => { setPairsIsPlaying(false); setTimeout(() => setPairsPlayIdx(-1), 50); }}
            style={{ background: "#21262d", border: "1px solid #30363d", color: "rgba(255,255,255,0.6)", borderRadius: 6, padding: "8px 14px", fontSize: 11, cursor: "pointer", fontFamily: "monospace" }}>
            ⏹ RESET
          </button>
          <button onClick={() => setPairsShowDots(v => !v)}
            title="Toggle entry/exit dots on z-score chart"
            style={{ background: pairsShowDots ? "rgba(59,130,246,0.15)" : "#21262d",
              border: `1px solid ${pairsShowDots ? "#3b82f6" : "#30363d"}`,
              color: pairsShowDots ? "#3b82f6" : "rgba(255,255,255,0.4)", borderRadius: 6,
              padding: "8px 14px", fontSize: 11, cursor: "pointer", fontFamily: "monospace", letterSpacing: "0.03em" }}>
            ◉ DOTS {pairsShowDots ? "ON" : "OFF"}
          </button>
          <div style={{ display: "flex", gap: 3 }}>
            {[1, 3, 5, 10].map(s => (
              <button key={s} onClick={() => setPairsSpeed(s)}
                style={{ padding: "6px 11px", background: pairsSpeed === s ? "rgba(59,130,246,0.25)" : "#0d1117",
                  border: `1px solid ${pairsSpeed === s ? "#3b82f6" : "#30363d"}`,
                  color: pairsSpeed === s ? "#3b82f6" : "rgba(255,255,255,0.35)", borderRadius: 4,
                  fontSize: 10, fontWeight: 700, cursor: "pointer", fontFamily: "monospace" }}>
                {s}×
              </button>
            ))}
          </div>
          {/* Progress bar */}
          <div style={{ flex: 1, minWidth: 100 }}>
            <div style={{ background: "#21262d", borderRadius: 3, height: 5, overflow: "hidden" }}>
              <div style={{ width: `${progress.toFixed(1)}%`, height: "100%", background: "linear-gradient(90deg, #3b82f6, #10b981)", transition: "width 0.08s linear", borderRadius: 3 }} />
            </div>
          </div>
          <div style={{ fontSize: 13, fontWeight: 800, color: pairsDataLoading ? "#f59e0b" : "#fff", fontFamily: "monospace", letterSpacing: 1.5, minWidth: 130, textAlign: "right" as const }}>
            {pairsDataLoading ? "⟳ RECALCULATING" : (currentPt?.date ?? "—")}
          </div>
        </div>

        {/* ── Row-aligned layout: each row is its own 2-col grid so panels share height ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>

        {/* ROW 1: Z-score chart | Position Monitor — stretch to same height */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 380px", gap: 10, alignItems: "stretch" }}>

          {/* Z-score live chart */}
          <div style={{ ...S.card, display: "flex", flexDirection: "column" as const }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, flexWrap: "wrap" as const, gap: 8 }}>
              <div style={S.cardTitle}>Z-SCORE LIVE VIEW — {config.labelY} vs {config.labelX} · TRAILING 90 DAYS</div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" as const }}>
                {[{ c: "#3b82f6", l: "Z-score" }, { c: "#10b981", l: `±${pairsEntryZ}σ entry` }, { c: "#ef4444", l: `±${pairsStopZ}σ stop` },
                  { c: "rgba(16,185,129,0.3)", l: "Long pos" }, { c: "rgba(239,68,68,0.3)", l: "Short pos" },
                  ...(pairsShowDots ? [{ c: "#10b981", l: "▲ entry" }, { c: "rgba(255,255,255,0.7)", l: "● exit" }, { c: "#f59e0b", l: "✕ stop" }] : [])
                ].map((l, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 8, color: "rgba(255,255,255,0.35)" }}>
                    <div style={{ width: 14, height: 3, background: l.c, borderRadius: 1 }} />{l.l}
                  </div>
                ))}
              </div>
            </div>
            <div style={{ flex: 1, minHeight: 200 }}>
              {liveSeries.length > 1 ? (
                <PairsZChart series={liveSeries} activeTrade={activeTrade}
                  entryZ={pairsEntryZ} stopZ={pairsStopZ}
                  trades={allTrades} showDots={pairsShowDots} />
              ) : (
                <div style={{ height: "100%", minHeight: 200, display: "flex", alignItems: "center", justifyContent: "center", color: "rgba(255,255,255,0.15)", fontSize: 12 }}>
                  {pairsDataLoading ? "Loading dataset..." : "Press ▶ PLAY to begin the simulation"}
                </div>
              )}
            </div>
          </div>

          {/* POSITION MONITOR — ROW 1 cell 2, stretches to match Z-score chart height */}
          <div style={{ ...S.card, background: posBg, border: `1px solid ${posColor}`, animation: activeTrade ? "pGlow 2s ease-in-out infinite" : "none", padding: "18px 20px", display: "flex", flexDirection: "column" as const }}>
            <div style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", letterSpacing: "0.1em", marginBottom: 8 }}>POSITION MONITOR</div>

            {/* Status header — stable height, no layout shift */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ width: 9, height: 9, borderRadius: "50%", background: posColor, flexShrink: 0,
                  animation: activeTrade ? "pBlink 1.2s ease-in-out infinite" : "none" }} />
                <div style={{ fontSize: 17, fontWeight: 800, color: posColor, letterSpacing: 2 }}>
                  {activeTrade ? (activeTrade.direction === "long" ? "▲  LONG" : "▼  SHORT") : "◌  FLAT"}
                </div>
              </div>
              {/* Inline metadata — no popup boxes */}
              <div style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", fontFamily: "monospace", textAlign: "right" as const }}>
                {activeTrade
                  ? <>{holdDays}d · β={activeTrade.entryBeta}</>
                  : <>{pairsDataLoading ? "loading…" : !hasStarted ? "press PLAY" : `±${pairsEntryZ}σ entry`}</>}
              </div>
            </div>

            {/* Subtitle */}
            <div style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", marginBottom: 8 }}>
              {activeTrade ? `${config.labelY} ↔ ${config.labelX} · entry z=${activeTrade.entryZ}` : config.labelY + " vs " + config.labelX}
            </div>

            {/* Bell curve — flex: 1 so it fills available height */}
            <div style={{ flex: 1, display: "flex", flexDirection: "column" as const, justifyContent: "center" }}>
            {(() => {
              const RANGE = 4, ENTRY = pairsEntryZ, EXIT = pairsExitZ, STOP = pairsStopZ;
              const VW = 100, VH = 54; // viewBox units — compact, professional
              const PX = 4, baseline = VH - 10;
              const zToX = (zv: number) => PX + ((zv + RANGE) / (2 * RANGE)) * (VW - 2 * PX);
              const pdf = (zv: number) => Math.exp(-0.5 * zv * zv);
              const curveH = 28; // fixed curve height — peak at y=(baseline-28), ~16px from top

              const curvePts: string[] = [];
              for (let i = 0; i <= 140; i++) {
                const zv = -RANGE + (2 * RANGE * i) / 140;
                const y = baseline - pdf(zv) * curveH;
                curvePts.push(`${i === 0 ? "M" : "L"}${zToX(zv).toFixed(2)},${y.toFixed(2)}`);
              }
              const fillArea = (z1: number, z2: number) => {
                const pts: string[] = [];
                for (let i = 0; i <= 40; i++) {
                  const zv = z1 + (z2 - z1) * i / 40;
                  pts.push(`${zToX(zv).toFixed(2)},${(baseline - pdf(zv) * curveH).toFixed(2)}`);
                }
                return pts.join(" ") + ` ${zToX(z2).toFixed(2)},${baseline} ${zToX(z1).toFixed(2)},${baseline}`;
              };

              // Current z dot
              const cz = currentPt ? Math.max(-RANGE, Math.min(RANGE, currentPt.zscore)) : 0;
              const dotY = baseline - pdf(cz) * curveH;
              const isLong = activeTrade?.direction === "long";
              const progressing = activeTrade
                ? (isLong ? (currentPt?.zscore ?? 0) > activeTrade.entryZ : (currentPt?.zscore ?? 0) < activeTrade.entryZ)
                : false;
              const dotColor = activeTrade
                ? (progressing ? "#10b981" : "#ef4444")
                : currentPt
                  ? (Math.abs(currentPt.zscore) >= ENTRY ? "#f59e0b" : Math.abs(currentPt.zscore) > ENTRY * 0.75 ? "#3b82f6" : "rgba(255,255,255,0.45)")
                  : "rgba(255,255,255,0.2)";

              return (
                <svg viewBox={`0 0 ${VW} ${VH}`} width="100%" height="auto" style={{ display: "block", overflow: "visible" }}>
                  {/* Zone fills — same in both states */}
                  <polygon points={fillArea(-STOP, -ENTRY)} fill="rgba(16,185,129,0.17)" />
                  <polygon points={fillArea(ENTRY, STOP)} fill="rgba(239,68,68,0.17)" />
                  <polygon points={fillArea(-RANGE, -STOP)} fill="rgba(239,68,68,0.06)" />
                  <polygon points={fillArea(STOP, RANGE)} fill="rgba(239,68,68,0.06)" />
                  {/* Baseline */}
                  <line x1={PX} y1={baseline} x2={VW - PX} y2={baseline} stroke="rgba(255,255,255,0.08)" strokeWidth={0.4} />
                  {/* Bell curve */}
                  <path d={curvePts.join(" ")} stroke="rgba(255,255,255,0.28)" strokeWidth={1.3} fill="none" />
                  {/* Exit lines (always) */}
                  <line x1={zToX(-EXIT)} y1={3} x2={zToX(-EXIT)} y2={baseline} stroke="rgba(255,255,255,0.18)" strokeWidth={0.4} strokeDasharray="1.5,2.5" />
                  <line x1={zToX(EXIT)} y1={3} x2={zToX(EXIT)} y2={baseline} stroke="rgba(255,255,255,0.18)" strokeWidth={0.4} strokeDasharray="1.5,2.5" />
                  {/* Entry / stop lines — differ by state */}
                  {activeTrade ? (
                    <>
                      {/* Entry pin at trade's actual entry z */}
                      <line x1={zToX(Math.max(-RANGE+0.1, Math.min(RANGE-0.1, activeTrade.entryZ)))} y1={3}
                        x2={zToX(Math.max(-RANGE+0.1, Math.min(RANGE-0.1, activeTrade.entryZ)))} y2={baseline}
                        stroke={isLong ? "#10b981" : "#ef4444"} strokeWidth={1.2} strokeDasharray="2,2" opacity={0.75} />
                      {/* Stop line (one-sided) */}
                      <line x1={zToX(isLong ? -STOP : STOP)} y1={3} x2={zToX(isLong ? -STOP : STOP)} y2={baseline}
                        stroke="#ef4444" strokeWidth={0.6} opacity={0.3} />
                      {/* Entry label */}
                      <text x={zToX(Math.max(-RANGE+0.5, Math.min(RANGE-0.5, activeTrade.entryZ)))} y={VH - 1}
                        fontSize={3.5} fill={isLong ? "#10b981" : "#ef4444"} textAnchor="middle" fontFamily="monospace">entry</text>
                    </>
                  ) : (
                    <>
                      {/* Symmetric entry/stop lines */}
                      <line x1={zToX(-ENTRY)} y1={3} x2={zToX(-ENTRY)} y2={baseline} stroke="#10b981" strokeWidth={1} strokeDasharray="2,2" opacity={0.75} />
                      <line x1={zToX(ENTRY)} y1={3} x2={zToX(ENTRY)} y2={baseline} stroke="#ef4444" strokeWidth={1} strokeDasharray="2,2" opacity={0.75} />
                      <line x1={zToX(-STOP)} y1={3} x2={zToX(-STOP)} y2={baseline} stroke="#ef4444" strokeWidth={0.5} opacity={0.28} />
                      <line x1={zToX(STOP)} y1={3} x2={zToX(STOP)} y2={baseline} stroke="#ef4444" strokeWidth={0.5} opacity={0.28} />
                      {/* Entry labels */}
                      <text x={zToX(-ENTRY)} y={VH - 1} fontSize={3.5} fill="#10b981" textAnchor="middle" fontFamily="monospace">−{ENTRY}σ</text>
                      <text x={zToX(ENTRY)} y={VH - 1} fontSize={3.5} fill="#ef4444" textAnchor="middle" fontFamily="monospace">+{ENTRY}σ</text>
                    </>
                  )}
                  {/* Current z dot — always present when data exists */}
                  {currentPt && (
                    <>
                      <line x1={zToX(cz)} y1={dotY + 2.5} x2={zToX(cz)} y2={baseline} stroke={dotColor} strokeWidth={0.9} opacity={0.65} />
                      <circle cx={zToX(cz)} cy={dotY} r={2.5} fill={dotColor} />
                      {/* Z label above dot */}
                      <text x={zToX(cz)} y={dotY - 3} fontSize={3.5} fill={dotColor} textAnchor="middle" fontFamily="monospace" fontWeight="bold">
                        {currentPt.zscore >= 0 ? "+" : ""}{currentPt.zscore.toFixed(2)}σ
                      </text>
                    </>
                  )}
                </svg>
              );
            })()}
            </div>{/* end bell curve flex wrapper */}

            {/* Bottom — fixed height prevents layout jump between FLAT and ACTIVE states */}
            <div style={{ marginTop: 6, height: 50, display: "flex", flexDirection: "column", justifyContent: "center" }}>
              {activeTrade ? (
                <>
                  <div style={{ fontSize: 8, color: "rgba(255,255,255,0.3)", letterSpacing: "0.05em", marginBottom: 2 }}>UNREALIZED P&L</div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: unrealPnl >= 0 ? "#10b981" : "#ef4444", fontFamily: "monospace", lineHeight: 1 }}>
                    {unrealPnl >= 0 ? "+" : ""}{unrealPnl.toFixed(2)}%
                  </div>
                  <div style={{ marginTop: 6, background: "rgba(0,0,0,0.4)", borderRadius: 3, height: 4, overflow: "hidden" }}>
                    <div style={{ width: `${Math.min(100, Math.abs(unrealPnl) / 20 * 100)}%`, height: "100%",
                      background: unrealPnl >= 0 ? "#10b981" : "#ef4444", borderRadius: 3 }} />
                  </div>
                </>
              ) : (
                <div style={{ fontSize: 9, color: currentPt && Math.abs(currentPt.zscore) >= pairsEntryZ ? "#f59e0b" : Math.abs(currentPt?.zscore ?? 0) > pairsEntryZ * 0.75 ? "#3b82f6" : "rgba(255,255,255,0.3)" }}>
                  {!currentPt ? "—"
                    : Math.abs(currentPt.zscore) >= pairsEntryZ ? `⚡ ${currentPt.zscore < 0 ? "LONG" : "SHORT"} signal`
                    : Math.abs(currentPt.zscore) > pairsEntryZ * 0.75 ? `↗ approaching ±${pairsEntryZ}σ`
                    : "signal within band"}
                </div>
              )}
            </div>
          </div>

        </div>{/* end ROW 1 */}

        {/* ROW 2: Equity + Beta | Performance + Kalman State — stretch to same height */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 380px", gap: 10, alignItems: "stretch" }}>

          {/* Equity + Beta (inner 2-col) */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div style={S.card}>
              <div style={{ ...S.cardTitle, marginBottom: 6 }}>EQUITY CURVE (closed trades)</div>
              {equityCurve.length > 1 ? <PairsEquityChart curve={equityCurve} /> : (
                <div style={{ height: 90, display: "flex", alignItems: "center", justifyContent: "center", color: "rgba(255,255,255,0.15)", fontSize: 10 }}>No closed trades yet</div>
              )}
              <div style={{ marginTop: 4, fontSize: 8, color: "rgba(255,255,255,0.25)" }}>Compounded P&L · closed trades only · indexed 100</div>
            </div>
            <div style={S.card}>
              <div style={{ ...S.cardTitle, marginBottom: 6 }}>ROLLING HEDGE RATIO β</div>
              {liveSeries.length > 1 ? <PairsBetaChart series={liveSeries} /> : (
                <div style={{ height: 90, display: "flex", alignItems: "center", justifyContent: "center", color: "rgba(255,255,255,0.15)", fontSize: 10 }}>No data yet</div>
              )}
              <div style={{ marginTop: 4, fontSize: 8, color: "rgba(255,255,255,0.25)" }}>Adaptive Kalman estimate · updates each observation</div>
            </div>
          </div>

          {/* PERFORMANCE + KALMAN STATE — ROW 2 cell 2 */}
          <div style={S.card}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>

              {/* Left: Live Performance */}
              <div>
                <div style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", letterSpacing: "0.1em", marginBottom: 8 }}>LIVE PERFORMANCE</div>
                <div style={{ fontSize: 26, fontWeight: 800, fontFamily: "monospace", letterSpacing: 1,
                  color: !hasStarted ? "rgba(255,255,255,0.1)" : totalReturn >= 0 ? "#10b981" : "#ef4444", marginBottom: 1, lineHeight: 1 }}>
                  {!hasStarted ? "—" : (totalReturn >= 0 ? "+" : "") + totalReturn.toFixed(2) + "%"}
                </div>
                <div style={{ fontSize: 8, color: "rgba(255,255,255,0.2)", marginBottom: 10, letterSpacing: "0.05em" }}>TOTAL · INCL UNREALIZED</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5 }}>
                  {[
                    { l: "Portfolio", v: totalEquity.toFixed(2), c: totalReturn >= 0 ? "#10b981" : "#ef4444" },
                    { l: "Trades", v: `${completedTrades.length} / ${allTrades.length}`, c: "#3b82f6" },
                    { l: "Win Rate", v: completedTrades.length > 0 ? `${winRate.toFixed(1)}%` : "—", c: winRate >= 50 ? "#10b981" : "#ef4444" },
                    { l: "Max DD", v: `${maxDD.toFixed(2)}%`, c: "#ef4444" },
                    { l: "Avg P&L", v: completedTrades.length > 0 ? `${(completedTrades.reduce((s: number, t: any) => s + t.pnlPct, 0) / completedTrades.length).toFixed(2)}%` : "—", c: "#fff" },
                    { l: "Stops hit", v: `${completedTrades.filter((t: any) => t.exitReason === "stop").length}`, c: "#ef4444" },
                  ].map((m, i) => (
                    <div key={i} style={{ background: "#0d1117", borderRadius: 4, padding: "6px 8px" }}>
                      <div style={{ fontSize: 7, color: "rgba(255,255,255,0.3)", marginBottom: 2, letterSpacing: "0.05em", textTransform: "uppercase" as const }}>{m.l}</div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: m.c, fontFamily: "monospace" }}>{m.v}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Right: Kalman State */}
              <div>
                <div style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", letterSpacing: "0.1em", marginBottom: 8 }}>KALMAN STATE</div>
                {currentPt ? (
                  <>
                    <div style={{ display: "flex", flexDirection: "column" as const, gap: 5, marginBottom: 10 }}>
                      {[
                        { l: "HEDGE RATIO β", v: currentPt.beta?.toFixed(5), c: "#3b82f6" },
                        { l: "INTERCEPT α", v: currentPt.alpha?.toFixed(5), c: "rgba(255,255,255,0.65)" },
                        { l: "Z-SCORE", v: (currentPt.zscore >= 0 ? "+" : "") + currentPt.zscore?.toFixed(3), c: Math.abs(currentPt.zscore) > pairsEntryZ ? "#f59e0b" : "rgba(255,255,255,0.7)" },
                        { l: "SPREAD VOL √S", v: currentPt.spreadVol?.toFixed(5), c: "rgba(255,255,255,0.65)" },
                      ].map((m, i) => (
                        <div key={i} style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px solid #21262d", paddingBottom: 4 }}>
                          <div style={{ fontSize: 8, color: "rgba(255,255,255,0.35)", letterSpacing: "0.04em" }}>{m.l}</div>
                          <div style={{ fontSize: 11, fontWeight: 700, color: m.c, fontFamily: "monospace" }}>{m.v}</div>
                        </div>
                      ))}
                    </div>
                    <div style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", marginBottom: 5, letterSpacing: "0.05em" }}>SIGNAL PROXIMITY</div>
                    {[
                      { l: `LONG (z < −${pairsEntryZ}σ)`, v: longProx, c: "#10b981" },
                      { l: `SHORT (z > +${pairsEntryZ}σ)`, v: shortProx, c: "#ef4444" },
                    ].map((b, i) => (
                      <div key={i} style={{ marginBottom: 7 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 8, color: "rgba(255,255,255,0.3)", marginBottom: 3 }}>
                          <span>{b.l}</span><span>{(b.v * 100).toFixed(0)}%</span>
                        </div>
                        <div style={{ background: "#0d1117", borderRadius: 2, height: 5, overflow: "hidden" }}>
                          <div style={{ width: `${(b.v * 100).toFixed(0)}%`, height: "100%", background: b.c, borderRadius: 2, transition: "width 0.12s ease",
                            boxShadow: b.v > 0.7 ? `0 0 8px ${b.c}` : "none" }} />
                        </div>
                      </div>
                    ))}
                  </>
                ) : (
                  <div style={{ color: "rgba(255,255,255,0.2)", fontSize: 11, marginTop: 20, textAlign: "center" as const }}>
                    {pairsDataLoading ? "⟳  Loading..." : "—"}
                  </div>
                )}
              </div>

            </div>
          </div>

        </div>{/* end ROW 2 */}

        {/* Trade blotter — full width below both rows */}
        {hasStarted && (completedTrades.length > 0 || activeTrade) && (
          <div style={S.card}>
            <div style={{ ...S.cardTitle, marginBottom: 8 }}>
              TRADE BLOTTER — {completedTrades.length} CLOSED
              {activeTrade && <span style={{ color: posColor, marginLeft: 8 }}>· 1 LIVE</span>}
            </div>
            <div style={{ overflowY: "auto" as const, maxHeight: 260 }}>
              <table style={S.table}>
                <thead style={{ position: "sticky" as const, top: 0, background: "#161b22", zIndex: 1 }}>
                  <tr>{["", "DIR", "ENTRY DATE", "EXIT DATE", "DAYS", "ENTRY Z", "P&L", "EXIT"].map(h => <th key={h} style={S.th}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {activeTrade && (
                    <tr style={{ background: activeTrade.direction === "long" ? "rgba(16,185,129,0.06)" : "rgba(239,68,68,0.06)", animation: "pSlide 0.3s ease-out" }}>
                      <td style={S.td}><div style={{ width: 7, height: 7, borderRadius: "50%", background: posColor, animation: "pBlink 1.2s infinite" }} /></td>
                      <td style={{ ...S.td, color: posColor, fontWeight: 800 }}>{activeTrade.direction === "long" ? "▲ LONG" : "▼ SHORT"}</td>
                      <td style={S.td}>{activeTrade.entryDate}</td>
                      <td style={{ ...S.td, color: "rgba(255,255,255,0.25)" }}>OPEN</td>
                      <td style={S.td}>{holdDays}d</td>
                      <td style={S.td}>{activeTrade.entryZ}</td>
                      <td style={{ ...S.td, color: unrealPnl >= 0 ? "#10b981" : "#ef4444", fontWeight: 700 }}>{unrealPnl >= 0 ? "+" : ""}{unrealPnl.toFixed(2)}% *</td>
                      <td style={S.td}><span style={{ background: "rgba(59,130,246,0.2)", color: "#3b82f6", padding: "2px 6px", borderRadius: 3, fontSize: 8, fontWeight: 700 }}>LIVE</span></td>
                    </tr>
                  )}
                  {[...completedTrades].reverse().slice(0, 30).map((t: any, i: number) => {
                    const rc = t.exitReason === "stop" ? "#ef4444" : t.exitReason === "signal" ? "#3b82f6" : "#f59e0b";
                    const rl = t.exitReason === "stop" ? "STOP" : t.exitReason === "signal" ? "SIG" : "TIME";
                    return (
                      <tr key={i} style={{ background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.015)", animation: i === 0 ? "pSlide 0.25s ease-out" : "none" }}>
                        <td style={S.td}><div style={{ width: 6, height: 6, borderRadius: "50%", background: t.pnlPct >= 0 ? "#10b981" : "#ef4444" }} /></td>
                        <td style={{ ...S.td, color: t.direction === "long" ? "#10b981" : "#ef4444", fontWeight: 700 }}>{t.direction === "long" ? "▲" : "▼"}</td>
                        <td style={S.td}>{t.entryDate}</td>
                        <td style={S.td}>{t.exitDate}</td>
                        <td style={S.td}>{t.daysHeld}d</td>
                        <td style={S.td}>{t.entryZ}</td>
                        <td style={{ ...S.td, color: t.pnlPct >= 0 ? "#10b981" : "#ef4444", fontWeight: 700 }}>{t.pnlPct >= 0 ? "+" : ""}{t.pnlPct.toFixed(3)}%</td>
                        <td style={S.td}><span style={{ background: `${rc}20`, color: rc, padding: "2px 6px", borderRadius: 3, fontSize: 8, fontWeight: 700 }}>{rl}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        </div>{/* end outer wrapper */}

        {/* Initial load state — only shown before first dataset arrives */}
        {!pairsData && pairsDataLoading && (
          <div style={{ ...S.card, textAlign: "center" as const, padding: "60px 20px", marginTop: 10 }}>
            <div style={{ fontSize: 28, marginBottom: 12, color: "rgba(255,255,255,0.15)" }}>⟳</div>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.2)" }}>Loading Kalman filter dataset…</div>
          </div>
        )}
      </>
    );
  }
}