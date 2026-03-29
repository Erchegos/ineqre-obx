"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import {
  LineChart, Line, BarChart, Bar, ScatterChart, Scatter,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Cell, Legend,
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
const TABS = ["OVERVIEW", "RATES", "SCORECARD", "SIGNALS", "MACRO", "EXPLORER"] as const;
type Tab = (typeof TABS)[number];

const SUB_MAP: Record<string, { label: string; color: string }> = {
  DNB: { label: "BANK", color: ACCENT }, MING: { label: "BANK", color: ACCENT },
  NONG: { label: "BANK", color: ACCENT }, MORG: { label: "BANK", color: ACCENT },
  SPOL: { label: "BANK", color: ACCENT }, SB1NO: { label: "BANK", color: ACCENT },
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
  GJF: { label: "INS", color: "#10b981" }, STB: { label: "INS", color: "#10b981" },
  PROT: { label: "INS", color: "#10b981" },
  ABG: { label: "FIN", color: "#f59e0b" }, ACR: { label: "FIN", color: "#f59e0b" },
  B2I: { label: "FIN", color: "#f59e0b" }, BNOR: { label: "FIN", color: "#f59e0b" },
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
const alertBg = (t: string): string => t === "critical" ? "rgba(239,68,68,0.08)" : t === "warning" ? "rgba(245,158,11,0.08)" : "rgba(59,130,246,0.08)";
const mlSignalFromPred = (pred: number): string =>
  pred > 0.04 ? "STRONG BUY" : pred > 0.015 ? "BUY" : pred > -0.015 ? "HOLD" : pred > -0.04 ? "SELL" : "STRONG SELL";
const mlSignalCol = (sig: string): string =>
  sig === "STRONG BUY" ? "#10b981" : sig === "BUY" ? "#34d399" : sig === "SELL" ? "#f87171" : sig === "STRONG SELL" ? "#ef4444" : "#6b7280";

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
    <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid #21262d", borderRadius: 6, padding: "12px 14px", textAlign: "center" }}>
      <div style={{ fontSize: 9, fontWeight: 600, color: "rgba(255,255,255,0.4)", letterSpacing: "0.06em", textTransform: "uppercase" as const, marginBottom: 5 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, color: color || "#fff" }}>{value}</div>
      {sub && <div style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

function SectionTitle({ children, color }: { children: React.ReactNode; color?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      {color && <div style={{ width: 3, height: 14, borderRadius: 2, background: color, flexShrink: 0 }} />}
      <div style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.6)", letterSpacing: "0.08em", textTransform: "uppercase" as const }}>{children}</div>
    </div>
  );
}

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid #30363d", borderRadius: 8, padding: 16, ...style }}>{children}</div>;
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

  const [sortCol, setSortCol] = useState("dailyPct");
  const [sortAsc, setSortAsc] = useState(false);
  const [subFilter, setSubFilter] = useState<"all" | "bank" | "ins" | "fin" | "inv">("all");
  const [perfFilter, setPerfFilter] = useState<"all" | "green" | "red">("all");
  const [expandedShort, setExpandedShort] = useState<string | null>(null);
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);
  const [explorerData, setExplorerData] = useState<any>(null);
  const [explorerLoading, setExplorerLoading] = useState(false);
  const [explorerTf, setExplorerTf] = useState<"3M" | "6M" | "1Y" | "2Y">("1Y");

  useEffect(() => {
    Promise.all([
      fetch("/api/financials/overview").then(r => r.ok ? r.json() : null),
      fetch("/api/financials/comparison").then(r => r.ok ? r.json() : null),
    ]).then(([ov, comp]) => {
      if (ov) setOverview(ov);
      if (comp) setComparison(comp);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (tab === "RATES" || tab === "SIGNALS" || tab === "MACRO") {
      const fetches: Promise<any>[] = [];
      if (!rates) fetches.push(fetch("/api/financials/rates").then(r => r.ok ? r.json() : null));
      else fetches.push(Promise.resolve(null));
      if (!signals) fetches.push(fetch("/api/financials/signals").then(r => r.ok ? r.json() : null));
      else fetches.push(Promise.resolve(null));
      if (!macro) fetches.push(fetch("/api/financials/macro").then(r => r.ok ? r.json() : null));
      else fetches.push(Promise.resolve(null));
      Promise.all(fetches).then(([r, s, m]) => {
        if (r) setRates(r);
        if (s) setSignals(s);
        if (m) setMacro(m);
      }).catch(() => {});
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

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
      const latestFac = fac?.data?.[0] || null;
      setExplorerData({ analytics: anal, info: info?.data || info, fundamentals: latestFac, technical: latestFac, prediction: pred?.predictions?.[0] || null, shorts: sh, news: nws?.items?.slice(0, 15) || (Array.isArray(nws) ? nws.slice(0, 15) : []) });
    }).catch(() => {}).finally(() => setExplorerLoading(false));
  }, [selectedTicker, explorerTf]);

  const openExplorer = (t: string) => { setSelectedTicker(t); setTab("EXPLORER"); };

  /* ---------------------------------------------------------------- */
  /* OVERVIEW TAB                                                      */
  /* ---------------------------------------------------------------- */

  function renderOverview() {
    if (!overview) return <div style={{ color: "rgba(255,255,255,0.4)", padding: 60, textAlign: "center" }}>Loading overview...</div>;
    const { companies, rateSnapshot, sectorPerformance, news } = overview;

    // Performance bar data sorted by daily return
    const perfData = (comparison?.companies || companies.map(c => ({
      ticker: c.ticker, dailyPct: c.dailyPct, weeklyPct: c.weeklyPct, monthlyPct: c.monthlyPct, ytdPct: c.ytdPct,
    }))).filter(c => c.dailyPct != null).sort((a, b) => (b.dailyPct ?? 0) - (a.dailyPct ?? 0));

    // Group companies by sub-sector
    const groups: { label: string; color: string; key: string; companies: CompanyCard[] }[] = [
      { label: "Banks", color: ACCENT, key: "BANK", companies: companies.filter(c => SUB_MAP[c.ticker]?.label === "BANK") },
      { label: "Insurance", color: "#10b981", key: "INS", companies: companies.filter(c => SUB_MAP[c.ticker]?.label === "INS") },
      { label: "Financial Services", color: "#f59e0b", key: "FIN", companies: companies.filter(c => SUB_MAP[c.ticker]?.label === "FIN") },
      { label: "Investment Companies", color: "#a78bfa", key: "INV", companies: companies.filter(c => SUB_MAP[c.ticker]?.label === "INV") },
    ].filter(g => g.companies.length > 0);

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

        {/* KPI Strip */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
          <MetricCard label="NB Policy Rate" value={fmtBps(rateSnapshot.policyRate)} sub="Overnight" />
          <MetricCard label="NIBOR 3M" value={fmtBps(rateSnapshot.nibor3m)} sub="Interbank" />
          <MetricCard label="Sector Today" value={fmtPct(sectorPerformance.daily)} color={retCol(sectorPerformance.daily)} />
          <MetricCard label="Sector YTD" value={fmtPct(sectorPerformance.ytd)} color={retCol(sectorPerformance.ytd)} />
        </div>

        {/* Performance Chart + News: 2-column */}
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 14 }}>

          {/* Performance Bar Chart */}
          <Card style={{ padding: "14px 16px" }}>
            <div style={{ marginBottom: 12 }}><SectionTitle color={ACCENT}>Daily Performance</SectionTitle></div>
            {perfData.length > 0 ? (
              <div style={{ width: "100%", height: Math.max(200, perfData.length * 22) }}>
                <ResponsiveContainer>
                  <BarChart data={perfData} layout="vertical" margin={{ left: 6, right: 40, top: 0, bottom: 0 }}>
                    <XAxis type="number" tick={{ fontSize: 8, fill: "rgba(255,255,255,0.4)" }} tickFormatter={v => v.toFixed(1) + "%"} domain={["auto", "auto"]} />
                    <YAxis type="category" dataKey="ticker" tick={{ fontSize: 9, fill: "rgba(255,255,255,0.6)", fontWeight: 600 }} width={48} />
                    <Tooltip
                      content={({ active, payload }: any) => {
                        if (!active || !payload?.[0]) return null;
                        const d = payload[0].payload;
                        const sub = SUB_MAP[d.ticker];
                        return (
                          <div style={{ background: "#161b22", border: "1px solid #30363d", borderRadius: 4, padding: "6px 10px", fontSize: 10, fontFamily: "monospace" }}>
                            <div style={{ fontWeight: 700, color: sub?.color || "#fff", marginBottom: 3 }}>{d.ticker} <span style={{ fontSize: 8, color: "rgba(255,255,255,0.4)" }}>{sub?.label}</span></div>
                            <div>Today: <span style={{ color: retCol(d.dailyPct), fontWeight: 700 }}>{fmtPct(d.dailyPct)}</span></div>
                            <div style={{ color: "rgba(255,255,255,0.5)" }}>1W: {fmtPct(d.weeklyPct)} · 1M: {fmtPct(d.monthlyPct)}</div>
                          </div>
                        );
                      }}
                    />
                    <ReferenceLine x={0} stroke="#30363d" strokeWidth={1} />
                    <Bar dataKey="dailyPct" radius={[0, 3, 3, 0]}>
                      {perfData.map((entry, i) => (
                        <Cell key={i} fill={(entry.dailyPct ?? 0) >= 0 ? "#10b981" : "#ef4444"} fillOpacity={0.8} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : <div style={{ color: "rgba(255,255,255,0.35)", fontSize: 10, padding: 20, textAlign: "center" }}>Loading...</div>}
          </Card>

          {/* News Feed */}
          <Card style={{ padding: "14px 16px" }}>
            <div style={{ marginBottom: 12 }}><SectionTitle>Recent News</SectionTitle></div>
            {news.length > 0 ? (
              <div style={{ maxHeight: 380, overflowY: "auto" }}>
                {news.map((n: any, i: number) => {
                  const sub = SUB_MAP[n.ticker];
                  return (
                    <div key={i} style={{ padding: "7px 0", borderBottom: i < news.length - 1 ? "1px solid #21262d" : "none" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 3 }}>
                        <span style={{ fontSize: 9, fontWeight: 700, padding: "1px 5px", borderRadius: 2, background: (sub?.color || ACCENT) + "20", color: sub?.color || ACCENT }}>{n.ticker}</span>
                        <span style={{ fontSize: 7, color: "rgba(255,255,255,0.3)" }}>{fmtDate(n.publishedAt)}</span>
                      </div>
                      <div style={{ fontSize: 9, color: "rgba(255,255,255,0.65)", lineHeight: 1.4 }}>{n.headline}</div>
                    </div>
                  );
                })}
              </div>
            ) : <div style={{ color: "rgba(255,255,255,0.35)", fontSize: 10, padding: 20, textAlign: "center" }}>No recent news</div>}
          </Card>
        </div>

        {/* Company Cards grouped by sub-sector */}
        {groups.map(g => (
          <div key={g.key}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <div style={{ width: 3, height: 16, borderRadius: 2, background: g.color }} />
              <span style={{ fontSize: 12, fontWeight: 700, color: g.color, letterSpacing: "0.04em" }}>{g.label}</span>
              <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>({g.companies.length})</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 8 }}>
              {g.companies.map(c => {
                const pe = c.fundamentals?.ep && c.fundamentals.ep > 0 ? (1 / c.fundamentals.ep).toFixed(1) : "---";
                const pb = c.fundamentals?.bm && c.fundamentals.bm > 0 ? (1 / c.fundamentals.bm).toFixed(1) : "---";
                const dy = c.fundamentals?.dy != null ? (c.fundamentals.dy * 100).toFixed(1) + "%" : "---";
                const mlPred = c.mlSignal?.prediction;
                const mlSig = mlPred != null ? mlSignalFromPred(mlPred) : null;
                return (
                  <div key={c.ticker} onClick={() => openExplorer(c.ticker)}
                    style={{ background: "rgba(255,255,255,0.02)", border: "1px solid #30363d", borderRadius: 8, padding: "12px 14px", cursor: "pointer", transition: "border-color 0.15s, background 0.15s" }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = g.color; (e.currentTarget as HTMLElement).style.background = g.color + "08"; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = "#30363d"; (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.02)"; }}>
                    {/* Header row */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: "#fff" }}>{c.ticker}</div>
                        <div style={{ fontSize: 8, color: "rgba(255,255,255,0.35)", marginTop: 1, maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{c.name}</div>
                      </div>
                      <Sparkline data={c.sparkline90d} width={56} height={22} />
                    </div>
                    {/* Price + daily return */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
                      <span style={{ fontSize: 17, fontWeight: 800, color: "#fff" }}>{fmtPrice(c.lastClose)}</span>
                      <span style={{ fontSize: 11, fontWeight: 700, color: retCol(c.dailyPct) }}>{fmtPct(c.dailyPct)}</span>
                    </div>
                    {/* Metrics grid */}
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 3, fontSize: 8, borderTop: "1px solid #21262d", paddingTop: 7 }}>
                      <div><div style={{ color: "rgba(255,255,255,0.3)", marginBottom: 1 }}>P/E</div><div style={{ color: "rgba(255,255,255,0.7)" }}>{pe}</div></div>
                      <div><div style={{ color: "rgba(255,255,255,0.3)", marginBottom: 1 }}>P/B</div><div style={{ color: "rgba(255,255,255,0.7)" }}>{pb}</div></div>
                      <div><div style={{ color: "rgba(255,255,255,0.3)", marginBottom: 1 }}>DY</div><div style={{ color: "#10b981" }}>{dy}</div></div>
                      <div><div style={{ color: "rgba(255,255,255,0.3)", marginBottom: 1 }}>ML</div><div style={{ color: mlSig ? mlSignalCol(mlSig) : "rgba(255,255,255,0.4)" }}>{mlPred != null ? fmtPct(mlPred * 100) : "---"}</div></div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    );
  }

  /* ---------------------------------------------------------------- */
  /* RATES TAB                                                         */
  /* ---------------------------------------------------------------- */

  function renderRates() {
    if (!rates) return <div style={{ color: "rgba(255,255,255,0.4)", padding: 60, textAlign: "center" }}>Loading rate data...</div>;
    const { current, yieldCurve, rateHistory, crossCurrency } = rates;

    const histMap: Record<string, any> = {};
    for (const r of rateHistory) {
      if (!histMap[r.date]) histMap[r.date] = { date: r.date };
      if (r.rateType === "POLICY_RATE" && r.tenor === "OVERNIGHT") histMap[r.date].policy = r.rate;
      if (r.rateType === "IBOR" && r.tenor === "3M") histMap[r.date].nibor3m = r.rate;
    }
    const histChartData = Object.values(histMap).sort((a: any, b: any) => a.date.localeCompare(b.date));

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

        {/* Rate Strip */}
        {current && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
            <MetricCard label="NB Policy Rate" value={current.policyRate ? fmtBps(current.policyRate.rate) : "---"} sub={current.policyRate?.date ? fmtDate(current.policyRate.date) : undefined} />
            <MetricCard label="NIBOR 3M" value={current.nibor3m ? fmtBps(current.nibor3m.rate) : "---"} />
            <MetricCard label="NIBOR 6M" value={current.nibor6m ? fmtBps(current.nibor6m.rate) : "---"} />
            <MetricCard label="NIBOR 12M" value={current.nibor12m ? fmtBps(current.nibor12m.rate) : "---"} />
          </div>
        )}

        {/* Yield Curve + Rate History */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 14 }}>
          <Card>
            <div style={{ marginBottom: 12 }}><SectionTitle color="#f59e0b">NOK Yield Curve</SectionTitle></div>
            {yieldCurve.length > 0 ? (
              <div style={{ width: "100%", height: 200 }}>
                <ResponsiveContainer>
                  <LineChart data={yieldCurve} margin={{ left: 10, right: 10, top: 5, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#21262d" />
                    <XAxis dataKey="tenor" tick={{ fontSize: 9, fill: "rgba(255,255,255,0.5)" }} />
                    <YAxis tick={{ fontSize: 9, fill: "rgba(255,255,255,0.5)" }} tickFormatter={v => v.toFixed(1) + "%"} domain={["auto", "auto"]} />
                    <Tooltip content={<ChartTooltip />} />
                    <Line type="monotone" dataKey="rate" stroke={ACCENT} strokeWidth={2.5} dot={{ fill: ACCENT, r: 4 }} name="Rate %" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : <div style={{ color: "rgba(255,255,255,0.35)", fontSize: 10, padding: 20, textAlign: "center" }}>No data</div>}
          </Card>
          <Card>
            <div style={{ marginBottom: 12 }}><SectionTitle>Rate History (2Y)</SectionTitle></div>
            {histChartData.length > 0 ? (
              <div style={{ width: "100%", height: 200 }}>
                <ResponsiveContainer>
                  <LineChart data={histChartData} margin={{ left: 10, right: 10, top: 5, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#21262d" />
                    <XAxis dataKey="date" tick={{ fontSize: 8, fill: "rgba(255,255,255,0.4)" }} tickFormatter={v => v.slice(5)} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 9, fill: "rgba(255,255,255,0.5)" }} tickFormatter={v => v.toFixed(1) + "%"} domain={["auto", "auto"]} />
                    <Tooltip content={<ChartTooltip />} />
                    <Line type="stepAfter" dataKey="policy" stroke="#f59e0b" strokeWidth={2} dot={false} name="Policy Rate" connectNulls />
                    <Line type="monotone" dataKey="nibor3m" stroke={ACCENT} strokeWidth={1.5} dot={false} name="NIBOR 3M" connectNulls />
                    <Legend wrapperStyle={{ fontSize: 9, paddingTop: 4 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : <div style={{ color: "rgba(255,255,255,0.35)", fontSize: 10, padding: 20, textAlign: "center" }}>Limited history</div>}
          </Card>
        </div>

        {/* Cross-Currency Comparison */}
        <Card>
          <div style={{ marginBottom: 12 }}><SectionTitle>Cross-Currency Rate Comparison</SectionTitle></div>
          <div style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", marginBottom: 10 }}>Policy rates and 3-month interbank rates across major currencies. NOK highlighted.</div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10, fontFamily: "monospace" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #30363d" }}>
                  <th style={{ padding: "7px 8px", textAlign: "left", fontSize: 9, fontWeight: 600, color: "rgba(255,255,255,0.5)", letterSpacing: "0.04em" }}></th>
                  {["NOK", "USD", "EUR", "GBP", "SEK"].map(c => (
                    <th key={c} style={{ padding: "7px 8px", textAlign: "right", fontSize: 9, fontWeight: 700, color: c === "NOK" ? ACCENT : "rgba(255,255,255,0.5)", letterSpacing: "0.04em" }}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[
                  { label: "Policy Rate", type: "POLICY_RATE", tenor: "OVERNIGHT" },
                  { label: "3M IBOR", type: "IBOR", tenor: "3M" },
                ].map(row => (
                  <tr key={row.label} style={{ borderBottom: "1px solid #21262d" }}>
                    <td style={{ padding: "6px 8px", fontSize: 9, color: "rgba(255,255,255,0.5)", fontWeight: 600 }}>{row.label}</td>
                    {["NOK", "USD", "EUR", "GBP", "SEK"].map(cur => {
                      const entries = crossCurrency[cur] || [];
                      const match = entries.find((e: any) => e.rateType === row.type && e.tenor === row.tenor);
                      return (
                        <td key={cur} style={{ padding: "6px 8px", textAlign: "right", fontWeight: cur === "NOK" ? 700 : 400, color: cur === "NOK" ? ACCENT : "#fff" }}>
                          {match ? match.rate.toFixed(2) + "%" : "---"}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

      </div>
    );
  }

  /* ---------------------------------------------------------------- */
  /* SCORECARD TAB                                                     */
  /* ---------------------------------------------------------------- */

  function renderScorecard() {
    const compRows = comparison?.companies ? [...comparison.companies] : [];
    if (compRows.length === 0) return <div style={{ color: "rgba(255,255,255,0.4)", padding: 60, textAlign: "center" }}>Loading scorecard...</div>;

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

    // Scatter data
    const scatterData = compRows.filter(c => c.ep && c.ep > 0 && c.mom6m != null).map(c => ({
      ticker: c.ticker, pe: 1 / c.ep!, mom6m: (c.mom6m ?? 0) * 100,
      mktcap: c.mktcap ?? 1e9, mlPred: c.mlPred ?? 0,
      sub: SUB_MAP[c.ticker]?.label || "OTHER",
    }));

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

        {/* Filters */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <span style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", fontWeight: 600, letterSpacing: "0.04em", marginRight: 4 }}>FILTER:</span>
          {[
            { k: "all", l: "ALL" }, { k: "bank", l: "BANKS" }, { k: "ins", l: "INS" }, { k: "fin", l: "FIN" }, { k: "inv", l: "INV" },
          ].map(f => (
            <button key={f.k} onClick={() => setSubFilter(f.k as any)} style={{
              padding: "4px 10px", borderRadius: 4, border: "1px solid " + (subFilter === f.k ? ACCENT : "#30363d"),
              background: subFilter === f.k ? ACCENT_DIM : "transparent", color: subFilter === f.k ? ACCENT : "rgba(255,255,255,0.4)",
              fontSize: 9, fontWeight: 700, fontFamily: "monospace", cursor: "pointer",
            }}>{f.l}</button>
          ))}
          <div style={{ width: 1, height: 16, background: "#30363d", margin: "0 4px" }} />
          {[
            { k: "all", l: "ALL", col: "#9ca3af" },
            { k: "green", l: "UP", col: "#10b981" },
            { k: "red", l: "DOWN", col: "#ef4444" },
          ].map(f => (
            <button key={f.k} onClick={() => setPerfFilter(f.k as any)} style={{
              padding: "4px 10px", borderRadius: 4, border: "1px solid " + (perfFilter === f.k ? f.col : "#30363d"),
              background: perfFilter === f.k ? f.col + "18" : "transparent", color: perfFilter === f.k ? f.col : "rgba(255,255,255,0.4)",
              fontSize: 9, fontWeight: 700, fontFamily: "monospace", cursor: "pointer",
            }}>{f.l}</button>
          ))}
          <span style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", marginLeft: 6 }}>{sorted.length} companies</span>
        </div>

        {/* Sortable Table */}
        <Card style={{ padding: 0 }}>
          <div style={{ overflowX: "auto", maxHeight: 500, overflowY: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10, fontFamily: "monospace" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #30363d" }}>
                  {cols.map(c => (
                    <th key={c.key} onClick={() => handleSort(c.key)} style={{
                      padding: "10px 8px", textAlign: c.align, fontSize: 9, fontWeight: 600,
                      color: sortCol === c.key ? ACCENT : "rgba(255,255,255,0.5)",
                      letterSpacing: "0.04em", textTransform: "uppercase" as const,
                      cursor: "pointer", whiteSpace: "nowrap" as const,
                      position: "sticky" as const, top: 0, background: "#0d1117", zIndex: 1,
                    }}>{c.label}{sortCol === c.key ? (sortAsc ? " ↑" : " ↓") : ""}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map((c: ComparisonCompany) => {
                  const sub = SUB_MAP[c.ticker];
                  const pe = c.ep && c.ep > 0 ? (1 / c.ep).toFixed(1) : "---";
                  const pbVal = c.bm && c.bm > 0 ? (1 / c.bm).toFixed(1) : "---";
                  const dy = c.dy != null ? (c.dy * 100).toFixed(1) + "%" : "---";
                  return (
                    <tr key={c.ticker} style={{ borderBottom: "1px solid #21262d", cursor: "pointer" }}
                      onClick={() => openExplorer(c.ticker)}
                      onMouseEnter={e => (e.currentTarget.style.background = "rgba(99,102,241,0.06)")}
                      onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                      <td style={{ padding: "6px 8px" }}>
                        <span style={{ color: sub?.color || "#fff", fontWeight: 700 }}>{c.ticker}</span>
                        <span style={{ fontSize: 7, marginLeft: 4, padding: "1px 4px", borderRadius: 2, background: (sub?.color || "#666") + "20", color: sub?.color || "#666" }}>{sub?.label}</span>
                      </td>
                      <td style={{ padding: "6px 8px", textAlign: "right", fontWeight: 600 }}>{fmtPrice(c.price)}</td>
                      <td style={{ padding: "6px 8px", textAlign: "right", fontWeight: 700, color: retCol(c.dailyPct) }}>{fmtPct(c.dailyPct)}</td>
                      <td style={{ padding: "6px 8px", textAlign: "right", color: retCol(c.weeklyPct) }}>{fmtPct(c.weeklyPct)}</td>
                      <td style={{ padding: "6px 8px", textAlign: "right", color: retCol(c.monthlyPct) }}>{fmtPct(c.monthlyPct)}</td>
                      <td style={{ padding: "6px 8px", textAlign: "right", color: retCol(c.ytdPct) }}>{fmtPct(c.ytdPct)}</td>
                      <td style={{ padding: "6px 8px", textAlign: "right" }}>{pe}</td>
                      <td style={{ padding: "6px 8px", textAlign: "right" }}>{pbVal}</td>
                      <td style={{ padding: "6px 8px", textAlign: "right", color: "#10b981" }}>{dy}</td>
                      <td style={{ padding: "6px 8px", textAlign: "right", color: retCol(c.mom6m) }}>{c.mom6m != null ? (c.mom6m * 100).toFixed(1) + "%" : "---"}</td>
                      <td style={{ padding: "6px 8px", textAlign: "right" }}>{c.beta != null ? c.beta.toFixed(2) : "---"}</td>
                      <td style={{ padding: "6px 8px", textAlign: "right", fontWeight: 700, color: retCol(c.mlPred) }}>{c.mlPred != null ? (c.mlPred * 100).toFixed(1) + "%" : "---"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>

        {/* Valuation Scatter */}
        <Card>
          <div style={{ marginBottom: 12 }}><SectionTitle>Valuation vs Momentum</SectionTitle></div>
          <div style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", marginBottom: 8 }}>P/E ratio vs 6-month momentum. Ideal: low P/E + positive momentum (bottom-right).</div>
          {scatterData.length > 0 ? (
            <>
              <div style={{ width: "100%", height: 280 }}>
                <ResponsiveContainer>
                  <ScatterChart margin={{ left: 5, right: 20, top: 10, bottom: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#21262d" />
                    <XAxis type="number" dataKey="pe" tick={{ fontSize: 9, fill: "rgba(255,255,255,0.5)" }} label={{ value: "P/E Ratio", position: "bottom", fontSize: 9, fill: "rgba(255,255,255,0.4)", offset: -5 }} />
                    <YAxis type="number" dataKey="mom6m" tick={{ fontSize: 9, fill: "rgba(255,255,255,0.5)" }} label={{ value: "Mom 6M %", angle: -90, position: "insideLeft", fontSize: 9, fill: "rgba(255,255,255,0.4)" }} />
                    <Tooltip content={({ active, payload }: any) => {
                      if (!active || !payload?.[0]) return null;
                      const d = payload[0].payload;
                      const sub = SUB_MAP[d.ticker];
                      return (
                        <div style={{ background: "#161b22", border: "1px solid #30363d", borderRadius: 4, padding: "8px 12px", fontSize: 10, fontFamily: "monospace" }}>
                          <div style={{ fontWeight: 700, color: sub?.color || ACCENT, marginBottom: 4 }}>{d.ticker} <span style={{ fontSize: 8, color: "rgba(255,255,255,0.4)" }}>{d.sub}</span></div>
                          <div>P/E: {d.pe.toFixed(1)}</div>
                          <div>Mom 6M: <span style={{ color: retCol(d.mom6m) }}>{d.mom6m.toFixed(1)}%</span></div>
                          {d.mlPred !== 0 && <div>ML: <span style={{ color: retCol(d.mlPred) }}>{(d.mlPred * 100).toFixed(1)}%</span></div>}
                        </div>
                      );
                    }} />
                    <Scatter data={scatterData} shape={(props: any) => {
                      const { cx, cy, payload } = props;
                      const sub = SUB_MAP[payload.ticker];
                      const col = sub?.color || "#6b7280";
                      return (
                        <g>
                          <circle cx={cx} cy={cy} r={5} fill={col} fillOpacity={0.8} stroke="#0a0a0a" strokeWidth={1} />
                          <text x={cx + 7} y={cy + 3} fontSize={7} fill={col} fillOpacity={0.9}>{payload.ticker}</text>
                        </g>
                      );
                    }} />
                  </ScatterChart>
                </ResponsiveContainer>
              </div>
              <div style={{ display: "flex", gap: 16, justifyContent: "center", marginTop: 6 }}>
                {[{ label: "BANK", color: ACCENT }, { label: "INS", color: "#10b981" }, { label: "FIN", color: "#f59e0b" }, { label: "INV", color: "#a78bfa" }].map(l => (
                  <div key={l.label} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <div style={{ width: 8, height: 8, borderRadius: "50%", background: l.color }} />
                    <span style={{ fontSize: 9, color: "rgba(255,255,255,0.5)" }}>{l.label}</span>
                  </div>
                ))}
              </div>
            </>
          ) : <div style={{ color: "rgba(255,255,255,0.35)", fontSize: 10, padding: 20, textAlign: "center" }}>Insufficient data</div>}
        </Card>
      </div>
    );
  }

  /* ---------------------------------------------------------------- */
  /* SIGNALS TAB                                                       */
  /* ---------------------------------------------------------------- */

  function renderSignals() {
    if (!signals) return <div style={{ color: "rgba(255,255,255,0.4)", padding: 60, textAlign: "center" }}>Loading signals...</div>;
    const { predictions, shorts, insiders, alerts } = signals;

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

        {/* Alerts Banner */}
        {alerts.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {alerts.map((a, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderRadius: 6, background: alertBg(a.type), border: "1px solid " + alertCol(a.type) + "40" }}>
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: alertCol(a.type), flexShrink: 0 }} />
                <span style={{ fontSize: 10, color: "rgba(255,255,255,0.85)", flex: 1 }}>{a.message}</span>
                {a.ticker && <span style={{ fontSize: 9, fontWeight: 700, color: alertCol(a.type) }}>{a.ticker}</span>}
              </div>
            ))}
          </div>
        )}

        {/* ML Prediction Cards */}
        {predictions.length > 0 && (
          <div>
            <div style={{ marginBottom: 12 }}><SectionTitle color={ACCENT}>ML Predictions — 1 Month Forward</SectionTitle></div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 10 }}>
              {[...predictions].sort((a, b) => b.prediction - a.prediction).map(p => {
                const sub = SUB_MAP[p.ticker];
                const sig = mlSignalFromPred(p.prediction);
                const sigCol = mlSignalCol(sig);
                // Percentile bar range
                const lo = p.p05 * 100;
                const hi = p.p95 * 100;
                const mid = p.prediction * 100;
                const range = Math.max(hi - lo, 1);
                const midPos = Math.max(0, Math.min(100, ((mid - lo) / range) * 100));
                return (
                  <div key={p.ticker} onClick={() => openExplorer(p.ticker)}
                    style={{ background: "rgba(255,255,255,0.02)", border: "1px solid " + sigCol + "30", borderRadius: 8, padding: "14px 14px 12px", cursor: "pointer", transition: "border-color 0.15s, background 0.15s" }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = sigCol + "60"; (e.currentTarget as HTMLElement).style.background = sigCol + "08"; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = sigCol + "30"; (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.02)"; }}>
                    {/* Ticker + type */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: sub?.color || "#fff" }}>{p.ticker}</span>
                        {sub && <span style={{ fontSize: 7, padding: "1px 4px", borderRadius: 2, background: sub.color + "20", color: sub.color }}>{sub.label}</span>}
                      </div>
                      <span style={{ fontSize: 8, fontWeight: 700, padding: "2px 6px", borderRadius: 3, background: sigCol + "20", color: sigCol }}>{sig}</span>
                    </div>
                    {/* Prediction value */}
                    <div style={{ fontSize: 22, fontWeight: 800, color: retCol(p.prediction), marginBottom: 6 }}>{fmtPct(p.prediction * 100)}</div>
                    {/* Percentile range bar */}
                    <div style={{ marginBottom: 8 }}>
                      <div style={{ height: 4, background: "#21262d", borderRadius: 2, position: "relative" as const, overflow: "visible" }}>
                        <div style={{ position: "absolute" as const, left: "10%", right: "10%", top: 0, bottom: 0, background: sigCol + "20", borderRadius: 2 }} />
                        <div style={{ position: "absolute" as const, left: `${midPos}%`, top: -2, width: 8, height: 8, background: sigCol, borderRadius: "50%", transform: "translateX(-50%)" }} />
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, fontSize: 7, color: "rgba(255,255,255,0.3)" }}>
                        <span>P05: {lo.toFixed(1)}%</span>
                        <span>P95: {hi.toFixed(1)}%</span>
                      </div>
                    </div>
                    {/* Confidence */}
                    <div style={{ fontSize: 8, color: "rgba(255,255,255,0.4)" }}>Confidence: <span style={{ color: "rgba(255,255,255,0.6)", fontWeight: 600 }}>{p.confidence != null ? (p.confidence * 100).toFixed(0) + "%" : "---"}</span></div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Shorts + Insiders: 2-column */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>

          {/* Short Interest */}
          <Card>
            <div style={{ marginBottom: 12 }}><SectionTitle color="#f59e0b">Short Interest</SectionTitle></div>
            {shorts.length > 0 ? (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10, fontFamily: "monospace" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid #30363d" }}>
                    {["Ticker", "Short %", "Chg (pp)", "90d Trend"].map(h => (
                      <th key={h} style={{ padding: "6px 6px", textAlign: h === "Ticker" ? "left" : "right", fontSize: 9, fontWeight: 600, color: "rgba(255,255,255,0.5)", letterSpacing: "0.04em" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {shorts.sort((a, b) => b.shortPct - a.shortPct).map(s => (
                    <React.Fragment key={s.ticker}>
                      <tr style={{ borderBottom: "1px solid #21262d", cursor: s.holders.length > 0 ? "pointer" : "default" }}
                        onClick={() => s.holders.length > 0 && setExpandedShort(expandedShort === s.ticker ? null : s.ticker)}>
                        <td style={{ padding: "5px 6px" }}>
                          <span style={{ fontWeight: 600, color: SUB_MAP[s.ticker]?.color || "#fff" }}>{s.ticker}</span>
                          {s.holders.length > 0 && <span style={{ fontSize: 7, marginLeft: 4, color: "rgba(255,255,255,0.3)" }}>▾</span>}
                        </td>
                        <td style={{ padding: "5px 6px", textAlign: "right", fontWeight: 700, color: s.shortPct > 3 ? "#f59e0b" : "#fff" }}>{s.shortPct.toFixed(2)}%</td>
                        <td style={{ padding: "5px 6px", textAlign: "right", color: retCol(-s.changePct) }}>{s.changePct != null ? (s.changePct >= 0 ? "+" : "") + s.changePct.toFixed(2) : "---"}</td>
                        <td style={{ padding: "5px 6px", textAlign: "right" }}><Sparkline data={s.history.map(h => h.shortPct)} width={60} height={16} /></td>
                      </tr>
                      {expandedShort === s.ticker && s.holders.length > 0 && (
                        <tr><td colSpan={4} style={{ padding: "4px 8px 8px 20px", background: "rgba(255,255,255,0.02)" }}>
                          {s.holders.map((h, i) => (
                            <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "2px 0", fontSize: 9, color: "rgba(255,255,255,0.5)", borderBottom: i < s.holders.length - 1 ? "1px solid #21262d" : "none" }}>
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

          {/* Insider Transactions */}
          <Card>
            <div style={{ marginBottom: 12 }}><SectionTitle>Insider Transactions (90 Days)</SectionTitle></div>
            {insiders.length > 0 ? (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10, fontFamily: "monospace" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid #30363d" }}>
                    {["Date", "Ticker", "Person", "Type", "Value"].map(h => (
                      <th key={h} style={{ padding: "6px 6px", textAlign: h === "Value" ? "right" : "left", fontSize: 9, fontWeight: 600, color: "rgba(255,255,255,0.5)", letterSpacing: "0.04em" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {insiders.map((tx, i) => (
                    <tr key={i} style={{ borderBottom: "1px solid #21262d" }}>
                      <td style={{ padding: "5px 6px", color: "rgba(255,255,255,0.4)", fontSize: 9 }}>{fmtDateLong(tx.transactionDate)}</td>
                      <td style={{ padding: "5px 6px", fontWeight: 600, color: SUB_MAP[tx.ticker]?.color || "#fff" }}>{tx.ticker}</td>
                      <td style={{ padding: "5px 6px", color: "rgba(255,255,255,0.55)", fontSize: 9, maxWidth: 100, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{tx.personName}</td>
                      <td style={{ padding: "5px 6px" }}>
                        <span style={{ fontSize: 8, fontWeight: 700, padding: "1px 5px", borderRadius: 2, background: tx.transactionType === "BUY" ? "rgba(16,185,129,0.15)" : "rgba(239,68,68,0.15)", color: tx.transactionType === "BUY" ? "#10b981" : "#ef4444" }}>{tx.transactionType}</span>
                      </td>
                      <td style={{ padding: "5px 6px", textAlign: "right", fontWeight: 600 }}>{tx.totalValue != null ? fmtNok(tx.totalValue) : "---"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <div style={{ color: "rgba(255,255,255,0.35)", fontSize: 10, padding: 20, textAlign: "center" }}>No insider transactions</div>}
          </Card>
        </div>
      </div>
    );
  }

  /* ---------------------------------------------------------------- */
  /* MACRO TAB                                                         */
  /* ---------------------------------------------------------------- */

  function renderMacro() {
    if (!macro) return <div style={{ color: "rgba(255,255,255,0.4)", padding: 60, textAlign: "center" }}>Loading macro data...</div>;
    const { fxStrip, fxHistory, cbRegimes, oilExposure, fxExposure } = macro;

    const fxChartMap: Record<string, any> = {};
    for (const pair of Object.keys(fxHistory)) {
      for (const pt of fxHistory[pair]) {
        if (!fxChartMap[pt.date]) fxChartMap[pt.date] = { date: pt.date };
        fxChartMap[pt.date][pair] = pt.rate;
      }
    }
    const fxChartData = Object.values(fxChartMap).sort((a: any, b: any) => a.date.localeCompare(b.date));

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

        {/* FX Strip */}
        {fxStrip.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(fxStrip.length, 4)}, 1fr)`, gap: 10 }}>
            {fxStrip.map(f => (
              <MetricCard key={f.pair} label={f.pair.replace("NOK", "NOK/")} value={f.rate.toFixed(4)} color="#fff"
                sub={f.changePct != null ? fmtPct(f.changePct) + " today" : undefined} />
            ))}
          </div>
        )}

        {/* FX Chart + FX Exposure */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          {fxChartData.length > 0 && (
            <Card>
              <div style={{ marginBottom: 12 }}><SectionTitle color="#3b82f6">FX Rates (90 Days)</SectionTitle></div>
              <div style={{ width: "100%", height: 200 }}>
                <ResponsiveContainer>
                  <LineChart data={fxChartData} margin={{ left: 10, right: 10, top: 5, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#21262d" />
                    <XAxis dataKey="date" tick={{ fontSize: 8, fill: "rgba(255,255,255,0.4)" }} tickFormatter={v => v.slice(5)} interval="preserveStartEnd" />
                    <YAxis yAxisId="usd" tick={{ fontSize: 9, fill: "rgba(255,255,255,0.5)" }} domain={["auto", "auto"]} />
                    <YAxis yAxisId="eur" orientation="right" tick={{ fontSize: 9, fill: "rgba(255,255,255,0.5)" }} domain={["auto", "auto"]} />
                    <Tooltip content={<ChartTooltip />} />
                    <Legend wrapperStyle={{ fontSize: 9, paddingTop: 4 }} />
                    <Line yAxisId="usd" type="monotone" dataKey="NOKUSD" stroke={ACCENT} strokeWidth={1.5} dot={false} name="NOK/USD" />
                    <Line yAxisId="eur" type="monotone" dataKey="NOKEUR" stroke="#10b981" strokeWidth={1.5} dot={false} name="NOK/EUR" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Card>
          )}
          {fxExposure.length > 0 && (
            <Card>
              <div style={{ marginBottom: 12 }}><SectionTitle>FX Revenue Exposure</SectionTitle></div>
              <div style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", marginBottom: 8 }}>Estimated revenue currency breakdown per company.</div>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10, fontFamily: "monospace" }}>
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
                      <td style={{ padding: "5px 6px", fontWeight: 600, color: SUB_MAP[fx.ticker]?.color || "#fff" }}>{fx.ticker}</td>
                      {[fx.nok, fx.usd, fx.eur, fx.gbp, fx.other].map((val, i) => (
                        <td key={i} style={{ padding: "5px 6px", textAlign: "right", fontWeight: val != null && val > 30 ? 700 : 400, color: val != null && val > 50 ? ACCENT : "rgba(255,255,255,0.55)", background: val != null ? `rgba(99,102,241,${Math.min(0.18, val / 200)})` : "transparent" }}>
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

        {/* CB Regimes */}
        {cbRegimes.length > 0 && (
          <Card>
            <div style={{ marginBottom: 12 }}><SectionTitle color="#a78bfa">Global Monetary Policy</SectionTitle></div>
            <div style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", marginBottom: 12 }}>Central bank balance sheet posture. Heavy stimulus compresses bank margins; policy normalization is favorable for financials.</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 8 }}>
              {cbRegimes.map((cb: any) => {
                const regimeMap: Record<string, { label: string; col: string; impact: string; icon: string }> = {
                  "QE Active": { label: "Heavy Stimulus", col: "#ef4444", impact: "Compresses margins", icon: "▼" },
                  "Elevated": { label: "Moderate Stimulus", col: "#f59e0b", impact: "Margins under pressure", icon: "◆" },
                  "Tapering": { label: "Winding Down", col: "#3b82f6", impact: "Margins expanding", icon: "▲" },
                  "Minimal": { label: "Normalised", col: "#10b981", impact: "Healthy margins", icon: "●" },
                };
                const info = regimeMap[cb.regime] || { label: cb.regime, col: "#6b7280", impact: "---", icon: "○" };
                return (
                  <div key={cb.currency} style={{ background: "rgba(255,255,255,0.03)", border: "1px solid " + info.col + "30", borderRadius: 6, padding: "10px 12px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
                      <span style={{ fontSize: 14, fontWeight: 800, color: cb.currency === "NOK" ? ACCENT : "#fff" }}>{cb.currency}</span>
                      <span style={{ fontSize: 8, fontWeight: 700, padding: "2px 6px", borderRadius: 3, background: info.col + "20", color: info.col }}>{info.label}</span>
                    </div>
                    <div style={{ fontSize: 9, color: "rgba(255,255,255,0.45)", marginBottom: 2 }}>{cb.cbName}</div>
                    <div style={{ fontSize: 8, color: info.col }}>{info.icon} {info.impact}</div>
                    {cb.bsPctGdp != null && <div style={{ fontSize: 8, color: "rgba(255,255,255,0.3)", marginTop: 3 }}>BS/GDP: {cb.bsPctGdp.toFixed(0)}%</div>}
                  </div>
                );
              })}
            </div>
          </Card>
        )}

        {/* Oil / Commodity Exposure */}
        {oilExposure.length > 0 && (
          <Card>
            <div style={{ marginBottom: 12 }}><SectionTitle>Commodity Sensitivity</SectionTitle></div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10, fontFamily: "monospace" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #30363d" }}>
                  {["Ticker", "Commodity", "Beta", "Correlation", "R²"].map(h => (
                    <th key={h} style={{ padding: "6px 8px", textAlign: h === "Ticker" || h === "Commodity" ? "left" : "right", fontSize: 9, fontWeight: 600, color: "rgba(255,255,255,0.5)" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {oilExposure.map((row, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid #21262d" }}>
                    <td style={{ padding: "5px 8px", fontWeight: 600, color: SUB_MAP[row.ticker]?.color || "#fff" }}>{row.ticker}</td>
                    <td style={{ padding: "5px 8px", color: "rgba(255,255,255,0.6)" }}>{row.commodity}</td>
                    <td style={{ padding: "5px 8px", textAlign: "right", color: retCol(row.beta) }}>{row.beta.toFixed(2)}</td>
                    <td style={{ padding: "5px 8px", textAlign: "right" }}>{(row.correlation * 100).toFixed(0)}%</td>
                    <td style={{ padding: "5px 8px", textAlign: "right", color: "rgba(255,255,255,0.5)" }}>{(row.rSquared * 100).toFixed(0)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </div>
    );
  }

  /* ---------------------------------------------------------------- */
  /* EXPLORER TAB                                                      */
  /* ---------------------------------------------------------------- */

  function renderExplorer() {
    if (!selectedTicker) {
      const groups: { label: string; color: string; tickers: string[] }[] = [
        { label: "BANKS", color: ACCENT, tickers: Object.keys(SUB_MAP).filter(t => SUB_MAP[t].label === "BANK") },
        { label: "INSURANCE", color: "#10b981", tickers: Object.keys(SUB_MAP).filter(t => SUB_MAP[t].label === "INS") },
        { label: "FINANCIAL SERVICES", color: "#f59e0b", tickers: Object.keys(SUB_MAP).filter(t => SUB_MAP[t].label === "FIN") },
        { label: "INVESTMENT COMPANIES", color: "#a78bfa", tickers: Object.keys(SUB_MAP).filter(t => SUB_MAP[t].label === "INV") },
      ];
      const compMap: Record<string, ComparisonCompany> = {};
      for (const c of comparison?.companies || []) compMap[c.ticker] = c;

      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 10, textAlign: "center", paddingBottom: 4 }}>Select a company to explore</div>
          {groups.map(g => (
            <Card key={g.label}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                <div style={{ width: 3, height: 14, borderRadius: 2, background: g.color }} />
                <span style={{ fontSize: 11, fontWeight: 700, color: g.color, letterSpacing: "0.05em" }}>{g.label}</span>
                <span style={{ fontSize: 9, color: "rgba(255,255,255,0.3)" }}>({g.tickers.length})</span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 6 }}>
                {g.tickers.map(t => {
                  const c = compMap[t];
                  return (
                    <button key={t} onClick={() => setSelectedTicker(t)} style={{ padding: "8px 10px", borderRadius: 5, border: "1px solid #30363d", background: "rgba(255,255,255,0.03)", cursor: "pointer", textAlign: "left", display: "flex", justifyContent: "space-between", alignItems: "center" }}
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
    const priceChartData = prices.map((p: any) => ({ date: (p.date || "").slice(0, 10), price: p.adj_close }));
    const mlSig = pred ? mlSignalFromPred(pred.ensemble_prediction) : null;
    const mlCol = mlSig ? mlSignalCol(mlSig) : "#6b7280";

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

        {/* Ticker Selector Bar */}
        <Card style={{ padding: "10px 14px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <button onClick={() => setSelectedTicker(null)} style={{
              padding: "3px 8px", borderRadius: 3, fontSize: 9, fontWeight: 700, fontFamily: "monospace", cursor: "pointer",
              border: "1px solid #30363d", background: "transparent", color: "rgba(255,255,255,0.4)",
            }}>ALL</button>
            <div style={{ width: 1, height: 14, background: "#30363d" }} />
            {[
              { label: "BANK", tickers: Object.keys(SUB_MAP).filter(t => SUB_MAP[t].label === "BANK") },
              { label: "INS", tickers: Object.keys(SUB_MAP).filter(t => SUB_MAP[t].label === "INS") },
              { label: "FIN", tickers: Object.keys(SUB_MAP).filter(t => SUB_MAP[t].label === "FIN") },
              { label: "INV", tickers: Object.keys(SUB_MAP).filter(t => SUB_MAP[t].label === "INV") },
            ].map((grp, gi) => (
              <React.Fragment key={grp.label}>
                {gi > 0 && <div style={{ width: 1, height: 14, background: "#30363d" }} />}
                {grp.tickers.map(t => {
                  const color = SUB_MAP[t]?.color || ACCENT;
                  return (
                    <button key={t} onClick={() => setSelectedTicker(t)} style={{
                      padding: "3px 8px", borderRadius: 3, fontSize: 9, fontWeight: 700, fontFamily: "monospace", cursor: "pointer",
                      border: "1px solid " + (selectedTicker === t ? color : "transparent"),
                      background: selectedTicker === t ? color + "20" : "transparent",
                      color: selectedTicker === t ? color : "rgba(255,255,255,0.35)",
                    }}>{t}</button>
                  );
                })}
              </React.Fragment>
            ))}
          </div>
        </Card>

        {explorerLoading && <div style={{ color: "rgba(255,255,255,0.4)", padding: 40, textAlign: "center" }}>Loading {selectedTicker}...</div>}

        {!explorerLoading && d && (
          <>
            {/* Hero row */}
            <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
                  <span style={{ fontSize: 26, fontWeight: 800, color: "#fff" }}>{selectedTicker}</span>
                  {sub && <span style={{ fontSize: 9, fontWeight: 700, padding: "3px 8px", borderRadius: 4, background: sub.color + "20", color: sub.color }}>{sub.label}</span>}
                  {mlSig && <span style={{ fontSize: 9, fontWeight: 700, padding: "3px 8px", borderRadius: 4, background: mlCol + "20", color: mlCol }}>{mlSig}</span>}
                </div>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.45)" }}>{d.info?.name || selectedTicker}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 30, fontWeight: 800, color: "#fff" }}>{lastPrice ? fmtPrice(lastPrice.adj_close) : "---"}</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: retCol(dailyPct) }}>{fmtPct(dailyPct)}</div>
              </div>
            </div>

            {/* KPI Strip */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 8 }}>
              <MetricCard label="P/E" value={pe} />
              <MetricCard label="P/B" value={pb} />
              <MetricCard label="Div Yield" value={fund?.dy != null ? (fund.dy * 100).toFixed(1) + "%" : "---"} color={fund?.dy ? "#10b981" : undefined} />
              <MetricCard label="Mkt Cap" value={fund?.mktcap ? fmtNok(fund.mktcap) : "---"} />
              <MetricCard label="Beta" value={tech?.beta != null ? tech.beta.toFixed(2) : (stats?.beta != null ? stats.beta.toFixed(2) : "---")} />
              <MetricCard label="Short %" value={shorts?.shortPct != null ? shorts.shortPct.toFixed(2) + "%" : "---"} color={shorts && shorts.shortPct > 3 ? "#f59e0b" : undefined} />
            </div>

            {/* Price Chart */}
            <Card>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <SectionTitle>Price History</SectionTitle>
                <div style={{ display: "flex", gap: 4 }}>
                  {(["3M", "6M", "1Y", "2Y"] as const).map(tf => (
                    <button key={tf} onClick={() => setExplorerTf(tf)} style={{
                      padding: "3px 8px", borderRadius: 3, border: "1px solid " + (explorerTf === tf ? ACCENT : "#30363d"),
                      background: explorerTf === tf ? ACCENT_DIM : "transparent", color: explorerTf === tf ? ACCENT : "rgba(255,255,255,0.4)",
                      fontSize: 9, fontWeight: 700, fontFamily: "monospace", cursor: "pointer",
                    }}>{tf}</button>
                  ))}
                </div>
              </div>
              {priceChartData.length > 0 ? (
                <div style={{ width: "100%", height: 240 }}>
                  <ResponsiveContainer>
                    <LineChart data={priceChartData} margin={{ left: 10, right: 10, top: 5, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#21262d" />
                      <XAxis dataKey="date" tick={{ fontSize: 8, fill: "rgba(255,255,255,0.4)" }} tickFormatter={(v: string) => v.slice(5)} interval="preserveStartEnd" />
                      <YAxis tick={{ fontSize: 9, fill: "rgba(255,255,255,0.5)" }} domain={["auto", "auto"]} />
                      <Tooltip content={<ChartTooltip />} />
                      <Line type="monotone" dataKey="price" stroke={sub?.color || ACCENT} strokeWidth={1.5} dot={false} name="Price" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              ) : <div style={{ color: "rgba(255,255,255,0.35)", padding: 20, textAlign: "center" }}>No price data</div>}
            </Card>

            {/* 3-column: Risk + ML + Technicals */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
              <Card>
                <div style={{ marginBottom: 10 }}><SectionTitle>Risk Metrics</SectionTitle></div>
                {[
                  { label: "Total Return", value: stats ? fmtPct(stats.totalReturn * 100) : "---", col: retCol(stats?.totalReturn) },
                  { label: "Ann. Return", value: stats ? fmtPct(stats.annualizedReturn * 100) : "---", col: retCol(stats?.annualizedReturn) },
                  { label: "Volatility", value: stats ? (stats.volatility * 100).toFixed(1) + "%" : "---" },
                  { label: "Sharpe", value: stats ? stats.sharpeRatio.toFixed(2) : "---", col: stats && stats.sharpeRatio > 0 ? "#10b981" : "#ef4444" },
                  { label: "Max Drawdown", value: stats ? (stats.maxDrawdown * 100).toFixed(1) + "%" : "---", col: "#ef4444" },
                  { label: "VaR 95%", value: stats ? (stats.var95 * 100).toFixed(2) + "%" : "---", col: "#ef4444" },
                ].map(r => (
                  <div key={r.label} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: "1px solid #21262d" }}>
                    <span style={{ fontSize: 10, color: "rgba(255,255,255,0.45)" }}>{r.label}</span>
                    <span style={{ fontSize: 10, fontWeight: 700, color: r.col || "#fff" }}>{r.value}</span>
                  </div>
                ))}
              </Card>

              <Card>
                <div style={{ marginBottom: 10 }}><SectionTitle>ML Prediction</SectionTitle></div>
                {pred ? (
                  <>
                    <div style={{ textAlign: "center", margin: "10px 0 4px" }}>
                      <span style={{ fontSize: 10, fontWeight: 700, padding: "3px 10px", borderRadius: 4, background: mlCol + "20", color: mlCol }}>{mlSig}</span>
                    </div>
                    <div style={{ textAlign: "center", fontSize: 26, fontWeight: 800, color: retCol(pred.ensemble_prediction), marginBottom: 4 }}>{fmtPct(pred.ensemble_prediction * 100)}</div>
                    <div style={{ textAlign: "center", fontSize: 9, color: "rgba(255,255,255,0.4)", marginBottom: 10 }}>1-month forward</div>
                    {[
                      { label: "P95", value: pred.p95, col: "#10b981" },
                      { label: "P75", value: pred.p75, col: "#10b981" },
                      { label: "P50 (Median)", value: pred.p50, col: "#fff" },
                      { label: "P25", value: pred.p25, col: "#ef4444" },
                      { label: "P05", value: pred.p05, col: "#ef4444" },
                    ].map(r => (
                      <div key={r.label} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: "1px solid #21262d" }}>
                        <span style={{ fontSize: 9, color: "rgba(255,255,255,0.4)" }}>{r.label}</span>
                        <span style={{ fontSize: 10, fontWeight: 600, color: r.col }}>{r.value != null ? fmtPct(r.value * 100) : "---"}</span>
                      </div>
                    ))}
                  </>
                ) : <div style={{ color: "rgba(255,255,255,0.35)", padding: 20, textAlign: "center" }}>No ML prediction</div>}
              </Card>

              <Card>
                <div style={{ marginBottom: 10 }}><SectionTitle>Technical Factors</SectionTitle></div>
                {[
                  { label: "Mom 1M", value: tech?.mom1m, fmt: (v: number) => fmtPct(v * 100), col: retCol(tech?.mom1m) },
                  { label: "Mom 6M", value: tech?.mom6m, fmt: (v: number) => fmtPct(v * 100), col: retCol(tech?.mom6m) },
                  { label: "Mom 11M", value: tech?.mom11m, fmt: (v: number) => fmtPct(v * 100), col: retCol(tech?.mom11m) },
                  { label: "Vol 1M", value: tech?.vol1m, fmt: (v: number) => (v * 100).toFixed(1) + "%", col: undefined },
                  { label: "Vol 3M", value: tech?.vol3m, fmt: (v: number) => (v * 100).toFixed(1) + "%", col: undefined },
                  { label: "Beta", value: tech?.beta, fmt: (v: number) => v.toFixed(2), col: undefined },
                  { label: "Idio. Vol", value: tech?.ivol, fmt: (v: number) => (v * 100).toFixed(1) + "%", col: undefined },
                ].map(r => (
                  <div key={r.label} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: "1px solid #21262d" }}>
                    <span style={{ fontSize: 10, color: "rgba(255,255,255,0.45)" }}>{r.label}</span>
                    <span style={{ fontSize: 10, fontWeight: 700, color: r.col || "#fff" }}>{r.value != null ? r.fmt(r.value) : "---"}</span>
                  </div>
                ))}
              </Card>
            </div>

            {/* Fundamentals + Shorts */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Card>
                <div style={{ marginBottom: 10 }}><SectionTitle>Fundamentals</SectionTitle></div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                  {[
                    { label: "P/E Ratio", value: pe },
                    { label: "P/B Ratio", value: pb },
                    { label: "Dividend Yield", value: fund?.dy != null ? (fund.dy * 100).toFixed(1) + "%" : "---" },
                    { label: "EV/EBITDA", value: fund?.evEbitda != null ? fund.evEbitda.toFixed(1) + "x" : "---" },
                    { label: "Market Cap", value: fund?.mktcap ? fmtNok(fund.mktcap) : "---" },
                    { label: "Sales Growth", value: fund?.sg != null ? fmtPct(fund.sg * 100) : "---" },
                  ].map(r => (
                    <div key={r.label} style={{ background: "rgba(255,255,255,0.03)", border: "1px solid #21262d", borderRadius: 5, padding: "8px 10px" }}>
                      <div style={{ fontSize: 8, color: "rgba(255,255,255,0.4)", textTransform: "uppercase" as const, letterSpacing: "0.04em", marginBottom: 2 }}>{r.label}</div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: "#fff" }}>{r.value}</div>
                    </div>
                  ))}
                </div>
              </Card>

              <Card>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                  <SectionTitle>Short Interest</SectionTitle>
                  <a href={`https://ssr.finanstilsynet.no/en/instrument?query=${selectedTicker}`} target="_blank" rel="noopener noreferrer" style={{ fontSize: 8, color: ACCENT, textDecoration: "none" }}>SSR →</a>
                </div>
                {shorts && shorts.shortPct != null ? (
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                      <span style={{ fontSize: 22, fontWeight: 800, color: shorts.shortPct > 3 ? "#f59e0b" : "#fff" }}>{shorts.shortPct.toFixed(2)}%</span>
                      <Sparkline data={(shorts.history || []).map((h: any) => h.shortPct)} width={100} height={30} />
                    </div>
                    {shorts.holders?.length > 0 && shorts.holders.map((h: any, i: number) => (
                      <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", borderBottom: "1px solid #21262d", fontSize: 9, color: "rgba(255,255,255,0.5)" }}>
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
                <div style={{ marginBottom: 10 }}><SectionTitle>News & Filings</SectionTitle></div>
                <div style={{ maxHeight: 240, overflowY: "auto" }}>
                  {news.map((n: any, i: number) => (
                    <div key={i} style={{ padding: "6px 0", borderBottom: i < news.length - 1 ? "1px solid #21262d" : "none" }}>
                      <div style={{ fontSize: 10, color: "rgba(255,255,255,0.7)", lineHeight: 1.4 }}>{n.headline}</div>
                      <div style={{ fontSize: 8, color: "rgba(255,255,255,0.35)", marginTop: 2 }}>
                        {fmtDate(n.published_at || n.publishedAt)}
                        {n.category && <span style={{ marginLeft: 6, padding: "1px 4px", borderRadius: 2, background: "#21262d", color: "rgba(255,255,255,0.4)" }}>{n.category}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {/* Quick Links */}
            <Card style={{ padding: "12px 16px" }}>
              <div style={{ marginBottom: 8 }}><SectionTitle>Explore More</SectionTitle></div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {[
                  { href: `/stocks/${selectedTicker}`, label: "Full Stock Page", color: "#3b82f6" },
                  { href: `/volatility/${selectedTicker}`, label: "Volatility", color: "#f59e0b" },
                  { href: `/predictions/${selectedTicker}`, label: "ML Predictions", color: ACCENT },
                  { href: `/montecarlo/${selectedTicker}`, label: "Monte Carlo", color: "#8b5cf6" },
                ].map(link => (
                  <Link key={link.href} href={link.href} style={{
                    padding: "6px 14px", borderRadius: 5, border: "1px solid " + link.color + "40",
                    background: link.color + "10", color: link.color,
                    fontSize: 10, fontWeight: 600, textDecoration: "none", transition: "background 0.15s",
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

  const visibleTabs = TABS.filter(t => t !== "EXPLORER" || !!selectedTicker);

  return (
    <main style={{ minHeight: "100vh", background: "#0a0a0a", color: "#fff", fontFamily: "monospace", fontSize: 12 }}>
      <div style={{ maxWidth: 1400, margin: "0 auto", padding: "20px 24px" }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 700, color: "#fff", margin: 0, letterSpacing: "-0.02em" }}>
              <span style={{ color: ACCENT }}>// </span>FINANCIALS & INSURANCE
            </h1>
            <div style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", marginTop: 3, letterSpacing: "0.04em" }}>Banks · Insurance · Financial Services · Investment Companies</div>
          </div>
          <Link href="/" style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", textDecoration: "none", padding: "4px 10px", border: "1px solid #30363d", borderRadius: 4 }}>HOME</Link>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", gap: 0, borderBottom: "1px solid #30363d", marginBottom: 20 }}>
          {visibleTabs.map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              padding: "9px 18px", fontSize: 10, fontWeight: 700, fontFamily: "monospace", letterSpacing: "0.05em",
              color: tab === t ? ACCENT : "rgba(255,255,255,0.45)", background: "transparent", border: "none",
              borderBottom: tab === t ? `2px solid ${ACCENT}` : "2px solid transparent", cursor: "pointer",
              transition: "color 0.15s",
            }}>{t === "EXPLORER" && selectedTicker ? `EXPLORER — ${selectedTicker}` : t}</button>
          ))}
        </div>

        {/* Content */}
        {loading && !overview && tab === "OVERVIEW" && (
          <div style={{ color: "rgba(255,255,255,0.4)", padding: 60, textAlign: "center" }}>Loading...</div>
        )}
        {tab === "OVERVIEW" && renderOverview()}
        {tab === "RATES" && renderRates()}
        {tab === "SCORECARD" && renderScorecard()}
        {tab === "SIGNALS" && renderSignals()}
        {tab === "MACRO" && renderMacro()}
        {tab === "EXPLORER" && renderExplorer()}

        {/* Footer */}
        <div style={{ borderTop: "1px solid #21262d", marginTop: 28, padding: "12px 0", fontSize: 9, color: "rgba(255,255,255,0.25)", lineHeight: 1.9 }}>
          <span style={{ fontWeight: 700, color: "rgba(255,255,255,0.35)", letterSpacing: "0.06em" }}>DATA SOURCES</span>
          <div style={{ marginTop: 2 }}>
            Rates: Norges Bank, IBKR &middot; Prices: IBKR, Yahoo Finance &middot; Shorts: Finanstilsynet SSR &middot; News: Oslo Børs NewsWeb &middot; FX: Norges Bank, IBKR
          </div>
        </div>
      </div>
    </main>
  );
}
