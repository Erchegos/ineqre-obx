"use client";

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

type StructuredFacts = {
  transaction_type?: string | null;
  person_name?: string | null;
  person_role?: string | null;
  shares_traded?: number | null;
  price_per_share?: number | null;
  total_value_nok?: number | null;
  holdings_after?: number | null;
  action_type?: string | null;
  shares_count?: number | null;
  program_total?: string | null;
  dividend_per_share?: number | null;
  ex_date?: string | null;
  revenue?: string | null;
  eps?: number | null;
  beat_miss?: string | null;
  broker?: string | null;
  rating?: string | null;
  target_price?: number | null;
  previous_target?: number | null;
  key_quote?: string | null;
};

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

type NewsFeedProps = {
  ticker?: string;
  limit?: number;
  compact?: boolean;
  refreshInterval?: number;
  severityMin?: number;
};

/* ─── Constants ────────────────────────────────────────────────── */

const SEV_COLOR: Record<number, string> = {
  1: "#6b7280",
  2: "#3b82f6",
  3: "#f59e0b",
  4: "#f97316",
  5: "#ef4444",
};

const TYPE_COLOR: Record<string, string> = {
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

const DIR_SYM: Record<string, { icon: string; color: string }> = {
  positive: { icon: "▲", color: "#22c55e" },
  negative: { icon: "▼", color: "#ef4444" },
  neutral: { icon: "─", color: "#6b7280" },
};

/* ─── Helpers ──────────────────────────────────────────────────── */

function timeAgo(dateStr: string): string {
  const mins = Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000);
  if (mins < 1) return "NOW";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d`;
  return new Date(dateStr).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/** Format NOK amount (e.g., 2400000 -> "NOK 2.4M") */
function fmtNOK(v: number | null | undefined): string | null {
  if (!v) return null;
  if (v >= 1_000_000_000) return `NOK ${(v / 1_000_000_000).toFixed(1)}B`;
  if (v >= 1_000_000) return `NOK ${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `NOK ${(v / 1_000).toFixed(0)}K`;
  return `NOK ${v.toFixed(0)}`;
}

/** Format share count (e.g., 50000 -> "50,000 shares") */
function fmtShares(v: number | null | undefined): string | null {
  if (!v) return null;
  return `${v.toLocaleString("en-US")} shares`;
}

/** Build a compact fact line from structured facts */
function factLine(ev: NewsEvent): string | null {
  const f = ev.structuredFacts;
  if (!f) return null;

  if (ev.eventType === "insider_trade") {
    const parts: string[] = [];
    if (f.transaction_type) parts.push(f.transaction_type);
    const val = fmtNOK(f.total_value_nok);
    if (val) parts.push(val);
    if (f.shares_traded) parts.push(fmtShares(f.shares_traded)!);
    if (f.person_name) {
      const role = f.person_role ? ` (${f.person_role})` : "";
      parts.push(`${f.person_name}${role}`);
    }
    if (f.holdings_after) parts.push(`Holdings: ${fmtShares(f.holdings_after)}`);
    return parts.length > 0 ? parts.join(" · ") : null;
  }

  if (ev.eventType === "corporate_action") {
    const parts: string[] = [];
    if (f.action_type) parts.push(f.action_type.toUpperCase());
    if (f.shares_count) parts.push(fmtShares(f.shares_count)!);
    const val = fmtNOK(f.total_value_nok);
    if (val) parts.push(val);
    if (f.dividend_per_share) parts.push(`NOK ${f.dividend_per_share}/share`);
    if (f.ex_date) parts.push(`Ex: ${f.ex_date}`);
    if (f.program_total) parts.push(`Program: ${f.program_total}`);
    return parts.length > 0 ? parts.join(" · ") : null;
  }

  if (ev.eventType === "earnings") {
    const parts: string[] = [];
    if (f.beat_miss) parts.push(f.beat_miss === "beat" ? "BEAT" : f.beat_miss === "miss" ? "MISS" : "INLINE");
    if (f.eps) parts.push(`EPS: ${f.eps}`);
    if (f.revenue) parts.push(`Rev: ${f.revenue}`);
    return parts.length > 0 ? parts.join(" · ") : null;
  }

  if (ev.eventType === "analyst_action") {
    const parts: string[] = [];
    if (f.broker) parts.push(f.broker);
    if (f.rating) parts.push(f.rating.toUpperCase());
    if (f.target_price) {
      let tp = `TP: NOK ${f.target_price}`;
      if (f.previous_target) tp += ` (prev: ${f.previous_target})`;
      parts.push(tp);
    }
    return parts.length > 0 ? parts.join(" · ") : null;
  }

  return null;
}

/** Clean headline for display */
function cleanHeadline(headline: string): string {
  return headline
    .replace(/^Press Release:\s*/i, "")
    .replace(/^\*\s*/, "")
    .replace(/^[A-Z]{2,}[A-Z\s]*:\s*/i, "")
    .trim();
}

/* ─── Component ────────────────────────────────────────────────── */

/** Deduplicate events with near-identical headlines */
function dedup(events: NewsEvent[]): NewsEvent[] {
  const seen = new Map<string, NewsEvent>();
  for (const ev of events) {
    const key = ev.headline
      .toLowerCase()
      .replace(/^press release:\s*/i, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
    const existing = seen.get(key);
    if (!existing || ev.severity > existing.severity) {
      seen.set(key, ev);
    }
  }
  return Array.from(seen.values()).sort(
    (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
  );
}

export default function NewsFeed({
  ticker,
  limit = 50,
  compact = false,
  refreshInterval = 60,
  severityMin = 1,
}: NewsFeedProps) {
  const [events, setEvents] = useState<NewsEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const fetchNews = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      params.set("limit", String(limit));
      if (severityMin > 1) params.set("severity_min", String(severityMin));

      const url = ticker
        ? `/api/news/ticker/${ticker}?${params}`
        : `/api/news?${params}`;
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();
      setEvents(dedup(data.events || []));
    } catch (err) {
      console.error("[NewsFeed]", err);
    } finally {
      setLoading(false);
    }
  }, [ticker, limit, severityMin]);

  useEffect(() => {
    fetchNews();
    if (refreshInterval > 0) {
      timerRef.current = setInterval(fetchNews, refreshInterval * 1000);
      return () => { if (timerRef.current) clearInterval(timerRef.current); };
    }
  }, [fetchNews, refreshInterval]);

  if (loading) {
    return <div style={{ padding: 8, fontFamily: "monospace", fontSize: 10, color: "var(--muted-foreground)" }}>Loading...</div>;
  }

  if (events.length === 0) {
    return <div style={{ padding: 8, fontFamily: "monospace", fontSize: 10, color: "var(--muted-foreground)" }}>No news events{ticker ? ` for ${ticker}` : ""}.</div>;
  }

  return (
    <div style={{ fontFamily: "'Geist Mono', monospace", fontSize: compact ? 10 : 11 }}>
      {events.map((ev) => {
        const isExpanded = expandedId === ev.id;
        const sevColor = SEV_COLOR[ev.severity] || "#6b7280";
        const typeColor = TYPE_COLOR[ev.eventType] || "#6b7280";
        const headline = cleanHeadline(ev.headline);
        const facts = factLine(ev);

        return (
          <div
            key={ev.id}
            onClick={() => setExpandedId(isExpanded ? null : ev.id)}
            style={{
              borderBottom: "1px solid rgba(255,255,255,0.04)",
              padding: compact ? "5px 0" : "8px 0",
              cursor: "pointer",
              transition: "background 0.1s",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.02)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            {/* Single-line row */}
            <div style={{ display: "flex", alignItems: "flex-start", gap: compact ? 4 : 8 }}>
              {/* Severity bar */}
              <div style={{ width: 2, minHeight: compact ? 14 : 18, background: sevColor, borderRadius: 1, marginTop: 2, flexShrink: 0 }} />

              {/* Time */}
              <span style={{ fontSize: compact ? 9 : 10, color: "var(--muted-foreground)", minWidth: compact ? 24 : 36, flexShrink: 0, marginTop: 1 }}>
                {timeAgo(ev.publishedAt)}
              </span>

              {/* Content */}
              <div style={{ flex: 1, minWidth: 0 }}>
                {/* Headline — truncated in compact */}
                <span style={{
                  color: "var(--foreground)", fontWeight: 500, lineHeight: 1.35,
                  ...(compact && !isExpanded ? { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const, display: "block" } : {}),
                }}>
                  {compact && headline.length > 70 ? headline.slice(0, 67) + "..." : headline}
                </span>

                {/* Structured facts line (KEY DATA) */}
                {facts && (
                  <div style={{
                    fontSize: compact ? 9 : 10,
                    fontWeight: 600,
                    color: ev.eventType === "insider_trade" ? "#ec4899" :
                           ev.eventType === "corporate_action" ? "#f59e0b" :
                           ev.eventType === "earnings" ? "#22c55e" :
                           ev.eventType === "analyst_action" ? "#a855f7" :
                           "var(--muted-foreground)",
                    marginTop: 1,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap" as const,
                  }}>
                    {facts}
                  </div>
                )}

                {/* Inline badges */}
                <div style={{ display: "flex", gap: 3, marginTop: 2, flexWrap: "wrap", alignItems: "center" }}>
                  {/* Event type */}
                  <span style={{
                    fontSize: 8, fontWeight: 700, padding: "0px 4px", borderRadius: 1,
                    background: `${typeColor}18`, color: typeColor,
                    textTransform: "uppercase", letterSpacing: "0.03em",
                  }}>
                    {ev.eventType.replace(/_/g, " ")}
                  </span>

                  {/* Sentiment */}
                  {ev.sentiment !== null && Math.abs(ev.sentiment) > 0.05 && (
                    <span style={{
                      fontSize: 9, fontWeight: 600,
                      color: ev.sentiment > 0 ? "#22c55e" : "#ef4444",
                    }}>
                      {ev.sentiment > 0 ? "+" : ""}{ev.sentiment.toFixed(2)}
                    </span>
                  )}

                  {/* Ticker pills (only in non-ticker-specific mode) */}
                  {!ticker && ev.tickers?.slice(0, 2).map((t) => {
                    const d = DIR_SYM[t.direction] || DIR_SYM.neutral;
                    return (
                      <span key={t.ticker} style={{
                        fontSize: 8, fontWeight: 700, padding: "0px 3px", borderRadius: 1,
                        background: "rgba(255,255,255,0.06)", color: d.color,
                      }}>
                        {d.icon}{t.ticker}
                      </span>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Expanded detail — smooth CSS grid animation */}
            <div style={{
              display: "grid",
              gridTemplateRows: isExpanded ? "1fr" : "0fr",
              transition: "grid-template-rows 0.25s ease-out",
            }}>
              <div style={{ overflow: "hidden" }}>
              <div style={{
                marginTop: 6, marginLeft: compact ? 30 : 46,
                padding: "8px 10px", background: "rgba(255,255,255,0.03)",
                borderRadius: 3, border: "1px solid var(--border)", fontSize: compact ? 10 : 11,
              }}>
                {/* Structured facts detail (full display) */}
                {ev.structuredFacts && Object.values(ev.structuredFacts).some(v => v !== null) && (
                  <div style={{
                    display: "grid",
                    gridTemplateColumns: "auto 1fr",
                    gap: "2px 12px",
                    marginBottom: 8,
                    fontSize: 10,
                  }}>
                    {ev.structuredFacts.person_name && (
                      <>
                        <span style={{ color: "var(--muted-foreground)" }}>Person</span>
                        <span style={{ fontWeight: 600 }}>
                          {ev.structuredFacts.person_name}
                          {ev.structuredFacts.person_role && (
                            <span style={{ color: "var(--muted-foreground)", fontWeight: 400 }}> ({ev.structuredFacts.person_role})</span>
                          )}
                        </span>
                      </>
                    )}
                    {ev.structuredFacts.transaction_type && (
                      <>
                        <span style={{ color: "var(--muted-foreground)" }}>Type</span>
                        <span style={{ fontWeight: 600, color: ev.structuredFacts.transaction_type === "BUY" ? "#22c55e" : "#ef4444" }}>
                          {ev.structuredFacts.transaction_type}
                        </span>
                      </>
                    )}
                    {ev.structuredFacts.shares_traded && (
                      <>
                        <span style={{ color: "var(--muted-foreground)" }}>Shares</span>
                        <span style={{ fontWeight: 600 }}>{ev.structuredFacts.shares_traded.toLocaleString("en-US")}</span>
                      </>
                    )}
                    {ev.structuredFacts.price_per_share && (
                      <>
                        <span style={{ color: "var(--muted-foreground)" }}>Price</span>
                        <span style={{ fontWeight: 600 }}>NOK {ev.structuredFacts.price_per_share.toLocaleString("en-US")}</span>
                      </>
                    )}
                    {ev.structuredFacts.total_value_nok && (
                      <>
                        <span style={{ color: "var(--muted-foreground)" }}>Value</span>
                        <span style={{ fontWeight: 600 }}>{fmtNOK(ev.structuredFacts.total_value_nok)}</span>
                      </>
                    )}
                    {ev.structuredFacts.holdings_after && (
                      <>
                        <span style={{ color: "var(--muted-foreground)" }}>Holdings</span>
                        <span style={{ fontWeight: 600 }}>{ev.structuredFacts.holdings_after.toLocaleString("en-US")} shares</span>
                      </>
                    )}
                    {ev.structuredFacts.action_type && (
                      <>
                        <span style={{ color: "var(--muted-foreground)" }}>Action</span>
                        <span style={{ fontWeight: 600 }}>{ev.structuredFacts.action_type.toUpperCase()}</span>
                      </>
                    )}
                    {ev.structuredFacts.shares_count && (
                      <>
                        <span style={{ color: "var(--muted-foreground)" }}>Shares</span>
                        <span style={{ fontWeight: 600 }}>{ev.structuredFacts.shares_count.toLocaleString("en-US")}</span>
                      </>
                    )}
                    {ev.structuredFacts.dividend_per_share && (
                      <>
                        <span style={{ color: "var(--muted-foreground)" }}>Dividend</span>
                        <span style={{ fontWeight: 600 }}>NOK {ev.structuredFacts.dividend_per_share}/share</span>
                      </>
                    )}
                    {ev.structuredFacts.ex_date && (
                      <>
                        <span style={{ color: "var(--muted-foreground)" }}>Ex-date</span>
                        <span style={{ fontWeight: 600 }}>{ev.structuredFacts.ex_date}</span>
                      </>
                    )}
                    {ev.structuredFacts.program_total && (
                      <>
                        <span style={{ color: "var(--muted-foreground)" }}>Program</span>
                        <span style={{ fontWeight: 600 }}>{ev.structuredFacts.program_total}</span>
                      </>
                    )}
                    {ev.structuredFacts.broker && (
                      <>
                        <span style={{ color: "var(--muted-foreground)" }}>Broker</span>
                        <span style={{ fontWeight: 600 }}>{ev.structuredFacts.broker}</span>
                      </>
                    )}
                    {ev.structuredFacts.rating && (
                      <>
                        <span style={{ color: "var(--muted-foreground)" }}>Rating</span>
                        <span style={{ fontWeight: 600 }}>{ev.structuredFacts.rating.toUpperCase()}</span>
                      </>
                    )}
                    {ev.structuredFacts.target_price && (
                      <>
                        <span style={{ color: "var(--muted-foreground)" }}>Target</span>
                        <span style={{ fontWeight: 600 }}>
                          NOK {ev.structuredFacts.target_price}
                          {ev.structuredFacts.previous_target && (
                            <span style={{ color: "var(--muted-foreground)", fontWeight: 400 }}> (prev: {ev.structuredFacts.previous_target})</span>
                          )}
                        </span>
                      </>
                    )}
                    {ev.structuredFacts.beat_miss && (
                      <>
                        <span style={{ color: "var(--muted-foreground)" }}>Result</span>
                        <span style={{
                          fontWeight: 700,
                          color: ev.structuredFacts.beat_miss === "beat" ? "#22c55e" : ev.structuredFacts.beat_miss === "miss" ? "#ef4444" : "var(--foreground)",
                        }}>
                          {ev.structuredFacts.beat_miss.toUpperCase()}
                        </span>
                      </>
                    )}
                    {ev.structuredFacts.eps && (
                      <>
                        <span style={{ color: "var(--muted-foreground)" }}>EPS</span>
                        <span style={{ fontWeight: 600 }}>{ev.structuredFacts.eps}</span>
                      </>
                    )}
                    {ev.structuredFacts.revenue && (
                      <>
                        <span style={{ color: "var(--muted-foreground)" }}>Revenue</span>
                        <span style={{ fontWeight: 600 }}>{ev.structuredFacts.revenue}</span>
                      </>
                    )}
                    {ev.structuredFacts.key_quote && (
                      <>
                        <span style={{ color: "var(--muted-foreground)" }}>Quote</span>
                        <span style={{ fontStyle: "italic", color: "var(--muted-foreground)" }}>"{ev.structuredFacts.key_quote}"</span>
                      </>
                    )}
                  </div>
                )}

                {ev.summary && (
                  <p style={{ color: "var(--foreground)", lineHeight: 1.5, marginBottom: 8, margin: "0 0 8px 0" }}>
                    {ev.summary}
                  </p>
                )}

                <div style={{ display: "flex", gap: 12, fontSize: 9, color: "var(--muted-foreground)", flexWrap: "wrap" }}>
                  <span>SEV <strong style={{ color: sevColor }}>{ev.severity}/5</strong></span>
                  {ev.confidence !== null && <span>CONF <strong>{(ev.confidence * 100).toFixed(0)}%</strong></span>}
                  <span>{new Date(ev.publishedAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                  {ev.providerCode && <span>{ev.providerCode}</span>}
                  <span>{ev.source}</span>
                </div>

                {/* Tickers */}
                {ev.tickers && ev.tickers.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 3, marginTop: 6 }}>
                    {ev.tickers.map((t) => {
                      const d = DIR_SYM[t.direction] || DIR_SYM.neutral;
                      return (
                        <span key={t.ticker} style={{
                          fontSize: 9, fontWeight: 600, padding: "1px 5px", borderRadius: 2,
                          background: "rgba(255,255,255,0.06)", color: d.color,
                        }}>
                          {d.icon} {t.ticker}
                          {t.relevance !== null && <span style={{ opacity: 0.6, marginLeft: 3 }}>{(t.relevance * 100).toFixed(0)}%</span>}
                        </span>
                      );
                    })}
                  </div>
                )}

                {/* Sectors */}
                {ev.sectors && ev.sectors.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 3, marginTop: 4 }}>
                    {ev.sectors.map((s) => (
                      <span key={s.sector} style={{
                        fontSize: 9, padding: "1px 5px", borderRadius: 2,
                        background: "rgba(255,255,255,0.04)", color: "var(--muted-foreground)",
                      }}>
                        {s.sector}
                        {s.impact !== null && (
                          <span style={{ marginLeft: 3, color: s.impact > 0 ? "#22c55e" : "#ef4444", fontWeight: 600 }}>
                            {s.impact > 0 ? "+" : ""}{s.impact.toFixed(2)}
                          </span>
                        )}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
