"use client";

import Link from "next/link";
import { useEffect, useState, useCallback, useRef } from "react";

/* ─── Types ────────────────────────────────────────────────────── */

type TickerRef = {
  ticker: string;
  relevance: number | null;
  direction: string;
};

type SectorRef = {
  sector: string;
  impact: number | null;
};

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
  latest: {
    date: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number | null;
  };
  dayReturnPct: number | null;
  eurClose?: number;
  nokPerEur?: number;
  history: { date: string; close: number }[];
  sensitivities: {
    ticker: string;
    stockName: string | null;
    sector: string | null;
    beta: number;
    correlation60d: number | null;
    correlation252d: number | null;
    rSquared: number | null;
  }[];
};

/* ─── Constants ────────────────────────────────────────────────── */

const SEV_C: Record<number, string> = {
  1: "#555", 2: "#3b82f6", 3: "#f59e0b", 4: "#f97316", 5: "#ef4444",
};

const TYPE_C: Record<string, string> = {
  earnings: "#22c55e", guidance: "#3b82f6", analyst_action: "#a855f7",
  corporate_action: "#f59e0b", insider_trade: "#ec4899", regulatory: "#06b6d4",
  macro: "#6366f1", geopolitical: "#ef4444", sector_news: "#14b8a6", other: "#555",
};

const EVENT_TYPES = [
  "earnings", "guidance", "analyst_action", "corporate_action",
  "insider_trade", "regulatory", "macro", "geopolitical", "sector_news", "other",
];

const DIR_SYM: Record<string, { icon: string; color: string }> = {
  positive: { icon: "\u25B2", color: "#22c55e" },
  negative: { icon: "\u25BC", color: "#ef4444" },
  neutral: { icon: "\u2500", color: "#555" },
};

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
  return `${v >= 0 ? "+" : ""}${v.toFixed(d)}%`;
}

function fmtNum(v: number | null, compact = false): string {
  if (v == null) return "\u2014";
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

/* ─── Page Component ───────────────────────────────────────────── */

export default function IntelligencePage() {
  const [events, setEvents] = useState<NewsEvent[]>([]);
  const [shorts, setShorts] = useState<ShortPosition[]>([]);
  const [commodities, setCommodities] = useState<CommodityData[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  // Filters
  const [tickerFilter, setTickerFilter] = useState("");
  const [severityMin, setSeverityMin] = useState(1);
  const [eventTypeFilter, setEventTypeFilter] = useState("");
  const [sortBy, setSortBy] = useState<"time" | "severity" | "sentiment">("time");
  const [hideOther, setHideOther] = useState(true);

  // Auto-refresh
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());


  const fetchAll = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (tickerFilter) params.set("ticker", tickerFilter);
      if (severityMin > 1) params.set("severity_min", String(severityMin));
      if (eventTypeFilter) params.set("event_type", eventTypeFilter);
      params.set("limit", "200");

      const [newsRes, shortsRes, commoditiesRes] = await Promise.all([
        fetch(`/api/news?${params}`),
        fetch("/api/shorts"),
        fetch("/api/commodities?days=90"),
      ]);

      if (newsRes.ok) {
        const data = await newsRes.json();
        // Deduplicate by normalized headline
        const seen = new Map<string, NewsEvent>();
        for (const ev of (data.events || []) as NewsEvent[]) {
          const key = ev.headline.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
          const existing = seen.get(key);
          if (!existing || ev.severity > existing.severity) seen.set(key, ev);
        }
        setEvents(
          Array.from(seen.values()).sort(
            (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
          )
        );
      }

      if (shortsRes.ok) {
        const data = await shortsRes.json();
        setShorts(data.positions || []);
      }

      if (commoditiesRes.ok) {
        const data = await commoditiesRes.json();
        setCommodities(data.commodities || []);
      }

      setLastRefresh(new Date());
    } catch (err) {
      console.error("[IntelligencePage]", err);
    } finally {
      setLoading(false);
    }
  }, [tickerFilter, severityMin, eventTypeFilter]);

  useEffect(() => {
    setLoading(true);
    fetchAll();
  }, [fetchAll]);

  useEffect(() => {
    timerRef.current = setInterval(fetchAll, 60000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [fetchAll]);

  // Filter + sort events
  const filteredEvents = hideOther && !eventTypeFilter
    ? events.filter(e => e.eventType !== "other")
    : events;
  const sortedEvents = [...filteredEvents].sort((a, b) => {
    if (sortBy === "severity") return b.severity - a.severity;
    if (sortBy === "sentiment") return Math.abs(b.sentiment ?? 0) - Math.abs(a.sentiment ?? 0);
    return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
  });

  // Stats (based on visible events)
  const sev4Count = filteredEvents.filter(e => e.severity === 4).length;
  const sev5Count = filteredEvents.filter(e => e.severity === 5).length;
  const sev3Count = filteredEvents.filter(e => e.severity === 3).length;
  const topShorted = shorts.length > 0 ? shorts[0] : null;
  const shortMovers = shorts.filter(s => s.changePct != null && Math.abs(s.changePct) > 0.2);

  // Severity distribution
  const sevDist = [1, 2, 3, 4, 5].map(s => ({
    level: s, count: filteredEvents.filter(e => e.severity === s).length,
  }));

  /* ─── Inline styles ──────────────────────────────────────────── */

  const S = {
    page: {
      minHeight: "100vh",
      background: "#0a0a0a",
      color: "#e5e5e5",
      fontFamily: "'Geist Mono', 'SF Mono', 'Consolas', monospace",
      fontSize: 12,
    } as React.CSSProperties,
    container: {
      maxWidth: 1600,
      margin: "0 auto",
      padding: "0 12px",
    } as React.CSSProperties,
    header: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "8px 0",
      borderBottom: "1px solid #222",
    } as React.CSSProperties,
    headerLeft: {
      display: "flex",
      alignItems: "center",
      gap: 12,
    } as React.CSSProperties,
    title: {
      fontSize: 13,
      fontWeight: 700,
      letterSpacing: "0.08em",
      color: "#f97316",
    } as React.CSSProperties,
    badge: (bg: string) => ({
      fontSize: 9,
      fontWeight: 700,
      padding: "1px 5px",
      borderRadius: 2,
      background: bg,
      color: "#fff",
      letterSpacing: "0.04em",
    }) as React.CSSProperties,
    statCell: {
      display: "flex",
      flexDirection: "column" as const,
      alignItems: "flex-end",
      fontSize: 10,
      lineHeight: 1.3,
    } as React.CSSProperties,
    // Three-column grid
    grid: {
      display: "grid",
      gridTemplateColumns: "1fr 320px",
      gap: 0,
      marginTop: 1,
    } as React.CSSProperties,
    filterBar: {
      display: "flex",
      flexWrap: "wrap" as const,
      gap: 6,
      padding: "6px 8px",
      background: "#111",
      borderBottom: "1px solid #222",
      alignItems: "center",
    } as React.CSSProperties,
    filterInput: {
      width: 72,
      padding: "3px 6px",
      background: "#1a1a1a",
      border: "1px solid #333",
      borderRadius: 2,
      color: "#e5e5e5",
      fontFamily: "inherit",
      fontSize: 10,
      outline: "none",
    } as React.CSSProperties,
    filterBtn: (active: boolean) => ({
      padding: "2px 7px",
      borderRadius: 2,
      border: `1px solid ${active ? "#f97316" : "#333"}`,
      background: active ? "#f97316" : "transparent",
      color: active ? "#000" : "#888",
      fontFamily: "inherit",
      fontSize: 9,
      fontWeight: 700,
      cursor: "pointer",
      letterSpacing: "0.04em",
      transition: "all 0.1s",
    }) as React.CSSProperties,
    tableHeader: {
      display: "grid",
      gridTemplateColumns: "44px 3px 1fr 72px 54px 54px",
      padding: "4px 8px",
      fontSize: 9,
      fontWeight: 700,
      color: "#666",
      textTransform: "uppercase" as const,
      letterSpacing: "0.06em",
      background: "#111",
      borderBottom: "1px solid #222",
    } as React.CSSProperties,
    row: {
      display: "grid",
      gridTemplateColumns: "44px 3px 1fr 72px 54px 54px",
      padding: "5px 8px",
      cursor: "pointer",
      borderBottom: "1px solid #1a1a1a",
      alignItems: "start",
      transition: "background 0.08s",
    } as React.CSSProperties,
    rightPanel: {
      borderLeft: "1px solid #222",
      background: "#0d0d0d",
      overflow: "auto" as const,
      maxHeight: "calc(100vh - 90px)",
    } as React.CSSProperties,
    sectionTitle: {
      fontSize: 9,
      fontWeight: 700,
      color: "#666",
      letterSpacing: "0.08em",
      textTransform: "uppercase" as const,
      padding: "8px 10px 4px",
      borderBottom: "1px solid #1a1a1a",
    } as React.CSSProperties,
  };

  /* ─── Render ─────────────────────────────────────────────────── */

  return (
    <>
      <style>{`
        .intel-row:hover { background: #151515 !important; }
        .short-row:hover { background: #151515 !important; }
        @media (max-width: 1000px) {
          .intel-grid { grid-template-columns: 1fr !important; }
          .intel-right { display: none !important; }
        }
      `}</style>

      <main style={S.page}>
        <div style={S.container}>
          {/* ─── Top Bar ──────────────────────────────────────── */}
          <div style={S.header}>
            <div style={S.headerLeft}>
              <Link href="/" style={{ fontSize: 10, color: "#666", textDecoration: "none" }}>
                HOME
              </Link>
              <span style={{ color: "#333" }}>/</span>
              <span style={S.title}>INTELLIGENCE TERMINAL</span>
              <span style={{ ...S.badge("#1a1a1a"), color: "#888", border: "1px solid #333" }}>
                {filteredEvents.length} EVENTS
              </span>
              {sev5Count > 0 && (
                <span style={S.badge("#ef4444")}>
                  {sev5Count} CRITICAL
                </span>
              )}
              {sev4Count > 0 && (
                <span style={S.badge("#f97316")}>
                  {sev4Count} HIGH
                </span>
              )}
              {sev3Count > 0 && (
                <span style={{ ...S.badge("#1a1a1a"), color: "#f59e0b", border: "1px solid #f59e0b44" }}>
                  {sev3Count} ELEVATED
                </span>
              )}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              {/* Commodity ticker strip */}
              <div style={{ display: "flex", gap: 12, fontSize: 10 }}>
                {commodities.slice(0, 5).map(c => {
                  const isSalmon = c.symbol === "SALMON";
                  const currSym = c.currency === "USD" ? "$" : c.currency === "NOK" ? "" : "";
                  return (
                    <span key={c.symbol} style={{ display: "flex", gap: 4, alignItems: "center" }}>
                      <span style={{ color: "#888" }}>{c.name.split(" ")[0].toUpperCase()}</span>
                      {isSalmon ? (
                        <>
                          <span style={{ color: "#e5e5e5", fontWeight: 600 }}>
                            {"\u20AC"}{c.eurClose ? c.eurClose.toFixed(2) : "–"}
                          </span>
                          <span style={{ color: "#999", fontWeight: 500 }}>
                            NOK{fmtPrice(c.latest.close)}
                          </span>
                        </>
                      ) : (
                        <span style={{ color: "#e5e5e5", fontWeight: 600 }}>
                          {currSym}{fmtPrice(c.latest.close)}
                        </span>
                      )}
                      <span style={{
                        color: (c.dayReturnPct ?? 0) >= 0 ? "#22c55e" : "#ef4444",
                        fontWeight: 600,
                      }}>
                        {fmtPct(c.dayReturnPct, 1)}
                      </span>
                    </span>
                  );
                })}
              </div>
              <span style={{ width: 1, height: 12, background: "#333" }} />
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10, color: "#666" }}>
                <span style={{
                  width: 5, height: 5, borderRadius: "50%", background: "#22c55e",
                  boxShadow: "0 0 4px #22c55e",
                }} />
                <span>
                  {lastRefresh.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
            </div>
          </div>

          {/* ─── Main Grid ────────────────────────────────────── */}
          <div className="intel-grid" style={S.grid}>
            {/* ─── Left: News Feed ────────────────────────────── */}
            <div>
              {/* Filter bar */}
              <div style={S.filterBar}>
                <input
                  type="text"
                  placeholder="TICKER"
                  value={tickerFilter}
                  onChange={e => setTickerFilter(e.target.value.toUpperCase())}
                  style={S.filterInput}
                />
                <span style={{ width: 1, height: 14, background: "#333" }} />

                {/* Severity */}
                <div style={{ display: "flex", gap: 1 }}>
                  {[1, 2, 3, 4, 5].map(s => (
                    <button
                      key={s}
                      style={{
                        ...S.filterBtn(severityMin <= s),
                        background: severityMin <= s ? SEV_C[s] : "transparent",
                        borderColor: severityMin <= s ? SEV_C[s] : "#333",
                        color: severityMin <= s ? "#fff" : "#666",
                        minWidth: 18,
                        padding: "2px 4px",
                      }}
                      onClick={() => setSeverityMin(s)}
                    >
                      {s}
                    </button>
                  ))}
                </div>
                <span style={{ width: 1, height: 14, background: "#333" }} />

                {/* Sort */}
                <div style={{ display: "flex", gap: 1 }}>
                  {([["time", "TIME"], ["severity", "SEV"], ["sentiment", "SENT"]] as const).map(([k, l]) => (
                    <button key={k} style={S.filterBtn(sortBy === k)} onClick={() => setSortBy(k)}>
                      {l}
                    </button>
                  ))}
                </div>
                <span style={{ width: 1, height: 14, background: "#333" }} />

                {/* Event type */}
                <select
                  value={eventTypeFilter}
                  onChange={e => {
                    setEventTypeFilter(e.target.value);
                    if (e.target.value === "other") setHideOther(false);
                  }}
                  style={{
                    ...S.filterInput,
                    width: "auto",
                    cursor: "pointer",
                  }}
                >
                  <option value="">ALL TYPES</option>
                  {EVENT_TYPES.map(t => (
                    <option key={t} value={t}>{t.replace(/_/g, " ").toUpperCase()}</option>
                  ))}
                </select>

                {/* Hide/show "other" toggle */}
                <button
                  style={{
                    ...S.filterBtn(!hideOther),
                    ...(hideOther ? { color: "#555", borderColor: "#333" } : {}),
                  }}
                  onClick={() => setHideOther(h => !h)}
                  title={hideOther ? "Click to include 'other' events" : "Click to hide 'other' events"}
                >
                  {hideOther ? "+OTHER" : "-OTHER"}
                </button>

                {(tickerFilter || severityMin > 1 || eventTypeFilter || !hideOther) && (
                  <button
                    style={{ ...S.filterBtn(false), color: "#ef4444", borderColor: "#ef4444" }}
                    onClick={() => { setTickerFilter(""); setSeverityMin(1); setEventTypeFilter(""); setHideOther(true); }}
                  >
                    CLEAR
                  </button>
                )}
              </div>

              {/* Severity bar */}
              <div style={{ display: "flex", height: 2, background: "#111" }}>
                {sevDist.map(d => (
                  <div
                    key={d.level}
                    style={{
                      width: `${events.length > 0 ? (d.count / events.length) * 100 : 0}%`,
                      background: SEV_C[d.level],
                    }}
                  />
                ))}
              </div>

              {/* News table */}
              <div style={S.tableHeader}>
                <span>TIME</span>
                <span />
                <span>HEADLINE</span>
                <span style={{ textAlign: "center" }}>TYPE</span>
                <span style={{ textAlign: "right" }}>SENT</span>
                <span style={{ textAlign: "right" }}>RTN</span>
              </div>

              <div style={{ maxHeight: "calc(100vh - 140px)", overflow: "auto" }}>
                {loading ? (
                  <div style={{ padding: 40, textAlign: "center", color: "#666", fontSize: 11 }}>
                    Loading...
                  </div>
                ) : sortedEvents.length === 0 ? (
                  <div style={{ padding: 40, textAlign: "center", color: "#666", fontSize: 11 }}>
                    No events match filters
                  </div>
                ) : (
                  sortedEvents.map(ev => {
                    const isExp = expandedId === ev.id;
                    const sevColor = SEV_C[ev.severity] || "#555";
                    const typeColor = TYPE_C[ev.eventType] || TYPE_C.other;

                    // Determine if this event has expandable content
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
                            ...S.row,
                            cursor: hasExpandable ? "pointer" : "default",
                          }}
                        >
                          <span style={{ fontSize: 10, color: "#666", paddingTop: 1 }}>
                            {timeAgo(ev.publishedAt)}
                          </span>
                          <div style={{
                            width: 3, minHeight: 16, background: sevColor, borderRadius: 1, marginTop: 1,
                          }} />
                          <div style={{ paddingLeft: 6 }}>
                            <div style={{
                              color: "#e5e5e5", fontWeight: 500, lineHeight: 1.35, fontSize: 11,
                              ...(ev.severity >= 4 ? { color: "#fff" } : {}),
                            }}>
                              {ev.headline}
                              {hasExpandable && (
                                <span style={{ fontSize: 8, color: "#444", marginLeft: 6 }}>
                                  {isExp ? "\u25B4" : "\u25BE"}
                                </span>
                              )}
                            </div>
                            <div style={{ display: "flex", gap: 4, marginTop: 2, flexWrap: "wrap", alignItems: "center" }}>
                              {ev.tickers?.slice(0, 3).map(t => {
                                const dir = DIR_SYM[t.direction] || DIR_SYM.neutral;
                                return (
                                  <Link
                                    key={t.ticker}
                                    href={`/stocks/${t.ticker}`}
                                    onClick={e => e.stopPropagation()}
                                    style={{
                                      fontSize: 9, fontWeight: 700, padding: "0px 3px",
                                      borderRadius: 1, background: "#1a1a1a",
                                      color: dir.color, textDecoration: "none",
                                    }}
                                  >
                                    {dir.icon} {t.ticker}
                                  </Link>
                                );
                              })}
                              <span style={{ fontSize: 8, color: "#444" }}>
                                {ev.source?.replace("ibkr_", "").toUpperCase()}
                              </span>
                              <span style={{ fontSize: 8, color: "#333" }}>
                                {new Date(ev.publishedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                              </span>
                            </div>
                          </div>
                          <div style={{ textAlign: "center", paddingTop: 1 }}>
                            <span style={{
                              fontSize: 8, fontWeight: 700, padding: "1px 4px",
                              borderRadius: 1, background: `${typeColor}15`,
                              color: typeColor, letterSpacing: "0.03em",
                            }}>
                              {ev.eventType.replace(/_/g, " ").toUpperCase()}
                            </span>
                          </div>
                          <div style={{
                            textAlign: "right", paddingTop: 1, fontSize: 10, fontWeight: 600,
                            color: ev.sentiment != null
                              ? ev.sentiment > 0.1 ? "#22c55e" : ev.sentiment < -0.1 ? "#ef4444" : "#555"
                              : "#444",
                          }}>
                            {ev.sentiment != null ? `${ev.sentiment > 0 ? "+" : ""}${ev.sentiment.toFixed(2)}` : ""}
                          </div>
                          <div style={{
                            textAlign: "right", paddingTop: 1, fontSize: 10, fontWeight: 600,
                            color: ev.dayReturnPct != null
                              ? ev.dayReturnPct > 0.3 ? "#22c55e" : ev.dayReturnPct < -0.3 ? "#ef4444" : "#555"
                              : "#444",
                          }}>
                            {ev.dayReturnPct != null ? fmtPct(ev.dayReturnPct, 1) : ""}
                          </div>
                        </div>

                        {/* Expanded detail — only when there's real content */}
                        {isExp && hasExpandable && (
                          <div style={{
                            padding: "10px 12px 10px 60px",
                            background: "#111",
                            borderBottom: "1px solid #222",
                            fontSize: 11,
                          }}>
                            {hasFacts && ev.structuredFacts && (
                              <div style={{
                                display: "grid", gridTemplateColumns: "auto 1fr",
                                gap: "2px 12px", marginBottom: 8, padding: "6px 10px",
                                background: "#1a1a1a", borderRadius: 2, border: "1px solid #222",
                                fontSize: 10,
                              }}>
                                {ev.structuredFacts.person_name && (
                                  <>
                                    <span style={{ color: "#666" }}>Person</span>
                                    <span>{String(ev.structuredFacts.person_name)}{ev.structuredFacts.person_role ? ` (${ev.structuredFacts.person_role})` : ""}</span>
                                  </>
                                )}
                                {ev.structuredFacts.transaction_type && (
                                  <>
                                    <span style={{ color: "#666" }}>Type</span>
                                    <span style={{
                                      fontWeight: 700,
                                      color: String(ev.structuredFacts.transaction_type).toLowerCase() === "buy" ? "#22c55e" : "#ef4444",
                                    }}>{String(ev.structuredFacts.transaction_type).toUpperCase()}</span>
                                  </>
                                )}
                                {ev.structuredFacts.shares && (
                                  <>
                                    <span style={{ color: "#666" }}>Shares</span>
                                    <span>{fmtNum(Number(ev.structuredFacts.shares), true)}</span>
                                  </>
                                )}
                                {ev.structuredFacts.price_per_share && (
                                  <>
                                    <span style={{ color: "#666" }}>Price</span>
                                    <span>NOK {Number(ev.structuredFacts.price_per_share).toFixed(2)}</span>
                                  </>
                                )}
                                {ev.structuredFacts.total_value && (
                                  <>
                                    <span style={{ color: "#666" }}>Value</span>
                                    <span>NOK {fmtNum(Number(ev.structuredFacts.total_value), true)}</span>
                                  </>
                                )}
                              </div>
                            )}

                            {hasSummary && (
                              <p style={{ color: "#bbb", margin: "0 0 8px", lineHeight: 1.5, fontSize: 11 }}>
                                {ev.summary}
                              </p>
                            )}

                            <div style={{ display: "flex", gap: 16, fontSize: 10, color: "#555", flexWrap: "wrap" }}>
                              {ev.tickers && ev.tickers.length > 0 && (
                                <span>
                                  Tickers: {ev.tickers.map(t => t.ticker).join(", ")}
                                </span>
                              )}
                              {ev.sectors && ev.sectors.length > 0 && (
                                <span>
                                  Sectors: {ev.sectors.map(s => s.sector).join(", ")}
                                </span>
                              )}
                              {hasUrl && (
                                <a href={ev.url!} target="_blank" rel="noopener noreferrer"
                                  style={{ color: "#3b82f6", textDecoration: "none" }}
                                  onClick={e => e.stopPropagation()}>
                                  Source {"\u2197"}
                                </a>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* ─── Right Panel: Commodities then Shorts stacked ── */}
            <div className="intel-right" style={S.rightPanel}>
              {/* ─── Commodities Section ──────────────────────── */}
              <div style={{ fontSize: 9, fontWeight: 700, color: "#f97316", letterSpacing: "0.08em", padding: "6px 10px", borderBottom: "1px solid #222", background: "#111" }}>
                COMMODITIES
              </div>
              {commodities.map(c => {
                const retColor = (c.dayReturnPct ?? 0) >= 0 ? "#22c55e" : "#ef4444";
                const histData = c.history?.map(h => h.close) || [];
                const sparkColor = histData.length > 1
                  ? histData[histData.length - 1] >= histData[0] ? "#22c55e" : "#ef4444"
                  : "#555";
                const isSalmon = c.symbol === "SALMON";

                return (
                  <div key={c.symbol} style={{ borderBottom: "1px solid #1a1a1a" }}>
                    <div style={{
                      display: "grid", gridTemplateColumns: "1fr auto auto",
                      padding: "6px 10px 3px", alignItems: "center", gap: 8,
                    }}>
                      <div>
                        <div style={{ fontSize: 10, fontWeight: 700, color: "#e5e5e5" }}>
                          {c.name}
                        </div>
                        <div style={{ fontSize: 8, color: "#555" }}>
                          {isSalmon ? "NOK/kg · weekly" : c.symbol}
                        </div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        {isSalmon ? (
                          <>
                            <div style={{ fontSize: 11, fontWeight: 700, color: "#e5e5e5" }}>
                              {"\u20AC"}{c.eurClose ? c.eurClose.toFixed(2) : "–"}
                              <span style={{ color: "#888", fontWeight: 500, fontSize: 9 }}>
                                {" "}NOK{fmtPrice(c.latest.close)}
                              </span>
                            </div>
                            <div style={{ fontSize: 10, fontWeight: 600, color: retColor }}>
                              {fmtPct(c.dayReturnPct, 1)}
                            </div>
                          </>
                        ) : (
                          <>
                            <div style={{ fontSize: 11, fontWeight: 700, color: "#e5e5e5" }}>
                              {c.currency === "USD" ? "$" : ""}{fmtPrice(c.latest.close)}
                            </div>
                            <div style={{ fontSize: 10, fontWeight: 600, color: retColor }}>
                              {fmtPct(c.dayReturnPct, 1)}
                            </div>
                          </>
                        )}
                      </div>
                      <div dangerouslySetInnerHTML={{ __html: sparklineSvg(histData.slice(-30), 48, 18, sparkColor) }} />
                    </div>
                    {c.sensitivities.length > 0 && (
                      <div style={{ padding: "1px 10px 6px", display: "flex", gap: 4, flexWrap: "wrap" }}>
                        {c.sensitivities.slice(0, 4).map(s => (
                          <Link
                            key={s.ticker}
                            href={`/stocks/${s.ticker}`}
                            style={{
                              fontSize: 9, padding: "2px 6px", borderRadius: 2,
                              background: "transparent",
                              border: `1px solid ${s.beta > 0 ? "#22c55e33" : "#ef444433"}`,
                              color: "#999", textDecoration: "none", fontWeight: 500,
                              display: "inline-flex", gap: 3, alignItems: "center",
                            }}
                          >
                            <span style={{ color: "#ccc", fontWeight: 700 }}>{s.ticker}</span>
                            <span style={{ color: s.beta > 0 ? "#22c55e" : "#ef4444" }}>
                              {s.beta > 0 ? "+" : ""}{s.beta.toFixed(2)}
                            </span>
                          </Link>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* ─── Short Interest Section ───────────────────── */}
              <div style={{ fontSize: 9, fontWeight: 700, color: "#f97316", letterSpacing: "0.08em", padding: "6px 10px", borderBottom: "1px solid #222", background: "#111", marginTop: 0 }}>
                SHORT INTEREST
              </div>
              <div style={{
                display: "grid", gridTemplateColumns: "1fr 1fr 1fr",
                padding: "6px 10px", borderBottom: "1px solid #1a1a1a", fontSize: 10,
              }}>
                <div>
                  <div style={{ color: "#666", fontSize: 8, letterSpacing: "0.06em" }}>TRACKED</div>
                  <div style={{ fontWeight: 700, color: "#e5e5e5" }}>{shorts.length}</div>
                </div>
                <div>
                  <div style={{ color: "#666", fontSize: 8, letterSpacing: "0.06em" }}>TOP</div>
                  <div style={{ fontWeight: 700, color: "#f97316" }}>
                    {topShorted ? `${topShorted.ticker} ${topShorted.shortPct.toFixed(1)}%` : "\u2014"}
                  </div>
                </div>
                <div>
                  <div style={{ color: "#666", fontSize: 8, letterSpacing: "0.06em" }}>MOVERS</div>
                  <div style={{ fontWeight: 700, color: shortMovers.length > 0 ? "#ef4444" : "#666" }}>
                    {shortMovers.length}
                  </div>
                </div>
              </div>

              <div style={{
                display: "grid", gridTemplateColumns: "60px 50px 40px 1fr 24px",
                padding: "4px 10px", fontSize: 8, fontWeight: 700, color: "#555",
                letterSpacing: "0.06em", borderBottom: "1px solid #1a1a1a",
              }}>
                <span>TICKER</span>
                <span style={{ textAlign: "right" }}>SI%</span>
                <span style={{ textAlign: "right" }}>{"\u0394"}</span>
                <span style={{ textAlign: "center" }}>90D</span>
                <span style={{ textAlign: "right" }}>N</span>
              </div>

              <div>
                {shorts.length === 0 ? (
                  <div style={{ padding: 20, textAlign: "center", color: "#555", fontSize: 10 }}>
                    No short position data
                  </div>
                ) : (
                  shorts.map(s => {
                    const changePct = s.changePct;
                    const changeColor = changePct == null ? "#555"
                      : changePct > 0.2 ? "#ef4444"
                      : changePct < -0.2 ? "#22c55e"
                      : "#555";
                    const siColor = s.shortPct >= 5 ? "#ef4444"
                      : s.shortPct >= 3 ? "#f97316"
                      : s.shortPct >= 1 ? "#f59e0b"
                      : "#888";

                    const histData = s.history?.map(h => h.short_pct) || [];
                    const sparkColor = histData.length > 1
                      ? histData[histData.length - 1] > histData[0] ? "#ef4444" : "#22c55e"
                      : "#555";

                    return (
                      <Link
                        key={s.ticker}
                        href={`/stocks/${s.ticker}`}
                        className="short-row"
                        style={{
                          display: "grid", gridTemplateColumns: "60px 50px 40px 1fr 24px",
                          padding: "5px 10px", textDecoration: "none", color: "inherit",
                          borderBottom: "1px solid #111", alignItems: "center",
                        }}
                      >
                        <span style={{ fontSize: 10, fontWeight: 700, color: "#e5e5e5" }}>
                          {s.ticker}
                        </span>
                        <span style={{ textAlign: "right", fontSize: 10, fontWeight: 700, color: siColor }}>
                          {s.shortPct.toFixed(2)}%
                        </span>
                        <span style={{ textAlign: "right", fontSize: 9, fontWeight: 600, color: changeColor }}>
                          {changePct != null ? fmtPct(changePct, 1) : "\u2014"}
                        </span>
                        <div style={{ textAlign: "center" }}
                          dangerouslySetInnerHTML={{ __html: sparklineSvg(histData, 50, 14, sparkColor) }}
                        />
                        <span style={{ textAlign: "right", fontSize: 9, color: "#666" }}>
                          {s.activePositions}
                        </span>
                      </Link>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
