"use client";

import React, { useEffect, useRef, useState } from "react";
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
  municipality: string | null; productionArea: number; areaName: string | null;
  areaTrafficLight: string | null; lat: number; lng: number; hasBiomass: boolean;
  isActive: boolean; latestLice: number | null; latestMobile: number | null;
  latestStationary: number | null; latestTemp: number | null;
  hasCleaning: boolean; hasMechanicalRemoval: boolean; hasMedicinalTreatment: boolean;
  liceWeek: string | null;
};

type Company = {
  ticker: string; name: string; price: number | null;
  change1d: number | null; change1w: number | null; change1m: number | null;
  activeSites: number | null; avgLice4w: number | null; pctAboveThreshold: number | null;
  treatmentRate: number | null; riskScore: number | null; productionAreas: number[];
};

type DiseaseOutbreak = {
  localityId: number; localityName: string; ticker: string | null; companyName: string | null;
  area: number | null; areaName: string | null; lat: number | null; lng: number | null;
  disease: string; weeksFlagged: number; firstDetected: string | null; lastDetected: string;
  isActive: boolean; predatesWindow: boolean;
};

type BiomassData = {
  timeSeries: Array<{ area_number: number; month: string; biomass_tonnes: number; harvest_tonnes: number; mortality_tonnes: number; feed_tonnes: number; stock_count: number }>;
  nationalTrend: Array<{ month: string; total_biomass: number; total_harvest: number; total_feed: number; total_stock: number }>;
  currentTotals: Array<{ area_number: number; month: string; biomass_tonnes: number; harvest_tonnes: number; stock_count: number }>;
  yoyComparison: Array<{ area_number: number; current_biomass: number; prev_biomass: number; yoy_change_pct: number | null }>;
};

type ExportData = {
  timeSeries: Array<{ week_start: string; price_nok_kg: number | null; volume_tonnes: number | null }>;
  stats: { currentPrice: number | null; latestWeek: string | null; high52w: number | null; low52w: number | null; avg52w: number | null };
};

type HarvestData = {
  byArea: Array<{ area_number: number; month: string; harvest_tonnes: number; mortality_tonnes: number; biomass_tonnes: number; feed_tonnes: number; stock_count: number }>;
  national: Array<{ month: string; total_harvest: number; total_mortality: number; total_biomass: number; total_feed: number; mortality_rate_pct: number; feed_conversion_ratio: number | null }>;
  yoyComparison: Array<{ area_number: number; recent_harvest: number; prior_harvest: number; yoy_change_pct: number | null }>;
};

type SpotWeekly = {
  year: number; week: number; report_date: string; currency: string;
  sisalmon_avg: number | null; sisalmon_3_6kg: number | null;
  sisalmon_avg_1w_change: number | null; sisalmon_avg_4w_change: number | null;
  price_1_2kg: number | null; price_2_3kg: number | null; price_3_4kg: number | null;
  price_4_5kg: number | null; price_5_6kg: number | null; price_6_7kg: number | null;
  price_7_8kg: number | null; price_8_9kg: number | null; price_9plus_kg: number | null;
  total_volume: number | null; avg_weight_kg: number | null;
};

type ForwardPrice = { period: string; price_eur_tonne: number | null; report_date: string; prev_price: number | null; change_pct: number | null };

type PriceEstimate = { period: string; price_nok_kg: number; price_eur_kg: number; supply_growth_yoy: number | null; is_estimate: boolean; report_date: string };
type ParetoData = {
  spot: { spot_nok: number; spot_eur: number; qtd_price_nok: number | null; consensus_nok: number | null; report_date: string } | null;
  spotHistory: Array<{ report_date: string; spot_nok: number }>;
  quarterly: PriceEstimate[];
  annual: PriceEstimate[];
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
  const [biomassData, setBiomassData] = useState<BiomassData | null>(null);
  const [exportData, setExportData] = useState<ExportData | null>(null);
  const [harvestData, setHarvestData] = useState<HarvestData | null>(null);
  const [quarterlyOps, setQuarterlyOps] = useState<Record<string, any[]>>({});
  const [fishPoolSpot, setFishPoolSpot] = useState<{ spotPrices: SpotWeekly[]; latest: SpotWeekly | null } | null>(null);
  const [forwardPrices, setForwardPrices] = useState<{ forwards: ForwardPrice[] } | null>(null);
  const [paretoData, setParetoData] = useState<ParetoData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"overview" | "map" | "areas" | "biomass">("overview");
  const [mapLayer, setMapLayer] = useState<"localities" | "biomass">("localities");
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);
  const [focusLocation, setFocusLocation] = useState<{ lat: number; lng: number; name: string } | null>(null);
  const [qopsDetailOpen, setQopsDetailOpen] = useState(false);
  const [qopsSort, setQopsSort] = useState<{ col: string; asc: boolean } | null>(null);
  const [marginHover, setMarginHover] = useState<{ tk: string; idx: number; x: number; y: number } | null>(null);
  const [hoveredExportIdx, setHoveredExportIdx] = useState<number | null>(null);
  const [hoveredBioIdx, setHoveredBioIdx] = useState<number | null>(null);
  const [hoveredMortIdx, setHoveredMortIdx] = useState<number | null>(null);
  const [mousePos, setMousePos] = useState<{ x: number; y: number; cw: number }>({ x: 0, y: 0, cw: 800 });
  const trackMouse = (e: React.MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setMousePos({ x: e.clientX - rect.left, y: e.clientY - rect.top, cw: rect.width });
  };

  useEffect(() => {
    const sf = async (url: string) => {
      try { const r = await fetch(url); return r.ok ? r.json() : null; }
      catch { return null; }
    };
    async function load() {
      try {
        const [ov, sal, lice, ar, loc, co, dis, bio, exp, har, qops, fp, fwd, par] = await Promise.all([
          sf("/api/seafood/overview"), sf("/api/seafood/salmon-price?days=365"),
          sf("/api/seafood/lice?weeks=26"), sf("/api/seafood/production-areas"),
          sf("/api/seafood/localities"), sf("/api/seafood/company-exposure"),
          sf("/api/seafood/diseases"),
          sf("/api/seafood/biomass?months=36&species=salmon"),
          sf("/api/seafood/export?weeks=104&category=fresh"),
          sf("/api/seafood/harvest?months=24&species=salmon"),
          sf("/api/seafood/quarterly-ops?quarters=8"),
          sf("/api/seafood/spot-prices?weeks=52&currency=NOK"),
          sf("/api/seafood/forward-prices"),
          sf("/api/seafood/price-estimates"),
        ]);
        if (ov) setOverview(ov);
        if (sal) setSalmonData(sal);
        if (lice) setLiceData(lice);
        setAreas(ar?.areas || []);
        setLocalities(loc?.localities || []);
        setCompanies(co?.companies || []);
        setDiseases(dis?.outbreaks || []);
        if (bio) setBiomassData(bio);
        if (exp) setExportData(exp);
        if (har) setHarvestData(har);
        if (qops?.data) setQuarterlyOps(qops.data);
        if (fp) setFishPoolSpot(fp);
        if (fwd) setForwardPrices(fwd);
        if (par) setParetoData(par);
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
        @keyframes sf-fade-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        .sf-tab-content { animation: sf-fade-in 0.35s ease-out; }
        .biomass-cta:hover { box-shadow: 0 0 12px rgba(249,115,22,0.15); }
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
                {paretoData?.spot ? `NOK ${paretoData.spot.spot_nok}` : fishPoolSpot?.latest?.sisalmon_avg ? `NOK ${fishPoolSpot.latest.sisalmon_avg.toFixed(1)}` : overview?.salmonPrice ? `NOK${overview.salmonPrice.price.toFixed(2)}` : "\u2014"}
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
            {(["overview", "map", "areas", "biomass"] as const).map(t => (
              <button key={t} style={S.tabBtn(tab === t)} onClick={() => setTab(t)}>
                {t.toUpperCase()}
              </button>
            ))}
          </div>

          {/* ─── Main Grid ──────────────────────────────────── */}
          <div className="sf-grid" style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 0, marginTop: 1 }}>

            {/* ─── Left Panel ─────────────────────────────── */}
            <div key={tab} className="sf-tab-content">
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

                  {/* ─── Price Intelligence ─── */}
                  <div style={{ borderBottom: "1px solid #222" }}>
                    <div style={S.section}>PRICE INTELLIGENCE</div>

                    {/* Hero strip: 5 key prices */}
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", borderBottom: "1px solid #333" }}>
                      {[
                        { label: "PARETO SPOT EST.", value: paretoData?.spot?.spot_nok, src: "Pareto W/W" },
                        { label: "FISH POOL AVG", value: fishPoolSpot?.latest?.sisalmon_avg, src: `SISALMON W${fishPoolSpot?.latest?.week ?? ""}` },
                        { label: "FISH POOL 3-6KG", value: fishPoolSpot?.latest?.sisalmon_3_6kg, src: `SISALMON W${fishPoolSpot?.latest?.week ?? ""}` },
                        { label: "QTD PRICE", value: paretoData?.spot?.qtd_price_nok, src: "Pareto QTD" },
                        { label: "CONSENSUS", value: paretoData?.spot?.consensus_nok != null && paretoData.spot.consensus_nok > 10 ? paretoData.spot.consensus_nok : null, src: "PAS FCA Oslo" },
                      ].map((m, i) => (
                        <div key={m.label} style={{ padding: "12px 16px", borderRight: i < 4 ? "1px solid #222" : "none" }}>
                          <div style={{ fontSize: 10, color: "#666", fontWeight: 700, letterSpacing: "0.08em", marginBottom: 4 }}>{m.label}</div>
                          <div style={{ fontSize: 26, fontWeight: 700, color: m.value != null ? "#f97316" : "#333", lineHeight: 1 }}>
                            {m.value != null ? m.value.toFixed(1) : "\u2014"}
                          </div>
                          <div style={{ fontSize: 10, color: "#555", marginTop: 4 }}>NOK/kg <span style={{ color: "#444" }}>{m.src}</span></div>
                        </div>
                      ))}
                    </div>

                    {/* 1W / 4W change strip */}
                    {fishPoolSpot?.latest && (
                      <div style={{ display: "flex", gap: 20, padding: "6px 16px", borderBottom: "1px solid #222", fontSize: 11, alignItems: "center" }}>
                        <span style={{ color: "#666", fontWeight: 700, letterSpacing: "0.06em", fontSize: 10 }}>SISALMON AVG</span>
                        <span style={{ fontWeight: 600, color: (fishPoolSpot.latest.sisalmon_avg_1w_change ?? 0) >= 0 ? "#22c55e" : "#ef4444" }}>
                          1W {fmtPct(fishPoolSpot.latest.sisalmon_avg_1w_change)}
                        </span>
                        <span style={{ fontWeight: 600, color: (fishPoolSpot.latest.sisalmon_avg_4w_change ?? 0) >= 0 ? "#22c55e" : "#ef4444" }}>
                          4W {fmtPct(fishPoolSpot.latest.sisalmon_avg_4w_change)}
                        </span>
                        {fishPoolSpot.latest.total_volume != null && (
                          <span style={{ color: "#555", marginLeft: "auto" }}>
                            Fish Pool Vol: <span style={{ color: "#999" }}>{fishPoolSpot.latest.total_volume >= 1000 ? `${(fishPoolSpot.latest.total_volume / 1000).toFixed(1)}K` : fishPoolSpot.latest.total_volume.toFixed(0)} tonnes</span>
                            {fishPoolSpot.latest.avg_weight_kg != null && (
                              <> | Avg: <span style={{ color: "#999" }}>{fishPoolSpot.latest.avg_weight_kg.toFixed(2)} kg</span></>
                            )}
                          </span>
                        )}
                      </div>
                    )}

                    {/* 3-column layout: Pareto Estimates | Forward Curve | Weight Classes */}
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 0 }}>

                      {/* Col 1: Pareto Quarterly Estimates */}
                      <div style={{ padding: "14px 16px", borderRight: "1px solid #222" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
                          <span style={{ fontSize: 11, color: "#888", fontWeight: 700, letterSpacing: "0.06em" }}>PARETO ESTIMATES</span>
                          {paretoData?.spot && <span style={{ fontSize: 10, color: "#555" }}>{paretoData.spot.report_date?.slice(0, 10)}</span>}
                        </div>
                        {paretoData?.quarterly && paretoData.quarterly.length > 0 ? (() => {
                          const rows = paretoData.quarterly.filter(q => {
                            const yr = q.period.match(/\d{2}$/)?.[0];
                            return yr && parseInt(yr) >= 26;
                          });
                          return (
                            <div>
                              <div style={{ display: "grid", gridTemplateColumns: "72px 1fr 1fr 1fr", gap: 0, padding: "5px 0", borderBottom: "1px solid #333", fontSize: 10, color: "#666", fontWeight: 700 }}>
                                <span>PERIOD</span>
                                <span style={{ textAlign: "right" }}>NOK</span>
                                <span style={{ textAlign: "right" }}>EUR</span>
                                <span style={{ textAlign: "right" }}>SUPPLY</span>
                              </div>
                              {rows.map(q => (
                                <div key={q.period} style={{ display: "grid", gridTemplateColumns: "72px 1fr 1fr 1fr", gap: 0, padding: "4px 0", borderBottom: "1px solid #181818", fontSize: 12 }}>
                                  <span style={{ color: q.is_estimate ? "#777" : "#aaa", fontWeight: 600, fontSize: 11 }}>
                                    {q.period}{q.is_estimate ? "e" : ""}
                                  </span>
                                  <span style={{ textAlign: "right", color: "#e5e5e5", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
                                    {q.price_nok_kg?.toFixed(1)}
                                  </span>
                                  <span style={{ textAlign: "right", color: "#777", fontVariantNumeric: "tabular-nums" }}>
                                    {q.price_eur_kg?.toFixed(1)}
                                  </span>
                                  <span style={{ textAlign: "right", fontWeight: 600, fontVariantNumeric: "tabular-nums", color: (q.supply_growth_yoy ?? 0) >= 0 ? "#22c55e" : "#ef4444" }}>
                                    {q.supply_growth_yoy != null ? `${q.supply_growth_yoy >= 0 ? "+" : ""}${q.supply_growth_yoy.toFixed(1)}%` : "\u2014"}
                                  </span>
                                </div>
                              ))}
                            </div>
                          );
                        })() : <div style={{ color: "#444", fontSize: 12, padding: "20px 0" }}>No estimate data</div>}
                      </div>

                      {/* Col 2: Forward Curve */}
                      <div style={{ padding: "14px 16px", borderRight: "1px solid #222" }}>
                        {(() => {
                          const EURNOK = paretoData?.spot?.spot_nok && paretoData?.spot?.spot_eur
                            ? paretoData.spot.spot_nok / paretoData.spot.spot_eur
                            : 11.7;
                          return (
                            <>
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
                                <span style={{ fontSize: 11, color: "#888", fontWeight: 700, letterSpacing: "0.06em" }}>FORWARD CURVE</span>
                                <span style={{ fontSize: 10, color: "#555" }}>EUR/NOK {EURNOK.toFixed(2)}</span>
                              </div>
                              {forwardPrices?.forwards && forwardPrices.forwards.length > 0 ? (() => {
                                const fwds = forwardPrices.forwards.map(f => {
                                  let label = f.period;
                                  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
                                  // "01+02-27" → "Jan-Feb'27"
                                  label = label.replace(/^(\d{2})\+(\d{2})-(\d{2})$/, (_m, m1, m2, y) =>
                                    `${months[parseInt(m1)-1]}-${months[parseInt(m2)-1]}'${y}`);
                                  // "Q1+Q2-27" → "H1'27"
                                  label = label.replace(/^Q([1-2])\+Q([2-4])-(\d{2})$/, (_m, _q1, _q2, y) => {
                                    const q1n = parseInt(_q1); return `H${q1n <= 2 ? 1 : 2}'${y}`;
                                  });
                                  // "Q3+Q4-27" → "H2'27"
                                  label = label.replace(/^Q([3-4])\+Q([3-4])-(\d{2})$/, (_m, _q1, _q2, y) => `H2'${y}`);
                                  // "Q1-27" → "Q1'27"
                                  label = label.replace(/^Q([1-4])-(\d{2})$/, "Q$1'$2");
                                  // "Apr-26" → "Apr'26", "Jun-26" → "Jun'26"
                                  label = label.replace(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)-(\d{2})$/, "$1'$2");
                                  // "04-26" → "Apr'26"
                                  label = label.replace(/^(0[1-9]|1[0-2])-(\d{2})$/, (_m, mo, y) =>
                                    `${months[parseInt(mo)-1]}'${y}`);
                                  const nokKg = f.price_eur_tonne ? (f.price_eur_tonne * EURNOK / 1000) : null;
                                  return { ...f, label, nokKg };
                                });
                                return (
                                  <div>
                                    <div style={{ display: "grid", gridTemplateColumns: "80px 1fr 1fr 60px", gap: 0, padding: "5px 0", borderBottom: "1px solid #333", fontSize: 10, color: "#666", fontWeight: 700 }}>
                                      <span>CONTRACT</span>
                                      <span style={{ textAlign: "right" }}>EUR/T</span>
                                      <span style={{ textAlign: "right" }}>NOK/KG</span>
                                      <span style={{ textAlign: "right" }}>W/W</span>
                                    </div>
                                    {fwds.slice(0, 12).map((f, i) => (
                                      <div key={i} style={{ display: "grid", gridTemplateColumns: "80px 1fr 1fr 60px", gap: 0, padding: "4px 0", borderBottom: "1px solid #181818", fontSize: 12 }}>
                                        <span style={{ color: "#999", fontWeight: 600, fontSize: 11 }}>{f.label}</span>
                                        <span style={{ textAlign: "right", color: "#e5e5e5", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
                                          {f.price_eur_tonne?.toLocaleString() ?? "\u2014"}
                                        </span>
                                        <span style={{ textAlign: "right", color: "#f97316", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
                                          {f.nokKg != null ? f.nokKg.toFixed(1) : "\u2014"}
                                        </span>
                                        <span style={{ textAlign: "right", fontWeight: 600, fontVariantNumeric: "tabular-nums", color: f.change_pct == null ? "#444" : (f.change_pct >= 0 ? "#22c55e" : "#ef4444") }}>
                                          {f.change_pct != null ? `${f.change_pct >= 0 ? "+" : ""}${f.change_pct.toFixed(1)}%` : "\u2014"}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                );
                              })() : <div style={{ color: "#444", fontSize: 12, padding: "20px 0" }}>No forward data</div>}
                            </>
                          );
                        })()}
                      </div>

                      {/* Col 3: Weight Class Breakdown */}
                      <div style={{ padding: "14px 16px" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
                          <span style={{ fontSize: 11, color: "#888", fontWeight: 700, letterSpacing: "0.06em" }}>SPOT BY WEIGHT</span>
                          {fishPoolSpot?.latest && <span style={{ fontSize: 10, color: "#555" }}>Week {fishPoolSpot.latest.week}</span>}
                        </div>
                        {fishPoolSpot?.latest ? (
                          <div>
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0, padding: "5px 0", borderBottom: "1px solid #333", fontSize: 10, color: "#666", fontWeight: 700 }}>
                              <span>CLASS</span>
                              <span style={{ textAlign: "right" }}>NOK/KG</span>
                            </div>
                            {[
                              ["1-2 kg", fishPoolSpot.latest.price_1_2kg],
                              ["2-3 kg", fishPoolSpot.latest.price_2_3kg],
                              ["3-4 kg", fishPoolSpot.latest.price_3_4kg],
                              ["4-5 kg", fishPoolSpot.latest.price_4_5kg],
                              ["5-6 kg", fishPoolSpot.latest.price_5_6kg],
                              ["6-7 kg", fishPoolSpot.latest.price_6_7kg],
                              ["7-8 kg", fishPoolSpot.latest.price_7_8kg],
                              ["8-9 kg", fishPoolSpot.latest.price_8_9kg],
                            ].map(([label, val]) => {
                              const v = val as number | null;
                              const avg = fishPoolSpot.latest?.sisalmon_avg ?? 0;
                              const isPremium = v != null && avg > 0 && v > avg;
                              return (
                                <div key={label as string} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0, padding: "4px 0", borderBottom: "1px solid #181818", fontSize: 12 }}>
                                  <span style={{ color: "#888" }}>{label}</span>
                                  <span style={{ textAlign: "right", fontWeight: 600, fontVariantNumeric: "tabular-nums", color: isPremium ? "#22c55e" : "#e5e5e5" }}>
                                    {v?.toFixed(1) ?? "\u2014"}
                                  </span>
                                </div>
                              );
                            })}
                            <div style={{ marginTop: 8, padding: "6px 0", borderTop: "1px solid #333", display: "grid", gridTemplateColumns: "1fr 1fr", fontSize: 12, fontWeight: 700 }}>
                              <span style={{ color: "#999" }}>AVG</span>
                              <span style={{ textAlign: "right", color: "#f97316", fontVariantNumeric: "tabular-nums" }}>
                                {fishPoolSpot.latest.sisalmon_avg?.toFixed(1) ?? "\u2014"}
                              </span>
                            </div>
                          </div>
                        ) : <div style={{ color: "#444", fontSize: 12, padding: "20px 0" }}>No spot data</div>}
                      </div>

                    </div>
                  </div>

                  {/* Biomass & Export Teaser */}
                  <div style={{ borderBottom: "1px solid #222" }}>
                    <div style={S.section}>BIOMASS & EXPORT INTELLIGENCE</div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0 }}>
                      {/* Left: Export price mini chart */}
                      <div style={{ padding: "12px 14px", borderRight: "1px solid #222" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
                          <span style={{ fontSize: 10, color: "#666", fontWeight: 700, letterSpacing: "0.06em" }}>SALMON EXPORT PRICE</span>
                          <span style={{ fontSize: 13, fontWeight: 700, color: "#f97316" }}>
                            NOK {exportData?.stats?.currentPrice?.toFixed(2) ?? "\u2014"}/kg
                          </span>
                        </div>
                        {exportData?.timeSeries && exportData.timeSeries.length > 2 ? (() => {
                          const pts = exportData.timeSeries.filter(d => d.price_nok_kg != null).slice(-52);
                          const prices = pts.map(p => p.price_nok_kg!);
                          const vols = pts.map(p => p.volume_tonnes || 0);
                          const minP = Math.min(...prices); const maxP = Math.max(...prices);
                          const maxV = Math.max(...vols);
                          return (
                            <div style={{ height: 80, position: "relative" }}>
                              <svg viewBox="0 0 100 30" preserveAspectRatio="none" style={{ width: "100%", height: "100%", display: "block" }}>
                                {pts.map((p, i) => {
                                  const x = (i / (pts.length - 1)) * 100;
                                  const bw = Math.max(0.4, 100 / pts.length * 0.6);
                                  const bh = maxV > 0 ? ((p.volume_tonnes || 0) / maxV) * 8 : 0;
                                  return <rect key={i} x={x - bw / 2} y={30 - bh} width={bw} height={bh} fill="#1a1a3a" />;
                                })}
                                <path d={pts.map((p, i) => {
                                  const x = (i / (pts.length - 1)) * 100;
                                  const y = 28 - ((p.price_nok_kg! - minP) / (maxP - minP || 1)) * 24;
                                  return `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
                                }).join(" ")} fill="none" stroke="#f97316" strokeWidth={0.4} vectorEffect="non-scaling-stroke" />
                              </svg>
                              <div style={{ position: "absolute", top: 2, left: 2, fontSize: 9, color: "#555", pointerEvents: "none" }}>{maxP.toFixed(0)}</div>
                              <div style={{ position: "absolute", bottom: 2, left: 2, fontSize: 9, color: "#555", pointerEvents: "none" }}>{minP.toFixed(0)}</div>
                            </div>
                          );
                        })() : <div style={{ height: 80, display: "flex", alignItems: "center", justifyContent: "center", color: "#444", fontSize: 10 }}>Loading...</div>}
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: "#555", marginTop: 4 }}>
                          <span>52W TREND</span>
                          <div style={{ display: "flex", gap: 10 }}>
                            <span>H <span style={{ color: "#22c55e" }}>{exportData?.stats?.high52w?.toFixed(0)}</span></span>
                            <span>L <span style={{ color: "#ef4444" }}>{exportData?.stats?.low52w?.toFixed(0)}</span></span>
                          </div>
                        </div>
                      </div>
                      {/* Right: Biomass summary + CTA */}
                      <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
                        <div>
                          <div style={{ fontSize: 10, color: "#666", fontWeight: 700, letterSpacing: "0.06em", marginBottom: 8 }}>NATIONAL BIOMASS</div>
                          {biomassData?.nationalTrend && biomassData.nationalTrend.length > 0 ? (() => {
                            const latest = biomassData.nationalTrend[biomassData.nationalTrend.length - 1];
                            const prev = biomassData.nationalTrend.length > 1 ? biomassData.nationalTrend[biomassData.nationalTrend.length - 2] : null;
                            const bioChg = prev && Number(prev.total_biomass) > 0 ? ((Number(latest.total_biomass) - Number(prev.total_biomass)) / Number(prev.total_biomass) * 100) : null;
                            return (
                              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                                <div style={{ background: "#111", border: "1px solid #222", borderRadius: 3, padding: "8px 10px" }}>
                                  <div style={{ fontSize: 8, color: "#666", fontWeight: 700 }}>STANDING</div>
                                  <div style={{ fontSize: 18, fontWeight: 700, color: "#f97316", marginTop: 2 }}>{(Number(latest.total_biomass || 0) / 1000).toFixed(0)}K t</div>
                                  {bioChg != null && <div style={{ fontSize: 10, color: bioChg >= 0 ? "#22c55e" : "#ef4444", marginTop: 2 }}>{bioChg >= 0 ? "+" : ""}{bioChg.toFixed(1)}% MoM</div>}
                                </div>
                                <div style={{ background: "#111", border: "1px solid #222", borderRadius: 3, padding: "8px 10px" }}>
                                  <div style={{ fontSize: 8, color: "#666", fontWeight: 700 }}>HARVEST</div>
                                  <div style={{ fontSize: 18, fontWeight: 700, color: "#3b82f6", marginTop: 2 }}>{(Number(latest.total_harvest || 0) / 1000).toFixed(0)}K t</div>
                                  <div style={{ fontSize: 10, color: "#666", marginTop: 2 }}>{(Number(latest.total_stock || 0) / 1e6).toFixed(0)}M fish</div>
                                </div>
                              </div>
                            );
                          })() : <div style={{ color: "#444", fontSize: 10 }}>No biomass data</div>}
                        </div>
                        <button
                          onClick={() => setTab("biomass")}
                          className="biomass-cta"
                          style={{
                            marginTop: 10, width: "100%", padding: "9px 0",
                            background: "#0d0d0d", border: "1px solid #333", borderRadius: 3,
                            color: "#ccc", fontWeight: 600, fontSize: 11,
                            cursor: "pointer", letterSpacing: "0.1em",
                            transition: "all 0.25s ease",
                            textTransform: "uppercase",
                            display: "flex", alignItems: "center", justifyContent: "center", gap: 8
                          }}
                          onMouseEnter={e => { e.currentTarget.style.borderColor = "#f97316"; e.currentTarget.style.color = "#f97316"; }}
                          onMouseLeave={e => { e.currentTarget.style.borderColor = "#333"; e.currentTarget.style.color = "#ccc"; }}
                        >
                          <span style={{ fontSize: 14 }}>&#9656;</span> BIOMASS TERMINAL
                        </button>
                      </div>
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
                    {sortedCompanies.map(co => {
                      const isActive = selectedTicker === co.ticker;
                      return (
                      <div key={co.ticker} className="sf-row" onClick={() => setSelectedTicker(isActive ? null : co.ticker)} style={{ display: "grid", gridTemplateColumns: "3px 1fr 64px 52px 52px 52px 56px 50px 56px 44px", padding: "5px 8px", borderBottom: "1px solid #1a1a1a", alignItems: "center", cursor: "pointer", transition: "background 0.08s", background: isActive ? "#1a1a2a" : undefined, outline: isActive ? "1px solid #333" : undefined }}>
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
                      );
                    })}
                  </div>

                  {/* Quarterly Operations Matrix */}
                  {Object.keys(quarterlyOps).length > 0 && (() => {
                    const allQs: string[] = [];
                    for (const rows of Object.values(quarterlyOps)) {
                      for (const r of rows) {
                        const lbl = r.label as string;
                        if (!allQs.includes(lbl)) allQs.push(lbl);
                      }
                    }
                    allQs.sort((a, b) => {
                      const [qa, ya] = [parseInt(a[1]), parseInt(a.split(" ")[1])];
                      const [qb, yb] = [parseInt(b[1]), parseInt(b.split(" ")[1])];
                      return ya * 10 + qa - (yb * 10 + qb);
                    });
                    // Show ALL quarters (chronological), but scroll to show latest 5
                    const displayQs = allQs;
                    const displayTickers = ["MOWI", "SALM", "LSG", "GSF", "BAKKA", "AUSS"];
                    // Convert all to NOK for comparability
                    const FX: Record<string, number> = { EUR: 11.5, DKK: 1.57, NOK: 1 };
                    const toNok = (v: number | null, cur: string) => v != null ? v * (FX[cur] || 1) : null;

                    // Helper: build byQ map for a ticker
                    const getByQ = (tk: string) => {
                      const byQ: Record<string, any> = {};
                      for (const r of (quarterlyOps[tk] || [])) byQ[r.label] = r;
                      return byQ;
                    };

                    // Compute all values per ticker/quarter
                    const allData: Record<string, Record<string, { cost: number | null; price: number | null; margin: number | null; ebit: number | null; harvest: number | null }>> = {};
                    for (const tk of displayTickers) {
                      allData[tk] = {};
                      const byQ = getByQ(tk);
                      for (const q of displayQs) {
                        const d = byQ[q];
                        const cost = toNok(d?.costPerKg, d?.currency || "NOK");
                        const price = toNok(d?.pricePerKg, d?.currency || "NOK");
                        const margin = cost != null && price != null && price > 0 ? ((price - cost) / price) * 100 : null;
                        const ebit = toNok(d?.ebitPerKg, d?.currency || "NOK");
                        const harvest = d?.harvestGwt ?? null;
                        allData[tk][q] = { cost, price, margin, ebit, harvest };
                      }
                    }

                    const sortedTickers = [...displayTickers];
                    if (qopsSort) {
                      const [field, qLabel] = qopsSort.col.split("|");
                      sortedTickers.sort((a, b) => {
                        const va = allData[a]?.[qLabel]?.[field as keyof typeof allData[typeof a][typeof qLabel]] as number | null;
                        const vb = allData[b]?.[qLabel]?.[field as keyof typeof allData[typeof b][typeof qLabel]] as number | null;
                        const na = va ?? -Infinity;
                        const nb = vb ?? -Infinity;
                        return qopsSort.asc ? na - nb : nb - na;
                      });
                    }

                    // Show latest 5 quarters in main table
                    const latest5 = allQs.slice(-5);
                    const TK_COLORS: Record<string, string> = { MOWI: "#f97316", SALM: "#3b82f6", LSG: "#22c55e", GSF: "#ef4444", BAKKA: "#a855f7", AUSS: "#06b6d4" };

                    return (
                    <div style={{ marginTop: 2 }}>
                      <div style={S.section}>QUARTERLY OPERATIONS</div>
                      <div style={{ fontSize: 9, color: "#555", padding: "2px 10px 6px", letterSpacing: "0.04em" }}>
                        All values converted to NOK/kg. Source: company quarterly reports.
                      </div>

                      {/* Latest 5 quarters — fluid columns fill left panel */}
                      {(() => {
                        const cols = `72px repeat(${latest5.length}, 1fr)`;
                        return (
                        <div style={{ fontSize: 11 }}>
                            {/* Header */}
                            <div style={{ display: "grid", gridTemplateColumns: cols, borderBottom: "1px solid #333", padding: "0 6px" }}>
                              <div />
                              {latest5.map(q => (
                                <div key={q} style={{ textAlign: "center", fontSize: 10, fontWeight: 700, color: "#888", letterSpacing: "0.05em", padding: "6px 0" }}>{q}</div>
                              ))}
                            </div>
                            {/* Rows */}
                            {sortedTickers.map(tk => (
                              <div key={tk} className="sf-row" style={{ display: "grid", gridTemplateColumns: cols, borderBottom: "1px solid #1a1a1a", padding: "7px 6px", alignItems: "center", transition: "background 0.08s" }}>
                                <div style={{ padding: "0 4px" }}>
                                  <Link href={`/stocks/${tk}`} style={{ color: TK_COLORS[tk] || "#58a6ff", textDecoration: "none", fontWeight: 700, fontSize: 11 }}>{tk}</Link>
                                </div>
                                {latest5.map(q => {
                                  const v = allData[tk][q];
                                  const mCol = v.margin == null ? "#333" : v.margin >= 25 ? "#22c55e" : v.margin >= 15 ? "#4ade80" : v.margin > 0 ? "#a3a3a3" : "#ef4444";
                                  return (
                                    <div key={q} style={{ textAlign: "center", padding: "0 4px" }}>
                                      {v.cost != null && v.price != null ? (
                                        <>
                                          <div style={{ display: "flex", justifyContent: "center", gap: 6, fontSize: 11 }}>
                                            <span style={{ color: "#f59e0b" }}>{v.cost.toFixed(1)}</span>
                                            <span style={{ color: "#333" }}>/</span>
                                            <span style={{ color: "#3b82f6", fontWeight: 600 }}>{v.price.toFixed(1)}</span>
                                          </div>
                                          <div style={{ fontSize: 11, fontWeight: 700, color: mCol, marginTop: 2 }}>{v.margin != null ? `${v.margin.toFixed(0)}%` : ""}</div>
                                        </>
                                      ) : (
                                        <span style={{ color: "#333" }}>{"\u2014"}</span>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            ))}
                        </div>
                        );
                      })()}
                      {/* Legend */}
                      <div style={{ display: "flex", gap: 12, justifyContent: "center", padding: "4px 0 2px", fontSize: 9, color: "#555" }}>
                        <span><span style={{ color: "#f59e0b" }}>Cost</span> / <span style={{ color: "#3b82f6" }}>Price</span> NOK/kg</span>
                        <span style={{ color: "#22c55e" }}>Margin %</span>
                      </div>

                      {/* Margin trend sparklines per company */}
                      <div style={{ borderTop: "1px solid #222", padding: "8px 8px 4px" }}>
                        <div style={{ fontSize: 9, fontWeight: 700, color: "#555", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 6 }}>MARGIN TREND</div>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
                          {displayTickers.map(tk => {
                            const pts = allQs.map(q => ({ q, ...allData[tk][q] })).filter(p => p.margin != null);
                            if (pts.length < 2) return null;
                            const pad = 4; // padding inside chart
                            const maxP = Math.max(...pts.map(p => Math.max(p.cost ?? 0, p.price ?? 0)));
                            const minP = Math.min(...pts.filter(p => p.cost != null).map(p => p.cost!)) - 2;
                            const range = maxP - minP || 1;
                            const chartW = 200;
                            const chartH = 56;
                            const xStep = (chartW - pad * 2) / (pts.length - 1);
                            const yOf = (v: number) => pad + (chartH - pad * 2) - ((v - minP) / range) * (chartH - pad * 2);
                            const xOf = (i: number) => pad + i * xStep;
                            // Smooth cubic bezier helper
                            const smooth = (points: { x: number; y: number }[]) => {
                              if (points.length < 2) return "";
                              let d = `M${points[0].x.toFixed(1)},${points[0].y.toFixed(1)}`;
                              for (let i = 1; i < points.length; i++) {
                                const prev = points[i - 1];
                                const curr = points[i];
                                const cpx = (prev.x + curr.x) / 2;
                                d += ` C${cpx.toFixed(1)},${prev.y.toFixed(1)} ${cpx.toFixed(1)},${curr.y.toFixed(1)} ${curr.x.toFixed(1)},${curr.y.toFixed(1)}`;
                              }
                              return d;
                            };
                            const costPts = pts.map((p, i) => ({ x: xOf(i), y: yOf(p.cost!) }));
                            const pricePts = pts.map((p, i) => ({ x: xOf(i), y: yOf(p.price!) }));
                            const costPath = smooth(costPts);
                            const pricePath = smooth(pricePts);
                            // Area fill between price (top) and cost (bottom)
                            const marginFill = pricePts.map((p, i) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ")
                              + " " + [...costPts].reverse().map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
                            const latestMargin = pts[pts.length - 1].margin!;
                            const prevMargin = pts.length >= 2 ? pts[pts.length - 2].margin! : latestMargin;
                            const mDelta = latestMargin - prevMargin;
                            const hIdx = marginHover?.tk === tk ? marginHover.idx : -1;
                            const hPt = hIdx >= 0 ? pts[hIdx] : null;
                            return (
                              <div key={tk} style={{ background: "#0e0e0e", borderRadius: 8, padding: "8px 10px", border: "1px solid #1c1c1c" }}>
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                                  <span style={{ fontSize: 11, fontWeight: 700, color: TK_COLORS[tk] || "#888" }}>{tk}</span>
                                  <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
                                    <span style={{ fontSize: 13, fontWeight: 700, color: latestMargin >= 20 ? "#22c55e" : latestMargin > 0 ? "#4ade80" : "#ef4444" }}>{latestMargin.toFixed(0)}%</span>
                                    <span style={{ fontSize: 9, color: mDelta >= 0 ? "#22c55e" : "#ef4444" }}>{mDelta >= 0 ? "\u25B2" : "\u25BC"}{Math.abs(mDelta).toFixed(0)}pp</span>
                                  </div>
                                </div>
                                <div
                                  style={{ position: "relative", cursor: "crosshair" }}
                                  onMouseMove={e => {
                                    const rect = e.currentTarget.getBoundingClientRect();
                                    const xRel = (e.clientX - rect.left) / rect.width;
                                    const idx = Math.round(xRel * (pts.length - 1));
                                    const clamped = Math.max(0, Math.min(pts.length - 1, idx));
                                    setMarginHover({ tk, idx: clamped, x: e.clientX - rect.left, y: e.clientY - rect.top });
                                  }}
                                  onMouseLeave={() => setMarginHover(null)}
                                >
                                  <svg width="100%" viewBox={`0 0 ${chartW} ${chartH}`} preserveAspectRatio="none" style={{ display: "block" }}>
                                    {/* Grid lines */}
                                    {[0.25, 0.5, 0.75].map(f => (
                                      <line key={f} x1={pad} y1={pad + (chartH - pad * 2) * f} x2={chartW - pad} y2={pad + (chartH - pad * 2) * f} stroke="#1a1a1a" strokeWidth="0.5" />
                                    ))}
                                    {/* Margin fill */}
                                    <polygon points={marginFill} fill="#22c55e" opacity="0.06" />
                                    {/* Lines — smooth curves */}
                                    <path d={costPath} fill="none" stroke="#f59e0b" strokeWidth="1.8" strokeLinecap="round" opacity="0.8" />
                                    <path d={pricePath} fill="none" stroke="#3b82f6" strokeWidth="1.8" strokeLinecap="round" />
                                    {/* Data point dots */}
                                    {pts.map((_, i) => (
                                      <React.Fragment key={i}>
                                        <circle cx={xOf(i)} cy={costPts[i].y} r="1.5" fill="#f59e0b" opacity={hIdx === i ? 1 : 0.3} />
                                        <circle cx={xOf(i)} cy={pricePts[i].y} r="1.5" fill="#3b82f6" opacity={hIdx === i ? 1 : 0.3} />
                                      </React.Fragment>
                                    ))}
                                    {/* Hover crosshair */}
                                    {hIdx >= 0 && (
                                      <>
                                        <line x1={xOf(hIdx)} y1={pad} x2={xOf(hIdx)} y2={chartH - pad} stroke="#444" strokeWidth="0.5" />
                                        <circle cx={xOf(hIdx)} cy={costPts[hIdx].y} r="3" fill="#f59e0b" stroke="#0e0e0e" strokeWidth="1" />
                                        <circle cx={xOf(hIdx)} cy={pricePts[hIdx].y} r="3" fill="#3b82f6" stroke="#0e0e0e" strokeWidth="1" />
                                      </>
                                    )}
                                  </svg>
                                  {/* Tooltip */}
                                  {hPt && (
                                    <div style={{
                                      position: "absolute", bottom: "calc(100% + 6px)",
                                      left: `${Math.min(Math.max((hIdx / (pts.length - 1)) * 100, 10), 70)}%`,
                                      transform: "translateX(-50%)",
                                      background: "#161616", border: "1px solid #2a2a2a", borderRadius: 6, padding: "5px 10px",
                                      fontSize: 9, color: "#ccc", pointerEvents: "none", zIndex: 10, whiteSpace: "nowrap",
                                      boxShadow: "0 2px 8px rgba(0,0,0,0.4)"
                                    }}>
                                      <div style={{ fontWeight: 700, color: "#999", marginBottom: 3, fontSize: 8, letterSpacing: "0.04em" }}>{hPt.q}</div>
                                      <div style={{ display: "flex", gap: 10 }}>
                                        <span style={{ color: "#f59e0b" }}><span style={{ color: "#666" }}>C</span> {hPt.cost!.toFixed(1)}</span>
                                        <span style={{ color: "#3b82f6" }}><span style={{ color: "#666" }}>P</span> {hPt.price!.toFixed(1)}</span>
                                        <span style={{ color: hPt.margin! >= 20 ? "#22c55e" : hPt.margin! > 0 ? "#4ade80" : "#ef4444", fontWeight: 700 }}>{hPt.margin!.toFixed(0)}%</span>
                                      </div>
                                    </div>
                                  )}
                                </div>
                                {/* X-axis labels — show full label on first and year transitions */}
                                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 8, color: "#333", marginTop: 3 }}>
                                  {pts.map((p, i) => {
                                    const qNum = p.q.substring(0, 2); // "Q1"
                                    const yr = p.q.split(" ")[1]?.slice(-2); // "24"
                                    const prevYr = i > 0 ? pts[i - 1].q.split(" ")[1]?.slice(-2) : "";
                                    const showYr = i === 0 || yr !== prevYr;
                                    return (
                                      <span key={i} style={{ color: hIdx === i ? "#999" : "#444", fontWeight: hIdx === i ? 600 : 400, transition: "color 0.15s" }}>
                                        {showYr ? `${qNum}\u2019${yr}` : qNum}
                                      </span>
                                    );
                                  })}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                        <div style={{ display: "flex", gap: 12, justifyContent: "center", padding: "6px 0 0", fontSize: 8, color: "#444" }}>
                          <span><span style={{ display: "inline-block", width: 12, height: 2, background: "#f59e0b", verticalAlign: "middle", marginRight: 3 }} />Cost/kg</span>
                          <span><span style={{ display: "inline-block", width: 12, height: 2, background: "#3b82f6", verticalAlign: "middle", marginRight: 3 }} />Price/kg</span>
                          <span><span style={{ display: "inline-block", width: 8, height: 8, background: "#22c55e", opacity: 0.15, verticalAlign: "middle", marginRight: 3, borderRadius: 1 }} />Margin</span>
                        </div>
                      </div>

                      {/* Collapsible: EBIT/kg + Harvest */}
                      <div style={{ marginTop: 2 }}>
                        <div
                          onClick={() => setQopsDetailOpen(!qopsDetailOpen)}
                          style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 10px", cursor: "pointer", color: "#888", fontSize: 10, fontWeight: 600, letterSpacing: "0.04em", borderTop: "1px solid #222", userSelect: "none" }}
                        >
                          <span style={{ fontSize: 8, transition: "transform 0.2s", transform: qopsDetailOpen ? "rotate(90deg)" : "rotate(0deg)" }}>{"\u25B6"}</span>
                          EBIT/KG &amp; HARVEST VOLUME
                        </div>
                        {qopsDetailOpen && (() => {
                          const detCols = `72px repeat(${latest5.length}, 1fr)`;
                          return (
                          <div>
                            {/* EBIT/kg */}
                            <div style={{ fontSize: 9, fontWeight: 700, color: "#555", letterSpacing: "0.06em", textTransform: "uppercase", padding: "6px 8px 4px" }}>EBIT PER KG</div>
                            <div style={{ padding: "0 6px" }}>
                                <div style={{ display: "grid", gridTemplateColumns: detCols, borderBottom: "1px solid #222", paddingBottom: 2 }}>
                                  <div />
                                  {latest5.map(q => <div key={q} style={{ textAlign: "center", fontSize: 9, color: "#555", fontWeight: 600 }}>{q}</div>)}
                                </div>
                                {sortedTickers.map(tk => (
                                  <div key={tk} className="sf-row" style={{ display: "grid", gridTemplateColumns: detCols, borderBottom: "1px solid #1a1a1a", padding: "5px 0", alignItems: "center", transition: "background 0.08s" }}>
                                    <div style={{ padding: "0 4px" }}>
                                      <Link href={`/stocks/${tk}`} style={{ color: TK_COLORS[tk] || "#58a6ff", textDecoration: "none", fontWeight: 700, fontSize: 10 }}>{tk}</Link>
                                    </div>
                                    {latest5.map(q => {
                                      const v = allData[tk][q].ebit;
                                      const col = v == null ? "#333" : v > 20 ? "#22c55e" : v > 10 ? "#4ade80" : v > 0 ? "#a3a3a3" : "#ef4444";
                                      return <div key={q} style={{ textAlign: "center", color: col, fontWeight: 600, fontSize: 10 }}>{v != null ? v.toFixed(1) : "\u2014"}</div>;
                                    })}
                                  </div>
                                ))}
                            </div>
                            {/* Harvest GWT */}
                            <div style={{ fontSize: 9, fontWeight: 700, color: "#555", letterSpacing: "0.06em", textTransform: "uppercase", padding: "10px 8px 4px" }}>HARVEST VOLUME (GWT)</div>
                            <div style={{ padding: "0 6px" }}>
                                <div style={{ display: "grid", gridTemplateColumns: detCols, borderBottom: "1px solid #222", paddingBottom: 2 }}>
                                  <div />
                                  {latest5.map(q => <div key={q} style={{ textAlign: "center", fontSize: 9, color: "#555", fontWeight: 600 }}>{q}</div>)}
                                </div>
                                {sortedTickers.map(tk => (
                                  <div key={tk} className="sf-row" style={{ display: "grid", gridTemplateColumns: detCols, borderBottom: "1px solid #1a1a1a", padding: "5px 0", alignItems: "center", transition: "background 0.08s" }}>
                                    <div style={{ padding: "0 4px" }}>
                                      <Link href={`/stocks/${tk}`} style={{ color: TK_COLORS[tk] || "#58a6ff", textDecoration: "none", fontWeight: 700, fontSize: 10 }}>{tk}</Link>
                                    </div>
                                    {latest5.map(q => {
                                      const v = allData[tk][q].harvest;
                                      return <div key={q} style={{ textAlign: "center", color: v != null ? "#ccc" : "#333", fontSize: 10 }}>{v != null ? (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(Math.round(v))) : "\u2014"}</div>;
                                    })}
                                  </div>
                                ))}
                            </div>
                          </div>
                          );
                        })()}
                      </div>
                    </div>
                    );
                  })()}

                  {/* Map */}
                  <div id="seafood-map" style={{ borderBottom: "1px solid #222" }}>
                    <div style={S.section}>COASTAL MAP</div>
                    <div style={{ height: 460 }}>
                      <ProductionAreaMap areas={areas} localities={localities} selectedTicker={selectedTicker} onTickerSelect={setSelectedTicker} focusLocation={focusLocation} />
                    </div>
                  </div>

                  {/* Areas Teaser — Company sites by traffic light zone */}
                  {(() => {
                    const TCO_COLORS: Record<string, string> = { MOWI: "#f97316", SALM: "#3b82f6", LSG: "#22c55e", GSF: "#ef4444", AUSS: "#06b6d4" };
                    const TCO = ["MOWI", "SALM", "LSG", "GSF", "AUSS"];
                    const areaTL: Record<number, string> = {};
                    for (const a of areas) areaTL[a.areaNumber] = a.trafficLight || "";
                    // Count sites per company per traffic light
                    const coByTL: Record<string, { green: number; yellow: number; red: number; total: number; areaCnt: number }> = {};
                    for (const tk of TCO) {
                      const c = { green: 0, yellow: 0, red: 0, total: 0 };
                      const areaSet = new Set<number>();
                      for (const loc of localities) {
                        if (loc.ticker !== tk || !loc.isActive || !loc.productionArea) continue;
                        areaSet.add(loc.productionArea);
                        const tl = areaTL[loc.productionArea] || "";
                        if (tl === "green") c.green++; else if (tl === "yellow") c.yellow++; else if (tl === "red") c.red++;
                        c.total++;
                      }
                      coByTL[tk] = { ...c, areaCnt: areaSet.size };
                    }
                    const maxSites = Math.max(...TCO.map(tk => coByTL[tk].total), 1);
                    const totalSites = TCO.reduce((s, tk) => s + coByTL[tk].total, 0);
                    return (
                      <div style={{ borderBottom: "1px solid #222", padding: "10px 10px 12px" }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                          <div style={S.section}>COMPANY FOOTPRINT</div>
                          <button
                            onClick={() => setTab("areas")}
                            style={{ background: "linear-gradient(135deg, #1a3a5c, #0f2744)", border: "1px solid #1e4976", borderRadius: 6, padding: "5px 14px", color: "#58a6ff", fontSize: 10, fontWeight: 700, cursor: "pointer", letterSpacing: "0.04em", transition: "all 0.2s" }}
                            onMouseEnter={e => { e.currentTarget.style.background = "linear-gradient(135deg, #224a6e, #163858)"; e.currentTarget.style.borderColor = "#3b82f6"; }}
                            onMouseLeave={e => { e.currentTarget.style.background = "linear-gradient(135deg, #1a3a5c, #0f2744)"; e.currentTarget.style.borderColor = "#1e4976"; }}
                          >
                            EXPLORE ALL AREAS →
                          </button>
                        </div>
                        {/* Horizontal bars — segmented green/yellow/red */}
                        <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "0 2px" }}>
                          {TCO.map((tk, idx) => {
                            const d = coByTL[tk];
                            const barPct = (d.total / maxSites) * 100;
                            return (
                              <div key={tk} style={{ display: "grid", gridTemplateColumns: "52px 1fr 70px", alignItems: "center", gap: 8, animation: `teaserSlide 0.5s ease-out ${idx * 0.07}s both` }}>
                                <Link href={`/stocks/${tk}`} style={{ color: TCO_COLORS[tk], textDecoration: "none", fontWeight: 700, fontSize: 12 }}>{tk}</Link>
                                <div style={{ position: "relative", height: 20, background: "#111", borderRadius: 4, overflow: "hidden" }}>
                                  <div style={{ display: "flex", height: "100%", width: `${barPct}%`, borderRadius: 4, overflow: "hidden" }}>
                                    {d.green > 0 && <div style={{ width: `${(d.green / d.total) * 100}%`, background: "#22c55e", height: "100%" }} title={`${d.green} sites in green zones`} />}
                                    {d.yellow > 0 && <div style={{ width: `${(d.yellow / d.total) * 100}%`, background: "#f59e0b", height: "100%" }} title={`${d.yellow} sites in yellow zones`} />}
                                    {d.red > 0 && <div style={{ width: `${(d.red / d.total) * 100}%`, background: "#ef4444", height: "100%" }} title={`${d.red} sites in red zones`} />}
                                  </div>
                                  <span style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", fontSize: 10, fontWeight: 700, color: "#fff", textShadow: "0 1px 3px rgba(0,0,0,0.8)" }}>{d.total} sites</span>
                                </div>
                                <span style={{ fontSize: 10, color: "#666", textAlign: "right" }}>{d.areaCnt}/{areas.length} areas</span>
                              </div>
                            );
                          })}
                        </div>
                        {/* Legend */}
                        <div style={{ display: "flex", gap: 14, justifyContent: "center", marginTop: 8, fontSize: 9, color: "#555" }}>
                          <span><span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: "#22c55e", verticalAlign: "middle", marginRight: 3 }} />Green</span>
                          <span><span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: "#f59e0b", verticalAlign: "middle", marginRight: 3 }} />Yellow</span>
                          <span><span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: "#ef4444", verticalAlign: "middle", marginRight: 3 }} />Red</span>
                          <span style={{ color: "#444" }}>|</span>
                          <span>{totalSites} sites across {areas.length} areas</span>
                        </div>
                        <style>{`
                          @keyframes teaserSlide {
                            from { opacity: 0; transform: translateX(-12px); }
                            to { opacity: 1; transform: translateX(0); }
                          }
                        `}</style>
                      </div>
                    );
                  })()}

                  {/* Disease Outbreaks */}
                  <div>
                    <div style={S.section}>DISEASE OUTBREAKS (PD / ILA)</div>
                    {diseases.length === 0 ? (
                      <div style={{ padding: "16px 10px", color: "#555", fontSize: 11 }}>No active disease outbreaks detected in current reporting period.</div>
                    ) : (
                      <>
                        <div style={{ display: "grid", gridTemplateColumns: "3px 1fr 50px 60px 140px 80px 52px", padding: "4px 8px", fontSize: 9, fontWeight: 700, color: "#666", textTransform: "uppercase", letterSpacing: "0.06em", background: "#111", borderBottom: "1px solid #222" }}>
                          <div />
                          <div>LOCALITY</div>
                          <div>TYPE</div>
                          <div>COMPANY</div>
                          <div>AREA</div>
                          <div style={{ textAlign: "right" }}>DURATION</div>
                          <div style={{ textAlign: "center" }}>STATUS</div>
                        </div>
                        {diseases.slice(0, 50).map((d, i) => (
                          <div
                            key={i}
                            className="sf-row"
                            onClick={() => {
                              if (d.lat && d.lng) {
                                setFocusLocation({ lat: d.lat, lng: d.lng, name: d.localityName });
                                const mapEl = document.getElementById("seafood-map");
                                if (mapEl) mapEl.scrollIntoView({ behavior: "smooth", block: "center" });
                              }
                            }}
                            style={{ display: "grid", gridTemplateColumns: "3px 1fr 50px 60px 140px 80px 52px", padding: "5px 8px", borderBottom: "1px solid #1a1a1a", alignItems: "center", transition: "background 0.08s", cursor: d.lat ? "pointer" : "default" }}
                          >
                            <div style={{ width: 3, minHeight: 14, background: d.disease === "ILA" ? "#ef4444" : "#f97316", borderRadius: 1 }} />
                            <div style={{ fontSize: 11 }}>{d.localityName}</div>
                            <div><span style={{ ...S.badge(d.disease === "ILA" ? "#ef4444" : "#f97316"), fontSize: 8 }}>{d.disease}</span></div>
                            <div>{d.ticker ? <Link href={`/stocks/${d.ticker}`} style={{ color: "#58a6ff", textDecoration: "none", fontSize: 10 }} onClick={e => e.stopPropagation()}>{d.ticker}</Link> : <span style={{ color: "#555" }}>{"\u2014"}</span>}</div>
                            <div style={{ fontSize: 10, color: "#aaa" }}>{d.areaName ? `${d.area} — ${d.areaName}` : d.area ?? "\u2014"}</div>
                            <div style={{ textAlign: "right", fontSize: 10, color: "#888" }}>
                              {d.predatesWindow
                                ? <span title="Disease predates our data window">&gt;{d.weeksFlagged}w</span>
                                : <span title={`First detected ${d.firstDetected}`}>{d.weeksFlagged}w <span style={{ color: "#555" }}>from {d.firstDetected}</span></span>
                              }
                            </div>
                            <div style={{ textAlign: "center" }}>
                              <span style={{ ...S.badge(d.isActive ? "#ef4444" : "#22c55e"), fontSize: 8 }}>{d.isActive ? "ACTIVE" : "CLEARED"}</span>
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
                  <div style={{ ...S.section, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span>PRODUCTION AREAS & LOCALITIES ({localities.length} sites)</span>
                    <div style={{ display: "flex", gap: 4 }}>
                      {(["localities", "biomass"] as const).map(l => (
                        <button key={l} onClick={() => setMapLayer(l)} style={{ ...S.tabBtn(mapLayer === l), fontSize: 8 }}>
                          {l === "localities" ? "SITES" : "BIOMASS"}
                        </button>
                      ))}
                    </div>
                  </div>
                  {mapLayer === "biomass" && biomassData?.currentTotals && (
                    <div style={{ display: "flex", gap: 4, padding: "4px 10px", flexWrap: "wrap" }}>
                      {biomassData.currentTotals.map(b => {
                        const yoy = biomassData.yoyComparison.find(y => y.area_number === b.area_number);
                        const maxBio = Math.max(...biomassData.currentTotals.map(x => x.biomass_tonnes || 1));
                        const pct = (b.biomass_tonnes / maxBio) * 100;
                        return (
                          <div key={b.area_number} style={{ background: "#111", border: "1px solid #222", borderRadius: 3, padding: "3px 6px", fontSize: 9, minWidth: 70 }}>
                            <div style={{ display: "flex", justifyContent: "space-between", gap: 6 }}>
                              <span style={{ color: "#888" }}>Area {b.area_number}</span>
                              <span style={{ color: yoy?.yoy_change_pct != null ? (yoy.yoy_change_pct >= 0 ? "#22c55e" : "#ef4444") : "#888", fontSize: 8 }}>
                                {yoy?.yoy_change_pct != null ? `${yoy.yoy_change_pct >= 0 ? "+" : ""}${yoy.yoy_change_pct}%` : ""}
                              </span>
                            </div>
                            <div style={{ height: 3, background: "#1a1a1a", borderRadius: 1, marginTop: 2 }}>
                              <div style={{ width: `${pct}%`, height: 3, background: "#f97316", borderRadius: 1 }} />
                            </div>
                            <div style={{ fontSize: 8, color: "#666", marginTop: 1 }}>{(b.biomass_tonnes / 1000).toFixed(0)}K t</div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <div style={{ height: "calc(100vh - 130px)" }}>
                    <ProductionAreaMap areas={areas} localities={localities} selectedTicker={selectedTicker} onTickerSelect={setSelectedTicker} focusLocation={focusLocation} biomassData={mapLayer === "biomass" ? biomassData?.currentTotals : undefined} />
                  </div>
                </div>
              )}

              {tab === "areas" && (() => {
                const CO_COLORS: Record<string, string> = { MOWI: "#f97316", SALM: "#3b82f6", LSG: "#22c55e", GSF: "#ef4444", BAKKA: "#a855f7", AUSS: "#06b6d4" };
                const CO_TICKERS = ["MOWI", "SALM", "LSG", "GSF", "AUSS"];
                // Build site count per area per company from localities
                const areaCo: Record<number, Record<string, number>> = {};
                for (const loc of localities) {
                  const a = loc.productionArea;
                  const tk = loc.ticker;
                  if (!a || !tk || !loc.isActive) continue;
                  if (!areaCo[a]) areaCo[a] = {};
                  areaCo[a][tk] = (areaCo[a][tk] || 0) + 1;
                }
                return (
                <div>
                  {/* Company Presence Matrix */}
                  <div style={S.section}>COMPANY PRESENCE BY AREA</div>
                  <div style={{ padding: "6px 8px", overflowX: "auto" }}>
                    <div style={{ display: "grid", gridTemplateColumns: `52px repeat(${areas.length}, 1fr)`, gap: 2, fontSize: 9 }}>
                      {/* Header: area numbers */}
                      <div style={{ padding: "4px 2px", fontWeight: 700, color: "#555" }}>AREA</div>
                      {areas.map(a => (
                        <div key={a.areaNumber} style={{ textAlign: "center", padding: "2px 0" }}>
                          <div style={{ fontWeight: 700, color: "#888", fontSize: 10 }}>{a.areaNumber}</div>
                          <div style={{ width: 6, height: 6, borderRadius: "50%", background: TL_C[a.trafficLight] || "#333", margin: "2px auto 0" }} />
                        </div>
                      ))}
                      {/* Company rows */}
                      {CO_TICKERS.map(tk => (
                        <React.Fragment key={tk}>
                          <Link href={`/stocks/${tk}`} style={{ padding: "3px 2px", fontWeight: 700, color: CO_COLORS[tk], textDecoration: "none", display: "flex", alignItems: "center", fontSize: 10 }}>{tk}</Link>
                          {areas.map(a => {
                            const sites = areaCo[a.areaNumber]?.[tk] || 0;
                            const totalInArea = Object.values(areaCo[a.areaNumber] || {}).reduce((s, v) => s + v, 0);
                            const maxSites = Math.max(...areas.map(ar => areaCo[ar.areaNumber]?.[tk] || 0), 1);
                            const intensity = sites / maxSites;
                            return (
                              <div
                                key={a.areaNumber}
                                title={sites > 0 ? `${tk}: ${sites} sites in Area ${a.areaNumber} (${totalInArea > 0 ? ((sites / totalInArea) * 100).toFixed(0) : 0}% of area)` : ""}
                                style={{
                                  background: sites > 0 ? `${CO_COLORS[tk]}${Math.round(intensity * 160 + 30).toString(16).padStart(2, "0")}` : "#0a0a0a",
                                  borderRadius: 2,
                                  minHeight: 26,
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                }}
                              >
                                {sites > 0 && <span style={{ fontSize: 10, fontWeight: 700, color: intensity > 0.4 ? "#fff" : "#aaa" }}>{sites}</span>}
                              </div>
                            );
                          })}
                        </React.Fragment>
                      ))}
                    </div>
                    <div style={{ fontSize: 9, color: "#444", textAlign: "center", marginTop: 6, paddingBottom: 4 }}>
                      Number = active farm sites. Color intensity = relative concentration for each company.
                    </div>
                  </div>

                  {/* Area Detail Table */}
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
                  {areas.map(a => {
                    const coInArea = CO_TICKERS.filter(tk => (areaCo[a.areaNumber]?.[tk] || 0) > 0);
                    const totalTracked = coInArea.reduce((s, tk) => s + (areaCo[a.areaNumber]?.[tk] || 0), 0);
                    return (
                    <div key={a.areaNumber}>
                      <div className="sf-row" style={{ display: "grid", gridTemplateColumns: "3px 40px 1fr 70px 70px 70px 60px", padding: "5px 8px", borderBottom: coInArea.length > 0 ? "none" : "1px solid #1a1a1a", alignItems: "center", transition: "background 0.08s" }}>
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
                      {/* Company breakdown bar */}
                      {coInArea.length > 0 && (
                        <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "2px 8px 6px 46px", borderBottom: "1px solid #1a1a1a" }}>
                          {/* Stacked bar */}
                          <div style={{ display: "flex", height: 6, borderRadius: 3, overflow: "hidden", flex: 1, background: "#111" }}>
                            {coInArea.map(tk => {
                              const w = (areaCo[a.areaNumber][tk] / (a.localityCount || totalTracked || 1)) * 100;
                              return <div key={tk} style={{ width: `${w}%`, background: CO_COLORS[tk], minWidth: 2 }} title={`${tk}: ${areaCo[a.areaNumber][tk]} sites`} />;
                            })}
                          </div>
                          {/* Company labels */}
                          <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                            {coInArea.map(tk => (
                              <Link key={tk} href={`/stocks/${tk}`} style={{ display: "flex", alignItems: "center", gap: 3, textDecoration: "none", fontSize: 9 }}>
                                <span style={{ width: 6, height: 6, borderRadius: 1, background: CO_COLORS[tk], display: "inline-block" }} />
                                <span style={{ color: CO_COLORS[tk], fontWeight: 600 }}>{tk}</span>
                                <span style={{ color: "#555" }}>{areaCo[a.areaNumber][tk]}</span>
                              </Link>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                    );
                  })}
                </div>
                );
              })()}

              {tab === "biomass" && (
                <div>
                  {/* ─── Export Price ──────────────────────────────── */}
                  <div style={S.section}>SSB SALMON EXPORT PRICE (FRESH)</div>
                  {exportData?.timeSeries && exportData.timeSeries.length > 0 ? (
                    <div style={{ padding: "10px 12px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
                        <div>
                          <span style={{ fontSize: 22, fontWeight: 700, color: "#f97316" }}>
                            NOK {exportData.stats.currentPrice?.toFixed(2) ?? "\u2014"}
                          </span>
                          <span style={{ color: "#666", fontSize: 11, marginLeft: 8 }}>/kg</span>
                        </div>
                        <div style={{ display: "flex", gap: 16, fontSize: 11 }}>
                          <span><span style={{ color: "#666" }}>52W H</span> <span style={{ color: "#22c55e" }}>{exportData.stats.high52w?.toFixed(2)}</span></span>
                          <span><span style={{ color: "#666" }}>52W L</span> <span style={{ color: "#ef4444" }}>{exportData.stats.low52w?.toFixed(2)}</span></span>
                          <span><span style={{ color: "#666" }}>AVG</span> <span style={{ color: "#aaa" }}>{exportData.stats.avg52w}</span></span>
                        </div>
                      </div>
                      {(() => {
                        const pts = exportData.timeSeries.filter(d => d.price_nok_kg != null).slice(-104);
                        if (pts.length < 2) return <div style={{ color: "#555", padding: 16 }}>Insufficient data</div>;
                        const prices = pts.map(p => p.price_nok_kg!);
                        const vols = pts.map(p => p.volume_tonnes || 0);
                        const minP = Math.min(...prices); const maxP = Math.max(...prices);
                        const maxV = Math.max(...vols);
                        const hov = hoveredExportIdx != null ? pts[hoveredExportIdx] : null;
                        // Date ticks: every ~3 months
                        const dateTicks: { idx: number; label: string }[] = [];
                        let lastQ = "";
                        pts.forEach((p, i) => {
                          const d = p.week_start?.slice(0, 7) || "";
                          const q = d.slice(0, 4) + "-Q" + (Math.floor((parseInt(d.slice(5, 7)) - 1) / 3));
                          if (q !== lastQ) { dateTicks.push({ idx: i, label: d }); lastQ = q; }
                        });
                        return (
                          <div style={{ position: "relative" }} onMouseLeave={() => setHoveredExportIdx(null)} onMouseMove={trackMouse}>
                            {/* Hover tooltip follows mouse */}
                            {hov && hoveredExportIdx != null && (
                              <div style={{
                                position: "absolute",
                                left: mousePos.x > mousePos.cw * 0.65 ? mousePos.x - 16 : mousePos.x + 16,
                                top: Math.max(4, mousePos.y - 44),
                                transform: mousePos.x > mousePos.cw * 0.65 ? "translateX(-100%)" : "none",
                                zIndex: 10,
                                background: "#111e", border: "1px solid #333", borderRadius: 4, padding: "8px 12px",
                                fontSize: 12, lineHeight: 1.6, pointerEvents: "none", whiteSpace: "nowrap"
                              }}>
                                <div style={{ color: "#aaa", fontWeight: 700 }}>{hov.week_start?.slice(0, 10)}</div>
                                <div style={{ color: "#f97316" }}>Price: NOK {hov.price_nok_kg?.toFixed(2)}/kg</div>
                                <div style={{ color: "#6366f1" }}>Volume: {((hov.volume_tonnes || 0) / 1000).toFixed(1)}K t</div>
                              </div>
                            )}
                            <svg viewBox="0 0 100 40" preserveAspectRatio="none" style={{ width: "100%", height: 180, display: "block" }}>
                              {/* Volume bars */}
                              {pts.map((p, i) => {
                                const x = (i / (pts.length - 1)) * 100;
                                const bw = Math.max(0.3, 100 / pts.length * 0.7);
                                const bh = maxV > 0 ? ((p.volume_tonnes || 0) / maxV) * 10 : 0;
                                return <rect key={i} x={x - bw / 2} y={40 - bh} width={bw} height={bh} fill={hoveredExportIdx === i ? "#2a2a5a" : "#1a1a3a"} />;
                              })}
                              {/* Price line */}
                              <path d={pts.map((p, i) => {
                                const x = (i / (pts.length - 1)) * 100;
                                const y = 38 - ((p.price_nok_kg! - minP) / (maxP - minP || 1)) * 34;
                                return `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
                              }).join(" ")} fill="none" stroke="#f97316" strokeWidth={0.4} vectorEffect="non-scaling-stroke" />
                              {/* Hover crosshair */}
                              {hoveredExportIdx != null && (
                                <line x1={(hoveredExportIdx / (pts.length - 1)) * 100} y1={0} x2={(hoveredExportIdx / (pts.length - 1)) * 100} y2={40} stroke="#555" strokeWidth={0.15} strokeDasharray="0.5,0.5" vectorEffect="non-scaling-stroke" />
                              )}
                              {/* Hit targets */}
                              {pts.map((_, i) => (
                                <rect key={`h${i}`} x={(i / (pts.length - 1)) * 100 - 50 / pts.length} y={0} width={100 / pts.length} height={40} fill="transparent" onMouseEnter={() => setHoveredExportIdx(i)} style={{ cursor: "crosshair" }} />
                              ))}
                            </svg>
                            {/* Y-axis labels as HTML */}
                            <div style={{ position: "absolute", top: 4, left: 6, fontSize: 11, color: "#666", fontWeight: 600, pointerEvents: "none" }}>{maxP.toFixed(0)}</div>
                            <div style={{ position: "absolute", bottom: 44, left: 6, fontSize: 11, color: "#666", pointerEvents: "none" }}>{minP.toFixed(0)}</div>
                            {/* Date ticks as HTML */}
                            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#555", marginTop: 6, paddingBottom: 2 }}>
                              {dateTicks.map((t, i) => (
                                <span key={i}>{t.label}</span>
                              ))}
                            </div>
                            <div style={{ textAlign: "center", fontSize: 10, color: "#444", marginTop: 2 }}>WEEKLY EXPORT PRICE + VOLUME</div>
                          </div>
                        );
                      })()}
                    </div>
                  ) : (
                    <div style={{ padding: "16px 10px", color: "#555", fontSize: 11 }}>No export price data available.</div>
                  )}

                  {/* ─── Biomass Distribution Map ──────────────────── */}
                  <div style={{ ...S.section, marginTop: 8 }}>BIOMASS DISTRIBUTION MAP</div>
                  <div style={{ padding: "6px 10px" }}>
                    <div style={{ height: 380, border: "1px solid #222", borderRadius: 4, overflow: "hidden" }}>
                      <ProductionAreaMap areas={areas} localities={[]} selectedTicker={null} onTickerSelect={() => {}} biomassData={biomassData?.currentTotals} />
                    </div>
                    <div style={{ fontSize: 9, color: "#555", marginTop: 4, textAlign: "center" }}>
                      Circle size = standing biomass by production area. Click circles for details.
                    </div>
                  </div>

                  {/* ─── National Biomass Trend ────────────────────── */}
                  <div style={{ ...S.section, marginTop: 8 }}>NATIONAL BIOMASS TREND (SALMON)</div>
                  {biomassData?.nationalTrend && biomassData.nationalTrend.length > 0 ? (
                    <div style={{ padding: "10px 12px" }}>
                      {/* Summary cards with MoM + YoY */}
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
                        {(() => {
                          const nt = biomassData.nationalTrend;
                          const latest = nt[nt.length - 1];
                          if (!latest) return null;
                          const prev = nt.length > 1 ? nt[nt.length - 2] : null;
                          const yoyPrev = nt.length > 12 ? nt[nt.length - 13] : null;
                          const pctChg = (cur: number, ref: number | undefined) => ref && ref > 0 ? ((cur - ref) / ref * 100) : null;
                          const fmtChg = (v: number | null, suffix = "%") => v != null ? `${v >= 0 ? "+" : ""}${v.toFixed(1)}${suffix}` : null;
                          const chgColor = (v: number | null) => v != null ? (v >= 0 ? "#22c55e" : "#ef4444") : "#666";
                          return [
                            { label: "STANDING BIOMASS", value: `${(Number(latest.total_biomass || 0) / 1000).toFixed(0)}K t`, color: "#f97316",
                              mom: fmtChg(pctChg(Number(latest.total_biomass), prev ? Number(prev.total_biomass) : undefined)), momC: chgColor(pctChg(Number(latest.total_biomass), prev ? Number(prev.total_biomass) : undefined)),
                              yoy: fmtChg(pctChg(Number(latest.total_biomass), yoyPrev ? Number(yoyPrev.total_biomass) : undefined)), yoyC: chgColor(pctChg(Number(latest.total_biomass), yoyPrev ? Number(yoyPrev.total_biomass) : undefined)) },
                            { label: "MONTHLY HARVEST", value: `${(Number(latest.total_harvest || 0) / 1000).toFixed(0)}K t`, color: "#3b82f6",
                              mom: fmtChg(pctChg(Number(latest.total_harvest), prev ? Number(prev.total_harvest) : undefined)), momC: chgColor(pctChg(Number(latest.total_harvest), prev ? Number(prev.total_harvest) : undefined)),
                              yoy: fmtChg(pctChg(Number(latest.total_harvest), yoyPrev ? Number(yoyPrev.total_harvest) : undefined)), yoyC: chgColor(pctChg(Number(latest.total_harvest), yoyPrev ? Number(yoyPrev.total_harvest) : undefined)) },
                            { label: "FEED CONSUMPTION", value: `${(Number(latest.total_feed || 0) / 1000).toFixed(0)}K t`, color: "#8b5cf6",
                              mom: fmtChg(pctChg(Number(latest.total_feed), prev ? Number(prev.total_feed) : undefined)), momC: chgColor(pctChg(Number(latest.total_feed), prev ? Number(prev.total_feed) : undefined)),
                              yoy: fmtChg(pctChg(Number(latest.total_feed), yoyPrev ? Number(yoyPrev.total_feed) : undefined)), yoyC: chgColor(pctChg(Number(latest.total_feed), yoyPrev ? Number(yoyPrev.total_feed) : undefined)) },
                            { label: "STOCK COUNT", value: `${(Number(latest.total_stock || 0) / 1000000).toFixed(0)}M fish`, color: "#22c55e",
                              mom: fmtChg(pctChg(Number(latest.total_stock), prev ? Number(prev.total_stock) : undefined)), momC: chgColor(pctChg(Number(latest.total_stock), prev ? Number(prev.total_stock) : undefined)),
                              yoy: fmtChg(pctChg(Number(latest.total_stock), yoyPrev ? Number(yoyPrev.total_stock) : undefined)), yoyC: chgColor(pctChg(Number(latest.total_stock), yoyPrev ? Number(yoyPrev.total_stock) : undefined)) },
                          ].map((card, i) => (
                            <div key={i} style={{ background: "#111", border: "1px solid #222", borderRadius: 4, padding: "12px 16px" }}>
                              <div style={{ fontSize: 9, color: "#666", letterSpacing: "0.06em", fontWeight: 700 }}>{card.label}</div>
                              <div style={{ fontSize: 24, fontWeight: 700, color: card.color, marginTop: 4 }}>{card.value}</div>
                              <div style={{ display: "flex", gap: 12, marginTop: 6, fontSize: 11 }}>
                                {card.mom && <span style={{ color: card.momC }}>{card.mom} <span style={{ color: "#555" }}>MoM</span></span>}
                                {card.yoy && <span style={{ color: card.yoyC }}>{card.yoy} <span style={{ color: "#555" }}>YoY</span></span>}
                              </div>
                            </div>
                          ));
                        })()}
                      </div>

                      {/* Enhanced biomass chart: dual Y-axis, feed line, mortality area, tooltips */}
                      {(() => {
                        const pts = biomassData.nationalTrend;
                        const bios = pts.map(p => Number(p.total_biomass));
                        const harvs = pts.map(p => Number(p.total_harvest));
                        const feeds = pts.map(p => Number(p.total_feed));
                        const morts = pts.map(p => {
                          const hm = harvestData?.national?.find(h => h.month === p.month);
                          return hm ? Number(hm.total_mortality || 0) : 0;
                        });
                        const maxB = Math.max(...bios); const minB = Math.min(...bios);
                        const maxR = Math.max(...harvs, ...feeds, ...morts);
                        const hovP = hoveredBioIdx != null ? pts[hoveredBioIdx] : null;
                        const hovHm = hovP ? harvestData?.national?.find(h => h.month === hovP.month) : null;
                        // Date ticks every ~3 months
                        const dateTicks: { idx: number; label: string }[] = [];
                        let lastBQ = "";
                        pts.forEach((p, i) => {
                          const m = p.month?.slice(0, 7) || "";
                          const q = m.slice(0, 4) + "-Q" + Math.floor((parseInt(m.slice(5, 7) || "1") - 1) / 3);
                          if (q !== lastBQ) { dateTicks.push({ idx: i, label: m }); lastBQ = q; }
                        });
                        // Normalized coordinates (0-100 x, 0-50 y)
                        const yB = (v: number) => 48 - ((v - minB) / (maxB - minB || 1)) * 44;
                        const yR = (v: number) => 48 - (v / (maxR || 1)) * 44;
                        const xP = (i: number) => (i / (pts.length - 1)) * 100;
                        return (
                          <div style={{ position: "relative", marginTop: 4 }} onMouseLeave={() => setHoveredBioIdx(null)} onMouseMove={trackMouse}>
                            {/* HTML tooltip follows mouse */}
                            {hovP && hoveredBioIdx != null && (
                              <div style={{
                                position: "absolute",
                                left: mousePos.x > mousePos.cw * 0.6 ? mousePos.x - 16 : mousePos.x + 16,
                                top: Math.max(4, mousePos.y - 60),
                                transform: mousePos.x > mousePos.cw * 0.6 ? "translateX(-100%)" : "none",
                                zIndex: 10,
                                background: "#111e", border: "1px solid #333", borderRadius: 4, padding: "10px 14px",
                                fontSize: 12, lineHeight: 1.7, pointerEvents: "none", whiteSpace: "nowrap"
                              }}>
                                <div style={{ color: "#aaa", fontWeight: 700, marginBottom: 2 }}>{hovP.month?.slice(0, 7)}</div>
                                <div style={{ color: "#f97316" }}>Biomass: {(Number(hovP.total_biomass) / 1000).toFixed(0)}K t</div>
                                <div style={{ color: "#3b82f6" }}>Harvest: {(Number(hovP.total_harvest) / 1000).toFixed(0)}K t</div>
                                <div style={{ color: "#8b5cf6" }}>Feed: {(Number(hovP.total_feed) / 1000).toFixed(0)}K t</div>
                                <div style={{ color: "#ef4444" }}>Mortality: {(morts[hoveredBioIdx] / 1000).toFixed(0)}K t</div>
                                <div style={{ color: "#22c55e" }}>Stock: {(Number(hovP.total_stock) / 1e6).toFixed(0)}M fish</div>
                                {hovHm && <div style={{ color: "#666", fontSize: 10, marginTop: 2 }}>FCR: {Number(hovHm.feed_conversion_ratio || 0).toFixed(2)} | Mort: {Number(hovHm.mortality_rate_pct || 0).toFixed(1)}%</div>}
                              </div>
                            )}
                            {/* Y-axis labels as HTML */}
                            <div style={{ position: "absolute", top: 2, left: 4, fontSize: 11, color: "#f97316", fontWeight: 700, pointerEvents: "none" }}>{(maxB / 1000).toFixed(0)}K</div>
                            <div style={{ position: "absolute", bottom: 24, left: 4, fontSize: 11, color: "#f97316", pointerEvents: "none" }}>{(minB / 1000).toFixed(0)}K</div>
                            <div style={{ position: "absolute", top: 2, right: 4, fontSize: 11, color: "#3b82f6", fontWeight: 700, pointerEvents: "none" }}>{(maxR / 1000).toFixed(0)}K</div>
                            <div style={{ position: "absolute", bottom: 24, right: 4, fontSize: 11, color: "#3b82f6", pointerEvents: "none" }}>0</div>
                            <svg viewBox="0 0 100 50" preserveAspectRatio="none" style={{ width: "100%", height: 280, display: "block" }}>
                              {/* Mortality area */}
                              <path d={`M${pts.map((_, i) => `${xP(i).toFixed(2)},${yR(morts[i]).toFixed(2)}`).join(" L")} L100,${yR(0).toFixed(2)} L0,${yR(0).toFixed(2)} Z`} fill="#ef4444" opacity={0.06} />
                              {/* Harvest bars */}
                              {pts.map((p, i) => {
                                const bh = yR(0) - yR(Number(p.total_harvest));
                                const bw = Math.max(0.25, 100 / pts.length * 0.5);
                                return <rect key={i} x={xP(i) - bw / 2} y={yR(Number(p.total_harvest))} width={bw} height={Math.max(0, bh)} fill={hoveredBioIdx === i ? "#2a4a2a" : "#1a2a1a"} />;
                              })}
                              {/* Feed line (dashed) */}
                              <path d={pts.map((p, i) => `${i === 0 ? "M" : "L"}${xP(i).toFixed(2)},${yR(Number(p.total_feed)).toFixed(2)}`).join(" ")} fill="none" stroke="#8b5cf6" strokeWidth={0.3} strokeDasharray="1,0.8" vectorEffect="non-scaling-stroke" />
                              {/* Biomass line */}
                              <path d={pts.map((p, i) => `${i === 0 ? "M" : "L"}${xP(i).toFixed(2)},${yB(Number(p.total_biomass)).toFixed(2)}`).join(" ")} fill="none" stroke="#f97316" strokeWidth={0.5} vectorEffect="non-scaling-stroke" />
                              {/* Hover crosshair */}
                              {hoveredBioIdx != null && (
                                <line x1={xP(hoveredBioIdx)} y1={0} x2={xP(hoveredBioIdx)} y2={50} stroke="#555" strokeWidth={0.15} strokeDasharray="0.5,0.5" vectorEffect="non-scaling-stroke" />
                              )}
                              {/* Hit targets */}
                              {pts.map((_, i) => (
                                <rect key={`bh${i}`} x={xP(i) - 50 / pts.length} y={0} width={100 / pts.length} height={50} fill="transparent" onMouseEnter={() => setHoveredBioIdx(i)} style={{ cursor: "crosshair" }} />
                              ))}
                            </svg>
                            {/* Date ticks + legend as HTML */}
                            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#555", marginTop: 4 }}>
                              {dateTicks.map((t, i) => <span key={i}>{t.label}</span>)}
                            </div>
                            <div style={{ display: "flex", justifyContent: "center", gap: 18, fontSize: 10, color: "#555", marginTop: 4, paddingBottom: 6 }}>
                              <span><span style={{ display: "inline-block", width: 14, height: 2, background: "#f97316", marginRight: 5, verticalAlign: "middle" }} />BIOMASS</span>
                              <span><span style={{ display: "inline-block", width: 10, height: 10, background: "#1a2a1a", marginRight: 5, verticalAlign: "middle" }} />HARVEST</span>
                              <span><span style={{ display: "inline-block", width: 14, height: 2, background: "#8b5cf6", marginRight: 5, verticalAlign: "middle", borderTop: "1px dashed #8b5cf6" }} />FEED</span>
                              <span><span style={{ display: "inline-block", width: 10, height: 10, background: "rgba(239,68,68,0.12)", marginRight: 5, verticalAlign: "middle" }} />MORTALITY</span>
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  ) : (
                    <div style={{ padding: "16px 10px", color: "#555", fontSize: 11 }}>No biomass data available.</div>
                  )}

                  {/* ─── Biomass by Area (with MoM) ────────────────── */}
                  <div style={{ ...S.section, marginTop: 8 }}>BIOMASS BY PRODUCTION AREA</div>
                  {biomassData?.currentTotals && biomassData.currentTotals.length > 0 ? (
                    <div style={{ padding: "4px 0" }}>
                      <div style={{ display: "grid", gridTemplateColumns: "4px 44px 1fr 80px 72px 68px 68px", padding: "6px 10px", fontSize: 10, fontWeight: 700, color: "#666", textTransform: "uppercase", letterSpacing: "0.06em", background: "#111", borderBottom: "1px solid #222" }}>
                        <div />
                        <div>AREA</div>
                        <div>BIOMASS</div>
                        <div style={{ textAlign: "right" }}>TONNES</div>
                        <div style={{ textAlign: "right" }}>HARVEST</div>
                        <div style={{ textAlign: "right" }}>MoM</div>
                        <div style={{ textAlign: "right" }}>YoY</div>
                      </div>
                      {(() => {
                        // Compute per-area MoM from timeSeries
                        const areaMoM: Record<number, number | null> = {};
                        if (biomassData?.timeSeries) {
                          const byArea = new Map<number, Array<{ month: string; biomass_tonnes: number }>>();
                          for (const row of biomassData.timeSeries) {
                            const list = byArea.get(row.area_number) || [];
                            list.push(row);
                            byArea.set(row.area_number, list);
                          }
                          for (const [areaNum, rows] of byArea) {
                            rows.sort((a, b) => a.month.localeCompare(b.month));
                            const n = rows.length;
                            if (n >= 2) {
                              const cur = Number(rows[n - 1].biomass_tonnes) || 0;
                              const prv = Number(rows[n - 2].biomass_tonnes) || 0;
                              areaMoM[areaNum] = prv > 0 ? ((cur - prv) / prv * 100) : null;
                            }
                          }
                        }
                        const maxBio = Math.max(...biomassData.currentTotals.map(x => Number(x.biomass_tonnes) || 1));
                        return biomassData.currentTotals
                          .sort((a, b) => a.area_number - b.area_number)
                          .map(b => {
                            const pct = (Number(b.biomass_tonnes) / maxBio) * 100;
                            const yoy = biomassData.yoyComparison.find(y => y.area_number === b.area_number);
                            const areaInfo = areas.find(a => a.areaNumber === b.area_number);
                            const mom = areaMoM[b.area_number];
                            return (
                              <div key={b.area_number} className="sf-row" style={{ display: "grid", gridTemplateColumns: "4px 44px 1fr 80px 72px 68px 68px", padding: "7px 10px", borderBottom: "1px solid #1a1a1a", alignItems: "center", transition: "background 0.08s", fontSize: 11 }}>
                                <div style={{ width: 4, minHeight: 18, background: TL_C[areaInfo?.trafficLight || ""] || "#555", borderRadius: 1 }} />
                                <div style={{ fontWeight: 600, fontSize: 12 }}>{b.area_number}</div>
                                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                  <div style={{ flex: 1, height: 10, background: "#1a1a1a", borderRadius: 3 }}>
                                    <div style={{ width: `${pct}%`, height: 10, background: "#f97316", borderRadius: 3, opacity: 0.7 }} />
                                  </div>
                                </div>
                                <div style={{ textAlign: "right", fontWeight: 600 }}>{(Number(b.biomass_tonnes) / 1000).toFixed(1)}K</div>
                                <div style={{ textAlign: "right", color: "#888" }}>{(Number(b.harvest_tonnes) / 1000).toFixed(1)}K</div>
                                <div style={{ textAlign: "right", color: mom != null ? (mom >= 0 ? "#22c55e" : "#ef4444") : "#555" }}>
                                  {mom != null ? `${mom >= 0 ? "+" : ""}${mom.toFixed(1)}%` : "\u2014"}
                                </div>
                                <div style={{ textAlign: "right", color: yoy?.yoy_change_pct != null ? (yoy.yoy_change_pct >= 0 ? "#22c55e" : "#ef4444") : "#888", fontWeight: 600 }}>
                                  {yoy?.yoy_change_pct != null ? `${yoy.yoy_change_pct >= 0 ? "+" : ""}${yoy.yoy_change_pct}%` : "\u2014"}
                                </div>
                              </div>
                            );
                          });
                      })()}
                    </div>
                  ) : (
                    <div style={{ padding: "16px 10px", color: "#555", fontSize: 11 }}>No area biomass data available.</div>
                  )}

                  {/* ─── Harvest & Mortality (Redesigned) ──────────── */}
                  <div style={{ ...S.section, marginTop: 12 }}>HARVEST & MORTALITY ANALYSIS</div>
                  {harvestData?.national && harvestData.national.length > 0 ? (
                    <div style={{ padding: "10px 12px" }}>
                      {/* 4 larger metric cards with MoM/YoY */}
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
                        {(() => {
                          const hn = harvestData.national;
                          const latest = hn[hn.length - 1];
                          if (!latest) return null;
                          const prev = hn.length > 1 ? hn[hn.length - 2] : null;
                          const yoyPrev = hn.length > 12 ? hn[hn.length - 13] : null;
                          const mortRate = Number(latest.mortality_rate_pct) || 0;
                          const mortTonnes = Number(latest.total_mortality || 0);
                          const fcr = Number(latest.feed_conversion_ratio || 0);
                          const harvBioRatio = Number(latest.total_biomass) > 0 ? (Number(latest.total_harvest) / Number(latest.total_biomass) * 100) : 0;
                          const prevMortRate = prev ? Number(prev.mortality_rate_pct) || 0 : null;
                          const yoyMortRate = yoyPrev ? Number(yoyPrev.mortality_rate_pct) || 0 : null;
                          const prevFcr = prev ? Number(prev.feed_conversion_ratio || 0) : null;
                          const yoyFcr = yoyPrev ? Number(yoyPrev.feed_conversion_ratio || 0) : null;
                          const pctChg = (c: number, r: number | null) => r != null && r > 0 ? ((c - r) / r * 100) : null;
                          const ppChg = (c: number, r: number | null) => r != null ? (c - r) : null;
                          const fmtPP = (v: number | null) => v != null ? `${v >= 0 ? "+" : ""}${v.toFixed(2)}pp` : null;
                          const fmtD = (v: number | null) => v != null ? `${v >= 0 ? "+" : ""}${v.toFixed(2)}` : null;
                          const fmtP = (v: number | null) => v != null ? `${v >= 0 ? "+" : ""}${v.toFixed(1)}%` : null;
                          const chgC = (v: number | null, invert = false) => v != null ? ((invert ? v <= 0 : v >= 0) ? "#22c55e" : "#ef4444") : "#555";
                          return [
                            { label: "MORTALITY RATE", value: `${mortRate.toFixed(2)}%`, color: mortRate > 2 ? "#ef4444" : "#f59e0b",
                              mom: fmtPP(ppChg(mortRate, prevMortRate)), momC: chgC(ppChg(mortRate, prevMortRate), true),
                              yoy: fmtPP(ppChg(mortRate, yoyMortRate)), yoyC: chgC(ppChg(mortRate, yoyMortRate), true) },
                            { label: "MONTHLY MORTALITY", value: `${(mortTonnes / 1000).toFixed(0)}K t`, color: "#ef4444",
                              mom: fmtP(pctChg(mortTonnes, prev ? Number(prev.total_mortality) : null)), momC: chgC(pctChg(mortTonnes, prev ? Number(prev.total_mortality) : null), true),
                              yoy: fmtP(pctChg(mortTonnes, yoyPrev ? Number(yoyPrev.total_mortality) : null)), yoyC: chgC(pctChg(mortTonnes, yoyPrev ? Number(yoyPrev.total_mortality) : null), true) },
                            { label: "FEED CONV. RATIO", value: fcr > 0 ? fcr.toFixed(2) : "\u2014", color: "#8b5cf6",
                              mom: fmtD(ppChg(fcr, prevFcr)), momC: chgC(ppChg(fcr, prevFcr), true),
                              yoy: fmtD(ppChg(fcr, yoyFcr)), yoyC: chgC(ppChg(fcr, yoyFcr), true) },
                            { label: "HARVEST / BIOMASS", value: `${harvBioRatio.toFixed(1)}%`, color: "#3b82f6",
                              mom: null, momC: "#555", yoy: null, yoyC: "#555" },
                          ].map((card, i) => (
                            <div key={i} style={{ background: "#111", border: "1px solid #222", borderRadius: 4, padding: "12px 16px" }}>
                              <div style={{ fontSize: 9, color: "#666", letterSpacing: "0.06em", fontWeight: 700 }}>{card.label}</div>
                              <div style={{ fontSize: 24, fontWeight: 700, color: card.color, marginTop: 4 }}>{card.value}</div>
                              <div style={{ display: "flex", gap: 12, marginTop: 6, fontSize: 11 }}>
                                {card.mom && <span style={{ color: card.momC }}>{card.mom} <span style={{ color: "#555" }}>MoM</span></span>}
                                {card.yoy && <span style={{ color: card.yoyC }}>{card.yoy} <span style={{ color: "#555" }}>YoY</span></span>}
                              </div>
                            </div>
                          ));
                        })()}
                      </div>

                      {/* Mortality trend chart */}
                      <div style={{ fontSize: 10, color: "#666", fontWeight: 700, letterSpacing: "0.06em", marginBottom: 6 }}>MORTALITY TREND</div>
                      {(() => {
                        const pts = harvestData.national;
                        if (pts.length < 2) return <div style={{ color: "#555", padding: 16 }}>Insufficient data</div>;
                        const mortRates = pts.map(p => Number(p.mortality_rate_pct) || 0);
                        const mortTonnes = pts.map(p => Number(p.total_mortality || 0));
                        const maxRate = Math.max(...mortRates); const minRate = Math.min(...mortRates);
                        const maxTonnes = Math.max(...mortTonnes);
                        const hovMP = hoveredMortIdx != null ? pts[hoveredMortIdx] : null;
                        // Date ticks
                        const mDateTicks: { idx: number; label: string }[] = [];
                        let lastMQ = "";
                        pts.forEach((p, i) => {
                          const m = p.month?.slice(0, 7) || "";
                          const q = m.slice(0, 4) + "-Q" + Math.floor((parseInt(m.slice(5, 7) || "1") - 1) / 3);
                          if (q !== lastMQ) { mDateTicks.push({ idx: i, label: m }); lastMQ = q; }
                        });
                        const yR2 = (v: number) => 48 - ((v - minRate) / (maxRate - minRate || 1)) * 44;
                        const yT2 = (v: number) => 48 - (v / (maxTonnes || 1)) * 44;
                        const xP2 = (i: number) => (i / (pts.length - 1)) * 100;
                        return (
                          <div style={{ position: "relative" }} onMouseLeave={() => setHoveredMortIdx(null)} onMouseMove={trackMouse}>
                            {/* HTML tooltip follows mouse */}
                            {hovMP && hoveredMortIdx != null && (
                              <div style={{
                                position: "absolute",
                                left: mousePos.x > mousePos.cw * 0.6 ? mousePos.x - 16 : mousePos.x + 16,
                                top: Math.max(4, mousePos.y - 50),
                                transform: mousePos.x > mousePos.cw * 0.6 ? "translateX(-100%)" : "none",
                                zIndex: 10,
                                background: "#111e", border: "1px solid #333", borderRadius: 4, padding: "10px 14px",
                                fontSize: 12, lineHeight: 1.7, pointerEvents: "none", whiteSpace: "nowrap"
                              }}>
                                <div style={{ color: "#aaa", fontWeight: 700, marginBottom: 2 }}>{hovMP.month?.slice(0, 7)}</div>
                                <div style={{ color: "#ef4444" }}>Mort Rate: {(Number(hovMP.mortality_rate_pct) || 0).toFixed(2)}%</div>
                                <div style={{ color: "#ef4444" }}>Mortality: {(Number(hovMP.total_mortality || 0) / 1000).toFixed(0)}K t</div>
                                <div style={{ color: "#8b5cf6" }}>FCR: {Number(hovMP.feed_conversion_ratio || 0).toFixed(2)}</div>
                                <div style={{ color: "#3b82f6" }}>Harvest: {(Number(hovMP.total_harvest || 0) / 1000).toFixed(0)}K t</div>
                              </div>
                            )}
                            {/* Y-axis labels as HTML */}
                            <div style={{ position: "absolute", top: 2, left: 4, fontSize: 11, color: "#ef4444", fontWeight: 700, pointerEvents: "none" }}>{maxRate.toFixed(1)}%</div>
                            <div style={{ position: "absolute", bottom: 24, left: 4, fontSize: 11, color: "#ef4444", pointerEvents: "none" }}>{minRate.toFixed(1)}%</div>
                            <div style={{ position: "absolute", top: 2, right: 4, fontSize: 11, color: "#666", pointerEvents: "none" }}>{(maxTonnes / 1000).toFixed(0)}K t</div>
                            <svg viewBox="0 0 100 50" preserveAspectRatio="none" style={{ width: "100%", height: 240, display: "block" }}>
                              <path d={`M${pts.map((_, i) => `${xP2(i).toFixed(2)},${yT2(mortTonnes[i]).toFixed(2)}`).join(" L")} L100,${yT2(0).toFixed(2)} L0,${yT2(0).toFixed(2)} Z`} fill="#ef4444" opacity={0.1} />
                              <path d={pts.map((_, i) => `${i === 0 ? "M" : "L"}${xP2(i).toFixed(2)},${yR2(mortRates[i]).toFixed(2)}`).join(" ")} fill="none" stroke="#ef4444" strokeWidth={0.5} vectorEffect="non-scaling-stroke" />
                              {hoveredMortIdx != null && (
                                <line x1={xP2(hoveredMortIdx)} y1={0} x2={xP2(hoveredMortIdx)} y2={50} stroke="#555" strokeWidth={0.15} strokeDasharray="0.5,0.5" vectorEffect="non-scaling-stroke" />
                              )}
                              {pts.map((_, i) => (
                                <rect key={`mh${i}`} x={xP2(i) - 50 / pts.length} y={0} width={100 / pts.length} height={50} fill="transparent" onMouseEnter={() => setHoveredMortIdx(i)} style={{ cursor: "crosshair" }} />
                              ))}
                            </svg>
                            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#555", marginTop: 4 }}>
                              {mDateTicks.map((t, i) => <span key={i}>{t.label}</span>)}
                            </div>
                            <div style={{ display: "flex", justifyContent: "center", gap: 18, fontSize: 10, color: "#555", marginTop: 4, paddingBottom: 6 }}>
                              <span><span style={{ display: "inline-block", width: 14, height: 2, background: "#ef4444", marginRight: 5, verticalAlign: "middle" }} />MORTALITY RATE</span>
                              <span><span style={{ display: "inline-block", width: 10, height: 10, background: "rgba(239,68,68,0.12)", marginRight: 5, verticalAlign: "middle" }} />MORTALITY TONNES</span>
                            </div>
                          </div>
                        );
                      })()}

                      {/* Area-by-area harvest comparison table */}
                      {harvestData.yoyComparison.length > 0 && (
                        <>
                          <div style={{ fontSize: 10, color: "#666", fontWeight: 700, letterSpacing: "0.06em", marginTop: 20, marginBottom: 6 }}>HARVEST COMPARISON BY AREA (12-MONTH ROLLING)</div>
                          <div style={{ display: "grid", gridTemplateColumns: "4px 40px 1fr 84px 84px 68px 74px", padding: "6px 10px", fontSize: 10, fontWeight: 700, color: "#666", textTransform: "uppercase", letterSpacing: "0.06em", background: "#111", borderBottom: "1px solid #222" }}>
                            <div />
                            <div>AREA</div>
                            <div>NAME</div>
                            <div style={{ textAlign: "right" }}>12M HARVEST</div>
                            <div style={{ textAlign: "right" }}>12M PRIOR</div>
                            <div style={{ textAlign: "right" }}>YoY</div>
                            <div style={{ textAlign: "right" }}>MORT RATE</div>
                          </div>
                          {harvestData.yoyComparison
                            .sort((a, b) => a.area_number - b.area_number)
                            .map(y => {
                              const areaInfo = areas.find(a => a.areaNumber === y.area_number);
                              // Compute area mortality rate from latest month of byArea
                              const areaRows = harvestData.byArea?.filter(r => r.area_number === y.area_number) || [];
                              const latestRow = areaRows.sort((a, b) => b.month.localeCompare(a.month))[0];
                              const mortRate = latestRow && Number(latestRow.biomass_tonnes) > 0
                                ? (Number(latestRow.mortality_tonnes) / Number(latestRow.biomass_tonnes) * 100) : null;
                              return (
                                <div key={y.area_number} className="sf-row" style={{ display: "grid", gridTemplateColumns: "4px 40px 1fr 84px 84px 68px 74px", padding: "7px 10px", borderBottom: "1px solid #1a1a1a", alignItems: "center", transition: "background 0.08s", fontSize: 11 }}>
                                  <div style={{ width: 4, minHeight: 18, background: TL_C[areaInfo?.trafficLight || ""] || "#555", borderRadius: 1 }} />
                                  <div style={{ fontWeight: 600, fontSize: 12 }}>{y.area_number}</div>
                                  <div style={{ color: "#aaa", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{areaInfo?.name ?? "\u2014"}</div>
                                  <div style={{ textAlign: "right", fontWeight: 600 }}>{(Number(y.recent_harvest) / 1000).toFixed(1)}K</div>
                                  <div style={{ textAlign: "right", color: "#888" }}>{(Number(y.prior_harvest) / 1000).toFixed(1)}K</div>
                                  <div style={{ textAlign: "right", color: y.yoy_change_pct != null ? (y.yoy_change_pct >= 0 ? "#22c55e" : "#ef4444") : "#888", fontWeight: 600 }}>
                                    {y.yoy_change_pct != null ? `${y.yoy_change_pct >= 0 ? "+" : ""}${Number(y.yoy_change_pct).toFixed(1)}%` : "\u2014"}
                                  </div>
                                  <div style={{ textAlign: "right", color: mortRate != null ? (mortRate > 2 ? "#ef4444" : mortRate > 1.5 ? "#f59e0b" : "#22c55e") : "#555", fontWeight: 600 }}>
                                    {mortRate != null ? `${mortRate.toFixed(2)}%` : "\u2014"}
                                  </div>
                                </div>
                              );
                            })}
                        </>
                      )}
                    </div>
                  ) : (
                    <div style={{ padding: "16px 10px", color: "#555", fontSize: 11 }}>No harvest data available.</div>
                  )}
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
              <div style={S.section}>RISK SCORES <span style={{ fontWeight: 400, color: "#555" }}>(click to filter map)</span></div>
              <div style={{ padding: "4px 0" }}>
                {sortedCompanies.map(co => {
                  const isActive = selectedTicker === co.ticker;
                  return (
                  <div key={co.ticker} onClick={() => setSelectedTicker(isActive ? null : co.ticker)} style={{ display: "grid", gridTemplateColumns: "48px 1fr 36px", padding: "3px 10px", fontSize: 10, borderBottom: "1px solid #111", cursor: "pointer", background: isActive ? "#1a1a2a" : undefined }}>
                    <span style={{ color: "#58a6ff", fontWeight: 600 }}>{co.ticker}</span>
                    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <div style={{ flex: 1, height: 3, background: "#1a1a1a", borderRadius: 1 }}>
                        <div style={{ width: `${Math.min(100, co.riskScore ?? 0)}%`, height: 3, background: getRiskColor(co.riskScore), borderRadius: 1 }} />
                      </div>
                    </div>
                    <span style={{ textAlign: "right", color: getRiskColor(co.riskScore), fontWeight: 700 }}>{co.riskScore?.toFixed(0) ?? "\u2014"}</span>
                  </div>
                  );
                })}
              </div>

              {/* Biomass Summary */}
              {biomassData?.nationalTrend && biomassData.nationalTrend.length > 0 && (() => {
                const latest = biomassData.nationalTrend[biomassData.nationalTrend.length - 1];
                if (!latest) return null;
                return (
                  <>
                    <div style={S.section}>BIOMASS</div>
                    <div style={{ padding: "6px 10px", fontSize: 10 }}>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2px 12px" }}>
                        <span style={{ color: "#666" }}>STANDING</span>
                        <span style={{ textAlign: "right", color: "#f97316", fontWeight: 600 }}>{((latest.total_biomass || 0) / 1000).toFixed(0)}K t</span>
                        <span style={{ color: "#666" }}>HARVEST/M</span>
                        <span style={{ textAlign: "right" }}>{((latest.total_harvest || 0) / 1000).toFixed(0)}K t</span>
                        <span style={{ color: "#666" }}>STOCK</span>
                        <span style={{ textAlign: "right" }}>{(Number(latest.total_stock || 0) / 1000000).toFixed(1)}M fish</span>
                      </div>
                    </div>
                  </>
                );
              })()}

              {/* Export Price */}
              {exportData?.stats?.currentPrice != null && (
                <>
                  <div style={S.section}>EXPORT PRICE</div>
                  <div style={{ padding: "6px 10px", fontSize: 10 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                      <span style={{ fontSize: 16, fontWeight: 700, color: "#f97316" }}>
                        {exportData.stats.currentPrice.toFixed(2)}
                      </span>
                      <span style={{ color: "#666", fontSize: 9 }}>NOK/kg</span>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2px 12px", marginTop: 4 }}>
                      <span style={{ color: "#666" }}>52W H</span>
                      <span style={{ textAlign: "right", color: "#22c55e" }}>{exportData.stats.high52w?.toFixed(2)}</span>
                      <span style={{ color: "#666" }}>52W L</span>
                      <span style={{ textAlign: "right", color: "#ef4444" }}>{exportData.stats.low52w?.toFixed(2)}</span>
                    </div>
                  </div>
                </>
              )}

              {/* Data Sources */}
              <div style={S.section}>DATA SOURCES</div>
              <div style={{ padding: "6px 10px", fontSize: 9, color: "#555", lineHeight: 1.6 }}>
                SSB (salmon export prices)<br />
                BarentsWatch (lice, disease)<br />
                Fiskeridirektoratet (biomass, localities)<br />
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
