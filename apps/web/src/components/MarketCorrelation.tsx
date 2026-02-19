"use client";

/**
 * MarketCorrelation Component
 *
 * Compact market sensitivity panel. Shows beta, systematic/idiosyncratic
 * breakdown, portfolio implications. Collapsible detailed chart.
 */

import { useState } from "react";
import VolatilityCorrelationChart from "./VolatilityCorrelationChart";

type MarketCorrelationProps = {
  beta: number | null;
  avgCorrelation: number;
  portfolioImplications: string[];
  stockData: any[];
  marketData: any[];
};

export default function MarketCorrelation({
  beta,
  avgCorrelation,
  portfolioImplications,
  stockData,
  marketData,
}: MarketCorrelationProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const absBeta = beta !== null ? Math.abs(beta) : 0;
  const systematicPct = beta !== null ? Math.min(Math.round(beta * beta * 100), 100) : null;
  const idiosyncraticPct = systematicPct !== null ? 100 - systematicPct : null;

  const betaLabel = absBeta < 0.2
    ? "Low → Idiosyncratic"
    : absBeta < 0.6
    ? "Moderate → Mixed"
    : "High → Market-driven";

  const diversificationNote = absBeta < 0.3
    ? "Strong diversification benefit"
    : absBeta < 0.7
    ? "Moderate diversification"
    : "Limited diversification (high β)";

  return (
    <div style={{ marginBottom: 32 }}>
      <h2
        style={{
          fontSize: 16,
          fontWeight: 700,
          marginBottom: 12,
          color: "var(--foreground)",
          fontFamily: "monospace",
          letterSpacing: "0.02em",
        }}
      >
        Market Sensitivity
      </h2>

      <div
        style={{
          padding: 20,
          borderRadius: 6,
          background: "var(--card-bg)",
          border: "1px solid var(--border)",
        }}
      >
        {/* Compact metrics */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "auto 1fr",
            gap: "6px 20px",
            fontSize: 13,
            fontFamily: "monospace",
            marginBottom: 16,
          }}
        >
          <span style={{ color: "var(--muted-foreground)", fontSize: 12 }}>Beta to OBX:</span>
          <span style={{ fontWeight: 700, color: "var(--foreground)" }}>
            {beta !== null ? beta.toFixed(3) : "N/A"}
            <span style={{ fontWeight: 400, color: "var(--muted-foreground)", fontSize: 11, marginLeft: 8 }}>
              {betaLabel}
            </span>
          </span>

          {systematicPct !== null && (
            <>
              <span style={{ color: "var(--muted-foreground)", fontSize: 12 }}>Systematic risk:</span>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{
                  flex: 1,
                  maxWidth: 200,
                  height: 6,
                  background: "var(--border)",
                  borderRadius: 3,
                  overflow: "hidden",
                }}>
                  <div style={{
                    width: `${systematicPct}%`,
                    height: "100%",
                    background: "#3b82f6",
                    borderRadius: 3,
                  }} />
                </div>
                <span style={{ fontSize: 12, color: "var(--foreground)" }}>
                  {systematicPct}% systematic / {idiosyncraticPct}% idiosyncratic
                </span>
              </div>
            </>
          )}

          <span style={{ color: "var(--muted-foreground)", fontSize: 12 }}>Avg Correlation:</span>
          <span style={{ color: "var(--foreground)" }}>{avgCorrelation.toFixed(3)}</span>

          <span style={{ color: "var(--muted-foreground)", fontSize: 12 }}>Diversification:</span>
          <span style={{ color: "var(--muted-foreground)", fontSize: 12 }}>{diversificationNote}</span>
        </div>

        {/* Portfolio implications as compact list */}
        <div style={{ marginBottom: 16 }}>
          {portfolioImplications.map((imp, i) => (
            <div
              key={i}
              style={{
                fontSize: 12,
                lineHeight: 1.5,
                color: "var(--muted-foreground)",
                paddingLeft: 12,
                borderLeft: "2px solid var(--border)",
                marginBottom: 4,
              }}
            >
              {imp}
            </div>
          ))}
        </div>

        {/* Toggle for detailed chart */}
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          style={{
            width: "100%",
            padding: "10px 14px",
            borderRadius: 4,
            border: "1px solid var(--border)",
            background: "var(--background)",
            color: "var(--foreground)",
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            fontFamily: "monospace",
            transition: "all 0.15s",
          }}
          onMouseOver={(e) => { e.currentTarget.style.background = "var(--hover-bg)"; }}
          onMouseOut={(e) => { e.currentTarget.style.background = "var(--background)"; }}
        >
          {isExpanded ? "Hide" : "Show"} Rolling Correlation Chart
          <span style={{ fontSize: 14 }}>{isExpanded ? "▲" : "▼"}</span>
        </button>

        {isExpanded && (
          <div style={{ marginTop: 16 }}>
            <VolatilityCorrelationChart
              stockData={stockData}
              marketData={marketData}
            />
          </div>
        )}
      </div>
    </div>
  );
}
