"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import {
  LineChart, Line, BarChart, Bar, ScatterChart, Scatter,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Cell, ReferenceLine, Legend,
} from "recharts";

/* ================================================================== */
/* Types                                                               */
/* ================================================================== */

type CompanyCard = {
  ticker: string; name: string;
  lastClose: number; priceDate: string;
  dailyPct: number | null; weeklyPct: number | null;
  monthlyPct: number | null; ytdPct: number | null;
  sparkline90d: number[];
  fundamentals: { ep: number | null; bm: number | null; dy: number | null; mktcap: number | null; evEbitda: number | null } | null;
  mlSignal: { prediction: number; confidence: number } | null;
  shortPct: number | null; shortChange: number | null;
};

type OverviewData = {
  companies: CompanyCard[];
  rateSnapshot: { policyRate: number | null; nibor3m: number | null; asOfDate: string | null };
  sectorPerformance: { daily: number | null; weekly: number | null; monthly: number | null; ytd: number | null };
  news: { ticker: string; headline: string; publishedAt: string; category: string; severity: number; sentiment: number | null }[];
};

type RatePoint = { rate: number; date: string };
type RatesData = {
  current: { policyRate: RatePoint | null; nibor3m: RatePoint | null; nibor6m: RatePoint | null; nibor12m: RatePoint | null };
  yieldCurve: { tenor: string; rate: number; date: string }[];
  rateHistory: { date: string; tenor: string; rateType: string; rate: number }[];
  crossCurrency: Record<string, { tenor: string; rateType: string; rate: number; date: string }[]>;
  sensitivity?: unknown[];
};

type ComparisonCompany = {
  ticker: string; name: string; price: number;
  dailyPct: number | null; weeklyPct: number | null; monthlyPct: number | null; ytdPct: number | null;
  ep: number | null; bm: number | null; dy: number | null; mktcap: number | null; evEbitda: number | null;
  mom1m: number | null; mom6m: number | null; mom11m: number | null;
  vol1m: number | null; vol3m: number | null; beta: number | null; ivol: number | null;
  shortPct: number | null; mlPred: number | null; mlConf: number | null;
};

type ComparisonData = { companies: ComparisonCompany[] };

type Prediction = {
  ticker: string; predictionDate: string; prediction: number; confidence: number;
  p05: number; p25: number; p50: number; p75: number; p95: number; signal: string;
};
type ShortEntry = {
  ticker: string; shortPct: number; changePct: number; activePositions: number;
  history: { date: string; shortPct: number }[];
  holders: { holder: string; pct: number }[];
};
type InsiderTx = {
  ticker: string; transactionDate: string; personName: string; personRole: string | null;
  transactionType: string; shares: number; pricePerShare: number | null;
  totalValue: number | null; holdingsAfter: number | null;
};
type Alert = { type: "critical" | "warning" | "info"; message: string; ticker: string | null };
type SignalsData = { predictions: Prediction[]; shorts: ShortEntry[]; insiders: InsiderTx[]; alerts: Alert[] };

type MacroData = {
  fxStrip: { pair: string; rate: number; changePct: number | null; date: string }[];
  fxHistory: Record<string, { date: string; rate: number }[]>;
  cbRegimes: { currency: string; cbName: string; bsPctGdp: number; regime: string; asOfDate: string }[];
  oilExposure: { ticker: string; commodity: string; beta: number; correlation: number; rSquared: number }[];
  fxExposure: { ticker: string; usd: number | null; eur: number | null; gbp: number | null; nok: number | null; other: number | null }[];
};

/* ================================================================== */
/* Constants                                                           */
/* ================================================================== */

const ACCENT = "#6366f1";
const ACCENT_DIM = "rgba(99,102,241,0.15)";
const TABS = ["OVERVIEW", "ANALYSIS", "EXPLORER"] as const;
type Tab = (typeof TABS)[number];

const SUB_MAP: Record<string, { label: string; color: string }> = {
  // Major banks
  DNB: { label: "BANK", color: ACCENT }, MING: { label: "BANK", color: ACCENT },
  NONG: { label: "BANK", color: ACCENT }, MORG: { label: "BANK", color: ACCENT },
  SPOL: { label: "BANK", color: ACCENT }, SB1NO: { label: "BANK", color: ACCENT },
  // Regional banks
  HELG: { label: "BANK", color: ACCENT }, PARB: { label: "BANK", color: ACCENT },
  RING: { label: "BANK", color: ACCENT }, SOAG: { label: "BANK", color: ACCENT },
  SPOG: { label: "BANK", color: ACCENT }, AURG: { label: "BANK", color: ACCENT },
  JAREN: { label: "BANK", color: ACCENT }, GRONG: { label: "BANK", color: ACCENT },
  SNOR: { label: "BANK", color: ACCENT }, MELG: { label: "BANK", color: ACCENT },
  SKUE: { label: "BANK", color: ACCENT }, VVL: { label: "BANK", color: ACCENT },
  BIEN: { label: "BANK", color: ACCENT }, HGSB: { label: "BANK", color: ACCENT },
  ROGS: { label: "BANK", color: ACCENT }, TRSB: { label: "BANK", color: ACCENT },
  SBNOR: { label: "BANK", color: ACCENT }, TINDE: { label: "BANK", color: ACCENT },
  SB68: { label: "BANK", color: ACCENT }, KRAB: { label: "BANK", color: ACCENT },
  INSTA: { label: "BANK", color: ACCENT },
  // Insurance
  GJF: { label: "INS", color: "#10b981" }, STB: { label: "INS", color: "#10b981" },
  PROT: { label: "INS", color: "#10b981" },
  // Financial services
  ABG: { label: "FIN", color: "#f59e0b" }, ACR: { label: "FIN", color: "#f59e0b" },
  B2I: { label: "FIN", color: "#f59e0b" }, BNOR: { label: "FIN", color: "#f59e0b" },
  // Investment companies
  AKER: { label: "INV", color: "#a78bfa" }, BONHR: { label: "INV", color: "#a78bfa" },
  AFK: { label: "INV", color: "#a78bfa" }, MGN: { label: "INV", color: "#a78bfa" },
  SAGA: { label: "INV", color: "#a78bfa" }, ENDUR: { label: "INV", color: "#a78bfa" },
};

/* ================================================================== */
/* Helpers                                                             */
/* ================================================================== */

const fmtPct = (v: number | null | undefined): string => v == null || isNaN(v) ? "---" : (v >= 0 ? "+" : "") + v.toFixed(2) + "%";
const fmtPrice = (v: number | null | undefined): string => v == null ? "---" : v.toFixed(2);
const fmtBps = (v: number | null | undefined): string => v == null || isNaN(v) ? "---" : v.toFixed(2) + "%";
const fmtNok = (v: number | null | undefined): string => {
  if (v == null) return "---";
  if (Math.abs(v) >= 1e12) return (v / 1e12).toFixed(1) + "T";
  if (Math.abs(v) >= 1e9) return (v / 1e9).toFixed(1) + "B";
  if (Math.abs(v) >= 1e6) return (v / 1e6).toFixed(1) + "M";
  if (Math.abs(v) >= 1e3) return (v / 1e3).toFixed(0) + "K";
  return v.toFixed(0);
};
const fmtDate = (v: string | null): string => {
  if (!v) return "---";
  try { return new Date(v).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }); } catch { return v; }
};
const fmtDateLong = (v: string | null): string => {
  if (!v) return "---";
  try { return new Date(v).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" }); } catch { return v; }
};
const retCol = (v: number | null | undefined): string => v == null ? "rgba(255,255,255,0.5)" : v >= 0 ? "#10b981" : "#ef4444";
const alertCol = (t: string): string => t === "critical" ? "#ef4444" : t === "warning" ? "#f59e0b" : "#3b82f6";
const alertBg = (t: string): string => t === "critical" ? "rgba(239,68,68,0.1)" : t === "warning" ? "rgba(245,158,11,0.1)" : "rgba(59,130,246,0.1)";

/* ================================================================== */
/* Shared Components                                                   */
/* ================================================================== */

function Sparkline({ data, width = 80, height = 24 }: { data: number[]; width?: number; height?: number }) {
  if (!data || data.length < 2) return null;
  const mn = Math.min(...data); const mx = Math.max(...data); const rng = mx - mn || 1;
  const pts = data.map((v, i) => `${i === 0 ? "M" : "L"}${((i / (data.length - 1)) * 100).toFixed(1)},${(38 - ((v - mn) / rng) * 34).toFixed(1)}`).join(" ");
  const col = data[data.length - 1] >= data[0] ? "#10b981" : "#ef4444";
  return (
    <svg viewBox="0 0 100 40" style={{ width, height, display: "block" }} preserveAspectRatio="none">
      <path d={pts + " L100,40 L0,40 Z"} fill={col} fillOpacity={0.08} />
      <path d={pts} fill="none" stroke={col} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function MetricCard({ label, value, color, sub }: { label: string; value: string; color?: string; sub?: string }) {
  return (
    <div style={{ background: "#0d1117", border: "1px solid #21262d", borderRadius: 4, padding: "10px 12px", textAlign: "center" }}>
      <div style={{ fontSize: 9, fontWeight: 600, color: "rgba(255,255,255,0.4)", letterSpacing: "0.05em", textTransform: "uppercase" as const, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, color: color || "#fff" }}>{value}</div>
      {sub && <div style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.6)", letterSpacing: "0.08em", textTransform: "uppercase" as const }}>{children}</div>;
}

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <div style={{ background: "#161b22", border: "1px solid #30363d", borderRadius: 8, padding: 16, ...style }}>{children}</div>;
}

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: "#161b22", border: "1px solid #30363d", borderRadius: 4, padding: "6px 10px", fontSize: 10, fontFamily: "monospace" }}>
      <div style={{ color: "rgba(255,255,255,0.5)", marginBottom: 2 }}>{label}</div>
      {payload.map((p: any, i: number) => (
        <div key={i} style={{ color: p.color || "#fff" }}>{p.name}: {typeof p.value === "number" ? p.value.toFixed(3) : p.value}</div>
      ))}
    </div>
  );
}

function sortArr<T>(arr: T[], col: string, asc: boolean, get: (item: T, col: string) => number | string | null): T[] {
  return [...arr].sort((a, b) => {
    const va = get(a, col); const vb = get(b, col);
    if (va == null && vb == null) return 0;
    if (va == null) return 1; if (vb == null) return -1;
    if (typeof va === "string" && typeof vb === "string") return asc ? va.localeCompare(vb) : vb.localeCompare(va);
    return asc ? (va as number) - (vb as number) : (vb as number) - (va as number);
  });
}

/* ================================================================== */
/* Main Page Component                                                 */
/* ================================================================== */

export default function FinancialsPage() {
  const [tab, setTab] = useState<Tab>("OVERVIEW");
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [rates, setRates] = useState<RatesData | null>(null);
  const [comparison, setComparison] = useState<ComparisonData | null>(null);
  const [signals, setSignals] = useState<SignalsData | null>(null);
  const [macro, setMacro] = useState<MacroData | null>(null);
  const [loading, setLoading] = useState(true);

  // State
  const [sortCol, setSortCol] = useState("dailyPct");
  const [sortAsc, setSortAsc] = useState(false);
  const [subFilter, setSubFilter] = useState<"all" | "bank" | "ins" | "fin" | "inv">("all");
  const [perfFilter, setPerfFilter] = useState<"all" | "green" | "red">("all");
  const [expandedShort, setExpandedShort] = useState<string | null>(null);
  const [scenarioBps, setScenarioBps] = useState(0);
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);
  const [explorerData, setExplorerData] = useState<any>(null);
  const [explorerLoading, setExplorerLoading] = useState(false);
  const [explorerTf, setExplorerTf] = useState<"3M" | "6M" | "1Y" | "2Y">("1Y");

  // Fetch overview + comparison on mount (fast, needed for initial render)
  useEffect(() => {
    Promise.all([
      fetch("/api/financials/overview").then(r => r.ok ? r.json() : null),
      fetch("/api/financials/comparison").then(r => r.ok ? r.json() : null),
    ]).then(([ov, comp]) => {
      if (ov) setOverview(ov);
      if (comp) setComparison(comp);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  // Lazy fetch for analysis tab (rates + signals + macro)
  useEffect(() => {
    if (tab === "ANALYSIS") {
      const fetches: Promise<any>[] = [];
      if (!rates) fetches.push(fetch("/api/financials/rates").then(r => r.ok ? r.json() : null));
      else fetches.push(Promise.resolve(null));
      if (!signals) fetches.push(fetch("/api/financials/signals").then(r => r.ok ? r.json() : null));
      else fetches.push(Promise.resolve(null));
      if (!macro) fetches.push(fetch("/api/financials/macro").then(r => r.ok ? r.json() : null));
      else fetches.push(Promise.resolve(null));
      if (fetches.some((_, i) => ![rates, signals, macro][i])) {
        Promise.all(fetches).then(([r, s, m]) => {
          if (r) setRates(r);
          if (s) setSignals(s);
          if (m) setMacro(m);
        }).catch(() => {});
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  // Load explorer data when ticker changes
  useEffect(() => {
    if (!selectedTicker) return;
    setExplorerLoading(true);
    setExplorerData(null);
    const days = explorerTf === "3M" ? 90 : explorerTf === "6M" ? 180 : explorerTf === "1Y" ? 365 : 730;
    Promise.all([
      fetch(`/api/analytics/${selectedTicker}?days=${days}`).then(r => r.ok ? r.json() : null),
      fetch(`/api/equities/${selectedTicker}`).then(r => r.ok ? r.json() : null),
      fetch(`/api/fundamentals/${selectedTicker}`).then(r => r.ok ? r.json() : null),
      fetch(`/api/factors/${selectedTicker}`).then(r => r.ok ? r.json() : null),
      fetch(`/api/predictions/${selectedTicker}`).then(r => r.ok ? r.json() : null),
      fetch(`/api/shorts/${selectedTicker}`).then(r => r.ok ? r.json() : null),
      fetch(`/api/news/ticker/${selectedTicker}`).then(r => r.ok ? r.json() : null),
    ]).then(([anal, info, fund, fac, pred, sh, nws]) => {
      // factors API returns { data: [...] } array — use latest entry for both technical + fundamental fields
      const latestFac = fac?.data?.[0] || null;
      setExplorerData({ analytics: anal, info: info?.data || info, fundamentals: latestFac, technical: latestFac, prediction: pred?.predictions?.[0] || null, shorts: sh, news: nws?.items?.slice(0, 15) || (Array.isArray(nws) ? nws.slice(0, 15) : []) });
    }).catch(() => {}).finally(() => setExplorerLoading(false));
  }, [selectedTicker, explorerTf]);

  /* ---------------------------------------------------------------- */
  /* OVERVIEW TAB                                                      */
  /* ---------------------------------------------------------------- */

  function renderOverview() {
    if (!overview) return <div style={{ color: "rgba(255,255,255,0.4)", padding: 40, textAlign: "center" }}>Loading...</div>;
    const { companies, rateSnapshot, sectorPerformance, news } = overview;
    const compRows = comparison?.companies ? [...comparison.companies] : [];
    const cbRegimes = macro?.cbRegimes || [];

    let filtered = compRows;
    if (subFilter === "bank") filtered = filtered.filter(c => SUB_MAP[c.ticker]?.label === "BANK");
    else if (subFilter === "ins") filtered = filtered.filter(c => SUB_MAP[c.ticker]?.label === "INS");
    else if (subFilter === "fin") filtered = filtered.filter(c => SUB_MAP[c.ticker]?.label === "FIN");
    else if (subFilter === "inv") filtered = filtered.filter(c => SUB_MAP[c.ticker]?.label === "INV");
    if (perfFilter === "green") filtered = filtered.filter(c => c.dailyPct != null && c.dailyPct >= 0);
    else if (perfFilter === "red") filtered = filtered.filter(c => c.dailyPct != null && c.dailyPct < 0);

    const sorted = sortArr(filtered, sortCol, sortAsc, (item: any, col: string) => {
      if (col === "ticker") return item.ticker;
      if (col === "pe") return item.ep && item.ep > 0 ? 1 / item.ep : null;
      if (col === "pb") return item.bm && item.bm > 0 ? 1 / item.bm : null;
      return item[col] ?? null;
    });

    const handleSort = (col: string) => {
      if (col === sortCol) setSortAsc(!sortAsc);
      else { setSortCol(col); setSortAsc(col === "ticker"); }
    };

    const cols = [
      { key: "ticker", label: "Ticker", align: "left" as const },
      { key: "price", label: "Price", align: "right" as const },
      { key: "dailyPct", label: "1D%", align: "right" as const },
      { key: "weeklyPct", label: "1W%", align: "right" as const },
      { key: "monthlyPct", label: "1M%", align: "right" as const },
      { key: "ytdPct", label: "YTD%", align: "right" as const },
      { key: "pe", label: "P/E", align: "right" as const },
      { key: "pb", label: "P/B", align: "right" as const },
      { key: "dy", label: "DY%", align: "right" as const },
      { key: "mom6m", label: "Mom6M", align: "right" as const },
      { key: "beta", label: "Beta", align: "right" as const },
      { key: "mlPred", label: "ML Pred", align: "right" as const },
    ];

    const openExplorer = (t: string) => {
      setSelectedTicker(t);
      setTab("EXPLORER");
    };

    // Scatter data for valuation chart - no labels on dots, only on hover
    const scatterData = compRows.filter(c => c.ep && c.ep > 0 && c.mom6m != null).map(c => ({
      ticker: c.ticker, pe: 1 / c.ep!, mom6m: (c.mom6m ?? 0) * 100,
      mktcap: c.mktcap ?? 1e9, mlPred: c.mlPred ?? 0,
      sub: SUB_MAP[c.ticker]?.label || "OTHER",
    }));

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {/* KPI Strip */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
          <MetricCard label="NB POLICY RATE" value={fmtBps(rateSnapshot.policyRate)} />
          <MetricCard label="NIBOR 3M" value={fmtBps(rateSnapshot.nibor3m)} />
          <MetricCard label="SECTOR DAILY" value={fmtPct(sectorPerformance.daily)} color={retCol(sectorPerformance.daily)} />
          <MetricCard label="SECTOR YTD" value={fmtPct(sectorPerformance.ytd)} color={retCol(sectorPerformance.ytd)} />
        </div>

        {/* Filter + Scorecard Table */}
        <Card style={{ padding: 0 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px 0", flexWrap: "wrap", gap: 6 }}>
            <SectionTitle>SECTOR SCORECARD ({filtered.length})</SectionTitle>
            <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
              {/* Performance filter */}
              {[
                { k: "all", l: "ALL", col: "#9ca3af", bg: "rgba(156,163,175,0.1)" },
                { k: "green", l: "\u25B2 UP", col: "#10b981", bg: "rgba(16,185,129,0.1)" },
                { k: "red", l: "\u25BC DN", col: "#ef4444", bg: "rgba(239,68,68,0.1)" },
              ].map(f => (
                <button key={f.k} onClick={() => setPerfFilter(f.k as any)} style={{
                  padding: "3px 8px", borderRadius: 3, border: "1px solid " + (perfFilter === f.k ? f.col : "#30363d"),
                  background: perfFilter === f.k ? f.bg : "transparent", color: perfFilter === f.k ? f.col : "rgba(255,255,255,0.3)",
                  fontSize: 9, fontWeight: 700, fontFamily: "monospace", cursor: "pointer",
                }}>{f.l}</button>
              ))}
              <div style={{ width: 1, height: 16, background: "#30363d", margin: "0 2px" }} />
              {/* Type filter */}
              {[{ k: "all", l: "ALL" }, { k: "bank", l: "BANKS" }, { k: "ins", l: "INS" }, { k: "fin", l: "FIN" }, { k: "inv", l: "INV" }].map(f => (
                <button key={f.k} onClick={() => setSubFilter(f.k as any)} style={{
                  padding: "3px 10px", borderRadius: 3, border: "1px solid " + (subFilter === f.k ? ACCENT : "#30363d"),
                  background: subFilter === f.k ? ACCENT_DIM : "transparent", color: subFilter === f.k ? ACCENT : "rgba(255,255,255,0.4)",
                  fontSize: 9, fontWeight: 700, fontFamily: "monospace", cursor: "pointer",
                }}>{f.l}</button>
              ))}
            </div>
          </div>
          {sorted.length > 0 ? (
            <div style={{ overflowX: "auto", maxHeight: 440, overflowY: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10, fontFamily: "monospace" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid #30363d" }}>
                    {cols.map(c => (
                      <th key={c.key} onClick={() => handleSort(c.key)} style={{
                        padding: "8px 6px", textAlign: c.align, fontSize: 9, fontWeight: 600,
                        color: sortCol === c.key ? ACCENT : "rgba(255,255,255,0.5)",
                        letterSpacing: "0.04em", textTransform: "uppercase" as const, cursor: "pointer", whiteSpace: "nowrap" as const,
                      }}>{c.label}{sortCol === c.key ? (sortAsc ? " ^" : " v") : ""}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((c: ComparisonCompany) => {
                    const sub = SUB_MAP[c.ticker];
                    const pe = c.ep && c.ep > 0 ? (1 / c.ep).toFixed(1) : "---";
                    const pbVal = c.bm && c.bm > 0 ? (1 / c.bm).toFixed(1) : "---";
                    const dy = c.dy != null ? (c.dy * 100).toFixed(1) : "---";
                    return (
                      <tr key={c.ticker} style={{ borderBottom: "1px solid #21262d", transition: "background 0.1s" }}
                        onMouseEnter={e => (e.currentTarget.style.background = "rgba(99,102,241,0.05)")}
                        onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                        <td style={{ padding: "5px 6px" }}>
                          <span onClick={() => openExplorer(c.ticker)} style={{ color: sub?.color || "#fff", fontWeight: 600, cursor: "pointer" }}>{c.ticker}</span>
                          <span style={{ fontSize: 7, marginLeft: 3, padding: "0 3px", borderRadius: 2, background: (sub?.color || "#666") + "20", color: sub?.color || "#666" }}>{sub?.label}</span>
                        </td>
                        <td style={{ padding: "5px 6px", textAlign: "right", fontWeight: 600 }}>{fmtPrice(c.price)}</td>
                        <td style={{ padding: "5px 6px", textAlign: "right", fontWeight: 600, color: retCol(c.dailyPct) }}>{fmtPct(c.dailyPct)}</td>
                        <td style={{ padding: "5px 6px", textAlign: "right", color: retCol(c.weeklyPct) }}>{fmtPct(c.weeklyPct)}</td>
                        <td style={{ padding: "5px 6px", textAlign: "right", color: retCol(c.monthlyPct) }}>{fmtPct(c.monthlyPct)}</td>
                        <td style={{ padding: "5px 6px", textAlign: "right", color: retCol(c.ytdPct) }}>{fmtPct(c.ytdPct)}</td>
                        <td style={{ padding: "5px 6px", textAlign: "right" }}>{pe}</td>
                        <td style={{ padding: "5px 6px", textAlign: "right" }}>{pbVal}</td>
                        <td style={{ padding: "5px 6px", textAlign: "right" }}>{dy}</td>
                        <td style={{ padding: "5px 6px", textAlign: "right", color: retCol(c.mom6m) }}>{c.mom6m != null ? (c.mom6m * 100).toFixed(1) + "%" : "---"}</td>
                        <td style={{ padding: "5px 6px", textAlign: "right" }}>{c.beta != null ? c.beta.toFixed(2) : "---"}</td>
                        <td style={{ padding: "5px 6px", textAlign: "right", fontWeight: 600, color: retCol(c.mlPred) }}>{c.mlPred != null ? (c.mlPred * 100).toFixed(1) + "%" : "---"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : <div style={{ color: "rgba(255,255,255,0.35)", fontSize: 10, padding: 20, textAlign: "center" }}>Loading scorecard...</div>}
        </Card>

        {/* 2-column: Company Cards + CB Regimes & Scatter */}
        <div style={{ display: "grid", gridTemplateColumns: "3fr 2fr", gap: 12 }}>
          {/* Company Cards */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <SectionTitle>COMPANIES ({companies.length})</SectionTitle>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 8 }}>
              {companies.map(c => {
                const sub = SUB_MAP[c.ticker];
                const pe = c.fundamentals?.ep && c.fundamentals.ep > 0 ? (1 / c.fundamentals.ep).toFixed(1) : "---";
                const dy = c.fundamentals?.dy != null ? (c.fundamentals.dy * 100).toFixed(1) + "%" : "---";
                return (
                  <div key={c.ticker} onClick={() => openExplorer(c.ticker)} style={{ cursor: "pointer" }}>
                    <div style={{ background: "#161b22", border: "1px solid #30363d", borderRadius: 6, padding: "10px 12px", cursor: "pointer", transition: "border-color 0.15s", height: "100%" }}
                      onMouseEnter={e => (e.currentTarget.style.borderColor = ACCENT)}
                      onMouseLeave={e => (e.currentTarget.style.borderColor = "#30363d")}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <span style={{ fontSize: 12, fontWeight: 700, color: "#fff" }}>{c.ticker}</span>
                          {sub && <span style={{ fontSize: 7, fontWeight: 700, padding: "0 4px", borderRadius: 2, background: sub.color + "20", color: sub.color }}>{sub.label}</span>}
                        </div>
                        <Sparkline data={c.sparkline90d} width={60} height={20} />
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                        <span style={{ fontSize: 16, fontWeight: 800, color: "#fff" }}>{fmtPrice(c.lastClose)}</span>
                        <span style={{ fontSize: 10, fontWeight: 700, color: retCol(c.dailyPct) }}>{fmtPct(c.dailyPct)}</span>
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 2, marginTop: 6, fontSize: 8, color: "rgba(255,255,255,0.45)" }}>
                        <div><span style={{ color: "rgba(255,255,255,0.3)" }}>P/E </span>{pe}</div>
                        <div><span style={{ color: "rgba(255,255,255,0.3)" }}>P/B </span>{c.fundamentals?.bm && c.fundamentals.bm > 0 ? (1 / c.fundamentals.bm).toFixed(1) : "---"}</div>
                        <div><span style={{ color: "rgba(255,255,255,0.3)" }}>DY </span>{dy}</div>
                        <div><span style={{ color: "rgba(255,255,255,0.3)" }}>ML </span><span style={{ color: retCol(c.mlSignal?.prediction ?? null) }}>{c.mlSignal ? fmtPct(c.mlSignal.prediction * 100) : "---"}</span></div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right column: CB Regimes + Scatter */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <SectionTitle>GLOBAL MONETARY POLICY</SectionTitle>
            <Card style={{ padding: 12 }}>
              <div style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", marginBottom: 8 }}>How aggressively each central bank is stimulating its economy. Printing money = loose policy (bad for banks). Tightening = good for bank margins.</div>
              {cbRegimes.length > 0 ? (
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10, fontFamily: "monospace" }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid #30363d" }}>
                      {["Currency", "Central Bank", "Stimulus Level", "Impact on Banks"].map(h => (
                        <th key={h} style={{ padding: "5px 6px", textAlign: h === "Stimulus Level" ? "right" : "left", fontSize: 9, fontWeight: 600, color: "rgba(255,255,255,0.5)" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {cbRegimes.map((cb: any) => {
                      // Map regime to user-friendly labels
                      const regimeMap: Record<string, { label: string; col: string; impact: string }> = {
                        "QE Active": { label: "Heavy Stimulus", col: "#ef4444", impact: "Negative — compresses margins" },
                        "Elevated": { label: "Moderate Stimulus", col: "#f59e0b", impact: "Mixed — margins under pressure" },
                        "Tapering": { label: "Winding Down", col: "#3b82f6", impact: "Improving — margins expanding" },
                        "Minimal": { label: "Normal", col: "#10b981", impact: "Positive — healthy margins" },
                      };
                      const info = regimeMap[cb.regime] || { label: cb.regime, col: "#6b7280", impact: "---" };
                      return (
                        <tr key={cb.currency} style={{ borderBottom: "1px solid #21262d" }}>
                          <td style={{ padding: "4px 6px", fontWeight: 600, color: cb.currency === "NOK" ? ACCENT : "#fff", fontSize: 10 }}>{cb.currency}</td>
                          <td style={{ padding: "4px 6px", color: "rgba(255,255,255,0.45)", fontSize: 9 }}>{cb.cbName}</td>
                          <td style={{ padding: "4px 6px", textAlign: "right" }}>
                            <span style={{ fontSize: 8, fontWeight: 700, padding: "1px 5px", borderRadius: 2, background: info.col + "20", color: info.col }}>{info.label}</span>
                          </td>
                          <td style={{ padding: "4px 6px", color: "rgba(255,255,255,0.45)", fontSize: 9 }}>{info.impact}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : <div style={{ color: "rgba(255,255,255,0.35)", fontSize: 10, padding: 12, textAlign: "center" }}>Loading...</div>}
            </Card>

            <SectionTitle>VALUATION VS MOMENTUM</SectionTitle>
            <Card style={{ padding: 12 }}>
              {scatterData.length > 0 ? (
                <div style={{ width: "100%", height: 260 }}>
                  <ResponsiveContainer>
                    <ScatterChart margin={{ left: 5, right: 15, top: 10, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#21262d" />
                      <XAxis type="number" dataKey="pe" tick={{ fontSize: 9, fill: "rgba(255,255,255,0.5)" }} label={{ value: "P/E", position: "bottom", fontSize: 9, fill: "rgba(255,255,255,0.4)" }} />
                      <YAxis type="number" dataKey="mom6m" tick={{ fontSize: 9, fill: "rgba(255,255,255,0.5)" }} label={{ value: "Mom6M %", angle: -90, position: "insideLeft", fontSize: 9, fill: "rgba(255,255,255,0.4)" }} />
                      <Tooltip content={({ active, payload }: any) => {
                        if (!active || !payload?.[0]) return null;
                        const d = payload[0].payload;
                        const sub = SUB_MAP[d.ticker];
                        return (
                          <div style={{ background: "#161b22", border: "1px solid #30363d", borderRadius: 4, padding: "6px 10px", fontSize: 10, fontFamily: "monospace" }}>
                            <div style={{ fontWeight: 700, color: sub?.color || ACCENT, marginBottom: 2 }}>{d.ticker} <span style={{ fontSize: 8, fontWeight: 400, color: "rgba(255,255,255,0.4)" }}>{d.sub}</span></div>
                            <div>P/E: {d.pe.toFixed(1)}</div>
                            <div>Mom6M: {d.mom6m.toFixed(1)}%</div>
                            <div>ML: <span style={{ color: retCol(d.mlPred) }}>{d.mlPred !== 0 ? (d.mlPred * 100).toFixed(1) + "%" : "---"}</span></div>
                          </div>
                        );
                      }} />
                      <Scatter data={scatterData} shape={(props: any) => {
                        const { cx, cy, payload } = props;
                        const sub = SUB_MAP[payload.ticker];
                        const col = sub?.color || "#6b7280";
                        return <circle cx={cx} cy={cy} r={3.5} fill={col} fillOpacity={0.85} stroke="#0a0a0a" strokeWidth={0.5} />;
                      }} />
                    </ScatterChart>
                  </ResponsiveContainer>
                  {/* Legend */}
                  <div style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 4 }}>
                    {[{ label: "BANK", color: ACCENT }, { label: "INS", color: "#10b981" }, { label: "FIN", color: "#f59e0b" }, { label: "INV", color: "#a78bfa" }].map(l => (
                      <div key={l.label} style={{ display: "flex", alignItems: "center", gap: 3 }}>
                        <div style={{ width: 6, height: 6, borderRadius: "50%", background: l.color }} />
                        <span style={{ fontSize: 8, color: "rgba(255,255,255,0.5)" }}>{l.label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : <div style={{ color: "rgba(255,255,255,0.35)", fontSize: 10, padding: 20, textAlign: "center" }}>Insufficient data</div>}
            </Card>

            {/* News in right column */}
            {news.length > 0 && (
              <Card style={{ padding: 12 }}>
                <SectionTitle>RECENT NEWS & FILINGS</SectionTitle>
                <div style={{ maxHeight: 300, overflowY: "auto", marginTop: 6 }}>
                  {news.map((n: any, i: number) => (
                    <div key={i} style={{ display: "flex", gap: 6, alignItems: "flex-start", padding: "4px 0", borderBottom: i < news.length - 1 ? "1px solid #21262d" : "none" }}>
                      <span style={{ fontSize: 8, fontWeight: 600, color: SUB_MAP[n.ticker]?.color || ACCENT, flexShrink: 0, marginTop: 1 }}>{n.ticker}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 9, color: "rgba(255,255,255,0.7)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{n.headline}</div>
                        <div style={{ fontSize: 7, color: "rgba(255,255,255,0.3)", marginTop: 1 }}>{fmtDate(n.publishedAt)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </div>
        </div>
      </div>
    );
  }

  /* ---------------------------------------------------------------- */
  /* ANALYSIS TAB (merged Rates + Signals + Macro)                     */
  /* ---------------------------------------------------------------- */

  function renderAnalysis() {
    const hasRates = !!rates;
    const hasSigs = !!signals;
    const hasMacro = !!macro;
    if (!hasRates && !hasSigs && !hasMacro) return <div style={{ color: "rgba(255,255,255,0.4)", padding: 40, textAlign: "center" }}>Loading analysis...</div>;

    // Rate data
    const current = rates?.current;
    const yieldCurve = rates?.yieldCurve || [];
    const rateHistory = rates?.rateHistory || [];
    const crossCurrency = rates?.crossCurrency || {};
    // Rate sensitivity removed — policy rate flat, no significance

    // Rate history pivot
    const histMap: Record<string, any> = {};
    for (const r of rateHistory) {
      if (!histMap[r.date]) histMap[r.date] = { date: r.date };
      if (r.rateType === "POLICY_RATE" && r.tenor === "OVERNIGHT") histMap[r.date].policy = r.rate;
      if (r.rateType === "IBOR" && r.tenor === "3M") histMap[r.date].nibor3m = r.rate;
    }
    const histChartData = Object.values(histMap).sort((a: any, b: any) => a.date.localeCompare(b.date));

    // Signal data
    const predictions = signals?.predictions || [];
    const shorts = signals?.shorts || [];
    const insiders = signals?.insiders || [];
    const alerts = signals?.alerts || [];

    // Macro data
    const fxStrip = macro?.fxStrip || [];
    const fxHistory = macro?.fxHistory || {};
    const fxExposure = macro?.fxExposure || [];

    // FX chart: merge all pairs by date
    const fxChartMap: Record<string, any> = {};
    for (const pair of Object.keys(fxHistory)) {
      for (const pt of fxHistory[pair]) {
        if (!fxChartMap[pt.date]) fxChartMap[pt.date] = { date: pt.date };
        fxChartMap[pt.date][pair] = pt.rate;
      }
    }
    const fxChartData = Object.values(fxChartMap).sort((a: any, b: any) => a.date.localeCompare(b.date));

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {/* Alerts */}
        {alerts.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {alerts.map((a, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 12px", borderRadius: 6, background: alertBg(a.type), border: "1px solid " + alertCol(a.type) + "30" }}>
                <span style={{ fontSize: 9, fontWeight: 700, color: alertCol(a.type) }}>!</span>
                <span style={{ fontSize: 10, color: "rgba(255,255,255,0.8)" }}>{a.message}</span>
              </div>
            ))}
          </div>
        )}

        {/* Rate Strip */}
        {current && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
            <MetricCard label="NB POLICY RATE" value={current.policyRate ? fmtBps(current.policyRate.rate) : "---"} />
            <MetricCard label="NIBOR 3M" value={current.nibor3m ? fmtBps(current.nibor3m.rate) : "---"} />
            <MetricCard label="NIBOR 6M" value={current.nibor6m ? fmtBps(current.nibor6m.rate) : "---"} />
            <MetricCard label="NIBOR 12M" value={current.nibor12m ? fmtBps(current.nibor12m.rate) : "---"} />
          </div>
        )}

        {/* 2-column: Yield Curve + Rate History */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 12 }}>
          <Card>
            <SectionTitle>NOK YIELD CURVE</SectionTitle>
            {yieldCurve.length > 0 ? (
              <div style={{ width: "100%", height: 180, marginTop: 8 }}>
                <ResponsiveContainer>
                  <LineChart data={yieldCurve} margin={{ left: 10, right: 10, top: 5, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#21262d" />
                    <XAxis dataKey="tenor" tick={{ fontSize: 9, fill: "rgba(255,255,255,0.5)" }} />
                    <YAxis tick={{ fontSize: 9, fill: "rgba(255,255,255,0.5)" }} tickFormatter={v => v.toFixed(1) + "%"} domain={["auto", "auto"]} />
                    <Tooltip content={<ChartTooltip />} />
                    <Line type="monotone" dataKey="rate" stroke={ACCENT} strokeWidth={2} dot={{ fill: ACCENT, r: 3 }} name="Rate" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : <div style={{ color: "rgba(255,255,255,0.35)", fontSize: 10, padding: 20, textAlign: "center" }}>No data</div>}
          </Card>
          <Card>
            <SectionTitle>RATE HISTORY</SectionTitle>
            {histChartData.length > 0 ? (
              <div style={{ width: "100%", height: 180, marginTop: 8 }}>
                <ResponsiveContainer>
                  <LineChart data={histChartData} margin={{ left: 10, right: 10, top: 5, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#21262d" />
                    <XAxis dataKey="date" tick={{ fontSize: 8, fill: "rgba(255,255,255,0.4)" }} tickFormatter={v => v.slice(5)} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 9, fill: "rgba(255,255,255,0.5)" }} tickFormatter={v => v.toFixed(1) + "%"} domain={["auto", "auto"]} />
                    <Tooltip content={<ChartTooltip />} />
                    <Line type="stepAfter" dataKey="policy" stroke="#f59e0b" strokeWidth={2} dot={false} name="Policy Rate" connectNulls />
                    <Line type="monotone" dataKey="nibor3m" stroke={ACCENT} strokeWidth={1.5} dot={false} name="NIBOR 3M" connectNulls />
                    <Legend wrapperStyle={{ fontSize: 9 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : <div style={{ color: "rgba(255,255,255,0.35)", fontSize: 10, padding: 20, textAlign: "center" }}>Limited history</div>}
          </Card>
        </div>

        {/* ML Predictions Table */}
        {predictions.length > 0 && (
          <Card style={{ padding: 0 }}>
            <div style={{ padding: "12px 14px 0" }}><SectionTitle>ML PREDICTIONS (1-MONTH FORWARD)</SectionTitle></div>
            <div style={{ maxHeight: 320, overflowY: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10, fontFamily: "monospace" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid #30363d" }}>
                    {["Ticker", "Signal", "Prediction", "P25", "P50", "P75", "Confidence"].map(h => (
                      <th key={h} style={{ padding: "6px 8px", textAlign: h === "Ticker" || h === "Signal" ? "left" : "right", fontSize: 9, fontWeight: 600, color: "rgba(255,255,255,0.5)", position: "sticky" as const, top: 0, background: "#161b22", zIndex: 1 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[...predictions].sort((a, b) => b.prediction - a.prediction).map(p => {
                    const sub = SUB_MAP[p.ticker];
                    const sigCol = p.signal.includes("BUY") ? "#10b981" : p.signal.includes("SELL") ? "#ef4444" : "#6b7280";
                    return (
                      <tr key={p.ticker} style={{ borderBottom: "1px solid #21262d" }}
                        onMouseEnter={e => (e.currentTarget.style.background = "rgba(99,102,241,0.05)")}
                        onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                        <td style={{ padding: "5px 8px" }}>
                          <span onClick={() => { setSelectedTicker(p.ticker); setTab("EXPLORER"); }} style={{ fontWeight: 700, color: sub?.color || "#fff", cursor: "pointer" }}>{p.ticker}</span>
                          <span style={{ fontSize: 7, marginLeft: 3, color: "rgba(255,255,255,0.3)" }}>{sub?.label}</span>
                        </td>
                        <td style={{ padding: "5px 8px" }}>
                          <span style={{ fontSize: 8, fontWeight: 700, padding: "1px 5px", borderRadius: 2, background: sigCol + "20", color: sigCol }}>{p.signal}</span>
                        </td>
                        <td style={{ padding: "5px 8px", textAlign: "right", fontWeight: 700, color: retCol(p.prediction) }}>{fmtPct(p.prediction * 100)}</td>
                        <td style={{ padding: "5px 8px", textAlign: "right", color: "rgba(255,255,255,0.4)" }}>{p.p25 != null ? fmtPct(p.p25 * 100) : "---"}</td>
                        <td style={{ padding: "5px 8px", textAlign: "right", color: "rgba(255,255,255,0.5)" }}>{p.p50 != null ? fmtPct(p.p50 * 100) : "---"}</td>
                        <td style={{ padding: "5px 8px", textAlign: "right", color: "rgba(255,255,255,0.4)" }}>{p.p75 != null ? fmtPct(p.p75 * 100) : "---"}</td>
                        <td style={{ padding: "5px 8px", textAlign: "right", color: "rgba(255,255,255,0.4)" }}>{p.confidence != null ? (p.confidence * 100).toFixed(0) + "%" : "---"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        {/* 2-column: Shorts + Cross-Currency */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          {/* Short Interest */}
          <Card>
            <SectionTitle>SHORT INTEREST</SectionTitle>
            {shorts.length > 0 ? (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10, fontFamily: "monospace", marginTop: 8 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid #30363d" }}>
                    {["Ticker", "Short%", "Chg", "90d"].map(h => (
                      <th key={h} style={{ padding: "5px 6px", textAlign: h === "Ticker" ? "left" : "right", fontSize: 9, fontWeight: 600, color: "rgba(255,255,255,0.5)" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {shorts.sort((a, b) => b.shortPct - a.shortPct).map(s => (
                    <React.Fragment key={s.ticker}>
                      <tr style={{ borderBottom: "1px solid #21262d", cursor: s.holders.length > 0 ? "pointer" : "default" }}
                        onClick={() => s.holders.length > 0 && setExpandedShort(expandedShort === s.ticker ? null : s.ticker)}>
                        <td style={{ padding: "4px 6px", fontWeight: 600, color: SUB_MAP[s.ticker]?.color || "#fff" }}>{s.ticker}</td>
                        <td style={{ padding: "4px 6px", textAlign: "right", fontWeight: 700, color: s.shortPct > 3 ? "#f59e0b" : "#fff" }}>{s.shortPct.toFixed(2)}%</td>
                        <td style={{ padding: "4px 6px", textAlign: "right", color: retCol(s.changePct) }}>{s.changePct != null ? (s.changePct >= 0 ? "+" : "") + s.changePct.toFixed(2) + "pp" : "---"}</td>
                        <td style={{ padding: "4px 6px", textAlign: "right" }}><Sparkline data={s.history.map(h => h.shortPct)} width={60} height={16} /></td>
                      </tr>
                      {expandedShort === s.ticker && s.holders.length > 0 && (
                        <tr><td colSpan={4} style={{ padding: "0 6px 6px 20px", background: "#0d1117" }}>
                          {s.holders.map((h, i) => (
                            <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "2px 0", fontSize: 9, color: "rgba(255,255,255,0.5)" }}>
                              <span>{h.holder}</span><span style={{ fontWeight: 600 }}>{h.pct.toFixed(2)}%</span>
                            </div>
                          ))}
                        </td></tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            ) : <div style={{ color: "rgba(255,255,255,0.35)", fontSize: 10, padding: 20, textAlign: "center" }}>No short positions</div>}
          </Card>

          {/* Cross-Currency */}
          <Card>
            <SectionTitle>CROSS-CURRENCY RATES</SectionTitle>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10, fontFamily: "monospace", marginTop: 8 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #30363d" }}>
                  <th style={{ padding: "5px 6px", textAlign: "left", fontSize: 9, fontWeight: 600, color: "rgba(255,255,255,0.5)" }}></th>
                  {["NOK", "USD", "EUR", "GBP", "SEK"].map(c => (
                    <th key={c} style={{ padding: "5px 6px", textAlign: "right", fontSize: 9, fontWeight: 600, color: c === "NOK" ? ACCENT : "rgba(255,255,255,0.5)" }}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[{ label: "Policy Rate", type: "POLICY_RATE", tenor: "OVERNIGHT" }, { label: "3M IBOR", type: "IBOR", tenor: "3M" }].map(row => (
                  <tr key={row.label} style={{ borderBottom: "1px solid #21262d" }}>
                    <td style={{ padding: "4px 6px", fontSize: 9, color: "rgba(255,255,255,0.5)" }}>{row.label}</td>
                    {["NOK", "USD", "EUR", "GBP", "SEK"].map(cur => {
                      const entries = crossCurrency[cur] || [];
                      const match = entries.find((e: any) => e.rateType === row.type && e.tenor === row.tenor);
                      return (
                        <td key={cur} style={{ padding: "4px 6px", textAlign: "right", fontWeight: cur === "NOK" ? 700 : 400, color: cur === "NOK" ? ACCENT : "#fff" }}>
                          {match ? match.rate.toFixed(2) + "%" : "---"}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>

        {/* Rate sensitivity removed — policy rate unchanged, no statistical significance */}

        {/* Insider Transactions */}
        {insiders.length > 0 && (
          <Card>
            <SectionTitle>INSIDER TRANSACTIONS (90 DAYS)</SectionTitle>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10, fontFamily: "monospace", marginTop: 8 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #30363d" }}>
                  {["Date", "Ticker", "Person", "Type", "Value (NOK)"].map(h => (
                    <th key={h} style={{ padding: "5px 6px", textAlign: h === "Value (NOK)" ? "right" : "left", fontSize: 9, fontWeight: 600, color: "rgba(255,255,255,0.5)" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {insiders.map((tx, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid #21262d" }}>
                    <td style={{ padding: "4px 6px", color: "rgba(255,255,255,0.4)", fontSize: 9 }}>{fmtDateLong(tx.transactionDate)}</td>
                    <td style={{ padding: "4px 6px", fontWeight: 600, color: SUB_MAP[tx.ticker]?.color || "#fff" }}>{tx.ticker}</td>
                    <td style={{ padding: "4px 6px", color: "rgba(255,255,255,0.6)" }}>{tx.personName}</td>
                    <td style={{ padding: "4px 6px" }}>
                      <span style={{ fontSize: 8, fontWeight: 700, padding: "1px 4px", borderRadius: 2, background: tx.transactionType === "BUY" ? "rgba(16,185,129,0.15)" : "rgba(239,68,68,0.15)", color: tx.transactionType === "BUY" ? "#10b981" : "#ef4444" }}>{tx.transactionType}</span>
                    </td>
                    <td style={{ padding: "4px 6px", textAlign: "right", fontWeight: 600 }}>{tx.totalValue != null ? fmtNok(tx.totalValue) : "---"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}

        {/* FX Section (from Macro) */}
        {fxStrip.length > 0 && (
          <>
            <SectionTitle>FX ENVIRONMENT</SectionTitle>
            <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(fxStrip.length, 4)}, 1fr)`, gap: 8 }}>
              {fxStrip.map(f => (
                <MetricCard key={f.pair} label={f.pair.replace("NOK", "NOK/")} value={f.rate.toFixed(4)} color="#fff" sub={f.changePct != null ? fmtPct(f.changePct) : undefined} />
              ))}
            </div>
          </>
        )}

        {/* 2-column: FX Chart + FX Exposure */}
        {(fxChartData.length > 0 || fxExposure.length > 0) && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {fxChartData.length > 0 && (
              <Card>
                <SectionTitle>FX RATES (90D)</SectionTitle>
                <div style={{ width: "100%", height: 180, marginTop: 8 }}>
                  <ResponsiveContainer>
                    <LineChart data={fxChartData} margin={{ left: 10, right: 10, top: 5, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#21262d" />
                      <XAxis dataKey="date" tick={{ fontSize: 8, fill: "rgba(255,255,255,0.4)" }} tickFormatter={v => v.slice(5)} interval="preserveStartEnd" />
                      <YAxis yAxisId="usd" tick={{ fontSize: 9, fill: "rgba(255,255,255,0.5)" }} domain={["auto", "auto"]} />
                      <YAxis yAxisId="eur" orientation="right" tick={{ fontSize: 9, fill: "rgba(255,255,255,0.5)" }} domain={["auto", "auto"]} />
                      <Tooltip content={<ChartTooltip />} />
                      <Legend wrapperStyle={{ fontSize: 9 }} />
                      <Line yAxisId="usd" type="monotone" dataKey="NOKUSD" stroke={ACCENT} strokeWidth={1.5} dot={false} name="NOK/USD" />
                      <Line yAxisId="eur" type="monotone" dataKey="NOKEUR" stroke="#10b981" strokeWidth={1.5} dot={false} name="NOK/EUR" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </Card>
            )}
            {fxExposure.length > 0 && (
              <Card>
                <SectionTitle>FX REVENUE EXPOSURE</SectionTitle>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10, fontFamily: "monospace", marginTop: 8 }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid #30363d" }}>
                      {["Ticker", "NOK", "USD", "EUR", "GBP", "Other"].map(h => (
                        <th key={h} style={{ padding: "5px 6px", textAlign: h === "Ticker" ? "left" : "right", fontSize: 9, fontWeight: 600, color: "rgba(255,255,255,0.5)" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {fxExposure.map(fx => (
                      <tr key={fx.ticker} style={{ borderBottom: "1px solid #21262d" }}>
                        <td style={{ padding: "4px 6px", fontWeight: 600, color: SUB_MAP[fx.ticker]?.color || "#fff" }}>{fx.ticker}</td>
                        {[fx.nok, fx.usd, fx.eur, fx.gbp, fx.other].map((val, i) => (
                          <td key={i} style={{ padding: "4px 6px", textAlign: "right", fontWeight: val != null && val > 30 ? 700 : 400, color: val != null && val > 50 ? ACCENT : "rgba(255,255,255,0.5)", background: val != null ? `rgba(99,102,241,${Math.min(0.2, val / 200)})` : "transparent" }}>
                            {val != null ? val.toFixed(0) + "%" : "---"}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            )}
          </div>
        )}
      </div>
    );
  }

  /* ---------------------------------------------------------------- */
  /* EXPLORER TAB                                                      */
  /* ---------------------------------------------------------------- */

  function renderExplorer() {
    if (!selectedTicker) {
      // Group tickers by type for picker
      const groups: { label: string; color: string; tickers: string[] }[] = [
        { label: "BANKS", color: ACCENT, tickers: Object.keys(SUB_MAP).filter(t => SUB_MAP[t].label === "BANK") },
        { label: "INSURANCE", color: "#10b981", tickers: Object.keys(SUB_MAP).filter(t => SUB_MAP[t].label === "INS") },
        { label: "FINANCIAL SERVICES", color: "#f59e0b", tickers: Object.keys(SUB_MAP).filter(t => SUB_MAP[t].label === "FIN") },
        { label: "INVESTMENT COMPANIES", color: "#a78bfa", tickers: Object.keys(SUB_MAP).filter(t => SUB_MAP[t].label === "INV") },
      ];
      // Get comparison data for showing price/return
      const compMap: Record<string, ComparisonCompany> = {};
      for (const c of comparison?.companies || []) compMap[c.ticker] = c;

      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {groups.map(g => (
            <Card key={g.label}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                <div style={{ width: 4, height: 14, borderRadius: 2, background: g.color }} />
                <span style={{ fontSize: 11, fontWeight: 700, color: g.color, letterSpacing: "0.05em" }}>{g.label}</span>
                <span style={{ fontSize: 9, color: "rgba(255,255,255,0.3)" }}>({g.tickers.length})</span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 6 }}>
                {g.tickers.map(t => {
                  const c = compMap[t];
                  return (
                    <button key={t} onClick={() => setSelectedTicker(t)} style={{ padding: "8px 10px", borderRadius: 4, border: "1px solid #30363d", background: "#0d1117", cursor: "pointer", textAlign: "left", display: "flex", justifyContent: "space-between", alignItems: "center" }}
                      onMouseEnter={e => (e.currentTarget.style.borderColor = g.color)}
                      onMouseLeave={e => (e.currentTarget.style.borderColor = "#30363d")}>
                      <div>
                        <div style={{ fontWeight: 700, color: g.color, fontSize: 11 }}>{t}</div>
                        {c && <div style={{ fontSize: 8, color: "rgba(255,255,255,0.35)", marginTop: 1 }}>{fmtPrice(c.price)}</div>}
                      </div>
                      {c?.dailyPct != null && <span style={{ fontSize: 9, fontWeight: 700, color: retCol(c.dailyPct) }}>{fmtPct(c.dailyPct)}</span>}
                    </button>
                  );
                })}
              </div>
            </Card>
          ))}
        </div>
      );
    }

    const d = explorerData;
    const sub = SUB_MAP[selectedTicker];
    const prices = d?.analytics?.prices || [];
    const stats = d?.analytics?.summary?.adjusted;
    const lastPrice = prices.length > 0 ? prices[prices.length - 1] : null;
    const prevPrice = prices.length > 1 ? prices[prices.length - 2] : null;
    const dailyPct = lastPrice && prevPrice ? ((lastPrice.adj_close / prevPrice.adj_close) - 1) * 100 : null;
    // Factor data comes as strings from pg — parse to float
    const rawFund = d?.fundamentals;
    const fund = rawFund ? {
      ep: rawFund.ep != null ? parseFloat(rawFund.ep) : null,
      bm: rawFund.bm != null ? parseFloat(rawFund.bm) : null,
      dy: rawFund.dy != null ? parseFloat(rawFund.dy) : null,
      sp: rawFund.sp != null ? parseFloat(rawFund.sp) : null,
      sg: rawFund.sg != null ? parseFloat(rawFund.sg) : null,
      mktcap: rawFund.mktcap != null ? parseFloat(rawFund.mktcap) : null,
      evEbitda: rawFund.ev_ebitda != null ? parseFloat(rawFund.ev_ebitda) : null,
    } : null;
    const rawTech = d?.technical;
    const tech = rawTech ? {
      mom1m: rawTech.mom1m != null ? parseFloat(rawTech.mom1m) : null,
      mom6m: rawTech.mom6m != null ? parseFloat(rawTech.mom6m) : null,
      mom11m: rawTech.mom11m != null ? parseFloat(rawTech.mom11m) : null,
      vol1m: rawTech.vol1m != null ? parseFloat(rawTech.vol1m) : null,
      vol3m: rawTech.vol3m != null ? parseFloat(rawTech.vol3m) : null,
      beta: rawTech.beta != null ? parseFloat(rawTech.beta) : null,
      ivol: rawTech.ivol != null ? parseFloat(rawTech.ivol) : null,
    } : null;
    const pred = d?.prediction;
    const shorts = d?.shorts;
    const news = d?.news || [];

    const pe = fund?.ep && fund.ep > 0 ? (1 / fund.ep).toFixed(1) : "---";
    const pb = fund?.bm && fund.bm > 0 ? (1 / fund.bm).toFixed(1) : "---";

    const priceChartData = prices.map((p: any) => ({ date: (p.date || "").slice(0, 10), price: p.adj_close, volume: p.volume }));

    const mlSignal = pred ? (
      pred.ensemble_prediction > 0.04 ? "STRONG BUY" :
      pred.ensemble_prediction > 0.015 ? "BUY" :
      pred.ensemble_prediction > -0.015 ? "HOLD" :
      pred.ensemble_prediction > -0.04 ? "SELL" : "STRONG SELL"
    ) : null;
    const mlCol = mlSignal?.includes("BUY") ? "#10b981" : mlSignal?.includes("SELL") ? "#ef4444" : "#6b7280";

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {/* Ticker selector bar — grouped by type */}
        <Card style={{ padding: "8px 12px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <button onClick={() => setSelectedTicker(null)} style={{
              padding: "3px 8px", borderRadius: 3, fontSize: 9, fontWeight: 700, fontFamily: "monospace", cursor: "pointer",
              border: "1px solid #30363d", background: "transparent", color: "rgba(255,255,255,0.4)",
            }}>ALL</button>
            <div style={{ width: 1, height: 16, background: "#30363d" }} />
            {[
              { label: "BANK", tickers: Object.keys(SUB_MAP).filter(t => SUB_MAP[t].label === "BANK") },
              { label: "INS", tickers: Object.keys(SUB_MAP).filter(t => SUB_MAP[t].label === "INS") },
              { label: "FIN", tickers: Object.keys(SUB_MAP).filter(t => SUB_MAP[t].label === "FIN") },
              { label: "INV", tickers: Object.keys(SUB_MAP).filter(t => SUB_MAP[t].label === "INV") },
            ].map((grp, gi) => (
              <React.Fragment key={grp.label}>
                {gi > 0 && <div style={{ width: 1, height: 16, background: "#30363d" }} />}
                {grp.tickers.map(t => (
                  <button key={t} onClick={() => setSelectedTicker(t)} style={{
                    padding: "3px 8px", borderRadius: 3, fontSize: 9, fontWeight: 700, fontFamily: "monospace", cursor: "pointer",
                    border: "1px solid " + (selectedTicker === t ? (SUB_MAP[t]?.color || ACCENT) : "transparent"),
                    background: selectedTicker === t ? (SUB_MAP[t]?.color || ACCENT) + "20" : "transparent",
                    color: selectedTicker === t ? (SUB_MAP[t]?.color || ACCENT) : "rgba(255,255,255,0.35)",
                  }}>{t}</button>
                ))}
              </React.Fragment>
            ))}
          </div>
        </Card>

        {explorerLoading && <div style={{ color: "rgba(255,255,255,0.4)", padding: 40, textAlign: "center" }}>Loading {selectedTicker}...</div>}

        {!explorerLoading && d && (
          <>
            {/* Hero */}
            <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 24, fontWeight: 800, color: "#fff" }}>{selectedTicker}</span>
                  {sub && <span style={{ fontSize: 9, fontWeight: 700, padding: "2px 8px", borderRadius: 3, background: sub.color + "20", color: sub.color }}>{sub.label}</span>}
                </div>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)" }}>{d.info?.name || selectedTicker}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 28, fontWeight: 800 }}>{lastPrice ? fmtPrice(lastPrice.adj_close) : "---"}</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: retCol(dailyPct) }}>{fmtPct(dailyPct)}</div>
              </div>
            </div>

            {/* KPI */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 8 }}>
              <MetricCard label="P/E" value={pe} />
              <MetricCard label="P/B" value={pb} />
              <MetricCard label="DIV YIELD" value={fund?.dy != null ? (fund.dy * 100).toFixed(1) + "%" : "---"} color={fund?.dy ? "#10b981" : undefined} />
              <MetricCard label="MKT CAP" value={fund?.mktcap ? fmtNok(fund.mktcap) : "---"} />
              <MetricCard label="BETA" value={tech?.beta != null ? tech.beta.toFixed(2) : (stats?.beta != null ? stats.beta.toFixed(2) : "---")} />
              <MetricCard label="SHORT %" value={shorts?.shortPct != null ? shorts.shortPct.toFixed(2) + "%" : "---"} color={shorts && shorts.shortPct > 3 ? "#f59e0b" : undefined} />
            </div>

            {/* Price Chart */}
            <Card>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <SectionTitle>PRICE HISTORY</SectionTitle>
                <div style={{ display: "flex", gap: 4 }}>
                  {(["3M", "6M", "1Y", "2Y"] as const).map(tf => (
                    <button key={tf} onClick={() => setExplorerTf(tf)} style={{
                      padding: "3px 8px", borderRadius: 3, border: "1px solid " + (explorerTf === tf ? ACCENT : "#30363d"),
                      background: explorerTf === tf ? ACCENT + "20" : "transparent", color: explorerTf === tf ? ACCENT : "rgba(255,255,255,0.4)",
                      fontSize: 9, fontWeight: 700, fontFamily: "monospace", cursor: "pointer",
                    }}>{tf}</button>
                  ))}
                </div>
              </div>
              {priceChartData.length > 0 ? (
                <div style={{ width: "100%", height: 260 }}>
                  <ResponsiveContainer>
                    <LineChart data={priceChartData} margin={{ left: 10, right: 10, top: 5, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#21262d" />
                      <XAxis dataKey="date" tick={{ fontSize: 8, fill: "rgba(255,255,255,0.4)" }} tickFormatter={(v: string) => v.slice(5)} interval="preserveStartEnd" />
                      <YAxis tick={{ fontSize: 9, fill: "rgba(255,255,255,0.5)" }} domain={["auto", "auto"]} />
                      <Tooltip content={<ChartTooltip />} />
                      <Line type="monotone" dataKey="price" stroke={ACCENT} strokeWidth={1.5} dot={false} name="Price" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              ) : <div style={{ color: "rgba(255,255,255,0.35)", padding: 20, textAlign: "center" }}>No price data</div>}
            </Card>

            {/* 3-column: Risk + ML + Technicals */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
              <Card>
                <SectionTitle>RISK METRICS</SectionTitle>
                {[
                  { label: "Total Return", value: stats ? fmtPct(stats.totalReturn * 100) : "---", col: retCol(stats?.totalReturn) },
                  { label: "Ann. Return", value: stats ? fmtPct(stats.annualizedReturn * 100) : "---", col: retCol(stats?.annualizedReturn) },
                  { label: "Volatility", value: stats ? (stats.volatility * 100).toFixed(1) + "%" : "---" },
                  { label: "Sharpe", value: stats ? stats.sharpeRatio.toFixed(2) : "---", col: stats && stats.sharpeRatio > 0 ? "#10b981" : "#ef4444" },
                  { label: "Max Drawdown", value: stats ? (stats.maxDrawdown * 100).toFixed(1) + "%" : "---", col: "#ef4444" },
                  { label: "VaR 95%", value: stats ? (stats.var95 * 100).toFixed(2) + "%" : "---", col: "#ef4444" },
                ].map(r => (
                  <div key={r.label} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: "1px solid #21262d" }}>
                    <span style={{ fontSize: 10, color: "rgba(255,255,255,0.5)" }}>{r.label}</span>
                    <span style={{ fontSize: 10, fontWeight: 700, color: r.col || "#fff" }}>{r.value}</span>
                  </div>
                ))}
              </Card>

              <Card>
                <SectionTitle>ML PREDICTION</SectionTitle>
                {pred ? (
                  <>
                    <div style={{ textAlign: "center", margin: "8px 0" }}>
                      <span style={{ fontSize: 9, fontWeight: 700, padding: "2px 8px", borderRadius: 3, background: mlCol + "20", color: mlCol }}>{mlSignal}</span>
                    </div>
                    <div style={{ textAlign: "center", fontSize: 24, fontWeight: 800, color: retCol(pred.ensemble_prediction) }}>{fmtPct(pred.ensemble_prediction * 100)}</div>
                    <div style={{ textAlign: "center", fontSize: 9, color: "rgba(255,255,255,0.4)", marginBottom: 8 }}>1-month forward</div>
                    {[
                      { label: "P95", value: pred.p95, col: "#10b981" },
                      { label: "P75", value: pred.p75, col: "#10b981" },
                      { label: "P50", value: pred.p50, col: "#fff" },
                      { label: "P25", value: pred.p25, col: "#ef4444" },
                      { label: "P05", value: pred.p05, col: "#ef4444" },
                    ].map(r => (
                      <div key={r.label} style={{ display: "flex", justifyContent: "space-between", padding: "2px 0", borderBottom: "1px solid #21262d" }}>
                        <span style={{ fontSize: 9, color: "rgba(255,255,255,0.4)" }}>{r.label}</span>
                        <span style={{ fontSize: 10, fontWeight: 600, color: r.col }}>{r.value != null ? fmtPct(r.value * 100) : "---"}</span>
                      </div>
                    ))}
                  </>
                ) : <div style={{ color: "rgba(255,255,255,0.35)", padding: 20, textAlign: "center" }}>No ML prediction</div>}
              </Card>

              <Card>
                <SectionTitle>TECHNICAL FACTORS</SectionTitle>
                {[
                  { label: "Mom 1M", value: tech?.mom1m, fmt: (v: number) => fmtPct(v * 100), col: retCol(tech?.mom1m) },
                  { label: "Mom 6M", value: tech?.mom6m, fmt: (v: number) => fmtPct(v * 100), col: retCol(tech?.mom6m) },
                  { label: "Mom 11M", value: tech?.mom11m, fmt: (v: number) => fmtPct(v * 100), col: retCol(tech?.mom11m) },
                  { label: "Vol 1M", value: tech?.vol1m, fmt: (v: number) => (v * 100).toFixed(1) + "%" },
                  { label: "Vol 3M", value: tech?.vol3m, fmt: (v: number) => (v * 100).toFixed(1) + "%" },
                  { label: "Beta", value: tech?.beta, fmt: (v: number) => v.toFixed(2) },
                  { label: "Idio. Vol", value: tech?.ivol, fmt: (v: number) => (v * 100).toFixed(1) + "%" },
                ].map(r => (
                  <div key={r.label} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: "1px solid #21262d" }}>
                    <span style={{ fontSize: 10, color: "rgba(255,255,255,0.5)" }}>{r.label}</span>
                    <span style={{ fontSize: 10, fontWeight: 700, color: r.col || "#fff" }}>{r.value != null ? r.fmt(r.value) : "---"}</span>
                  </div>
                ))}
              </Card>
            </div>

            {/* 2-column: Fundamentals + Shorts */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Card>
                <SectionTitle>FUNDAMENTALS</SectionTitle>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginTop: 4 }}>
                  {[
                    { label: "P/E Ratio", value: pe },
                    { label: "P/B Ratio", value: pb },
                    { label: "Dividend Yield", value: fund?.dy != null ? (fund.dy * 100).toFixed(1) + "%" : "---" },
                    { label: "EV/EBITDA", value: fund?.evEbitda != null ? fund.evEbitda.toFixed(1) + "x" : "---" },
                    { label: "Market Cap", value: fund?.mktcap ? fmtNok(fund.mktcap) : "---" },
                    { label: "Sales Growth", value: fund?.sg != null ? fmtPct(fund.sg * 100) : "---" },
                  ].map(r => (
                    <div key={r.label} style={{ background: "#0d1117", border: "1px solid #21262d", borderRadius: 4, padding: "6px 8px" }}>
                      <div style={{ fontSize: 8, color: "rgba(255,255,255,0.4)", textTransform: "uppercase" as const }}>{r.label}</div>
                      <div style={{ fontSize: 13, fontWeight: 700, marginTop: 2 }}>{r.value}</div>
                    </div>
                  ))}
                </div>
              </Card>

              <Card>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <SectionTitle>SHORT INTEREST</SectionTitle>
                  <a href={`https://ssr.finanstilsynet.no/en/instrument?query=${selectedTicker}`} target="_blank" rel="noopener noreferrer" style={{ fontSize: 8, color: ACCENT, textDecoration: "none" }}>View on SSR.no &rarr;</a>
                </div>
                {shorts && shorts.shortPct != null ? (
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                      <span style={{ fontSize: 20, fontWeight: 800, color: shorts.shortPct > 3 ? "#f59e0b" : "#fff" }}>{shorts.shortPct.toFixed(2)}%</span>
                      <Sparkline data={(shorts.history || []).map((h: any) => h.shortPct)} width={100} height={28} />
                    </div>
                    {shorts.holders?.length > 0 && shorts.holders.map((h: any, i: number) => (
                      <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "2px 0", borderBottom: "1px solid #21262d", fontSize: 9, color: "rgba(255,255,255,0.5)" }}>
                        <span>{h.holder}</span><span style={{ fontWeight: 600 }}>{h.pct?.toFixed(2) ?? "---"}%</span>
                      </div>
                    ))}
                  </div>
                ) : <div style={{ color: "rgba(255,255,255,0.35)", padding: 20, textAlign: "center" }}>No short data</div>}
              </Card>
            </div>

            {/* News */}
            {news.length > 0 && (
              <Card>
                <SectionTitle>NEWS & FILINGS</SectionTitle>
                <div style={{ maxHeight: 250, overflowY: "auto" }}>
                  {news.map((n: any, i: number) => (
                    <div key={i} style={{ padding: "5px 0", borderBottom: i < news.length - 1 ? "1px solid #21262d" : "none" }}>
                      <div style={{ fontSize: 10, color: "rgba(255,255,255,0.7)" }}>{n.headline}</div>
                      <div style={{ fontSize: 8, color: "rgba(255,255,255,0.35)", marginTop: 1 }}>
                        {fmtDate(n.published_at || n.publishedAt)}
                        {n.category && <span style={{ marginLeft: 6, padding: "0 3px", borderRadius: 2, background: "#21262d" }}>{n.category}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {/* Quick Links */}
            <Card>
              <SectionTitle>EXPLORE MORE</SectionTitle>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
                {[
                  { href: `/stocks/${selectedTicker}`, label: "Full Stock Page" },
                  { href: `/volatility/${selectedTicker}`, label: "Volatility" },
                  { href: `/predictions/${selectedTicker}`, label: "ML Predictions" },
                  { href: `/montecarlo/${selectedTicker}`, label: "Monte Carlo" },
                ].map(link => (
                  <Link key={link.href} href={link.href} style={{
                    padding: "5px 12px", borderRadius: 4, border: "1px solid #30363d", background: "#0d1117",
                    color: "rgba(255,255,255,0.6)", fontSize: 10, fontWeight: 600, textDecoration: "none",
                  }}>{link.label}</Link>
                ))}
              </div>
            </Card>
          </>
        )}
      </div>
    );
  }

  /* ---------------------------------------------------------------- */
  /* Render                                                            */
  /* ---------------------------------------------------------------- */

  return (
    <main style={{ minHeight: "100vh", background: "#0a0a0a", color: "#fff", fontFamily: "monospace", fontSize: 12 }}>
      <div style={{ maxWidth: 1400, margin: "0 auto", padding: "20px 24px" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: "#fff", margin: 0 }}>
            <span style={{ color: ACCENT }}>// </span>FINANCIALS & INSURANCE INTELLIGENCE
          </h1>
          <Link href="/" style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", textDecoration: "none" }}>HOME</Link>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", gap: 0, borderBottom: "1px solid #30363d", marginBottom: 16 }}>
          {TABS.map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              padding: "8px 20px", fontSize: 10, fontWeight: 700, fontFamily: "monospace", letterSpacing: "0.05em",
              color: tab === t ? ACCENT : "rgba(255,255,255,0.5)", background: "transparent", border: "none",
              borderBottom: tab === t ? `2px solid ${ACCENT}` : "2px solid transparent", cursor: "pointer",
            }}>{t}{t === "EXPLORER" && selectedTicker ? ` — ${selectedTicker}` : ""}</button>
          ))}
        </div>

        {/* Content */}
        {loading && !overview && <div style={{ color: "rgba(255,255,255,0.4)", padding: 40, textAlign: "center" }}>Loading...</div>}
        {tab === "OVERVIEW" && renderOverview()}
        {tab === "ANALYSIS" && renderAnalysis()}
        {tab === "EXPLORER" && renderExplorer()}

        {/* Footer */}
        <div style={{ borderTop: "1px solid #21262d", marginTop: 24, padding: "12px 0", fontSize: 9, color: "rgba(255,255,255,0.3)", lineHeight: 1.8 }}>
          <span style={{ fontWeight: 700, color: "rgba(255,255,255,0.4)", letterSpacing: "0.06em" }}>DATA SOURCES</span>
          <div style={{ marginTop: 4 }}>
            <span style={{ color: "rgba(255,255,255,0.4)" }}>Rates:</span> Norges Bank, IBKR &middot;
            <span style={{ color: "rgba(255,255,255,0.4)" }}> Prices:</span> IBKR, Yahoo Finance &middot;
            <span style={{ color: "rgba(255,255,255,0.4)" }}> Shorts:</span> Finanstilsynet SSR &middot;
            <span style={{ color: "rgba(255,255,255,0.4)" }}> News:</span> Oslo Bors NewsWeb &middot;
            <span style={{ color: "rgba(255,255,255,0.4)" }}> FX:</span> Norges Bank, IBKR
          </div>
        </div>
      </div>
    </main>
  );
}
