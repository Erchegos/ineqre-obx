"use client";

import { useState, useMemo } from "react";

interface MetricsData {
  expectedReturn: number;
  volatility: number;
  sharpeRatio: number;
  sortinoRatio: number;
  var95: number;
  maxDrawdown: number;
  effectivePositions: number;
  diversificationRatio: number;
  mlExpectedReturn?: number;
  mlSharpe?: number;
}

interface ModeData {
  weights: number[];
  metrics: MetricsData;
  topHoldings: { ticker: string; weight: number }[];
}

interface PortfolioComparisonPanelProps {
  manualMetrics: MetricsData;
  manualWeights: { ticker: string; weight: number }[];
  modeComparison: Record<string, ModeData>;
  tickers: string[];
  onApplyWeights?: (weights: Record<string, number>) => void;
}

const MODE_LABELS: Record<string, string> = {
  equal: "Equal Weight",
  min_variance: "Min Variance",
  max_sharpe: "Max Sharpe",
  risk_parity: "Risk Parity",
  max_diversification: "Max Diversification",
};

const MODE_SHORT: Record<string, string> = {
  equal: "EW",
  min_variance: "MV",
  max_sharpe: "MS",
  risk_parity: "RP",
  max_diversification: "MD",
};

type MetricKey = "expectedReturn" | "volatility" | "sharpeRatio" | "sortinoRatio" | "var95" | "maxDrawdown" | "effectivePositions" | "diversificationRatio";

const METRIC_CONFIG: {
  key: MetricKey;
  label: string;
  format: (v: number) => string;
  higherIsBetter: boolean;
}[] = [
  { key: "expectedReturn", label: "Return (ann.)", format: v => `${(v * 100).toFixed(1)}%`, higherIsBetter: true },
  { key: "volatility", label: "Volatility", format: v => `${(v * 100).toFixed(1)}%`, higherIsBetter: false },
  { key: "sharpeRatio", label: "Sharpe", format: v => v.toFixed(2), higherIsBetter: true },
  { key: "sortinoRatio", label: "Sortino", format: v => v.toFixed(2), higherIsBetter: true },
  { key: "var95", label: "VaR 95%", format: v => `${(v * 100).toFixed(1)}%`, higherIsBetter: false },
  { key: "maxDrawdown", label: "Max Drawdown", format: v => `${(v * 100).toFixed(1)}%`, higherIsBetter: false },
  { key: "effectivePositions", label: "Eff. Positions", format: v => v.toFixed(1), higherIsBetter: true },
  { key: "diversificationRatio", label: "Diversification", format: v => v.toFixed(2), higherIsBetter: true },
];

const cardStyle: React.CSSProperties = {
  background: "#161b22",
  border: "1px solid #30363d",
  borderRadius: 4,
  padding: 16,
};

const applyBtnStyle: React.CSSProperties = {
  padding: "2px 8px",
  background: "#1f6feb",
  border: "none",
  borderRadius: 3,
  color: "#fff",
  fontSize: 9,
  fontFamily: "monospace",
  fontWeight: 700,
  cursor: "pointer",
  letterSpacing: "0.05em",
  whiteSpace: "nowrap",
};

export default function PortfolioComparisonPanel({
  manualMetrics,
  manualWeights,
  modeComparison,
  tickers,
  onApplyWeights,
}: PortfolioComparisonPanelProps) {
  const [selectedMode, setSelectedMode] = useState("min_variance");

  const suggested = modeComparison[selectedMode];
  if (!suggested) return null;

  const weightChanges = useMemo(() => {
    const changes = tickers.map((t, i) => {
      const current = manualWeights.find(w => w.ticker === t)?.weight ?? 0;
      const suggestedW = suggested.weights[i] ?? 0;
      return {
        ticker: t,
        current,
        suggested: suggestedW,
        delta: suggestedW - current,
      };
    });
    return changes
      .filter(c => Math.abs(c.delta) > 0.005)
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  }, [tickers, manualWeights, suggested]);

  // Build full suggested weights map
  const allSuggestedWeights = useMemo(() => {
    const map: Record<string, number> = {};
    tickers.forEach((t, i) => {
      map[t] = suggested.weights[i] ?? 0;
    });
    return map;
  }, [tickers, suggested]);

  // Apply all suggested weights
  const handleApplyAll = () => {
    if (onApplyWeights) {
      onApplyWeights(allSuggestedWeights);
    }
  };

  // Apply single stock weight
  const handleApplySingle = (ticker: string) => {
    if (onApplyWeights) {
      // Only send the one ticker's suggested weight
      onApplyWeights({ [ticker]: allSuggestedWeights[ticker] ?? 0 });
    }
  };

  const tabStyle = (active: boolean): React.CSSProperties => ({
    padding: "4px 10px",
    background: active ? "#1f6feb" : "#21262d",
    border: "1px solid " + (active ? "#1f6feb" : "#30363d"),
    borderRadius: 3,
    color: active ? "#fff" : "rgba(255,255,255,0.5)",
    fontSize: 10,
    fontFamily: "monospace",
    fontWeight: 700,
    cursor: "pointer",
    letterSpacing: "0.05em",
  });

  return (
    <div>
      {/* Mode selector */}
      <div style={{ display: "flex", gap: 4, marginBottom: 12, alignItems: "center" }}>
        <span style={{ fontSize: 10, fontFamily: "monospace", color: "rgba(255,255,255,0.4)", alignSelf: "center", marginRight: 4 }}>
          COMPARE WITH:
        </span>
        {Object.keys(MODE_LABELS).map(mode => (
          <button
            key={mode}
            onClick={() => setSelectedMode(mode)}
            style={tabStyle(selectedMode === mode)}
          >
            {MODE_SHORT[mode]}
          </button>
        ))}
      </div>

      {/* Side-by-side metrics */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
        {/* YOUR PORTFOLIO */}
        <div style={cardStyle}>
          <div style={{
            fontSize: 10, fontWeight: 700, fontFamily: "monospace",
            color: "rgba(255,255,255,0.4)", letterSpacing: "0.1em", marginBottom: 12,
          }}>
            YOUR PORTFOLIO
          </div>
          {METRIC_CONFIG.map(mc => (
            <div key={mc.key} style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              padding: "5px 0", borderBottom: "1px solid #21262d",
            }}>
              <span style={{ fontSize: 11, fontFamily: "monospace", color: "rgba(255,255,255,0.5)" }}>
                {mc.label}
              </span>
              <span style={{ fontSize: 12, fontFamily: "monospace", fontWeight: 700, color: "#fff" }}>
                {mc.format(manualMetrics[mc.key])}
              </span>
            </div>
          ))}
        </div>

        {/* SUGGESTED PORTFOLIO */}
        <div style={{ ...cardStyle, borderLeft: "3px solid #1f6feb" }}>
          <div style={{
            display: "flex", justifyContent: "space-between", alignItems: "center",
            marginBottom: 12,
          }}>
            <div style={{
              fontSize: 10, fontWeight: 700, fontFamily: "monospace",
              color: "#3b82f6", letterSpacing: "0.1em",
            }}>
              {MODE_LABELS[selectedMode]?.toUpperCase() || selectedMode}
            </div>
            {onApplyWeights && (
              <button
                onClick={handleApplyAll}
                style={{
                  ...applyBtnStyle,
                  padding: "4px 14px",
                  fontSize: 10,
                  background: "linear-gradient(135deg, #1f6feb, #1158c7)",
                  boxShadow: "0 1px 6px rgba(31,111,235,0.3)",
                }}
              >
                APPLY ALL WEIGHTS
              </button>
            )}
          </div>
          {METRIC_CONFIG.map(mc => {
            const manualVal = manualMetrics[mc.key];
            const sugVal = suggested.metrics[mc.key];
            const delta = sugVal - manualVal;
            const improved = mc.higherIsBetter ? delta > 0.001 : delta < -0.001;
            const worse = mc.higherIsBetter ? delta < -0.001 : delta > 0.001;

            return (
              <div key={mc.key} style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                padding: "5px 0", borderBottom: "1px solid #21262d",
              }}>
                <span style={{ fontSize: 11, fontFamily: "monospace", color: "rgba(255,255,255,0.5)" }}>
                  {mc.label}
                </span>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 12, fontFamily: "monospace", fontWeight: 700, color: "#fff" }}>
                    {mc.format(sugVal)}
                  </span>
                  {(improved || worse) && (
                    <span style={{
                      fontSize: 10, fontFamily: "monospace", fontWeight: 700,
                      color: improved ? "#10b981" : "#ef4444",
                    }}>
                      {improved ? "\u2191" : "\u2193"}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Weight adjustments table */}
      {weightChanges.length > 0 && (
        <div style={cardStyle}>
          <div style={{
            display: "flex", justifyContent: "space-between", alignItems: "center",
            marginBottom: 10,
          }}>
            <div style={{
              fontSize: 10, fontWeight: 700, fontFamily: "monospace",
              color: "rgba(255,255,255,0.4)", letterSpacing: "0.1em",
            }}>
              SUGGESTED ADJUSTMENTS
            </div>
            {onApplyWeights && (
              <button
                onClick={handleApplyAll}
                style={applyBtnStyle}
              >
                APPLY ALL
              </button>
            )}
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ padding: "4px 6px", textAlign: "left", fontSize: 9, fontFamily: "monospace", color: "rgba(255,255,255,0.3)", borderBottom: "1px solid #21262d" }}>TICKER</th>
                <th style={{ padding: "4px 6px", textAlign: "right", fontSize: 9, fontFamily: "monospace", color: "rgba(255,255,255,0.3)", borderBottom: "1px solid #21262d" }}>CURRENT</th>
                <th style={{ padding: "4px 6px", textAlign: "center", fontSize: 9, fontFamily: "monospace", color: "rgba(255,255,255,0.3)", borderBottom: "1px solid #21262d" }}></th>
                <th style={{ padding: "4px 6px", textAlign: "right", fontSize: 9, fontFamily: "monospace", color: "rgba(255,255,255,0.3)", borderBottom: "1px solid #21262d" }}>SUGGESTED</th>
                <th style={{ padding: "4px 6px", textAlign: "right", fontSize: 9, fontFamily: "monospace", color: "rgba(255,255,255,0.3)", borderBottom: "1px solid #21262d" }}>CHANGE</th>
                {onApplyWeights && (
                  <th style={{ padding: "4px 6px", textAlign: "center", fontSize: 9, fontFamily: "monospace", color: "rgba(255,255,255,0.3)", borderBottom: "1px solid #21262d" }}></th>
                )}
              </tr>
            </thead>
            <tbody>
              {weightChanges.map(c => (
                <tr key={c.ticker}>
                  <td style={{ padding: "4px 6px", fontFamily: "monospace", fontSize: 11, fontWeight: 700, color: "#fff" }}>
                    {c.ticker}
                  </td>
                  <td style={{ padding: "4px 6px", textAlign: "right", fontFamily: "monospace", fontSize: 11, color: "rgba(255,255,255,0.6)" }}>
                    {(c.current * 100).toFixed(1)}%
                  </td>
                  <td style={{ padding: "4px 6px", textAlign: "center", fontFamily: "monospace", fontSize: 11, color: "rgba(255,255,255,0.25)" }}>
                    →
                  </td>
                  <td style={{ padding: "4px 6px", textAlign: "right", fontFamily: "monospace", fontSize: 11, color: "#fff" }}>
                    {(c.suggested * 100).toFixed(1)}%
                  </td>
                  <td style={{
                    padding: "4px 6px", textAlign: "right", fontFamily: "monospace", fontSize: 11, fontWeight: 700,
                    color: c.delta > 0 ? "#10b981" : "#ef4444",
                  }}>
                    {c.delta > 0 ? "+" : ""}{(c.delta * 100).toFixed(1)}%
                    {" "}{c.delta > 0 ? "\u25B2" : "\u25BC"}
                  </td>
                  {onApplyWeights && (
                    <td style={{ padding: "4px 6px", textAlign: "center" }}>
                      <button
                        onClick={() => handleApplySingle(c.ticker)}
                        style={{
                          ...applyBtnStyle,
                          background: "#21262d",
                          border: "1px solid #30363d",
                        }}
                        onMouseEnter={e => {
                          (e.target as HTMLButtonElement).style.background = "#1f6feb";
                          (e.target as HTMLButtonElement).style.borderColor = "#1f6feb";
                        }}
                        onMouseLeave={e => {
                          (e.target as HTMLButtonElement).style.background = "#21262d";
                          (e.target as HTMLButtonElement).style.borderColor = "#30363d";
                        }}
                      >
                        APPLY
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
