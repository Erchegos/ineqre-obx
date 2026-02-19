"use client";

/**
 * TradingImplications Component
 *
 * Collapsible regime-adaptive trading implications.
 * Shows 1-line summary by default, expandable to full 3-column grid.
 */

import { useState } from "react";
import type { TradingImplication } from "@/lib/tradingImplications";
import { getRegimeColor, type VolatilityRegime } from "@/lib/regimeClassification";

type TradingImplicationsProps = {
  implications: TradingImplication;
  regime?: VolatilityRegime;
};

export default function TradingImplications({
  implications,
  regime,
}: TradingImplicationsProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const accentColor = regime ? getRegimeColor(regime) : "var(--muted-foreground)";

  // 1-line summary
  const summary = `Favorable: ${implications.favorable[0]} · Avoid: ${implications.unfavorable[0]}`;

  return (
    <div style={{ marginBottom: 24 }}>
      {/* Collapsible header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        style={{
          width: "100%",
          padding: "12px 16px",
          borderRadius: isExpanded ? "6px 6px 0 0" : 6,
          border: `1px solid ${accentColor}33`,
          borderLeft: `3px solid ${accentColor}`,
          background: "var(--card-bg)",
          color: "var(--foreground)",
          fontSize: 13,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          textAlign: "left",
          fontFamily: "monospace",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 0 }}>
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              color: accentColor,
              flexShrink: 0,
            }}
          >
            Trading Implications
          </span>
          {!isExpanded && (
            <span
              style={{
                color: "var(--muted-foreground)",
                fontSize: 12,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {summary}
            </span>
          )}
        </div>
        <span style={{ fontSize: 12, color: "var(--muted-foreground)", flexShrink: 0 }}>
          {isExpanded ? "▲" : "▼"}
        </span>
      </button>

      {/* Expanded content */}
      {isExpanded && (
        <div
          style={{
            border: `1px solid ${accentColor}33`,
            borderTop: "none",
            borderLeft: `3px solid ${accentColor}`,
            borderRadius: "0 0 6px 6px",
            background: "var(--card-bg)",
            padding: 16,
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
              gap: 16,
            }}
          >
            <ImplicationColumn
              title="Favorable Strategies"
              items={implications.favorable}
              color="#4CAF50"
            />
            <ImplicationColumn
              title="Unfavorable Strategies"
              items={implications.unfavorable}
              color="#F44336"
            />
            <ImplicationColumn
              title="Catalysts to Monitor"
              items={implications.catalysts}
              color="#2196F3"
            />
          </div>
        </div>
      )}
    </div>
  );
}

function ImplicationColumn({ title, items, color }: {
  title: string;
  items: string[];
  color: string;
}) {
  return (
    <div>
      <div
        style={{
          fontSize: 12,
          fontWeight: 700,
          color,
          marginBottom: 10,
          display: "flex",
          alignItems: "center",
          gap: 6,
          fontFamily: "monospace",
        }}
      >
        <div
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: color,
          }}
        />
        {title}
      </div>
      <ul
        style={{
          margin: 0,
          padding: "0 0 0 16px",
          listStyleType: "disc",
        }}
      >
        {items.map((item, i) => (
          <li
            key={i}
            style={{
              fontSize: 12,
              lineHeight: 1.6,
              color: "var(--foreground)",
              marginBottom: 4,
            }}
          >
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}
