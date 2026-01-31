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
        Market Co-Movement Analysis
      </h2>

      <div
        style={{
          padding: 20,
          borderRadius: 6,
          background: "var(--card-bg)",
          border: "1px solid var(--border)",
        }}
      >
        {/* Summary Metrics */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))",
            gap: 20,
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
              Beta to OBX
            </div>
            <div
              style={{
                fontSize: 32,
                fontWeight: 700,
                fontFamily: "monospace",
                color: "var(--foreground)",
                marginBottom: 8,
              }}
            >
              {betaText}
            </div>
            <div
              style={{
                fontSize: 13,
                color: "var(--muted-foreground)",
                lineHeight: 1.5,
              }}
            >
              {beta !== null
                ? Math.abs(beta) < 0.2
                  ? `When OBX ${beta >= 0 ? 'rises' : 'falls'} 1%, this stock ${beta >= 0 ? 'rises' : 'falls'} ${Math.abs(beta * 100).toFixed(2)}%. Price moves ${beta < 0 ? 'opposite to' : 'with'} market but independently.`
                  : Math.abs(beta) < 0.6
                  ? `When OBX ${beta >= 0 ? 'rises' : 'falls'} 1%, this stock ${beta >= 0 ? 'rises' : 'falls'} ${Math.abs(beta * 100).toFixed(2)}%. Moderate market sensitivity.`
                  : `When OBX ${beta >= 0 ? 'rises' : 'falls'} 1%, this stock ${beta >= 0 ? 'rises' : 'falls'} ${Math.abs(beta * 100).toFixed(2)}%. High market sensitivity.`
                : "Insufficient data to calculate"}
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
              Average Correlation
            </div>
            <div
              style={{
                fontSize: 32,
                fontWeight: 700,
                fontFamily: "monospace",
                color: "var(--foreground)",
                marginBottom: 8,
              }}
            >
              {correlationText}
            </div>
            <div
              style={{
                fontSize: 13,
                color: "var(--muted-foreground)",
                lineHeight: 1.5,
              }}
            >
              {Math.abs(avgCorrelation) < 0.2
                ? `Stock returns ${avgCorrelation < 0 ? 'weakly move opposite to' : 'barely follow'} market returns. Price driven by company-specific factors.`
                : Math.abs(avgCorrelation) < 0.5
                ? `Stock returns ${avgCorrelation < 0 ? 'somewhat move opposite to' : 'partially follow'} market returns. Mixed market and company influence.`
                : `Stock returns ${avgCorrelation < 0 ? 'strongly move opposite to' : 'closely follow'} market returns. Market sentiment drives price.`}
            </div>
          </div>
        </div>

        {/* Interpretation Guide */}
        <div
          style={{
            padding: 16,
            borderRadius: 6,
            background: "var(--background)",
            border: "1px solid var(--border)",
            marginBottom: 20,
          }}
        >
          <h3
            style={{
              fontSize: 13,
              fontWeight: 700,
              color: "var(--foreground)",
              marginBottom: 8,
            }}
          >
            How to Read These Metrics
          </h3>
          <div
            style={{
              fontSize: 13,
              color: "var(--muted-foreground)",
              lineHeight: 1.6,
            }}
          >
            <strong style={{ color: "var(--foreground)" }}>Beta</strong> measures magnitude: how much the stock moves per 1% market move.{" "}
            <strong style={{ color: "var(--foreground)" }}>Correlation</strong> measures consistency: how reliably stock and market move together.
            {beta !== null && Math.abs(avgCorrelation) > 0.01 && (
              <>
                {" "}This stock is{" "}
                {Math.abs(beta / avgCorrelation) > 1.5
                  ? `${((Math.abs(beta / avgCorrelation) - 1) * 100).toFixed(0)}% more volatile than OBX`
                  : Math.abs(beta / avgCorrelation) < 0.7
                  ? `${((1 - Math.abs(beta / avgCorrelation)) * 100).toFixed(0)}% less volatile than OBX`
                  : "similarly volatile to OBX"}.
              </>
            )}
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
