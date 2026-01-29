"use client";

/**
 * MethodologySection Component
 *
 * Collapsible section containing technical estimator details and methodology
 */

import { ReactNode } from "react";

type MethodologySectionProps = {
  isExpanded: boolean;
  onToggle: () => void;
  children: ReactNode;
};

export default function MethodologySection({
  isExpanded,
  onToggle,
  children,
}: MethodologySectionProps) {
  return (
    <div style={{ marginBottom: 40 }}>
      {/* Toggle Button */}
      <button
        onClick={onToggle}
        style={{
          width: "100%",
          padding: "16px 20px",
          borderRadius: 6,
          border: "1px solid var(--border)",
          background: isExpanded ? "var(--card-bg)" : "var(--background)",
          color: "var(--foreground)",
          fontSize: 16,
          fontWeight: 600,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          transition: "all 0.15s",
        }}
        onMouseOver={(e) => {
          if (!isExpanded) {
            e.currentTarget.style.background = "var(--hover-bg)";
          }
        }}
        onMouseOut={(e) => {
          if (!isExpanded) {
            e.currentTarget.style.background = "var(--background)";
          }
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span>Advanced: Volatility Estimators & Methodology</span>
          <span
            style={{
              fontSize: 11,
              fontWeight: 400,
              color: "var(--muted)",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            {isExpanded ? "Click to collapse" : "Click to expand technical details"}
          </span>
        </div>
        <span style={{ fontSize: 20 }}>{isExpanded ? "▲" : "▼"}</span>
      </button>

      {/* Collapsible Content */}
      {isExpanded && (
        <div
          style={{
            marginTop: 16,
            padding: 24,
            borderRadius: 6,
            background: "rgba(0, 0, 0, 0.02)",
            border: "1px solid var(--border-subtle)",
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}
