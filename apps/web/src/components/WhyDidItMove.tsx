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
  url: string | null;
  relevance: number | null;
  impactDirection: string | null;
};

type InsiderTransaction = {
  personName: string;
  personRole: string;
  transactionType: string;
  shares: number;
  pricePerShare: number | null;
  totalValueNok: number | null;
  holdingsAfter: number | null;
  isRelatedParty: boolean;
  transactionDate: string;
  filingHeadline: string | null;
  filingUrl: string | null;
};

type ShortContext = {
  shortPct: number;
  prevShortPct: number;
  changePct: number;
  activePositions: number;
  significant: boolean;
};

type MarketContext = {
  obxReturn: number;
  isSystematic: boolean;
  obxMagnitude: number;
};

type CommodityContext = {
  symbol: string;
  returnPct: number;
  aligned: boolean;
};

type SignificantMove = {
  date: string;
  price: number;
  dailyReturn: number;
  zScore: number;
  direction: "up" | "down";
  newsEvents: MoveNewsEvent[];
  insiderTransactions: InsiderTransaction[];
  shortContext: ShortContext | null;
  marketContext: MarketContext | null;
  commodityContext: CommodityContext[];
  explained: boolean;
  contextLabels: string[];
  explainedBy: {
    news: boolean;
    insider: boolean;
    shortChange: boolean;
    systematic: boolean;
    commodity: boolean;
  };
};

type ExplainResponse = {
  ticker: string;
  sigma: number;
  days: number;
  moves: SignificantMove[];
  totalMoves: number;
  explainedMoves: number;
  unexplainedMoves: number;
  partiallyExplained: number;
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
  mandatory_notification: "#06b6d4",
  buyback: "#f59e0b",
  dividend: "#22c55e",
  management_change: "#8b5cf6",
  other: "#6b7280",
};

const COMMODITY_LABELS: Record<string, string> = {
  "BZ=F": "Brent",
  "CL=F": "WTI",
  "NG=F": "Nat Gas",
  "ALI=F": "Aluminum",
  "GC=F": "Gold",
  "SI=F": "Silver",
};

const fmtNok = (n: number) => {
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (Math.abs(n) >= 1e3) return `${(n / 1e3).toFixed(0)}k`;
  return n.toFixed(0);
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
          `/api/news/explain/${ticker}?days=${days}&sigma=${sigma}`
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
        {data.partiallyExplained > 0 && (
          <div>
            <span style={{ color: "var(--muted-foreground)" }}>Context </span>
            <span style={{ fontWeight: 700, color: "#3b82f6" }}>
              {data.partiallyExplained}
            </span>
          </div>
        )}
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
        const hasContext =
          move.marketContext?.isSystematic || move.commodityContext.length > 0;

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

              {/* Context badges */}
              <div
                style={{
                  marginLeft: "auto",
                  display: "flex",
                  gap: 4,
                  alignItems: "center",
                  flexWrap: "wrap",
                  justifyContent: "flex-end",
                }}
              >
                {move.contextLabels.map((label) => {
                  const color = getLabelColor(label);
                  return (
                    <span
                      key={label}
                      style={{
                        fontSize: 8,
                        fontWeight: 700,
                        letterSpacing: "0.04em",
                        padding: "2px 5px",
                        borderRadius: 2,
                        textTransform: "uppercase",
                        background: `${color}15`,
                        color,
                      }}
                    >
                      {label}
                    </span>
                  );
                })}
                {!move.explained && !hasContext && (
                  <span
                    style={{
                      fontSize: 8,
                      fontWeight: 700,
                      letterSpacing: "0.04em",
                      padding: "2px 5px",
                      borderRadius: 2,
                      textTransform: "uppercase",
                      background: "rgba(245,158,11,0.12)",
                      color: "#f59e0b",
                    }}
                  >
                    UNEXPLAINED
                  </span>
                )}
              </div>
            </div>

            {/* ── Expanded detail panel ── */}
            {isExpanded && (
              <div style={{ marginTop: 8, marginLeft: 32 }}>
                {/* News events */}
                {move.newsEvents.length > 0 && (
                  <div
                    style={{
                      padding: "8px 12px",
                      background: "rgba(255,255,255,0.03)",
                      borderRadius: 4,
                      border: "1px solid var(--border)",
                      marginBottom: 6,
                    }}
                  >
                    {move.newsEvents.map((ne) => {
                      const typeColor =
                        EVENT_TYPE_COLORS[ne.eventType] || "#6b7280";
                      return (
                        <div
                          key={`${ne.source}-${ne.id}`}
                          style={{
                            padding: "6px 0",
                            borderBottom:
                              "1px solid rgba(255,255,255,0.04)",
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
                            {ne.url ? (
                              <a
                                href={ne.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{
                                  color: "var(--foreground)",
                                  textDecoration: "none",
                                  borderBottom: "1px dotted var(--muted-foreground)",
                                }}
                                onClick={(e) => e.stopPropagation()}
                              >
                                {ne.headline}
                              </a>
                            ) : (
                              ne.headline
                            )}
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
                            {ne.source === "newsweb" && (
                              <span
                                style={{
                                  padding: "1px 4px",
                                  borderRadius: 2,
                                  background: "#06b6d415",
                                  color: "#06b6d4",
                                  fontWeight: 600,
                                }}
                              >
                                NW
                              </span>
                            )}
                            <span
                              style={{ color: "var(--muted-foreground)" }}
                            >
                              SEV {ne.severity}
                            </span>
                            {ne.sentiment !== null && (
                              <span
                                style={{
                                  color:
                                    ne.sentiment > 0
                                      ? "#22c55e"
                                      : "#ef4444",
                                  fontWeight: 600,
                                }}
                              >
                                {ne.sentiment > 0 ? "+" : ""}
                                {ne.sentiment.toFixed(2)}
                              </span>
                            )}
                            <span
                              style={{ color: "var(--muted-foreground)" }}
                            >
                              {new Date(ne.publishedAt).toLocaleString(
                                "en-GB",
                                {
                                  day: "numeric",
                                  month: "short",
                                  hour: "2-digit",
                                  minute: "2-digit",
                                }
                              )}
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

                {/* Insider transactions */}
                {move.insiderTransactions.length > 0 && (
                  <div
                    style={{
                      padding: "8px 12px",
                      background: "rgba(236,72,153,0.04)",
                      borderRadius: 4,
                      border: "1px solid rgba(236,72,153,0.15)",
                      marginBottom: 6,
                    }}
                  >
                    <div
                      style={{
                        fontSize: 9,
                        fontWeight: 700,
                        textTransform: "uppercase",
                        letterSpacing: "0.06em",
                        color: "#ec4899",
                        marginBottom: 6,
                      }}
                    >
                      Insider Transactions
                    </div>
                    {move.insiderTransactions.map((it, i) => {
                      const isBuy =
                        it.transactionType === "BUY" ||
                        it.transactionType === "EXERCISE";
                      return (
                        <div
                          key={i}
                          style={{
                            padding: "4px 0",
                            borderBottom:
                              "1px solid rgba(255,255,255,0.04)",
                            fontSize: 11,
                          }}
                        >
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "center",
                            }}
                          >
                            <span>
                              <span
                                style={{
                                  fontWeight: 700,
                                  color: isBuy
                                    ? "#22c55e"
                                    : "#ef4444",
                                  marginRight: 6,
                                }}
                              >
                                {it.transactionType}
                              </span>
                              <span
                                style={{
                                  color: "var(--foreground)",
                                }}
                              >
                                {it.personName}
                              </span>
                              {it.personRole && (
                                <span
                                  style={{
                                    color:
                                      "var(--muted-foreground)",
                                    marginLeft: 4,
                                    fontSize: 9,
                                  }}
                                >
                                  ({it.personRole})
                                </span>
                              )}
                            </span>
                            <span
                              style={{
                                fontWeight: 600,
                                color: "var(--foreground)",
                              }}
                            >
                              {it.shares.toLocaleString()} shares
                              {it.totalValueNok
                                ? ` · NOK ${fmtNok(it.totalValueNok)}`
                                : ""}
                            </span>
                          </div>
                          {it.filingUrl && (
                            <a
                              href={it.filingUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{
                                fontSize: 9,
                                color: "#06b6d4",
                                textDecoration: "none",
                              }}
                              onClick={(e) => e.stopPropagation()}
                            >
                              View filing →
                            </a>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Short position change */}
                {move.shortContext?.significant && (
                  <div
                    style={{
                      padding: "8px 12px",
                      background: "rgba(239,68,68,0.04)",
                      borderRadius: 4,
                      border: "1px solid rgba(239,68,68,0.15)",
                      marginBottom: 6,
                      fontSize: 11,
                    }}
                  >
                    <div
                      style={{
                        fontSize: 9,
                        fontWeight: 700,
                        textTransform: "uppercase",
                        letterSpacing: "0.06em",
                        color: "#ef4444",
                        marginBottom: 4,
                      }}
                    >
                      Short Position Change
                    </div>
                    <div
                      style={{
                        display: "flex",
                        gap: 16,
                        alignItems: "center",
                      }}
                    >
                      <span>
                        <span
                          style={{ color: "var(--muted-foreground)" }}
                        >
                          SI:{" "}
                        </span>
                        <span
                          style={{
                            fontWeight: 700,
                            color: "var(--foreground)",
                          }}
                        >
                          {move.shortContext.shortPct.toFixed(2)}%
                        </span>
                      </span>
                      <span
                        style={{
                          fontWeight: 700,
                          color:
                            move.shortContext.changePct > 0
                              ? "#ef4444"
                              : "#22c55e",
                        }}
                      >
                        {move.shortContext.changePct > 0 ? "+" : ""}
                        {move.shortContext.changePct.toFixed(2)}pp
                      </span>
                      <span
                        style={{
                          color: "var(--muted-foreground)",
                          fontSize: 10,
                        }}
                      >
                        {move.shortContext.activePositions} holder
                        {move.shortContext.activePositions !== 1
                          ? "s"
                          : ""}
                      </span>
                    </div>
                  </div>
                )}

                {/* Market context */}
                {move.marketContext && (
                  <div
                    style={{
                      padding: "6px 12px",
                      background: "rgba(99,102,241,0.04)",
                      borderRadius: 4,
                      border: "1px solid rgba(99,102,241,0.12)",
                      marginBottom: 6,
                      fontSize: 11,
                      display: "flex",
                      gap: 12,
                      alignItems: "center",
                    }}
                  >
                    <span
                      style={{
                        fontSize: 9,
                        fontWeight: 700,
                        textTransform: "uppercase",
                        letterSpacing: "0.06em",
                        color: "#6366f1",
                      }}
                    >
                      OBX
                    </span>
                    <span>
                      <span
                        style={{
                          fontWeight: 700,
                          color:
                            move.marketContext.obxReturn >= 0
                              ? "#22c55e"
                              : "#ef4444",
                        }}
                      >
                        {move.marketContext.obxReturn >= 0 ? "+" : ""}
                        {(move.marketContext.obxReturn * 100).toFixed(2)}%
                      </span>
                    </span>
                    {move.marketContext.isSystematic && (
                      <span
                        style={{
                          fontSize: 9,
                          color: "var(--muted-foreground)",
                        }}
                      >
                        Systematic move — market-wide
                      </span>
                    )}
                    {!move.marketContext.isSystematic && (
                      <span
                        style={{
                          fontSize: 9,
                          color: "var(--muted-foreground)",
                        }}
                      >
                        Idiosyncratic — stock-specific
                      </span>
                    )}
                  </div>
                )}

                {/* Commodity context */}
                {move.commodityContext.length > 0 && (
                  <div
                    style={{
                      padding: "6px 12px",
                      background: "rgba(245,158,11,0.04)",
                      borderRadius: 4,
                      border: "1px solid rgba(245,158,11,0.12)",
                      marginBottom: 6,
                      fontSize: 11,
                      display: "flex",
                      gap: 12,
                      alignItems: "center",
                      flexWrap: "wrap",
                    }}
                  >
                    <span
                      style={{
                        fontSize: 9,
                        fontWeight: 700,
                        textTransform: "uppercase",
                        letterSpacing: "0.06em",
                        color: "#f59e0b",
                      }}
                    >
                      Commodities
                    </span>
                    {move.commodityContext.map((c) => (
                      <span key={c.symbol}>
                        <span
                          style={{
                            color: "var(--muted-foreground)",
                            marginRight: 4,
                          }}
                        >
                          {COMMODITY_LABELS[c.symbol] || c.symbol}
                        </span>
                        <span
                          style={{
                            fontWeight: 700,
                            color:
                              c.returnPct >= 0 ? "#22c55e" : "#ef4444",
                          }}
                        >
                          {c.returnPct >= 0 ? "+" : ""}
                          {c.returnPct.toFixed(1)}%
                        </span>
                      </span>
                    ))}
                  </div>
                )}

                {/* Fully unexplained */}
                {!move.explained &&
                  !move.marketContext?.isSystematic &&
                  move.commodityContext.length === 0 && (
                    <div
                      style={{
                        padding: "8px 12px",
                        background: "rgba(245,158,11,0.06)",
                        borderRadius: 4,
                        border: "1px solid rgba(245,158,11,0.15)",
                        fontSize: 11,
                        color: "#f59e0b",
                      }}
                    >
                      No correlated events found. This move may be
                      technical (mean-reversion candidate) or driven by
                      information not yet in the system.
                    </div>
                  )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ─── Helpers ──────────────────────────────────────────────────── */

function getLabelColor(label: string): string {
  if (label.includes("NEWS")) return "#22c55e";
  if (label.includes("INSIDER")) return "#ec4899";
  if (label.includes("SHORT")) return "#ef4444";
  if (label.includes("MARKET")) return "#6366f1";
  if (label.includes("COMMODITY")) return "#f59e0b";
  return "#6b7280";
}
