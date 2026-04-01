"use client";

import FlowRegimeBadge from "./FlowRegimeBadge";

type TickerSignal = {
  ticker: string;
  vpin: number;
  vpinPercentile: number;
  kyleLambda: number;
  ofiCumulative: number;
  ofi5m: number;
  toxicity: number;
  regime: string;
  spreadRegime: string;
  icebergsToday: number;
  price: number;
  changePct: number;
  ts: string;
};

type SortKey = "vpin" | "ofi" | "toxicity" | "change";

function vpinGradient(v: number): string {
  if (v >= 0.7) return "rgba(239,68,68,0.12)";
  if (v >= 0.5) return "rgba(245,158,11,0.08)";
  return "rgba(16,185,129,0.06)";
}

function vpinBarColor(v: number): string {
  if (v >= 0.7) return "#ef4444";
  if (v >= 0.5) return "#f59e0b";
  return "#00e5ff";
}

export default function FlowHeatmap({
  tickers,
  sortBy,
  onSortChange,
  onTickerClick,
}: {
  tickers: TickerSignal[];
  sortBy: SortKey;
  onSortChange: (key: SortKey) => void;
  onTickerClick: (ticker: string) => void;
}) {
  const sorted = [...tickers].sort((a, b) => {
    switch (sortBy) {
      case "vpin":
        return (b.vpin || 0) - (a.vpin || 0);
      case "ofi":
        return Math.abs(b.ofiCumulative || 0) - Math.abs(a.ofiCumulative || 0);
      case "toxicity":
        return (b.toxicity || 0) - (a.toxicity || 0);
      case "change":
        return Math.abs(b.changePct || 0) - Math.abs(a.changePct || 0);
      default:
        return 0;
    }
  });

  const sortButtons: { key: SortKey; label: string }[] = [
    { key: "vpin", label: "VPIN" },
    { key: "ofi", label: "OFI" },
    { key: "toxicity", label: "TOXICITY" },
    { key: "change", label: "CHANGE" },
  ];

  return (
    <div>
      <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
        {sortButtons.map((btn) => (
          <button
            key={btn.key}
            onClick={() => onSortChange(btn.key)}
            style={{
              padding: "4px 10px",
              borderRadius: 4,
              fontSize: 9,
              fontWeight: 700,
              fontFamily: "monospace",
              letterSpacing: "0.06em",
              border: `1px solid ${sortBy === btn.key ? "#00e5ff" : "#30363d"}`,
              background: sortBy === btn.key ? "rgba(0,229,255,0.1)" : "#0d1117",
              color: sortBy === btn.key ? "#00e5ff" : "rgba(255,255,255,0.5)",
              cursor: "pointer",
            }}
          >
            {btn.label}
          </button>
        ))}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
          gap: 10,
        }}
      >
        {sorted.map((t) => (
          <div
            key={t.ticker}
            onClick={() => onTickerClick(t.ticker)}
            style={{
              background: vpinGradient(t.vpin || 0),
              border: "1px solid #30363d",
              borderRadius: 6,
              padding: "14px 16px",
              cursor: "pointer",
              transition: "all 0.2s ease",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLDivElement).style.borderColor = "#00e5ff";
              (e.currentTarget as HTMLDivElement).style.transform = "translateY(-2px)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLDivElement).style.borderColor = "#30363d";
              (e.currentTarget as HTMLDivElement).style.transform = "translateY(0)";
            }}
          >
            {/* Header */}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 10,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span
                  style={{
                    fontSize: 14,
                    fontWeight: 800,
                    color: "#fff",
                    fontFamily: "monospace",
                  }}
                >
                  {t.ticker}
                </span>
                <FlowRegimeBadge regime={t.regime || "neutral"} />
              </div>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  color: (t.changePct || 0) >= 0 ? "#10b981" : "#ef4444",
                  fontFamily: "monospace",
                }}
              >
                {(t.changePct || 0) >= 0 ? "+" : ""}
                {(t.changePct || 0).toFixed(2)}%
              </div>
            </div>

            {/* VPIN Bar */}
            <div style={{ marginBottom: 8 }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: 9,
                  color: "rgba(255,255,255,0.5)",
                  marginBottom: 3,
                  fontFamily: "monospace",
                }}
              >
                <span>VPIN</span>
                <span style={{ color: vpinBarColor(t.vpin || 0), fontWeight: 700 }}>
                  {(t.vpin || 0).toFixed(3)}
                </span>
              </div>
              <div
                style={{
                  height: 4,
                  background: "#21262d",
                  borderRadius: 2,
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: `${Math.min((t.vpin || 0) * 100, 100)}%`,
                    background: vpinBarColor(t.vpin || 0),
                    borderRadius: 2,
                    transition: "width 0.5s ease",
                  }}
                />
              </div>
            </div>

            {/* OFI Arrow + Metrics Row */}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                fontSize: 10,
                fontFamily: "monospace",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{ fontSize: 14, color: (t.ofiCumulative || 0) >= 0 ? "#10b981" : "#ef4444" }}>
                  {(t.ofiCumulative || 0) >= 0 ? "▲" : "▼"}
                </span>
                <span style={{ color: "rgba(255,255,255,0.6)" }}>
                  OFI {((t.ofiCumulative || 0) / 1000).toFixed(1)}K
                </span>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <span style={{ color: "rgba(255,255,255,0.4)" }}>
                  λ {(t.kyleLambda || 0).toFixed(4)}
                </span>
                {t.icebergsToday > 0 && (
                  <span style={{ color: "#f59e0b" }}>
                    🧊 {t.icebergsToday}
                  </span>
                )}
              </div>
            </div>

            {/* Price */}
            <div
              style={{
                marginTop: 6,
                fontSize: 11,
                color: "rgba(255,255,255,0.4)",
                fontFamily: "monospace",
                textAlign: "right",
              }}
            >
              {t.price > 0 ? t.price.toFixed(2) : "—"}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
