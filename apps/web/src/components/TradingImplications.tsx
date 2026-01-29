/**
 * TradingImplications Component
 *
 * Displays favorable/unfavorable strategies and catalysts based on regime
 */

import type { TradingImplication } from "@/lib/tradingImplications";

type TradingImplicationsProps = {
  implications: TradingImplication;
};

export default function TradingImplications({
  implications,
}: TradingImplicationsProps) {
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
        Trading Implications
      </h2>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          gap: 16,
        }}
      >
        {/* Favorable Strategies */}
        <div
          style={{
            padding: 20,
            borderRadius: 6,
            background: "var(--card-bg)",
            border: "1px solid var(--border)",
          }}
        >
          <div
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: "#22c55e",
              marginBottom: 12,
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <div
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: "#22c55e",
              }}
            />
            Favorable Strategies
          </div>
          <ul
            style={{
              margin: 0,
              padding: "0 0 0 20px",
              listStyleType: "disc",
            }}
          >
            {implications.favorable.map((strategy, index) => (
              <li
                key={index}
                style={{
                  fontSize: 13,
                  lineHeight: 1.6,
                  color: "var(--foreground)",
                  marginBottom: 8,
                }}
              >
                {strategy}
              </li>
            ))}
          </ul>
        </div>

        {/* Unfavorable Strategies */}
        <div
          style={{
            padding: 20,
            borderRadius: 6,
            background: "var(--card-bg)",
            border: "1px solid var(--border)",
          }}
        >
          <div
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: "#ef4444",
              marginBottom: 12,
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <div
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: "#ef4444",
              }}
            />
            Unfavorable Strategies
          </div>
          <ul
            style={{
              margin: 0,
              padding: "0 0 0 20px",
              listStyleType: "disc",
            }}
          >
            {implications.unfavorable.map((strategy, index) => (
              <li
                key={index}
                style={{
                  fontSize: 13,
                  lineHeight: 1.6,
                  color: "var(--foreground)",
                  marginBottom: 8,
                }}
              >
                {strategy}
              </li>
            ))}
          </ul>
        </div>

        {/* Catalysts to Monitor */}
        <div
          style={{
            padding: 20,
            borderRadius: 6,
            background: "var(--card-bg)",
            border: "1px solid var(--border)",
          }}
        >
          <div
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: "#3b82f6",
              marginBottom: 12,
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <div
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: "#3b82f6",
              }}
            />
            Catalysts to Monitor
          </div>
          <ul
            style={{
              margin: 0,
              padding: "0 0 0 20px",
              listStyleType: "disc",
            }}
          >
            {implications.catalysts.map((catalyst, index) => (
              <li
                key={index}
                style={{
                  fontSize: 13,
                  lineHeight: 1.6,
                  color: "var(--foreground)",
                  marginBottom: 8,
                }}
              >
                {catalyst}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
