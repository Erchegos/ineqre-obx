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
};

/* ─── Constants ────────────────────────────────────────────────── */

const SEVERITY_COLORS: Record<number, string> = {
  1: "#6b7280",
  2: "#3b82f6",
  3: "#f59e0b",
  4: "#f97316",
  5: "#ef4444",
};

const SEVERITY_LABELS: Record<number, string> = {
  1: "LOW",
  2: "MODERATE",
  3: "ELEVATED",
  4: "HIGH",
  5: "CRITICAL",
};

const EVENT_TYPE_COLORS: Record<string, string> = {
  earnings: "#22c55e",
  guidance: "#3b82f6",
  analyst_action: "#a855f7",
  corporate_action: "#f59e0b",
  insider_trade: "#ec4899",
  regulatory: "#06b6d4",
  macro: "#6366f1",
  geopolitical: "#ef4444",
  sector_news: "#14b8a6",
  other: "#6b7280",
};

const DIRECTION_SYMBOLS: Record<string, { icon: string; color: string }> = {
  positive: { icon: "▲", color: "#22c55e" },
  negative: { icon: "▼", color: "#ef4444" },
  neutral: { icon: "─", color: "#6b7280" },
};

const EVENT_TYPES = [
  "earnings",
  "guidance",
  "analyst_action",
  "corporate_action",
  "insider_trade",
  "regulatory",
  "macro",
  "geopolitical",
  "sector_news",
  "other",
];

/* ─── Helpers ──────────────────────────────────────────────────── */

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "NOW";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `${days}d`;
}

function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/* ─── Page Component ───────────────────────────────────────────── */

export default function NewsPage() {
  const [events, setEvents] = useState<NewsEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  // Filters
  const [tickerFilter, setTickerFilter] = useState("");
  const [sectorFilter, setSectorFilter] = useState("");
  const [severityMin, setSeverityMin] = useState(1);
  const [eventTypeFilter, setEventTypeFilter] = useState("");
  const [sortBy, setSortBy] = useState<"time" | "severity" | "sentiment">(
    "time"
  );

  // Sector summary
  const [sectorSummary, setSectorSummary] = useState<
    { sector: string; count: number; avgSeverity: number; avgSentiment: number }[]
  >([]);

  // Auto-refresh
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  const fetchNews = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (tickerFilter) params.set("ticker", tickerFilter);
      if (sectorFilter) params.set("sector", sectorFilter);
      if (severityMin > 1) params.set("severity_min", String(severityMin));
      if (eventTypeFilter) params.set("event_type", eventTypeFilter);
      params.set("limit", "200");

      const res = await fetch(`/api/news?${params}`, { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();
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
      setLastRefresh(new Date());
    } catch (err) {
      console.error("[NewsPage]", err);
    } finally {
      setLoading(false);
    }
  }, [tickerFilter, sectorFilter, severityMin, eventTypeFilter]);

  useEffect(() => {
    setLoading(true);
    fetchNews();
  }, [fetchNews]);

  // Auto-refresh every 60s
  useEffect(() => {
    timerRef.current = setInterval(fetchNews, 60000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [fetchNews]);

  // Build sector summary from current events
  useEffect(() => {
    const sectorMap = new Map<
      string,
      { count: number; totalSev: number; totalSent: number; sentCount: number }
    >();
    for (const ev of events) {
      if (!ev.sectors) continue;
      for (const s of ev.sectors) {
        const existing = sectorMap.get(s.sector) || {
          count: 0,
          totalSev: 0,
          totalSent: 0,
          sentCount: 0,
        };
        existing.count++;
        existing.totalSev += ev.severity;
        if (ev.sentiment !== null) {
          existing.totalSent += ev.sentiment;
          existing.sentCount++;
        }
        sectorMap.set(s.sector, existing);
      }
    }
    const summary = Array.from(sectorMap.entries())
      .map(([sector, d]) => ({
        sector,
        count: d.count,
        avgSeverity: d.totalSev / d.count,
        avgSentiment: d.sentCount > 0 ? d.totalSent / d.sentCount : 0,
      }))
      .sort((a, b) => b.count - a.count);
    setSectorSummary(summary);
  }, [events]);

  // Sort events
  const sortedEvents = [...events].sort((a, b) => {
    if (sortBy === "severity") return b.severity - a.severity;
    if (sortBy === "sentiment") {
      const aSent = a.sentiment ?? 0;
      const bSent = b.sentiment ?? 0;
      return Math.abs(bSent) - Math.abs(aSent);
    }
    return (
      new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
    );
  });

  // Severity distribution
  const severityDist = [1, 2, 3, 4, 5].map((s) => ({
    level: s,
    count: events.filter((e) => e.severity === s).length,
  }));

  return (
    <>
      <style>{`
        .news-row { transition: background 0.12s; }
        .news-row:hover { background: rgba(255,255,255,0.025) !important; }
        .filter-btn {
          padding: 3px 8px;
          border-radius: 3px;
          border: 1px solid var(--border);
          background: transparent;
          color: var(--muted-foreground);
          font-family: monospace;
          font-size: 10px;
          cursor: pointer;
          transition: all 0.15s;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          font-weight: 600;
        }
        .filter-btn:hover { border-color: var(--accent); color: var(--accent); }
        .filter-btn.active {
          background: var(--accent);
          color: #fff;
          border-color: var(--accent);
        }
        .sector-row { transition: background 0.12s; cursor: pointer; }
        .sector-row:hover { background: rgba(255,255,255,0.03) !important; }
        .news-page-grid { display: grid; grid-template-columns: 1fr 280px; gap: 20px; }
        @media (max-width: 900px) {
          .news-page-grid { grid-template-columns: 1fr; }
        }
      `}</style>

      <main
        style={{
          minHeight: "100vh",
          background: "var(--background)",
          color: "var(--foreground)",
          fontFamily: "'Geist Mono', monospace",
        }}
      >
        <div style={{ maxWidth: 1400, margin: "0 auto", padding: "20px 24px" }}>
          {/* Header */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 16,
              borderBottom: "1px solid var(--border)",
              paddingBottom: 12,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <Link
                href="/"
                style={{
                  fontSize: 11,
                  color: "var(--muted-foreground)",
                  textDecoration: "none",
                }}
              >
                ← Home
              </Link>
              <h1
                style={{
                  fontSize: 16,
                  fontWeight: 700,
                  letterSpacing: "-0.02em",
                }}
              >
                NEWS FEED
              </h1>
              <span
                style={{
                  fontSize: 10,
                  color: "var(--muted-foreground)",
                  padding: "2px 6px",
                  background: "rgba(255,255,255,0.04)",
                  borderRadius: 3,
                }}
              >
                {events.length} events
              </span>
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                fontSize: 10,
                color: "var(--muted-foreground)",
              }}
            >
              <span
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: "#22c55e",
                    animation: "pulse 2s infinite",
                  }}
                />
                LIVE
              </span>
              <span>
                Updated{" "}
                {lastRefresh.toLocaleTimeString("en-GB", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            </div>
          </div>

          <div className="news-page-grid">
            {/* Left: Main feed */}
            <div>
              {/* Filter bar */}
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 8,
                  marginBottom: 12,
                  padding: "10px 12px",
                  background: "rgba(255,255,255,0.02)",
                  borderRadius: 4,
                  border: "1px solid var(--border)",
                  alignItems: "center",
                }}
              >
                {/* Ticker search */}
                <input
                  type="text"
                  placeholder="TICKER"
                  value={tickerFilter}
                  onChange={(e) =>
                    setTickerFilter(e.target.value.toUpperCase())
                  }
                  style={{
                    width: 80,
                    padding: "4px 8px",
                    background: "rgba(255,255,255,0.04)",
                    border: "1px solid var(--border)",
                    borderRadius: 3,
                    color: "var(--foreground)",
                    fontFamily: "monospace",
                    fontSize: 11,
                    outline: "none",
                  }}
                />

                {/* Severity filter */}
                <div style={{ display: "flex", gap: 2 }}>
                  {[1, 2, 3, 4, 5].map((s) => (
                    <button
                      key={s}
                      className={`filter-btn ${severityMin <= s ? "active" : ""}`}
                      style={{
                        background:
                          severityMin <= s
                            ? SEVERITY_COLORS[s]
                            : "transparent",
                        borderColor:
                          severityMin <= s
                            ? SEVERITY_COLORS[s]
                            : "var(--border)",
                        color: severityMin <= s ? "#fff" : "var(--muted-foreground)",
                        minWidth: 22,
                        textAlign: "center",
                      }}
                      onClick={() => setSeverityMin(s)}
                      title={`Min severity: ${s}`}
                    >
                      {s}
                    </button>
                  ))}
                </div>

                {/* Divider */}
                <span
                  style={{
                    width: 1,
                    height: 16,
                    background: "var(--border)",
                  }}
                />

                {/* Sort */}
                <div style={{ display: "flex", gap: 2 }}>
                  {(
                    [
                      ["time", "TIME"],
                      ["severity", "SEV"],
                      ["sentiment", "SENT"],
                    ] as const
                  ).map(([key, label]) => (
                    <button
                      key={key}
                      className={`filter-btn ${sortBy === key ? "active" : ""}`}
                      onClick={() => setSortBy(key)}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {/* Divider */}
                <span
                  style={{
                    width: 1,
                    height: 16,
                    background: "var(--border)",
                  }}
                />

                {/* Event type filter */}
                <select
                  value={eventTypeFilter}
                  onChange={(e) => setEventTypeFilter(e.target.value)}
                  style={{
                    padding: "4px 6px",
                    background: "rgba(255,255,255,0.04)",
                    border: "1px solid var(--border)",
                    borderRadius: 3,
                    color: "var(--foreground)",
                    fontFamily: "monospace",
                    fontSize: 10,
                    outline: "none",
                    cursor: "pointer",
                  }}
                >
                  <option value="">ALL TYPES</option>
                  {EVENT_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t.replace(/_/g, " ").toUpperCase()}
                    </option>
                  ))}
                </select>

                {/* Sector filter */}
                {sectorSummary.length > 0 && (
                  <select
                    value={sectorFilter}
                    onChange={(e) => setSectorFilter(e.target.value)}
                    style={{
                      padding: "4px 6px",
                      background: "rgba(255,255,255,0.04)",
                      border: "1px solid var(--border)",
                      borderRadius: 3,
                      color: "var(--foreground)",
                      fontFamily: "monospace",
                      fontSize: 10,
                      outline: "none",
                      cursor: "pointer",
                    }}
                  >
                    <option value="">ALL SECTORS</option>
                    {sectorSummary.map((s) => (
                      <option key={s.sector} value={s.sector}>
                        {s.sector.toUpperCase()} ({s.count})
                      </option>
                    ))}
                  </select>
                )}

                {/* Clear */}
                {(tickerFilter ||
                  sectorFilter ||
                  severityMin > 1 ||
                  eventTypeFilter) && (
                  <button
                    className="filter-btn"
                    onClick={() => {
                      setTickerFilter("");
                      setSectorFilter("");
                      setSeverityMin(1);
                      setEventTypeFilter("");
                    }}
                    style={{ color: "#ef4444", borderColor: "#ef4444" }}
                  >
                    CLEAR
                  </button>
                )}
              </div>

              {/* Severity distribution bar */}
              <div
                style={{
                  display: "flex",
                  height: 4,
                  borderRadius: 2,
                  overflow: "hidden",
                  marginBottom: 12,
                  background: "rgba(255,255,255,0.04)",
                }}
              >
                {severityDist.map((d) => (
                  <div
                    key={d.level}
                    style={{
                      width: `${events.length > 0 ? (d.count / events.length) * 100 : 0}%`,
                      background: SEVERITY_COLORS[d.level],
                      transition: "width 0.3s",
                    }}
                    title={`Severity ${d.level}: ${d.count} events`}
                  />
                ))}
              </div>

              {/* Event list */}
              {loading ? (
                <div
                  style={{
                    padding: 40,
                    textAlign: "center",
                    color: "var(--muted-foreground)",
                    fontSize: 12,
                  }}
                >
                  Loading news feed...
                </div>
              ) : sortedEvents.length === 0 ? (
                <div
                  style={{
                    padding: 40,
                    textAlign: "center",
                    color: "var(--muted-foreground)",
                    fontSize: 12,
                  }}
                >
                  No events match your filters.
                </div>
              ) : (
                <div
                  style={{
                    border: "1px solid var(--border)",
                    borderRadius: 4,
                    overflow: "hidden",
                  }}
                >
                  {/* Table header */}
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "52px 3px 1fr 80px 60px",
                      padding: "6px 10px",
                      fontSize: 9,
                      fontWeight: 700,
                      color: "var(--muted-foreground)",
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                      background: "rgba(255,255,255,0.03)",
                      borderBottom: "1px solid var(--border)",
                    }}
                  >
                    <span>TIME</span>
                    <span />
                    <span>HEADLINE</span>
                    <span style={{ textAlign: "center" }}>TYPE</span>
                    <span style={{ textAlign: "right" }}>SENT</span>
                  </div>

                  {sortedEvents.map((ev) => {
                    const isExpanded = expandedId === ev.id;
                    const sevColor = SEVERITY_COLORS[ev.severity] || "#6b7280";
                    const typeColor =
                      EVENT_TYPE_COLORS[ev.eventType] ||
                      EVENT_TYPE_COLORS.other;

                    return (
                      <div key={ev.id}>
                        <div
                          className="news-row"
                          onClick={() =>
                            setExpandedId(isExpanded ? null : ev.id)
                          }
                          style={{
                            display: "grid",
                            gridTemplateColumns: "52px 3px 1fr 80px 60px",
                            padding: "8px 10px",
                            cursor: "pointer",
                            borderBottom: "1px solid rgba(255,255,255,0.04)",
                            alignItems: "start",
                          }}
                        >
                          {/* Time */}
                          <span
                            style={{
                              fontSize: 10,
                              color: "var(--muted-foreground)",
                              paddingTop: 2,
                            }}
                          >
                            {timeAgo(ev.publishedAt)}
                          </span>

                          {/* Severity bar */}
                          <div
                            style={{
                              width: 3,
                              minHeight: 18,
                              background: sevColor,
                              borderRadius: 1,
                              marginTop: 2,
                            }}
                          />

                          {/* Headline + meta */}
                          <div style={{ paddingLeft: 8 }}>
                            <div
                              style={{
                                color: "var(--foreground)",
                                fontWeight: 500,
                                lineHeight: 1.4,
                                fontSize: 12,
                              }}
                            >
                              {ev.headline}
                            </div>
                            <div
                              style={{
                                display: "flex",
                                gap: 4,
                                marginTop: 3,
                                flexWrap: "wrap",
                              }}
                            >
                              {ev.tickers?.slice(0, 4).map((t) => {
                                const dir =
                                  DIRECTION_SYMBOLS[t.direction] ||
                                  DIRECTION_SYMBOLS.neutral;
                                return (
                                  <Link
                                    key={t.ticker}
                                    href={`/stocks/${t.ticker}`}
                                    onClick={(e) => e.stopPropagation()}
                                    style={{
                                      fontSize: 9,
                                      fontWeight: 700,
                                      padding: "1px 4px",
                                      borderRadius: 2,
                                      background: "rgba(255,255,255,0.06)",
                                      color: dir.color,
                                      textDecoration: "none",
                                    }}
                                  >
                                    {dir.icon} {t.ticker}
                                  </Link>
                                );
                              })}
                              <span
                                style={{
                                  fontSize: 9,
                                  color: "var(--muted-foreground)",
                                  opacity: 0.5,
                                }}
                              >
                                {ev.source}
                              </span>
                            </div>
                          </div>

                          {/* Event type */}
                          <div style={{ textAlign: "center", paddingTop: 2 }}>
                            <span
                              style={{
                                fontSize: 8,
                                fontWeight: 700,
                                letterSpacing: "0.04em",
                                padding: "2px 5px",
                                borderRadius: 2,
                                background: `${typeColor}18`,
                                color: typeColor,
                                textTransform: "uppercase",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {ev.eventType.replace(/_/g, " ")}
                            </span>
                          </div>

                          {/* Sentiment */}
                          <div
                            style={{
                              textAlign: "right",
                              paddingTop: 2,
                              fontSize: 11,
                              fontWeight: 600,
                              color:
                                ev.sentiment !== null
                                  ? ev.sentiment > 0.1
                                    ? "#22c55e"
                                    : ev.sentiment < -0.1
                                    ? "#ef4444"
                                    : "#6b7280"
                                  : "var(--muted-foreground)",
                            }}
                          >
                            {ev.sentiment !== null
                              ? `${ev.sentiment > 0 ? "+" : ""}${ev.sentiment.toFixed(2)}`
                              : "—"}
                          </div>
                        </div>

                        {/* Expanded details */}
                        {isExpanded && (
                          <div
                            style={{
                              padding: "12px 16px 12px 75px",
                              background: "rgba(255,255,255,0.02)",
                              borderBottom: "1px solid var(--border)",
                            }}
                          >
                            {/* Structured Facts */}
                            {ev.structuredFacts && Object.values(ev.structuredFacts).some(v => v !== null) && (
                              <div style={{
                                display: "grid",
                                gridTemplateColumns: "auto 1fr",
                                gap: "3px 16px",
                                marginBottom: 12,
                                fontSize: 11,
                                padding: "8px 12px",
                                background: "rgba(255,255,255,0.03)",
                                borderRadius: 4,
                                border: "1px solid var(--border)",
                              }}>
                                {ev.structuredFacts.person_name && (
                                  <>
                                    <span style={{ color: "var(--muted-foreground)", fontSize: 10 }}>Person</span>
                                    <span style={{ fontWeight: 600 }}>
                                      {ev.structuredFacts.person_name as string}
                                      {ev.structuredFacts.person_role && (
                                        <span style={{ color: "var(--muted-foreground)", fontWeight: 400 }}> ({ev.structuredFacts.person_role as string})</span>
                                      )}
                                    </span>
                                  </>
                                )}
                                {ev.structuredFacts.transaction_type && (
                                  <>
                                    <span style={{ color: "var(--muted-foreground)", fontSize: 10 }}>Type</span>
                                    <span style={{ fontWeight: 700, color: ev.structuredFacts.transaction_type === "BUY" ? "#22c55e" : "#ef4444" }}>
                                      {ev.structuredFacts.transaction_type as string}
                                    </span>
                                  </>
                                )}
                                {ev.structuredFacts.shares_traded && (
                                  <>
                                    <span style={{ color: "var(--muted-foreground)", fontSize: 10 }}>Shares</span>
                                    <span style={{ fontWeight: 600 }}>{(ev.structuredFacts.shares_traded as number).toLocaleString("en-US")}</span>
                                  </>
                                )}
                                {ev.structuredFacts.total_value_nok && (
                                  <>
                                    <span style={{ color: "var(--muted-foreground)", fontSize: 10 }}>Value</span>
                                    <span style={{ fontWeight: 600 }}>
                                      {(ev.structuredFacts.total_value_nok as number) >= 1e6
                                        ? `NOK ${((ev.structuredFacts.total_value_nok as number) / 1e6).toFixed(1)}M`
                                        : `NOK ${(ev.structuredFacts.total_value_nok as number).toLocaleString("en-US")}`}
                                    </span>
                                  </>
                                )}
                                {ev.structuredFacts.holdings_after && (
                                  <>
                                    <span style={{ color: "var(--muted-foreground)", fontSize: 10 }}>Holdings</span>
                                    <span style={{ fontWeight: 600 }}>{(ev.structuredFacts.holdings_after as number).toLocaleString("en-US")} shares</span>
                                  </>
                                )}
                                {ev.structuredFacts.action_type && (
                                  <>
                                    <span style={{ color: "var(--muted-foreground)", fontSize: 10 }}>Action</span>
                                    <span style={{ fontWeight: 700 }}>{(ev.structuredFacts.action_type as string).toUpperCase()}</span>
                                  </>
                                )}
                                {ev.structuredFacts.shares_count && (
                                  <>
                                    <span style={{ color: "var(--muted-foreground)", fontSize: 10 }}>Shares</span>
                                    <span style={{ fontWeight: 600 }}>{(ev.structuredFacts.shares_count as number).toLocaleString("en-US")}</span>
                                  </>
                                )}
                                {ev.structuredFacts.dividend_per_share && (
                                  <>
                                    <span style={{ color: "var(--muted-foreground)", fontSize: 10 }}>Dividend</span>
                                    <span style={{ fontWeight: 600 }}>NOK {ev.structuredFacts.dividend_per_share}/share</span>
                                  </>
                                )}
                                {ev.structuredFacts.ex_date && (
                                  <>
                                    <span style={{ color: "var(--muted-foreground)", fontSize: 10 }}>Ex-date</span>
                                    <span style={{ fontWeight: 600 }}>{ev.structuredFacts.ex_date as string}</span>
                                  </>
                                )}
                                {ev.structuredFacts.program_total && (
                                  <>
                                    <span style={{ color: "var(--muted-foreground)", fontSize: 10 }}>Program</span>
                                    <span style={{ fontWeight: 600 }}>{ev.structuredFacts.program_total as string}</span>
                                  </>
                                )}
                                {ev.structuredFacts.broker && (
                                  <>
                                    <span style={{ color: "var(--muted-foreground)", fontSize: 10 }}>Broker</span>
                                    <span style={{ fontWeight: 600 }}>{ev.structuredFacts.broker as string}</span>
                                  </>
                                )}
                                {ev.structuredFacts.rating && (
                                  <>
                                    <span style={{ color: "var(--muted-foreground)", fontSize: 10 }}>Rating</span>
                                    <span style={{ fontWeight: 700 }}>{(ev.structuredFacts.rating as string).toUpperCase()}</span>
                                  </>
                                )}
                                {ev.structuredFacts.target_price && (
                                  <>
                                    <span style={{ color: "var(--muted-foreground)", fontSize: 10 }}>Target</span>
                                    <span style={{ fontWeight: 600 }}>NOK {ev.structuredFacts.target_price as number}</span>
                                  </>
                                )}
                                {ev.structuredFacts.beat_miss && (
                                  <>
                                    <span style={{ color: "var(--muted-foreground)", fontSize: 10 }}>Result</span>
                                    <span style={{
                                      fontWeight: 700,
                                      color: ev.structuredFacts.beat_miss === "beat" ? "#22c55e" : ev.structuredFacts.beat_miss === "miss" ? "#ef4444" : "var(--foreground)",
                                    }}>
                                      {(ev.structuredFacts.beat_miss as string).toUpperCase()}
                                    </span>
                                  </>
                                )}
                                {ev.structuredFacts.key_quote && (
                                  <>
                                    <span style={{ color: "var(--muted-foreground)", fontSize: 10 }}>Quote</span>
                                    <span style={{ fontStyle: "italic", color: "var(--muted-foreground)" }}>"{ev.structuredFacts.key_quote as string}"</span>
                                  </>
                                )}
                              </div>
                            )}

                            {ev.summary && (
                              <p
                                style={{
                                  color: "var(--foreground)",
                                  lineHeight: 1.6,
                                  marginBottom: 12,
                                  fontSize: 12,
                                  maxWidth: 700,
                                }}
                              >
                                {ev.summary}
                              </p>
                            )}

                            <div
                              style={{
                                display: "grid",
                                gridTemplateColumns:
                                  "repeat(auto-fit, minmax(130px, 1fr))",
                                gap: 10,
                                fontSize: 10,
                                marginBottom: 10,
                              }}
                            >
                              <div>
                                <span
                                  style={{
                                    color: "var(--muted-foreground)",
                                    fontSize: 9,
                                    textTransform: "uppercase",
                                    letterSpacing: "0.05em",
                                  }}
                                >
                                  Severity
                                </span>
                                <br />
                                <span
                                  style={{
                                    fontWeight: 700,
                                    color: sevColor,
                                  }}
                                >
                                  {ev.severity}/5 — {SEVERITY_LABELS[ev.severity]}
                                </span>
                              </div>
                              <div>
                                <span
                                  style={{
                                    color: "var(--muted-foreground)",
                                    fontSize: 9,
                                    textTransform: "uppercase",
                                    letterSpacing: "0.05em",
                                  }}
                                >
                                  Confidence
                                </span>
                                <br />
                                <span style={{ fontWeight: 600 }}>
                                  {ev.confidence !== null
                                    ? `${(ev.confidence * 100).toFixed(0)}%`
                                    : "N/A"}
                                </span>
                              </div>
                              <div>
                                <span
                                  style={{
                                    color: "var(--muted-foreground)",
                                    fontSize: 9,
                                    textTransform: "uppercase",
                                    letterSpacing: "0.05em",
                                  }}
                                >
                                  Published
                                </span>
                                <br />
                                <span style={{ fontWeight: 600 }}>
                                  {formatTime(ev.publishedAt)}
                                </span>
                              </div>
                              {ev.providerCode && (
                                <div>
                                  <span
                                    style={{
                                      color: "var(--muted-foreground)",
                                      fontSize: 9,
                                      textTransform: "uppercase",
                                      letterSpacing: "0.05em",
                                    }}
                                  >
                                    Provider
                                  </span>
                                  <br />
                                  <span style={{ fontWeight: 600 }}>
                                    {ev.providerCode}
                                  </span>
                                </div>
                              )}
                            </div>

                            {/* Tickers */}
                            {ev.tickers && ev.tickers.length > 0 && (
                              <div style={{ marginBottom: 8 }}>
                                <span
                                  style={{
                                    fontSize: 9,
                                    color: "var(--muted-foreground)",
                                    textTransform: "uppercase",
                                    letterSpacing: "0.06em",
                                  }}
                                >
                                  Affected Tickers
                                </span>
                                <div
                                  style={{
                                    display: "flex",
                                    flexWrap: "wrap",
                                    gap: 4,
                                    marginTop: 4,
                                  }}
                                >
                                  {ev.tickers.map((t) => {
                                    const dir =
                                      DIRECTION_SYMBOLS[t.direction] ||
                                      DIRECTION_SYMBOLS.neutral;
                                    return (
                                      <Link
                                        key={t.ticker}
                                        href={`/stocks/${t.ticker}`}
                                        style={{
                                          fontSize: 10,
                                          fontWeight: 600,
                                          padding: "2px 6px",
                                          borderRadius: 2,
                                          background:
                                            "rgba(255,255,255,0.06)",
                                          color: dir.color,
                                          textDecoration: "none",
                                        }}
                                      >
                                        {dir.icon} {t.ticker}
                                        {t.relevance !== null && (
                                          <span
                                            style={{
                                              opacity: 0.6,
                                              marginLeft: 4,
                                            }}
                                          >
                                            {(t.relevance * 100).toFixed(0)}%
                                          </span>
                                        )}
                                      </Link>
                                    );
                                  })}
                                </div>
                              </div>
                            )}

                            {/* Sectors */}
                            {ev.sectors && ev.sectors.length > 0 && (
                              <div style={{ marginBottom: 8 }}>
                                <span
                                  style={{
                                    fontSize: 9,
                                    color: "var(--muted-foreground)",
                                    textTransform: "uppercase",
                                    letterSpacing: "0.06em",
                                  }}
                                >
                                  Sector Impact
                                </span>
                                <div
                                  style={{
                                    display: "flex",
                                    flexWrap: "wrap",
                                    gap: 4,
                                    marginTop: 4,
                                  }}
                                >
                                  {ev.sectors.map((s) => (
                                    <span
                                      key={s.sector}
                                      style={{
                                        fontSize: 10,
                                        padding: "2px 6px",
                                        borderRadius: 2,
                                        background:
                                          "rgba(255,255,255,0.04)",
                                        color: "var(--muted-foreground)",
                                      }}
                                    >
                                      {s.sector}
                                      {s.impact !== null && (
                                        <span
                                          style={{
                                            marginLeft: 4,
                                            color:
                                              s.impact > 0
                                                ? "#22c55e"
                                                : "#ef4444",
                                            fontWeight: 600,
                                          }}
                                        >
                                          {s.impact > 0 ? "+" : ""}
                                          {s.impact.toFixed(2)}
                                        </span>
                                      )}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}

                            {ev.url && (
                              <a
                                href={ev.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{
                                  fontSize: 10,
                                  color: "var(--accent)",
                                  textDecoration: "none",
                                }}
                              >
                                View source →
                              </a>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Right sidebar */}
            <div>
              {/* Sector Overview */}
              <div
                style={{
                  border: "1px solid var(--border)",
                  borderRadius: 4,
                  marginBottom: 16,
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    padding: "8px 12px",
                    fontSize: 9,
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    color: "var(--muted-foreground)",
                    background: "rgba(255,255,255,0.03)",
                    borderBottom: "1px solid var(--border)",
                  }}
                >
                  SECTOR OVERVIEW
                </div>
                {sectorSummary.length === 0 ? (
                  <div
                    style={{
                      padding: 12,
                      fontSize: 11,
                      color: "var(--muted-foreground)",
                    }}
                  >
                    No sector data
                  </div>
                ) : (
                  sectorSummary.map((s) => (
                    <div
                      key={s.sector}
                      className="sector-row"
                      onClick={() =>
                        setSectorFilter(
                          sectorFilter === s.sector ? "" : s.sector
                        )
                      }
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1fr 32px 44px",
                        padding: "6px 12px",
                        fontSize: 11,
                        borderBottom: "1px solid rgba(255,255,255,0.04)",
                        background:
                          sectorFilter === s.sector
                            ? "rgba(59,130,246,0.08)"
                            : "transparent",
                      }}
                    >
                      <span
                        style={{
                          fontWeight: 600,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {s.sector}
                      </span>
                      <span
                        style={{
                          textAlign: "center",
                          color: "var(--muted-foreground)",
                          fontSize: 10,
                        }}
                      >
                        {s.count}
                      </span>
                      <span
                        style={{
                          textAlign: "right",
                          fontWeight: 600,
                          color:
                            s.avgSentiment > 0.05
                              ? "#22c55e"
                              : s.avgSentiment < -0.05
                              ? "#ef4444"
                              : "#6b7280",
                          fontSize: 10,
                        }}
                      >
                        {s.avgSentiment > 0 ? "+" : ""}
                        {s.avgSentiment.toFixed(2)}
                      </span>
                    </div>
                  ))
                )}
              </div>

              {/* Severity breakdown */}
              <div
                style={{
                  border: "1px solid var(--border)",
                  borderRadius: 4,
                  marginBottom: 16,
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    padding: "8px 12px",
                    fontSize: 9,
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    color: "var(--muted-foreground)",
                    background: "rgba(255,255,255,0.03)",
                    borderBottom: "1px solid var(--border)",
                  }}
                >
                  SEVERITY DISTRIBUTION
                </div>
                <div style={{ padding: "8px 12px" }}>
                  {severityDist.map((d) => (
                    <div
                      key={d.level}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        marginBottom: 6,
                      }}
                    >
                      <span
                        style={{
                          width: 16,
                          fontSize: 10,
                          fontWeight: 700,
                          color: SEVERITY_COLORS[d.level],
                        }}
                      >
                        {d.level}
                      </span>
                      <div
                        style={{
                          flex: 1,
                          height: 6,
                          background: "rgba(255,255,255,0.04)",
                          borderRadius: 3,
                          overflow: "hidden",
                        }}
                      >
                        <div
                          style={{
                            width: `${events.length > 0 ? (d.count / events.length) * 100 : 0}%`,
                            height: "100%",
                            background: SEVERITY_COLORS[d.level],
                            borderRadius: 3,
                            transition: "width 0.3s",
                          }}
                        />
                      </div>
                      <span
                        style={{
                          fontSize: 10,
                          color: "var(--muted-foreground)",
                          minWidth: 20,
                          textAlign: "right",
                        }}
                      >
                        {d.count}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Event type breakdown */}
              <div
                style={{
                  border: "1px solid var(--border)",
                  borderRadius: 4,
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    padding: "8px 12px",
                    fontSize: 9,
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    color: "var(--muted-foreground)",
                    background: "rgba(255,255,255,0.03)",
                    borderBottom: "1px solid var(--border)",
                  }}
                >
                  EVENT TYPES
                </div>
                <div style={{ padding: "6px 12px" }}>
                  {EVENT_TYPES.map((t) => {
                    const count = events.filter(
                      (e) => e.eventType === t
                    ).length;
                    if (count === 0) return null;
                    const color = EVENT_TYPE_COLORS[t] || "#6b7280";
                    return (
                      <div
                        key={t}
                        onClick={() =>
                          setEventTypeFilter(
                            eventTypeFilter === t ? "" : t
                          )
                        }
                        className="sector-row"
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          padding: "4px 0",
                          fontSize: 10,
                          background:
                            eventTypeFilter === t
                              ? "rgba(59,130,246,0.08)"
                              : "transparent",
                          borderRadius: 2,
                          paddingLeft: 4,
                          paddingRight: 4,
                        }}
                      >
                        <span style={{ color, fontWeight: 600 }}>
                          {t.replace(/_/g, " ").toUpperCase()}
                        </span>
                        <span style={{ color: "var(--muted-foreground)" }}>
                          {count}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
