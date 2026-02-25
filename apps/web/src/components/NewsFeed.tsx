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
  dayReturnPct?: number | null;
  priceClose?: number | null;
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

const TYPE_LABEL: Record<string, { label: string; color: string }> = {
  earnings: { label: "Earnings", color: "#22c55e" },
  guidance: { label: "Guidance", color: "#3b82f6" },
  analyst_action: { label: "Analyst", color: "#a855f7" },
  corporate_action: { label: "Corporate", color: "#f59e0b" },
  insider_trade: { label: "Insider", color: "#ec4899" },
  regulatory: { label: "Regulatory", color: "#06b6d4" },
  macro: { label: "Macro", color: "#6366f1" },
  geopolitical: { label: "Geopolitical", color: "#ef4444" },
  sector_news: { label: "Sector", color: "#14b8a6" },
  mandatory_notification: { label: "Filing", color: "#06b6d4" },
  buyback: { label: "Buyback", color: "#f59e0b" },
  dividend: { label: "Dividend", color: "#22c55e" },
  management_change: { label: "Mgmt", color: "#8b5cf6" },
};

/* ─── Helpers ──────────────────────────────────────────────────── */

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/** Format NOK amount (e.g., 2400000 -> "NOK 2.4M") */
function fmtNOK(v: number | null | undefined): string | null {
  if (!v) return null;
  if (v >= 1_000_000_000) return `NOK ${(v / 1_000_000_000).toFixed(1)}B`;
  if (v >= 1_000_000) return `NOK ${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `NOK ${(v / 1_000).toFixed(0)}K`;
  return `NOK ${v.toFixed(0)}`;
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
    if (f.shares_traded) parts.push(`${f.shares_traded.toLocaleString("en-US")} shares`);
    if (f.person_name) {
      const role = f.person_role ? ` (${f.person_role})` : "";
      parts.push(`${f.person_name}${role}`);
    }
    return parts.length > 0 ? parts.join(" · ") : null;
  }

  if (ev.eventType === "corporate_action") {
    const parts: string[] = [];
    if (f.action_type) parts.push(f.action_type.toUpperCase());
    if (f.shares_count) parts.push(`${f.shares_count.toLocaleString("en-US")} shares`);
    const val = fmtNOK(f.total_value_nok);
    if (val) parts.push(val);
    if (f.dividend_per_share) parts.push(`NOK ${f.dividend_per_share}/share`);
    if (f.ex_date) parts.push(`Ex: ${f.ex_date}`);
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
    // Remove ticker prefix like "STOREBRAND ASA:" or "DNB BANK ASA:"
    .replace(/^[A-Z][A-Za-z\s]{2,30}(ASA|AS|NV|Ltd|AB):\s*/i, "")
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
    return (
      <div style={{ padding: compact ? 8 : 16, fontFamily: "'Geist Mono', monospace" }}>
        <div style={{ fontSize: 11, color: "var(--muted-foreground)", marginBottom: 6 }}>
          No news events{ticker ? ` for ${ticker}` : ""} in the last 90 days.
        </div>
        {ticker && (
          <div style={{ fontSize: 9, color: "var(--muted-foreground)", opacity: 0.6, lineHeight: 1.5 }}>
            Sources: IBKR (Dow Jones, Briefing, FlyOnTheWall) + Oslo Bors NewsWeb (regulatory filings). Coverage varies by ticker.
          </div>
        )}
      </div>
    );
  }

  const eventCount = events.length;

  return (
    <div style={{ fontFamily: "'Geist Mono', monospace", fontSize: compact ? 10 : 11 }}>
      {events.map((ev) => {
        const isExpanded = expandedId === ev.id;
        const sevColor = SEV_COLOR[ev.severity] || "#6b7280";
        const typeInfo = TYPE_LABEL[ev.eventType];
        const headline = cleanHeadline(ev.headline);
        const facts = factLine(ev);
        const hasSummary = ev.summary && ev.summary.length > 5;
        const summaryPreview = hasSummary
          ? (ev.summary!.length > 140 ? ev.summary!.slice(0, 137) + "..." : ev.summary!)
          : null;
        const returnPct = ev.dayReturnPct;

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
            {/* Main row */}
            <div style={{ display: "flex", alignItems: "flex-start", gap: compact ? 4 : 8 }}>
              {/* Severity bar */}
              <div style={{ width: 2, minHeight: compact ? 14 : 18, background: sevColor, borderRadius: 1, marginTop: 2, flexShrink: 0 }} />

              {/* Date */}
              <span style={{ fontSize: compact ? 9 : 10, color: "var(--muted-foreground)", minWidth: compact ? 28 : 40, flexShrink: 0, marginTop: 1 }}>
                {formatDate(ev.publishedAt)}
              </span>

              {/* Content */}
              <div style={{ flex: 1, minWidth: 0 }}>
                {/* Headline — clickable link if URL exists */}
                {ev.url ? (
                  <a
                    href={ev.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    style={{
                      color: "var(--foreground)", fontWeight: 500, lineHeight: 1.35,
                      textDecoration: "none", display: "block",
                      ...(compact && !isExpanded ? { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const } : {}),
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.color = "var(--accent)")}
                    onMouseLeave={(e) => (e.currentTarget.style.color = "var(--foreground)")}
                  >
                    {compact && headline.length > 65 ? headline.slice(0, 62) + "..." : headline}
                  </a>
                ) : (
                  <span style={{
                    color: "var(--foreground)", fontWeight: 500, lineHeight: 1.35,
                    ...(compact && !isExpanded ? { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const, display: "block" } : {}),
                  }}>
                    {compact && headline.length > 65 ? headline.slice(0, 62) + "..." : headline}
                  </span>
                )}

                {/* Summary preview (always visible, below headline) */}
                {summaryPreview && !compact && (
                  <div style={{
                    fontSize: 10, color: "var(--muted-foreground)", lineHeight: 1.4,
                    marginTop: 2, opacity: 0.75,
                  }}>
                    {summaryPreview}
                  </div>
                )}

                {/* Structured facts line (KEY DATA — insider trades, earnings, etc.) */}
                {facts && (
                  <div style={{
                    fontSize: compact ? 9 : 10,
                    fontWeight: 600,
                    color: ev.eventType === "insider_trade" ? "#ec4899" :
                           ev.eventType === "corporate_action" ? "#f59e0b" :
                           ev.eventType === "earnings" ? "#22c55e" :
                           ev.eventType === "analyst_action" ? "#a855f7" :
                           "var(--muted-foreground)",
                    marginTop: 2,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap" as const,
                  }}>
                    {facts}
                  </div>
                )}

                {/* Inline metadata — only event type (if not "other") + price move */}
                <div style={{ display: "flex", gap: 6, marginTop: 3, flexWrap: "wrap", alignItems: "center" }}>
                  {/* Event type — only show meaningful types */}
                  {typeInfo && (
                    <span style={{
                      fontSize: 8.5, fontWeight: 600, padding: "1px 5px", borderRadius: 2,
                      background: `${typeInfo.color}15`, color: typeInfo.color,
                      letterSpacing: "0.02em",
                    }}>
                      {typeInfo.label}
                    </span>
                  )}

                  {/* NewsWeb source badge */}
                  {ev.source === "newsweb" && (
                    <span style={{
                      fontSize: 8, fontWeight: 600, padding: "1px 4px", borderRadius: 2,
                      background: "#06b6d415", color: "#06b6d4",
                    }}>
                      NW
                    </span>
                  )}

                  {/* Stock % move on event date */}
                  {returnPct != null && (
                    <span style={{
                      fontSize: 9.5, fontWeight: 700, fontFamily: "monospace",
                      color: returnPct > 0 ? "#22c55e" : returnPct < 0 ? "#ef4444" : "var(--muted-foreground)",
                    }}>
                      {returnPct > 0 ? "+" : ""}{returnPct.toFixed(2)}%
                    </span>
                  )}

                  {/* Ticker pills (only in non-ticker-specific mode) */}
                  {!ticker && ev.tickers?.slice(0, 3).map((t) => (
                    <span key={t.ticker} style={{
                      fontSize: 8.5, fontWeight: 600, padding: "1px 5px", borderRadius: 2,
                      background: "rgba(255,255,255,0.06)", color: "var(--muted-foreground)",
                    }}>
                      {t.ticker}
                    </span>
                  ))}
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
                marginTop: 6, marginLeft: compact ? 30 : 50,
                padding: "10px 12px", background: "rgba(255,255,255,0.03)",
                borderRadius: 4, border: "1px solid var(--border)", fontSize: compact ? 10 : 11,
              }}>
                {/* Full summary */}
                {ev.summary && ev.summary.length > 5 && (
                  <p style={{ color: "var(--foreground)", lineHeight: 1.55, margin: "0 0 10px 0", fontSize: 11 }}>
                    {ev.summary}
                  </p>
                )}

                {/* Structured facts detail (full display) */}
                {ev.structuredFacts && Object.values(ev.structuredFacts).some(v => v !== null) && (
                  <div style={{
                    display: "grid",
                    gridTemplateColumns: "auto 1fr",
                    gap: "3px 14px",
                    marginBottom: 10,
                    fontSize: 10,
                    padding: "8px 10px",
                    background: "rgba(255,255,255,0.02)",
                    borderRadius: 3,
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

                {/* Footer metadata */}
                <div style={{ display: "flex", gap: 10, fontSize: 9, color: "var(--muted-foreground)", flexWrap: "wrap", alignItems: "center" }}>
                  <span>{new Date(ev.publishedAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                  {ev.source && <span>{ev.source}</span>}
                  {ev.providerCode && <span style={{ opacity: 0.6 }}>{ev.providerCode}</span>}
                  {ev.severity >= 3 && <span>SEV <strong style={{ color: sevColor }}>{ev.severity}/5</strong></span>}
                  {returnPct != null && (
                    <span>
                      Day move: <strong style={{ color: returnPct > 0 ? "#22c55e" : returnPct < 0 ? "#ef4444" : "var(--foreground)" }}>
                        {returnPct > 0 ? "+" : ""}{returnPct.toFixed(2)}%
                      </strong>
                      {ev.priceClose != null && <span style={{ opacity: 0.6 }}> (NOK {ev.priceClose.toFixed(2)})</span>}
                    </span>
                  )}
                  {ev.url && (
                    <a
                      href={ev.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      style={{ color: "var(--accent)", textDecoration: "none", fontWeight: 600 }}
                      onMouseEnter={(e) => (e.currentTarget.style.textDecoration = "underline")}
                      onMouseLeave={(e) => (e.currentTarget.style.textDecoration = "none")}
                    >
                      Source
                    </a>
                  )}
                </div>

                {/* Tickers (expanded only, non-ticker mode) */}
                {!ticker && ev.tickers && ev.tickers.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 8 }}>
                    {ev.tickers.map((t) => (
                      <span key={t.ticker} style={{
                        fontSize: 9, fontWeight: 600, padding: "2px 6px", borderRadius: 3,
                        background: "rgba(255,255,255,0.06)", color: "var(--foreground)",
                      }}>
                        {t.ticker}
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
      {/* Source attribution */}
      {compact && eventCount > 0 && (
        <div style={{ padding: "6px 0 2px", fontSize: 8, color: "var(--muted-foreground)", opacity: 0.5, textAlign: "right" }}>
          {eventCount} article{eventCount !== 1 ? "s" : ""} · IBKR · NW
        </div>
      )}
    </div>
  );
}
