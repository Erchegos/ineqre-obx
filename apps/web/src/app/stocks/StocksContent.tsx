"use client";

import Link from "next/link";
import { useEffect, useState, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { calculateDataQualityMetrics, type DataTier } from "@/lib/dataQuality";

type AssetType = "equity" | "index" | "commodity_etf" | "index_etf";

type StockData = {
  ticker: string;
  name: string;
  asset_type: AssetType;
  sector: string | null;
  currency: string;
  last_close: number;
  last_adj_close: number;
  start_date: string;
  end_date: string;
  rows: number;
  mktcap: number | null;
  expectedDays: number;
  completenessPct: number;
  dataTier: DataTier;
  dualPair?: string;
};

type RawApiStock = Omit<StockData, "expectedDays" | "completenessPct" | "dataTier" | "dualPair">;

function enrichRaw(raw: RawApiStock[]): StockData[] {
  return raw.map((stock) => {
    const metrics = calculateDataQualityMetrics(
      stock.start_date,
      stock.end_date,
      stock.rows,
      stock.ticker
    );
    return { ...stock, ...metrics };
  });
}

const ASSET_TYPE_LABELS: Record<AssetType, string> = {
  equity: "Equities",
  index: "Indexes",
  commodity_etf: "Commodity ETFs",
  index_etf: "Index ETFs",
};

const SECTOR_COLORS: Record<string, string> = {
  Energy: "#f97316",
  "Oil & Gas": "#f97316",
  Seafood: "#10b981",
  Aquaculture: "#10b981",
  Shipping: "#38bdf8",
  Financials: "#6366f1",
  Finance: "#6366f1",
  Banking: "#6366f1",
  Materials: "#fbbf24",
  "Real Estate": "#a78bfa",
  Technology: "#60a5fa",
  "Technology & IT": "#60a5fa",
  Consumer: "#ec4899",
  "Consumer Discretionary": "#ec4899",
  "Consumer Staples": "#f472b6",
  Healthcare: "#34d399",
  Industrials: "#94a3b8",
  Utilities: "#fb7185",
  Telecom: "#e879f9",
  Communication: "#e879f9",
  Offshore: "#fb923c",
  "Oil Services": "#fb923c",
};

function getSectorColor(sector: string | null): string {
  if (!sector) return "rgba(255,255,255,0.25)";
  if (SECTOR_COLORS[sector]) return SECTOR_COLORS[sector];
  for (const [key, color] of Object.entries(SECTOR_COLORS)) {
    if (
      sector.toLowerCase().includes(key.toLowerCase()) ||
      key.toLowerCase().includes(sector.toLowerCase())
    ) return color;
  }
  return "#64748b";
}

function formatMktCap(mktcap: number | null): string {
  if (mktcap == null) return "—";
  if (mktcap >= 1e12) return `${(mktcap / 1e12).toFixed(1)}T`;
  if (mktcap >= 1e9) return `${(mktcap / 1e9).toFixed(1)}B`;
  if (mktcap >= 1e6) return `${(mktcap / 1e6).toFixed(0)}M`;
  return `${(mktcap / 1e3).toFixed(0)}K`;
}

const CSS = `
  .uni-table { width: 100%; border-collapse: collapse; }
  .uni-table tbody tr {
    transition: background 0.12s;
    cursor: pointer;
    border-bottom: 1px solid #1e2530;
  }
  .uni-table tbody tr:hover { background: rgba(59,130,246,0.07) !important; }
  .uni-table tbody tr:hover .row-ticker { color: #60a5fa !important; }
  .th-btn {
    background: none; border: none; color: rgba(255,255,255,0.45);
    cursor: pointer; font-family: monospace; font-size: 9px; font-weight: 700;
    letter-spacing: 0.09em; text-transform: uppercase; display: inline-flex;
    align-items: center; gap: 5px; padding: 0; white-space: nowrap;
  }
  .th-btn:hover { color: rgba(255,255,255,0.85); }
  .badge-link {
    text-decoration: none; display: inline-flex; align-items: center;
    transition: opacity 0.15s;
  }
  .badge-link:hover { opacity: 0.65; }
  .filter-pill {
    cursor: pointer; transition: all 0.15s ease; border: none;
    background: none; font-family: monospace;
  }
  .type-btn {
    cursor: pointer; border-radius: 5px; border: 1px solid #30363d;
    background: #161b22; color: rgba(255,255,255,0.55); font-family: monospace;
    font-size: 10px; font-weight: 600; transition: all 0.15s; white-space: nowrap;
    letter-spacing: 0.05em; padding: 6px 12px;
  }
  .type-btn.active { background: #3b82f6; border-color: #3b82f6; color: #fff; }
  .type-btn:hover:not(.active) { border-color: #3b82f6; color: #fff; background: rgba(59,130,246,0.1); }
  .search-inp {
    width: 100%; padding: 10px 14px; font-size: 13px; background: #161b22;
    border: 1px solid #30363d; border-radius: 6px; color: #fff; outline: none;
    font-family: monospace; transition: border-color 0.2s; box-sizing: border-box;
  }
  .search-inp:focus { border-color: #3b82f6; box-shadow: 0 0 0 3px rgba(59,130,246,0.1); }
  .search-inp::placeholder { color: rgba(255,255,255,0.25); }
  .sector-chip {
    cursor: pointer; transition: all 0.15s; font-family: monospace;
    font-size: 10px; font-weight: 600; border-radius: 4px; padding: 4px 9px;
  }
  .nav-link {
    color: rgba(255,255,255,0.55); text-decoration: none; font-size: 10px;
    font-weight: 600; padding: 6px 12px; border: 1px solid #30363d;
    border-radius: 5px; background: #161b22; font-family: monospace;
    letter-spacing: 0.06em; transition: all 0.15s; display: inline-block;
  }
  .nav-link:hover { border-color: #3b82f6; color: #3b82f6; }
  .skeleton { background: linear-gradient(90deg, #1e2530 25%, #252d3a 50%, #1e2530 75%); background-size: 200% 100%; animation: shimmer 1.5s infinite; border-radius: 3px; }
  @keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
`;

export default function StocksContent({
  initialStocks,
  initialFactorTickers,
  initialBacktestTickers,
}: {
  initialStocks?: RawApiStock[];
  initialFactorTickers?: string[];
  initialBacktestTickers?: string[];
}) {
  const router = useRouter();

  const [stocks, setStocks] = useState<StockData[]>(() =>
    initialStocks ? enrichRaw(initialStocks) : []
  );
  const [loading, setLoading] = useState(!initialStocks?.length);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<keyof StockData>("mktcap");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [selectedTypes, setSelectedTypes] = useState<Set<AssetType>>(new Set(["equity"]));
  const [selectedSectors, setSelectedSectors] = useState<Set<string>>(new Set());
  const [featureFilter, setFeatureFilter] = useState<string | null>(null);

  // Tag data — seeded from SSR for the two most-visible badges
  const [factorTickers, setFactorTickers] = useState<Set<string>>(
    () => new Set(initialFactorTickers ?? [])
  );
  const [backtestTickers, setBacktestTickers] = useState<Set<string>>(
    () => new Set(initialBacktestTickers ?? [])
  );
  const [optionsTickers, setOptionsTickers] = useState<Set<string>>(new Set());
  const [valuationTickers, setValuationTickers] = useState<Set<string>>(new Set());

  const fetchStocks = useCallback(async (types: Set<AssetType>) => {
    setLoading(true);
    try {
      const typesParam = Array.from(types).join(",");
      const res = await fetch(`/api/stocks?assetTypes=${typesParam}`);
      if (!res.ok) throw new Error(res.statusText);
      const data = await res.json();
      setStocks(enrichRaw(data));
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const isDefaultEquities = selectedTypes.size === 1 && selectedTypes.has("equity");
    if (initialStocks && isDefaultEquities) return;
    fetchStocks(selectedTypes);
  }, [selectedTypes, fetchStocks, initialStocks]);

  // Client-side: only fetch options + valuation (factors/backtest come from SSR)
  useEffect(() => {
    const fetchRemainingTags = async () => {
      const [optionsRes, excelRes, editsRes] = await Promise.all([
        fetch("/api/options").catch(() => null),
        fetch("/api/valuation/excel?list=true").catch(() => null),
        fetch("/api/valuation/excel/edits?list=true").catch(() => null),
      ]);
      if (optionsRes?.ok) {
        const d = await optionsRes.json().catch(() => ({}));
        if (d.stocks) setOptionsTickers(new Set(d.stocks.map((s: { ticker: string }) => s.ticker)));
      }
      const xlsTickers = new Set<string>();
      if (excelRes?.ok) {
        const d = await excelRes.json().catch(() => ({}));
        if (d.tickers) d.tickers.forEach((t: string) => xlsTickers.add(t));
      }
      if (editsRes?.ok) {
        const d = await editsRes.json().catch(() => ({}));
        if (d?.tickers) d.tickers.forEach((t: string) => xlsTickers.add(t));
      }
      if (xlsTickers.size > 0) setValuationTickers(xlsTickers);
    }
    fetchRemainingTags();
  }, []);

  const hasOptions = useCallback(
    (ticker: string) => {
      if (ticker.endsWith(".US")) return optionsTickers.has(ticker.replace(".US", ""));
      return false;
    },
    [optionsTickers]
  );

  const availableSectors = useMemo(() => {
    const sectors = new Set<string>();
    stocks.forEach((s) => { if (s.sector) sectors.add(s.sector); });
    return Array.from(sectors).sort();
  }, [stocks]);

  const filteredAndSorted = useMemo(() => {
    // Hide F-tier (insufficient data) by default
    let filtered = stocks.filter((s) => s.dataTier !== "F");

    if (featureFilter === "predictions")
      filtered = filtered.filter((s) => factorTickers.has(s.ticker));
    else if (featureFilter === "options")
      filtered = filtered.filter((s) => hasOptions(s.ticker));
    else if (featureFilter === "backtest")
      filtered = filtered.filter((s) => backtestTickers.has(s.ticker));
    else if (featureFilter === "valuation")
      filtered = filtered.filter((s) => valuationTickers.has(s.ticker));

    if (selectedSectors.size > 0)
      filtered = filtered.filter((s) => s.sector && selectedSectors.has(s.sector));

    if (search.trim()) {
      const q = search.toLowerCase();
      filtered = filtered.filter(
        (s) => s.ticker.toLowerCase().includes(q) || s.name.toLowerCase().includes(q)
      );
    }

    return [...filtered].sort((a, b) => {
      let av: any = a[sortBy];
      let bv: any = b[sortBy];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "string") { av = av.toLowerCase(); bv = (bv as string).toLowerCase(); }
      return sortOrder === "asc"
        ? av > bv ? 1 : av < bv ? -1 : 0
        : av < bv ? 1 : av > bv ? -1 : 0;
    });
  }, [
    stocks, featureFilter, selectedSectors, search, sortBy, sortOrder,
    factorTickers, backtestTickers, valuationTickers, hasOptions,
  ]);

  const toggleSort = (col: keyof StockData) => {
    if (sortBy === col) setSortOrder((o) => (o === "asc" ? "desc" : "asc"));
    else { setSortBy(col); setSortOrder("desc"); }
  };

  const SortArrow = ({ col }: { col: keyof StockData }) =>
    sortBy !== col
      ? <span style={{ opacity: 0.25 }}>↕</span>
      : sortOrder === "asc"
        ? <span style={{ color: "#3b82f6" }}>↑</span>
        : <span style={{ color: "#3b82f6" }}>↓</span>;

  const optionsCount = useMemo(
    () => stocks.filter((s) => hasOptions(s.ticker)).length,
    [stocks, hasOptions]
  );

  if (error) {
    return (
      <div style={{ minHeight: "100vh", background: "#0a0a0a", color: "#fff", padding: 32 }}>
        <p style={{ color: "#ef4444", fontFamily: "monospace", fontSize: 13 }}>{error}</p>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "#0a0a0a", color: "#fff", padding: "24px 28px" }}>
      <style>{CSS}</style>

      <div style={{ maxWidth: 1400, margin: "0 auto" }}>

        {/* ── HEADER ── */}
        <div style={{
          display: "flex", alignItems: "flex-start", justifyContent: "space-between",
          marginBottom: 22, gap: 16, flexWrap: "wrap",
        }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, margin: "0 0 5px", letterSpacing: "-0.02em" }}>
              OSE Universe
            </h1>
            <p style={{ fontSize: 11, color: "rgba(255,255,255,0.38)", margin: 0, fontFamily: "monospace" }}>
              {loading ? "Loading…" : `${stocks.filter(s => s.dataTier !== "F").length} companies`}
              {factorTickers.size > 0 && (
                <span style={{ color: "#10b981" }}>{" · "}{factorTickers.size} with ML predictions</span>
              )}
              {optionsCount > 0 && (
                <span style={{ color: "#f59e0b" }}>{" · "}{optionsCount} with options</span>
              )}
              <span style={{ color: "rgba(255,255,255,0.2)" }}>{" · Oslo Stock Exchange"}</span>
            </p>
          </div>
          <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
            {[
              { href: "/options", label: "Options" },
              { href: "/correlation", label: "Correlation" },
            ].map(({ href, label }) => (
              <Link key={href} href={href} className="nav-link">{label} →</Link>
            ))}
          </div>
        </div>

        {/* ── FILTER ROW 1: Search + Asset Type ── */}
        <div style={{
          display: "flex", gap: 10, marginBottom: 10,
          alignItems: "center", flexWrap: "wrap",
        }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <input
              type="text"
              className="search-inp"
              placeholder="Search ticker or company…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div style={{ display: "flex", gap: 5, flexShrink: 0, flexWrap: "wrap" }}>
            {(Object.keys(ASSET_TYPE_LABELS) as AssetType[]).map((type) => {
              const isActive = selectedTypes.has(type);
              return (
                <button
                  key={type}
                  className={`type-btn${isActive ? " active" : ""}`}
                  onClick={() =>
                    setSelectedTypes((prev) => {
                      const next = new Set(prev);
                      if (next.has(type)) { if (next.size > 1) next.delete(type); }
                      else next.add(type);
                      return next;
                    })
                  }
                >
                  {ASSET_TYPE_LABELS[type]}
                </button>
              );
            })}
          </div>
        </div>

        {/* ── FILTER ROW 2: Feature pills + Sector chips ── */}
        <div style={{
          display: "flex", gap: 8, marginBottom: 20,
          alignItems: "center", flexWrap: "wrap",
        }}>
          {/* Feature quick-filter */}
          {[
            { key: null,          label: "All",         color: "#3b82f6" },
            { key: "predictions", label: "Predictions", color: "#10b981" },
            { key: "options",     label: "Options",     color: "#f59e0b" },
            { key: "backtest",    label: "Backtest",    color: "#60a5fa" },
            { key: "valuation",   label: "Valuation",   color: "#4ade80" },
          ].map(({ key, label, color }) => {
            const isActive = featureFilter === key;
            return (
              <button
                key={String(key)}
                className="filter-pill"
                onClick={() => setFeatureFilter(key)}
                style={{
                  padding: "5px 11px",
                  fontSize: 10,
                  fontWeight: 700,
                  borderRadius: 4,
                  border: isActive ? `1px solid ${color}` : "1px solid #30363d",
                  background: isActive ? `${color}18` : "transparent",
                  color: isActive ? color : "rgba(255,255,255,0.4)",
                  letterSpacing: "0.07em",
                  textTransform: "uppercase",
                }}
              >
                {label}
              </button>
            );
          })}

          {availableSectors.length > 0 && (
            <span style={{ width: 1, height: 16, background: "#30363d", flexShrink: 0 }} />
          )}

          {/* Sector chips */}
          {availableSectors.map((sector) => {
            const isActive = selectedSectors.has(sector);
            const color = getSectorColor(sector);
            return (
              <button
                key={sector}
                className="sector-chip"
                onClick={() =>
                  setSelectedSectors((prev) => {
                    const next = new Set(prev);
                    if (next.has(sector)) next.delete(sector); else next.add(sector);
                    return next;
                  })
                }
                style={{
                  border: isActive ? `1px solid ${color}` : "1px solid #30363d",
                  background: isActive ? `${color}18` : "transparent",
                  color: isActive ? color : "rgba(255,255,255,0.4)",
                  letterSpacing: "0.04em",
                }}
              >
                {sector}
              </button>
            );
          })}

          {selectedSectors.size > 0 && (
            <button
              onClick={() => setSelectedSectors(new Set())}
              style={{
                padding: "4px 9px", fontSize: 10, fontWeight: 700,
                borderRadius: 4, border: "1px solid #ef4444", background: "transparent",
                color: "#ef4444", fontFamily: "monospace", cursor: "pointer",
                letterSpacing: "0.06em",
              }}
            >
              Clear ×
            </button>
          )}
        </div>

        {/* Result count */}
        {(search || featureFilter || selectedSectors.size > 0) && !loading && (
          <div style={{
            fontSize: 10, color: "rgba(255,255,255,0.35)", marginBottom: 10,
            fontFamily: "monospace", letterSpacing: "0.04em",
          }}>
            {filteredAndSorted.length} result{filteredAndSorted.length !== 1 ? "s" : ""}
          </div>
        )}

        {/* ── TABLE ── */}
        <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
          <table
            className="uni-table"
            style={{
              background: "#161b22",
              border: "1px solid #30363d",
              borderRadius: 8,
              overflow: "hidden",
              minWidth: 640,
            }}
          >
            <thead>
              <tr style={{ borderBottom: "2px solid #30363d", background: "#0d1117" }}>
                <th style={{ textAlign: "left", padding: "11px 18px 11px 18px" }}>
                  <button className="th-btn" onClick={() => toggleSort("ticker")}>
                    Company <SortArrow col="ticker" />
                  </button>
                </th>
                <th style={{ textAlign: "left", padding: "11px 16px" }}>
                  <button className="th-btn" onClick={() => toggleSort("sector")}>
                    Sector <SortArrow col="sector" />
                  </button>
                </th>
                <th style={{ textAlign: "right", padding: "11px 16px" }}>
                  <button className="th-btn" style={{ marginLeft: "auto" }} onClick={() => toggleSort("mktcap")}>
                    Mkt Cap <SortArrow col="mktcap" />
                  </button>
                </th>
                <th style={{ textAlign: "right", padding: "11px 16px" }}>
                  <button className="th-btn" style={{ marginLeft: "auto" }} onClick={() => toggleSort("last_close")}>
                    Last Close <SortArrow col="last_close" />
                  </button>
                </th>
                <th style={{ textAlign: "left", padding: "11px 18px", minWidth: 210 }}>
                  <span style={{
                    fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.35)",
                    letterSpacing: "0.09em", textTransform: "uppercase",
                  }}>
                    Features
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              {/* Loading skeleton */}
              {loading && Array.from({ length: 14 }).map((_, i) => (
                <tr key={i} style={{ borderBottom: "1px solid #1e2530" }}>
                  {[["60%", 18], ["45%", 16], ["30%", 16], ["30%", 16], ["70%", 18]].map(([w, p], j) => (
                    <td key={j} style={{ padding: `13px ${p}px` }}>
                      <div className="skeleton" style={{ height: 12, width: w, marginLeft: j >= 2 && j <= 3 ? "auto" : 0 }} />
                    </td>
                  ))}
                </tr>
              ))}

              {/* Empty state */}
              {!loading && filteredAndSorted.length === 0 && (
                <tr>
                  <td colSpan={5} style={{
                    padding: "56px 18px", textAlign: "center",
                    color: "rgba(255,255,255,0.25)", fontFamily: "monospace", fontSize: 12,
                  }}>
                    {search
                      ? `No companies matching "${search}"`
                      : "No companies found for the selected filters"}
                  </td>
                </tr>
              )}

              {/* Data rows */}
              {!loading && filteredAndSorted.map((stock) => {
                const sectorColor = getSectorColor(stock.sector);
                const hasPred = factorTickers.has(stock.ticker);
                const hasBT = backtestTickers.has(stock.ticker);
                const hasOpt = hasOptions(stock.ticker);
                const hasVal = valuationTickers.has(stock.ticker);

                return (
                  <tr key={stock.ticker} onClick={() => router.push(`/stocks/${stock.ticker}`)} onMouseEnter={() => router.prefetch(`/stocks/${stock.ticker}`)}>

                    {/* Company: ticker + name */}
                    <td style={{ padding: "13px 18px" }}>
                      <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                        <span
                          className="row-ticker"
                          style={{
                            fontSize: 13, fontWeight: 700, color: "#3b82f6",
                            fontFamily: "monospace", transition: "color 0.12s", whiteSpace: "nowrap",
                          }}
                        >
                          {stock.ticker}
                        </span>
                        <span style={{
                          fontSize: 12, color: "rgba(255,255,255,0.65)",
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                          maxWidth: 230,
                        }}>
                          {stock.name}
                        </span>
                      </div>
                    </td>

                    {/* Sector */}
                    <td style={{ padding: "13px 16px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                        <span style={{
                          width: 6, height: 6, borderRadius: "50%",
                          background: sectorColor, flexShrink: 0,
                        }} />
                        <span style={{
                          fontSize: 11, color: "rgba(255,255,255,0.5)",
                          fontFamily: "monospace", whiteSpace: "nowrap",
                        }}>
                          {stock.sector ?? "—"}
                        </span>
                      </div>
                    </td>

                    {/* Mkt Cap */}
                    <td style={{ padding: "13px 16px", textAlign: "right" }}>
                      <span style={{
                        fontFamily: "monospace", fontSize: 12, fontWeight: 600,
                        color: stock.mktcap ? "#e2e8f0" : "rgba(255,255,255,0.2)",
                      }}>
                        {formatMktCap(stock.mktcap)}
                      </span>
                    </td>

                    {/* Last Close + Currency */}
                    <td style={{ padding: "13px 16px", textAlign: "right" }}>
                      <span style={{ fontFamily: "monospace", fontSize: 13, fontWeight: 600, color: "#fff" }}>
                        {stock.last_close.toFixed(2)}
                      </span>
                      <span style={{
                        fontSize: 9, color: "rgba(255,255,255,0.3)",
                        marginLeft: 4, fontFamily: "monospace",
                      }}>
                        {stock.currency}
                      </span>
                    </td>

                    {/* Features — stop row-click propagation so badge links work */}
                    <td style={{ padding: "13px 18px" }}>
                      <div
                        style={{ display: "flex", gap: 5, flexWrap: "wrap", alignItems: "center" }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {hasPred && (
                          <Link
                            href={`/predictions/${stock.ticker}`}
                            className="badge-link"
                            style={{
                              fontSize: 9, fontWeight: 700, padding: "3px 8px", borderRadius: 3,
                              background: "rgba(16,185,129,0.12)", color: "#10b981",
                              border: "1px solid rgba(16,185,129,0.25)", fontFamily: "monospace",
                              letterSpacing: "0.04em",
                            }}
                          >
                            Predictions
                          </Link>
                        )}
                        {hasBT && (
                          <Link
                            href={`/backtest/${stock.ticker}`}
                            className="badge-link"
                            style={{
                              fontSize: 9, fontWeight: 700, padding: "3px 8px", borderRadius: 3,
                              background: "rgba(59,130,246,0.12)", color: "#60a5fa",
                              border: "1px solid rgba(59,130,246,0.25)", fontFamily: "monospace",
                              letterSpacing: "0.04em",
                            }}
                          >
                            Backtest
                          </Link>
                        )}
                        {hasOpt && (
                          <Link
                            href={`/options/${stock.ticker.replace(".US", "")}`}
                            className="badge-link"
                            style={{
                              fontSize: 9, fontWeight: 700, padding: "3px 8px", borderRadius: 3,
                              background: "rgba(245,158,11,0.12)", color: "#fbbf24",
                              border: "1px solid rgba(245,158,11,0.25)", fontFamily: "monospace",
                              letterSpacing: "0.04em",
                            }}
                          >
                            Options
                          </Link>
                        )}
                        {hasVal && (
                          <Link
                            href="/valuation"
                            className="badge-link"
                            style={{
                              fontSize: 9, fontWeight: 700, padding: "3px 8px", borderRadius: 3,
                              background: "rgba(74,222,128,0.12)", color: "#4ade80",
                              border: "1px solid rgba(74,222,128,0.25)", fontFamily: "monospace",
                              letterSpacing: "0.04em",
                            }}
                          >
                            Valuation
                          </Link>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        {!loading && filteredAndSorted.length > 0 && (
          <div style={{
            marginTop: 12, fontSize: 10, fontFamily: "monospace",
            color: "rgba(255,255,255,0.2)", textAlign: "right",
          }}>
            {filteredAndSorted.length} of {stocks.filter(s => s.dataTier !== "F").length} companies
            {" · "}Source: Interactive Brokers
          </div>
        )}
      </div>
    </div>
  );
}
