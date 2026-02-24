"use client";

import { useEffect, useState } from "react";

/* ─── Types ────────────────────────────────────────────────────── */

type MoveNewsEvent = {
  id: number;
  publishedAt: string;
  headline: string;
  summary: string | null;
  eventType: string;
  severity: number;
  sentiment: number | null;
  confidence: number | null;
  source: string;
  providerCode: string | null;
  relevance: number | null;
  impactDirection: string;
};

type SignificantMove = {
  date: string;
  price: number;
  dailyReturn: number;
  zScore: number;
  direction: "up" | "down";
  newsEvents: MoveNewsEvent[];
  explained: boolean;
};

type ExplainResponse = {
  ticker: string;
  sigma: number;
  days: number;
  moves: SignificantMove[];
  totalMoves: number;
  explainedMoves: number;
  unexplainedMoves: number;
};

type WhyDidItMoveProps = {
  ticker: string;
  days?: number;
  sigma?: number;
};

/* ─── Constants ────────────────────────────────────────────────── */

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

/* ─── Component ────────────────────────────────────────────────── */

export default function WhyDidItMove({
  ticker,
  days = 30,
  sigma = 2,
}: WhyDidItMoveProps) {
  const [data, setData] = useState<ExplainResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  useEffect(() => {
    async function fetch_() {
      try {
        const res = await fetch(
          `/api/news/explain/${ticker}?days=${days}&sigma=${sigma}`,
          { cache: "no-store" }
        );
        if (!res.ok) throw new Error("Failed");
        setData(await res.json());
      } catch (err) {
        console.error("[WhyDidItMove]", err);
      } finally {
        setLoading(false);
      }
    }
    fetch_();
  }, [ticker, days, sigma]);

  if (loading) {
    return (
      <div
        style={{
          padding: 16,
          fontFamily: "monospace",
          fontSize: 12,
          color: "var(--muted-foreground)",
        }}
      >
        Analyzing significant moves...
      </div>
    );
  }

  if (!data || data.moves.length === 0) {
    return (
      <div
        style={{
          padding: 16,
          fontFamily: "monospace",
          fontSize: 12,
          color: "var(--muted-foreground)",
          border: "1px solid var(--border)",
          borderRadius: 4,
        }}
      >
        No significant moves ({`>${sigma}σ`}) found in the last {days} days.
      </div>
    );
  }

  return (
    <div style={{ fontFamily: "'Geist Mono', monospace", fontSize: 12 }}>
      {/* Summary bar */}
      <div
        style={{
          display: "flex",
          gap: 16,
          padding: "10px 12px",
          background: "rgba(255,255,255,0.03)",
          borderRadius: 4,
          border: "1px solid var(--border)",
          marginBottom: 12,
          fontSize: 11,
        }}
      >
        <div>
          <span style={{ color: "var(--muted-foreground)" }}>Moves </span>
          <span style={{ fontWeight: 700 }}>{data.totalMoves}</span>
        </div>
        <div>
          <span style={{ color: "var(--muted-foreground)" }}>Explained </span>
          <span style={{ fontWeight: 700, color: "#22c55e" }}>
            {data.explainedMoves}
          </span>
        </div>
        <div>
          <span style={{ color: "var(--muted-foreground)" }}>Unexplained </span>
          <span style={{ fontWeight: 700, color: "#f59e0b" }}>
            {data.unexplainedMoves}
          </span>
        </div>
        <div style={{ marginLeft: "auto", color: "var(--muted-foreground)" }}>
          {sigma}σ / {days}d
        </div>
      </div>

      {/* Move list */}
      {data.moves.map((move, idx) => {
        const isExpanded = expandedIdx === idx;
        const returnPct = (move.dailyReturn * 100).toFixed(2);
        const isUp = move.direction === "up";

        return (
          <div
            key={`${move.date}-${idx}`}
            style={{
              borderBottom: "1px solid var(--border)",
              padding: "10px 0",
              cursor: "pointer",
            }}
            onClick={() => setExpandedIdx(isExpanded ? null : idx)}
          >
            {/* Move row */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
              }}
            >
              {/* Direction arrow */}
              <span
                style={{
                  fontSize: 16,
                  fontWeight: 700,
                  color: isUp ? "#22c55e" : "#ef4444",
                  width: 20,
                  textAlign: "center",
                }}
              >
                {isUp ? "▲" : "▼"}
              </span>

              {/* Date */}
              <span
                style={{
                  color: "var(--muted-foreground)",
                  minWidth: 70,
                  fontSize: 11,
                }}
              >
                {new Date(move.date).toLocaleDateString("en-GB", {
                  day: "numeric",
                  month: "short",
                })}
              </span>

              {/* Return */}
              <span
                style={{
                  fontWeight: 700,
                  color: isUp ? "#22c55e" : "#ef4444",
                  minWidth: 60,
                }}
              >
                {isUp ? "+" : ""}
                {returnPct}%
              </span>

              {/* Z-score */}
              <span
                style={{
                  fontSize: 10,
                  color: "var(--muted-foreground)",
                  minWidth: 40,
                }}
              >
                {move.zScore.toFixed(1)}σ
              </span>

              {/* Price */}
              <span
                style={{
                  fontSize: 11,
                  color: "var(--muted-foreground)",
                  minWidth: 60,
                }}
              >
                {move.price.toFixed(2)}
              </span>

              {/* Explained status */}
              <span
                style={{
                  marginLeft: "auto",
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: "0.05em",
                  padding: "2px 6px",
                  borderRadius: 2,
                  textTransform: "uppercase",
                  background: move.explained
                    ? "rgba(34,197,94,0.12)"
                    : "rgba(245,158,11,0.12)",
                  color: move.explained ? "#22c55e" : "#f59e0b",
                }}
              >
                {move.explained
                  ? `${move.newsEvents.length} NEWS`
                  : "UNEXPLAINED"}
              </span>
            </div>

            {/* Expanded: show correlated news */}
            {isExpanded && move.newsEvents.length > 0 && (
              <div
                style={{
                  marginTop: 8,
                  marginLeft: 32,
                  padding: "8px 12px",
                  background: "rgba(255,255,255,0.03)",
                  borderRadius: 4,
                  border: "1px solid var(--border)",
                }}
              >
                {move.newsEvents.map((ne) => {
                  const typeColor =
                    EVENT_TYPE_COLORS[ne.eventType] || "#6b7280";
                  return (
                    <div
                      key={ne.id}
                      style={{
                        padding: "6px 0",
                        borderBottom: "1px solid rgba(255,255,255,0.04)",
                      }}
                    >
                      <div
                        style={{
                          color: "var(--foreground)",
                          lineHeight: 1.4,
                          marginBottom: 3,
                          fontSize: 11,
                        }}
                      >
                        {ne.headline}
                      </div>
                      <div
                        style={{
                          display: "flex",
                          gap: 6,
                          alignItems: "center",
                          fontSize: 9,
                        }}
                      >
                        <span
                          style={{
                            padding: "1px 4px",
                            borderRadius: 2,
                            background: `${typeColor}15`,
                            color: typeColor,
                            fontWeight: 600,
                            textTransform: "uppercase",
                          }}
                        >
                          {ne.eventType.replace(/_/g, " ")}
                        </span>
                        <span style={{ color: "var(--muted-foreground)" }}>
                          SEV {ne.severity}
                        </span>
                        {ne.sentiment !== null && (
                          <span
                            style={{
                              color:
                                ne.sentiment > 0 ? "#22c55e" : "#ef4444",
                              fontWeight: 600,
                            }}
                          >
                            {ne.sentiment > 0 ? "+" : ""}
                            {ne.sentiment.toFixed(2)}
                          </span>
                        )}
                        <span style={{ color: "var(--muted-foreground)" }}>
                          {new Date(ne.publishedAt).toLocaleString("en-GB", {
                            day: "numeric",
                            month: "short",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </div>
                      {ne.summary && (
                        <p
                          style={{
                            color: "var(--muted-foreground)",
                            fontSize: 10,
                            lineHeight: 1.5,
                            marginTop: 4,
                          }}
                        >
                          {ne.summary}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {isExpanded && !move.explained && (
              <div
                style={{
                  marginTop: 8,
                  marginLeft: 32,
                  padding: "8px 12px",
                  background: "rgba(245,158,11,0.06)",
                  borderRadius: 4,
                  border: "1px solid rgba(245,158,11,0.15)",
                  fontSize: 11,
                  color: "#f59e0b",
                }}
              >
                No correlated news events found within ±24 hours. This move
                may be technical (mean-reversion candidate) or driven by
                information not yet in the system.
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
