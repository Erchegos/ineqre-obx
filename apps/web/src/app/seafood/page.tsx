"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import SalmonPriceChart from "@/components/SalmonPriceChart";
import LiceChart from "@/components/LiceChart";
import ProductionAreaMap from "@/components/ProductionAreaMap";
import "leaflet/dist/leaflet.css";

/* ─── Types ────────────────────────────────────────────────────── */

type Overview = {
  salmonPrice: { price: number; date: string; currency: string; changePct: number | null } | null;
  industryAvgLice: number | null;
  liceThreshold: number;
  trafficLights: { green: number; yellow: number; red: number };
  activeDiseases: number;
  sparkline: Array<{ date: string; price: number }>;
};

type SalmonData = {
  history: Array<{ date: string; price: number }>;
  stats: { latest: number; high52w: number; low52w: number; avg: number; changePct: number };
};

type LiceWeekly = { year: number; week: number; avgLice: number | null; avgTemp: number | null; reportCount: number; aboveThreshold: number };
type LiceData = { weekly: LiceWeekly[]; threshold: number };

type ProductionArea = {
  areaNumber: number; name: string; trafficLight: string; capacityChangePct: number | null;
  centerLat: number; centerLng: number; localityCount: number; avgLice: number | null; notes: string | null;
};

type Locality = {
  localityId: number; name: string; companyName: string | null; ticker: string | null;
  lat: number; lng: number; latestLice: number | null; productionArea: number;
};

type Company = {
  ticker: string; name: string; price: number | null;
  change1d: number | null; change1w: number | null; change1m: number | null;
  activeSites: number | null; avgLice4w: number | null; pctAboveThreshold: number | null;
  treatmentRate: number | null; riskScore: number | null; productionAreas: number[];
};

type DiseaseOutbreak = {
  localityId: number; localityName: string; ticker: string | null; area: number | null;
  areaName: string | null; disease: string; weeksActive: number;
  latestWeek: string; isActive: boolean;
};

/* ─── Helpers ──────────────────────────────────────────────────── */

function fmtPct(v: number | null | undefined): string {
  if (v == null) return "\u2014";
  return `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
}

function fmtPrice(v: number | null): string {
  if (v == null) return "\u2014";
  return v >= 100 ? v.toFixed(0) : v.toFixed(2);
}

function getLiceColor(v: number | null): string {
  if (v == null) return "#555";
  if (v < 0.2) return "#22c55e";
  if (v < 0.5) return "#f59e0b";
  return "#ef4444";
}

function getRiskColor(v: number | null): string {
  if (v == null) return "#555";
  if (v < 25) return "#22c55e";
  if (v < 40) return "#f59e0b";
  return "#ef4444";
}

const TL_C: Record<string, string> = { green: "#22c55e", yellow: "#f59e0b", red: "#ef4444" };

/* ─── Page ─────────────────────────────────────────────────────── */

export default function SeafoodPage() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [salmonData, setSalmonData] = useState<SalmonData | null>(null);
  const [liceData, setLiceData] = useState<LiceData | null>(null);
  const [areas, setAreas] = useState<ProductionArea[]>([]);
  const [localities, setLocalities] = useState<Locality[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [diseases, setDiseases] = useState<DiseaseOutbreak[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"overview" | "map" | "areas">("overview");

  useEffect(() => {
    const sf = async (url: string) => {
      try { const r = await fetch(url); return r.ok ? r.json() : null; }
      catch { return null; }
    };
    async function load() {
      try {
        const [ov, sal, lice, ar, loc, co, dis] = await Promise.all([
          sf("/api/seafood/overview"), sf("/api/seafood/salmon-price?days=365"),
          sf("/api/seafood/lice?weeks=26"), sf("/api/seafood/production-areas"),
          sf("/api/seafood/localities"), sf("/api/seafood/company-exposure"),
          sf("/api/seafood/diseases"),
        ]);
        if (ov) setOverview(ov);
        if (sal) setSalmonData(sal);
        if (lice) setLiceData(lice);
        setAreas(ar?.areas || []);
        setLocalities(loc?.localities || []);
        setCompanies(co?.companies || []);
        setDiseases(dis?.outbreaks || []);
      } catch (err) {
        console.error("Seafood load error:", err);
        setError(String(err));
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const trafficLights: Record<number, string> = {};
  for (const a of areas) trafficLights[a.areaNumber] = a.trafficLight;

  const alerts = buildAlerts(overview, companies, diseases);
  const aboveCount = companies.filter(c => (c.avgLice4w ?? 0) > 0.5).length;
  const redAreas = overview?.trafficLights?.red || 0;
  const sortedCompanies = [...companies].sort((a, b) => (b.riskScore ?? 0) - (a.riskScore ?? 0));

  /* ─── Styles ─────────────────────────────────────────────────── */

  const S = {
    page: { minHeight: "100vh", background: "#0a0a0a", color: "#e5e5e5", fontFamily: "'Geist Mono','SF Mono','Consolas',monospace", fontSize: 12 } as React.CSSProperties,
    container: { maxWidth: 1600, margin: "0 auto", padding: "0 12px" } as React.CSSProperties,
    header: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid #222" } as React.CSSProperties,
    title: { fontSize: 13, fontWeight: 700, letterSpacing: "0.08em", color: "#f97316" } as React.CSSProperties,
    badge: (bg: string, fg = "#fff") => ({ fontSize: 9, fontWeight: 700, padding: "1px 5px", borderRadius: 2, background: bg, color: fg, letterSpacing: "0.04em" }) as React.CSSProperties,
    section: { fontSize: 9, fontWeight: 700, color: "#666", letterSpacing: "0.08em", textTransform: "uppercase" as const, padding: "8px 10px 4px", borderBottom: "1px solid #1a1a1a" } as React.CSSProperties,
    panel: { background: "#0d0d0d", borderLeft: "1px solid #222" } as React.CSSProperties,
    tabBtn: (active: boolean) => ({ padding: "2px 7px", borderRadius: 2, border: `1px solid ${active ? "#f97316" : "#333"}`, background: active ? "#f97316" : "transparent", color: active ? "#000" : "#888", fontFamily: "inherit", fontSize: 9, fontWeight: 700, cursor: "pointer", letterSpacing: "0.04em" }) as React.CSSProperties,
  };

  if (loading) {
    return (<main style={S.page}><div style={S.container}><div style={S.header}><span style={S.title}>SEAFOOD INTELLIGENCE</span></div><div style={{ padding: "40px 0", textAlign: "center", color: "#555" }}>Loading...</div></div></main>);
  }

  if (error) {
    return (<main style={S.page}><div style={S.container}><div style={S.header}><span style={S.title}>SEAFOOD INTELLIGENCE</span></div><div style={{ padding: "40px 0", textAlign: "center", color: "#ef4444" }}>Error: {error}</div></div></main>);
  }

  return (
    <>
      <style>{`
        .sf-row:hover { background: #151515 !important; }
        @media (max-width: 1000px) { .sf-grid { grid-template-columns: 1fr !important; } .sf-right { display: none !important; } }
      `}</style>
      <main style={S.page}>
        <div style={S.container}>

          {/* ─── Header Bar ─────────────────────────────────── */}
          <div style={S.header}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <Link href="/" style={{ fontSize: 10, color: "#666", textDecoration: "none" }}>HOME</Link>
              <span style={{ color: "#333" }}>/</span>
              <span style={S.title}>SEAFOOD INTELLIGENCE</span>
              {aboveCount > 0 && <span style={S.badge("#ef4444")}>{aboveCount} ABOVE THRESHOLD</span>}
              {redAreas > 0 && <span style={S.badge("#ef4444")}>{redAreas} RED AREAS</span>}
              {diseases.filter(d => d.isActive).length > 0 && (
                <span style={S.badge("#f97316")}>{diseases.filter(d => d.isActive).length} DISEASE</span>
              )}
              <span style={{ ...S.badge("#1a1a1a"), color: "#888", border: "1px solid #333" }}>
                {companies.length} COMPANIES
              </span>
            </div>
            <div style={{ display: "flex", gap: 12, fontSize: 10, alignItems: "center" }}>
              <span style={{ color: "#888" }}>SALMON</span>
              <span style={{ color: "#f97316", fontWeight: 600 }}>
                {overview?.salmonPrice ? `NOK${overview.salmonPrice.price.toFixed(2)}` : "\u2014"}
              </span>
              <span style={{ color: (overview?.salmonPrice?.changePct ?? 0) >= 0 ? "#22c55e" : "#ef4444", fontWeight: 600 }}>
                {fmtPct(overview?.salmonPrice?.changePct)}
              </span>
              <span style={{ color: "#333" }}>|</span>
              <span style={{ color: "#888" }}>LICE</span>
              <span style={{ color: getLiceColor(overview?.industryAvgLice ?? null), fontWeight: 600 }}>
                {overview?.industryAvgLice?.toFixed(3) ?? "\u2014"}
              </span>
              <span style={{ color: "#333" }}>|</span>
              <span style={{ color: "#888" }}>TRAFFIC</span>
              <span style={{ color: "#22c55e", fontWeight: 600 }}>{overview?.trafficLights?.green || 0}</span>
              <span style={{ color: "#f59e0b", fontWeight: 600 }}>{overview?.trafficLights?.yellow || 0}</span>
              <span style={{ color: "#ef4444", fontWeight: 600 }}>{overview?.trafficLights?.red || 0}</span>
            </div>
          </div>

          {/* ─── Tab Bar ────────────────────────────────────── */}
          <div style={{ display: "flex", gap: 6, padding: "6px 8px", background: "#111", borderBottom: "1px solid #222", alignItems: "center" }}>
            {(["overview", "map", "areas"] as const).map(t => (
              <button key={t} style={S.tabBtn(tab === t)} onClick={() => setTab(t)}>
                {t.toUpperCase()}
              </button>
            ))}
          </div>

          {/* ─── Main Grid ──────────────────────────────────── */}
          <div className="sf-grid" style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 0, marginTop: 1 }}>

            {/* ─── Left Panel ─────────────────────────────── */}
            <div>
              {tab === "overview" && (
                <>
                  {/* Charts Row */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", borderBottom: "1px solid #222" }}>
                    <div style={{ padding: 12, borderRight: "1px solid #222" }}>
                      <div style={S.section}>SALMON SPOT PRICE</div>
                      <SalmonPriceChart data={salmonData?.history || []} stats={salmonData?.stats} />
                    </div>
                    <div style={{ padding: 12 }}>
                      <div style={S.section}>INDUSTRY LICE LEVEL</div>
                      <LiceChart data={liceData?.weekly || []} threshold={liceData?.threshold || 0.5} />
                    </div>
                  </div>

                  {/* Company Table */}
                  <div>
                    <div style={S.section}>COMPANY EXPOSURE MATRIX</div>
                    <div style={{ display: "grid", gridTemplateColumns: "3px 1fr 64px 52px 52px 52px 56px 50px 56px 44px", padding: "4px 8px", fontSize: 9, fontWeight: 700, color: "#666", textTransform: "uppercase", letterSpacing: "0.06em", background: "#111", borderBottom: "1px solid #222" }}>
                      <div />
                      <div>COMPANY</div>
                      <div style={{ textAlign: "right" }}>PRICE</div>
                      <div style={{ textAlign: "right" }}>1D</div>
                      <div style={{ textAlign: "right" }}>1W</div>
                      <div style={{ textAlign: "right" }}>1M</div>
                      <div style={{ textAlign: "right" }}>LICE</div>
                      <div style={{ textAlign: "right" }}>%ABV</div>
                      <div style={{ textAlign: "center" }}>AREAS</div>
                      <div style={{ textAlign: "right" }}>RISK</div>
                    </div>
                    {sortedCompanies.map(co => (
                      <div key={co.ticker} className="sf-row" style={{ display: "grid", gridTemplateColumns: "3px 1fr 64px 52px 52px 52px 56px 50px 56px 44px", padding: "5px 8px", borderBottom: "1px solid #1a1a1a", alignItems: "center", cursor: "pointer", transition: "background 0.08s" }}>
                        <div style={{ width: 3, minHeight: 16, background: getRiskColor(co.riskScore), borderRadius: 1 }} />
                        <div>
                          <Link href={`/stocks/${co.ticker}`} style={{ color: "#58a6ff", textDecoration: "none", fontWeight: 600 }}>{co.ticker}</Link>
                          <span style={{ color: "#666", marginLeft: 6, fontSize: 10 }}>{co.name?.replace(/\s*ASA\s*$/i, "")}</span>
                        </div>
                        <div style={{ textAlign: "right", fontWeight: 600 }}>{fmtPrice(co.price)}</div>
                        <div style={{ textAlign: "right", color: (co.change1d ?? 0) >= 0 ? "#22c55e" : "#ef4444" }}>{fmtPct(co.change1d)}</div>
                        <div style={{ textAlign: "right", color: (co.change1w ?? 0) >= 0 ? "#22c55e" : "#ef4444" }}>{fmtPct(co.change1w)}</div>
                        <div style={{ textAlign: "right", color: (co.change1m ?? 0) >= 0 ? "#22c55e" : "#ef4444" }}>{fmtPct(co.change1m)}</div>
                        <div style={{ textAlign: "right", color: getLiceColor(co.avgLice4w), fontWeight: 600 }}>{co.avgLice4w?.toFixed(3) ?? "\u2014"}</div>
                        <div style={{ textAlign: "right", color: (co.pctAboveThreshold ?? 0) > 10 ? "#ef4444" : "#888" }}>{co.pctAboveThreshold != null ? `${co.pctAboveThreshold.toFixed(0)}%` : "\u2014"}</div>
                        <div style={{ display: "flex", gap: 2, justifyContent: "center" }}>
                          {co.productionAreas.map(a => (
                            <div key={a} title={`Area ${a}`} style={{ width: 7, height: 7, borderRadius: "50%", background: TL_C[trafficLights[a]] || "#333" }} />
                          ))}
                        </div>
                        <div style={{ textAlign: "right", color: getRiskColor(co.riskScore), fontWeight: 700, fontSize: 13 }}>{co.riskScore?.toFixed(0) ?? "\u2014"}</div>
                      </div>
                    ))}
                  </div>

                  {/* Map */}
                  <div style={{ borderBottom: "1px solid #222" }}>
                    <div style={S.section}>COASTAL MAP</div>
                    <div style={{ height: 460 }}>
                      <ProductionAreaMap areas={areas} localities={localities} />
                    </div>
                  </div>

                  {/* Disease Outbreaks */}
                  <div>
                    <div style={S.section}>DISEASE OUTBREAKS (PD / ILA)</div>
                    {diseases.length === 0 ? (
                      <div style={{ padding: "16px 10px", color: "#555", fontSize: 11 }}>No active disease outbreaks detected in current reporting period.</div>
                    ) : (
                      <>
                        <div style={{ display: "grid", gridTemplateColumns: "3px 1fr 100px 60px 60px 60px 52px", padding: "4px 8px", fontSize: 9, fontWeight: 700, color: "#666", textTransform: "uppercase", letterSpacing: "0.06em", background: "#111", borderBottom: "1px solid #222" }}>
                          <div />
                          <div>LOCALITY</div>
                          <div>DISEASE</div>
                          <div>COMPANY</div>
                          <div style={{ textAlign: "right" }}>AREA</div>
                          <div style={{ textAlign: "right" }}>WEEKS</div>
                          <div style={{ textAlign: "center" }}>STATUS</div>
                        </div>
                        {diseases.slice(0, 30).map((d, i) => (
                          <div key={i} className="sf-row" style={{ display: "grid", gridTemplateColumns: "3px 1fr 100px 60px 60px 60px 52px", padding: "5px 8px", borderBottom: "1px solid #1a1a1a", alignItems: "center", transition: "background 0.08s" }}>
                            <div style={{ width: 3, minHeight: 14, background: d.disease === "ILA" ? "#ef4444" : "#f97316", borderRadius: 1 }} />
                            <div style={{ fontSize: 11 }}>{d.localityName}</div>
                            <div><span style={{ ...S.badge(d.disease === "ILA" ? "#ef4444" : "#f97316"), fontSize: 8 }}>{d.disease}</span></div>
                            <div>{d.ticker ? <Link href={`/stocks/${d.ticker}`} style={{ color: "#58a6ff", textDecoration: "none", fontSize: 10 }}>{d.ticker}</Link> : <span style={{ color: "#555" }}>{"\u2014"}</span>}</div>
                            <div style={{ textAlign: "right", color: "#888" }}>{d.area ?? "\u2014"}</div>
                            <div style={{ textAlign: "right", fontWeight: 600 }}>{d.weeksActive}</div>
                            <div style={{ textAlign: "center" }}>
                              <span style={{ ...S.badge(d.isActive ? "#ef4444" : "#333"), fontSize: 8 }}>{d.isActive ? "ACTIVE" : "RESOLVED"}</span>
                            </div>
                          </div>
                        ))}
                      </>
                    )}
                  </div>

                  {/* Alerts Feed */}
                  <div>
                    <div style={S.section}>INTELLIGENCE ALERTS</div>
                    {alerts.length === 0 ? (
                      <div style={{ padding: "16px 10px", color: "#555", fontSize: 11 }}>No active alerts.</div>
                    ) : (
                      alerts.map((a, i) => {
                        const sevColor = a.severity === "high" ? "#ef4444" : a.severity === "medium" ? "#f59e0b" : "#3b82f6";
                        return (
                          <div key={i} className="sf-row" style={{ display: "flex", gap: 8, padding: "5px 8px", borderBottom: "1px solid #1a1a1a", alignItems: "start", transition: "background 0.08s" }}>
                            <div style={{ width: 3, minHeight: 14, background: sevColor, borderRadius: 1, marginTop: 2, flexShrink: 0 }} />
                            <div style={{ flex: 1 }}>
                              <span style={{ color: sevColor, fontWeight: 600, fontSize: 11 }}>{a.message}</span>
                              {a.detail && <span style={{ color: "#666", fontSize: 10, marginLeft: 8 }}>{a.detail}</span>}
                            </div>
                            <span style={{ ...S.badge(sevColor === "#ef4444" ? "#ef4444" : sevColor === "#f59e0b" ? "#f97316" : "#333"), fontSize: 8, flexShrink: 0 }}>
                              {a.severity.toUpperCase()}
                            </span>
                          </div>
                        );
                      })
                    )}
                  </div>
                </>
              )}

              {tab === "map" && (
                <div style={{ padding: 0 }}>
                  <div style={S.section}>PRODUCTION AREAS & LOCALITIES ({localities.length} sites)</div>
                  <div style={{ height: "calc(100vh - 130px)" }}>
                    <ProductionAreaMap areas={areas} localities={localities} />
                  </div>
                </div>
              )}

              {tab === "areas" && (
                <div>
                  <div style={S.section}>PRODUCTION AREA DETAIL</div>
                  <div style={{ display: "grid", gridTemplateColumns: "3px 40px 1fr 70px 70px 70px 60px", padding: "4px 8px", fontSize: 9, fontWeight: 700, color: "#666", textTransform: "uppercase", letterSpacing: "0.06em", background: "#111", borderBottom: "1px solid #222" }}>
                    <div />
                    <div>AREA</div>
                    <div>NAME</div>
                    <div style={{ textAlign: "center" }}>TRAFFIC</div>
                    <div style={{ textAlign: "right" }}>AVG LICE</div>
                    <div style={{ textAlign: "right" }}>SITES</div>
                    <div style={{ textAlign: "right" }}>CAP%</div>
                  </div>
                  {areas.map(a => (
                    <div key={a.areaNumber} className="sf-row" style={{ display: "grid", gridTemplateColumns: "3px 40px 1fr 70px 70px 70px 60px", padding: "5px 8px", borderBottom: "1px solid #1a1a1a", alignItems: "center", transition: "background 0.08s" }}>
                      <div style={{ width: 3, minHeight: 14, background: TL_C[a.trafficLight] || "#555", borderRadius: 1 }} />
                      <div style={{ fontWeight: 600 }}>{a.areaNumber}</div>
                      <div style={{ fontSize: 11 }}>{a.name}</div>
                      <div style={{ textAlign: "center" }}><span style={{ ...S.badge(TL_C[a.trafficLight] || "#555"), fontSize: 8 }}>{a.trafficLight?.toUpperCase()}</span></div>
                      <div style={{ textAlign: "right", color: getLiceColor(a.avgLice), fontWeight: 600 }}>{a.avgLice?.toFixed(3) ?? "\u2014"}</div>
                      <div style={{ textAlign: "right", color: "#888" }}>{a.localityCount}</div>
                      <div style={{ textAlign: "right", color: (a.capacityChangePct ?? 0) < 0 ? "#ef4444" : (a.capacityChangePct ?? 0) > 0 ? "#22c55e" : "#888" }}>
                        {a.capacityChangePct != null ? `${a.capacityChangePct > 0 ? "+" : ""}${a.capacityChangePct}%` : "\u2014"}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* ─── Right Sidebar ──────────────────────────── */}
            <div className="sf-right" style={S.panel}>
              {/* Salmon Price */}
              <div style={S.section}>SALMON SPOT</div>
              <div style={{ padding: "8px 10px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <span style={{ fontSize: 20, fontWeight: 700, color: "#f97316" }}>
                    {overview?.salmonPrice ? `NOK ${overview.salmonPrice.price.toFixed(2)}` : "\u2014"}
                  </span>
                  <span style={{ color: (overview?.salmonPrice?.changePct ?? 0) >= 0 ? "#22c55e" : "#ef4444", fontWeight: 600, fontSize: 11 }}>
                    {fmtPct(overview?.salmonPrice?.changePct)}
                  </span>
                </div>
                {salmonData?.stats && (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2px 12px", marginTop: 6, fontSize: 10 }}>
                    <span style={{ color: "#666" }}>52W HIGH</span>
                    <span style={{ textAlign: "right", color: "#22c55e" }}>NOK {salmonData.stats.high52w.toFixed(2)}</span>
                    <span style={{ color: "#666" }}>52W LOW</span>
                    <span style={{ textAlign: "right", color: "#ef4444" }}>NOK {salmonData.stats.low52w.toFixed(2)}</span>
                    <span style={{ color: "#666" }}>AVERAGE</span>
                    <span style={{ textAlign: "right" }}>NOK {salmonData.stats.avg.toFixed(2)}</span>
                  </div>
                )}
              </div>

              {/* Industry Lice */}
              <div style={S.section}>INDUSTRY LICE</div>
              <div style={{ padding: "8px 10px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <span style={{ fontSize: 20, fontWeight: 700, color: getLiceColor(overview?.industryAvgLice ?? null) }}>
                    {overview?.industryAvgLice?.toFixed(3) ?? "\u2014"}
                  </span>
                  <span style={{ color: "#666", fontSize: 10 }}>THRESHOLD 0.500</span>
                </div>
                {liceData?.weekly && liceData.weekly.length > 0 && (
                  <div style={{ marginTop: 6, fontSize: 10 }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2px 12px" }}>
                      <span style={{ color: "#666" }}>REPORTING</span>
                      <span style={{ textAlign: "right" }}>{liceData.weekly[liceData.weekly.length - 1]?.reportCount ?? 0} sites</span>
                      <span style={{ color: "#666" }}>ABOVE 0.5</span>
                      <span style={{ textAlign: "right", color: "#ef4444" }}>{liceData.weekly[liceData.weekly.length - 1]?.aboveThreshold ?? 0}</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Traffic Lights */}
              <div style={S.section}>TRAFFIC LIGHT STATUS</div>
              <div style={{ padding: "4px 0" }}>
                {areas.map(a => (
                  <div key={a.areaNumber} style={{ display: "grid", gridTemplateColumns: "24px 1fr 50px", padding: "3px 10px", fontSize: 10, borderBottom: "1px solid #111" }}>
                    <span style={{ color: "#666" }}>{a.areaNumber}</span>
                    <span style={{ color: "#aaa", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name}</span>
                    <span style={{ textAlign: "right" }}>
                      <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: TL_C[a.trafficLight] || "#555", marginRight: 4 }} />
                      <span style={{ color: TL_C[a.trafficLight] || "#555", fontWeight: 600, fontSize: 9 }}>{a.trafficLight?.toUpperCase()}</span>
                    </span>
                  </div>
                ))}
              </div>

              {/* Company Risk Scores */}
              <div style={S.section}>RISK SCORES</div>
              <div style={{ padding: "4px 0" }}>
                {sortedCompanies.map(co => (
                  <div key={co.ticker} style={{ display: "grid", gridTemplateColumns: "48px 1fr 36px", padding: "3px 10px", fontSize: 10, borderBottom: "1px solid #111" }}>
                    <Link href={`/stocks/${co.ticker}`} style={{ color: "#58a6ff", textDecoration: "none", fontWeight: 600 }}>{co.ticker}</Link>
                    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <div style={{ flex: 1, height: 3, background: "#1a1a1a", borderRadius: 1 }}>
                        <div style={{ width: `${Math.min(100, co.riskScore ?? 0)}%`, height: 3, background: getRiskColor(co.riskScore), borderRadius: 1 }} />
                      </div>
                    </div>
                    <span style={{ textAlign: "right", color: getRiskColor(co.riskScore), fontWeight: 700 }}>{co.riskScore?.toFixed(0) ?? "\u2014"}</span>
                  </div>
                ))}
              </div>

              {/* Data Sources */}
              <div style={S.section}>DATA SOURCES</div>
              <div style={{ padding: "6px 10px", fontSize: 9, color: "#555", lineHeight: 1.6 }}>
                SSB (salmon prices)<br />
                BarentsWatch (lice, disease)<br />
                Fiskeridirektoratet (localities)<br />
                Mattilsynet (traffic lights)
              </div>
            </div>
          </div>
        </div>
      </main>
    </>
  );
}

/* ─── Alert Generator ──────────────────────────────────────────── */

type Alert = { severity: "high" | "medium" | "low"; message: string; detail?: string };

function buildAlerts(overview: Overview | null, companies: Company[], diseases: DiseaseOutbreak[]): Alert[] {
  const out: Alert[] = [];

  if (overview?.salmonPrice?.changePct != null && Math.abs(overview.salmonPrice.changePct) > 5) {
    const c = overview.salmonPrice.changePct;
    out.push({ severity: Math.abs(c) > 10 ? "high" : "medium", message: `Salmon price ${c > 0 ? "up" : "down"} ${Math.abs(c).toFixed(1)}% WoW`, detail: `NOK ${overview.salmonPrice.price.toFixed(2)}/kg` });
  }

  if (overview?.trafficLights?.red && overview.trafficLights.red > 0) {
    out.push({ severity: overview.trafficLights.red >= 3 ? "high" : "medium", message: `${overview.trafficLights.red} production area${overview.trafficLights.red > 1 ? "s" : ""} on RED`, detail: "Mandatory -6% capacity" });
  }

  for (const co of companies) {
    if ((co.avgLice4w ?? 0) > 0.4) {
      out.push({ severity: (co.avgLice4w ?? 0) > 0.5 ? "high" : "medium", message: `${co.ticker}: Lice ${co.avgLice4w?.toFixed(2)} near threshold`, detail: `${co.pctAboveThreshold?.toFixed(0) ?? "?"}% above 0.5` });
    }
  }

  const activeDiseases = diseases.filter(d => d.isActive);
  if (activeDiseases.length > 0) {
    const pdCount = activeDiseases.filter(d => d.disease === "PD").length;
    const ilaCount = activeDiseases.filter(d => d.disease === "ILA").length;
    if (ilaCount > 0) out.push({ severity: "high", message: `${ilaCount} active ILA outbreak${ilaCount > 1 ? "s" : ""}`, detail: "Infectious Salmon Anaemia - notifiable" });
    if (pdCount > 0) out.push({ severity: "medium", message: `${pdCount} active PD outbreak${pdCount > 1 ? "s" : ""}`, detail: "Pancreas Disease" });
  }

  out.sort((a, b) => ({ high: 0, medium: 1, low: 2 }[a.severity] - { high: 0, medium: 1, low: 2 }[b.severity]));
  return out;
}
