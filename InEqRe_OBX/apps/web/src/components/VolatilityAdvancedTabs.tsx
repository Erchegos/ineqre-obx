"use client";

/**
 * VolatilityAdvancedTabs Component
 *
 * Tabbed interface for advanced methodology:
 *   Estimators | GARCH Parameters | Regime Model | VaR Backtest
 * Tabs without ML service data show placeholder messages.
 */

import { useState, type ReactNode } from "react";

type Tab = {
  id: string;
  label: string;
  content: ReactNode;
};

type VolatilityAdvancedTabsProps = {
  estimatorsContent: ReactNode;
  garchContent?: ReactNode;
  regimeContent?: ReactNode;
  varContent?: ReactNode;
  mlLoading?: boolean;
};

export default function VolatilityAdvancedTabs({
  estimatorsContent,
  garchContent,
  regimeContent,
  varContent,
  mlLoading,
}: VolatilityAdvancedTabsProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState("estimators");

  const mlPlaceholder = (title: string) =>
    mlLoading ? <LoadingTab title={title} /> : <PlaceholderTab title={title} />;

  const tabs: Tab[] = [
    { id: "estimators", label: "Estimators", content: estimatorsContent },
    {
      id: "garch",
      label: garchContent ? "GARCH Parameters ●" : "GARCH Parameters",
      content: garchContent || mlPlaceholder("GARCH Parameters"),
    },
    {
      id: "regime",
      label: regimeContent ? "Regime Model ●" : "Regime Model",
      content: regimeContent || mlPlaceholder("MSGARCH Regime Model"),
    },
    {
      id: "var",
      label: varContent ? "VaR Backtest ●" : "VaR Backtest",
      content: varContent || mlPlaceholder("VaR Backtest"),
    },
  ];

  return (
    <div style={{ marginBottom: 32 }}>
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        style={{
          width: "100%",
          padding: "12px 16px",
          borderRadius: isExpanded ? "6px 6px 0 0" : 6,
          border: "1px solid var(--border)",
          background: "var(--card-bg)",
          color: "var(--foreground)",
          fontSize: 13,
          fontWeight: 700,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          fontFamily: "monospace",
          letterSpacing: "0.02em",
        }}
      >
        Model Details & Methodology
        <span style={{ fontSize: 12, color: "var(--muted-foreground)" }}>
          {isExpanded ? "▲" : "▼"}
        </span>
      </button>

      {isExpanded && (
        <div
          style={{
            border: "1px solid var(--border)",
            borderTop: "none",
            borderRadius: "0 0 6px 6px",
            background: "var(--card-bg)",
          }}
        >
          {/* Tab bar */}
          <div
            style={{
              display: "flex",
              borderBottom: "1px solid var(--border)",
              overflow: "auto",
            }}
          >
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                style={{
                  padding: "10px 20px",
                  border: "none",
                  borderBottom: activeTab === tab.id ? "2px solid var(--accent)" : "2px solid transparent",
                  background: activeTab === tab.id ? "var(--hover-bg)" : "transparent",
                  color: activeTab === tab.id ? "var(--foreground)" : "var(--muted-foreground)",
                  fontSize: 12,
                  fontWeight: activeTab === tab.id ? 700 : 500,
                  cursor: "pointer",
                  fontFamily: "monospace",
                  whiteSpace: "nowrap",
                  transition: "all 0.15s",
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div style={{ padding: 20 }}>
            {tabs.find((t) => t.id === activeTab)?.content}
          </div>
        </div>
      )}
    </div>
  );
}

function LoadingTab({ title }: { title: string }) {
  return (
    <div
      style={{
        padding: "40px 20px",
        textAlign: "center",
        color: "var(--muted-foreground)",
        fontSize: 13,
        fontFamily: "monospace",
      }}
    >
      <div style={{ fontSize: 16, marginBottom: 12, opacity: 0.5 }}>
        <span style={{ display: "inline-block", animation: "spin 1s linear infinite" }}>◐</span>
      </div>
      <div style={{ fontWeight: 600, marginBottom: 4 }}>{title}</div>
      <div style={{ fontSize: 12, opacity: 0.7 }}>Fitting models...</div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function PlaceholderTab({ title }: { title: string }) {
  return (
    <div
      style={{
        padding: "40px 20px",
        textAlign: "center",
        color: "var(--muted-foreground)",
        fontSize: 13,
        fontFamily: "monospace",
      }}
    >
      <div style={{ fontSize: 24, marginBottom: 12, opacity: 0.3 }}>⚙</div>
      <div style={{ fontWeight: 600, marginBottom: 8 }}>{title}</div>
      <div style={{ fontSize: 12, lineHeight: 1.8 }}>
        Start the Python ML service to enable this tab:
        <br />
        <code style={{ padding: "2px 6px", background: "var(--background)", borderRadius: 3, fontSize: 11 }}>
          cd ml-service && uvicorn app.main:app --port 8000
        </code>
      </div>
    </div>
  );
}
