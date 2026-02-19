"use client";

/**
 * VarBacktestTab — VaR/ES levels + backtest results visualization.
 *
 * Shows: VaR levels (3 methods × 2 confidence), backtest chart with
 * actual returns vs VaR bounds, Kupiec + Christoffersen test cards,
 * traffic light classification, jump events overlay.
 */

import { useMemo, useState } from "react";
import {
  ComposedChart,
  Line,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Cell,
} from "recharts";

type VarLevels = {
  [key: string]: {
    confidence: number;
    historical: { var: number; es: number };
    parametric: { var: number; es: number };
    garch: { var: number; es: number };
  };
};

type TestResult = {
  test: string;
  n_observations: number;
  n_violations: number;
  expected_violations: number;
  violation_rate: number;
  expected_rate: number;
  lr_statistic: number;
  p_value: number;
  reject_h0: boolean;
  interpretation: string;
};

type BacktestResult = {
  method: string;
  confidence: number;
  kupiec: TestResult;
  christoffersen: {
    test: string;
    p01: number;
    p11: number;
    clustering_ratio: number | null;
    lr_statistic: number;
    p_value: number;
    reject_h0: boolean;
    interpretation: string;
  };
  traffic_light: "GREEN" | "YELLOW" | "RED";
  summary: {
    model_adequate: boolean;
    violations_independent: boolean;
    overall_pass: boolean;
  };
};

type BacktestChart = {
  dates: string[];
  actual_returns: number[];
  historical_var: number[];
  parametric_var: number[];
  garch_var: number[];
};

type Props = {
  varLevels: VarLevels | null;
  backtestResults: Record<string, BacktestResult> | null;
  backtestChart: BacktestChart | null;
  jumps: { jumps: Array<{ date: string; return_pct: number; direction: string; magnitude: string }>; summary: any } | null;
  ticker: string;
};

const TRAFFIC_COLORS = { GREEN: "#4CAF50", YELLOW: "#FF9800", RED: "#F44336" };
const METHOD_COLORS = { historical: "#3b82f6", parametric: "#22c55e", garch: "#6366f1" };

export default function VarBacktestTab({ varLevels, backtestResults, backtestChart, jumps, ticker }: Props) {
  const [selectedConfidence, setSelectedConfidence] = useState<"95" | "99">("99");

  // Chart data
  const chartData = useMemo(() => {
    if (!backtestChart) return [];
    return backtestChart.dates.map((date, i) => ({
      date,
      return: (backtestChart.actual_returns[i] || 0) * 100,
      hist_var: -(backtestChart.historical_var[i] || 0) * 100,
      param_var: -(backtestChart.parametric_var[i] || 0) * 100,
      garch_var: -(backtestChart.garch_var[i] || 0) * 100,
      isViolation: (backtestChart.actual_returns[i] || 0) < -(backtestChart.historical_var[i] || Infinity),
    }));
  }, [backtestChart]);

  const fmtDate = (d: string) => d.length >= 10 ? d.slice(5) : d;

  return (
    <div>
      {/* ── Row 1: VaR Levels ── */}
      {varLevels && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <div style={{ ...headerStyle, margin: 0 }}>Value at Risk & Expected Shortfall</div>
            <div style={{ display: "flex", gap: 4 }}>
              {(["95", "99"] as const).map((cl) => (
                <button
                  key={cl}
                  onClick={() => setSelectedConfidence(cl)}
                  style={{
                    padding: "3px 10px", fontSize: 11, fontWeight: 600, borderRadius: 3,
                    border: `1px solid ${selectedConfidence === cl ? "#6366f1" : "var(--border)"}`,
                    background: selectedConfidence === cl ? "rgba(99,102,241,0.1)" : "transparent",
                    color: selectedConfidence === cl ? "#6366f1" : "var(--muted-foreground)",
                    cursor: "pointer", fontFamily: "monospace",
                  }}
                >
                  {cl}% CL
                </button>
              ))}
            </div>
          </div>

          {varLevels[selectedConfidence] && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
              <VarCard
                method="Historical"
                var_val={varLevels[selectedConfidence].historical.var}
                es_val={varLevels[selectedConfidence].historical.es}
                color={METHOD_COLORS.historical}
                desc="Empirical quantile of past returns"
              />
              <VarCard
                method="Parametric"
                var_val={varLevels[selectedConfidence].parametric.var}
                es_val={varLevels[selectedConfidence].parametric.es}
                color={METHOD_COLORS.parametric}
                desc="Normal distribution assumption"
              />
              <VarCard
                method="GARCH"
                var_val={varLevels[selectedConfidence].garch.var}
                es_val={varLevels[selectedConfidence].garch.es}
                color={METHOD_COLORS.garch}
                desc="Conditional volatility model"
              />
            </div>
          )}
        </div>
      )}

      {/* ── Row 2: Backtest Chart ── */}
      {chartData.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <div style={{ ...headerStyle, margin: 0 }}>VaR Backtest — Returns vs Thresholds</div>
            <span style={{ fontSize: 11, fontFamily: "monospace", color: "var(--muted-foreground)" }}>
              {ticker} · {chartData.length} observations
            </span>
          </div>
          <div style={{ padding: 16, borderRadius: 6, background: "var(--background)", border: "1px solid var(--border)" }}>
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" strokeOpacity={0.3} />
                <XAxis
                  dataKey="date"
                  tickFormatter={fmtDate}
                  tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                  interval="preserveStartEnd"
                  minTickGap={60}
                />
                <YAxis
                  tickFormatter={(v: number) => `${v.toFixed(1)}%`}
                  tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                  width={50}
                />
                <Tooltip
                  contentStyle={{
                    background: "var(--card-bg)",
                    border: "1px solid var(--border)",
                    borderRadius: 4,
                    fontSize: 11,
                    fontFamily: "monospace",
                  }}
                  formatter={(v: unknown, name: unknown) => [`${Number(v).toFixed(3)}%`, String(name)]}
                />
                <ReferenceLine y={0} stroke="var(--muted-foreground)" strokeDasharray="4 4" strokeOpacity={0.5} />

                {/* Actual returns as bars */}
                <Bar dataKey="return" name="Return" barSize={2} fillOpacity={0.8}>
                  {chartData.map((entry, i) => (
                    <Cell
                      key={i}
                      fill={entry.isViolation ? "#F44336" : entry.return < 0 ? "rgba(244,67,54,0.3)" : "rgba(76,175,80,0.3)"}
                    />
                  ))}
                </Bar>

                {/* VaR lines */}
                <Line type="monotone" dataKey="hist_var" stroke={METHOD_COLORS.historical} strokeWidth={1.5} dot={false} name="Historical VaR" />
                <Line type="monotone" dataKey="garch_var" stroke={METHOD_COLORS.garch} strokeWidth={1.5} dot={false} name="GARCH VaR" strokeDasharray="4 2" />
              </ComposedChart>
            </ResponsiveContainer>
            <div style={{ display: "flex", justifyContent: "center", gap: 20, marginTop: 8, fontSize: 10, fontFamily: "monospace" }}>
              <span style={{ color: METHOD_COLORS.historical }}>― Historical VaR</span>
              <span style={{ color: METHOD_COLORS.garch }}>┄ GARCH VaR</span>
              <span style={{ color: "#F44336" }}>■ Violations</span>
              <span style={{ color: "rgba(76,175,80,0.5)" }}>■ Returns</span>
            </div>
          </div>
        </div>
      )}

      {/* ── Row 3: Backtest Results (Kupiec + Christoffersen) ── */}
      {backtestResults && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ ...headerStyle }}>Statistical Tests</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
            {(["historical", "parametric", "garch"] as const).map((method) => {
              const result = backtestResults[method];
              if (!result) return null;
              const color = METHOD_COLORS[method];
              const trafficColor = TRAFFIC_COLORS[result.traffic_light];

              return (
                <div key={method} style={{
                  padding: 16, borderRadius: 6, background: "var(--background)",
                  border: "1px solid var(--border)", borderTop: `3px solid ${color}`,
                }}>
                  {/* Header with traffic light */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, fontFamily: "monospace", color }}>
                      {result.method}
                    </span>
                    <span style={{
                      padding: "2px 8px", borderRadius: 3, fontSize: 10, fontWeight: 700,
                      fontFamily: "monospace", background: `${trafficColor}15`,
                      color: trafficColor, border: `1px solid ${trafficColor}33`,
                    }}>
                      {result.traffic_light}
                    </span>
                  </div>

                  {/* Kupiec */}
                  <TestCard
                    label="Kupiec POF"
                    violations={result.kupiec.n_violations}
                    expected={result.kupiec.expected_violations}
                    pValue={result.kupiec.p_value}
                    pass={!result.kupiec.reject_h0}
                  />

                  {/* Christoffersen */}
                  <TestCard
                    label="Independence"
                    pValue={result.christoffersen.p_value}
                    pass={!result.christoffersen.reject_h0}
                    clusterRatio={result.christoffersen.clustering_ratio}
                  />

                  {/* Overall */}
                  <div style={{
                    marginTop: 8, padding: "6px 10px", borderRadius: 3, fontSize: 11, fontFamily: "monospace",
                    background: result.summary.overall_pass ? "rgba(76,175,80,0.08)" : "rgba(244,67,54,0.08)",
                    color: result.summary.overall_pass ? "#4CAF50" : "#F44336",
                    fontWeight: 600,
                  }}>
                    {result.summary.overall_pass ? "PASS" : "FAIL"} — {result.summary.overall_pass ? "Model adequate" : "Model needs recalibration"}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Row 4: Jump Events ── */}
      {jumps && jumps.jumps.length > 0 && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <div style={{ ...headerStyle, margin: 0 }}>Detected Jump Events</div>
            <span style={{ fontSize: 11, fontFamily: "monospace", color: "var(--muted-foreground)" }}>
              Intensity: {jumps.summary.intensity_per_year.toFixed(1)}/year · Contribution: {(jumps.summary.jump_contribution * 100).toFixed(0)}% of variance
            </span>
          </div>
          <div style={{ padding: 16, borderRadius: 6, background: "var(--background)", border: "1px solid var(--border)" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "monospace", fontSize: 12 }}>
              <thead>
                <tr>
                  <th style={{ ...thStyle }}>Date</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>Return</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>Z-Score</th>
                  <th style={{ ...thStyle }}>Direction</th>
                  <th style={{ ...thStyle }}>Magnitude</th>
                </tr>
              </thead>
              <tbody>
                {jumps.jumps.slice(0, 20).map((j, i) => (
                  <tr key={i}>
                    <td style={{ ...tdStyle }}>{j.date}</td>
                    <td style={{
                      ...tdStyle, textAlign: "right", fontWeight: 600,
                      color: j.direction === "up" ? "#4CAF50" : "#F44336",
                    }}>
                      {j.return_pct >= 0 ? "+" : ""}{j.return_pct.toFixed(2)}%
                    </td>
                    <td style={{ ...tdStyle, textAlign: "right" }}>
                      {j.direction === "up" ? "+" : "-"}{Math.abs(parseFloat(String((j as any).z_score || 0))).toFixed(1)}σ
                    </td>
                    <td style={{ ...tdStyle }}>
                      <span style={{
                        padding: "1px 6px", borderRadius: 2, fontSize: 10, fontWeight: 600,
                        background: j.direction === "up" ? "rgba(76,175,80,0.1)" : "rgba(244,67,54,0.1)",
                        color: j.direction === "up" ? "#4CAF50" : "#F44336",
                      }}>
                        {j.direction.toUpperCase()}
                      </span>
                    </td>
                    <td style={{ ...tdStyle }}>
                      <span style={{
                        padding: "1px 6px", borderRadius: 2, fontSize: 10,
                        background: j.magnitude === "extreme" ? "rgba(244,67,54,0.1)" : j.magnitude === "large" ? "rgba(255,152,0,0.1)" : "rgba(158,158,158,0.1)",
                        color: j.magnitude === "extreme" ? "#F44336" : j.magnitude === "large" ? "#FF9800" : "var(--muted-foreground)",
                      }}>
                        {j.magnitude}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function VarCard({ method, var_val, es_val, color, desc }: {
  method: string; var_val: number; es_val: number; color: string; desc: string;
}) {
  return (
    <div style={{
      padding: 16, borderRadius: 6, background: "var(--background)",
      border: "1px solid var(--border)", borderTop: `3px solid ${color}`,
    }}>
      <div style={{ fontSize: 12, fontWeight: 700, fontFamily: "monospace", color, marginBottom: 8 }}>
        {method}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 16px", fontSize: 12, fontFamily: "monospace" }}>
        <span style={{ color: "var(--muted-foreground)", fontSize: 11 }}>VaR:</span>
        <span style={{ fontWeight: 700, fontSize: 16, color: "var(--foreground)" }}>
          {(var_val * 100).toFixed(2)}%
        </span>
        <span style={{ color: "var(--muted-foreground)", fontSize: 11 }}>ES/CVaR:</span>
        <span style={{ fontWeight: 600 }}>{(es_val * 100).toFixed(2)}%</span>
      </div>
      <div style={{ fontSize: 10, color: "var(--muted-foreground)", marginTop: 6 }}>{desc}</div>
    </div>
  );
}

function TestCard({ label, violations, expected, pValue, pass, clusterRatio }: {
  label: string; violations?: number; expected?: number; pValue: number; pass: boolean; clusterRatio?: number | null;
}) {
  return (
    <div style={{
      padding: "8px 10px", marginBottom: 6, borderRadius: 4,
      background: pass ? "rgba(76,175,80,0.04)" : "rgba(244,67,54,0.04)",
      border: `1px solid ${pass ? "rgba(76,175,80,0.15)" : "rgba(244,67,54,0.15)"}`,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
        <span style={{ fontSize: 10, fontWeight: 600, fontFamily: "monospace", color: "var(--muted-foreground)" }}>{label}</span>
        <span style={{ fontSize: 10, fontWeight: 700, fontFamily: "monospace", color: pass ? "#4CAF50" : "#F44336" }}>
          {pass ? "PASS" : "FAIL"}
        </span>
      </div>
      <div style={{ fontSize: 10, fontFamily: "monospace", color: "var(--muted-foreground)" }}>
        p={pValue.toFixed(3)}
        {violations !== undefined && expected !== undefined && ` · ${violations}/${expected.toFixed(0)} violations`}
        {clusterRatio !== undefined && clusterRatio !== null && ` · cluster=${clusterRatio.toFixed(2)}×`}
      </div>
    </div>
  );
}

const headerStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  textTransform: "uppercase" as const,
  letterSpacing: "0.08em",
  color: "var(--muted-foreground)",
  fontFamily: "monospace",
  marginBottom: 12,
};

const thStyle: React.CSSProperties = {
  padding: "4px 8px",
  fontSize: 10,
  fontWeight: 600,
  color: "var(--muted-foreground)",
  textTransform: "uppercase" as const,
  letterSpacing: "0.05em",
  borderBottom: "1px solid var(--border)",
  textAlign: "left" as const,
};

const tdStyle: React.CSSProperties = {
  padding: "6px 8px",
  color: "var(--foreground)",
  borderBottom: "1px solid var(--border)",
};
