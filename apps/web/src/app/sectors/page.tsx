"use client";

import Link from "next/link";
import { useEffect, useState, useMemo } from "react";
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  Legend, ResponsiveContainer, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, Cell, AreaChart, Area,
} from "recharts";

interface SectorStock {
  ticker: string;
  name: string;
  price: number;
  dailyPct: number | null;
  weeklyPct: number | null;
  monthlyPct: number | null;
  ytdPct: number | null;
}

interface SectorData {
  name: string;
  color: string;
  tickers: string[];
  stocks: SectorStock[];
  performance: { daily: number | null; weekly: number | null; monthly: number | null; ytd: number | null };
  bestPerformer: { ticker: string; name: string; dailyPct: number | null } | null;
  worstPerformer: { ticker: string; name: string; dailyPct: number | null } | null;
  commodityDriver: { symbol: string; name: string; price: number; dailyPct: number | null; sparkline30d: number[] } | null;
  avgBeta: number | null;
  sectorSparkline30d: number[];
}

interface CommodityData {
  symbol: string;
  name: string;
  category: string;
  sensitivities: { ticker: string; beta: number }[];
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

function sparklineSvg(data: number[], w = 80, h = 24) {
  if (!data || data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const points = data.map((v, i) =>
    `${(i / (data.length - 1)) * w},${h - ((v - min) / range) * (h - 4) - 2}`
  ).join(" ");
  const color = data[data.length - 1] >= data[0] ? "#10b981" : "#ef4444";
  return (
    <svg width={w} height={h} style={{ display: "block" }}>
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function SectorsPage() {
  const [sectors, setSectors] = useState<SectorData[]>([]);
  const [commodities, setCommodities] = useState<CommodityData[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedSector, setExpandedSector] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const [secRes, comRes] = await Promise.all([
          fetch("/api/sectors/overview"),
          fetch("/api/commodities?days=30"),
        ]);
        if (secRes.ok) setSectors((await secRes.json()).sectors || []);
        if (comRes.ok) setCommodities((await comRes.json()).commodities || []);
      } catch (e) {
        console.error("Failed to load sectors", e);
      }
      setLoading(false);
    }
    load();
  }, []);

  // Radar data
  const radarData = useMemo(() => {
    if (commodities.length === 0 || sectors.length === 0) return [];
    return commodities
      .filter(c => c.sensitivities.length > 0)
      .map(c => {
        const entry: Record<string, unknown> = { commodity: c.name };
        for (const sec of sectors) {
          const betas = c.sensitivities
            .filter(s => sec.tickers.includes(s.ticker))
            .map(s => Math.abs(s.beta));
          entry[sec.name] = betas.length > 0
            ? Math.round(betas.reduce((a, b) => a + b, 0) / betas.length * 100) / 100
            : 0;
        }
        return entry;
      });
  }, [commodities, sectors]);

  // Rotation bar data
  const rotationData = useMemo(() => {
    return sectors.map(s => ({
      name: s.name,
      daily: s.performance.daily || 0,
      weekly: s.performance.weekly || 0,
      monthly: s.performance.monthly || 0,
      ytd: s.performance.ytd || 0,
      color: s.color,
    }));
  }, [sectors]);

  if (loading) {
    return (
      <div style={{ fontFamily: "monospace", background: "#0a0a0a", minHeight: "100vh", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}>
        Loading sector intelligence...
      </div>
    );
  }

  return (
    <div style={{ fontFamily: "monospace", background: "#0a0a0a", minHeight: "100vh", color: "#fff" }}>
      {/* Header */}
      <div style={{ padding: "16px 24px", borderBottom: "1px solid #30363d", display: "flex", alignItems: "center", gap: 16 }}>
        <Link href="/commodities" style={{ color: "rgba(255,255,255,0.5)", textDecoration: "none", fontSize: 12 }}>← Commodities</Link>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Sector Intelligence</h1>
        <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>{sectors.length} sectors · {sectors.reduce((s, sec) => s + sec.tickers.length, 0)} stocks</span>
      </div>

      <div style={{ padding: "20px 24px", maxWidth: 1400, margin: "0 auto", display: "flex", flexDirection: "column", gap: 24 }}>
        {/* Sector Rotation */}
        <div style={{ background: "#161b22", border: "1px solid #30363d", borderRadius: 8, padding: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.6)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 12 }}>
            SECTOR ROTATION — PERFORMANCE COMPARISON
          </div>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={rotationData} margin={{ top: 10, right: 20, bottom: 10, left: 20 }}>
              <CartesianGrid stroke="#30363d" strokeOpacity={0.3} strokeDasharray="3 3" />
              <XAxis dataKey="name" tick={{ fontSize: 10, fill: "rgba(255,255,255,0.6)" }} />
              <YAxis tick={{ fontSize: 10, fill: "rgba(255,255,255,0.5)" }} tickFormatter={(v: any) => `${(v ?? 0).toFixed(1)}%`} />
              <Tooltip contentStyle={{ background: "#161b22", border: "1px solid #30363d", borderRadius: 4, fontFamily: "monospace", fontSize: 10 }}
                formatter={((v: any) => `${(v ?? 0).toFixed(2)}%`) as any} />
              <Bar dataKey="daily" name="Daily" radius={[3, 3, 0, 0]}>
                {rotationData.map((e, i) => <Cell key={i} fill={e.color} fillOpacity={0.9} />)}
              </Bar>
              <Bar dataKey="weekly" name="Weekly" radius={[3, 3, 0, 0]}>
                {rotationData.map((e, i) => <Cell key={i} fill={e.color} fillOpacity={0.6} />)}
              </Bar>
              <Bar dataKey="monthly" name="Monthly" radius={[3, 3, 0, 0]}>
                {rotationData.map((e, i) => <Cell key={i} fill={e.color} fillOpacity={0.35} />)}
              </Bar>
              <Legend wrapperStyle={{ fontSize: 10, fontFamily: "monospace" }}
                formatter={(v: string) => <span style={{ color: "rgba(255,255,255,0.5)" }}>{v}</span>} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Radar */}
        {radarData.length > 0 && (
          <div style={{ background: "#161b22", border: "1px solid #30363d", borderRadius: 8, padding: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.6)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 12 }}>
              COMMODITY EXPOSURE RADAR — AVG |BETA| PER SECTOR
            </div>
            <ResponsiveContainer width="100%" height={420}>
              <RadarChart data={radarData}>
                <PolarGrid stroke="#30363d" strokeOpacity={0.5} />
                <PolarAngleAxis dataKey="commodity" tick={{ fontSize: 10, fill: "rgba(255,255,255,0.6)" }} />
                <PolarRadiusAxis tick={{ fontSize: 9, fill: "rgba(255,255,255,0.3)" }} />
                {sectors.map(s => (
                  <Radar key={s.name} name={s.name} dataKey={s.name}
                    stroke={s.color} fill={s.color} fillOpacity={0.15} strokeWidth={2} />
                ))}
                <Legend wrapperStyle={{ fontSize: 10, fontFamily: "monospace" }}
                  formatter={(v: string) => <span style={{ color: "rgba(255,255,255,0.7)" }}>{v}</span>} />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Sector Cards */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 16 }}>
          {sectors.map(s => {
            const isExpanded = expandedSector === s.name;
            return (
              <div key={s.name} style={{
                background: "#161b22", border: "1px solid #30363d", borderRadius: 8,
                borderLeft: `4px solid ${s.color}`, overflow: "hidden",
              }}>
                {/* Card header */}
                <div
                  onClick={() => setExpandedSector(isExpanded ? null : s.name)}
                  style={{ padding: 16, cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 18, fontWeight: 700 }}>{s.name}</span>
                    <span style={{ fontSize: 10, color: "rgba(255,255,255,0.4)" }}>{s.tickers.length} stocks</span>
                    {s.commodityDriver && (
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.5)" }}>{s.commodityDriver.name}:</span>
                        <span style={{ fontSize: 11, fontWeight: 700 }}>{fmtPrice(s.commodityDriver.price)}</span>
                        <span style={{ fontSize: 10, fontWeight: 700, color: pctColor(s.commodityDriver.dailyPct) }}>
                          {fmtPct(s.commodityDriver.dailyPct, 1)}
                        </span>
                        {sparklineSvg(s.commodityDriver.sparkline30d || [], 60, 18)}
                      </div>
                    )}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                    <div style={{ display: "flex", gap: 12 }}>
                      {[
                        { label: "D", val: s.performance.daily },
                        { label: "W", val: s.performance.weekly },
                        { label: "M", val: s.performance.monthly },
                        { label: "YTD", val: s.performance.ytd },
                      ].map(m => (
                        <div key={m.label} style={{ textAlign: "center" }}>
                          <div style={{ fontSize: 8, color: "rgba(255,255,255,0.35)" }}>{m.label}</div>
                          <div style={{ fontSize: 11, fontWeight: 700, color: pctColor(m.val) }}>{fmtPct(m.val, 1)}</div>
                        </div>
                      ))}
                    </div>
                    <span style={{ fontSize: 14, color: "rgba(255,255,255,0.4)" }}>{isExpanded ? "▲" : "▼"}</span>
                  </div>
                </div>

                {/* Expanded detail */}
                {isExpanded && (
                  <div style={{ padding: "0 16px 16px", borderTop: "1px solid #21262d" }}>
                    {/* Best/Worst */}
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, margin: "12px 0" }}>
                      {s.bestPerformer && (
                        <div style={{ background: "rgba(16,185,129,0.08)", borderRadius: 6, padding: 12 }}>
                          <div style={{ fontSize: 9, color: "#10b981", textTransform: "uppercase", fontWeight: 600 }}>BEST PERFORMER</div>
                          <div style={{ fontSize: 16, fontWeight: 800, marginTop: 4 }}>{s.bestPerformer.ticker}</div>
                          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.5)" }}>{s.bestPerformer.name}</div>
                          <div style={{ fontSize: 14, fontWeight: 700, color: "#10b981", marginTop: 4 }}>{fmtPct(s.bestPerformer.dailyPct)}</div>
                        </div>
                      )}
                      {s.worstPerformer && (
                        <div style={{ background: "rgba(239,68,68,0.08)", borderRadius: 6, padding: 12 }}>
                          <div style={{ fontSize: 9, color: "#ef4444", textTransform: "uppercase", fontWeight: 600 }}>WORST PERFORMER</div>
                          <div style={{ fontSize: 16, fontWeight: 800, marginTop: 4 }}>{s.worstPerformer.ticker}</div>
                          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.5)" }}>{s.worstPerformer.name}</div>
                          <div style={{ fontSize: 14, fontWeight: 700, color: "#ef4444", marginTop: 4 }}>{fmtPct(s.worstPerformer.dailyPct)}</div>
                        </div>
                      )}
                    </div>
                    {/* Sector sparkline */}
                    {s.sectorSparkline30d?.length > 2 && (
                      <div style={{ marginBottom: 12 }}>
                        <div style={{ fontSize: 9, fontWeight: 600, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", marginBottom: 6 }}>
                          30-DAY SECTOR INDEX (EQUAL-WEIGHT)
                        </div>
                        <ResponsiveContainer width="100%" height={120}>
                          <AreaChart data={s.sectorSparkline30d.map((v, i) => ({ idx: i, val: v }))}>
                            <Area type="monotone" dataKey="val" stroke={s.color} fill={s.color} fillOpacity={0.1} strokeWidth={1.5} dot={false} />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                    )}
                    {/* Stock table */}
                    <div style={{ fontSize: 9, fontWeight: 600, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", marginBottom: 6 }}>
                      ALL HOLDINGS
                    </div>
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                      <thead>
                        <tr style={{ borderBottom: "1px solid #30363d" }}>
                          {["Ticker", "Company", "Price", "Day %", "Week %", "Month %", "YTD %"].map(h => (
                            <th key={h} style={{
                              padding: "6px 10px", fontSize: 9, fontWeight: 600, color: "rgba(255,255,255,0.5)",
                              textAlign: h === "Ticker" || h === "Company" ? "left" : "right",
                              fontFamily: "monospace", textTransform: "uppercase", letterSpacing: "0.05em",
                            }}>
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {s.stocks.map(st => (
                          <tr key={st.ticker} style={{ borderBottom: "1px solid #21262d" }}
                            onMouseEnter={e => (e.currentTarget.style.background = "rgba(59,130,246,0.08)")}
                            onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                            <td style={{ padding: "6px 10px", fontSize: 11, fontWeight: 700 }}>
                              <Link href={`/stocks/${st.ticker}`} style={{ color: "#3b82f6", textDecoration: "none" }}>{st.ticker}</Link>
                            </td>
                            <td style={{ padding: "6px 10px", fontSize: 10, color: "rgba(255,255,255,0.5)" }}>{st.name}</td>
                            <td style={{ padding: "6px 10px", fontSize: 10, textAlign: "right" }}>{fmtPrice(st.price)}</td>
                            <td style={{ padding: "6px 10px", fontSize: 10, textAlign: "right", fontWeight: 600, color: pctColor(st.dailyPct) }}>{fmtPct(st.dailyPct, 1)}</td>
                            <td style={{ padding: "6px 10px", fontSize: 10, textAlign: "right", color: pctColor(st.weeklyPct) }}>{fmtPct(st.weeklyPct, 1)}</td>
                            <td style={{ padding: "6px 10px", fontSize: 10, textAlign: "right", color: pctColor(st.monthlyPct) }}>{fmtPct(st.monthlyPct, 1)}</td>
                            <td style={{ padding: "6px 10px", fontSize: 10, textAlign: "right", color: pctColor(st.ytdPct) }}>{fmtPct(st.ytdPct, 1)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {s.avgBeta !== null && (
                      <div style={{ marginTop: 8, fontSize: 9, color: "rgba(255,255,255,0.35)" }}>
                        Average commodity beta: {s.avgBeta.toFixed(3)}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
