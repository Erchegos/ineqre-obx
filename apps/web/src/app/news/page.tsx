"use client";

import Link from "next/link";
import { useEffect, useState, useCallback, useRef } from "react";

/* ─── Types ────────────────────────────────────────────────────── */

type TickerRef = { ticker: string; relevance: number | null; direction: string };
type SectorRef = { sector: string; impact: number | null };
type StructuredFacts = Record<string, string | number | null>;

type NewsEvent = {
  id: number;
  publishedAt: string;
  source: string;
  headline: string;
  summary: string | null;
  eventType: string;
  severity: number;
  sentiment: number | null;
  confidence: number | null;
  providerCode: string | null;
  url: string | null;
  structuredFacts: StructuredFacts | null;
  tickers: TickerRef[];
  sectors: SectorRef[];
  primaryTicker: string | null;
  dayReturnPct: number | null;
  priceClose: number | null;
};

type ShortPosition = {
  ticker: string;
  isin: string;
  date: string;
  shortPct: number;
  totalShortShares: number | null;
  activePositions: number;
  prevShortPct: number | null;
  changePct: number | null;
  stockName: string | null;
  sector: string | null;
  history: { date: string; short_pct: number }[];
  holders: { holder: string; pct: number; shares: number | null }[];
};

type CommodityData = {
  symbol: string;
  name: string;
  currency: string;
  latest: { date: string; open: number; high: number; low: number; close: number; volume: number | null };
  dayReturnPct: number | null;
  eurClose?: number;
  nokPerEur?: number;
  history: { date: string; close: number }[];
  sensitivities: { ticker: string; stockName: string | null; sector: string | null; beta: number; correlation60d: number | null; correlation252d: number | null; rSquared: number | null }[];
};

type SectorData = {
  sector: string;
  stockCount: number;
  avgReturn: number;
  bestReturn: number;
  worstReturn: number;
  bestTicker: string | null;
  worstTicker: string | null;
  upCount: number;
  downCount: number;
  stocks: { ticker: string; name: string; returnPct: number; lastClose: number; tradeDate: string }[];
};

type Mover = {
  ticker: string;
  name: string;
  sector: string;
  lastClose: number;
  prevClose: number;
  returnPct: number;
  volume: number | null;
  tradeDate: string;
};

type InsiderTrade = {
  id: number;
  publishedAt: string;
  headline: string;
  ticker: string | null;
  stockName: string | null;
  sector: string | null;
  personName: string | null;
  personRole: string | null;
  transactionType: string | null;
  shares: number | null;
  pricePerShare: number | null;
  totalValue: number | null;
  summary: string | null;
  url: string | null;
};

type FxData = {
  pair: string;
  latest: { date: string; spot: number; logReturn: number | null; simpleReturn: number | null };
  timeSeries: { spot: { date: string; value: number }[] };
};

type OBXData = {
  index: {
    regime: string;
    regimeColor: string;
    annualizedVol: number | null;
    percentile: number | null;
    trend: string;
    interpretation: string;
    rolling20: number | null;
    rolling60: number | null;
    regimeDuration: number;
    lastClose: number | null;
    lastDate: string | null;
  };
  summary: {
    regimeDistribution: Record<string, number>;
    highVolCount: number;
    lowVolCount: number;
  };
  currentAvgCorrelation: number | null;
};

type SeafoodOverview = {
  salmonPrice: { price: number; date: string; currency: string; changePct: number | null } | null;
  industryAvgLice: number | null;
  liceThreshold: number;
  trafficLights: { green: number; yellow: number; red: number };
  activeDiseases: number;
  companyCount: number;
  sparkline: { date: string; price: number }[];
};

/* ─── Constants ────────────────────────────────────────────────── */

const SEV_C: Record<number, string> = { 1: "#555", 2: "#3b82f6", 3: "#f59e0b", 4: "#f97316", 5: "#ef4444" };
// Sector heatmap colors handled inline
const TYPE_C: Record<string, string> = {
  earnings: "#22c55e", guidance: "#3b82f6", analyst_action: "#a855f7",
  corporate_action: "#f59e0b", insider_trade: "#ec4899", regulatory: "#06b6d4",
  macro: "#6366f1", geopolitical: "#ef4444", sector_news: "#14b8a6", other: "#555",
};
const DIR_SYM: Record<string, { icon: string; color: string }> = {
  positive: { icon: "\u25B2", color: "#22c55e" },
  negative: { icon: "\u25BC", color: "#ef4444" },
  neutral: { icon: "\u2500", color: "#555" },
};
const TRAFFIC_C: Record<string, string> = { green: "#22c55e", yellow: "#f59e0b", red: "#ef4444" };
const MONO = "'Geist Mono','SF Mono','Consolas',monospace";

/* ─── Helpers ──────────────────────────────────────────────────── */

function timeAgo(d: string): string {
  const ms = Date.now() - new Date(d).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return "NOW";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function fmtPct(v: number | null | undefined, d = 2): string {
  if (v == null) return "\u2014";
  return `${v >= 0 ? "+" : ""}${(v * 100).toFixed(d)}%`;
}

function fmtPctRaw(v: number | null | undefined, d = 2): string {
  if (v == null) return "\u2014";
  return `${v >= 0 ? "+" : ""}${v.toFixed(d)}%`;
}

function fmtNum(v: number | null, compact = false): string {
  if (v == null) return "\u2014";
  if (compact && Math.abs(v) >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (compact && Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (compact && Math.abs(v) >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return v.toLocaleString();
}

function fmtPrice(v: number | null): string {
  if (v == null) return "\u2014";
  return v >= 100 ? v.toFixed(0) : v >= 1 ? v.toFixed(2) : v.toFixed(4);
}

function sparklineSvg(data: number[], w = 60, h = 16, color = "#3b82f6"): string {
  if (data.length < 2) return "";
  const mn = Math.min(...data), mx = Math.max(...data);
  const range = mx - mn || 1;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((v - mn) / range) * (h - 2) - 1;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

function importanceFilter(threshold: number, items: { importance: number }[]): typeof items {
  if (threshold <= 1) return items;
  return items.filter(i => i.importance >= threshold);
}

/* ─── Section Header Component ─────────────────────────────────── */

function SectionHeader({ title, count, color = "#f97316" }: { title: string; count?: number; color?: string }) {
  return (
    <div style={{
      fontSize: 9, fontWeight: 700, color, letterSpacing: "0.08em",
      padding: "6px 10px 4px", borderBottom: "1px solid #222", background: "#111",
      display: "flex", justifyContent: "space-between", alignItems: "center",
    }}>
      <span>{title}</span>
      {count != null && <span style={{ color: "#555", fontWeight: 500 }}>{count}</span>}
    </div>
  );
}

/* ─── Page Component ───────────────────────────────────────────── */

export default function IntelligencePage() {
  // Data state
  const [events, setEvents] = useState<NewsEvent[]>([]);
  const [shorts, setShorts] = useState<ShortPosition[]>([]);
  const [commodities, setCommodities] = useState<CommodityData[]>([]);
  const [sectors, setSectors] = useState<SectorData[]>([]);
  const [sectorTradeDate, setSectorTradeDate] = useState<string | null>(null);
  const [expandedSector, setExpandedSector] = useState<string | null>(null);
  const [expandedShort, setExpandedShort] = useState<string | null>(null);
  const [movers, setMovers] = useState<{ gainers: Mover[]; losers: Mover[] }>({ gainers: [], losers: [] });
  const [insiders, setInsiders] = useState<InsiderTrade[]>([]);
  const [fxRates, setFxRates] = useState<FxData[]>([]);
  const [obx, setObx] = useState<OBXData | null>(null);
  const [seafood, setSeafood] = useState<SeafoodOverview | null>(null);
  const [loading, setLoading] = useState(true);

  // UI state
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [tickerFilter, setTickerFilter] = useState("");
  const [importanceMin, setImportanceMin] = useState(1);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Each fetch is independent — fires in parallel, sets own state when done
  const safeFetch = useCallback(async (url: string): Promise<Response | null> => {
    try {
      const res = await fetch(url);
      return res.ok ? res : null;
    } catch {
      return null;
    }
  }, []);

  const fetchAll = useCallback(async () => {
    // Fire all fetches independently — each sets state as it arrives
    safeFetch("/api/news?limit=200").then(async res => {
      if (!res) return;
      const data = await res.json();
      const seen = new Map<string, NewsEvent>();
      for (const ev of (data.events || []) as NewsEvent[]) {
        const key = ev.headline.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
        const existing = seen.get(key);
        if (!existing || ev.severity > existing.severity) seen.set(key, ev);
      }
      setEvents(Array.from(seen.values()).sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()));
    });

    safeFetch("/api/intelligence/sectors").then(async res => {
      if (!res) return;
      const d = await res.json();
      setSectors(d.sectors || []);
      setSectorTradeDate(d.tradeDate || null);
    });

    safeFetch("/api/intelligence/movers").then(async res => {
      if (!res) return;
      const d = await res.json();
      setMovers({ gainers: d.gainers || [], losers: d.losers || [] });
    });

    safeFetch("/api/shorts").then(async res => {
      if (!res) return;
      const d = await res.json();
      setShorts(d.positions || []);
    });

    safeFetch("/api/commodities?days=90").then(async res => {
      if (!res) return;
      const d = await res.json();
      setCommodities(d.commodities || []);
    });

    safeFetch("/api/intelligence/insiders").then(async res => {
      if (!res) return;
      const d = await res.json();
      setInsiders(d.trades || []);
    });

    Promise.all([
      safeFetch("/api/fx-pairs?pair=NOKUSD&days=30"),
      safeFetch("/api/fx-pairs?pair=NOKEUR&days=30"),
      safeFetch("/api/fx-pairs?pair=NOKGBP&days=30"),
    ]).then(async results => {
      const fxArr: FxData[] = [];
      for (const res of results) {
        if (res) { const d = await res.json(); fxArr.push(d); }
      }
      setFxRates(fxArr);
    });

    safeFetch("/api/volatility/obx").then(async res => {
      if (!res) return;
      const d = await res.json();
      setObx(d);
    });

    safeFetch("/api/seafood/overview").then(async res => {
      if (!res) return;
      const d = await res.json();
      setSeafood(d);
    });

    // Loading done immediately — panels fill in as data arrives
    setLoading(false);
    setLastRefresh(new Date());
  }, [safeFetch]);

  useEffect(() => { setLoading(true); fetchAll(); }, [fetchAll]);
  useEffect(() => {
    timerRef.current = setInterval(fetchAll, 60000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [fetchAll]);

  /* ─── Filtered data ────────────────────────────────────────────── */

  // News: filter by severity >= importanceMin, ticker filter, exclude "other"
  const filteredEvents = events.filter(e => {
    if (e.severity < importanceMin) return false;
    if (e.eventType === "other" && importanceMin <= 1) return false;
    if (tickerFilter && !e.tickers?.some(t => t.ticker.includes(tickerFilter))) return false;
    return true;
  });

  // Sectors: filter by avg return magnitude
  const filteredSectors = importanceMin <= 2 ? sectors
    : importanceMin <= 3 ? sectors.filter(s => Math.abs(s.avgReturn) >= 0.5)
    : importanceMin <= 4 ? sectors.filter(s => Math.abs(s.avgReturn) >= 1)
    : sectors.filter(s => Math.abs(s.avgReturn) >= 2);

  // Shorts: filter by shortPct threshold
  const filteredShorts = importanceMin <= 1 ? shorts
    : importanceMin <= 2 ? shorts.filter(s => s.shortPct >= 0.5)
    : importanceMin <= 3 ? shorts.filter(s => s.shortPct >= 1)
    : importanceMin <= 4 ? shorts.filter(s => s.shortPct >= 3)
    : shorts.filter(s => s.shortPct >= 5);

  // Insiders: filter by total value
  const filteredInsiders = importanceMin <= 1 ? insiders
    : importanceMin <= 2 ? insiders.filter(i => (i.totalValue ?? 0) >= 100000)
    : importanceMin <= 3 ? insiders.filter(i => (i.totalValue ?? 0) >= 500000)
    : importanceMin <= 4 ? insiders.filter(i => (i.totalValue ?? 0) >= 2000000)
    : insiders.filter(i => (i.totalValue ?? 0) >= 10000000);

  // Commodities: filter by |dayReturn|
  const filteredCommodities = importanceMin <= 2 ? commodities
    : importanceMin <= 3 ? commodities.filter(c => Math.abs(c.dayReturnPct ?? 0) >= 1)
    : importanceMin <= 4 ? commodities.filter(c => Math.abs(c.dayReturnPct ?? 0) >= 3)
    : commodities.filter(c => Math.abs(c.dayReturnPct ?? 0) >= 5);

  // Stats
  const sev5Count = events.filter(e => e.severity === 5).length;
  const sev4Count = events.filter(e => e.severity === 4).length;
  const totalUp = sectors.reduce((sum, s) => sum + s.upCount, 0);
  const totalDown = sectors.reduce((sum, s) => sum + s.downCount, 0);

  /* ─── Render ────────────────────────────────────────────────────── */

  return (
    <>
      <style>{`
        .intel-row:hover { background: #151515 !important; }
        .panel-scroll { overflow-y: auto; scrollbar-width: thin; scrollbar-color: #333 transparent; }
        .panel-scroll::-webkit-scrollbar { width: 4px; }
        .panel-scroll::-webkit-scrollbar-thumb { background: #333; border-radius: 2px; }
        @media (max-width: 1200px) {
          .intel-3col { grid-template-columns: 1fr 1fr !important; }
        }
        @media (max-width: 800px) {
          .intel-3col { grid-template-columns: 1fr !important; }
          .ticker-strip { display: none !important; }
        }
      `}</style>

      <main style={{ minHeight: "100vh", background: "#0a0a0a", color: "#e5e5e5", fontFamily: MONO, fontSize: 12 }}>
        {/* ─── Ticker Strip ────────────────────────────────────────── */}
        <div className="ticker-strip" style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "4px 16px", borderBottom: "1px solid #222", background: "#0d0d0d",
          fontSize: 10, gap: 12, flexWrap: "wrap",
        }}>
          <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
            {/* Commodities */}
            {commodities.slice(0, 5).map(c => {
              const isSalmon = c.symbol === "SALMON";
              return (
                <span key={c.symbol} style={{ display: "flex", gap: 4, alignItems: "center" }}>
                  <span style={{ color: "#666", fontWeight: 600 }}>{c.name.split(" ")[0].toUpperCase()}</span>
                  {isSalmon ? (
                    <span style={{ color: "#e5e5e5", fontWeight: 600 }}>{"\u20AC"}{c.eurClose ? c.eurClose.toFixed(2) : "\u2013"}</span>
                  ) : (
                    <span style={{ color: "#e5e5e5", fontWeight: 600 }}>{c.currency === "USD" ? "$" : ""}{fmtPrice(c.latest.close)}</span>
                  )}
                  <span style={{ color: (c.dayReturnPct ?? 0) >= 0 ? "#22c55e" : "#ef4444", fontWeight: 600 }}>
                    {fmtPctRaw(c.dayReturnPct, 1)}
                  </span>
                </span>
              );
            })}

            <span style={{ width: 1, height: 12, background: "#333" }} />

            {/* FX */}
            {fxRates.map(fx => (
              <span key={fx.pair} style={{ display: "flex", gap: 4, alignItems: "center" }}>
                <span style={{ color: "#666", fontWeight: 600 }}>{fx.pair}</span>
                <span style={{ color: "#e5e5e5", fontWeight: 600 }}>{fx.latest.spot.toFixed(4)}</span>
                {fx.latest.simpleReturn != null && (
                  <span style={{ color: fx.latest.simpleReturn >= 0 ? "#22c55e" : "#ef4444", fontWeight: 600 }}>
                    {fmtPct(fx.latest.simpleReturn, 1)}
                  </span>
                )}
              </span>
            ))}

            <span style={{ width: 1, height: 12, background: "#333" }} />

            {/* OBX Regime */}
            {obx && (
              <span style={{ display: "flex", gap: 4, alignItems: "center" }}>
                <span style={{ color: "#666", fontWeight: 600 }}>OBX</span>
                <span style={{
                  fontSize: 8, fontWeight: 700, padding: "1px 5px", borderRadius: 2,
                  background: `${obx.index.regimeColor}22`, color: obx.index.regimeColor,
                  border: `1px solid ${obx.index.regimeColor}44`,
                }}>
                  {obx.index.regime.toUpperCase()}
                </span>
                {obx.index.lastClose && (
                  <span style={{ color: "#888" }}>{obx.index.lastClose.toFixed(0)}</span>
                )}
              </span>
            )}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 6, color: "#666" }}>
            <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#22c55e", boxShadow: "0 0 4px #22c55e" }} />
            <span>{lastRefresh.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</span>
          </div>
        </div>

        {/* ─── Filter Bar ──────────────────────────────────────────── */}
        <div style={{
          display: "flex", alignItems: "center", gap: 8, padding: "4px 16px",
          borderBottom: "1px solid #222", background: "#111", flexWrap: "wrap",
        }}>
          <Link href="/" style={{ fontSize: 10, color: "#666", textDecoration: "none" }}>HOME</Link>
          <span style={{ color: "#333" }}>/</span>
          <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.08em", color: "#f97316" }}>INTELLIGENCE TERMINAL</span>

          <span style={{ width: 1, height: 14, background: "#333", margin: "0 4px" }} />

          <span style={{ fontSize: 9, color: "#666", fontWeight: 600 }}>IMPORTANCE:</span>
          {[
            { label: "ALL", value: 1 },
            { label: "3+", value: 3 },
            { label: "4+", value: 4 },
            { label: "5", value: 5 },
          ].map(f => (
            <button
              key={f.value}
              onClick={() => setImportanceMin(f.value)}
              style={{
                padding: "2px 7px", borderRadius: 2, fontSize: 9, fontWeight: 700,
                fontFamily: MONO, cursor: "pointer", letterSpacing: "0.04em",
                border: `1px solid ${importanceMin === f.value ? "#f97316" : "#333"}`,
                background: importanceMin === f.value ? "#f97316" : "transparent",
                color: importanceMin === f.value ? "#000" : "#888",
              }}
            >
              {f.label}
            </button>
          ))}

          <span style={{ width: 1, height: 14, background: "#333", margin: "0 4px" }} />

          <input
            type="text"
            placeholder="TICKER"
            value={tickerFilter}
            onChange={e => setTickerFilter(e.target.value.toUpperCase())}
            style={{
              width: 72, padding: "3px 6px", background: "#1a1a1a", border: "1px solid #333",
              borderRadius: 2, color: "#e5e5e5", fontFamily: MONO, fontSize: 10, outline: "none",
            }}
          />

          <span style={{ flex: 1 }} />

          {/* Summary badges */}
          <span style={{ fontSize: 9, color: "#666" }}>{events.length} events</span>
          {sev5Count > 0 && <span style={{ fontSize: 9, fontWeight: 700, padding: "1px 5px", borderRadius: 2, background: "#ef4444", color: "#fff" }}>{sev5Count} CRITICAL</span>}
          {sev4Count > 0 && <span style={{ fontSize: 9, fontWeight: 700, padding: "1px 5px", borderRadius: 2, background: "#f97316", color: "#fff" }}>{sev4Count} HIGH</span>}
          {totalUp > 0 && <span style={{ fontSize: 9, fontWeight: 700, padding: "1px 5px", borderRadius: 2, background: "#22c55e22", color: "#22c55e", border: "1px solid #22c55e44" }}>{totalUp} UP</span>}
          {totalDown > 0 && <span style={{ fontSize: 9, fontWeight: 700, padding: "1px 5px", borderRadius: 2, background: "#ef444422", color: "#ef4444", border: "1px solid #ef444444" }}>{totalDown} DOWN</span>}
        </div>

        {loading ? (
          <div style={{ padding: 80, textAlign: "center", color: "#666", fontSize: 11 }}>Loading intelligence data...</div>
        ) : (
          /* ─── 3-Column Grid ──────────────────────────────────────── */
          <div className="intel-3col" style={{
            display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr",
            gap: 0, maxWidth: 1800, margin: "0 auto",
          }}>

            {/* ══════════════════════════════════════════════════════════
                COLUMN 1: NEWS FEED
                ══════════════════════════════════════════════════════════ */}
            <div style={{ borderRight: "1px solid #222", display: "flex", flexDirection: "column", maxHeight: "calc(100vh - 80px)" }}>
              <SectionHeader title="NEWS FEED" count={filteredEvents.length} />

              {/* Severity distribution bar */}
              <div style={{ display: "flex", height: 2, background: "#111" }}>
                {[1, 2, 3, 4, 5].map(s => {
                  const count = filteredEvents.filter(e => e.severity === s).length;
                  return <div key={s} style={{ width: `${filteredEvents.length > 0 ? (count / filteredEvents.length) * 100 : 0}%`, background: SEV_C[s] }} />;
                })}
              </div>

              <div className="panel-scroll" style={{ flex: 1, minHeight: 0 }}>
                {filteredEvents.length === 0 ? (
                  <div style={{ padding: 30, textAlign: "center", color: "#555", fontSize: 10 }}>No events match filters</div>
                ) : (
                  filteredEvents.map(ev => {
                    const isExp = expandedId === ev.id;
                    const sevColor = SEV_C[ev.severity] || "#555";
                    const typeColor = TYPE_C[ev.eventType] || TYPE_C.other;
                    const hasSummary = !!(ev.summary && ev.summary !== ev.headline);
                    const hasFacts = !!(ev.structuredFacts && Object.values(ev.structuredFacts).some(v => v !== null));
                    const hasUrl = !!ev.url;
                    const hasExpandable = hasSummary || hasFacts || hasUrl;

                    return (
                      <div key={ev.id}>
                        <div
                          className="intel-row"
                          onClick={() => hasExpandable ? setExpandedId(isExp ? null : ev.id) : undefined}
                          style={{
                            display: "grid", gridTemplateColumns: "36px 3px 1fr 54px",
                            padding: "5px 8px", cursor: hasExpandable ? "pointer" : "default",
                            borderBottom: "1px solid #1a1a1a", alignItems: "start",
                          }}
                        >
                          <span style={{ fontSize: 10, color: "#666", paddingTop: 1 }}>{timeAgo(ev.publishedAt)}</span>
                          <div style={{ width: 3, minHeight: 16, background: sevColor, borderRadius: 1, marginTop: 1 }} />
                          <div style={{ paddingLeft: 6 }}>
                            <div style={{
                              color: ev.severity >= 4 ? "#fff" : "#e5e5e5", fontWeight: 500,
                              lineHeight: 1.35, fontSize: 11,
                            }}>
                              {ev.headline}
                              {hasExpandable && (
                                <span style={{ fontSize: 8, color: "#444", marginLeft: 6 }}>{isExp ? "\u25B4" : "\u25BE"}</span>
                              )}
                            </div>
                            <div style={{ display: "flex", gap: 4, marginTop: 2, flexWrap: "wrap", alignItems: "center" }}>
                              {ev.tickers?.slice(0, 3).map(t => {
                                const dir = DIR_SYM[t.direction] || DIR_SYM.neutral;
                                return (
                                  <Link key={t.ticker} href={`/stocks/${t.ticker}`} onClick={e => e.stopPropagation()}
                                    style={{ fontSize: 9, fontWeight: 700, padding: "0px 3px", borderRadius: 1, background: "#1a1a1a", color: dir.color, textDecoration: "none" }}>
                                    {dir.icon} {t.ticker}
                                  </Link>
                                );
                              })}
                              <span style={{ fontSize: 8, fontWeight: 700, padding: "1px 4px", borderRadius: 1, background: `${typeColor}15`, color: typeColor }}>{ev.eventType.replace(/_/g, " ").toUpperCase()}</span>
                              {ev.dayReturnPct != null && (
                                <span style={{ fontSize: 9, fontWeight: 600, color: ev.dayReturnPct > 0.3 ? "#22c55e" : ev.dayReturnPct < -0.3 ? "#ef4444" : "#555" }}>
                                  {fmtPctRaw(ev.dayReturnPct, 1)}
                                </span>
                              )}
                            </div>
                          </div>
                          <div style={{ textAlign: "right", fontSize: 10, paddingTop: 1, fontWeight: 600, color: ev.sentiment != null ? (ev.sentiment > 0.1 ? "#22c55e" : ev.sentiment < -0.1 ? "#ef4444" : "#555") : "#444" }}>
                            {ev.sentiment != null ? `${ev.sentiment > 0 ? "+" : ""}${ev.sentiment.toFixed(2)}` : ""}
                          </div>
                        </div>

                        {/* Expanded detail */}
                        {isExp && hasExpandable && (
                          <div style={{ padding: "10px 12px 10px 52px", background: "#111", borderBottom: "1px solid #222", fontSize: 11 }}>
                            {hasFacts && ev.structuredFacts && (
                              <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "2px 12px", marginBottom: 8, padding: "6px 10px", background: "#1a1a1a", borderRadius: 2, border: "1px solid #222", fontSize: 10 }}>
                                {ev.structuredFacts.person_name && (<><span style={{ color: "#666" }}>Person</span><span>{String(ev.structuredFacts.person_name)}{ev.structuredFacts.person_role ? ` (${ev.structuredFacts.person_role})` : ""}</span></>)}
                                {ev.structuredFacts.transaction_type && (<><span style={{ color: "#666" }}>Type</span><span style={{ fontWeight: 700, color: String(ev.structuredFacts.transaction_type).toLowerCase() === "buy" ? "#22c55e" : "#ef4444" }}>{String(ev.structuredFacts.transaction_type).toUpperCase()}</span></>)}
                                {ev.structuredFacts.shares && (<><span style={{ color: "#666" }}>Shares</span><span>{fmtNum(Number(ev.structuredFacts.shares), true)}</span></>)}
                                {ev.structuredFacts.price_per_share && (<><span style={{ color: "#666" }}>Price</span><span>NOK {Number(ev.structuredFacts.price_per_share).toFixed(2)}</span></>)}
                                {ev.structuredFacts.total_value && (<><span style={{ color: "#666" }}>Value</span><span>NOK {fmtNum(Number(ev.structuredFacts.total_value), true)}</span></>)}
                              </div>
                            )}
                            {hasSummary && <p style={{ color: "#bbb", margin: "0 0 8px", lineHeight: 1.5 }}>{ev.summary}</p>}
                            <div style={{ display: "flex", gap: 16, fontSize: 10, color: "#555", flexWrap: "wrap" }}>
                              {ev.tickers?.length > 0 && <span>Tickers: {ev.tickers.map(t => t.ticker).join(", ")}</span>}
                              {ev.sectors?.length > 0 && <span>Sectors: {ev.sectors.map(s => s.sector).join(", ")}</span>}
                              {hasUrl && <a href={ev.url!} target="_blank" rel="noopener noreferrer" style={{ color: "#3b82f6", textDecoration: "none" }} onClick={e => e.stopPropagation()}>Source {"\u2197"}</a>}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* ══════════════════════════════════════════════════════════
                COLUMN 2: SIGNALS, MOVERS, INSIDERS, SEAFOOD
                ══════════════════════════════════════════════════════════ */}
            <div style={{ borderRight: "1px solid #222", display: "flex", flexDirection: "column", maxHeight: "calc(100vh - 80px)" }}>
              <div className="panel-scroll" style={{ flex: 1, minHeight: 0 }}>

                {/* ── SECTOR HEATMAP ─────────────────────────────── */}
                <SectionHeader title="SECTOR PERFORMANCE" count={filteredSectors.reduce((s, sec) => s + sec.stockCount, 0)} />
                {sectorTradeDate && (
                  <div style={{ fontSize: 8, color: "#555", padding: "2px 10px", background: "#0d0d0d" }}>
                    as of {new Date(sectorTradeDate).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                  </div>
                )}
                {filteredSectors.length === 0 ? (
                  <div style={{ padding: 16, textAlign: "center", color: "#555", fontSize: 10 }}>No sector data</div>
                ) : (
                  filteredSectors.map(sec => {
                    const avg = sec.avgReturn;
                    const barColor = avg > 1 ? "#22c55e" : avg > 0 ? "#4ade80" : avg > -1 ? "#f97316" : "#ef4444";
                    const bgColor = avg > 0 ? `rgba(34,197,94,${Math.min(Math.abs(avg) * 0.04, 0.15)})` : `rgba(239,68,68,${Math.min(Math.abs(avg) * 0.04, 0.15)})`;
                    const expanded = expandedSector === sec.sector;
                    return (
                      <div key={sec.sector}>
                        <div
                          className="intel-row"
                          onClick={() => setExpandedSector(expanded ? null : sec.sector)}
                          style={{
                            display: "grid", gridTemplateColumns: "1fr 50px 50px 56px",
                            padding: "5px 10px", borderBottom: "1px solid #1a1a1a",
                            cursor: "pointer", background: bgColor, alignItems: "center",
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <span style={{ fontSize: 10, fontWeight: 700, color: "#e5e5e5" }}>{sec.sector}</span>
                            <span style={{ fontSize: 8, color: "#555" }}>{sec.stockCount}</span>
                          </div>
                          <div style={{ fontSize: 8, color: "#888", textAlign: "center" }}>
                            <span style={{ color: "#4ade80" }}>{sec.upCount}</span>
                            <span style={{ color: "#555" }}>/</span>
                            <span style={{ color: "#f97316" }}>{sec.downCount}</span>
                          </div>
                          <div style={{ fontSize: 8, color: "#666", textAlign: "center" }}>
                            {sec.bestTicker && <span style={{ color: "#4ade80" }}>{sec.bestTicker}</span>}
                          </div>
                          <span style={{ textAlign: "right", fontSize: 11, fontWeight: 700, color: barColor }}>
                            {avg >= 0 ? "+" : ""}{avg.toFixed(2)}%
                          </span>
                        </div>
                        {expanded && sec.stocks.map((st: SectorData["stocks"][number]) => (
                          <Link key={st.ticker} href={`/stocks/${st.ticker}`} className="intel-row" style={{
                            display: "grid", gridTemplateColumns: "60px 1fr 56px",
                            padding: "3px 10px 3px 20px", textDecoration: "none", color: "inherit",
                            borderBottom: "1px solid #111", background: "#0a0a0a",
                          }}>
                            <span style={{ fontSize: 9, fontWeight: 600, color: "#ccc" }}>{st.ticker}</span>
                            <span style={{ fontSize: 9, color: "#555", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{st.name}</span>
                            <span style={{ textAlign: "right", fontSize: 10, fontWeight: 700, color: st.returnPct > 0 ? "#4ade80" : st.returnPct < 0 ? "#f97316" : "#666" }}>
                              {st.returnPct >= 0 ? "+" : ""}{st.returnPct.toFixed(2)}%
                            </span>
                          </Link>
                        ))}
                      </div>
                    );
                  })
                )}

                {/* ── TOP MOVERS ──────────────────────────────────── */}
                <SectionHeader title="TOP MOVERS" count={movers.gainers.length + movers.losers.length} />
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr" }}>
                  {/* Gainers */}
                  <div style={{ borderRight: "1px solid #1a1a1a" }}>
                    <div style={{ fontSize: 8, fontWeight: 700, color: "#22c55e", padding: "3px 10px", background: "#22c55e08", letterSpacing: "0.06em" }}>GAINERS</div>
                    {movers.gainers.slice(0, 8).map(m => (
                      <Link key={m.ticker} href={`/stocks/${m.ticker}`} className="intel-row" style={{
                        display: "flex", justifyContent: "space-between", padding: "3px 10px",
                        textDecoration: "none", color: "inherit", borderBottom: "1px solid #111",
                      }}>
                        <span style={{ fontSize: 10, fontWeight: 700, color: "#e5e5e5" }}>{m.ticker}</span>
                        <span style={{ fontSize: 10, fontWeight: 700, color: "#22c55e" }}>{fmtPctRaw(m.returnPct * 100, 1)}</span>
                      </Link>
                    ))}
                  </div>
                  {/* Losers */}
                  <div>
                    <div style={{ fontSize: 8, fontWeight: 700, color: "#ef4444", padding: "3px 10px", background: "#ef444408", letterSpacing: "0.06em" }}>LOSERS</div>
                    {movers.losers.slice(0, 8).map(m => (
                      <Link key={m.ticker} href={`/stocks/${m.ticker}`} className="intel-row" style={{
                        display: "flex", justifyContent: "space-between", padding: "3px 10px",
                        textDecoration: "none", color: "inherit", borderBottom: "1px solid #111",
                      }}>
                        <span style={{ fontSize: 10, fontWeight: 700, color: "#e5e5e5" }}>{m.ticker}</span>
                        <span style={{ fontSize: 10, fontWeight: 700, color: "#ef4444" }}>{fmtPctRaw(m.returnPct * 100, 1)}</span>
                      </Link>
                    ))}
                  </div>
                </div>

                {/* ── FX RATES ────────────────────────────────────── */}
                <SectionHeader title="FX RATES" />
                {fxRates.length === 0 ? (
                  <div style={{ padding: 16, textAlign: "center", color: "#555", fontSize: 10 }}>No FX data</div>
                ) : (
                  fxRates.map(fx => {
                    const spotData = fx.timeSeries?.spot?.map(s => s.value) || [];
                    const sparkColor = spotData.length > 1 ? (spotData[spotData.length - 1] >= spotData[0] ? "#22c55e" : "#ef4444") : "#555";
                    const retColor = (fx.latest.simpleReturn ?? 0) >= 0 ? "#22c55e" : "#ef4444";

                    return (
                      <div key={fx.pair} style={{ display: "grid", gridTemplateColumns: "68px 1fr auto auto", padding: "5px 10px", borderBottom: "1px solid #1a1a1a", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: 10, fontWeight: 700, color: "#e5e5e5" }}>{fx.pair}</span>
                        <span style={{ fontSize: 11, fontWeight: 700, color: "#e5e5e5" }}>{fx.latest.spot.toFixed(4)}</span>
                        <span style={{ fontSize: 10, fontWeight: 600, color: retColor }}>
                          {fx.latest.simpleReturn != null ? fmtPct(fx.latest.simpleReturn, 2) : "\u2014"}
                        </span>
                        <div dangerouslySetInnerHTML={{ __html: sparklineSvg(spotData.slice(-30), 48, 16, sparkColor) }} />
                      </div>
                    );
                  })
                )}

                {/* ── INSIDER TRADES ──────────────────────────────── */}
                <SectionHeader title="INSIDER TRADES" count={filteredInsiders.length} />
                {filteredInsiders.length === 0 ? (
                  <div style={{ padding: 16, textAlign: "center", color: "#555", fontSize: 10 }}>No insider trades found</div>
                ) : (
                  filteredInsiders.slice(0, 15).map(trade => {
                    // Infer BUY/SELL from headline if structured data is missing
                    const hl = trade.headline.toLowerCase();
                    const inferredType = trade.transactionType
                      || (hl.includes("buy-back") || hl.includes("buyback") || hl.includes("tilbakekjøp") ? "BUYBACK"
                        : hl.includes("purchase") || hl.includes("kjøp") ? "BUY"
                        : hl.includes("sale") || hl.includes("salg") || hl.includes("sell") ? "SELL"
                        : null);
                    const isBuy = inferredType === "BUY" || inferredType === "BUYBACK";
                    const isSell = inferredType === "SELL";
                    const badgeColor = isBuy ? "#22c55e" : isSell ? "#ef4444" : "#ec4899";
                    const badgeLabel = inferredType || "INSIDER";
                    // Clean headline: strip company name prefix for brevity
                    const cleanHeadline = trade.headline
                      .replace(/^(Press Release:\s*)?/i, "")
                      .replace(new RegExp(`^${trade.stockName || trade.ticker}[:\\s–—-]+`, "i"), "")
                      .slice(0, 90);
                    return (
                      <div key={trade.id} className="intel-row" style={{
                        padding: "5px 10px", borderBottom: "1px solid #1a1a1a",
                      }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 2 }}>
                          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                            {trade.ticker && (
                              <Link href={`/stocks/${trade.ticker}`} style={{ fontSize: 10, fontWeight: 700, color: "#e5e5e5", textDecoration: "none" }}>{trade.ticker}</Link>
                            )}
                            <span style={{
                              fontSize: 7, fontWeight: 700, padding: "1px 4px", borderRadius: 2,
                              background: `${badgeColor}22`, color: badgeColor, border: `1px solid ${badgeColor}44`,
                              letterSpacing: "0.04em",
                            }}>
                              {badgeLabel}
                            </span>
                            {trade.personName && (
                              <span style={{ fontSize: 9, color: "#aaa" }}>
                                {trade.personName}{trade.personRole ? ` (${trade.personRole})` : ""}
                              </span>
                            )}
                          </div>
                          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                            {trade.totalValue != null && (
                              <span style={{ fontSize: 10, fontWeight: 600, color: isBuy ? "#4ade80" : isSell ? "#f97316" : "#ccc" }}>
                                NOK {fmtNum(trade.totalValue, true)}
                              </span>
                            )}
                            <span style={{ fontSize: 9, color: "#555" }}>{timeAgo(trade.publishedAt)}</span>
                          </div>
                        </div>
                        {/* Headline as context */}
                        <div style={{ fontSize: 9, color: "#777", lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {trade.url ? (
                            <a href={trade.url} target="_blank" rel="noopener noreferrer" style={{ color: "#777", textDecoration: "none" }}>{cleanHeadline}</a>
                          ) : cleanHeadline}
                        </div>
                      </div>
                    );
                  })
                )}

                {/* ── SEAFOOD PULSE ────────────────────────────────── */}
                <SectionHeader title="SEAFOOD PULSE" color="#06b6d4" />
                {seafood ? (
                  <div style={{ padding: "6px 10px" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 8 }}>
                      {/* Salmon price */}
                      <div style={{ background: "#111", borderRadius: 2, padding: "6px 8px", border: "1px solid #1a1a1a" }}>
                        <div style={{ fontSize: 8, color: "#666", fontWeight: 600, letterSpacing: "0.06em" }}>SALMON</div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: "#e5e5e5" }}>
                          {seafood.salmonPrice ? `${seafood.salmonPrice.price.toFixed(2)}` : "\u2014"}
                        </div>
                        {seafood.salmonPrice?.changePct != null && (
                          <div style={{ fontSize: 9, fontWeight: 600, color: seafood.salmonPrice.changePct >= 0 ? "#22c55e" : "#ef4444" }}>
                            {fmtPctRaw(seafood.salmonPrice.changePct, 1)}
                          </div>
                        )}
                      </div>
                      {/* Lice */}
                      <div style={{ background: "#111", borderRadius: 2, padding: "6px 8px", border: "1px solid #1a1a1a" }}>
                        <div style={{ fontSize: 8, color: "#666", fontWeight: 600, letterSpacing: "0.06em" }}>AVG LICE</div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: seafood.industryAvgLice != null ? (seafood.industryAvgLice < 0.2 ? "#22c55e" : seafood.industryAvgLice < 0.5 ? "#f59e0b" : "#ef4444") : "#888" }}>
                          {seafood.industryAvgLice?.toFixed(3) ?? "\u2014"}
                        </div>
                        <div style={{ fontSize: 9, color: "#666" }}>limit: {seafood.liceThreshold}</div>
                      </div>
                      {/* Traffic lights */}
                      <div style={{ background: "#111", borderRadius: 2, padding: "6px 8px", border: "1px solid #1a1a1a" }}>
                        <div style={{ fontSize: 8, color: "#666", fontWeight: 600, letterSpacing: "0.06em" }}>TRAFFIC</div>
                        <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                          {(["green", "yellow", "red"] as const).map(c => (
                            <span key={c} style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 11, fontWeight: 700 }}>
                              <span style={{ width: 8, height: 8, borderRadius: "50%", background: TRAFFIC_C[c] }} />
                              <span style={{ color: "#e5e5e5" }}>{seafood.trafficLights[c]}</span>
                            </span>
                          ))}
                        </div>
                        <div style={{ fontSize: 9, color: "#666" }}>{seafood.activeDiseases} diseases</div>
                      </div>
                    </div>
                    {/* Sparkline */}
                    {seafood.sparkline.length > 1 && (
                      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "2px 0" }}>
                        <span style={{ fontSize: 8, color: "#555" }}>90D</span>
                        <div dangerouslySetInnerHTML={{ __html: sparklineSvg(seafood.sparkline.map(s => s.price), 200, 20, "#06b6d4") }} />
                      </div>
                    )}
                    <Link href="/seafood" style={{ fontSize: 9, color: "#06b6d4", textDecoration: "none" }}>
                      Full seafood dashboard {"\u2192"}
                    </Link>
                  </div>
                ) : (
                  <div style={{ padding: 16, textAlign: "center", color: "#555", fontSize: 10 }}>No seafood data</div>
                )}
              </div>
            </div>

            {/* ══════════════════════════════════════════════════════════
                COLUMN 3: COMMODITIES, SHORTS
                ══════════════════════════════════════════════════════════ */}
            <div style={{ display: "flex", flexDirection: "column", maxHeight: "calc(100vh - 80px)" }}>
              <div className="panel-scroll" style={{ flex: 1, minHeight: 0 }}>

                {/* ── COMMODITIES ─────────────────────────────────── */}
                <SectionHeader title="COMMODITIES" count={filteredCommodities.length} />
                {filteredCommodities.map(c => {
                  const retColor = (c.dayReturnPct ?? 0) >= 0 ? "#22c55e" : "#ef4444";
                  const histData = c.history?.map(h => h.close) || [];
                  const sparkColor = histData.length > 1 ? (histData[histData.length - 1] >= histData[0] ? "#22c55e" : "#ef4444") : "#555";
                  const isSalmon = c.symbol === "SALMON";

                  return (
                    <div key={c.symbol} style={{ borderBottom: "1px solid #1a1a1a" }}>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto", padding: "5px 10px 2px", alignItems: "center", gap: 8 }}>
                        <div>
                          <div style={{ fontSize: 10, fontWeight: 700, color: "#e5e5e5" }}>{c.name}</div>
                          <div style={{ fontSize: 8, color: "#555" }}>{isSalmon ? "NOK/kg" : c.symbol}</div>
                        </div>
                        <div style={{ textAlign: "right" }}>
                          {isSalmon ? (
                            <>
                              <div style={{ fontSize: 11, fontWeight: 700, color: "#e5e5e5" }}>{"\u20AC"}{c.eurClose?.toFixed(2) ?? "\u2013"} <span style={{ color: "#888", fontSize: 9 }}>NOK{fmtPrice(c.latest.close)}</span></div>
                              <div style={{ fontSize: 10, fontWeight: 600, color: retColor }}>{fmtPctRaw(c.dayReturnPct, 1)}</div>
                            </>
                          ) : (
                            <>
                              <div style={{ fontSize: 11, fontWeight: 700, color: "#e5e5e5" }}>{c.currency === "USD" ? "$" : ""}{fmtPrice(c.latest.close)}</div>
                              <div style={{ fontSize: 10, fontWeight: 600, color: retColor }}>{fmtPctRaw(c.dayReturnPct, 1)}</div>
                            </>
                          )}
                        </div>
                        <div dangerouslySetInnerHTML={{ __html: sparklineSvg(histData.slice(-30), 48, 18, sparkColor) }} />
                      </div>
                      {c.sensitivities.length > 0 && (
                        <div style={{ padding: "1px 10px 5px", display: "flex", gap: 4, flexWrap: "wrap" }}>
                          {c.sensitivities.slice(0, 4).map(s => (
                            <Link key={s.ticker} href={`/stocks/${s.ticker}`} style={{
                              fontSize: 9, padding: "1px 5px", borderRadius: 2, background: "transparent",
                              border: `1px solid ${s.beta > 0 ? "#22c55e33" : "#ef444433"}`,
                              color: "#999", textDecoration: "none", fontWeight: 500,
                              display: "inline-flex", gap: 3, alignItems: "center",
                            }}>
                              <span style={{ color: "#ccc", fontWeight: 700 }}>{s.ticker}</span>
                              <span style={{ color: s.beta > 0 ? "#22c55e" : "#ef4444" }}>{s.beta > 0 ? "+" : ""}{s.beta.toFixed(2)}</span>
                            </Link>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* ── SHORT INTEREST ──────────────────────────────── */}
                <SectionHeader title="SHORT INTEREST" count={filteredShorts.length} />
                {filteredShorts.length === 0 ? (
                  <div style={{ padding: 16, textAlign: "center", color: "#555", fontSize: 10 }}>No short data</div>
                ) : (
                  filteredShorts.slice(0, 15).map(s => {
                    const changeColor = s.changePct == null ? "#555" : s.changePct > 0.2 ? "#ef4444" : s.changePct < -0.2 ? "#22c55e" : "#555";
                    const siColor = s.shortPct >= 5 ? "#ef4444" : s.shortPct >= 3 ? "#f97316" : s.shortPct >= 1 ? "#f59e0b" : "#888";
                    const histData = s.history?.map(h => h.short_pct) || [];
                    const sparkColor = histData.length > 1 ? (histData[histData.length - 1] > histData[0] ? "#ef4444" : "#22c55e") : "#555";
                    const expanded = expandedShort === s.ticker;
                    const hi90 = histData.length > 0 ? Math.max(...histData) : s.shortPct;
                    const lo90 = histData.length > 0 ? Math.min(...histData) : s.shortPct;
                    const daysOnList = histData.length;
                    const topHolder = s.holders?.[0];
                    // Squeeze pressure: high SI + rising + multiple holders
                    const isRising = s.changePct != null && s.changePct > 0.1;
                    const squeezeScore = (s.shortPct >= 3 ? 1 : 0) + (isRising ? 1 : 0) + (s.activePositions >= 3 ? 1 : 0);
                    const squeezeLabel = squeezeScore >= 3 ? "HOT" : squeezeScore >= 2 ? "WARM" : null;
                    const squeezeColor = squeezeScore >= 3 ? "#ef4444" : "#f97316";
                    // SI bar width (max at 10%)
                    const barWidth = Math.min(s.shortPct / 10 * 100, 100);

                    return (
                      <div key={s.ticker} style={{ borderBottom: "1px solid #111" }}>
                        <div
                          onClick={() => setExpandedShort(expanded ? null : s.ticker)}
                          className="intel-row"
                          style={{ padding: "6px 10px", cursor: "pointer" }}
                        >
                          {/* Row 1: Ticker, SI bar, change, sparkline */}
                          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                            <span style={{ fontSize: 10, fontWeight: 700, color: "#e5e5e5", minWidth: 48 }}>{s.ticker}</span>
                            <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 4 }}>
                              <div style={{ position: "relative", height: 10, flex: 1, background: "#1a1a1a", borderRadius: 2, overflow: "hidden" }}>
                                <div style={{ height: "100%", width: `${barWidth}%`, background: siColor, borderRadius: 2, opacity: 0.7 }} />
                              </div>
                              <span style={{ fontSize: 10, fontWeight: 700, color: siColor, minWidth: 40, textAlign: "right" }}>{s.shortPct.toFixed(1)}%</span>
                            </div>
                            <span style={{ fontSize: 9, fontWeight: 600, color: changeColor, minWidth: 32, textAlign: "right" }}>
                              {s.changePct != null ? fmtPctRaw(s.changePct, 1) : "\u2014"}
                            </span>
                            {squeezeLabel && (
                              <span style={{ fontSize: 7, fontWeight: 800, color: "#000", background: squeezeColor, padding: "1px 4px", borderRadius: 2, letterSpacing: "0.05em" }}>
                                {squeezeLabel}
                              </span>
                            )}
                          </div>
                          {/* Row 2: Name, holders count, days, sparkline */}
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <span style={{ fontSize: 8, color: "#666", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {s.stockName || s.ticker}
                            </span>
                            <span style={{ fontSize: 8, color: "#555" }} title="Active short holders">
                              {s.activePositions || s.holders?.length || 0} holders
                            </span>
                            <span style={{ fontSize: 8, color: "#444" }}>{daysOnList}d</span>
                            <div dangerouslySetInnerHTML={{ __html: sparklineSvg(histData, 48, 12, sparkColor) }} />
                          </div>
                        </div>
                        {/* Expanded: holder breakdown + 90d range */}
                        {expanded && (
                          <div style={{ padding: "4px 10px 8px", background: "#0d0d0d", borderTop: "1px solid #1a1a1a" }}>
                            {/* 90-day range bar */}
                            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                              <span style={{ fontSize: 8, color: "#555", minWidth: 42 }}>90D range</span>
                              <span style={{ fontSize: 8, color: "#666" }}>{lo90.toFixed(1)}%</span>
                              <div style={{ flex: 1, position: "relative", height: 6, background: "#1a1a1a", borderRadius: 3 }}>
                                {hi90 > lo90 && (
                                  <div style={{
                                    position: "absolute",
                                    left: `${((s.shortPct - lo90) / (hi90 - lo90)) * 100}%`,
                                    top: -1, width: 8, height: 8,
                                    background: siColor, borderRadius: "50%",
                                    transform: "translateX(-50%)",
                                  }} />
                                )}
                              </div>
                              <span style={{ fontSize: 8, color: "#666" }}>{hi90.toFixed(1)}%</span>
                            </div>
                            {/* Holders list */}
                            {s.holders && s.holders.length > 0 ? (
                              <div>
                                <div style={{ fontSize: 8, fontWeight: 700, color: "#555", marginBottom: 3, letterSpacing: "0.05em" }}>TOP SHORTERS</div>
                                {s.holders.slice(0, 5).map((h, i) => (
                                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, padding: "2px 0" }}>
                                    <span style={{ fontSize: 8, color: "#888", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                      {h.holder}
                                    </span>
                                    <div style={{ position: "relative", height: 4, width: 50, background: "#1a1a1a", borderRadius: 2, overflow: "hidden" }}>
                                      <div style={{ height: "100%", width: `${Math.min(h.pct / s.shortPct * 100, 100)}%`, background: "#ef4444", borderRadius: 2, opacity: 0.6 }} />
                                    </div>
                                    <span style={{ fontSize: 8, fontWeight: 600, color: "#aaa", minWidth: 36, textAlign: "right" }}>{h.pct.toFixed(2)}%</span>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div style={{ fontSize: 8, color: "#444" }}>No holder breakdown available</div>
                            )}
                            {/* Link to stock page */}
                            <Link href={`/stocks/${s.ticker}`} style={{ display: "block", marginTop: 6, fontSize: 8, color: "#3b82f6", textDecoration: "none" }}>
                              View {s.ticker} details →
                            </Link>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}


              </div>
            </div>
          </div>
        )}
      </main>
    </>
  );
}
