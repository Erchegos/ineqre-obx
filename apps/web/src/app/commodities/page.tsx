"use client";

import Link from "next/link";
import { useEffect, useState, useCallback, useMemo } from "react";
import {
  Treemap,
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Legend,
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
} from "recharts";

// ── Types ──────────────────────────────────────────────────
interface CommodityData {
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
  sensitivities: {
    ticker: string;
    stockName: string;
    sector: string;
    beta: number;
    correlation60d: number;
    correlation252d: number;
    rSquared: number;
  }[];
}

interface SectorData {
  name: string;
  color: string;
  tickers: string[];
  stocks: {
    ticker: string;
    name: string;
    price: number;
    dailyPct: number | null;
  }[];
  performance: {
    daily: number | null;
    weekly: number | null;
    monthly: number | null;
    ytd: number | null;
  };
  bestPerformer: { ticker: string; name: string; dailyPct: number | null } | null;
  worstPerformer: { ticker: string; name: string; dailyPct: number | null } | null;
  commodityDriver: {
    symbol: string;
    name: string;
    price: number;
    dailyPct: number | null;
    sparkline30d: number[];
  } | null;
  avgBeta: number | null;
}

interface CorrelationData {
  tickers: string[];
  labels: string[];
  matrix: number[][];
  period: number;
}

type Tab = "DASHBOARD" | "QUOTES" | "SCATTER" | "CORRELATIONS" | "SECTORS";

// ── Helpers ────────────────────────────────────────────────
function pctColor(v: number | null) {
  if (v === null || v === undefined) return "rgba(255,255,255,0.35)";
  return v >= 0 ? "#10b981" : "#ef4444";
}

function fmtPct(v: number | null, dec = 2) {
  if (v === null || v === undefined) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(dec)}%`;
}

function fmtPrice(v: number | null | undefined) {
  if (v === null || v === undefined) return "—";
  if (v >= 1000) return v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (v >= 10) return v.toFixed(2);
  return v.toFixed(4);
}

function treemapColor(pct: number | null): string {
  if (pct === null || pct === undefined) return "#1e293b";
  const clamped = Math.max(-5, Math.min(5, pct));
  const t = Math.abs(clamped) / 5; // 0..1
  if (clamped < 0) {
    // Dark red range: #1e293b → #7f1d1d
    const r = Math.round(30 + t * 97);
    const g = Math.round(41 - t * 12);
    const b = Math.round(59 - t * 30);
    return `rgb(${r},${g},${b})`;
  } else if (clamped > 0) {
    // Dark green range: #1e293b → #14532d
    const r = Math.round(30 - t * 10);
    const g = Math.round(41 + t * 42);
    const b = Math.round(59 - t * 14);
    return `rgb(${r},${g},${b})`;
  }
  return "#1e293b";
}

function sparklineSvg(data: number[], w = 120, h = 28, color = "#3b82f6") {
  if (!data || data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const points = data.map((v, i) =>
    `${(i / (data.length - 1)) * w},${h - ((v - min) / range) * (h - 4) - 2}`
  ).join(" ");
  // Determine color based on start vs end
  const lineColor = data[data.length - 1] >= data[0] ? "#10b981" : "#ef4444";
  return (
    <svg width={w} height={h} style={{ display: "block" }}>
      <polyline
        points={points}
        fill="none"
        stroke={color === "auto" ? lineColor : color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function useCountUp(target: number, duration = 1500) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (target === 0) return;
    let start: number | null = null;
    const step = (ts: number) => {
      if (!start) start = ts;
      const progress = Math.min((ts - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(Math.round(eased * target));
      if (progress < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, [target, duration]);
  return value;
}

// ── Treemap Custom Cell ────────────────────────────────────
function TreemapCell(props: Record<string, unknown>) {
  const { x, y, width, height, name, dailyPct, price } = props as {
    x: number; y: number; width: number; height: number;
    name: string; dailyPct: number | null; price: number;
  };
  if (width < 4 || height < 4) return null;
  const bg = treemapColor(dailyPct);
  const isLarge = width > 110 && height > 65;
  const isMedium = width > 55 && height > 35;

  return (
    <g>
      <rect
        x={x + 1} y={y + 1} width={width - 2} height={height - 2}
        fill={bg}
        stroke="#0a0a0a"
        strokeWidth={1.5}
        rx={2}
      />
      {isMedium && (
        <>
          <text x={x + 8} y={y + 17} fill="#fff" fontSize={11} fontWeight={700} fontFamily="monospace"
            style={{ textShadow: "0 1px 3px rgba(0,0,0,0.8)" } as React.CSSProperties}>
            {name}
          </text>
          {isLarge && (
            <>
              <text x={x + 8} y={y + 34} fill="rgba(255,255,255,0.7)" fontSize={12} fontWeight={600} fontFamily="monospace"
                style={{ textShadow: "0 1px 2px rgba(0,0,0,0.6)" } as React.CSSProperties}>
                {fmtPrice(price)}
              </text>
              <text x={x + 8} y={y + 52} fill="#fff" fontSize={14} fontWeight={800} fontFamily="monospace"
                style={{ textShadow: "0 1px 3px rgba(0,0,0,0.8)" } as React.CSSProperties}>
                {fmtPct(dailyPct, 2)}
              </text>
            </>
          )}
          {!isLarge && (
            <text x={x + 8} y={y + 32} fill="#fff" fontSize={11} fontWeight={700} fontFamily="monospace"
              style={{ textShadow: "0 1px 2px rgba(0,0,0,0.6)" } as React.CSSProperties}>
              {fmtPct(dailyPct, 1)}
            </text>
          )}
        </>
      )}
    </g>
  );
}

// ── Flow Diagram ───────────────────────────────────────────
function FlowDiagram({ commodities }: { commodities: CommodityData[] }) {
  const [hovered, setHovered] = useState<string | null>(null);

  // Build nodes and edges
  const commodityNodes = commodities.filter(c => c.sensitivities.length > 0);
  const stockMap = new Map<string, { ticker: string; sector: string; name: string }>();
  const edges: { from: string; to: string; beta: number; rSquared: number }[] = [];

  for (const c of commodityNodes) {
    for (const s of c.sensitivities.slice(0, 5)) { // top 5 per commodity
      stockMap.set(s.ticker, { ticker: s.ticker, sector: s.sector || "", name: s.stockName || s.ticker });
      edges.push({ from: c.symbol, to: s.ticker, beta: s.beta, rSquared: s.rSquared });
    }
  }

  const stockNodes = Array.from(stockMap.values());
  if (commodityNodes.length === 0 || stockNodes.length === 0) return null;

  const svgW = 900;
  const leftX = 100;
  const rightX = 800;
  const comGap = Math.min(50, (280) / Math.max(commodityNodes.length - 1, 1));
  const stockGap = Math.min(40, (280) / Math.max(stockNodes.length - 1, 1));
  const comStartY = 30;
  const stockStartY = 30;

  const CATEGORY_COLORS_MAP: Record<string, string> = {
    Energy: "#ef4444", Metals: "#f59e0b", Agricultural: "#a855f7", Seafood: "#22c55e",
  };
  const SECTOR_COLORS_MAP: Record<string, string> = {
    Energy: "#ef4444", Seafood: "#22c55e", Shipping: "#3b82f6", Materials: "#f59e0b",
  };

  const comY = (i: number) => comStartY + i * comGap;
  const stockY = (i: number) => stockStartY + i * stockGap;

  const svgH = Math.max(
    comStartY + (commodityNodes.length - 1) * comGap + 40,
    stockStartY + (stockNodes.length - 1) * stockGap + 40
  );

  return (
    <div style={{ overflowX: "auto" }}>
      <svg width={svgW} height={svgH} style={{ display: "block", margin: "0 auto" }}>
        {/* Edges */}
        {edges.map((e, idx) => {
          const ci = commodityNodes.findIndex(c => c.symbol === e.from);
          const si = stockNodes.findIndex(s => s.ticker === e.to);
          if (ci < 0 || si < 0) return null;
          const y1 = comY(ci);
          const y2 = stockY(si);
          const thickness = Math.max(1, Math.min(6, Math.abs(e.beta) * 3));
          const color = e.beta >= 0 ? "#10b981" : "#ef4444";
          const opacity = hovered
            ? (hovered === e.from || hovered === e.to ? 0.8 : 0.08)
            : Math.max(0.15, Math.min(0.6, e.rSquared || 0.2));
          const cpx1 = leftX + (rightX - leftX) * 0.35;
          const cpx2 = leftX + (rightX - leftX) * 0.65;
          return (
            <path
              key={idx}
              d={`M ${leftX + 40} ${y1} C ${cpx1} ${y1}, ${cpx2} ${y2}, ${rightX - 40} ${y2}`}
              fill="none"
              stroke={color}
              strokeWidth={thickness}
              opacity={opacity}
              strokeLinecap="round"
            />
          );
        })}
        {/* Commodity nodes (left) */}
        {commodityNodes.map((c, i) => {
          const y = comY(i);
          const catColor = CATEGORY_COLORS_MAP[c.category] || "#9e9e9e";
          const isHigh = hovered === c.symbol;
          return (
            <g key={c.symbol}
              onMouseEnter={() => setHovered(c.symbol)}
              onMouseLeave={() => setHovered(null)}
              style={{ cursor: "pointer" }}
            >
              <circle cx={leftX} cy={y} r={isHigh ? 20 : 16} fill={catColor} opacity={isHigh ? 1 : 0.7}
                stroke={isHigh ? "#fff" : "none"} strokeWidth={2} />
              <text x={leftX} y={y + 1} textAnchor="middle" fill="#fff" fontSize={8} fontWeight={700} fontFamily="monospace">
                {c.symbol.replace("=F", "")}
              </text>
              <text x={leftX - 35} y={y + 4} textAnchor="end" fill="rgba(255,255,255,0.7)" fontSize={9} fontFamily="monospace">
                {c.name}
              </text>
            </g>
          );
        })}
        {/* Stock nodes (right) */}
        {stockNodes.map((s, i) => {
          const y = stockY(i);
          const sColor = SECTOR_COLORS_MAP[s.sector] || "#9e9e9e";
          const isHigh = hovered === s.ticker;
          return (
            <g key={s.ticker}
              onMouseEnter={() => setHovered(s.ticker)}
              onMouseLeave={() => setHovered(null)}
              style={{ cursor: "pointer" }}
            >
              <circle cx={rightX} cy={y} r={isHigh ? 20 : 16} fill={sColor} opacity={isHigh ? 1 : 0.7}
                stroke={isHigh ? "#fff" : "none"} strokeWidth={2} />
              <text x={rightX} y={y + 1} textAnchor="middle" fill="#fff" fontSize={8} fontWeight={700} fontFamily="monospace">
                {s.ticker}
              </text>
              <text x={rightX + 35} y={y + 4} textAnchor="start" fill="rgba(255,255,255,0.7)" fontSize={9} fontFamily="monospace">
                {s.name}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ── Heat Pulse Timeline ────────────────────────────────────
function HeatPulse({ commodities }: { commodities: CommodityData[] }) {
  const items = commodities.filter(c => c.last5Days && c.last5Days.length > 0);
  if (items.length === 0) return null;

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ borderCollapse: "collapse", width: "100%" }}>
        <thead>
          <tr>
            <th style={{ padding: "6px 10px", textAlign: "left", fontSize: 9, fontWeight: 600, color: "rgba(255,255,255,0.4)", fontFamily: "monospace", letterSpacing: "0.05em", textTransform: "uppercase", whiteSpace: "nowrap", minWidth: 100 }}>
              Commodity
            </th>
            {items[0]?.last5Days.map((d, i) => (
              <th key={i} style={{ padding: "6px 8px", textAlign: "center", fontSize: 9, fontWeight: 600, color: "rgba(255,255,255,0.4)", fontFamily: "monospace", whiteSpace: "nowrap", minWidth: 64 }}>
                {new Date(d.date).toLocaleDateString("en-US", { weekday: "short", day: "numeric" })}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map(c => (
            <tr key={c.symbol} style={{ borderBottom: "1px solid #21262d" }}>
              <td style={{ padding: "4px 10px", fontSize: 10, fontWeight: 600, color: "rgba(255,255,255,0.7)", fontFamily: "monospace", whiteSpace: "nowrap" }}>
                {c.name}
              </td>
              {c.last5Days.map((d, di) => {
                const bg = treemapColor(d.dayPct);
                return (
                  <td key={di} style={{ padding: "2px 3px", textAlign: "center" }}>
                    <div style={{
                      background: bg, borderRadius: 3, padding: "6px 8px",
                      fontSize: 11, fontWeight: 700, fontFamily: "monospace",
                      color: "#fff",
                    }}>
                      {fmtPct(d.dayPct, 1)}
                    </div>
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

// ── Main Page ──────────────────────────────────────────────
export default function CommoditiesPage() {
  const [commodities, setCommodities] = useState<CommodityData[]>([]);
  const [sectors, setSectors] = useState<SectorData[]>([]);
  const [correlation, setCorrelation] = useState<CorrelationData | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("DASHBOARD");
  const [corrDays, setCorrDays] = useState(90);
  const [corrIncludeEquities, setCorrIncludeEquities] = useState(false);
  const [sortCol, setSortCol] = useState<string>("importance");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [scatterX, setScatterX] = useState<"yoyPct" | "monthlyPct" | "ytdPct">("yoyPct");
  const [scatterY, setScatterY] = useState<"monthlyPct" | "weeklyPct" | "dayReturnPct">("monthlyPct");

  const commodityCount = useCountUp(commodities.length, 600);

  // Data fetching
  useEffect(() => {
    async function load() {
      try {
        const [comRes, secRes] = await Promise.all([
          fetch("/api/commodities?days=365"),
          fetch("/api/sectors/overview"),
        ]);
        if (comRes.ok) {
          const data = await comRes.json();
          setCommodities(data.commodities || []);
        }
        if (secRes.ok) {
          const data = await secRes.json();
          setSectors(data.sectors || []);
        }
      } catch (e) {
        console.error("Failed to load data", e);
      }
      setLoading(false);
    }
    load();
  }, []);

  // Correlation data (reload on params change)
  const loadCorrelation = useCallback(async () => {
    try {
      const eq = corrIncludeEquities ? "&equities=EQNR,MOWI,NHY,FRO,AKRBP,SALM" : "";
      const res = await fetch(`/api/commodities/correlation?days=${corrDays}${eq}`);
      if (res.ok) setCorrelation(await res.json());
    } catch (e) {
      console.error("Correlation fetch failed", e);
    }
  }, [corrDays, corrIncludeEquities]);

  useEffect(() => {
    if (tab === "CORRELATIONS" || tab === "DASHBOARD") loadCorrelation();
  }, [tab, loadCorrelation]);

  // Sorted commodities for quotes table
  const sortedCommodities = useMemo(() => {
    const arr = [...commodities];
    arr.sort((a, b) => {
      const av = (a as unknown as Record<string, unknown>)[sortCol] as number ?? 0;
      const bv = (b as unknown as Record<string, unknown>)[sortCol] as number ?? 0;
      return sortDir === "asc" ? av - bv : bv - av;
    });
    return arr;
  }, [commodities, sortCol, sortDir]);

  const toggleSort = (col: string) => {
    if (sortCol === col) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortCol(col); setSortDir("desc"); }
  };

  // Treemap data
  const treemapData = useMemo(() => {
    const categoryMap = new Map<string, CommodityData[]>();
    for (const c of commodities) {
      const cat = c.category || "Other";
      if (!categoryMap.has(cat)) categoryMap.set(cat, []);
      categoryMap.get(cat)!.push(c);
    }
    return Array.from(categoryMap.entries()).map(([cat, items]) => ({
      name: cat,
      children: items.map(c => ({
        name: c.name,
        size: c.importance,
        dailyPct: c.dayReturnPct,
        price: c.latest?.close,
        unit: c.unit,
        symbol: c.symbol,
      })),
    }));
  }, [commodities]);

  // Scatter data
  const scatterData = useMemo(() => {
    return commodities
      .filter(c => c[scatterX] !== null && c[scatterY] !== null)
      .map(c => ({
        name: c.name,
        symbol: c.symbol,
        x: c[scatterX] || 0,
        y: c[scatterY] || 0,
        z: c.importance,
        category: c.category,
      }));
  }, [commodities, scatterX, scatterY]);

  // Radar data for sectors tab
  const radarData = useMemo(() => {
    if (commodities.length === 0 || sectors.length === 0) return [];
    // For each commodity, compute avg |beta| per sector
    const comSymbols = commodities.filter(c => c.sensitivities.length > 0).map(c => c.symbol);
    return comSymbols.map(sym => {
      const c = commodities.find(x => x.symbol === sym)!;
      const entry: Record<string, unknown> = { commodity: c.name };
      for (const sec of sectors) {
        const sectorBetas = c.sensitivities
          .filter(s => sec.tickers.includes(s.ticker))
          .map(s => Math.abs(s.beta));
        entry[sec.name] = sectorBetas.length > 0
          ? Math.round(sectorBetas.reduce((a, b) => a + b, 0) / sectorBetas.length * 100) / 100
          : 0;
      }
      return entry;
    });
  }, [commodities, sectors]);

  // Sector performance bar data
  const sectorBarData = useMemo(() => {
    return sectors.map(s => ({
      name: s.name,
      daily: s.performance.daily || 0,
      weekly: s.performance.weekly || 0,
      monthly: s.performance.monthly || 0,
      color: s.color,
    }));
  }, [sectors]);

  const TABS: Tab[] = ["DASHBOARD", "QUOTES", "SCATTER", "CORRELATIONS", "SECTORS"];

  const CATEGORY_COLORS: Record<string, string> = {
    Energy: "#ef4444", Metals: "#f59e0b", Agricultural: "#a855f7", Seafood: "#22c55e",
  };

  // ── Render ─────────────────────────────────────────────
  return (
    <div style={{ fontFamily: "monospace", background: "#0a0a0a", minHeight: "100vh", color: "#fff" }}>
      <style>{`
        .sector-card { transition: all 0.2s ease; }
        .sector-card:hover { background: #1c2333 !important; }
        .sort-header { cursor: pointer; user-select: none; }
        .sort-header:hover { color: #3b82f6; }
        .quote-row { transition: background 0.15s; cursor: pointer; }
        .quote-row:hover { background: rgba(59,130,246,0.08) !important; }
        .ticker-badge { transition: border-color 0.15s; }
        .ticker-badge:hover { border-color: #3b82f6 !important; }
      `}</style>

      {/* Header */}
      <div style={{ padding: "16px 24px", borderBottom: "1px solid #30363d", display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        <Link href="/" style={{ color: "rgba(255,255,255,0.5)", textDecoration: "none", fontSize: 12 }}>
          ← Home
        </Link>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>
          Commodity & Sector Terminal
        </h1>
        <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>
          {commodityCount} commodities tracked
        </span>
      </div>

      {/* Ticker Strip */}
      {commodities.length > 0 && (
        <div style={{
          padding: "6px 24px", borderBottom: "1px solid #21262d", background: "#0d1117",
          display: "flex", gap: 2, overflowX: "auto", alignItems: "center",
        }}>
          {commodities.map(c => {
            const pct = c.dayReturnPct;
            return (
              <Link key={c.symbol} href={`/commodities/${encodeURIComponent(c.symbol)}`} style={{ textDecoration: "none" }}>
                <div className="ticker-badge" style={{
                  display: "flex", alignItems: "center", gap: 6, padding: "5px 10px",
                  borderRight: "1px solid #21262d", whiteSpace: "nowrap",
                }}>
                  <span style={{ fontSize: 9, fontWeight: 600, color: "rgba(255,255,255,0.5)" }}>{c.name}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: "#fff" }}>{fmtPrice(c.latest?.close)}</span>
                  <span style={{ fontSize: 10, fontWeight: 700, color: pctColor(pct) }}>{fmtPct(pct, 1)}</span>
                  {sparklineSvg(c.sparkline30d?.slice(-7) || [], 36, 14, "auto")}
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {/* Tab bar */}
      <div style={{ padding: "0 24px", borderBottom: "1px solid #30363d", display: "flex", gap: 0, background: "transparent" }}>
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: "12px 20px",
            background: "none",
            border: "none",
            borderBottom: tab === t ? "2px solid #fff" : "2px solid transparent",
            color: tab === t ? "#fff" : "rgba(255,255,255,0.4)",
            fontSize: 11, fontWeight: tab === t ? 700 : 600, fontFamily: "monospace", letterSpacing: "0.08em",
            cursor: "pointer", textTransform: "uppercase",
            outline: "none",
            WebkitAppearance: "none",
          }}>
            {t}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ padding: "20px 24px", maxWidth: 1400, margin: "0 auto" }}>
        {loading ? (
          <div style={{ textAlign: "center", padding: 80, color: "rgba(255,255,255,0.4)" }}>
            Loading commodity data...
          </div>
        ) : (
          <>
            {/* ─── DASHBOARD TAB ─────────────────────── */}
            {tab === "DASHBOARD" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                {/* Summary Metrics */}
                {(() => {
                  const gainers = commodities.filter(c => c.dayReturnPct !== null && c.dayReturnPct > 0).length;
                  const losers = commodities.filter(c => c.dayReturnPct !== null && c.dayReturnPct < 0).length;
                  const topMover = [...commodities].sort((a, b) => Math.abs(b.dayReturnPct || 0) - Math.abs(a.dayReturnPct || 0))[0];
                  const avgReturn = commodities.filter(c => c.dayReturnPct !== null).reduce((s, c) => s + (c.dayReturnPct || 0), 0) / Math.max(commodities.filter(c => c.dayReturnPct !== null).length, 1);
                  const metrics = [
                    { label: "TRACKED", value: `${commodities.length}`, sub: "commodities", color: "#fff" },
                    { label: "GAINERS", value: `${gainers}`, sub: `of ${commodities.length}`, color: "#10b981" },
                    { label: "LOSERS", value: `${losers}`, sub: `of ${commodities.length}`, color: "#ef4444" },
                    { label: "AVG RETURN", value: fmtPct(avgReturn, 2), sub: "today", color: pctColor(avgReturn) },
                    { label: "TOP MOVER", value: topMover ? topMover.name : "—", sub: topMover ? fmtPct(topMover.dayReturnPct, 1) : "", color: topMover ? pctColor(topMover.dayReturnPct) : "#fff" },
                  ];
                  return (
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 8 }}>
                      {metrics.map(m => (
                        <div key={m.label} style={{ background: "#0d1117", border: "1px solid #21262d", borderRadius: 6, padding: "12px 14px", textAlign: "center" }}>
                          <div style={{ fontSize: 9, fontWeight: 600, color: "rgba(255,255,255,0.4)", letterSpacing: "0.05em", textTransform: "uppercase", marginBottom: 4 }}>{m.label}</div>
                          <div style={{ fontSize: 18, fontWeight: 800, color: m.color }}>{m.value}</div>
                          <div style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", marginTop: 2 }}>{m.sub}</div>
                        </div>
                      ))}
                    </div>
                  );
                })()}

                {/* Treemap */}
                <div style={{ background: "#161b22", border: "1px solid #30363d", borderRadius: 8, padding: 16 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.6)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 12 }}>
                    COMMODITY HEATMAP — DAILY PERFORMANCE
                  </div>
                  {treemapData.length > 0 ? (
                    <ResponsiveContainer width="100%" height={400}>
                      <Treemap
                        data={treemapData}
                        dataKey="size"
                        stroke="#0a0a0a"
                        content={<TreemapCell />}
                        animationDuration={600}
                      />
                    </ResponsiveContainer>
                  ) : (
                    <div style={{ height: 400, display: "flex", alignItems: "center", justifyContent: "center", color: "rgba(255,255,255,0.3)" }}>
                      No treemap data available
                    </div>
                  )}
                  {/* Category legend */}
                  <div style={{ display: "flex", gap: 20, marginTop: 12, alignItems: "center" }}>
                    {Object.entries(CATEGORY_COLORS).map(([cat, col]) => (
                      <div key={cat} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <div style={{ width: 8, height: 8, borderRadius: 2, background: col, opacity: 0.8 }} />
                        <span style={{ fontSize: 9, color: "rgba(255,255,255,0.45)" }}>{cat}</span>
                      </div>
                    ))}
                    <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontSize: 9, color: "#ef4444", fontWeight: 600 }}>-5%</span>
                      <div style={{ width: 100, height: 10, borderRadius: 3, background: "linear-gradient(90deg, #7f1d1d, #1e293b, #14532d)" }} />
                      <span style={{ fontSize: 9, color: "#10b981", fontWeight: 600 }}>+5%</span>
                    </div>
                  </div>
                </div>

                {/* 5-Day Heat Pulse */}
                <div style={{ background: "#161b22", border: "1px solid #30363d", borderRadius: 8, padding: 16, overflow: "hidden" }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.6)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>
                    5-DAY PERFORMANCE HEATMAP
                  </div>
                  <HeatPulse commodities={commodities} />
                </div>

                {/* Sector Impact Cards */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 12 }}>
                  {sectors.map(s => (
                    <Link key={s.name} href="/sectors" style={{ textDecoration: "none" }}>
                      <div className="sector-card" style={{
                        background: "#161b22", border: "1px solid #30363d", borderRadius: 8,
                        borderLeft: `3px solid ${s.color}`, padding: 16,
                      }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                          <span style={{ fontSize: 14, fontWeight: 700 }}>{s.name}</span>
                          <span style={{ fontSize: 10, color: "rgba(255,255,255,0.4)" }}>{s.tickers.length} stocks</span>
                        </div>
                        {/* Commodity driver */}
                        {s.commodityDriver && (
                          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, padding: "6px 0", borderBottom: "1px solid #21262d" }}>
                            <span style={{ fontSize: 10, color: "rgba(255,255,255,0.5)" }}>{s.commodityDriver.name}</span>
                            <span style={{ fontSize: 12, fontWeight: 700 }}>{fmtPrice(s.commodityDriver.price)}</span>
                            <span style={{ fontSize: 10, fontWeight: 700, color: pctColor(s.commodityDriver.dailyPct) }}>
                              {fmtPct(s.commodityDriver.dailyPct, 1)}
                            </span>
                            {sparklineSvg(s.commodityDriver.sparkline30d || [], 60, 18, "auto")}
                          </div>
                        )}
                        {/* Sector aggregate */}
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 4, marginBottom: 10 }}>
                          {[
                            { label: "Day", val: s.performance.daily },
                            { label: "Week", val: s.performance.weekly },
                            { label: "Month", val: s.performance.monthly },
                          ].map(m => (
                            <div key={m.label} style={{ background: "#0d1117", borderRadius: 4, padding: "4px 6px", textAlign: "center" }}>
                              <div style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", textTransform: "uppercase" }}>{m.label}</div>
                              <div style={{ fontSize: 12, fontWeight: 700, color: pctColor(m.val) }}>{fmtPct(m.val, 1)}</div>
                            </div>
                          ))}
                        </div>
                        {/* Top stocks */}
                        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                          {s.stocks.slice(0, 4).map(st => (
                            <div key={st.ticker} style={{ display: "flex", justifyContent: "space-between", fontSize: 10 }}>
                              <span style={{ color: "rgba(255,255,255,0.7)" }}>{st.ticker}</span>
                              <span style={{ fontWeight: 600, color: pctColor(st.dailyPct) }}>{fmtPct(st.dailyPct, 1)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>

                {/* Flow Diagram */}
                <div style={{ background: "#161b22", border: "1px solid #30363d", borderRadius: 8, padding: 16 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.6)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 12 }}>
                    COMMODITY → EQUITY TRANSMISSION
                  </div>
                  <div style={{ display: "flex", gap: 16, marginBottom: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <div style={{ width: 20, height: 3, background: "#10b981", borderRadius: 2 }} />
                      <span style={{ fontSize: 9, color: "rgba(255,255,255,0.5)" }}>Positive beta</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <div style={{ width: 20, height: 3, background: "#ef4444", borderRadius: 2 }} />
                      <span style={{ fontSize: 9, color: "rgba(255,255,255,0.5)" }}>Negative beta</span>
                    </div>
                    <span style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", marginLeft: "auto" }}>Line thickness = |beta|, opacity = R²</span>
                  </div>
                  <FlowDiagram commodities={commodities} />
                </div>
              </div>
            )}

            {/* ─── QUOTES TAB ────────────────────────── */}
            {tab === "QUOTES" && (
              <div style={{ background: "#161b22", border: "1px solid #30363d", borderRadius: 8, overflow: "hidden" }}>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ borderBottom: "1px solid #30363d" }}>
                        {[
                          { key: "name", label: "Commodity" },
                          { key: "latest.close", label: "Price" },
                          { key: "currency", label: "Ccy" },
                          { key: "dayReturnPct", label: "Day %" },
                          { key: "weeklyPct", label: "Week %" },
                          { key: "monthlyPct", label: "Month %" },
                          { key: "ytdPct", label: "YTD %" },
                          { key: "yoyPct", label: "YoY %" },
                          { key: "sparkline", label: "30D" },
                        ].map(h => (
                          <th key={h.key}
                            className="sort-header"
                            onClick={() => h.key !== "sparkline" && toggleSort(h.key)}
                            style={{
                              padding: "10px 12px", textAlign: h.key === "name" ? "left" : "right",
                              fontSize: 9, fontWeight: 600, color: sortCol === h.key ? "#fff" : "rgba(255,255,255,0.4)",
                              letterSpacing: "0.05em", textTransform: "uppercase", fontFamily: "monospace",
                            }}
                          >
                            {h.label} {sortCol === h.key ? (sortDir === "asc" ? "↑" : "↓") : ""}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {sortedCommodities.map(c => (
                        <tr key={c.symbol} className="quote-row" onClick={() => window.location.href = `/commodities/${encodeURIComponent(c.symbol)}`}
                          style={{ borderBottom: "1px solid #21262d" }}>
                          <td style={{ padding: "8px 12px", fontSize: 11, fontWeight: 600 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <div style={{ width: 8, height: 8, borderRadius: 2, background: CATEGORY_COLORS[c.category] || "#666" }} />
                              {c.name}
                            </div>
                          </td>
                          <td style={{ padding: "8px 12px", fontSize: 11, fontWeight: 600, textAlign: "right" }}>
                            {fmtPrice(c.latest?.close)}
                          </td>
                          <td style={{ padding: "8px 12px", fontSize: 10, textAlign: "right", color: "rgba(255,255,255,0.4)" }}>
                            {c.currency}
                          </td>
                          {["dayReturnPct", "weeklyPct", "monthlyPct", "ytdPct", "yoyPct"].map(k => {
                            const v = (c as unknown as Record<string, unknown>)[k] as number | null;
                            const intensity = v !== null ? Math.min(Math.abs(v) / 10, 1) * 0.1 : 0;
                            const bg = v === null ? "transparent" : v >= 0 ? `rgba(16,185,129,${intensity})` : `rgba(239,68,68,${intensity})`;
                            return (
                              <td key={k} style={{
                                padding: "8px 12px", fontSize: 11, fontWeight: 600, textAlign: "right",
                                color: pctColor(v), background: bg,
                              }}>
                                {fmtPct(v)}
                              </td>
                            );
                          })}
                          <td style={{ padding: "8px 12px", textAlign: "right" }}>
                            {sparklineSvg(c.sparkline30d || [], 120, 24, "auto")}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* ─── SCATTER TAB ───────────────────────── */}
            {tab === "SCATTER" && (
              <div style={{ background: "#161b22", border: "1px solid #30363d", borderRadius: 8, padding: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 12 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.6)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
                    COMMODITY MOMENTUM SCATTER
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <span style={{ fontSize: 9, color: "rgba(255,255,255,0.35)" }}>X:</span>
                    {(["monthlyPct", "ytdPct", "yoyPct"] as const).map(v => (
                      <button key={v} onClick={() => setScatterX(v)} style={{
                        padding: "4px 8px", fontSize: 9, fontFamily: "monospace", fontWeight: 600,
                        background: scatterX === v ? "rgba(255,255,255,0.1)" : "transparent",
                        border: `1px solid ${scatterX === v ? "rgba(255,255,255,0.3)" : "#30363d"}`,
                        color: scatterX === v ? "#fff" : "rgba(255,255,255,0.4)",
                        borderRadius: 4, cursor: "pointer", outline: "none",
                      }}>
                        {{ monthlyPct: "Monthly", ytdPct: "YTD", yoyPct: "YoY" }[v]}
                      </button>
                    ))}
                    <span style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", marginLeft: 8 }}>Y:</span>
                    {(["dayReturnPct", "weeklyPct", "monthlyPct"] as const).map(v => (
                      <button key={v} onClick={() => setScatterY(v)} style={{
                        padding: "4px 8px", fontSize: 9, fontFamily: "monospace", fontWeight: 600,
                        background: scatterY === v ? "rgba(255,255,255,0.1)" : "transparent",
                        border: `1px solid ${scatterY === v ? "rgba(255,255,255,0.3)" : "#30363d"}`,
                        color: scatterY === v ? "#fff" : "rgba(255,255,255,0.4)",
                        borderRadius: 4, cursor: "pointer", outline: "none",
                      }}>
                        {{ dayReturnPct: "Daily", weeklyPct: "Weekly", monthlyPct: "Monthly" }[v]}
                      </button>
                    ))}
                  </div>
                </div>
                <ResponsiveContainer width="100%" height={500}>
                  <ScatterChart margin={{ top: 20, right: 40, bottom: 40, left: 40 }}>
                    <CartesianGrid stroke="#30363d" strokeOpacity={0.3} strokeDasharray="3 3" />
                    <XAxis type="number" dataKey="x" name={scatterX}
                      tick={{ fontSize: 10, fill: "rgba(255,255,255,0.5)" }}
                      label={{ value: ({ monthlyPct: "Monthly %", ytdPct: "YTD %", yoyPct: "YoY %" } as Record<string, string>)[scatterX], position: "bottom", fill: "rgba(255,255,255,0.4)", fontSize: 10 }}
                    />
                    <YAxis type="number" dataKey="y" name={scatterY}
                      tick={{ fontSize: 10, fill: "rgba(255,255,255,0.5)" }}
                      label={{ value: ({ dayReturnPct: "Daily %", weeklyPct: "Weekly %", monthlyPct: "Monthly %" } as Record<string, string>)[scatterY], angle: -90, position: "left", fill: "rgba(255,255,255,0.4)", fontSize: 10 }}
                    />
                    <Tooltip
                      content={({ payload }) => {
                        if (!payload || !payload[0]) return null;
                        const d = payload[0].payload;
                        return (
                          <div style={{ background: "#161b22", border: "1px solid #30363d", borderRadius: 4, padding: 10, fontFamily: "monospace", fontSize: 10 }}>
                            <div style={{ fontWeight: 700, marginBottom: 4 }}>{d.name}</div>
                            <div>X ({scatterX}): {fmtPct(d.x)}</div>
                            <div>Y ({scatterY}): {fmtPct(d.y)}</div>
                          </div>
                        );
                      }}
                    />
                    <Scatter data={scatterData}>
                      {scatterData.map((entry, i) => (
                        <Cell
                          key={i}
                          fill={CATEGORY_COLORS[entry.category] || "#9e9e9e"}
                          fillOpacity={0.7}
                          r={Math.max(6, Math.min(20, entry.z / 5))}
                        />
                      ))}
                    </Scatter>
                    {/* Reference lines at 0 */}
                    <XAxis type="number" dataKey="x" hide />
                  </ScatterChart>
                </ResponsiveContainer>
                {/* Legend */}
                <div style={{ display: "flex", gap: 20, justifyContent: "center", marginTop: 12 }}>
                  {Object.entries(CATEGORY_COLORS).map(([cat, col]) => (
                    <div key={cat} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <div style={{ width: 10, height: 10, borderRadius: "50%", background: col }} />
                      <span style={{ fontSize: 10, color: "rgba(255,255,255,0.5)" }}>{cat}</span>
                    </div>
                  ))}
                </div>
                {/* Commodity labels as annotations */}
                <div style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", textAlign: "center", marginTop: 8 }}>
                  Bubble size = market importance. Hover for details.
                </div>
              </div>
            )}

            {/* ─── CORRELATIONS TAB ──────────────────── */}
            {tab === "CORRELATIONS" && (
              <div style={{ background: "#161b22", border: "1px solid #30363d", borderRadius: 8, padding: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 12 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.6)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
                    COMMODITY CORRELATION MATRIX
                  </div>
                  <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                    {[30, 60, 90, 180, 365].map(d => (
                      <button key={d} onClick={() => setCorrDays(d)} style={{
                        padding: "4px 10px", fontSize: 9, fontFamily: "monospace", fontWeight: 600,
                        background: corrDays === d ? "rgba(255,255,255,0.1)" : "transparent",
                        border: `1px solid ${corrDays === d ? "rgba(255,255,255,0.3)" : "#30363d"}`,
                        color: corrDays === d ? "#fff" : "rgba(255,255,255,0.4)",
                        borderRadius: 4, cursor: "pointer", outline: "none",
                      }}>
                        {d <= 90 ? `${d}D` : d === 180 ? "6M" : "1Y"}
                      </button>
                    ))}
                    <button onClick={() => setCorrIncludeEquities(!corrIncludeEquities)} style={{
                      padding: "4px 10px", fontSize: 9, fontFamily: "monospace", fontWeight: 600,
                      background: corrIncludeEquities ? "rgba(255,255,255,0.1)" : "transparent",
                      border: `1px solid ${corrIncludeEquities ? "rgba(255,255,255,0.3)" : "#30363d"}`,
                      color: corrIncludeEquities ? "#fff" : "rgba(255,255,255,0.4)",
                      borderRadius: 4, cursor: "pointer", outline: "none", marginLeft: 8,
                    }}>
                      + Equities
                    </button>
                  </div>
                </div>
                {correlation ? (
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ borderCollapse: "collapse", width: "100%" }}>
                      <thead>
                        <tr>
                          <th style={{ padding: 6, fontSize: 9, fontWeight: 600, color: "rgba(255,255,255,0.5)", textAlign: "left", fontFamily: "monospace" }}>
                            Correlations
                          </th>
                          {correlation.labels.map((label, i) => (
                            <th key={i} style={{
                              padding: 6, fontSize: 9, fontWeight: 600, color: "rgba(255,255,255,0.7)",
                              textAlign: "center", fontFamily: "monospace", minWidth: 60,
                              writingMode: correlation.labels.length > 10 ? "vertical-rl" : undefined,
                              height: correlation.labels.length > 10 ? 70 : undefined,
                            }}>
                              {label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {correlation.matrix.map((row, i) => (
                          <tr key={i}>
                            <td style={{ padding: 6, fontSize: 10, fontWeight: 600, color: "rgba(255,255,255,0.8)", fontFamily: "monospace", whiteSpace: "nowrap" }}>
                              {correlation.labels[i]}
                            </td>
                            {row.map((val, j) => {
                              const isIdentity = i === j;
                              const intensity = Math.abs(val);
                              const bg = isIdentity
                                ? "#1e293b"
                                : val > 0
                                  ? `rgba(16,185,129,${Math.min(intensity * 0.5, 0.5)})`
                                  : `rgba(239,68,68,${Math.min(intensity * 0.5, 0.5)})`;
                              return (
                                <td key={j} style={{
                                  padding: 6, textAlign: "center", fontSize: 10, fontWeight: 600,
                                  fontFamily: "monospace", background: bg,
                                  color: isIdentity ? "rgba(255,255,255,0.3)" : intensity > 0.5 ? "#fff" : "rgba(255,255,255,0.7)",
                                }}>
                                  {isIdentity ? "" : val.toFixed(2)}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {/* Color scale legend */}
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 12 }}>
                      <span style={{ fontSize: 9, color: "#ef4444" }}>-1.0</span>
                      <div style={{ width: 120, height: 10, borderRadius: 3, background: "linear-gradient(90deg, rgba(239,68,68,0.5), transparent, rgba(16,185,129,0.5))" }} />
                      <span style={{ fontSize: 9, color: "#10b981" }}>+1.0</span>
                      <span style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", marginLeft: 12 }}>{corrDays}D lookback</span>
                    </div>
                  </div>
                ) : (
                  <div style={{ textAlign: "center", padding: 60, color: "rgba(255,255,255,0.3)" }}>Loading correlations...</div>
                )}
              </div>
            )}

            {/* ─── SECTORS TAB ───────────────────────── */}
            {tab === "SECTORS" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
                {/* Sector Radar Chart */}
                {radarData.length > 0 && (
                  <div style={{ background: "#161b22", border: "1px solid #30363d", borderRadius: 8, padding: 16 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.6)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 12 }}>
                      SECTOR COMMODITY EXPOSURE RADAR
                    </div>
                    <ResponsiveContainer width="100%" height={400}>
                      <RadarChart data={radarData}>
                        <PolarGrid stroke="#30363d" strokeOpacity={0.5} />
                        <PolarAngleAxis dataKey="commodity" tick={{ fontSize: 10, fill: "rgba(255,255,255,0.6)" }} />
                        <PolarRadiusAxis tick={{ fontSize: 9, fill: "rgba(255,255,255,0.3)" }} />
                        {sectors.map(s => (
                          <Radar key={s.name} name={s.name} dataKey={s.name}
                            stroke={s.color} fill={s.color} fillOpacity={0.15} strokeWidth={2} />
                        ))}
                        <Legend
                          wrapperStyle={{ fontSize: 10, fontFamily: "monospace" }}
                          formatter={(value: string) => <span style={{ color: "rgba(255,255,255,0.7)" }}>{value}</span>}
                        />
                      </RadarChart>
                    </ResponsiveContainer>
                    <div style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", textAlign: "center", marginTop: 4 }}>
                      Values = average |beta| of sector stocks to each commodity
                    </div>
                  </div>
                )}

                {/* Sector Performance Bars */}
                <div style={{ background: "#161b22", border: "1px solid #30363d", borderRadius: 8, padding: 16 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.6)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 12 }}>
                    SECTOR ROTATION — PERFORMANCE COMPARISON
                  </div>
                  <ResponsiveContainer width="100%" height={250}>
                    <BarChart data={sectorBarData} margin={{ top: 10, right: 20, bottom: 10, left: 20 }}>
                      <CartesianGrid stroke="#30363d" strokeOpacity={0.3} strokeDasharray="3 3" />
                      <XAxis dataKey="name" tick={{ fontSize: 10, fill: "rgba(255,255,255,0.6)" }} />
                      <YAxis tick={{ fontSize: 10, fill: "rgba(255,255,255,0.5)" }}
                        tickFormatter={(v: number) => `${v.toFixed(1)}%`} />
                      <Tooltip
                        contentStyle={{ background: "#161b22", border: "1px solid #30363d", borderRadius: 4, fontFamily: "monospace", fontSize: 10 }}
                        labelStyle={{ color: "#fff", fontWeight: 700 }}
                        formatter={((v: any) => `${(v ?? 0).toFixed(2)}%`) as any}
                      />
                      <Bar dataKey="daily" name="Daily" radius={[3, 3, 0, 0]}>
                        {sectorBarData.map((entry, i) => (
                          <Cell key={i} fill={entry.daily >= 0 ? "#10b981" : "#ef4444"} fillOpacity={0.7} />
                        ))}
                      </Bar>
                      <Bar dataKey="weekly" name="Weekly" radius={[3, 3, 0, 0]}>
                        {sectorBarData.map((entry, i) => (
                          <Cell key={i} fill={entry.weekly >= 0 ? "#10b981" : "#ef4444"} fillOpacity={0.5} />
                        ))}
                      </Bar>
                      <Bar dataKey="monthly" name="Monthly" radius={[3, 3, 0, 0]}>
                        {sectorBarData.map((entry, i) => (
                          <Cell key={i} fill={entry.monthly >= 0 ? "#10b981" : "#ef4444"} fillOpacity={0.3} />
                        ))}
                      </Bar>
                      <Legend
                        wrapperStyle={{ fontSize: 10, fontFamily: "monospace" }}
                        formatter={(value: string) => <span style={{ color: "rgba(255,255,255,0.5)" }}>{value}</span>}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                {/* Sector Detail Cards */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 12 }}>
                  {sectors.map(s => (
                    <div key={s.name} style={{
                      background: "#161b22", border: "1px solid #30363d", borderRadius: 8,
                      borderLeft: `3px solid ${s.color}`, padding: 16,
                    }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
                        <span style={{ fontSize: 14, fontWeight: 700 }}>{s.name}</span>
                        {s.avgBeta !== null && (
                          <span style={{ fontSize: 10, color: "rgba(255,255,255,0.4)" }}>Avg β: {s.avgBeta.toFixed(2)}</span>
                        )}
                      </div>
                      {/* Performance grid */}
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 4, marginBottom: 12 }}>
                        {[
                          { label: "Day", val: s.performance.daily },
                          { label: "Week", val: s.performance.weekly },
                          { label: "Month", val: s.performance.monthly },
                          { label: "YTD", val: s.performance.ytd },
                        ].map(m => (
                          <div key={m.label} style={{ background: "#0d1117", borderRadius: 4, padding: "4px 6px", textAlign: "center" }}>
                            <div style={{ fontSize: 8, color: "rgba(255,255,255,0.4)", textTransform: "uppercase" }}>{m.label}</div>
                            <div style={{ fontSize: 11, fontWeight: 700, color: pctColor(m.val) }}>{fmtPct(m.val, 1)}</div>
                          </div>
                        ))}
                      </div>
                      {/* Best/Worst */}
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
                        {s.bestPerformer && (
                          <div style={{ background: "rgba(16,185,129,0.08)", borderRadius: 4, padding: "6px 8px" }}>
                            <div style={{ fontSize: 8, color: "#10b981", textTransform: "uppercase", fontWeight: 600 }}>Best</div>
                            <div style={{ fontSize: 11, fontWeight: 700 }}>{s.bestPerformer.ticker}</div>
                            <div style={{ fontSize: 10, color: "#10b981" }}>{fmtPct(s.bestPerformer.dailyPct, 1)}</div>
                          </div>
                        )}
                        {s.worstPerformer && (
                          <div style={{ background: "rgba(239,68,68,0.08)", borderRadius: 4, padding: "6px 8px" }}>
                            <div style={{ fontSize: 8, color: "#ef4444", textTransform: "uppercase", fontWeight: 600 }}>Worst</div>
                            <div style={{ fontSize: 11, fontWeight: 700 }}>{s.worstPerformer.ticker}</div>
                            <div style={{ fontSize: 10, color: "#ef4444" }}>{fmtPct(s.worstPerformer.dailyPct, 1)}</div>
                          </div>
                        )}
                      </div>
                      {/* All stocks */}
                      <div style={{ fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.5)", letterSpacing: "0.05em", textTransform: "uppercase" as const, marginBottom: 6 }}>
                        ALL HOLDINGS
                      </div>
                      {s.stocks.map(st => (
                        <Link key={st.ticker} href={`/stocks/${st.ticker}`} style={{ textDecoration: "none" }}>
                          <div style={{
                            display: "flex", justifyContent: "space-between", padding: "4px 0",
                            borderBottom: "1px solid #21262d", fontSize: 10,
                          }}>
                            <span style={{ color: "rgba(255,255,255,0.7)", fontWeight: 600 }}>{st.ticker}</span>
                            <span style={{ color: "rgba(255,255,255,0.4)" }}>{st.name}</span>
                            <span style={{ fontWeight: 700, color: pctColor(st.dailyPct) }}>{fmtPct(st.dailyPct, 1)}</span>
                          </div>
                        </Link>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
