"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import PageNav from "@/components/ui/PageNav";
import { use } from "react";
import {
  ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid,
  ResponsiveContainer, Tooltip, ReferenceLine,
} from "recharts";

type CommodityDetail = {
  symbol: string;
  currency: string;
  latest: {
    date: string;
    close: number;
    dayReturnPct: number | null;
  };
  stats: {
    sma20: number | null;
    sma50: number | null;
    sma200: number | null;
    ytdReturnPct: number | null;
    high52w: number;
    low52w: number;
    dataPoints: number;
  };
  history: {
    date: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number | null;
  }[];
  sensitivities: {
    ticker: string;
    stockName: string | null;
    sector: string | null;
    beta: number;
    correlation60d: number | null;
    correlation252d: number | null;
    rSquared: number | null;
    asOfDate: string | null;
  }[];
};

const COMMODITY_NAMES: Record<string, string> = {
  "BZ=F": "Brent Crude", "CL=F": "WTI Crude", "NG=F": "Natural Gas",
  "ALI=F": "Aluminium", "HG=F": "Copper", "GC=F": "Gold",
  "SI=F": "Silver", "SALMON": "Salmon",
  "RB=F": "Gasoline", "HO=F": "Heating Oil", "TTF=F": "TTF Gas",
  "MTF=F": "Coal", "ZS=F": "Soybeans", "ZW=F": "Wheat",
  "LBS=F": "Lumber", "TIO=F": "Iron Ore", "STEEL": "Steel",
};

const COMMODITY_UNITS: Record<string, string> = {
  "BZ=F": "USD/bbl", "CL=F": "USD/bbl", "NG=F": "USD/MMBtu",
  "ALI=F": "USD/t", "HG=F": "USD/lb", "GC=F": "USD/oz",
  "SI=F": "USD/oz", "SALMON": "NOK/kg", "RB=F": "USD/gal",
  "HO=F": "USD/gal", "TTF=F": "EUR/MWh", "MTF=F": "USD/t",
  "ZS=F": "USD/bu", "ZW=F": "USD/bu", "LBS=F": "USD/mbf",
  "TIO=F": "USD/t", "STEEL": "CNY/t",
};

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
function betaColor(v: number): string {
  if (v > 1.5) return "#22c55e";
  if (v > 0.5) return "#86efac";
  if (v > 0) return "rgba(255,255,255,0.7)";
  return "#ef4444";
}

const TIMEFRAMES = [
  { label: "1M", days: 30 },
  { label: "3M", days: 90 },
  { label: "6M", days: 180 },
  { label: "1Y", days: 365 },
  { label: "2Y", days: 730 },
  { label: "ALL", days: 0 },
];

export default function CommodityDetailPage({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = use(params);
  const decoded = decodeURIComponent(symbol).toUpperCase();
  const [data, setData] = useState<CommodityDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tf, setTf] = useState(365);
  const [showSMA, setShowSMA] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/commodities/${encodeURIComponent(decoded)}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setError(d.error);
        else setData(d);
        setLoading(false);
      })
      .catch((err) => { setError(err.message); setLoading(false); });
  }, [decoded]);

  const displayName = COMMODITY_NAMES[decoded] || decoded;
  const unit = COMMODITY_UNITS[decoded] || "";

  if (loading) return (
    <div style={{ minHeight: "100vh", background: "#0a0a0a", color: "rgba(255,255,255,0.4)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "monospace", fontSize: 13 }}>
      Loading {displayName}…
    </div>
  );
  if (error || !data) return (
    <div style={{ minHeight: "100vh", background: "#0a0a0a", color: "#ef4444", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "monospace", fontSize: 13 }}>
      {error || "No data"}
    </div>
  );

  // Filter history by timeframe
  const filteredHistory = tf === 0
    ? data.history
    : data.history.filter((r) => {
        const d = new Date(r.date);
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - tf);
        return d >= cutoff;
      });

  // Compute SMAs over filtered history
  const closes = filteredHistory.map((r) => r.close);
  const computeSMA = (n: number) => {
    return filteredHistory.map((_, i) => {
      if (i < n - 1) return null;
      const slice = closes.slice(i - n + 1, i + 1);
      return slice.reduce((a, b) => a + b, 0) / n;
    });
  };
  const sma20 = computeSMA(20);
  const sma50 = computeSMA(50);

  const chartData = filteredHistory.map((r, i) => ({
    date: new Date(r.date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" }),
    close: r.close,
    sma20: sma20[i],
    sma50: sma50[i],
    high: r.high,
    low: r.low,
    volume: r.volume,
  }));

  const priceRange = Math.max(...closes) - Math.min(...closes);
  const domain: [number | string, number | string] = [
    Math.min(...closes) - priceRange * 0.05,
    Math.max(...closes) + priceRange * 0.05,
  ];

  const isUp = (data.latest.dayReturnPct ?? 0) >= 0;
  const priceColor = isUp ? "#22c55e" : "#ef4444";

  return (
    <div style={{ minHeight: "100vh", background: "#0a0a0a", color: "#e6edf3", fontFamily: "monospace" }}>
      <PageNav crumbs={[{label:"Home",href:"/"},{label:"Commodities",href:"/commodities"},{label:displayName}]} />

      <div style={{ padding: "24px", maxWidth: 1200, margin: "0 auto" }}>
        {/* Hero */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginBottom: 4 }}>{decoded}</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 16, flexWrap: "wrap" }}>
            <div style={{ fontSize: 36, fontWeight: 800, color: priceColor }}>
              {data.latest.close.toLocaleString("en-US", { maximumFractionDigits: 2 })}
            </div>
            <div style={{ fontSize: 20, fontWeight: 700, color: priceColor }}>
              {fmtPct(data.latest.dayReturnPct)} {isUp ? "▲" : "▼"}
            </div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>
              as of {new Date(data.latest.date).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
            </div>
          </div>
        </div>

        {/* Stats Strip */}
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 24 }}>
          {[
            { label: "52W HIGH", value: data.stats.high52w?.toLocaleString("en-US", { maximumFractionDigits: 2 }), color: "#22c55e" },
            { label: "52W LOW", value: data.stats.low52w?.toLocaleString("en-US", { maximumFractionDigits: 2 }), color: "#ef4444" },
            { label: "SMA 20", value: fmt(data.stats.sma20), color: "#3b82f6" },
            { label: "SMA 50", value: fmt(data.stats.sma50), color: "#f59e0b" },
            { label: "SMA 200", value: fmt(data.stats.sma200), color: "#ef4444" },
            { label: "YTD", value: fmtPct(data.stats.ytdReturnPct), color: pctColor(data.stats.ytdReturnPct) },
          ].map(({ label, value, color }) => (
            <div key={label} style={{ background: "#161b22", border: "1px solid #30363d", borderRadius: 6, padding: "8px 14px" }}>
              <div style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", marginBottom: 2, letterSpacing: "0.06em" }}>{label}</div>
              <div style={{ fontSize: 13, fontWeight: 700, color }}>{value}</div>
            </div>
          ))}
        </div>

        {/* Price Chart */}
        <div style={{ background: "#161b22", border: "1px solid #30363d", borderRadius: 8, padding: 16, marginBottom: 20 }}>
          <div style={{ display: "flex", gap: 8, marginBottom: 12, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", textTransform: "uppercase", letterSpacing: "0.08em" }}>Price History</span>
            <div style={{ flex: 1 }} />
            {TIMEFRAMES.map(({ label, days }) => (
              <button key={label} onClick={() => setTf(days)} style={{
                background: tf === days ? "#3b82f6" : "#21262d",
                border: "1px solid #30363d", borderRadius: 4, padding: "3px 10px",
                color: tf === days ? "#fff" : "rgba(255,255,255,0.6)", fontSize: 10, cursor: "pointer", fontFamily: "monospace",
              }}>
                {label}
              </button>
            ))}
            <button onClick={() => setShowSMA((v) => !v)} style={{
              background: showSMA ? "#3b82f633" : "#21262d",
              border: "1px solid #30363d", borderRadius: 4, padding: "3px 10px",
              color: showSMA ? "#3b82f6" : "rgba(255,255,255,0.6)", fontSize: 10, cursor: "pointer", fontFamily: "monospace",
            }}>
              SMA
            </button>
          </div>

          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={chartData} margin={{ top: 8, right: 12, bottom: 8, left: 12 }}>
              <defs>
                <linearGradient id="priceGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={priceColor} stopOpacity={0.15} />
                  <stop offset="100%" stopColor={priceColor} stopOpacity={0.01} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#21262d" strokeDasharray="3 3" />
              <XAxis dataKey="date" tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 9 }}
                interval={Math.floor(chartData.length / 6)} />
              <YAxis domain={domain} tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 9 }}
                tickFormatter={(v) => v.toLocaleString("en-US", { maximumFractionDigits: 1 })} width={60} />
              <Tooltip
                contentStyle={{ background: "#0d1117", border: "1px solid #30363d", borderRadius: 6, fontSize: 11 }}
                labelStyle={{ color: "rgba(255,255,255,0.5)" }}
                formatter={(v: unknown) => [(v as number).toFixed(2), ""]}
              />
              <Area dataKey="close" fill="url(#priceGrad)" stroke={priceColor} strokeWidth={2} dot={false} name="Price" />
              {showSMA && chartData.some((d) => d.sma20 !== null) && (
                <Line dataKey="sma20" stroke="#3b82f6" strokeWidth={1.5} dot={false} strokeDasharray="4 2" name="SMA20" />
              )}
              {showSMA && chartData.some((d) => d.sma50 !== null) && (
                <Line dataKey="sma50" stroke="#f59e0b" strokeWidth={1.5} dot={false} strokeDasharray="4 2" name="SMA50" />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {/* Equity Sensitivity Table */}
        {data.sensitivities.length > 0 && (
          <div style={{ background: "#161b22", border: "1px solid #30363d", borderRadius: 8, padding: 16 }}>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.08em" }}>
              Equity Sensitivity to {displayName}
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid #30363d" }}>
                    {["Ticker", "Company", "Beta", "R²", "Corr 60D", "Corr 252D"].map((h) => (
                      <th key={h} style={{ padding: "8px 12px", fontSize: 9, color: "rgba(255,255,255,0.4)", textAlign: h === "Ticker" || h === "Company" ? "left" : "right", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.sensitivities.map((s) => (
                    <tr key={s.ticker} style={{ borderBottom: "1px solid #21262d" }}>
                      <td style={{ padding: "8px 12px" }}>
                        <Link href={`/stocks/${s.ticker}`} style={{ color: "#3b82f6", textDecoration: "none", fontWeight: 700, fontSize: 12 }}>
                          {s.ticker}
                        </Link>
                      </td>
                      <td style={{ padding: "8px 12px", fontSize: 11, color: "rgba(255,255,255,0.6)", maxWidth: 180 }}>
                        <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {s.stockName || "—"}
                        </div>
                        {s.sector && <div style={{ fontSize: 9, color: "rgba(255,255,255,0.3)" }}>{s.sector}</div>}
                      </td>
                      <td style={{ padding: "8px 12px", textAlign: "right", fontSize: 12, fontWeight: 700, color: betaColor(s.beta) }}>
                        {fmt(s.beta)}
                      </td>
                      <td style={{ padding: "8px 12px", textAlign: "right", fontSize: 12, color: "rgba(255,255,255,0.6)" }}>
                        {fmt(s.rSquared)}
                      </td>
                      <td style={{ padding: "8px 12px", textAlign: "right", fontSize: 12, color: pctColor(s.correlation60d) }}>
                        {fmt(s.correlation60d)}
                      </td>
                      <td style={{ padding: "8px 12px", textAlign: "right", fontSize: 12, color: pctColor(s.correlation252d) }}>
                        {fmt(s.correlation252d)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
