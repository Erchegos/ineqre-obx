"use client";

/**
 * MarketCorrelation Component
 *
 * Simplified correlation section with summary metrics and collapsible detailed chart
 */

import { useState } from "react";
import VolatilityCorrelationChart from "./VolatilityCorrelationChart";

type MarketCorrelationProps = {
  beta: number | null;
  avgCorrelation: number;
  portfolioImplications: string[];
  stockData: any[]; // API returns series with optional properties
  marketData: any[]; // API returns series with optional properties
};

export default function MarketCorrelation({
  beta,
  avgCorrelation,
  portfolioImplications,
  stockData,
  marketData,
}: MarketCorrelationProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const betaText = beta !== null ? beta.toFixed(3) : "N/A";
  const correlationText = avgCorrelation.toFixed(3);

  return (
    <div style={{ marginBottom: 40 }}>
      <h2
        style={{
          fontSize: 20,
          fontWeight: 600,
          marginBottom: 16,
          color: "var(--foreground)",
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
        {/* Beta Display */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 24,
            marginBottom: 20,
          }}
        >
          <div>
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                color: "var(--muted)",
                marginBottom: 8,
              }}
            >
              Stock Beta
            </div>
            <div
              style={{
                fontSize: 48,
                fontWeight: 700,
                fontFamily: "monospace",
                color: "var(--foreground)",
              }}
            >
              {betaText}
            </div>
          </div>
          <div>
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                color: "var(--muted)",
                marginBottom: 8,
              }}
            >
              Index Beta (OBX)
            </div>
            <div
              style={{
                fontSize: 48,
                fontWeight: 700,
                fontFamily: "monospace",
                color: "var(--foreground)",
              }}
            >
              1.000
            </div>
          </div>
        </div>

        {/* Portfolio Implications */}
        <div style={{ marginBottom: 20 }}>
          <h3
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: "var(--foreground)",
              marginBottom: 12,
            }}
          >
            Portfolio Implications
          </h3>
          <ul
            style={{
              margin: 0,
              padding: "0 0 0 20px",
              listStyleType: "disc",
            }}
          >
            {portfolioImplications.map((implication, index) => (
              <li
                key={index}
                style={{
                  fontSize: 13,
                  lineHeight: 1.6,
                  color: "var(--foreground)",
                  marginBottom: 6,
                }}
              >
                {implication}
              </li>
            ))}
          </ul>
        </div>

        {/* Toggle for Detailed Chart */}
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          style={{
            width: "100%",
            padding: "12px 16px",
            borderRadius: 4,
            border: "1px solid var(--border)",
            background: "var(--background)",
            color: "var(--foreground)",
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            transition: "all 0.15s",
          }}
          onMouseOver={(e) => {
            e.currentTarget.style.background = "var(--hover-bg)";
          }}
          onMouseOut={(e) => {
            e.currentTarget.style.background = "var(--background)";
          }}
        >
          {isExpanded ? "Hide" : "Show"} Detailed Correlation Chart
          <span style={{ fontSize: 16 }}>{isExpanded ? "▲" : "▼"}</span>
        </button>

        {/* Collapsible Detailed Chart */}
        {isExpanded && (
          <div style={{ marginTop: 20 }}>
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
