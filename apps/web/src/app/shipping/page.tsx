"use client";

import React, { useEffect, useState, useMemo } from "react";
import Link from "next/link";
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
  if (d == null) return "#555";
  if (d < 90) return "#ef4444";
  if (d < 180) return "#f59e0b";
  return "#888";
}

function deltaColor(v: number | null): string {
  if (v == null) return "#555";
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
  const [companyRates, setCompanyRates] = useState<CompanyRate[]>([]);
  const [ports, setPorts] = useState<PortItem[]>([]);
  const [exposureMatrix, setExposureMatrix] = useState<ExposureCell[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [tab, setTab] = useState<"overview" | "map" | "rates" | "contracts">("overview");
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);
  const [selectedSector, setSelectedSector] = useState<string | null>(null);
  const [focusVessel, setFocusVessel] = useState<{ lat: number; lng: number; name: string } | null>(null);
  const [companySort, setCompanySort] = useState<{ col: string; asc: boolean }>({ col: "fleet_size", asc: false });
  const [contractSort, setContractSort] = useState<{ col: string; asc: boolean }>({ col: "company_ticker", asc: true });
  const [contractGroup, setContractGroup] = useState(true);

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
        const [mr, cr, pt, em] = await Promise.all([
          sf("/api/shipping/rates/market?index=BDI,BDTI,BCTI,CAPESIZE_5TC,VLCC_TD3C_TCE,SUEZMAX_TD20_TCE,AFRAMAX_TCE,LR2_TCE,MR_TC2_TCE,PANAMAX_TCE,ULTRAMAX_TCE,VLGC_ME_ASIA,LNG_SPOT_TFDE,SCFI,BRENT,IRON_ORE&days=365"),
          sf("/api/shipping/rates/company?quarters=8"),
          sf("/api/shipping/ports"),
          sf("/api/shipping/exposure-matrix"),
        ]);
        if (mr) {
          setMarketRates(mr.series || {});
          setMarketStats(mr.stats || {});
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
  }, []);

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
    page: { minHeight: "100vh", background: "#0a0a0a", color: "#e5e5e5", fontFamily: "'Geist Mono','SF Mono','Consolas',monospace", fontSize: 12 } as React.CSSProperties,
    container: { maxWidth: 1600, margin: "0 auto", padding: "0 12px" } as React.CSSProperties,
    header: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid #222" } as React.CSSProperties,
    title: { fontSize: 13, fontWeight: 700, letterSpacing: "0.08em", color: "#f97316" } as React.CSSProperties,
    badge: (bg: string, fg = "#fff") => ({ fontSize: 9, fontWeight: 700, padding: "1px 5px", borderRadius: 2, background: bg, color: fg, letterSpacing: "0.04em" }) as React.CSSProperties,
    section: { fontSize: 9, fontWeight: 700, color: "#666", letterSpacing: "0.08em", textTransform: "uppercase" as const, padding: "8px 10px 4px", borderBottom: "1px solid #1a1a1a" } as React.CSSProperties,
    tabBtn: (active: boolean) => ({ padding: "2px 7px", borderRadius: 2, border: `1px solid ${active ? "#f97316" : "#333"}`, background: active ? "#f97316" : "transparent", color: active ? "#000" : "#888", fontFamily: "inherit", fontSize: 9, fontWeight: 700, cursor: "pointer", letterSpacing: "0.04em" }) as React.CSSProperties,
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
          <div style={S.header}><span style={S.title}>SHIPPING INTELLIGENCE</span></div>
          <div style={{ padding: "40px 0", textAlign: "center", color: "#555" }}>Loading...</div>
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
      return <div style={{ height, display: "flex", alignItems: "center", justifyContent: "center", color: "#444", fontSize: 10 }}>No data</div>;
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
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 8, color: "#444", padding: "0 2px", marginBottom: 2 }}>
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
                  <line x1={x} y1={0} x2={x} y2={40} stroke="#555" strokeWidth={0.3} vectorEffect="non-scaling-stroke" />
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
            background: "#161616",
            border: "1px solid #2a2a2a",
            borderRadius: 4,
            padding: "4px 8px",
            pointerEvents: "none",
            zIndex: 10,
          }}>
            <div style={{ fontSize: 9, color: "#888" }}>{series[hIdx].date}</div>
            <div style={{ fontSize: 12, fontWeight: 700, color: accentColor }}>{fmtNum(series[hIdx].value)}</div>
          </div>
        )}
        {/* Stats bar below chart */}
        {stats && (
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: "#555", marginTop: 6, padding: "0 2px" }}>
            <span>Avg<span style={{ color: "#888", marginLeft: 3 }}>{fmtNum(stats.avg)}</span></span>
            <span>H <span style={{ color: "#22c55e" }}>{fmtNum(stats.high)}</span></span>
            <span>L <span style={{ color: "#ef4444" }}>{fmtNum(stats.low)}</span></span>
            <span style={{ color: "#666" }}>{fmtDate(stats.latestDate)}</span>
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
        .sh-row:hover { background: #151515 !important; }
        @media (max-width: 1000px) { .sh-grid { grid-template-columns: 1fr !important; } }
        @keyframes sh-fade-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        .sh-tab-content { animation: sh-fade-in 0.35s ease-out; }
      `}</style>
      <main style={S.page}>
        <div style={S.container}>

          {/* ─── Header Bar ─────────────────────────────────── */}
          <div style={S.header}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <Link href="/" style={{ fontSize: 10, color: "#666", textDecoration: "none" }}>HOME</Link>
              <span style={{ color: "#333" }}>/</span>
              <span style={S.title}>SHIPPING INTELLIGENCE</span>
              <span style={{ ...S.badge("#1a1a1a"), color: "#888", border: "1px solid #333" }}>
                {positions.length} VESSELS TRACKED
              </span>
              <span style={{ ...S.badge("#1a1a1a"), color: "#888", border: "1px solid #333" }}>
                {Object.keys(segments).length} SEGMENTS
              </span>
            </div>
            <div style={{ display: "flex", gap: 12, fontSize: 10, alignItems: "center" }}>
              <span style={{ color: "#888" }}>BDI</span>
              <span style={{ color: "#f97316", fontWeight: 600 }}>
                {overview?.bdi ? fmtNum(overview.bdi.value) : "\u2014"}
              </span>
              {overview?.bdi && (
                <span style={{ color: overview.bdi.change >= 0 ? "#22c55e" : "#ef4444", fontWeight: 600 }}>
                  {fmtPct(overview.bdi.change)}
                </span>
              )}
              <span style={{ color: "#333" }}>|</span>
              <span style={{ color: "#888" }}>BDTI</span>
              <span style={{ color: "#3b82f6", fontWeight: 600 }}>
                {overview?.bdti ? fmtNum(overview.bdti.value) : "\u2014"}
              </span>
              {overview?.bdti && (
                <span style={{ color: overview.bdti.change >= 0 ? "#22c55e" : "#ef4444", fontWeight: 600 }}>
                  {fmtPct(overview.bdti.change)}
                </span>
              )}
              <span style={{ color: "#333" }}>|</span>
              <span style={{ color: "#888" }}>BCTI</span>
              <span style={{ color: "#a855f7", fontWeight: 600 }}>
                {overview?.bcti ? fmtNum(overview.bcti.value) : "\u2014"}
              </span>
              {overview?.bcti && (
                <span style={{ color: overview.bcti.change >= 0 ? "#22c55e" : "#ef4444", fontWeight: 600 }}>
                  {fmtPct(overview.bcti.change)}
                </span>
              )}
            </div>
          </div>

          {/* ─── Tab Bar ────────────────────────────────────── */}
          <div style={{ display: "flex", gap: 6, padding: "6px 8px", background: "#111", borderBottom: "1px solid #222", alignItems: "center" }}>
            {(["overview", "map", "rates", "contracts"] as const).map(t => (
              <button key={t} style={S.tabBtn(tab === t)} onClick={() => setTab(t)}>
                {{ overview: "OVERVIEW", map: "MAP & FLEET", rates: "RATES", contracts: "CONTRACTS" }[t]}
              </button>
            ))}
          </div>

          {/* ================================================================ */}
          {/* OVERVIEW TAB                                                     */}
          {/* ================================================================ */}
          {tab === "overview" && (
            <div key="overview" className="sh-tab-content">

              {/* KPI Cards Row */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 8, padding: "10px 8px", borderBottom: "1px solid #222" }}>
                {/* Total Vessels */}
                <div style={{ background: "#111", border: "1px solid #222", borderRadius: 3, padding: "8px 10px" }}>
                  <div style={{ fontSize: 8, color: "#666", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>TOTAL VESSELS</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: "#f97316", marginTop: 2 }}>{positions.length}</div>
                  <div style={{ fontSize: 10, color: "#555", marginTop: 2 }}>{companies.length} companies tracked</div>
                </div>
                {/* Avg Fleet Age */}
                <div style={{ background: "#111", border: "1px solid #222", borderRadius: 3, padding: "8px 10px" }}>
                  <div style={{ fontSize: 8, color: "#666", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>AVG FLEET AGE</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: "#f97316", marginTop: 2 }}>{overview?.avgFleetAge?.toFixed(1) ?? "\u2014"} yr</div>
                  <div style={{ fontSize: 10, color: "#555", marginTop: 2 }}>across fleet</div>
                </div>
                {/* At Sea % */}
                <div style={{ background: "#111", border: "1px solid #222", borderRadius: 3, padding: "8px 10px" }}>
                  <div style={{ fontSize: 8, color: "#666", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>AT SEA</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: "#22c55e", marginTop: 2 }}>{overview?.atSeaPct?.toFixed(0) ?? "\u2014"}%</div>
                  <div style={{ fontSize: 10, color: "#555", marginTop: 2 }}>{fmtNum(overview?.atSeaCount ?? null)} vessels</div>
                </div>
                {/* Fleet Utilization */}
                <div style={{ background: "#111", border: "1px solid #222", borderRadius: 3, padding: "8px 10px" }}>
                  <div style={{ fontSize: 8, color: "#666", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>UTILIZATION</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: (overview?.fleetUtilization ?? 0) >= 90 ? "#22c55e" : "#f59e0b", marginTop: 2 }}>{overview?.fleetUtilization?.toFixed(0) ?? "\u2014"}%</div>
                  <div style={{ fontSize: 10, color: "#555", marginTop: 2 }}>fleet utilization</div>
                </div>
                {/* BDI */}
                <div style={{ background: "#111", border: "1px solid #222", borderRadius: 3, padding: "8px 10px" }}>
                  <div style={{ fontSize: 8, color: "#666", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>BDI INDEX</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: "#3b82f6", marginTop: 2 }}>{overview?.bdi ? fmtNum(overview.bdi.value) : "\u2014"}</div>
                  {overview?.bdi && (
                    <div style={{ fontSize: 10, color: overview.bdi.change >= 0 ? "#22c55e" : "#ef4444", marginTop: 2 }}>
                      {fmtPct(overview.bdi.change)}
                    </div>
                  )}
                </div>
                {/* TC Coverage avg */}
                <div style={{ background: "#111", border: "1px solid #222", borderRadius: 3, padding: "8px 10px" }}>
                  <div style={{ fontSize: 8, color: "#666", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>TC COVERAGE AVG</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: "#a855f7", marginTop: 2 }}>{avgTcCoverage != null ? `${avgTcCoverage.toFixed(0)}%` : "\u2014"}</div>
                  <div style={{ fontSize: 10, color: "#555", marginTop: 2 }}>contract coverage</div>
                </div>
              </div>

              {/* Market Pulse — ticker-tape style rate cards */}
              {(() => {
                const rateCards: { label: string; key: string; color: string; unit: string; prefix?: string }[] = [
                  { label: "BDI", key: "BDI", color: "#f97316", unit: "pts" },
                  { label: "VLCC TCE", key: "VLCC_TD3C_TCE", color: "#ef4444", unit: "/day", prefix: "$" },
                  { label: "SUEZMAX", key: "SUEZMAX_TD20_TCE", color: "#fb923c", unit: "/day", prefix: "$" },
                  { label: "AFRAMAX", key: "AFRAMAX_TCE", color: "#f59e0b", unit: "/day", prefix: "$" },
                  { label: "MR TCE", key: "MR_TC2_TCE", color: "#a855f7", unit: "/day", prefix: "$" },
                  { label: "CAPESIZE", key: "CAPESIZE_5TC", color: "#3b82f6", unit: "/day", prefix: "$" },
                  { label: "PANAMAX", key: "PANAMAX_TCE", color: "#2563eb", unit: "/day", prefix: "$" },
                  { label: "BDTI", key: "BDTI", color: "#dc2626", unit: "pts" },
                  { label: "BCTI", key: "BCTI", color: "#7c3aed", unit: "pts" },
                  { label: "VLGC ME→Asia", key: "VLGC_ME_ASIA", color: "#22c55e", unit: "/day", prefix: "$" },
                  { label: "LNG SPOT", key: "LNG_SPOT_TFDE", color: "#10b981", unit: "/day", prefix: "$" },
                  { label: "BRENT", key: "BRENT", color: "#eab308", unit: "/bbl", prefix: "$" },
                  { label: "IRON ORE", key: "IRON_ORE", color: "#94a3b8", unit: "/t", prefix: "$" },
                  { label: "SCFI", key: "SCFI", color: "#ec4899", unit: "pts" },
                ];
                return (
                  <div style={{ borderBottom: "1px solid #222" }}>
                    <div style={{ ...S.section, fontSize: 9 }}>MARKET PULSE — LATEST RATES</div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 0 }}>
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
                            borderRight: "1px solid #1a1a1a",
                            borderBottom: "1px solid #1a1a1a",
                            cursor: "pointer",
                          }} onClick={() => setTab("rates")}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                              <span style={{ fontSize: 9, fontWeight: 700, color: "#555", letterSpacing: "0.06em" }}>{rc.label}</span>
                              {chg != null && (
                                <span style={{ fontSize: 9, fontWeight: 700, color: chg >= 0 ? "#22c55e" : "#ef4444" }}>
                                  {chg >= 0 ? "▲" : "▼"} {Math.abs(chg).toFixed(1)}%
                                </span>
                              )}
                            </div>
                            <div style={{ fontSize: 18, fontWeight: 700, color: rc.color, lineHeight: 1.1 }}>
                              {latest != null ? `${rc.prefix || ""}${latest >= 1000 ? fmtNum(latest) : latest.toFixed(1)}` : "\u2014"}
                            </div>
                            <div style={{ fontSize: 9, color: "#444", marginTop: 2 }}>{rc.unit}</div>
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
                                <div style={{ position: "relative", height: 4, background: "#1a1a1a", borderRadius: 2 }}>
                                  <div style={{
                                    position: "absolute", left: 0, top: 0, height: "100%", borderRadius: 2,
                                    width: `${((latest - low) / (high - low)) * 100}%`,
                                    background: `linear-gradient(90deg, ${rc.color}44, ${rc.color})`,
                                  }} />
                                </div>
                                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 3, fontSize: 8, color: "#444" }}>
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
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0, borderBottom: "1px solid #222" }}>
                <div style={{ height: 260, borderRight: "1px solid #222", cursor: "pointer" }} onClick={() => setTab("map")}>
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
                  <div style={{ ...S.section, fontSize: 9 }}>CONTRACT COVERAGE BY COMPANY</div>
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
                              <span style={{ fontSize: 9, color: "#555" }}>{co.fleet_size}v</span>
                            </div>
                            <div style={{ fontSize: 9 }}>
                              <span style={{ color: "#3b82f6", fontWeight: 600 }}>{calcTcPct.toFixed(0)}% TC</span>
                              <span style={{ color: "#333", margin: "0 3px" }}>|</span>
                              <span style={{ color: "#f97316", fontWeight: 600 }}>{calcSpotPct.toFixed(0)}% Spot</span>
                            </div>
                          </div>
                          <div style={{ height: 4, display: "flex", borderRadius: 2, overflow: "hidden", background: "#1a1a1a" }}>
                            <div style={{ width: `${calcTcPct}%`, background: "#3b82f6", transition: "width 0.3s" }} />
                            <div style={{ width: `${calcSpotPct}%`, background: "#f97316", transition: "width 0.3s" }} />
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
                <div style={{ display: "grid", gridTemplateColumns: "3px 80px 1fr 70px 48px 48px 48px 72px 56px 68px 56px", padding: "4px 8px", fontSize: 9, fontWeight: 700, color: "#666", textTransform: "uppercase", letterSpacing: "0.06em", background: "#111", borderBottom: "1px solid #222" }}>
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
                  const sectorCol = SECTOR_COLORS[co.sector] || "#888";
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
                        borderBottom: "1px solid #1a1a1a",
                        alignItems: "center",
                        cursor: "pointer",
                        transition: "background 0.08s",
                        background: isActive ? "#1a1a2a" : undefined,
                        outline: isActive ? "1px solid #333" : undefined,
                      }}
                    >
                      <div style={{ width: 3, minHeight: 16, background: co.color_hex || sectorCol, borderRadius: 1 }} />
                      <div>
                        <Link href={`/stocks/${co.ticker}`} style={{ color: co.color_hex || "#58a6ff", textDecoration: "none", fontWeight: 600 }} onClick={e => e.stopPropagation()}>
                          {co.ticker}
                        </Link>
                      </div>
                      <div style={{ color: "#888", fontSize: 10, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {co.company_name?.replace(/\s*ASA\s*$/i, "")}
                      </div>
                      <div style={{ textAlign: "center" }}>
                        <span style={S.badge(sectorCol)}>{SECTOR_LABELS[co.sector] || co.sector.toUpperCase()}</span>
                      </div>
                      <div style={{ textAlign: "right", fontWeight: 600 }}>{co.fleet_size}</div>
                      <div style={{ textAlign: "right", color: "#888" }}>{co.fleet_owned}</div>
                      <div style={{ textAlign: "right", color: co.avg_vessel_age > 15 ? "#f59e0b" : "#888" }}>{co.avg_vessel_age?.toFixed(1) ?? "\u2014"}</div>
                      <div style={{ textAlign: "right", fontWeight: 600, color: "#f97316" }}>{fmtRate(co.avg_tce)}</div>
                      <div style={{ textAlign: "right", color: (co.contract_coverage_pct ?? 0) > 50 ? "#22c55e" : "#888" }}>
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
                <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 8, padding: "10px 8px" }}>
                  {Object.entries(SECTOR_LABELS).map(([key, label]) => {
                    const seg = segments[key];
                    if (!seg) return (
                      <div key={key} style={{ background: "#111", border: "1px solid #1a1a1a", borderRadius: 3, padding: "8px 10px", opacity: 0.4 }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: SECTOR_COLORS[key] }}>{label}</div>
                        <div style={{ fontSize: 9, color: "#555", marginTop: 4 }}>No companies</div>
                      </div>
                    );
                    return (
                      <div key={key} style={{ background: "#111", border: "1px solid #222", borderRadius: 3, padding: "8px 10px" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <span style={{ fontSize: 10, fontWeight: 700, color: SECTOR_COLORS[key] }}>{label}</span>
                          <span style={{ fontSize: 9, color: "#888" }}>{seg.count} co.</span>
                        </div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: "#e5e5e5", marginTop: 4 }}>{seg.fleet} vessels</div>
                        <div style={{ height: 3, background: "#1a1a1a", borderRadius: 2, marginTop: 6, overflow: "hidden" }}>
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
              <div style={{ height: "calc(100vh - 140px)", minHeight: 600, border: "1px solid #222" }}>
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
              <div style={{ background: "#0d0d0d", borderLeft: "1px solid #222", overflowY: "auto", maxHeight: "calc(100vh - 140px)" }}>
                {selectedTicker ? (
                  <>
                    <div style={{ ...S.section, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span>FLEET: {selectedTicker}</span>
                      <span style={{ fontSize: 9, color: "#888" }}>{selectedCompanyVessels.length} vessels</span>
                    </div>
                    <div style={{ padding: 0 }}>
                      {/* vessel header */}
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 60px 56px 64px 72px", padding: "4px 8px", fontSize: 8, fontWeight: 700, color: "#555", textTransform: "uppercase", letterSpacing: "0.06em", background: "#111", borderBottom: "1px solid #222" }}>
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
                          style={{ display: "grid", gridTemplateColumns: "1fr 60px 56px 64px 72px", padding: "4px 8px", borderBottom: "1px solid #1a1a1a", alignItems: "center", cursor: "pointer", fontSize: 10 }}
                          onClick={() => {
                            if (v.latitude != null && v.longitude != null) {
                              setFocusVessel({ lat: v.latitude, lng: v.longitude, name: v.vessel_name });
                            }
                          }}
                        >
                          <div style={{ color: "#e5e5e5", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v.vessel_name}</div>
                          <div style={{ color: "#666", fontSize: 9, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v.vessel_type}</div>
                          <div>
                            <span style={{
                              fontSize: 8, fontWeight: 700, padding: "1px 4px", borderRadius: 2,
                              background: v.status === "at_sea" ? "rgba(34,197,94,0.15)" : v.status === "in_port" ? "rgba(59,130,246,0.15)" : "rgba(107,114,128,0.15)",
                              color: v.status === "at_sea" ? "#22c55e" : v.status === "in_port" ? "#3b82f6" : "#888",
                            }}>
                              {v.status === "at_sea" ? "SEA" : v.status === "in_port" ? "PORT" : v.status?.toUpperCase() || "UNK"}
                            </span>
                          </div>
                          <div style={{ textAlign: "right", color: "#f97316", fontWeight: 600 }}>{fmtRate(v.rate_usd_per_day)}</div>
                          <div style={{ textAlign: "right", color: "#555", fontSize: 9, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v.destination_port_name || v.destination || "\u2014"}</div>
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
                            style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 10px", borderBottom: "1px solid #1a1a1a", cursor: "pointer" }}
                            onClick={() => setSelectedTicker(co.ticker)}
                          >
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <div style={{ width: 8, height: 8, borderRadius: "50%", background: co.color_hex || SECTOR_COLORS[co.sector] || "#888" }} />
                              <div>
                                <div style={{ fontWeight: 600, color: co.color_hex || "#e5e5e5", fontSize: 11 }}>{co.ticker}</div>
                                <div style={{ color: "#555", fontSize: 9 }}>{co.company_name?.replace(/\s*ASA\s*$/i, "")}</div>
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

              {/* ── SECTION 1: Rate Summary Strip ── */}
              {(() => {
                const rateData: { label: string; key: string; color: string; unit: string; prefix?: string; desc: string }[] = [
                  { label: "BDI", key: "BDI", color: "#f97316", unit: "pts", desc: "Baltic Dry Index" },
                  { label: "BDTI", key: "BDTI", color: "#dc2626", unit: "pts", desc: "Baltic Dirty Tanker" },
                  { label: "BCTI", key: "BCTI", color: "#a855f7", unit: "pts", desc: "Baltic Clean Tanker" },
                  { label: "SCFI", key: "SCFI", color: "#ec4899", unit: "pts", desc: "Shanghai Container" },
                ];
                return (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 0, borderBottom: "1px solid #222" }}>
                    {rateData.map((rd, i) => {
                      const stats = marketStats[rd.key];
                      const series = marketRates[rd.key] || [];
                      const latest = stats?.latest ?? series.at(-1)?.value;
                      const prev = series.length >= 2 ? series[series.length - 2]?.value : null;
                      const chg = latest != null && prev != null && prev > 0 ? ((latest - prev) / prev) * 100 : null;
                      const high = stats?.high ?? (series.length > 0 ? Math.max(...series.map(s => s.value)) : null);
                      const low = stats?.low ?? (series.length > 0 ? Math.min(...series.map(s => s.value)) : null);
                      const w52Chg = latest != null && series.length > 0 && series[0].value > 0 ? ((latest - series[0].value) / series[0].value) * 100 : null;
                      return (
                        <div key={rd.key} style={{
                          padding: "14px 18px",
                          borderRight: i < 3 ? "1px solid #1a1a1a" : undefined,
                          background: "#0a0a0a",
                        }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                            <span style={{ fontSize: 9, fontWeight: 700, color: "#555", letterSpacing: "0.08em" }}>{rd.desc.toUpperCase()}</span>
                            {chg != null && (
                              <span style={{
                                fontSize: 9, fontWeight: 700, padding: "1px 5px", borderRadius: 2,
                                background: chg >= 0 ? "rgba(34,197,94,0.15)" : "rgba(239,68,68,0.15)",
                                color: chg >= 0 ? "#22c55e" : "#ef4444",
                              }}>
                                {chg >= 0 ? "+" : ""}{chg.toFixed(1)}%
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize: 28, fontWeight: 800, color: rd.color, lineHeight: 1 }}>
                            {latest != null ? fmtNum(Math.round(latest)) : "\u2014"}
                          </div>
                          <div style={{ display: "flex", gap: 10, marginTop: 6, fontSize: 9 }}>
                            {high != null && <span style={{ color: "#555" }}>H <span style={{ color: "#888", fontWeight: 600 }}>{fmtNum(Math.round(high))}</span></span>}
                            {low != null && <span style={{ color: "#555" }}>L <span style={{ color: "#888", fontWeight: 600 }}>{fmtNum(Math.round(low))}</span></span>}
                            {w52Chg != null && <span style={{ color: "#555" }}>52w <span style={{ color: w52Chg >= 0 ? "#22c55e" : "#ef4444", fontWeight: 600 }}>{w52Chg >= 0 ? "+" : ""}{w52Chg.toFixed(0)}%</span></span>}
                          </div>
                          {/* Range bar */}
                          {high != null && low != null && latest != null && high > low && (
                            <div style={{ position: "relative", height: 4, background: "#1a1a1a", borderRadius: 2, marginTop: 6 }}>
                              <div style={{
                                position: "absolute", left: 0, top: 0, height: "100%", borderRadius: 2,
                                width: `${Math.min(100, ((latest - low) / (high - low)) * 100)}%`,
                                background: `linear-gradient(90deg, ${rd.color}44, ${rd.color})`,
                              }} />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })()}

              {/* ── SECTION 2: Tanker Rates ── */}
              <div style={{ borderBottom: "1px solid #222" }}>
                <div style={{ ...S.section, background: "#0e0e0e" }}>
                  <span style={{ color: "#ef4444" }}>&#9679;</span> TANKER RATES — TCE ($/DAY)
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 0 }}>
                  {[
                    { label: "VLCC TD3C", key: "VLCC_TD3C_TCE", color: "#ef4444", sub: "MEG → China" },
                    { label: "Suezmax TD20", key: "SUEZMAX_TD20_TCE", color: "#fb923c", sub: "WAF → UKC" },
                    { label: "Aframax", key: "AFRAMAX_TCE", color: "#f59e0b", sub: "Cross-Med" },
                    { label: "MR TC2", key: "MR_TC2_TCE", color: "#a855f7", sub: "UKC → USAC" },
                  ].map((rd, i) => {
                    const stats = marketStats[rd.key];
                    const series = marketRates[rd.key] || [];
                    const latest = stats?.latest ?? series.at(-1)?.value;
                    const prev = series.length >= 2 ? series[series.length - 2]?.value : null;
                    const chg = latest != null && prev != null && prev > 0 ? ((latest - prev) / prev) * 100 : null;
                    const high = stats?.high;
                    const low = stats?.low;
                    return (
                      <div key={rd.key} style={{ borderRight: i < 3 ? "1px solid #1a1a1a" : undefined, borderBottom: "1px solid #1a1a1a" }}>
                        <div style={{ padding: "14px 16px 0" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <div>
                              <span style={{ fontSize: 11, fontWeight: 700, color: rd.color }}>{rd.label}</span>
                              <span style={{ fontSize: 9, color: "#444", marginLeft: 6 }}>{rd.sub}</span>
                            </div>
                            {chg != null && (
                              <span style={{ fontSize: 10, fontWeight: 700, color: chg >= 0 ? "#22c55e" : "#ef4444" }}>
                                {chg >= 0 ? "▲" : "▼"}{Math.abs(chg).toFixed(1)}%
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize: 24, fontWeight: 800, color: rd.color, marginTop: 6 }}>
                            {latest != null ? `$${fmtNum(Math.round(latest))}` : "\u2014"}
                          </div>
                          <div style={{ display: "flex", gap: 10, fontSize: 9, color: "#555", marginTop: 4 }}>
                            {high != null && <span>52w Hi: <span style={{ color: "#888" }}>${fmtNum(Math.round(high))}</span></span>}
                            {low != null && <span>Lo: <span style={{ color: "#888" }}>${fmtNum(Math.round(low))}</span></span>}
                          </div>
                        </div>
                        <div style={{ padding: "8px 16px 14px" }}>
                          {renderRateChart(rd.key, series, "100%", 100, rd.color)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* ── SECTION 3: Dry Bulk Rates ── */}
              <div style={{ borderBottom: "1px solid #222" }}>
                <div style={{ ...S.section, background: "#0e0e0e" }}>
                  <span style={{ color: "#3b82f6" }}>&#9679;</span> DRY BULK RATES — TCE ($/DAY)
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 0 }}>
                  {[
                    { label: "Capesize 5TC", key: "CAPESIZE_5TC", color: "#3b82f6", sub: "C5TC Average" },
                    { label: "Panamax", key: "PANAMAX_TCE", color: "#2563eb", sub: "P4TC Average" },
                    { label: "Ultramax", key: "ULTRAMAX_TCE", color: "#60a5fa", sub: "BSI Average" },
                  ].map((rd, i) => {
                    const stats = marketStats[rd.key];
                    const series = marketRates[rd.key] || [];
                    const latest = stats?.latest ?? series.at(-1)?.value;
                    const prev = series.length >= 2 ? series[series.length - 2]?.value : null;
                    const chg = latest != null && prev != null && prev > 0 ? ((latest - prev) / prev) * 100 : null;
                    const high = stats?.high;
                    const low = stats?.low;
                    return (
                      <div key={rd.key} style={{ borderRight: i < 2 ? "1px solid #1a1a1a" : undefined, borderBottom: "1px solid #1a1a1a" }}>
                        <div style={{ padding: "14px 16px 0" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <div>
                              <span style={{ fontSize: 11, fontWeight: 700, color: rd.color }}>{rd.label}</span>
                              <span style={{ fontSize: 9, color: "#444", marginLeft: 6 }}>{rd.sub}</span>
                            </div>
                            {chg != null && (
                              <span style={{ fontSize: 10, fontWeight: 700, color: chg >= 0 ? "#22c55e" : "#ef4444" }}>
                                {chg >= 0 ? "▲" : "▼"}{Math.abs(chg).toFixed(1)}%
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize: 24, fontWeight: 800, color: rd.color, marginTop: 6 }}>
                            {latest != null ? `$${fmtNum(Math.round(latest))}` : "\u2014"}
                          </div>
                          <div style={{ display: "flex", gap: 10, fontSize: 9, color: "#555", marginTop: 4 }}>
                            {high != null && <span>52w Hi: <span style={{ color: "#888" }}>${fmtNum(Math.round(high))}</span></span>}
                            {low != null && <span>Lo: <span style={{ color: "#888" }}>${fmtNum(Math.round(low))}</span></span>}
                          </div>
                        </div>
                        <div style={{ padding: "8px 16px 14px" }}>
                          {renderRateChart(rd.key, series, "100%", 100, rd.color)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* ── SECTION 4: Specialty & Gas Rates ── */}
              <div style={{ borderBottom: "1px solid #222" }}>
                <div style={{ ...S.section, background: "#0e0e0e" }}>
                  <span style={{ color: "#22c55e" }}>&#9679;</span> GAS, LNG & SPECIALTY
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 0 }}>
                  {[
                    { label: "VLGC ME→Asia", key: "VLGC_ME_ASIA", color: "#22c55e", sub: "LPG Carrier" },
                    { label: "LNG Spot TFDE", key: "LNG_SPOT_TFDE", color: "#10b981", sub: "LNG Carrier" },
                    { label: "SCFI", key: "SCFI", color: "#ec4899", sub: "Container Freight" },
                  ].map((rd, i) => {
                    const stats = marketStats[rd.key];
                    const series = marketRates[rd.key] || [];
                    const latest = stats?.latest ?? series.at(-1)?.value;
                    const prev = series.length >= 2 ? series[series.length - 2]?.value : null;
                    const chg = latest != null && prev != null && prev > 0 ? ((latest - prev) / prev) * 100 : null;
                    const high = stats?.high;
                    const low = stats?.low;
                    return (
                      <div key={rd.key} style={{ borderRight: i < 2 ? "1px solid #1a1a1a" : undefined, borderBottom: "1px solid #1a1a1a" }}>
                        <div style={{ padding: "14px 16px 0" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <div>
                              <span style={{ fontSize: 11, fontWeight: 700, color: rd.color }}>{rd.label}</span>
                              <span style={{ fontSize: 9, color: "#444", marginLeft: 6 }}>{rd.sub}</span>
                            </div>
                            {chg != null && (
                              <span style={{ fontSize: 10, fontWeight: 700, color: chg >= 0 ? "#22c55e" : "#ef4444" }}>
                                {chg >= 0 ? "▲" : "▼"}{Math.abs(chg).toFixed(1)}%
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize: 24, fontWeight: 800, color: rd.color, marginTop: 6 }}>
                            {latest != null ? (rd.key === "SCFI" ? fmtNum(Math.round(latest)) : `$${fmtNum(Math.round(latest))}`) : "\u2014"}
                          </div>
                          <div style={{ display: "flex", gap: 10, fontSize: 9, color: "#555", marginTop: 4 }}>
                            {high != null && <span>52w Hi: <span style={{ color: "#888" }}>{rd.key === "SCFI" ? "" : "$"}{fmtNum(Math.round(high))}</span></span>}
                            {low != null && <span>Lo: <span style={{ color: "#888" }}>{rd.key === "SCFI" ? "" : "$"}{fmtNum(Math.round(low))}</span></span>}
                          </div>
                        </div>
                        <div style={{ padding: "8px 16px 14px" }}>
                          {renderRateChart(rd.key, series, "100%", 100, rd.color)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* ── SECTION 5: BDI Full-Width Chart ── */}
              <div style={{ borderBottom: "1px solid #222" }}>
                <div style={{ ...S.section, display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <span>BALTIC DRY INDEX — 1 YEAR</span>
                  {marketStats["BDI"] && (
                    <div style={{ display: "flex", gap: 12, alignItems: "baseline" }}>
                      <span style={{ fontSize: 20, fontWeight: 800, color: "#f97316" }}>{fmtNum(marketStats["BDI"].latest)}</span>
                      {(() => {
                        const s = marketRates["BDI"] || [];
                        const first = s[0]?.value;
                        const last = s.at(-1)?.value;
                        const ytd = first && last ? ((last - first) / first) * 100 : null;
                        return ytd != null ? (
                          <span style={{ fontSize: 10, fontWeight: 700, color: ytd >= 0 ? "#22c55e" : "#ef4444" }}>
                            YTD {ytd >= 0 ? "+" : ""}{ytd.toFixed(1)}%
                          </span>
                        ) : null;
                      })()}
                    </div>
                  )}
                </div>
                <div style={{ padding: "8px 16px 16px" }}>
                  {renderRateChart("BDI", marketRates["BDI"] || [], "100%", 200, "#f97316")}
                </div>
              </div>

              {/* ── SECTION 6: Commodity Benchmarks ── */}
              <div style={{ borderBottom: "1px solid #222" }}>
                <div style={{ ...S.section, background: "#0e0e0e" }}>
                  <span style={{ color: "#eab308" }}>&#9679;</span> COMMODITY BENCHMARKS
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0 }}>
                  {[
                    { label: "Brent Crude", key: "BRENT", color: "#eab308", unit: "$/bbl" },
                    { label: "Iron Ore 62% Fe", key: "IRON_ORE", color: "#94a3b8", unit: "$/t" },
                  ].map((rd, i) => {
                    const stats = marketStats[rd.key];
                    const series = marketRates[rd.key] || [];
                    const latest = stats?.latest ?? series.at(-1)?.value;
                    const prev = series.length >= 2 ? series[series.length - 2]?.value : null;
                    const chg = latest != null && prev != null && prev > 0 ? ((latest - prev) / prev) * 100 : null;
                    const high = stats?.high;
                    const low = stats?.low;
                    return (
                      <div key={rd.key} style={{ borderRight: i < 1 ? "1px solid #1a1a1a" : undefined }}>
                        <div style={{ padding: "14px 16px 0" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <div>
                              <span style={{ fontSize: 11, fontWeight: 700, color: rd.color }}>{rd.label}</span>
                              <span style={{ fontSize: 9, color: "#444", marginLeft: 6 }}>{rd.unit}</span>
                            </div>
                            {chg != null && (
                              <span style={{ fontSize: 10, fontWeight: 700, color: chg >= 0 ? "#22c55e" : "#ef4444" }}>
                                {chg >= 0 ? "▲" : "▼"}{Math.abs(chg).toFixed(1)}%
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize: 24, fontWeight: 800, color: rd.color, marginTop: 6 }}>
                            ${latest != null ? latest.toFixed(1) : "\u2014"}
                          </div>
                          <div style={{ display: "flex", gap: 10, fontSize: 9, color: "#555", marginTop: 4 }}>
                            {high != null && <span>52w Hi: <span style={{ color: "#888" }}>${high.toFixed(1)}</span></span>}
                            {low != null && <span>Lo: <span style={{ color: "#888" }}>${low.toFixed(1)}</span></span>}
                          </div>
                        </div>
                        <div style={{ padding: "8px 16px 14px" }}>
                          {renderRateChart(rd.key, series, "100%", 100, rd.color)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* ── SECTION 7: Company vs Market Rate Table ── */}
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
                          <tr style={{ background: "#111" }}>
                            <th style={{ textAlign: "left", padding: "8px 10px", fontWeight: 700, color: "#666", fontSize: 9, letterSpacing: "0.06em", borderBottom: "2px solid #333" }}>VESSEL CLASS</th>
                            <th style={{ textAlign: "right", padding: "8px 10px", fontWeight: 700, color: "#f97316", fontSize: 9, letterSpacing: "0.06em", borderBottom: "2px solid #333" }}>MARKET SPOT</th>
                            {companyTickers.map(t => (
                              <th key={t} style={{ textAlign: "right", padding: "8px 10px", fontWeight: 700, color: companies.find(c => c.ticker === t)?.color_hex || "#888", fontSize: 9, letterSpacing: "0.06em", borderBottom: "2px solid #333" }}>{t}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {vesselClasses.map(vc => (
                            <tr key={vc} className="sh-row" style={{ borderBottom: "1px solid #1a1a1a" }}>
                              <td style={{ padding: "6px 10px", fontWeight: 700, color: "#ccc" }}>{vc}</td>
                              <td style={{ padding: "6px 10px", textAlign: "right", color: "#f97316", fontWeight: 700, fontSize: 12 }}>
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
                                        <div style={{ fontWeight: 700, color: delta != null && delta > 0 ? "#22c55e" : delta != null && delta < 0 ? "#ef4444" : "#888", fontSize: 11 }}>
                                          {fmtRate(rate)}
                                        </div>
                                        {delta != null && (
                                          <div style={{ fontSize: 8, fontWeight: 700, color: delta >= 0 ? "#22c55e" : "#ef4444", marginTop: 1 }}>
                                            {delta >= 0 ? "+" : ""}{delta.toFixed(1)}%
                                          </div>
                                        )}
                                      </>
                                    ) : <span style={{ color: "#333" }}>{"\u2014"}</span>}
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {/* Legend */}
                    <div style={{ display: "flex", gap: 14, justifyContent: "center", padding: "6px 0 4px", fontSize: 9, color: "#555" }}>
                      <span><span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 1, background: "rgba(34,197,94,0.3)", marginRight: 3, verticalAlign: "middle" }} /> Above market</span>
                      <span><span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 1, background: "rgba(239,68,68,0.3)", marginRight: 3, verticalAlign: "middle" }} /> Below market</span>
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

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
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 0, borderBottom: "1px solid #222" }}>
                    <div style={{ padding: "8px 12px", borderRight: "1px solid #1a1a1a" }}>
                      <div style={{ fontSize: 8, color: "#555", fontWeight: 700, letterSpacing: "0.08em" }}>TOTAL CONTRACTS</div>
                      <div style={{ fontSize: 16, fontWeight: 700, color: "#f97316", marginTop: 2 }}>{contracts.length}</div>
                    </div>
                    <div style={{ padding: "8px 12px", borderRight: "1px solid #1a1a1a" }}>
                      <div style={{ fontSize: 8, color: "#555", fontWeight: 700, letterSpacing: "0.08em" }}>TC / SPOT SPLIT</div>
                      <div style={{ marginTop: 2 }}>
                        <span style={{ fontSize: 14, fontWeight: 700, color: "#3b82f6" }}>{tcContracts.length}</span>
                        <span style={{ fontSize: 10, color: "#555" }}> TC </span>
                        <span style={{ fontSize: 14, fontWeight: 700, color: "#f97316" }}>{spotContracts.length}</span>
                        <span style={{ fontSize: 10, color: "#555" }}> Spot</span>
                      </div>
                    </div>
                    <div style={{ padding: "8px 12px", borderRight: "1px solid #1a1a1a" }}>
                      <div style={{ fontSize: 8, color: "#555", fontWeight: 700, letterSpacing: "0.08em" }}>AVG RATE</div>
                      <div style={{ fontSize: 16, fontWeight: 700, color: "#f97316", marginTop: 2 }}>{avgRate != null ? fmtRate(avgRate) : "\u2014"}</div>
                    </div>
                    <div style={{ padding: "8px 12px", borderRight: "1px solid #1a1a1a" }}>
                      <div style={{ fontSize: 8, color: "#555", fontWeight: 700, letterSpacing: "0.08em" }}>vs SPOT</div>
                      <div style={{ marginTop: 2 }}>
                        <span style={{ fontSize: 14, fontWeight: 700, color: "#22c55e" }}>{aboveSpot}</span>
                        <span style={{ fontSize: 10, color: "#555" }}> above </span>
                        <span style={{ fontSize: 14, fontWeight: 700, color: "#ef4444" }}>{belowSpot}</span>
                        <span style={{ fontSize: 10, color: "#555" }}> below</span>
                      </div>
                    </div>
                    <div style={{ padding: "8px 12px", borderRight: "1px solid #1a1a1a" }}>
                      <div style={{ fontSize: 8, color: "#555", fontWeight: 700, letterSpacing: "0.08em" }}>EXPIRING &lt;90D</div>
                      <div style={{ fontSize: 16, fontWeight: 700, color: expiring90 > 0 ? "#ef4444" : "#888", marginTop: 2 }}>{expiring90}</div>
                    </div>
                    <div style={{ padding: "8px 12px" }}>
                      <div style={{ fontSize: 8, color: "#555", fontWeight: 700, letterSpacing: "0.08em" }}>EXPIRING 90-180D</div>
                      <div style={{ fontSize: 16, fontWeight: 700, color: expiring180 > 0 ? "#f59e0b" : "#888", marginTop: 2 }}>{expiring180}</div>
                    </div>
                  </div>
                );
              })()}

              {/* Controls */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 10px", background: "#111", borderBottom: "1px solid #222" }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#888", letterSpacing: "0.06em" }}>
                  VESSEL EMPLOYMENT &mdash; {contracts.length} contracts
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span style={{ fontSize: 9, color: "#555" }}>GROUP:</span>
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
                fontSize: 8,
                fontWeight: 700,
                color: "#555",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                background: "#111",
                borderBottom: "1px solid #222",
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
                    const col = co?.color_hex || SECTOR_COLORS[co?.sector || ""] || "#888";
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
                          background: "#0e0e0e",
                          borderBottom: "1px solid #222",
                          borderTop: "1px solid #222",
                        }}>
                          <div style={{ width: 8, height: 8, borderRadius: "50%", background: col }} />
                          <span style={{ fontWeight: 700, color: col, fontSize: 11 }}>{ticker}</span>
                          <span style={{ color: "#555", fontSize: 9 }}>{co?.company_name?.replace(/\s*ASA\s*$/i, "")}</span>
                          <span style={{ fontSize: 9, color: "#888", marginLeft: 8 }}>{tcCount > 0 && <span style={{ color: "#3b82f6" }}>{tcCount} TC</span>}{tcCount > 0 && spotCount > 0 && " / "}{spotCount > 0 && <span style={{ color: "#f97316" }}>{spotCount} Spot</span>}</span>
                          <span style={{ fontSize: 9, color: "#666", marginLeft: "auto" }}>
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
                        <tr style={{ background: "#111" }}>
                          <th style={{ textAlign: "left", padding: "6px 8px", fontWeight: 700, color: "#666", fontSize: 9, letterSpacing: "0.06em", borderBottom: "1px solid #222" }}>COMPANY</th>
                          {vesselClasses.map(vc => (
                            <th key={vc} style={{ textAlign: "center", padding: "6px 8px", fontWeight: 700, color: "#666", fontSize: 9, letterSpacing: "0.06em", borderBottom: "1px solid #222" }}>{vc}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {exposureTickers.map(tk => {
                          const co = companies.find(c => c.ticker === tk);
                          const col = co?.color_hex || "#888";
                          return (
                            <tr key={tk} className="sh-row" style={{ borderBottom: "1px solid #1a1a1a" }}>
                              <td style={{ padding: "5px 8px", fontWeight: 700, color: col }}>{tk}</td>
                              {vesselClasses.map(vc => {
                                const cell = exposureMatrix.find(e => e.ticker === tk && e.vessel_class === vc);
                                if (!cell) return <td key={vc} style={{ padding: "5px 8px", textAlign: "center", color: "#333" }}>{"\u2014"}</td>;
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
                  <div style={{ display: "flex", gap: 14, justifyContent: "center", padding: "6px 0 4px", fontSize: 9, color: "#555" }}>
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
          <div style={{ borderTop: "1px solid #1a1a1a", marginTop: 16, padding: "12px 10px", fontSize: 9, color: "#444", lineHeight: 1.8 }}>
            <span style={{ fontWeight: 700, color: "#555", letterSpacing: "0.06em" }}>DATA SOURCES</span>
            <div style={{ marginTop: 4 }}>
              <span style={{ color: "#666" }}>Market Rates:</span> Yahoo Finance (BDI), Pareto Shipping Daily &middot;{" "}
              <span style={{ color: "#666" }}>Fleet & Vessels:</span> Company filings, quarterly fleet reports &middot;{" "}
              <span style={{ color: "#666" }}>Contracts:</span> Quarterly fleet reports, broker estimates &middot;{" "}
              <span style={{ color: "#666" }}>Commodities:</span> ICE Brent, SGX Iron Ore &middot;{" "}
              <span style={{ color: "#666" }}>Indices:</span> Baltic Exchange (BDI, BDTI, BCTI), Shanghai Shipping Exchange (SCFI)
            </div>
          </div>

        </div>
      </main>
    </>
  );

  /* ─── Contract row renderer ───────────────────────────────────── */

  function renderContractRow(c: ContractItem) {
    const co = companies.find(co => co.ticker === c.company_ticker);
    const col = c.color_hex || co?.color_hex || SECTOR_COLORS[c.sector] || "#888";
    const sizeLabel = c.dwt ? fmtDwt(c.dwt) : c.teu ? `${fmtNum(c.teu)} TEU` : c.cbm ? `${fmtNum(c.cbm)} CBM` : "\u2014";

    return (
      <div
        key={`${c.imo}-${c.contract_start}`}
        className="sh-row"
        style={{
          display: "grid",
          gridTemplateColumns: "76px 1fr 76px 64px 62px 76px 56px 90px 76px 76px 56px 64px",
          padding: "4px 8px",
          borderBottom: "1px solid #1a1a1a",
          alignItems: "center",
          fontSize: 10,
          transition: "background 0.08s",
        }}
      >
        {/* Company */}
        <div style={{ fontWeight: 600, color: col }}>{c.company_ticker}</div>
        {/* Vessel */}
        <div style={{ color: "#e5e5e5", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.vessel_name}</div>
        {/* Class */}
        <div style={{ color: "#888", fontSize: 9, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.vessel_class || c.vessel_type}</div>
        {/* DWT */}
        <div style={{ textAlign: "right", color: "#888" }}>{sizeLabel}</div>
        {/* Contract type */}
        <div>
          {(() => {
            const isTc = ["time_charter", "coa", "bareboat"].includes(c.contract_type);
            const isSpot = ["spot", "voyage_charter"].includes(c.contract_type);
            const label = c.contract_type === "time_charter" ? "TC" : c.contract_type === "coa" ? "CoA" : c.contract_type === "bareboat" ? "BB" : c.contract_type === "spot" ? "SPOT" : c.contract_type === "voyage_charter" ? "VC" : c.contract_type === "pool" ? "POOL" : c.contract_type === "idle" ? "IDLE" : (c.contract_type || "\u2014").toUpperCase();
            return (
              <span style={{
                fontSize: 8, fontWeight: 700, padding: "1px 4px", borderRadius: 2, letterSpacing: "0.04em",
                background: isTc ? "rgba(59,130,246,0.15)" : isSpot ? "rgba(249,115,22,0.15)" : "rgba(107,114,128,0.15)",
                color: isTc ? "#3b82f6" : isSpot ? "#f97316" : "#888",
              }}>
                {label}
              </span>
            );
          })()}
        </div>
        {/* Rate */}
        <div style={{ textAlign: "right", fontWeight: 600, color: "#f97316" }}>
          {c.rate_usd_per_day != null ? fmtRate(c.rate_usd_per_day) : c.rate_worldscale != null ? `WS${c.rate_worldscale}` : "\u2014"}
        </div>
        {/* Spot rate */}
        <div style={{ textAlign: "right", color: "#666", fontSize: 9 }}>
          {c.spot_rate != null ? fmtRate(c.spot_rate) : "\u2014"}
        </div>
        {/* Charterer */}
        <div style={{ color: "#666", fontSize: 9, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.charterer || "\u2014"}</div>
        {/* Start */}
        <div style={{ textAlign: "right", color: "#555", fontSize: 9 }}>{fmtDate(c.contract_start)}</div>
        {/* End */}
        <div style={{ textAlign: "right", color: "#555", fontSize: 9 }}>{fmtDate(c.contract_end)}</div>
        {/* Days remaining */}
        <div style={{ textAlign: "right", fontWeight: 600, color: daysColor(c.days_remaining) }}>
          {c.days_remaining != null ? c.days_remaining : "\u2014"}
        </div>
        {/* vs Spot */}
        <div style={{
          textAlign: "right", fontWeight: 700,
          color: c.rate_vs_spot_pct == null ? "#555" : (c.rate_vs_spot_pct >= 0 ? "#22c55e" : "#ef4444"),
        }}>
          {fmtPct(c.rate_vs_spot_pct)}
        </div>
      </div>
    );
  }
}