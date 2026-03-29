"use client";

import React, { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import PageNav from "@/components/ui/PageNav";
import { SkeletonBlock, SkeletonCard } from "@/components/ui/Skeleton";
import ShippingMap from "@/components/ShippingMap";
import type { VesselMapItem, PortItem } from "@/components/ShippingMap";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

type Overview = {
  totalVessels: number;
  avgFleetAge: number;
  atSeaCount: number;
  atSeaPct: number;
  inPortCount: number;
  fleetUtilization: number;
  bdi: { value: number; change: number } | null;
  bdti: { value: number; change: number } | null;
  bcti: { value: number; change: number } | null;
};

type Company = {
  ticker: string;
  company_name: string;
  sector: string;
  fleet_size: number;
  fleet_owned: number;
  avg_vessel_age: number;
  total_dwt: number;
  color_hex: string;
  avg_tce: number | null;
  contract_coverage_pct: number | null;
  spot_exposure_pct: number | null;
  stock_price: number | null;
  stock_change_pct: number | null;
};

type ContractItem = {
  imo: string;
  vessel_name: string;
  vessel_type: string;
  vessel_class: string | null;
  company_ticker: string;
  company_name: string;
  sector: string;
  color_hex: string;
  dwt: number | null;
  teu: number | null;
  cbm: number | null;
  contract_type: string;
  rate_usd_per_day: number | null;
  rate_worldscale: number | null;
  charterer: string | null;
  contract_start: string | null;
  contract_end: string | null;
  days_remaining: number | null;
  rate_vs_spot_pct: number | null;
  spot_rate: number | null;
};

type MarketRateStats = {
  latest: number;
  high: number;
  low: number;
  avg: number;
  latestDate: string;
};

type CompanyRate = {
  ticker: string;
  vessel_class: string;
  rate_type: string;
  rate_usd_per_day: number;
  contract_coverage_pct: number | null;
  spot_exposure_pct: number | null;
  vessels_in_class: number | null;
  quarter: string;
};

type ExposureCell = {
  ticker: string;
  vessel_class: string;
  company_rate: number;
  spot_rate: number;
  delta_pct: number;
};

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

const SECTOR_COLORS: Record<string, string> = {
  tanker: "#ef4444",
  dry_bulk: "#3b82f6",
  container: "#a855f7",
  car_carrier: "#eab308",
  chemical: "#14b8a6",
  gas: "#22c55e",
};

const SECTOR_LABELS: Record<string, string> = {
  tanker: "TANKER",
  dry_bulk: "BULK",
  container: "CONTAINER",
  car_carrier: "CAR",
  chemical: "CHEMICAL",
  gas: "GAS",
};

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function fmtRate(v: number | null): string {
  if (v == null) return "\u2014";
  return "$" + v.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function fmtPct(v: number | null): string {
  if (v == null) return "\u2014";
  return `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
}

function fmtNum(v: number | null): string {
  if (v == null) return "\u2014";
  return v.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function fmtDate(v: string | null): string {
  if (!v) return "\u2014";
  try {
    const d = new Date(v);
    return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" });
  } catch {
    return v;
  }
}

function fmtDwt(v: number | null): string {
  if (v == null) return "\u2014";
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(0)}K`;
  return v.toFixed(0);
}

function daysColor(d: number | null): string {
  if (d == null) return "rgba(255,255,255,0.35)";
  if (d < 90) return "#ef4444";
  if (d < 180) return "#f59e0b";
  return "rgba(255,255,255,0.5)";
}

function deltaColor(v: number | null): string {
  if (v == null) return "rgba(255,255,255,0.35)";
  if (v > 10) return "#22c55e";
  if (v > 0) return "#4ade80";
  if (v > -10) return "#fca5a5";
  return "#ef4444";
}

function deltaBg(v: number | null): string {
  if (v == null) return "transparent";
  if (v > 10) return "rgba(34,197,94,0.12)";
  if (v > 0) return "rgba(34,197,94,0.06)";
  if (v > -10) return "rgba(239,68,68,0.06)";
  return "rgba(239,68,68,0.12)";
}

/* ------------------------------------------------------------------ */
/* Generic sort helper                                                 */
/* ------------------------------------------------------------------ */

function sortBy<T>(arr: T[], col: string, asc: boolean, accessor: (item: T, col: string) => number | string | null): T[] {
  return [...arr].sort((a, b) => {
    const va = accessor(a, col);
    const vb = accessor(b, col);
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    if (typeof va === "string" && typeof vb === "string") {
      return asc ? va.localeCompare(vb) : vb.localeCompare(va);
    }
    return asc ? (va as number) - (vb as number) : (vb as number) - (va as number);
  });
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function ShippingPage() {
  /* state */
  const [overview, setOverview] = useState<Overview | null>(null);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [positions, setPositions] = useState<VesselMapItem[]>([]);
  const [contracts, setContracts] = useState<ContractItem[]>([]);
  const [marketRates, setMarketRates] = useState<Record<string, { date: string; value: number }[]>>({});
  const [marketStats, setMarketStats] = useState<Record<string, MarketRateStats>>({});
  const [rateDays, setRateDays] = useState(30);
  const [yoyRates, setYoyRates] = useState<Record<string, { oneYearAgo: number; current: number; changePct: number }>>({});
  const [companyRates, setCompanyRates] = useState<CompanyRate[]>([]);
  const [ports, setPorts] = useState<PortItem[]>([]);
  const [exposureMatrix, setExposureMatrix] = useState<ExposureCell[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [tab, setTab] = useState<"overview" | "map" | "rates" | "contracts" | "earnings">("overview");
  const [spotScenario, setSpotScenario] = useState(0); // % change on top of current spot rates
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);
  const [selectedSector, setSelectedSector] = useState<string | null>(null);
  const [focusVessel, setFocusVessel] = useState<{ lat: number; lng: number; name: string } | null>(null);
  const [companySort, setCompanySort] = useState<{ col: string; asc: boolean }>({ col: "fleet_size", asc: false });
  const [contractSort, setContractSort] = useState<{ col: string; asc: boolean }>({ col: "company_ticker", asc: true });
  const [contractGroup, setContractGroup] = useState(true);
  // All positions are AIS-verified (no fake estimated positions)

  const [hoveredRateIdx, setHoveredRateIdx] = useState<{ key: string; idx: number } | null>(null);
  const [mousePos, setMousePos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  /* ─── Data loading ────────────────────────────────────────────── */

  useEffect(() => {
    const sf = async (url: string) => {
      try {
        const r = await fetch(url);
        return r.ok ? r.json() : null;
      } catch {
        return null;
      }
    };
    async function load() {
      try {
        // Batch 1: core data (load sequentially to avoid dev server overload)
        const [ov, co, pos, con] = await Promise.all([
          sf("/api/shipping/overview"),
          sf("/api/shipping/companies"),
          sf("/api/shipping/positions"),
          sf("/api/shipping/contracts"),
        ]);
        if (ov) setOverview(ov);
        setCompanies(co?.companies || []);
        setPositions(pos?.positions || []);
        setContracts(con?.contracts || []);
        setLoading(false);

        // Batch 2: supplementary data (loads after page is visible)
        const rateIndices = "BDI,BDTI,BCTI,CAPESIZE_5TC,VLCC_TD3C_TCE,SUEZMAX_TD20_TCE,AFRAMAX_TCE,LR2_TCE,MR_TC2_TCE,PANAMAX_TCE,ULTRAMAX_TCE,VLGC_ME_ASIA,LNG_SPOT_TFDE,SCFI,BRENT,IRON_ORE";
        const [mr, yoy, cr, pt, em] = await Promise.all([
          sf(`/api/shipping/rates/market?index=${rateIndices}&days=${rateDays}`),
          sf(`/api/shipping/rates/market?index=${rateIndices}&days=400`),
          sf("/api/shipping/rates/company?quarters=8"),
          sf("/api/shipping/ports"),
          sf("/api/shipping/exposure-matrix"),
        ]);
        if (mr) {
          setMarketRates(mr.series || {});
          setMarketStats(mr.stats || {});
        }
        // Compute YoY: value ~365 days ago vs latest
        if (yoy?.series) {
          const yoyMap: Record<string, { oneYearAgo: number; current: number; changePct: number }> = {};
          const now = Date.now();
          const targetMs = now - 365 * 86400000;
          for (const [idx, pts] of Object.entries(yoy.series as Record<string, { date: string; value: number }[]>)) {
            if (!pts || pts.length < 2) continue;
            const current = pts[pts.length - 1].value;
            // Find point closest to 1Y ago
            let closest = pts[0];
            let bestDiff = Infinity;
            for (const p of pts) {
              const diff = Math.abs(new Date(p.date).getTime() - targetMs);
              if (diff < bestDiff) { bestDiff = diff; closest = p; }
            }
            // Only use if the closest point is within 30 days of the target
            if (bestDiff < 30 * 86400000 && closest.value > 0) {
              yoyMap[idx] = {
                oneYearAgo: closest.value,
                current,
                changePct: ((current - closest.value) / closest.value) * 100,
              };
            }
          }
          setYoyRates(yoyMap);
        }
        setCompanyRates(cr?.data || []);
        setPorts(pt?.ports || []);
        setExposureMatrix(em?.matrix || []);
      } catch (err) {
        setError(String(err));
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [rateDays]);

  /* ─── Derived data ────────────────────────────────────────────── */

  const segments = useMemo(() => {
    const map: Record<string, { count: number; fleet: number }> = {};
    for (const c of companies) {
      if (!map[c.sector]) map[c.sector] = { count: 0, fleet: 0 };
      map[c.sector].count++;
      map[c.sector].fleet += c.fleet_size;
    }
    return map;
  }, [companies]);

  const sortedCompanies = useMemo(() => {
    return sortBy(companies, companySort.col, companySort.asc, (c, col) => {
      switch (col) {
        case "ticker": return c.ticker;
        case "company_name": return c.company_name;
        case "sector": return c.sector;
        case "fleet_size": return c.fleet_size;
        case "fleet_owned": return c.fleet_owned;
        case "avg_vessel_age": return c.avg_vessel_age;
        case "avg_tce": return c.avg_tce;
        case "contract_coverage_pct": return c.contract_coverage_pct;
        case "stock_price": return c.stock_price;
        case "stock_change_pct": return c.stock_change_pct;
        default: return null;
      }
    });
  }, [companies, companySort]);

  const sortedContracts = useMemo(() => {
    return sortBy(contracts, contractSort.col, contractSort.asc, (c, col) => {
      switch (col) {
        case "company_ticker": return c.company_ticker;
        case "vessel_name": return c.vessel_name;
        case "vessel_type": return c.vessel_type;
        case "vessel_class": return c.vessel_class;
        case "dwt": return c.dwt;
        case "contract_type": return c.contract_type;
        case "rate_usd_per_day": return c.rate_usd_per_day;
        case "spot_rate": return c.spot_rate;
        case "charterer": return c.charterer;
        case "contract_start": return c.contract_start;
        case "contract_end": return c.contract_end;
        case "days_remaining": return c.days_remaining;
        case "rate_vs_spot_pct": return c.rate_vs_spot_pct;
        default: return null;
      }
    });
  }, [contracts, contractSort]);

  const groupedContracts = useMemo(() => {
    if (!contractGroup) return null;
    const groups: Record<string, ContractItem[]> = {};
    for (const c of sortedContracts) {
      if (!groups[c.company_ticker]) groups[c.company_ticker] = [];
      groups[c.company_ticker].push(c);
    }
    return groups;
  }, [sortedContracts, contractGroup]);

  const avgTcCoverage = useMemo(() => {
    const vals = companies.filter(c => c.contract_coverage_pct != null).map(c => c.contract_coverage_pct!);
    return vals.length > 0 ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
  }, [companies]);

  /* unique vessel classes from exposure matrix */
  const vesselClasses = useMemo(() => {
    const set = new Set<string>();
    for (const e of exposureMatrix) set.add(e.vessel_class);
    return Array.from(set).sort();
  }, [exposureMatrix]);

  /* unique tickers from exposure matrix */
  const exposureTickers = useMemo(() => {
    const set = new Set<string>();
    for (const e of exposureMatrix) set.add(e.ticker);
    return Array.from(set).sort();
  }, [exposureMatrix]);

  /* map vessels for selected ticker */
  const selectedCompanyVessels = useMemo(() => {
    if (!selectedTicker) return [];
    return positions.filter(p => p.company_ticker === selectedTicker);
  }, [positions, selectedTicker]);

  /* rate index keys for charts */
  const rateKeys = useMemo(() => Object.keys(marketRates).sort(), [marketRates]);

  /* ─── Styles ──────────────────────────────────────────────────── */

  const S = {
    page: { minHeight: "100vh", background: "#0a0a0a", color: "#fff", fontFamily: "monospace", fontSize: 12 } as React.CSSProperties,
    container: { maxWidth: 1400, margin: "0 auto", padding: "20px 16px" } as React.CSSProperties,
    header: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid #30363d" } as React.CSSProperties,
    title: { fontSize: 18, fontWeight: 700, letterSpacing: "0.08em", color: "#3b82f6" } as React.CSSProperties,
    badge: (bg: string, fg = "#fff") => ({ fontSize: 9, fontWeight: 700, padding: "1px 5px", borderRadius: 2, background: bg, color: fg, letterSpacing: "0.04em" }) as React.CSSProperties,
    section: { fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.6)", letterSpacing: "0.08em", textTransform: "uppercase" as const, padding: "8px 10px 4px", borderBottom: "1px solid #21262d" } as React.CSSProperties,
    tabBtn: (active: boolean) => ({ padding: "6px 14px", borderRadius: 4, border: "none", borderBottom: active ? "2px solid #3b82f6" : "2px solid transparent", background: "transparent", color: active ? "#3b82f6" : "rgba(255,255,255,0.5)", fontFamily: "monospace", fontSize: 10, fontWeight: 700, cursor: "pointer", letterSpacing: "0.04em" }) as React.CSSProperties,
  };

  /* ─── Sort header helper ──────────────────────────────────────── */

  const SortHeader = ({ label, col, sort, setSort, style }: { label: string; col: string; sort: { col: string; asc: boolean }; setSort: (s: { col: string; asc: boolean }) => void; style?: React.CSSProperties }) => (
    <div
      style={{ cursor: "pointer", userSelect: "none", ...style }}
      onClick={() => setSort({ col, asc: sort.col === col ? !sort.asc : false })}
    >
      {label}
      {sort.col === col && (
        <span style={{ marginLeft: 2, fontSize: 8 }}>{sort.asc ? "\u25B2" : "\u25BC"}</span>
      )}
    </div>
  );

  /* ─── Loading / Error ─────────────────────────────────────────── */

  if (loading) {
    return (
      <main style={S.page}>
        <div style={S.container}>
          <style>{`@keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}`}</style>
          <div style={S.header}><span style={S.title}>SHIPPING INTELLIGENCE</span></div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12, padding: "16px 0" }}>
            <SkeletonCard /><SkeletonCard /><SkeletonCard /><SkeletonCard />
          </div>
          <SkeletonBlock height={300} style={{ marginBottom: 16 }} />
          <SkeletonBlock height={200} />
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main style={S.page}>
        <div style={S.container}>
          <div style={S.header}><span style={S.title}>SHIPPING INTELLIGENCE</span></div>
          <div style={{ padding: "40px 0", textAlign: "center", color: "#ef4444" }}>Error: {error}</div>
        </div>
      </main>
    );
  }

  /* ─── SVG chart helper ────────────────────────────────────────── */

  function renderRateChart(key: string, series: { date: string; value: number }[], width: string, height: number, accentColor: string) {
    if (!series || series.length < 2) {
      return <div style={{ height, display: "flex", alignItems: "center", justifyContent: "center", color: "rgba(255,255,255,0.35)", fontSize: 10 }}>No data</div>;
    }
    const vals = series.map(s => s.value);
    const minV = Math.min(...vals);
    const maxV = Math.max(...vals);
    const range = maxV - minV || 1;
    const stats = marketStats[key];
    const hIdx = hoveredRateIdx?.key === key ? hoveredRateIdx.idx : -1;

    return (
      <div style={{ position: "relative" }}>
        {/* Y-axis labels above chart */}
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 8, color: "rgba(255,255,255,0.35)", padding: "0 2px", marginBottom: 2 }}>
          <span>{fmtNum(maxV)}</span>
        </div>
        <div
          style={{ height, cursor: "crosshair" }}
          onMouseMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const xRel = (e.clientX - rect.left) / rect.width;
            const idx = Math.round(xRel * (series.length - 1));
            const clamped = Math.max(0, Math.min(series.length - 1, idx));
            setHoveredRateIdx({ key, idx: clamped });
            setMousePos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
          }}
          onMouseLeave={() => setHoveredRateIdx(null)}
        >
          <svg viewBox="0 0 100 40" preserveAspectRatio="none" style={{ width: "100%", height: "100%", display: "block" }}>
            <defs>
              <linearGradient id={`grad-${key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={accentColor} stopOpacity="0.15" />
                <stop offset="100%" stopColor={accentColor} stopOpacity="0.01" />
              </linearGradient>
            </defs>
            <path
              d={
                series.map((s, i) => {
                  const x = (i / (series.length - 1)) * 100;
                  const y = 38 - ((s.value - minV) / range) * 34;
                  return `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
                }).join(" ") + ` L100,40 L0,40 Z`
              }
              fill={`url(#grad-${key})`}
            />
            <path
              d={series.map((s, i) => {
                const x = (i / (series.length - 1)) * 100;
                const y = 38 - ((s.value - minV) / range) * 34;
                return `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
              }).join(" ")}
              fill="none"
              stroke={accentColor}
              strokeWidth={0.4}
              vectorEffect="non-scaling-stroke"
            />
            {hIdx >= 0 && (() => {
              const x = (hIdx / (series.length - 1)) * 100;
              const y = 38 - ((series[hIdx].value - minV) / range) * 34;
              return (
                <>
                  <line x1={x} y1={0} x2={x} y2={40} stroke="rgba(255,255,255,0.35)" strokeWidth={0.3} vectorEffect="non-scaling-stroke" />
                  <circle cx={x} cy={y} r={0.8} fill={accentColor} />
                </>
              );
            })()}
          </svg>
        </div>
        {/* Tooltip */}
        {hIdx >= 0 && (
          <div style={{
            position: "absolute",
            top: 4,
            right: 8,
            background: "#161b22",
            border: "1px solid #30363d",
            borderRadius: 4,
            padding: "4px 8px",
            pointerEvents: "none",
            zIndex: 10,
          }}>
            <div style={{ fontSize: 9, color: "rgba(255,255,255,0.5)" }}>{series[hIdx].date}</div>
            <div style={{ fontSize: 12, fontWeight: 700, color: accentColor }}>{fmtNum(series[hIdx].value)}</div>
          </div>
        )}
        {/* Stats bar below chart */}
        {stats && (
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: "rgba(255,255,255,0.35)", marginTop: 6, padding: "0 2px" }}>
            <span>Avg<span style={{ color: "rgba(255,255,255,0.5)", marginLeft: 3 }}>{fmtNum(stats.avg)}</span></span>
            <span>H <span style={{ color: "#22c55e" }}>{fmtNum(stats.high)}</span></span>
            <span>L <span style={{ color: "#ef4444" }}>{fmtNum(stats.low)}</span></span>
            <span style={{ color: "rgba(255,255,255,0.4)" }}>{fmtDate(stats.latestDate)}</span>
          </div>
        )}
      </div>
    );
  }

  /* ================================================================ */
  /* RENDER                                                            */
  /* ================================================================ */

  return (
    <>
      <style>{`
        .sh-row:hover { background: rgba(59,130,246,0.08) !important; }
        @media (max-width: 1000px) { .sh-grid { grid-template-columns: 1fr !important; } }
        @keyframes sh-fade-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        .sh-tab-content { animation: sh-fade-in 0.35s ease-out; }
      `}</style>
      <main style={S.page}>
        <div style={S.container}>

          {/* ─── Header Bar ─────────────────────────────────── */}
          <div style={S.header}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <PageNav crumbs={[{ label: "Home", href: "/" }, { label: "Shipping" }]} />
              <span style={{ width: 8 }} />
              <span style={{ ...S.badge("#0d1117"), color: "#22c55e", border: "1px solid #22c55e33" }}>
                {positions.filter(p => p.latitude != null).length} AIS TRACKED
              </span>
              <span style={{ ...S.badge("#0d1117"), color: "rgba(255,255,255,0.5)", border: "1px solid #30363d" }}>
                {positions.length} FLEET
              </span>
              <span style={{ ...S.badge("#0d1117"), color: "rgba(255,255,255,0.5)", border: "1px solid #30363d" }}>
                {Object.keys(segments).length} SEGMENTS
              </span>
            </div>
            <div style={{ display: "flex", gap: 12, fontSize: 10, alignItems: "center" }}>
              {[
                { label: "BDI", key: "BDI", color: "#3b82f6", data: overview?.bdi },
                { label: "BDTI", key: "BDTI", color: "#3b82f6", data: overview?.bdti },
                { label: "BCTI", key: "BCTI", color: "#a855f7", data: overview?.bcti },
              ].map((idx, i) => (
                <React.Fragment key={idx.key}>
                  {i > 0 && <span style={{ color: "#30363d" }}>|</span>}
                  <span style={{ color: "rgba(255,255,255,0.5)" }}>{idx.label}</span>
                  <span style={{ color: idx.color, fontWeight: 600 }}>{idx.data ? fmtNum(idx.data.value) : "\u2014"}</span>
                  {idx.data && <span style={{ color: idx.data.change >= 0 ? "#22c55e" : "#ef4444", fontWeight: 600 }}>{fmtPct(idx.data.change)}</span>}
                </React.Fragment>
              ))}
              <span style={{ color: "#30363d" }}>|</span>
              {/* Commodity benchmarks from market rates */}
              {(() => {
                const brent = marketStats["BRENT"];
                const iron = marketStats["IRON_ORE"];
                return (
                  <>
                    <span style={{ color: "rgba(255,255,255,0.5)" }}>BRENT</span>
                    <span style={{ color: "#eab308", fontWeight: 600 }}>{brent ? `$${brent.latest.toFixed(1)}` : "\u2014"}</span>
                    <span style={{ color: "#30363d" }}>|</span>
                    <span style={{ color: "rgba(255,255,255,0.5)" }}>IRON</span>
                    <span style={{ color: "#94a3b8", fontWeight: 600 }}>{iron ? `$${iron.latest.toFixed(1)}` : "\u2014"}</span>
                  </>
                );
              })()}
            </div>
          </div>

          {/* ─── Tab Bar ────────────────────────────────────── */}
          <div style={{ display: "flex", gap: 6, padding: "6px 8px", background: "#0d1117", borderBottom: "1px solid #30363d", alignItems: "center" }}>
            {(["overview", "map", "rates", "contracts", "earnings"] as const).map(t => (
              <button key={t} style={S.tabBtn(tab === t)} onClick={() => setTab(t)}>
                {{ overview: "OVERVIEW", map: "MAP & FLEET", rates: "RATES", contracts: "CONTRACTS", earnings: "EARNINGS CALC" }[t]}
              </button>
            ))}
            <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 8, color: "rgba(255,255,255,0.35)", letterSpacing: "0.06em" }}>AIS FEED</span>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: positions.filter(p => p.latitude != null).length > 0 ? "#22c55e" : "#ef4444", display: "inline-block" }} />
            </div>
          </div>

          {/* ================================================================ */}
          {/* OVERVIEW TAB                                                     */}
          {/* ================================================================ */}
          {tab === "overview" && (
            <div key="overview" className="sh-tab-content">

              {/* KPI Cards Row */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 8, padding: "10px 8px", borderBottom: "1px solid #30363d" }}>
                {/* Total Vessels */}
                <div style={{ background: "#0d1117", border: "1px solid #21262d", borderRadius: 4, padding: "8px 10px" }}>
                  <div style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>TOTAL VESSELS</div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: "#3b82f6", marginTop: 2 }}>{positions.length}</div>
                  <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", marginTop: 2 }}>{companies.length} companies tracked</div>
                </div>
                {/* Avg Fleet Age */}
                <div style={{ background: "#0d1117", border: "1px solid #21262d", borderRadius: 4, padding: "8px 10px" }}>
                  <div style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>AVG FLEET AGE</div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: "#3b82f6", marginTop: 2 }}>{overview?.avgFleetAge?.toFixed(1) ?? "\u2014"} yr</div>
                  <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", marginTop: 2 }}>across fleet</div>
                </div>
                {/* At Sea % */}
                <div style={{ background: "#0d1117", border: "1px solid #21262d", borderRadius: 4, padding: "8px 10px" }}>
                  <div style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>AT SEA</div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: "#22c55e", marginTop: 2 }}>{overview?.atSeaPct?.toFixed(0) ?? "\u2014"}%</div>
                  <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", marginTop: 2 }}>{fmtNum(overview?.atSeaCount ?? null)} vessels</div>
                </div>
                {/* Fleet Utilization */}
                <div style={{ background: "#0d1117", border: "1px solid #21262d", borderRadius: 4, padding: "8px 10px" }}>
                  <div style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>UTILIZATION</div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: (overview?.fleetUtilization ?? 0) >= 90 ? "#22c55e" : "#f59e0b", marginTop: 2 }}>{overview?.fleetUtilization?.toFixed(0) ?? "\u2014"}%</div>
                  <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", marginTop: 2 }}>fleet utilization</div>
                </div>
                {/* BDI */}
                <div style={{ background: "#0d1117", border: "1px solid #21262d", borderRadius: 4, padding: "8px 10px" }}>
                  <div style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>BDI INDEX</div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: "#3b82f6", marginTop: 2 }}>{overview?.bdi ? fmtNum(overview.bdi.value) : "\u2014"}</div>
                  {overview?.bdi && (
                    <div style={{ fontSize: 10, color: overview.bdi.change >= 0 ? "#22c55e" : "#ef4444", marginTop: 2 }}>
                      {fmtPct(overview.bdi.change)}
                    </div>
                  )}
                </div>
                {/* TC Coverage avg */}
                <div style={{ background: "#0d1117", border: "1px solid #21262d", borderRadius: 4, padding: "8px 10px" }}>
                  <div style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>TC COVERAGE AVG</div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: "#a855f7", marginTop: 2 }}>{avgTcCoverage != null ? `${avgTcCoverage.toFixed(0)}%` : "\u2014"}</div>
                  <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", marginTop: 2 }}>contract coverage</div>
                </div>
              </div>

              {/* Market Pulse — ticker-tape style rate cards */}
              {(() => {
                const rateCards: { label: string; key: string; color: string; unit: string; prefix?: string }[] = [
                  { label: "BDI", key: "BDI", color: "#c0c0c0", unit: "pts" },
                  { label: "VLCC TCE", key: "VLCC_TD3C_TCE", color: "#c0c0c0", unit: "/day", prefix: "$" },
                  { label: "SUEZMAX", key: "SUEZMAX_TD20_TCE", color: "#c0c0c0", unit: "/day", prefix: "$" },
                  { label: "AFRAMAX", key: "AFRAMAX_TCE", color: "#c0c0c0", unit: "/day", prefix: "$" },
                  { label: "MR TCE", key: "MR_TC2_TCE", color: "#c0c0c0", unit: "/day", prefix: "$" },
                  { label: "CAPESIZE", key: "CAPESIZE_5TC", color: "#c0c0c0", unit: "/day", prefix: "$" },
                  { label: "PANAMAX", key: "PANAMAX_TCE", color: "#c0c0c0", unit: "/day", prefix: "$" },
                  { label: "BDTI", key: "BDTI", color: "#c0c0c0", unit: "pts" },
                  { label: "BCTI", key: "BCTI", color: "#c0c0c0", unit: "pts" },
                  { label: "VLGC", key: "VLGC_ME_ASIA", color: "#c0c0c0", unit: "/day", prefix: "$" },
                  { label: "LNG SPOT", key: "LNG_SPOT_TFDE", color: "#c0c0c0", unit: "/day", prefix: "$" },
                  { label: "SCFI", key: "SCFI", color: "#c0c0c0", unit: "pts" },
                ];
                return (
                  <div style={{ borderBottom: "1px solid #30363d" }}>
                    <div style={{ ...S.section, fontSize: 11 }}>MARKET PULSE — LATEST RATES</div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 0 }}>
                      {rateCards.map((rc, i) => {
                        const stats = marketStats[rc.key];
                        const series = marketRates[rc.key] || [];
                        const latest = stats?.latest ?? series.at(-1)?.value;
                        const prev = series.length >= 2 ? series[series.length - 2]?.value : null;
                        const chg = latest != null && prev != null && prev > 0 ? ((latest - prev) / prev) * 100 : null;
                        const high = stats?.high ?? (series.length > 0 ? Math.max(...series.map(s => s.value)) : null);
                        const low = stats?.low ?? (series.length > 0 ? Math.min(...series.map(s => s.value)) : null);
                        return (
                          <div key={rc.key} style={{
                            padding: "10px 14px",
                            borderRight: "1px solid #21262d",
                            borderBottom: "1px solid #21262d",
                            cursor: "pointer",
                          }} onClick={() => setTab("rates")}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                              <span style={{ fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.35)", letterSpacing: "0.06em" }}>{rc.label}</span>
                              {chg != null && (
                                <span style={{ fontSize: 9, fontWeight: 700, color: chg >= 0 ? "#22c55e" : "#ef4444" }}>
                                  {chg >= 0 ? "\u25B2" : "\u25BC"} {Math.abs(chg).toFixed(1)}%
                                </span>
                              )}
                            </div>
                            <div style={{ fontSize: 20, fontWeight: 700, color: "#fff", lineHeight: 1.1 }}>
                              {latest != null ? `${rc.prefix || ""}${latest >= 1000 ? fmtNum(latest) : latest.toFixed(1)}` : "\u2014"}
                            </div>
                            <div style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", marginTop: 2 }}>{rc.unit}</div>
                            {/* Sparkline */}
                            {series.length >= 2 && (
                              <svg viewBox="0 0 60 16" preserveAspectRatio="none" style={{ width: "100%", height: 28, display: "block", marginTop: 6 }}>
                                <defs>
                                  <linearGradient id={`sp-${rc.key}`} x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%" stopColor={rc.color} stopOpacity="0.2" />
                                    <stop offset="100%" stopColor={rc.color} stopOpacity="0" />
                                  </linearGradient>
                                </defs>
                                {(() => {
                                  const vals = series.map(s => s.value);
                                  const mn = Math.min(...vals), mx = Math.max(...vals), rng = mx - mn || 1;
                                  const pts = series.map((s, j) => {
                                    const x = (j / (series.length - 1)) * 60;
                                    const y = 14 - ((s.value - mn) / rng) * 12;
                                    return `${x.toFixed(1)},${y.toFixed(1)}`;
                                  });
                                  return (
                                    <>
                                      <path d={`M${pts.join(" L")} L60,16 L0,16 Z`} fill={`url(#sp-${rc.key})`} />
                                      <polyline points={pts.join(" ")} fill="none" stroke={rc.color} strokeWidth="0.5" vectorEffect="non-scaling-stroke" />
                                    </>
                                  );
                                })()}
                              </svg>
                            )}
                            {/* H/L range bar */}
                            {high != null && low != null && latest != null && high > low && (
                              <div style={{ marginTop: 6 }}>
                                <div style={{ position: "relative", height: 4, background: "#21262d", borderRadius: 2 }}>
                                  <div style={{
                                    position: "absolute", left: 0, top: 0, height: "100%", borderRadius: 2,
                                    width: `${((latest - low) / (high - low)) * 100}%`,
                                    background: `linear-gradient(90deg, ${rc.color}44, ${rc.color})`,
                                  }} />
                                </div>
                                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 3, fontSize: 8, color: "rgba(255,255,255,0.35)" }}>
                                  <span>L {low >= 1000 ? fmtNum(low) : low.toFixed(0)}</span>
                                  <span>H {high >= 1000 ? fmtNum(high) : high.toFixed(0)}</span>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}

              {/* Mini Map */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0, borderBottom: "1px solid #30363d" }}>
                <div style={{ height: 260, borderRight: "1px solid #30363d", cursor: "pointer" }} onClick={() => setTab("map")}>
                  <ShippingMap
                    positions={positions}
                    ports={[]}
                    selectedTicker={null}
                    selectedSector={null}
                    onTickerSelect={() => {}}
                    onSectorSelect={() => {}}
                    focusVessel={null}
                    compact
                  />
                </div>
                {/* TC Coverage + Exposure snapshot */}
                <div style={{ display: "flex", flexDirection: "column" }}>
                  <div style={{ ...S.section, fontSize: 11 }}>CONTRACT COVERAGE BY COMPANY</div>
                  <div style={{ flex: 1, padding: "4px 10px", overflowY: "auto" }}>
                    {sortedCompanies.map(co => {
                      const tcPct = co.contract_coverage_pct ?? 0;
                      const spotPct = 100 - tcPct;
                      // Calculate from contracts data
                      const coContracts = contracts.filter(c => c.company_ticker === co.ticker);
                      const coTc = coContracts.filter(c => ["time_charter", "coa", "bareboat"].includes(c.contract_type)).length;
                      const coSpot = coContracts.filter(c => ["spot", "voyage_charter"].includes(c.contract_type)).length;
                      const calcTcPct = coContracts.length > 0 ? (coTc / coContracts.length) * 100 : tcPct;
                      const calcSpotPct = 100 - calcTcPct;
                      return (
                        <div key={co.ticker} style={{ marginBottom: 6 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 2 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                              <div style={{ width: 3, height: 12, background: co.color_hex, borderRadius: 1 }} />
                              <span style={{ fontSize: 10, fontWeight: 600, color: co.color_hex }}>{co.ticker}</span>
                              <span style={{ fontSize: 9, color: "rgba(255,255,255,0.35)" }}>{co.fleet_size}v</span>
                            </div>
                            <div style={{ fontSize: 9 }}>
                              <span style={{ color: "#3b82f6", fontWeight: 600 }}>{calcTcPct.toFixed(0)}% TC</span>
                              <span style={{ color: "#30363d", margin: "0 3px" }}>|</span>
                              <span style={{ color: "#f59e0b", fontWeight: 600 }}>{calcSpotPct.toFixed(0)}% Spot</span>
                            </div>
                          </div>
                          <div style={{ height: 4, display: "flex", borderRadius: 2, overflow: "hidden", background: "#21262d" }}>
                            <div style={{ width: `${calcTcPct}%`, background: "#3b82f6", transition: "width 0.3s" }} />
                            <div style={{ width: `${calcSpotPct}%`, background: "#f59e0b", transition: "width 0.3s" }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Company Table */}
              <div>
                <div style={S.section}>COMPANY OVERVIEW</div>
                <div style={{ display: "grid", gridTemplateColumns: "3px 80px 1fr 70px 48px 48px 48px 72px 56px 68px 56px", padding: "4px 8px", fontSize: 9, fontWeight: 600, color: "rgba(255,255,255,0.5)", textTransform: "uppercase", letterSpacing: "0.05em", background: "#0d1117", borderBottom: "1px solid #30363d" }}>
                  <div />
                  <SortHeader label="TICKER" col="ticker" sort={companySort} setSort={setCompanySort} />
                  <SortHeader label="COMPANY" col="company_name" sort={companySort} setSort={setCompanySort} />
                  <div style={{ textAlign: "center" }}>SECTOR</div>
                  <SortHeader label="FLEET" col="fleet_size" sort={companySort} setSort={setCompanySort} style={{ textAlign: "right" }} />
                  <SortHeader label="OWN" col="fleet_owned" sort={companySort} setSort={setCompanySort} style={{ textAlign: "right" }} />
                  <SortHeader label="AGE" col="avg_vessel_age" sort={companySort} setSort={setCompanySort} style={{ textAlign: "right" }} />
                  <SortHeader label="AVG TCE" col="avg_tce" sort={companySort} setSort={setCompanySort} style={{ textAlign: "right" }} />
                  <SortHeader label="TC COV" col="contract_coverage_pct" sort={companySort} setSort={setCompanySort} style={{ textAlign: "right" }} />
                  <SortHeader label="PRICE" col="stock_price" sort={companySort} setSort={setCompanySort} style={{ textAlign: "right" }} />
                  <SortHeader label="CHG" col="stock_change_pct" sort={companySort} setSort={setCompanySort} style={{ textAlign: "right" }} />
                </div>
                {sortedCompanies.map(co => {
                  const isActive = selectedTicker === co.ticker;
                  const sectorCol = SECTOR_COLORS[co.sector] || "rgba(255,255,255,0.5)";
                  return (
                    <div
                      key={co.ticker}
                      className="sh-row"
                      onClick={() => {
                        setSelectedTicker(isActive ? null : co.ticker);
                        if (!isActive) setTab("map");
                      }}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "3px 80px 1fr 70px 48px 48px 48px 72px 56px 68px 56px",
                        padding: "5px 8px",
                        borderBottom: "1px solid #21262d",
                        alignItems: "center",
                        cursor: "pointer",
                        transition: "background 0.08s",
                        background: isActive ? "rgba(59,130,246,0.08)" : undefined,
                        outline: isActive ? "1px solid #30363d" : undefined,
                      }}
                    >
                      <div style={{ width: 3, minHeight: 16, background: co.color_hex || sectorCol, borderRadius: 1 }} />
                      <div>
                        <Link href={`/stocks/${co.ticker}`} style={{ color: co.color_hex || "#3b82f6", textDecoration: "none", fontWeight: 600 }} onClick={e => e.stopPropagation()}>
                          {co.ticker}
                        </Link>
                      </div>
                      <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 10, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {co.company_name?.replace(/\s*ASA\s*$/i, "")}
                      </div>
                      <div style={{ textAlign: "center" }}>
                        <span style={S.badge(sectorCol)}>{SECTOR_LABELS[co.sector] || co.sector.toUpperCase()}</span>
                      </div>
                      <div style={{ textAlign: "right", fontWeight: 600 }}>{co.fleet_size}</div>
                      <div style={{ textAlign: "right", color: "rgba(255,255,255,0.5)" }}>{co.fleet_owned}</div>
                      <div style={{ textAlign: "right", color: co.avg_vessel_age > 15 ? "#f59e0b" : "rgba(255,255,255,0.5)" }}>{co.avg_vessel_age?.toFixed(1) ?? "\u2014"}</div>
                      <div style={{ textAlign: "right", fontWeight: 600, color: "#3b82f6" }}>{fmtRate(co.avg_tce)}</div>
                      <div style={{ textAlign: "right", color: (co.contract_coverage_pct ?? 0) > 50 ? "#22c55e" : "rgba(255,255,255,0.5)" }}>
                        {co.contract_coverage_pct != null ? `${co.contract_coverage_pct.toFixed(0)}%` : "\u2014"}
                      </div>
                      <div style={{ textAlign: "right", fontWeight: 600 }}>
                        {co.stock_price != null ? co.stock_price.toFixed(2) : "\u2014"}
                      </div>
                      <div style={{ textAlign: "right", color: (co.stock_change_pct ?? 0) >= 0 ? "#22c55e" : "#ef4444", fontWeight: 600 }}>
                        {fmtPct(co.stock_change_pct)}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Segment Summary */}
              <div>
                <div style={S.section}>SEGMENTS</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 8, padding: "10px 8px" }}>
                  {Object.entries(SECTOR_LABELS).map(([key, label]) => {
                    const seg = segments[key];
                    if (!seg) return (
                      <div key={key} style={{ background: "#0d1117", border: "1px solid #21262d", borderRadius: 4, padding: "8px 10px", opacity: 0.4 }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: SECTOR_COLORS[key] }}>{label}</div>
                        <div style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", marginTop: 4 }}>No companies</div>
                      </div>
                    );
                    return (
                      <div key={key} style={{ background: "#0d1117", border: "1px solid #21262d", borderRadius: 4, padding: "8px 10px" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <span style={{ fontSize: 10, fontWeight: 700, color: SECTOR_COLORS[key] }}>{label}</span>
                          <span style={{ fontSize: 9, color: "rgba(255,255,255,0.5)" }}>{seg.count} co.</span>
                        </div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: "#fff", marginTop: 4 }}>{seg.fleet} vessels</div>
                        <div style={{ height: 3, background: "#21262d", borderRadius: 2, marginTop: 6, overflow: "hidden" }}>
                          <div style={{ height: "100%", background: SECTOR_COLORS[key], borderRadius: 2, width: `${Math.min(100, (seg.fleet / Math.max(...Object.values(segments).map(s => s.fleet))) * 100)}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* ================================================================ */}
          {/* MAP & FLEET TAB                                                  */}
          {/* ================================================================ */}
          {tab === "map" && (
            <div key="map" className="sh-tab-content sh-grid" style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 0, marginTop: 1 }}>
              {/* Left: Map */}
              <div style={{ height: "calc(100vh - 140px)", minHeight: 600, border: "1px solid #30363d" }}>
                <ShippingMap
                  positions={positions}
                  ports={ports}
                  selectedTicker={selectedTicker}
                  selectedSector={selectedSector}
                  onTickerSelect={setSelectedTicker}
                  onSectorSelect={setSelectedSector}
                  focusVessel={focusVessel}
                />
              </div>

              {/* Right: Fleet detail panel */}
              <div style={{ background: "#0d1117", borderLeft: "1px solid #30363d", overflowY: "auto", maxHeight: "calc(100vh - 140px)" }}>
                {selectedTicker ? (
                  <>
                    <div style={{ ...S.section, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span>FLEET: {selectedTicker}</span>
                      <span style={{ fontSize: 9, color: "rgba(255,255,255,0.5)" }}>{selectedCompanyVessels.length} vessels</span>
                    </div>
                    <div style={{ padding: 0 }}>
                      {/* vessel header */}
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 60px 56px 64px 72px", padding: "4px 8px", fontSize: 9, fontWeight: 600, color: "rgba(255,255,255,0.5)", textTransform: "uppercase", letterSpacing: "0.05em", background: "#0d1117", borderBottom: "1px solid #30363d" }}>
                        <div>VESSEL</div>
                        <div>TYPE</div>
                        <div>STATUS</div>
                        <div style={{ textAlign: "right" }}>RATE</div>
                        <div style={{ textAlign: "right" }}>DEST</div>
                      </div>
                      {selectedCompanyVessels.map(v => (
                        <div
                          key={v.imo}
                          className="sh-row"
                          style={{ display: "grid", gridTemplateColumns: "1fr 60px 56px 64px 72px", padding: "4px 8px", borderBottom: "1px solid #21262d", alignItems: "center", cursor: "pointer", fontSize: 10 }}
                          onClick={() => {
                            if (v.latitude != null && v.longitude != null) {
                              setFocusVessel({ lat: v.latitude, lng: v.longitude, name: v.vessel_name });
                            }
                          }}
                        >
                          <div style={{ color: "#fff", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v.vessel_name}</div>
                          <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 9, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v.vessel_type}</div>
                          <div>
                            <span style={{
                              fontSize: 8, fontWeight: 700, padding: "1px 4px", borderRadius: 2,
                              background: v.status === "at_sea" ? "rgba(34,197,94,0.15)" : v.status === "in_port" ? "rgba(59,130,246,0.15)" : "rgba(107,114,128,0.15)",
                              color: v.status === "at_sea" ? "#22c55e" : v.status === "in_port" ? "#3b82f6" : "rgba(255,255,255,0.5)",
                            }}>
                              {v.status === "at_sea" ? "SEA" : v.status === "in_port" ? "PORT" : v.status?.toUpperCase() || "UNK"}
                            </span>
                          </div>
                          <div style={{ textAlign: "right", color: "#3b82f6", fontWeight: 600 }}>{fmtRate(v.rate_usd_per_day)}</div>
                          <div style={{ textAlign: "right", color: "rgba(255,255,255,0.35)", fontSize: 9, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v.destination_port_name || v.destination || "\u2014"}</div>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <>
                    <div style={S.section}>ALL COMPANIES</div>
                    <div style={{ padding: 0 }}>
                      {companies.map(co => {
                        const vesselCount = positions.filter(p => p.company_ticker === co.ticker).length;
                        const atSea = positions.filter(p => p.company_ticker === co.ticker && p.status === "at_sea").length;
                        return (
                          <div
                            key={co.ticker}
                            className="sh-row"
                            style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 10px", borderBottom: "1px solid #21262d", cursor: "pointer" }}
                            onClick={() => setSelectedTicker(co.ticker)}
                          >
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <div style={{ width: 8, height: 8, borderRadius: "50%", background: co.color_hex || SECTOR_COLORS[co.sector] || "rgba(255,255,255,0.5)" }} />
                              <div>
                                <div style={{ fontWeight: 600, color: co.color_hex || "#fff", fontSize: 11 }}>{co.ticker}</div>
                                <div style={{ color: "rgba(255,255,255,0.35)", fontSize: 9 }}>{co.company_name?.replace(/\s*ASA\s*$/i, "")}</div>
                              </div>
                            </div>
                            <div style={{ textAlign: "right" }}>
                              <div style={{ fontWeight: 600, fontSize: 11 }}>{vesselCount} vessels</div>
                              <div style={{ fontSize: 9, color: "#22c55e" }}>{atSea} at sea</div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {/* ================================================================ */}
          {/* RATES TAB                                                        */}
          {/* ================================================================ */}
          {tab === "rates" && (
            <div key="rates" className="sh-tab-content">

              {/* ── Timeframe Selector ── */}
              <div style={{ display: "flex", gap: 6, padding: "10px 18px", background: "#0a0a0a", borderBottom: "1px solid #30363d", alignItems: "center" }}>
                {([
                  { label: "7D", days: 7 },
                  { label: "30D", days: 30 },
                  { label: "90D", days: 90 },
                  { label: "1Y", days: 365 },
                  { label: "ALL", days: 3650 },
                ] as const).map((tf) => (
                  <button
                    key={tf.label}
                    onClick={() => setRateDays(tf.days)}
                    style={{
                      padding: "3px 10px", fontSize: 10, fontWeight: 700, borderRadius: 999,
                      border: "none", cursor: "pointer", letterSpacing: "0.04em",
                      background: rateDays === tf.days ? "#3b82f6" : "#21262d",
                      color: rateDays === tf.days ? "#fff" : "rgba(255,255,255,0.5)",
                    }}
                  >
                    {tf.label}
                  </button>
                ))}
                <span style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", marginLeft: "auto" }}>TCE $/DAY</span>
              </div>

              {/* ── Key Rates Grid (3x2) ── */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 0 }}>
                {([
                  { label: "VLCC TD3C", key: "VLCC_TD3C_TCE", color: "#ef4444", sub: "MEG \u2192 China", sector: "tanker" },
                  { label: "Suezmax TD20", key: "SUEZMAX_TD20_TCE", color: "#fb923c", sub: "WAF \u2192 UKC", sector: "tanker" },
                  { label: "Aframax", key: "AFRAMAX_TCE", color: "#f59e0b", sub: "Cross-Med", sector: "tanker" },
                  { label: "Capesize 5TC", key: "CAPESIZE_5TC", color: "#3b82f6", sub: "Dry Bulk", sector: "dry_bulk" },
                  { label: "Panamax P4TC", key: "PANAMAX_TCE", color: "#2563eb", sub: "Dry Bulk", sector: "dry_bulk" },
                  { label: "VLGC ME\u2192Asia", key: "VLGC_ME_ASIA", color: "#22c55e", sub: "LPG Carrier", sector: "gas" },
                ] as const).map((rd, i) => {
                  const stats = marketStats[rd.key];
                  const series = marketRates[rd.key] || [];
                  const latest = stats?.latest ?? series.at(-1)?.value;
                  const prev = series.length >= 2 ? series[series.length - 2]?.value : null;
                  const chg = latest != null && prev != null && prev > 0 ? ((latest - prev) / prev) * 100 : null;
                  const high = stats?.high;
                  const low = stats?.low;
                  // Period change (first to last in visible window)
                  const first = series[0]?.value;
                  const periodChg = latest != null && first != null && first > 0 ? ((latest - first) / first) * 100 : null;
                  // Range position (0-100)
                  const rangePct = high != null && low != null && latest != null && high > low ? ((latest - low) / (high - low)) * 100 : null;
                  const sectorCol = SECTOR_COLORS[rd.sector] || "rgba(255,255,255,0.5)";
                  return (
                    <div key={rd.key} style={{
                      borderRight: (i % 3 < 2) ? "1px solid #21262d" : undefined,
                      borderBottom: "1px solid #21262d",
                      padding: "16px 20px 12px",
                    }}>
                      {/* Header */}
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                        <div>
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <div style={{ width: 6, height: 6, borderRadius: "50%", background: sectorCol }} />
                            <span style={{ fontSize: 12, fontWeight: 700, color: rd.color, letterSpacing: "0.02em" }}>{rd.label}</span>
                          </div>
                          <div style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", marginTop: 2, marginLeft: 12 }}>{rd.sub}</div>
                        </div>
                        <div style={{ textAlign: "right" }}>
                          {chg != null && (
                            <div style={{
                              fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 3,
                              background: chg >= 0 ? "rgba(34,197,94,0.12)" : "rgba(239,68,68,0.12)",
                              color: chg >= 0 ? "#22c55e" : "#ef4444",
                              display: "inline-block",
                            }}>
                              {chg >= 0 ? "\u25B2" : "\u25BC"} {Math.abs(chg).toFixed(1)}%
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Rate + Period Change */}
                      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 4 }}>
                        <span style={{ fontSize: 28, fontWeight: 800, color: rd.color, lineHeight: 1 }}>
                          {latest != null ? `$${fmtNum(Math.round(latest))}` : "\u2014"}
                        </span>
                        {periodChg != null && (
                          <span style={{ fontSize: 10, color: periodChg >= 0 ? "#22c55e" : "#ef4444", fontWeight: 600 }}>
                            {periodChg >= 0 ? "+" : ""}{periodChg.toFixed(0)}% period
                          </span>
                        )}
                      </div>

                      {/* YoY comparison */}
                      {(() => {
                        const yoy = yoyRates[rd.key];
                        if (!yoy) return null;
                        const up = yoy.changePct >= 0;
                        return (
                          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8, fontSize: 9, color: "rgba(255,255,255,0.4)" }}>
                            <span>1Y ago <span style={{ color: "rgba(255,255,255,0.5)", fontWeight: 600 }}>${fmtNum(Math.round(yoy.oneYearAgo))}</span></span>
                            <span style={{
                              fontWeight: 700, padding: "1px 5px", borderRadius: 3,
                              background: up ? "rgba(34,197,94,0.08)" : "rgba(239,68,68,0.08)",
                              color: up ? "#22c55e" : "#ef4444",
                            }}>
                              {up ? "\u25B2" : "\u25BC"} {Math.abs(yoy.changePct).toFixed(0)}% YoY
                            </span>
                          </div>
                        );
                      })()}

                      {/* Chart */}
                      <div style={{ marginBottom: 10 }}>
                        {renderRateChart(rd.key, series, "100%", 120, rd.color)}
                      </div>

                      {/* Range bar */}
                      {rangePct != null && (
                        <div style={{ marginBottom: 8 }}>
                          <div style={{ position: "relative", height: 4, background: "#21262d", borderRadius: 2 }}>
                            <div style={{
                              position: "absolute", left: 0, top: 0, height: "100%", borderRadius: 2,
                              width: `${Math.min(100, rangePct)}%`,
                              background: `linear-gradient(90deg, ${rd.color}44, ${rd.color})`,
                            }} />
                            {/* Current position marker */}
                            <div style={{
                              position: "absolute", top: -2, height: 8, width: 2, borderRadius: 1,
                              background: "#fff",
                              left: `${Math.min(98, rangePct)}%`,
                            }} />
                          </div>
                          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: "rgba(255,255,255,0.35)", marginTop: 3 }}>
                            <span>Lo <span style={{ color: "#ef4444" }}>${low != null ? fmtNum(Math.round(low)) : "\u2014"}</span></span>
                            <span>Hi <span style={{ color: "#22c55e" }}>${high != null ? fmtNum(Math.round(high)) : "\u2014"}</span></span>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* ── Company vs Market Rate Table ── */}
              {vesselClasses.length > 0 && (() => {
                const companyTickers = [...new Set(companyRates.map(r => r.ticker))].sort();
                const latestRates: Record<string, Record<string, number>> = {};
                for (const cr of companyRates) {
                  if (!latestRates[cr.ticker]) latestRates[cr.ticker] = {};
                  latestRates[cr.ticker][cr.vessel_class] = cr.rate_usd_per_day;
                }
                const marketLatest: Record<string, number> = {};
                for (const vc of vesselClasses) {
                  const statsKey = Object.keys(marketStats).find(k => k.toLowerCase().includes(vc.toLowerCase().split(" ")[0]));
                  if (statsKey) marketLatest[vc] = marketStats[statsKey].latest;
                }

                return (
                  <div>
                    <div style={S.section}>COMPANY vs MARKET RATES — LATEST QUARTER</div>
                    <div style={{ overflowX: "auto" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10 }}>
                        <thead>
                          <tr style={{ background: "#0d1117" }}>
                            <th style={{ textAlign: "left", padding: "8px 10px", fontWeight: 600, color: "rgba(255,255,255,0.5)", fontSize: 9, letterSpacing: "0.05em", borderBottom: "2px solid #30363d" }}>VESSEL CLASS</th>
                            <th style={{ textAlign: "right", padding: "8px 10px", fontWeight: 600, color: "#3b82f6", fontSize: 9, letterSpacing: "0.05em", borderBottom: "2px solid #30363d" }}>MARKET SPOT</th>
                            {companyTickers.map(t => (
                              <th key={t} style={{ textAlign: "right", padding: "8px 10px", fontWeight: 600, color: companies.find(c => c.ticker === t)?.color_hex || "rgba(255,255,255,0.5)", fontSize: 9, letterSpacing: "0.05em", borderBottom: "2px solid #30363d" }}>{t}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {vesselClasses.map(vc => (
                            <tr key={vc} className="sh-row" style={{ borderBottom: "1px solid #21262d" }}>
                              <td style={{ padding: "6px 10px", fontWeight: 700, color: "rgba(255,255,255,0.7)" }}>{vc}</td>
                              <td style={{ padding: "6px 10px", textAlign: "right", color: "#3b82f6", fontWeight: 700, fontSize: 12 }}>
                                {marketLatest[vc] ? fmtRate(marketLatest[vc]) : "\u2014"}
                              </td>
                              {companyTickers.map(t => {
                                const rate = latestRates[t]?.[vc];
                                const mkt = marketLatest[vc];
                                const delta = rate != null && mkt != null && mkt > 0 ? ((rate - mkt) / mkt) * 100 : null;
                                return (
                                  <td key={t} style={{
                                    padding: "6px 10px", textAlign: "right",
                                    background: delta != null ? (delta > 0 ? "rgba(34,197,94,0.06)" : "rgba(239,68,68,0.06)") : undefined,
                                  }}>
                                    {rate != null ? (
                                      <>
                                        <div style={{ fontWeight: 700, color: delta != null && delta > 0 ? "#22c55e" : delta != null && delta < 0 ? "#ef4444" : "rgba(255,255,255,0.5)", fontSize: 11 }}>
                                          {fmtRate(rate)}
                                        </div>
                                        {delta != null && (
                                          <div style={{ fontSize: 8, fontWeight: 700, color: delta >= 0 ? "#22c55e" : "#ef4444", marginTop: 1 }}>
                                            {delta >= 0 ? "+" : ""}{delta.toFixed(1)}%
                                          </div>
                                        )}
                                      </>
                                    ) : <span style={{ color: "#30363d" }}>{"\u2014"}</span>}
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

            {/* ================================================================ */}
          {/* EARNINGS CALCULATOR TAB                                          */}
          {/* ================================================================ */}
          {tab === "earnings" && (() => {
            // OPEX per vessel type ($/day, industry estimates)
            const OPEX: Record<string, number> = {
              vlcc: 9500, suezmax: 8500, aframax_lr2: 8000, lr2_tanker: 8000,
              mr_tanker: 7000, handy_tanker: 6500, lng_carrier: 20000, vlgc: 11000,
              capesize: 8000, panamax_bulk: 6500, ultramax: 6000, newcastlemax: 8500,
              pctc: 14000, container_feeder: 6500, chemical_tanker: 9000,
            };
            const VOYAGE_COST_PCT = 0.18; // ~18% of spot freight goes to voyage costs

            // Current spot rates by vessel type (from latest Pareto)
            const MARKET_SPOT: Record<string, number> = {
              vlcc: 292700, suezmax: 126600, aframax_lr2: 83000, lr2_tanker: 66700,
              mr_tanker: 30000, handy_tanker: 24000, lng_carrier: 196250, vlgc: 63089,
              capesize: 45000, panamax_bulk: 22621, ultramax: 16213, newcastlemax: 48000,
              pctc: 50000, container_feeder: 18000, chemical_tanker: 26000,
            };

            const scenarioMultiplier = 1 + spotScenario / 100;

            // Build per-company earnings from contracts
            type EarningsRow = {
              ticker: string;
              name: string;
              sector: string;
              color: string;
              fleetSize: number;
              tcVessels: number;
              spotVessels: number;
              tcCovPct: number;
              avgTcRate: number;
              avgSpotRate: number;
              blendedTce: number;
              dailyRevGross: number;
              dailyOpex: number;
              dailyNetTce: number;
              quarterlyRevGross: number;
              quarterlyOpex: number;
              quarterlyNetTce: number;
            };

            const companyMap: Record<string, { ticker: string; name: string; sector: string; color: string; tcRates: number[]; spotRates: number[]; vesselTypes: string[] }> = {};
            for (const c of contracts) {
              if (!companyMap[c.company_ticker]) {
                const co = companies.find(x => x.ticker === c.company_ticker);
                companyMap[c.company_ticker] = {
                  ticker: c.company_ticker,
                  name: co?.company_name || c.company_ticker,
                  sector: c.sector,
                  color: c.color_hex,
                  tcRates: [],
                  spotRates: [],
                  vesselTypes: [],
                };
              }
              const entry = companyMap[c.company_ticker];
              const vtype = c.vessel_type;
              entry.vesselTypes.push(vtype);
              const spotMkt = (MARKET_SPOT[vtype] || 30000) * scenarioMultiplier;
              const tce = c.contract_type === "spot"
                ? spotMkt * (1 - VOYAGE_COST_PCT)
                : (c.rate_usd_per_day || 0);
              if (c.contract_type === "spot") {
                entry.spotRates.push(tce);
              } else {
                entry.tcRates.push(tce);
              }
            }

            const rows: EarningsRow[] = Object.values(companyMap).map(e => {
              const tc = e.tcRates.length;
              const spot = e.spotRates.length;
              const total = tc + spot;
              const avgTc = tc > 0 ? e.tcRates.reduce((a, b) => a + b, 0) / tc : 0;
              const avgSpot = spot > 0 ? e.spotRates.reduce((a, b) => a + b, 0) / spot : 0;
              const allRates = [...e.tcRates, ...e.spotRates];
              const blended = allRates.length > 0 ? allRates.reduce((a, b) => a + b, 0) / allRates.length : 0;

              // Avg OPEX: average over vessel types
              const avgOpex = e.vesselTypes.length > 0
                ? e.vesselTypes.reduce((s, vt) => s + (OPEX[vt] || 8000), 0) / e.vesselTypes.length
                : 8000;

              const dailyGross = blended * total;
              const dailyOpex = avgOpex * total;
              const dailyNet = dailyGross - dailyOpex;

              return {
                ticker: e.ticker,
                name: e.name,
                sector: e.sector,
                color: e.color,
                fleetSize: total,
                tcVessels: tc,
                spotVessels: spot,
                tcCovPct: total > 0 ? (tc / total) * 100 : 0,
                avgTcRate: avgTc,
                avgSpotRate: avgSpot,
                blendedTce: blended,
                dailyRevGross: dailyGross,
                dailyOpex,
                dailyNetTce: dailyNet,
                quarterlyRevGross: dailyGross * 90,
                quarterlyOpex: dailyOpex * 90,
                quarterlyNetTce: dailyNet * 90,
              };
            }).sort((a, b) => b.quarterlyNetTce - a.quarterlyNetTce);

            const totalQNet = rows.reduce((s, r) => s + r.quarterlyNetTce, 0);
            const maxQNet = Math.max(...rows.map(r => Math.abs(r.quarterlyNetTce)));
            const scenarios = [-40, -20, 0, 20, 40, 60];

            return (
              <div key="earnings" className="sh-tab-content">

                {/* Methodology note */}
                <div style={{ padding: "8px 10px", background: "rgba(59,130,246,0.06)", borderBottom: "1px solid #21262d", fontSize: 10, color: "rgba(255,255,255,0.5)" }}>
                  <strong style={{ color: "#3b82f6" }}>METHODOLOGY</strong> — TC vessels earn contracted rate net of OPEX. Spot vessels earn (market rate × (1 − 18% voyage costs)) − OPEX. Market spot rates sourced from Pareto Shipping Daily (2026-03-15). Contract rates are estimated from quarterly fleet reports; not actual disclosed figures. OPEX are industry averages per vessel type.
                </div>

                {/* Spot rate scenario slider */}
                <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 10px", borderBottom: "1px solid #30363d", background: "#0d1117" }}>
                  <span style={{ fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.5)", letterSpacing: "0.06em", whiteSpace: "nowrap" }}>SPOT RATE SCENARIO</span>
                  <div style={{ display: "flex", gap: 4 }}>
                    {scenarios.map(pct => (
                      <button
                        key={pct}
                        onClick={() => setSpotScenario(pct)}
                        style={{
                          padding: "3px 8px", borderRadius: 4, border: "none", cursor: "pointer", fontFamily: "monospace", fontSize: 9, fontWeight: 700,
                          background: spotScenario === pct ? (pct > 0 ? "#22c55e" : pct < 0 ? "#ef4444" : "#3b82f6") : "#21262d",
                          color: spotScenario === pct ? "#000" : "rgba(255,255,255,0.6)",
                        }}
                      >
                        {pct > 0 ? "+" : ""}{pct}%
                      </button>
                    ))}
                  </div>
                  <span style={{ fontSize: 10, color: spotScenario === 0 ? "rgba(255,255,255,0.4)" : spotScenario > 0 ? "#22c55e" : "#ef4444" }}>
                    {spotScenario === 0 ? "BASE CASE (Pareto 15-Mar-2026)" : `Spot rates ${spotScenario > 0 ? "+" : ""}${spotScenario}% vs base`}
                  </span>
                  <div style={{ marginLeft: "auto", fontSize: 9, color: "rgba(255,255,255,0.4)" }}>
                    FLEET QUARTERLY NET TCE: <strong style={{ color: "#3b82f6", fontSize: 11 }}>${(totalQNet / 1e6).toFixed(0)}M</strong>
                  </div>
                </div>

                {/* Earnings table */}
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                    <thead>
                      <tr style={{ borderBottom: "1px solid #30363d", background: "#0d1117" }}>
                        {[
                          ["COMPANY", "left"], ["SECTOR", "left"], ["FLEET", "right"], ["TC%", "right"],
                          ["AVG TC RATE", "right"], ["AVG SPOT TCE", "right"], ["BLENDED TCE", "right"],
                          ["DAILY GROSS", "right"], ["DAILY OPEX", "right"], ["DAILY NET TCE", "right"],
                          ["Q NET TCE ($M)", "right"], ["% OF FLEET TOTAL", "right"],
                        ].map(([h, a]) => (
                          <th key={h} style={{ padding: "6px 10px", textAlign: a as "left" | "right", fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.5)", letterSpacing: "0.05em", whiteSpace: "nowrap" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map(r => {
                        const sharePct = totalQNet > 0 ? (r.quarterlyNetTce / totalQNet) * 100 : 0;
                        return (
                          <tr key={r.ticker} style={{ borderBottom: "1px solid #21262d" }}>
                            <td style={{ padding: "7px 10px" }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                <div style={{ width: 3, height: 14, background: r.color, borderRadius: 1, flexShrink: 0 }} />
                                <span style={{ fontWeight: 700 }}>{r.ticker}</span>
                              </div>
                            </td>
                            <td style={{ padding: "7px 10px" }}>
                              <span style={{ fontSize: 9, fontWeight: 700, padding: "1px 5px", borderRadius: 2, background: SECTOR_COLORS[r.sector] + "25", color: SECTOR_COLORS[r.sector] }}>
                                {SECTOR_LABELS[r.sector] || r.sector}
                              </span>
                            </td>
                            <td style={{ padding: "7px 10px", textAlign: "right", color: "rgba(255,255,255,0.6)" }}>{r.fleetSize} <span style={{ fontSize: 9, color: "rgba(255,255,255,0.3)" }}>({r.tcVessels}TC/{r.spotVessels}S)</span></td>
                            <td style={{ padding: "7px 10px", textAlign: "right" }}>
                              <div style={{ width: 48, height: 6, background: "#21262d", borderRadius: 3, display: "inline-block", verticalAlign: "middle", marginRight: 4, position: "relative", overflow: "hidden" }}>
                                <div style={{ position: "absolute", left: 0, top: 0, height: "100%", width: `${r.tcCovPct}%`, background: "#3b82f6", borderRadius: 3 }} />
                              </div>
                              <span style={{ fontWeight: 600 }}>{r.tcCovPct.toFixed(0)}%</span>
                            </td>
                            <td style={{ padding: "7px 10px", textAlign: "right", color: "#3b82f6", fontWeight: 600 }}>{r.avgTcRate > 0 ? fmtRate(r.avgTcRate) : "—"}</td>
                            <td style={{ padding: "7px 10px", textAlign: "right", color: "#f59e0b", fontWeight: 600 }}>{r.avgSpotRate > 0 ? fmtRate(r.avgSpotRate) : "—"}</td>
                            <td style={{ padding: "7px 10px", textAlign: "right", fontWeight: 700, color: "#fff" }}>{fmtRate(r.blendedTce)}</td>
                            <td style={{ padding: "7px 10px", textAlign: "right", color: "rgba(255,255,255,0.6)" }}>${(r.dailyRevGross / 1000).toFixed(0)}K</td>
                            <td style={{ padding: "7px 10px", textAlign: "right", color: "#ef4444" }}>${(r.dailyOpex / 1000).toFixed(0)}K</td>
                            <td style={{ padding: "7px 10px", textAlign: "right", fontWeight: 700, color: r.dailyNetTce >= 0 ? "#22c55e" : "#ef4444" }}>
                              ${(r.dailyNetTce / 1000).toFixed(0)}K
                            </td>
                            <td style={{ padding: "7px 10px", textAlign: "right" }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "flex-end" }}>
                                <div style={{ width: 60, height: 6, background: "#21262d", borderRadius: 3, position: "relative", overflow: "hidden" }}>
                                  <div style={{ position: "absolute", left: 0, top: 0, height: "100%", width: `${maxQNet > 0 ? (Math.abs(r.quarterlyNetTce) / maxQNet) * 100 : 0}%`, background: r.quarterlyNetTce >= 0 ? "#22c55e" : "#ef4444", borderRadius: 3 }} />
                                </div>
                                <span style={{ fontWeight: 700, color: r.quarterlyNetTce >= 0 ? "#22c55e" : "#ef4444", minWidth: 48, textAlign: "right" }}>
                                  ${(r.quarterlyNetTce / 1e6).toFixed(1)}M
                                </span>
                              </div>
                            </td>
                            <td style={{ padding: "7px 10px", textAlign: "right", color: "rgba(255,255,255,0.5)" }}>{totalQNet > 0 ? sharePct.toFixed(1) : "—"}%</td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr style={{ borderTop: "2px solid #30363d", background: "#0d1117" }}>
                        <td colSpan={10} style={{ padding: "7px 10px", fontWeight: 700, color: "rgba(255,255,255,0.6)", fontSize: 9, letterSpacing: "0.06em" }}>FLEET TOTAL</td>
                        <td style={{ padding: "7px 10px", textAlign: "right", fontWeight: 800, color: "#22c55e", fontSize: 13 }}>${(totalQNet / 1e6).toFixed(1)}M</td>
                        <td style={{ padding: "7px 10px", textAlign: "right", fontWeight: 700, color: "rgba(255,255,255,0.5)" }}>100%</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>

                {/* Sensitivity grid */}
                <div style={{ padding: "10px 10px", borderTop: "1px solid #30363d" }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.6)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>SPOT RATE SENSITIVITY — QUARTERLY NET TCE ($M)</div>
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ borderCollapse: "collapse", fontSize: 10 }}>
                      <thead>
                        <tr style={{ borderBottom: "1px solid #30363d" }}>
                          <th style={{ padding: "5px 10px", textAlign: "left", fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.5)", whiteSpace: "nowrap", minWidth: 80 }}>COMPANY</th>
                          {[-40, -20, 0, 20, 40, 60].map(pct => (
                            <th key={pct} style={{ padding: "5px 10px", textAlign: "right", fontSize: 9, fontWeight: 700, color: pct > 0 ? "#22c55e" : pct < 0 ? "#ef4444" : "#3b82f6", whiteSpace: "nowrap" }}>
                              {pct > 0 ? "+" : ""}{pct}%
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map(r => {
                          return (
                            <tr key={r.ticker} style={{ borderBottom: "1px solid #21262d" }}>
                              <td style={{ padding: "5px 10px", fontWeight: 700, color: r.color }}>{r.ticker}</td>
                              {[-40, -20, 0, 20, 40, 60].map(pct => {
                                // Recalculate with this scenario
                                const mult = 1 + pct / 100;
                                const tcIncome = r.tcVessels * r.avgTcRate;
                                // avgSpotRate was computed with current scenarioMultiplier — normalize back to base, then reapply pct
                                const baseSpotTce = r.spotVessels > 0 && scenarioMultiplier !== 0
                                  ? r.avgSpotRate / scenarioMultiplier
                                  : r.avgSpotRate;
                                const newSpotTce = baseSpotTce * mult;
                                const newBlendedTotal = (tcIncome + r.spotVessels * newSpotTce);
                                const newDailyNet = newBlendedTotal - r.dailyOpex;
                                const qNet = newDailyNet * 90;
                                const isBase = pct === spotScenario;
                                return (
                                  <td key={pct} style={{
                                    padding: "5px 10px", textAlign: "right", fontWeight: 600,
                                    color: qNet >= 0 ? "#22c55e" : "#ef4444",
                                    background: isBase ? "rgba(59,130,246,0.08)" : undefined,
                                  }}>
                                    ${(qNet / 1e6).toFixed(1)}M
                                  </td>
                                );
                              })}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <div style={{ marginTop: 8, fontSize: 9, color: "rgba(255,255,255,0.35)" }}>
                    Scenario assumes spot rate change applies to all spot-exposed vessels. TC vessels locked at contracted rates (no change). Voyage costs = 18% of gross spot freight.
                  </div>
                </div>

              </div>
            );
          })()}

          {/* ================================================================ */}
          {/* CONTRACTS TAB                                                    */}
          {/* ================================================================ */}
          {tab === "contracts" && (
            <div key="contracts" className="sh-tab-content">

              {/* Summary Stats Bar */}
              {(() => {
                const tcContracts = contracts.filter(c => ["time_charter", "coa", "bareboat"].includes(c.contract_type));
                const spotContracts = contracts.filter(c => ["spot", "voyage_charter"].includes(c.contract_type));
                const withRate = contracts.filter(c => c.rate_usd_per_day != null);
                const avgRate = withRate.length > 0 ? withRate.reduce((s, c) => s + (c.rate_usd_per_day ?? 0), 0) / withRate.length : null;
                const aboveSpot = contracts.filter(c => (c.rate_vs_spot_pct ?? 0) > 0).length;
                const belowSpot = contracts.filter(c => c.rate_vs_spot_pct != null && c.rate_vs_spot_pct < 0).length;
                const expiring90 = contracts.filter(c => c.days_remaining != null && c.days_remaining >= 0 && c.days_remaining < 90).length;
                const expiring180 = contracts.filter(c => c.days_remaining != null && c.days_remaining >= 90 && c.days_remaining < 180).length;
                return (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 0, borderBottom: "1px solid #30363d" }}>
                    <div style={{ padding: "8px 12px", borderRight: "1px solid #21262d" }}>
                      <div style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", fontWeight: 700, letterSpacing: "0.08em" }}>TOTAL CONTRACTS</div>
                      <div style={{ fontSize: 18, fontWeight: 800, color: "#3b82f6", marginTop: 2 }}>{contracts.length}</div>
                    </div>
                    <div style={{ padding: "8px 12px", borderRight: "1px solid #21262d" }}>
                      <div style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", fontWeight: 700, letterSpacing: "0.08em" }}>TC / SPOT SPLIT</div>
                      <div style={{ marginTop: 2 }}>
                        <span style={{ fontSize: 14, fontWeight: 700, color: "#3b82f6" }}>{tcContracts.length}</span>
                        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.35)" }}> TC </span>
                        <span style={{ fontSize: 14, fontWeight: 700, color: "#f59e0b" }}>{spotContracts.length}</span>
                        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.35)" }}> Spot</span>
                      </div>
                    </div>
                    <div style={{ padding: "8px 12px", borderRight: "1px solid #21262d" }}>
                      <div style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", fontWeight: 700, letterSpacing: "0.08em" }}>AVG RATE</div>
                      <div style={{ fontSize: 18, fontWeight: 800, color: "#3b82f6", marginTop: 2 }}>{avgRate != null ? fmtRate(avgRate) : "\u2014"}</div>
                    </div>
                    <div style={{ padding: "8px 12px", borderRight: "1px solid #21262d" }}>
                      <div style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", fontWeight: 700, letterSpacing: "0.08em" }}>vs SPOT</div>
                      <div style={{ marginTop: 2 }}>
                        <span style={{ fontSize: 14, fontWeight: 700, color: "#22c55e" }}>{aboveSpot}</span>
                        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.35)" }}> above </span>
                        <span style={{ fontSize: 14, fontWeight: 700, color: "#ef4444" }}>{belowSpot}</span>
                        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.35)" }}> below</span>
                      </div>
                    </div>
                    <div style={{ padding: "8px 12px", borderRight: "1px solid #21262d" }}>
                      <div style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", fontWeight: 700, letterSpacing: "0.08em" }}>EXPIRING &lt;90D</div>
                      <div style={{ fontSize: 18, fontWeight: 800, color: expiring90 > 0 ? "#ef4444" : "rgba(255,255,255,0.5)", marginTop: 2 }}>{expiring90}</div>
                    </div>
                    <div style={{ padding: "8px 12px" }}>
                      <div style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", fontWeight: 700, letterSpacing: "0.08em" }}>EXPIRING 90-180D</div>
                      <div style={{ fontSize: 18, fontWeight: 800, color: expiring180 > 0 ? "#f59e0b" : "rgba(255,255,255,0.5)", marginTop: 2 }}>{expiring180}</div>
                    </div>
                  </div>
                );
              })()}

              {/* Controls */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 10px", background: "#0d1117", borderBottom: "1px solid #30363d" }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.5)", letterSpacing: "0.06em" }}>
                  VESSEL EMPLOYMENT &mdash; {contracts.length} contracts
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span style={{ fontSize: 9, color: "rgba(255,255,255,0.35)" }}>GROUP:</span>
                  <button
                    style={{ ...S.tabBtn(contractGroup), fontSize: 8 }}
                    onClick={() => setContractGroup(!contractGroup)}
                  >
                    {contractGroup ? "BY COMPANY" : "FLAT"}
                  </button>
                </div>
              </div>

              {/* Contract table header */}
              <div style={{
                display: "grid",
                gridTemplateColumns: "76px 1fr 76px 64px 62px 76px 56px 90px 76px 76px 56px 64px",
                padding: "4px 8px",
                fontSize: 9,
                fontWeight: 600,
                color: "rgba(255,255,255,0.5)",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                background: "#0d1117",
                borderBottom: "1px solid #30363d",
              }}>
                <SortHeader label="COMPANY" col="company_ticker" sort={contractSort} setSort={setContractSort} />
                <SortHeader label="VESSEL" col="vessel_name" sort={contractSort} setSort={setContractSort} />
                <SortHeader label="CLASS" col="vessel_class" sort={contractSort} setSort={setContractSort} />
                <SortHeader label="DWT" col="dwt" sort={contractSort} setSort={setContractSort} style={{ textAlign: "right" }} />
                <SortHeader label="TYPE" col="contract_type" sort={contractSort} setSort={setContractSort} />
                <SortHeader label="RATE $/D" col="rate_usd_per_day" sort={contractSort} setSort={setContractSort} style={{ textAlign: "right" }} />
                <SortHeader label="SPOT" col="spot_rate" sort={contractSort} setSort={setContractSort} style={{ textAlign: "right" }} />
                <SortHeader label="CHARTERER" col="charterer" sort={contractSort} setSort={setContractSort} />
                <SortHeader label="START" col="contract_start" sort={contractSort} setSort={setContractSort} style={{ textAlign: "right" }} />
                <SortHeader label="END" col="contract_end" sort={contractSort} setSort={setContractSort} style={{ textAlign: "right" }} />
                <SortHeader label="DAYS" col="days_remaining" sort={contractSort} setSort={setContractSort} style={{ textAlign: "right" }} />
                <SortHeader label="vs SPOT" col="rate_vs_spot_pct" sort={contractSort} setSort={setContractSort} style={{ textAlign: "right" }} />
              </div>

              {/* Contract rows */}
              <div>
                {contractGroup && groupedContracts ? (
                  /* Grouped by company */
                  Object.entries(groupedContracts).map(([ticker, items]) => {
                    const co = companies.find(c => c.ticker === ticker);
                    const col = co?.color_hex || SECTOR_COLORS[co?.sector || ""] || "rgba(255,255,255,0.5)";
                    const groupAvgRate = (() => {
                      const withRate = items.filter(c => c.rate_usd_per_day != null);
                      return withRate.length > 0 ? withRate.reduce((s, c) => s + (c.rate_usd_per_day ?? 0), 0) / withRate.length : null;
                    })();
                    const tcCount = items.filter(c => ["time_charter", "coa", "bareboat"].includes(c.contract_type)).length;
                    const spotCount = items.filter(c => ["spot", "voyage_charter"].includes(c.contract_type)).length;
                    return (
                      <div key={ticker}>
                        {/* Group header */}
                        <div style={{
                          display: "flex", alignItems: "center", gap: 8,
                          padding: "6px 10px",
                          background: "#0d1117",
                          borderBottom: "1px solid #30363d",
                          borderTop: "1px solid #30363d",
                        }}>
                          <div style={{ width: 8, height: 8, borderRadius: "50%", background: col }} />
                          <span style={{ fontWeight: 700, color: col, fontSize: 11 }}>{ticker}</span>
                          <span style={{ color: "rgba(255,255,255,0.35)", fontSize: 9 }}>{co?.company_name?.replace(/\s*ASA\s*$/i, "")}</span>
                          <span style={{ fontSize: 9, color: "rgba(255,255,255,0.5)", marginLeft: 8 }}>{tcCount > 0 && <span style={{ color: "#3b82f6" }}>{tcCount} TC</span>}{tcCount > 0 && spotCount > 0 && " / "}{spotCount > 0 && <span style={{ color: "#f59e0b" }}>{spotCount} Spot</span>}</span>
                          <span style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", marginLeft: "auto" }}>
                            Avg {fmtRate(groupAvgRate)} &middot; {items.length} vessels
                          </span>
                        </div>
                        {items.map(c => renderContractRow(c))}
                      </div>
                    );
                  })
                ) : (
                  /* Flat list */
                  sortedContracts.map(c => renderContractRow(c))
                )}
              </div>

              {/* Exposure Matrix */}
              {exposureMatrix.length > 0 && (
                <div style={{ marginTop: 2 }}>
                  <div style={S.section}>RATE EXPOSURE MATRIX</div>
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10 }}>
                      <thead>
                        <tr style={{ background: "#0d1117" }}>
                          <th style={{ textAlign: "left", padding: "6px 8px", fontWeight: 600, color: "rgba(255,255,255,0.5)", fontSize: 9, letterSpacing: "0.05em", borderBottom: "1px solid #30363d" }}>COMPANY</th>
                          {vesselClasses.map(vc => (
                            <th key={vc} style={{ textAlign: "center", padding: "6px 8px", fontWeight: 600, color: "rgba(255,255,255,0.5)", fontSize: 9, letterSpacing: "0.05em", borderBottom: "1px solid #30363d" }}>{vc}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {exposureTickers.map(tk => {
                          const co = companies.find(c => c.ticker === tk);
                          const col = co?.color_hex || "rgba(255,255,255,0.5)";
                          return (
                            <tr key={tk} className="sh-row" style={{ borderBottom: "1px solid #21262d" }}>
                              <td style={{ padding: "5px 8px", fontWeight: 700, color: col }}>{tk}</td>
                              {vesselClasses.map(vc => {
                                const cell = exposureMatrix.find(e => e.ticker === tk && e.vessel_class === vc);
                                if (!cell) return <td key={vc} style={{ padding: "5px 8px", textAlign: "center", color: "#30363d" }}>{"\u2014"}</td>;
                                return (
                                  <td key={vc} style={{
                                    padding: "5px 8px",
                                    textAlign: "center",
                                    fontWeight: 600,
                                    color: deltaColor(cell.delta_pct),
                                    background: deltaBg(cell.delta_pct),
                                  }}>
                                    <div>{fmtRate(cell.company_rate)}</div>
                                    <div style={{ fontSize: 9, fontWeight: 700 }}>{fmtPct(cell.delta_pct)}</div>
                                  </td>
                                );
                              })}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {/* Legend */}
                  <div style={{ display: "flex", gap: 14, justifyContent: "center", padding: "6px 0 4px", fontSize: 9, color: "rgba(255,255,255,0.35)" }}>
                    <span><span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 1, background: "rgba(34,197,94,0.3)", marginRight: 3, verticalAlign: "middle" }} /> Above spot (&gt;10%)</span>
                    <span><span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 1, background: "rgba(34,197,94,0.15)", marginRight: 3, verticalAlign: "middle" }} /> Above spot (0-10%)</span>
                    <span><span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 1, background: "rgba(239,68,68,0.15)", marginRight: 3, verticalAlign: "middle" }} /> Below spot (0-10%)</span>
                    <span><span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 1, background: "rgba(239,68,68,0.3)", marginRight: 3, verticalAlign: "middle" }} /> Below spot (&gt;10%)</span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Data Sources ── */}
          <div style={{ borderTop: "1px solid #21262d", marginTop: 16, padding: "12px 10px", fontSize: 9, color: "rgba(255,255,255,0.35)", lineHeight: 1.8 }}>
            <span style={{ fontWeight: 700, color: "rgba(255,255,255,0.4)", letterSpacing: "0.06em" }}>DATA SOURCES</span>
            <div style={{ marginTop: 4 }}>
              <span style={{ color: "rgba(255,255,255,0.4)" }}>Market Rates:</span> Yahoo Finance (BDI), Pareto Shipping Daily &middot;{" "}
              <span style={{ color: "rgba(255,255,255,0.4)" }}>Fleet & Vessels:</span> Company filings, quarterly fleet reports &middot;{" "}
              <span style={{ color: "rgba(255,255,255,0.4)" }}>Contracts:</span> Quarterly fleet reports, broker estimates &middot;{" "}
              <span style={{ color: "rgba(255,255,255,0.4)" }}>Commodities:</span> ICE Brent, SGX Iron Ore &middot;{" "}
              <span style={{ color: "rgba(255,255,255,0.4)" }}>Indices:</span> Baltic Exchange (BDI, BDTI, BCTI), Shanghai Shipping Exchange (SCFI)
            </div>
          </div>

        </div>
      </main>
    </>
  );

  /* ─── Contract row renderer ───────────────────────────────────── */

  function renderContractRow(c: ContractItem) {
    const co = companies.find(co => co.ticker === c.company_ticker);
    const col = c.color_hex || co?.color_hex || SECTOR_COLORS[c.sector] || "rgba(255,255,255,0.5)";
    const sizeLabel = c.dwt ? fmtDwt(c.dwt) : c.teu ? `${fmtNum(c.teu)} TEU` : c.cbm ? `${fmtNum(c.cbm)} CBM` : "\u2014";

    return (
      <div
        key={`${c.imo}-${c.contract_start}`}
        className="sh-row"
        style={{
          display: "grid",
          gridTemplateColumns: "76px 1fr 76px 64px 62px 76px 56px 90px 76px 76px 56px 64px",
          padding: "4px 8px",
          borderBottom: "1px solid #21262d",
          alignItems: "center",
          fontSize: 10,
          transition: "background 0.08s",
        }}
      >
        {/* Company */}
        <div style={{ fontWeight: 600, color: col }}>{c.company_ticker}</div>
        {/* Vessel */}
        <div style={{ color: "#fff", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.vessel_name}</div>
        {/* Class */}
        <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 9, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.vessel_class || c.vessel_type}</div>
        {/* DWT */}
        <div style={{ textAlign: "right", color: "rgba(255,255,255,0.5)" }}>{sizeLabel}</div>
        {/* Contract type */}
        <div>
          {(() => {
            const isTc = ["time_charter", "coa", "bareboat"].includes(c.contract_type);
            const isSpot = ["spot", "voyage_charter"].includes(c.contract_type);
            const label = c.contract_type === "time_charter" ? "TC" : c.contract_type === "coa" ? "CoA" : c.contract_type === "bareboat" ? "BB" : c.contract_type === "spot" ? "SPOT" : c.contract_type === "voyage_charter" ? "VC" : c.contract_type === "pool" ? "POOL" : c.contract_type === "idle" ? "IDLE" : (c.contract_type || "\u2014").toUpperCase();
            return (
              <span style={{
                fontSize: 8, fontWeight: 700, padding: "1px 4px", borderRadius: 2, letterSpacing: "0.04em",
                background: isTc ? "rgba(59,130,246,0.15)" : isSpot ? "rgba(245,158,11,0.15)" : "rgba(107,114,128,0.15)",
                color: isTc ? "#3b82f6" : isSpot ? "#f59e0b" : "rgba(255,255,255,0.5)",
              }}>
                {label}
              </span>
            );
          })()}
        </div>
        {/* Rate */}
        <div style={{ textAlign: "right", fontWeight: 600, color: "#3b82f6" }}>
          {c.rate_usd_per_day != null ? fmtRate(c.rate_usd_per_day) : c.rate_worldscale != null ? `WS${c.rate_worldscale}` : "\u2014"}
        </div>
        {/* Spot rate */}
        <div style={{ textAlign: "right", color: "rgba(255,255,255,0.4)", fontSize: 9 }}>
          {c.spot_rate != null ? fmtRate(c.spot_rate) : "\u2014"}
        </div>
        {/* Charterer */}
        <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 9, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.charterer || "\u2014"}</div>
        {/* Start */}
        <div style={{ textAlign: "right", color: "rgba(255,255,255,0.35)", fontSize: 9 }}>{fmtDate(c.contract_start)}</div>
        {/* End */}
        <div style={{ textAlign: "right", color: "rgba(255,255,255,0.35)", fontSize: 9 }}>{fmtDate(c.contract_end)}</div>
        {/* Days remaining */}
        <div style={{ textAlign: "right", fontWeight: 600, color: daysColor(c.days_remaining) }}>
          {c.days_remaining != null ? c.days_remaining : "\u2014"}
        </div>
        {/* vs Spot */}
        <div style={{
          textAlign: "right", fontWeight: 700,
          color: c.rate_vs_spot_pct == null ? "rgba(255,255,255,0.35)" : (c.rate_vs_spot_pct >= 0 ? "#22c55e" : "#ef4444"),
        }}>
          {fmtPct(c.rate_vs_spot_pct)}
        </div>
      </div>
    );
  }
}
