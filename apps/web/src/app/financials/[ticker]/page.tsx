"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import PageNav from "@/components/ui/PageNav";
import { useParams } from "next/navigation";
import {
  LineChart, Line, BarChart, Bar, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, Cell,
} from "recharts";

/* ================================================================== */
/* Types                                                               */
/* ================================================================== */

type PriceRow = { date: string; close: number; adj_close: number; volume: number; open: number; high: number; low: number };
type Analytics = {
  ticker: string;
  summary: { adjusted: { totalReturn: number; annualizedReturn: number; volatility: number; maxDrawdown: number; var95: number; sharpeRatio: number; beta: number } };
  prices: PriceRow[];
  returns: { adjusted: { date: string; return: number }[] };
};
type Fundamentals = { ep: number | null; bm: number | null; dy: number | null; mktcap: number | null; evEbitda: number | null; sg: number | null; sp: number | null };
type Technical = { mom1m: number | null; mom6m: number | null; mom11m: number | null; vol1m: number | null; vol3m: number | null; beta: number | null; ivol: number | null };
type Prediction = { prediction_date: string; ensemble_prediction: number; confidence_score: number; p05: number; p25: number; p50: number; p75: number; p95: number };
type ShortData = { shortPct: number; changePct: number; history: { date: string; shortPct: number }[]; holders: { holder: string; pct: number; date: string }[] };
type NewsItem = { headline: string; published_at: string; category: string; severity: number; sentiment: number | null; source?: string };
type InsiderTx = { transactionDate: string; personName: string; personRole: string | null; transactionType: string; shares: number; pricePerShare: number | null; totalValue: number | null; holdingsAfter: number | null; ticker: string };

/* ================================================================== */
/* Constants                                                           */
/* ================================================================== */

const ACCENT = "#6366f1";

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
const fmtNok = (v: number | null | undefined): string => {
  if (v == null) return "---";
  if (Math.abs(v) >= 1e9) return (v / 1e9).toFixed(1) + "B";
  if (Math.abs(v) >= 1e6) return (v / 1e6).toFixed(1) + "M";
  if (Math.abs(v) >= 1e3) return (v / 1e3).toFixed(0) + "K";
  return v.toFixed(0);
};
const fmtDate = (v: string | null): string => {
  if (!v) return "---";
  try { return new Date(v).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" }); } catch { return v; }
};
const retCol = (v: number | null | undefined): string => v == null ? "rgba(255,255,255,0.5)" : v >= 0 ? "#10b981" : "#ef4444";

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
  return <div style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.6)", letterSpacing: "0.08em", textTransform: "uppercase" as const, marginBottom: 8 }}>{children}</div>;
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
        <div key={i} style={{ color: p.color || "#fff" }}>{p.name}: {typeof p.value === "number" ? p.value.toFixed(2) : p.value}</div>
      ))}
    </div>
  );
}

/* ================================================================== */
/* Main Page Component                                                 */
/* ================================================================== */

export default function FinancialsTickerPage() {
  const params = useParams();
  const ticker = (params?.ticker as string || "").toUpperCase();
  const sub = SUB_MAP[ticker];

  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [fundamentals, setFundamentals] = useState<Fundamentals | null>(null);
  const [technical, setTechnical] = useState<Technical | null>(null);
  const [prediction, setPrediction] = useState<Prediction | null>(null);
  const [shorts, setShorts] = useState<ShortData | null>(null);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [insiders, setInsiders] = useState<InsiderTx[]>([]);
  const [stockInfo, setStockInfo] = useState<{ name: string; sector: string; currency: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [timeframe, setTimeframe] = useState<"3M" | "6M" | "1Y" | "2Y" | "ALL">("1Y");

  useEffect(() => {
    if (!ticker) return;

    Promise.all([
      // Analytics (price history + stats)
      fetch(`/api/analytics/${ticker}?days=${timeframe === "3M" ? 90 : timeframe === "6M" ? 180 : timeframe === "1Y" ? 365 : timeframe === "2Y" ? 730 : 9999}`).then(r => r.ok ? r.json() : null),
      // Stock info
      fetch(`/api/equities/${ticker}`).then(r => r.ok ? r.json() : null),
      // Fundamentals
      fetch(`/api/fundamentals/${ticker}`).then(r => r.ok ? r.json() : null),
      // Factors (technical)
      fetch(`/api/factors/${ticker}`).then(r => r.ok ? r.json() : null),
      // ML Predictions
      fetch(`/api/predictions/${ticker}`).then(r => r.ok ? r.json() : null),
      // Shorts
      fetch(`/api/shorts/${ticker}`).then(r => r.ok ? r.json() : null),
      // News
      fetch(`/api/news/ticker/${ticker}`).then(r => r.ok ? r.json() : null),
    ]).then(([anal, info, fund, fac, pred, sh, nws]) => {
      if (anal) setAnalytics(anal);
      if (info) setStockInfo({ name: info.name || ticker, sector: info.sector || "Financials", currency: info.currency || "NOK" });
      if (fund) setFundamentals(fund);
      if (fac?.technical) setTechnical(fac.technical);
      if (pred?.predictions?.[0]) setPrediction(pred.predictions[0]);
      if (sh) setShorts(sh);
      if (nws?.items) setNews(nws.items.slice(0, 20));
      else if (Array.isArray(nws)) setNews(nws.slice(0, 20));

      // Fetch insider transactions from signals API
      fetch("/api/financials/signals").then(r => r.ok ? r.json() : null).then(sig => {
        if (sig?.insiders) {
          setInsiders(sig.insiders.filter((tx: any) => tx.ticker === ticker));
        }
      });
    }).catch(() => {}).finally(() => setLoading(false));
  }, [ticker, timeframe]);

  if (!ticker) return null;

  const prices = analytics?.prices || [];
  const stats = analytics?.summary?.adjusted;
  const returns = analytics?.returns?.adjusted || [];
  const lastPrice = prices.length > 0 ? prices[prices.length - 1] : null;
  const prevPrice = prices.length > 1 ? prices[prices.length - 2] : null;
  const dailyPct = lastPrice && prevPrice ? ((lastPrice.adj_close / prevPrice.adj_close) - 1) * 100 : null;

  // Chart data
  const priceChartData = prices.map(p => ({ date: p.date.slice(0, 10), price: p.adj_close, volume: p.volume }));

  // Returns distribution
  const retBuckets: Record<string, number> = {};
  for (const r of returns) {
    const pct = r.return * 100;
    const bucket = (Math.round(pct * 2) / 2).toFixed(1);
    retBuckets[bucket] = (retBuckets[bucket] || 0) + 1;
  }
  const retDistData = Object.entries(retBuckets).map(([k, v]) => ({ bucket: parseFloat(k), count: v })).sort((a, b) => a.bucket - b.bucket);

  // ML signal label
  const mlSignal = prediction ? (
    prediction.ensemble_prediction > 0.04 ? "STRONG BUY" :
    prediction.ensemble_prediction > 0.015 ? "BUY" :
    prediction.ensemble_prediction > -0.015 ? "HOLD" :
    prediction.ensemble_prediction > -0.04 ? "SELL" : "STRONG SELL"
  ) : null;
  const mlCol = mlSignal?.includes("BUY") ? "#10b981" : mlSignal?.includes("SELL") ? "#ef4444" : "#6b7280";

  // P/E from E/P
  const pe = fundamentals?.ep && fundamentals.ep > 0 ? (1 / fundamentals.ep).toFixed(1) : "---";
  const pb = fundamentals?.bm && fundamentals.bm > 0 ? (1 / fundamentals.bm).toFixed(1) : "---";

  return (
    <main style={{ minHeight: "100vh", background: "#0a0a0a", color: "#fff", fontFamily: "monospace", fontSize: 12 }}>
      <div style={{ maxWidth: 1400, margin: "0 auto", padding: "20px 24px" }}>
        <PageNav crumbs={[{label:"Home",href:"/"},{label:"Financials",href:"/financials"},{label:ticker}]} />

        {/* Hero Header */}
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
              <h1 style={{ fontSize: 28, fontWeight: 800, color: "#fff", margin: 0 }}>{ticker}</h1>
              {sub && <span style={{ fontSize: 9, fontWeight: 700, padding: "2px 8px", borderRadius: 3, background: sub.color + "20", color: sub.color }}>{sub.label}</span>}
            </div>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)" }}>{stockInfo?.name || "Loading..."}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 32, fontWeight: 800, color: "#fff" }}>{lastPrice ? fmtPrice(lastPrice.adj_close) : "---"}</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: retCol(dailyPct) }}>{fmtPct(dailyPct)}</div>
            {lastPrice && <div style={{ fontSize: 9, color: "rgba(255,255,255,0.3)" }}>{fmtDate(lastPrice.date)}</div>}
          </div>
        </div>

        {loading && <div style={{ color: "rgba(255,255,255,0.4)", padding: 40, textAlign: "center" }}>Loading {ticker}...</div>}

        {!loading && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {/* KPI Strip */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 8 }}>
              <MetricCard label="P/E" value={pe} />
              <MetricCard label="P/B" value={pb} />
              <MetricCard label="DIV YIELD" value={fundamentals?.dy != null ? (fundamentals.dy * 100).toFixed(1) + "%" : "---"} color={fundamentals?.dy ? "#10b981" : undefined} />
              <MetricCard label="MKT CAP" value={fundamentals?.mktcap ? fmtNok(fundamentals.mktcap) : "---"} />
              <MetricCard label="BETA" value={technical?.beta != null ? technical.beta.toFixed(2) : (stats?.beta != null ? stats.beta.toFixed(2) : "---")} />
              <MetricCard label="SHORT %" value={shorts?.shortPct != null ? shorts.shortPct.toFixed(2) + "%" : "---"} color={shorts && shorts.shortPct > 3 ? "#f59e0b" : undefined} />
            </div>

            {/* Price Chart + Volume */}
            <Card>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <SectionTitle>PRICE HISTORY</SectionTitle>
                <div style={{ display: "flex", gap: 4 }}>
                  {(["3M", "6M", "1Y", "2Y", "ALL"] as const).map(tf => (
                    <button key={tf} onClick={() => setTimeframe(tf)} style={{
                      padding: "3px 8px", borderRadius: 3, border: "1px solid " + (timeframe === tf ? ACCENT : "#30363d"),
                      background: timeframe === tf ? ACCENT + "20" : "transparent", color: timeframe === tf ? ACCENT : "rgba(255,255,255,0.4)",
                      fontSize: 9, fontWeight: 700, fontFamily: "monospace", cursor: "pointer",
                    }}>{tf}</button>
                  ))}
                </div>
              </div>
              {priceChartData.length > 0 ? (
                <div style={{ width: "100%", height: 300 }}>
                  <ResponsiveContainer>
                    <AreaChart data={priceChartData} margin={{ left: 10, right: 10, top: 5, bottom: 5 }}>
                      <defs>
                        <linearGradient id="priceGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={ACCENT} stopOpacity={0.15} />
                          <stop offset="95%" stopColor={ACCENT} stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#21262d" />
                      <XAxis dataKey="date" tick={{ fontSize: 8, fill: "rgba(255,255,255,0.4)" }} tickFormatter={v => v.slice(5)} interval="preserveStartEnd" />
                      <YAxis tick={{ fontSize: 9, fill: "rgba(255,255,255,0.5)" }} domain={["auto", "auto"]} />
                      <Tooltip content={<ChartTooltip />} />
                      <Area type="monotone" dataKey="price" stroke={ACCENT} strokeWidth={1.5} fill="url(#priceGrad)" name="Price" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              ) : <div style={{ color: "rgba(255,255,255,0.35)", padding: 20, textAlign: "center" }}>No price data</div>}
            </Card>

            {/* 3-column: Stats + ML + Technicals */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
              {/* Risk Stats */}
              <Card>
                <SectionTitle>RISK METRICS</SectionTitle>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {[
                    { label: "Total Return", value: stats ? fmtPct(stats.totalReturn * 100) : "---", col: retCol(stats?.totalReturn) },
                    { label: "Ann. Return", value: stats ? fmtPct(stats.annualizedReturn * 100) : "---", col: retCol(stats?.annualizedReturn) },
                    { label: "Volatility", value: stats ? (stats.volatility * 100).toFixed(1) + "%" : "---" },
                    { label: "Sharpe Ratio", value: stats ? stats.sharpeRatio.toFixed(2) : "---", col: stats && stats.sharpeRatio > 0 ? "#10b981" : "#ef4444" },
                    { label: "Max Drawdown", value: stats ? (stats.maxDrawdown * 100).toFixed(1) + "%" : "---", col: "#ef4444" },
                    { label: "VaR 95%", value: stats ? (stats.var95 * 100).toFixed(2) + "%" : "---", col: "#ef4444" },
                  ].map(r => (
                    <div key={r.label} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", borderBottom: "1px solid #21262d" }}>
                      <span style={{ fontSize: 10, color: "rgba(255,255,255,0.5)" }}>{r.label}</span>
                      <span style={{ fontSize: 10, fontWeight: 700, color: r.col || "#fff" }}>{r.value}</span>
                    </div>
                  ))}
                </div>
              </Card>

              {/* ML Prediction */}
              <Card>
                <SectionTitle>ML PREDICTION</SectionTitle>
                {prediction ? (
                  <div>
                    <div style={{ textAlign: "center", marginBottom: 10 }}>
                      <span style={{ fontSize: 9, fontWeight: 700, padding: "2px 8px", borderRadius: 3, background: mlCol + "20", color: mlCol }}>{mlSignal}</span>
                    </div>
                    <div style={{ textAlign: "center", fontSize: 28, fontWeight: 800, color: retCol(prediction.ensemble_prediction) }}>
                      {fmtPct(prediction.ensemble_prediction * 100)}
                    </div>
                    <div style={{ textAlign: "center", fontSize: 9, color: "rgba(255,255,255,0.4)", marginBottom: 12 }}>1-month forward return forecast</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      {[
                        { label: "P95 (Bull)", value: prediction.p95, col: "#10b981" },
                        { label: "P75", value: prediction.p75, col: "#10b981" },
                        { label: "P50 (Median)", value: prediction.p50, col: "#fff" },
                        { label: "P25", value: prediction.p25, col: "#ef4444" },
                        { label: "P05 (Bear)", value: prediction.p05, col: "#ef4444" },
                      ].map(r => (
                        <div key={r.label} style={{ display: "flex", justifyContent: "space-between", padding: "2px 0", borderBottom: "1px solid #21262d" }}>
                          <span style={{ fontSize: 9, color: "rgba(255,255,255,0.4)" }}>{r.label}</span>
                          <span style={{ fontSize: 10, fontWeight: 600, color: r.col }}>{r.value != null ? fmtPct(r.value * 100) : "---"}</span>
                        </div>
                      ))}
                    </div>
                    <div style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", marginTop: 8, textAlign: "center" }}>
                      Confidence: {(prediction.confidence_score * 100).toFixed(0)}% | {fmtDate(prediction.prediction_date)}
                    </div>
                  </div>
                ) : <div style={{ color: "rgba(255,255,255,0.35)", padding: 20, textAlign: "center" }}>No ML prediction available</div>}
              </Card>

              {/* Technicals */}
              <Card>
                <SectionTitle>TECHNICAL FACTORS</SectionTitle>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {[
                    { label: "Momentum 1M", value: technical?.mom1m, fmt: (v: number) => fmtPct(v * 100), col: retCol(technical?.mom1m) },
                    { label: "Momentum 6M", value: technical?.mom6m, fmt: (v: number) => fmtPct(v * 100), col: retCol(technical?.mom6m) },
                    { label: "Momentum 11M", value: technical?.mom11m, fmt: (v: number) => fmtPct(v * 100), col: retCol(technical?.mom11m) },
                    { label: "Volatility 1M", value: technical?.vol1m, fmt: (v: number) => (v * 100).toFixed(1) + "%" },
                    { label: "Volatility 3M", value: technical?.vol3m, fmt: (v: number) => (v * 100).toFixed(1) + "%" },
                    { label: "Beta", value: technical?.beta, fmt: (v: number) => v.toFixed(2) },
                    { label: "Idio. Vol", value: technical?.ivol, fmt: (v: number) => (v * 100).toFixed(1) + "%" },
                  ].map(r => (
                    <div key={r.label} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", borderBottom: "1px solid #21262d" }}>
                      <span style={{ fontSize: 10, color: "rgba(255,255,255,0.5)" }}>{r.label}</span>
                      <span style={{ fontSize: 10, fontWeight: 700, color: r.col || "#fff" }}>{r.value != null ? r.fmt(r.value) : "---"}</span>
                    </div>
                  ))}
                </div>
              </Card>
            </div>

            {/* 2-column: Fundamentals + Short Interest */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              {/* Fundamentals */}
              <Card>
                <SectionTitle>FUNDAMENTALS</SectionTitle>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 4 }}>
                  {[
                    { label: "P/E Ratio", value: pe },
                    { label: "P/B Ratio", value: pb },
                    { label: "Dividend Yield", value: fundamentals?.dy != null ? (fundamentals.dy * 100).toFixed(1) + "%" : "---" },
                    { label: "EV/EBITDA", value: fundamentals?.evEbitda != null ? fundamentals.evEbitda.toFixed(1) + "x" : "---" },
                    { label: "Market Cap", value: fundamentals?.mktcap ? fmtNok(fundamentals.mktcap) : "---" },
                    { label: "Sales Growth", value: fundamentals?.sg != null ? fmtPct(fundamentals.sg * 100) : "---" },
                  ].map(r => (
                    <div key={r.label} style={{ background: "#0d1117", border: "1px solid #21262d", borderRadius: 4, padding: "8px 10px" }}>
                      <div style={{ fontSize: 8, color: "rgba(255,255,255,0.4)", textTransform: "uppercase" as const, letterSpacing: "0.04em" }}>{r.label}</div>
                      <div style={{ fontSize: 14, fontWeight: 700, marginTop: 2 }}>{r.value}</div>
                    </div>
                  ))}
                </div>
              </Card>

              {/* Short Interest */}
              <Card>
                <SectionTitle>SHORT INTEREST</SectionTitle>
                {shorts ? (
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                      <div>
                        <span style={{ fontSize: 22, fontWeight: 800, color: shorts.shortPct > 3 ? "#f59e0b" : "#fff" }}>{shorts.shortPct.toFixed(2)}%</span>
                        <span style={{ fontSize: 10, color: retCol(shorts.changePct), marginLeft: 8 }}>{shorts.changePct != null ? (shorts.changePct >= 0 ? "+" : "") + shorts.changePct.toFixed(2) + "pp" : ""}</span>
                      </div>
                      <Sparkline data={shorts.history.map(h => h.shortPct)} width={120} height={32} />
                    </div>
                    {shorts.holders.length > 0 && (
                      <>
                        <div style={{ fontSize: 9, fontWeight: 600, color: "rgba(255,255,255,0.5)", marginBottom: 4, marginTop: 8 }}>POSITION HOLDERS</div>
                        {shorts.holders.map((h, i) => (
                          <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", borderBottom: "1px solid #21262d", fontSize: 10 }}>
                            <span style={{ color: "rgba(255,255,255,0.6)" }}>{h.holder}</span>
                            <span style={{ fontWeight: 600 }}>{h.pct.toFixed(2)}%</span>
                          </div>
                        ))}
                      </>
                    )}
                  </div>
                ) : <div style={{ color: "rgba(255,255,255,0.35)", padding: 20, textAlign: "center" }}>No short position data</div>}
              </Card>
            </div>

            {/* Return Distribution */}
            {retDistData.length > 0 && (
              <Card>
                <SectionTitle>DAILY RETURN DISTRIBUTION</SectionTitle>
                <div style={{ width: "100%", height: 180 }}>
                  <ResponsiveContainer>
                    <BarChart data={retDistData} margin={{ left: 10, right: 10, top: 5, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#21262d" />
                      <XAxis dataKey="bucket" tick={{ fontSize: 8, fill: "rgba(255,255,255,0.4)" }} tickFormatter={v => v + "%"} />
                      <YAxis tick={{ fontSize: 9, fill: "rgba(255,255,255,0.5)" }} />
                      <Tooltip content={<ChartTooltip />} />
                      <Bar dataKey="count" name="Days" radius={[2, 2, 0, 0]}>
                        {retDistData.map((d, i) => (
                          <Cell key={i} fill={d.bucket >= 0 ? "#10b981" : "#ef4444"} fillOpacity={0.7} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Card>
            )}

            {/* 2-column: News + Insider Transactions */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              {/* News */}
              <Card>
                <SectionTitle>NEWS & FILINGS</SectionTitle>
                {news.length > 0 ? (
                  <div style={{ maxHeight: 300, overflowY: "auto" }}>
                    {news.map((n, i) => (
                      <div key={i} style={{ padding: "6px 0", borderBottom: i < news.length - 1 ? "1px solid #21262d" : "none" }}>
                        <div style={{ fontSize: 10, color: "rgba(255,255,255,0.7)" }}>{n.headline}</div>
                        <div style={{ display: "flex", gap: 8, marginTop: 2, fontSize: 8, color: "rgba(255,255,255,0.35)" }}>
                          <span>{fmtDate(n.published_at)}</span>
                          {n.category && <span style={{ padding: "0 4px", borderRadius: 2, background: "#21262d" }}>{n.category}</span>}
                          {n.sentiment != null && <span style={{ color: n.sentiment > 0 ? "#10b981" : n.sentiment < 0 ? "#ef4444" : "rgba(255,255,255,0.35)" }}>{n.sentiment > 0 ? "+" : ""}{n.sentiment.toFixed(2)}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : <div style={{ color: "rgba(255,255,255,0.35)", padding: 20, textAlign: "center" }}>No recent news</div>}
              </Card>

              {/* Insider Transactions */}
              <Card>
                <SectionTitle>INSIDER TRANSACTIONS</SectionTitle>
                {insiders.length > 0 ? (
                  <div style={{ maxHeight: 300, overflowY: "auto" }}>
                    {insiders.map((tx, i) => (
                      <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "5px 0", borderBottom: i < insiders.length - 1 ? "1px solid #21262d" : "none" }}>
                        <div>
                          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.7)" }}>{tx.personName}</div>
                          <div style={{ fontSize: 8, color: "rgba(255,255,255,0.35)" }}>{fmtDate(tx.transactionDate)} &middot; {tx.personRole || "---"}</div>
                        </div>
                        <div style={{ textAlign: "right" }}>
                          <span style={{ fontSize: 8, fontWeight: 700, padding: "1px 4px", borderRadius: 2, background: tx.transactionType === "BUY" ? "rgba(16,185,129,0.15)" : "rgba(239,68,68,0.15)", color: tx.transactionType === "BUY" ? "#10b981" : "#ef4444" }}>{tx.transactionType}</span>
                          <div style={{ fontSize: 9, fontWeight: 600, marginTop: 2 }}>{tx.totalValue ? fmtNok(tx.totalValue) : "---"}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : <div style={{ color: "rgba(255,255,255,0.35)", padding: 20, textAlign: "center" }}>No insider transactions</div>}
              </Card>
            </div>

            {/* Quick Links */}
            <Card>
              <SectionTitle>EXPLORE MORE</SectionTitle>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
                {[
                  { href: `/stocks/${ticker}`, label: "Full Stock Page" },
                  { href: `/volatility/${ticker}`, label: "Volatility Analysis" },
                  { href: `/predictions/${ticker}`, label: "ML Predictions" },
                  { href: `/montecarlo/${ticker}`, label: "Monte Carlo" },
                  { href: `/correlation?tickers=${ticker}`, label: "Correlation" },
                ].map(link => (
                  <Link key={link.href} href={link.href} style={{
                    padding: "6px 14px", borderRadius: 4, border: "1px solid #30363d", background: "#0d1117",
                    color: "rgba(255,255,255,0.6)", fontSize: 10, fontWeight: 600, textDecoration: "none",
                    transition: "all 0.15s",
                  }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = ACCENT; e.currentTarget.style.color = ACCENT; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = "#30363d"; e.currentTarget.style.color = "rgba(255,255,255,0.6)"; }}
                  >{link.label}</Link>
                ))}
              </div>
            </Card>
          </div>
        )}
      </div>
    </main>
  );
}
