"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  ResponsiveContainer, Tooltip, RadarChart, Radar,
  PolarGrid, PolarAngleAxis, PolarRadiusAxis, Legend,
} from "recharts";

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

function fmtPct(v: number | null): string {
  if (v === null || isNaN(v)) return "—";
  return (v >= 0 ? "+" : "") + v.toFixed(2) + "%";
}
function pctColor(v: number | null): string {
  if (v === null) return "rgba(255,255,255,0.5)";
  return v >= 0 ? "#22c55e" : "#ef4444";
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
  return (
    <svg width={width} height={height} style={{ display: "block" }}>
      <defs>
        <linearGradient id={`sg-${color.replace("#", "")}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.2} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <polygon
        points={`0,${height} ${pts.join(" ")} ${width},${height}`}
        fill={`url(#sg-${color.replace("#", "")})`}
      />
      <polyline points={pts.join(" ")} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" />
    </svg>
  );
}

function SectorDetail({ s, expanded, onToggle }: {
  s: SectorData; expanded: boolean; onToggle: () => void;
}) {
  const driverPctColor = pctColor(s.commodityDriver?.dailyPct ?? null);

  return (
    <div style={{
      background: "#161b22",
      border: `1px solid ${expanded ? s.color + "60" : "#30363d"}`,
      borderLeft: `4px solid ${s.color}`,
      borderRadius: 8, marginBottom: 12,
      transition: "all 0.2s",
    }}>
      {/* Header */}
      <div
        onClick={onToggle}
        style={{ padding: "16px 20px", cursor: "pointer", display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}
      >
        <div style={{ flex: 1, minWidth: 180 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: s.color, fontFamily: "monospace" }}>{s.name}</div>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginTop: 2 }}>{s.stockCount} stocks</div>
        </div>

        {s.commodityDriver && (
          <div style={{ minWidth: 130 }}>
            <div style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", marginBottom: 2 }}>PRIMARY DRIVER</div>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#e6edf3" }}>{s.commodityDriver.name}</div>
            <div style={{ fontSize: 12, fontWeight: 700, color: driverPctColor }}>{fmtPct(s.commodityDriver.dailyPct)}</div>
          </div>
        )}

        <div style={{ display: "flex", gap: 12 }}>
          {[
            { label: "1D", val: s.performance.daily },
            { label: "1W", val: s.performance.weekly },
            { label: "1M", val: s.performance.monthly },
            { label: "YTD", val: s.performance.ytd },
          ].map(({ label, val }) => (
            <div key={label} style={{ textAlign: "center", minWidth: 45 }}>
              <div style={{ fontSize: 9, color: "rgba(255,255,255,0.4)" }}>{label}</div>
              <div style={{ fontSize: 12, fontWeight: 700, color: pctColor(val), fontFamily: "monospace" }}>{fmtPct(val)}</div>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          {s.bestPerformer && (
            <div style={{ background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.2)", borderRadius: 4, padding: "4px 10px", textAlign: "center" }}>
              <div style={{ fontSize: 9, color: "rgba(255,255,255,0.4)" }}>BEST</div>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#22c55e", fontFamily: "monospace" }}>{s.bestPerformer.ticker}</div>
              <div style={{ fontSize: 10, color: "#22c55e" }}>{fmtPct(s.bestPerformer.dailyPct)}</div>
            </div>
          )}
          {s.worstPerformer && (
            <div style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 4, padding: "4px 10px", textAlign: "center" }}>
              <div style={{ fontSize: 9, color: "rgba(255,255,255,0.4)" }}>WORST</div>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#ef4444", fontFamily: "monospace" }}>{s.worstPerformer.ticker}</div>
              <div style={{ fontSize: 10, color: "#ef4444" }}>{fmtPct(s.worstPerformer.dailyPct)}</div>
            </div>
          )}
        </div>

        <div style={{ fontSize: 12, color: "rgba(255,255,255,0.3)" }}>{expanded ? "▲" : "▼"}</div>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div style={{ padding: "0 20px 20px", borderTop: "1px solid #21262d" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 200px", gap: 20, paddingTop: 16 }}>
            {/* Stock table */}
            <div>
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.06em" }}>Stocks</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {s.tickers.map((t) => {
                  const stock = s.topStocks.find((st) => st.ticker === t);
                  const pct = stock?.dailyPct ?? null;
                  return (
                    <Link key={t} href={`/stocks/${t}`} style={{ textDecoration: "none" }}>
                      <div style={{
                        background: "#0d1117", border: `1px solid ${pctColor(pct)}22`,
                        borderRadius: 5, padding: "6px 10px", minWidth: 80,
                        transition: "all 0.15s",
                      }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: "#e6edf3", fontFamily: "monospace" }}>{t}</div>
                        {pct !== null && (
                          <div style={{ fontSize: 10, color: pctColor(pct), fontWeight: 700, fontFamily: "monospace" }}>
                            {fmtPct(pct)}
                          </div>
                        )}
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>

            {/* Commodity sparkline */}
            {s.commodityDriver?.sparkline30d && s.commodityDriver.sparkline30d.length > 2 && (
              <div>
                <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                  {s.commodityDriver.name} 30D
                </div>
                <Sparkline data={s.commodityDriver.sparkline30d} color={s.color} width={200} height={60} />
                {s.commodityDriver.price !== null && (
                  <div style={{ fontSize: 12, fontWeight: 700, color: pctColor(s.commodityDriver.dailyPct), fontFamily: "monospace", marginTop: 4 }}>
                    {s.commodityDriver.price.toLocaleString("en-US", { maximumFractionDigits: 2 })} · {fmtPct(s.commodityDriver.dailyPct)}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function SectorsPage() {
  const [sectors, setSectors] = useState<SectorData[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>("Energy");

  useEffect(() => {
    fetch("/api/sectors/overview")
      .then((r) => r.json())
      .then((d) => { setSectors(d.sectors || []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  // Performance bar chart data
  const perfData = ["1D", "1W", "1M", "YTD"].map((period) => {
    const obj: Record<string, string | number> = { period };
    sectors.forEach((s) => {
      const val = period === "1D" ? s.performance.daily :
        period === "1W" ? s.performance.weekly :
        period === "1M" ? s.performance.monthly : s.performance.ytd;
      obj[s.name] = val ?? 0;
    });
    return obj;
  });

  // Sector rotation bar (monthly)
  const rotationData = sectors.map((s) => ({
    name: s.name,
    value: s.performance.monthly ?? 0,
    color: s.color,
  })).sort((a, b) => b.value - a.value);

  return (
    <div style={{ minHeight: "100vh", background: "#0a0a0a", color: "#e6edf3", fontFamily: "monospace" }}>
      {/* Header */}
      <div style={{ borderBottom: "1px solid #21262d", padding: "12px 24px", display: "flex", alignItems: "center", gap: 16, background: "#0d1117" }}>
        <Link href="/" style={{ color: "rgba(255,255,255,0.5)", textDecoration: "none", fontSize: 12 }}>← Home</Link>
        <Link href="/commodities" style={{ color: "rgba(255,255,255,0.5)", textDecoration: "none", fontSize: 12 }}>Commodity Terminal</Link>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>SECTOR INTELLIGENCE</div>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)" }}>Energy · Seafood · Shipping · Materials</div>
        </div>
      </div>

      {loading ? (
        <div style={{ padding: 40, textAlign: "center", color: "rgba(255,255,255,0.4)", fontSize: 13 }}>Loading sector data…</div>
      ) : (
        <div style={{ padding: "24px", maxWidth: 1200, margin: "0 auto" }}>

          {/* Sector Rotation Chart */}
          <div style={{ background: "#161b22", border: "1px solid #30363d", borderRadius: 8, padding: 16, marginBottom: 20 }}>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.08em" }}>
              Sector Rotation — 1-Month Returns
            </div>
            <div style={{ display: "flex", gap: 12, alignItems: "flex-end", height: 80 }}>
              {rotationData.map((s) => {
                const maxVal = Math.max(...rotationData.map((r) => Math.abs(r.value)), 0.1);
                const barH = Math.abs(s.value) / maxVal * 60;
                const isUp = s.value >= 0;
                return (
                  <div key={s.name} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center" }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: pctColor(s.value), fontFamily: "monospace", marginBottom: 4 }}>
                      {fmtPct(s.value)}
                    </div>
                    <div style={{
                      width: "100%", height: barH,
                      background: s.color, borderRadius: isUp ? "4px 4px 0 0" : "0 0 4px 4px",
                      opacity: 0.85,
                    }} />
                    <div style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", marginTop: 4 }}>{s.name}</div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Multi-period comparison */}
          <div style={{ background: "#161b22", border: "1px solid #30363d", borderRadius: 8, padding: 16, marginBottom: 20 }}>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.08em" }}>
              Multi-Period Performance Comparison
            </div>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={perfData} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
                <CartesianGrid stroke="#21262d" strokeDasharray="3 3" />
                <XAxis dataKey="period" tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 10 }} />
                <YAxis tickFormatter={(v) => v.toFixed(1) + "%"} tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 10 }} />
                <Tooltip
                  contentStyle={{ background: "#0d1117", border: "1px solid #30363d", borderRadius: 6, fontSize: 11 }}
                  formatter={(v: unknown) => [fmtPct(v as number), ""]}
                />
                <Legend wrapperStyle={{ fontSize: 10, fontFamily: "monospace" }} />
                {sectors.map((s) => (
                  <Bar key={s.name} dataKey={s.name} fill={s.color} radius={[2, 2, 0, 0]} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Sector Summary Strip */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 12, marginBottom: 24 }}>
            {sectors.map((s) => (
              <div key={s.name} style={{
                background: "#161b22", border: `1px solid ${s.color}40`, borderLeft: `3px solid ${s.color}`,
                borderRadius: 8, padding: 14, textAlign: "center",
              }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: s.color, marginBottom: 6 }}>{s.name}</div>
                <div style={{ fontSize: 24, fontWeight: 800, color: pctColor(s.performance.daily), fontFamily: "monospace" }}>
                  {fmtPct(s.performance.daily)}
                </div>
                <div style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", marginTop: 2 }}>1D avg return</div>
                {s.avgBeta !== null && (
                  <div style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", marginTop: 6 }}>
                    avg β {s.avgBeta.toFixed(2)}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Sector Detail Cards */}
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.08em" }}>
            Sector Detail
          </div>
          {sectors.map((s) => (
            <SectorDetail
              key={s.name}
              s={s}
              expanded={expanded === s.name}
              onToggle={() => setExpanded(expanded === s.name ? null : s.name)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
