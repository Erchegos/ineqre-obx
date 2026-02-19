"use client";

/**
 * RegimeModelTab — MSGARCH regime model visualization.
 *
 * Shows: HMM state probabilities, transition matrix, per-regime GARCH,
 * state statistics, blended volatility forecast.
 */

import { useMemo } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

type RegimeGarch = {
  state: number;
  label: string;
  garch_params: { omega: number; alpha: number; beta: number; persistence: number } | null;
  forecast_vol: number;
  fallback_vol?: number;
};

type StateStat = {
  label: string;
  mean_return: number;
  annualized_vol: number;
  expected_duration_days: number;
  frequency: number;
  n_observations: number;
};

type RegimeData = {
  n_states: number;
  states: number[];
  state_probs: number[][];
  transition_matrix: number[][];
  state_stats: StateStat[];
  current_state: number;
  current_probs: number[];
  state_labels: string[];
  regime_garch: RegimeGarch[];
  blended_forecast_vol: number;
  bic: number;
  dates?: string[];
};

type Props = {
  data: RegimeData;
  ticker: string;
};

const STATE_COLORS = ["#4CAF50", "#FF9800", "#F44336"];

export default function RegimeModelTab({ data, ticker }: Props) {
  const {
    state_probs, transition_matrix, state_stats,
    current_state, current_probs, state_labels,
    regime_garch, blended_forecast_vol, bic, dates,
  } = data;

  // State probability chart data
  const probChartData = useMemo(() => {
    return state_probs.map((probs, i) => {
      const point: Record<string, any> = {
        date: dates?.[i] || `${i}`,
      };
      probs.forEach((p, s) => {
        point[`state${s}`] = p;
      });
      return point;
    });
  }, [state_probs, dates]);

  const fmtDate = (d: string) => {
    if (d.length >= 10) return d.slice(5);
    return d;
  };

  return (
    <div>
      {/* ── Row 1: Current State + Blended Forecast ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 24 }}>
        {/* Current regime probabilities */}
        <div style={{ padding: 20, borderRadius: 6, background: "var(--background)", border: "1px solid var(--border)" }}>
          <div style={{ ...headerStyle }}>Current State Probabilities</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}>
            {current_probs.map((prob, i) => (
              <div key={i}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                  <span style={{ fontSize: 12, fontFamily: "monospace", color: i === current_state ? STATE_COLORS[i] : "var(--muted-foreground)", fontWeight: i === current_state ? 700 : 400 }}>
                    {state_labels[i]}
                    {i === current_state && " ●"}
                  </span>
                  <span style={{ fontSize: 13, fontWeight: 700, fontFamily: "monospace", color: "var(--foreground)" }}>
                    {(prob * 100).toFixed(1)}%
                  </span>
                </div>
                <div style={{ height: 6, borderRadius: 3, background: "var(--border)", overflow: "hidden" }}>
                  <div style={{
                    width: `${prob * 100}%`,
                    height: "100%",
                    borderRadius: 3,
                    background: STATE_COLORS[i] || "#9E9E9E",
                    transition: "width 0.3s ease",
                  }} />
                </div>
              </div>
            ))}
          </div>

          {/* Blended forecast */}
          <div style={{
            padding: "10px 14px", borderRadius: 4,
            background: "rgba(99,102,241,0.06)", border: "1px solid rgba(99,102,241,0.15)",
          }}>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--muted-foreground)", fontFamily: "monospace", marginBottom: 4 }}>
              Blended Forecast
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <span style={{ fontSize: 24, fontWeight: 700, fontFamily: "monospace", color: "var(--foreground)" }}>
                {(blended_forecast_vol * 100).toFixed(1)}%
              </span>
              <span style={{ fontSize: 11, color: "var(--muted-foreground)", fontFamily: "monospace" }}>
                annualized · Σ P(s<sub>i</sub>)·σ<sub>i</sub>
              </span>
            </div>
          </div>
        </div>

        {/* Transition matrix + state stats */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Transition matrix */}
          <div style={{ padding: 16, borderRadius: 6, background: "var(--background)", border: "1px solid var(--border)" }}>
            <div style={{ ...headerStyle }}>Transition Matrix</div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "monospace", fontSize: 12 }}>
              <thead>
                <tr>
                  <th style={{ ...thStyle }}>From ↓ To →</th>
                  {state_labels.map((label, i) => (
                    <th key={i} style={{ ...thStyle, color: STATE_COLORS[i] || "var(--foreground)" }}>
                      {label.split(" ")[0]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {transition_matrix.map((row, i) => (
                  <tr key={i}>
                    <td style={{ ...tdStyle, color: STATE_COLORS[i], fontWeight: 600 }}>
                      {state_labels[i].split(" ")[0]}
                    </td>
                    {row.map((p, j) => (
                      <td key={j} style={{
                        ...tdStyle,
                        fontWeight: i === j ? 700 : 400,
                        color: i === j ? "var(--foreground)" : "var(--muted-foreground)",
                        background: i === j ? `${STATE_COLORS[i]}11` : "transparent",
                      }}>
                        {p.toFixed(3)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ fontSize: 10, color: "var(--muted-foreground)", marginTop: 6, fontFamily: "monospace" }}>
              BIC: {bic.toFixed(1)} · Diagonal = regime persistence
            </div>
          </div>

          {/* Per-state statistics */}
          <div style={{ padding: 16, borderRadius: 6, background: "var(--background)", border: "1px solid var(--border)", flex: 1 }}>
            <div style={{ ...headerStyle }}>Regime Statistics</div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "monospace", fontSize: 11 }}>
              <thead>
                <tr>
                  <th style={{ ...thStyle }}>State</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>Vol</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>Return</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>Duration</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>Freq</th>
                </tr>
              </thead>
              <tbody>
                {state_stats.map((s, i) => (
                  <tr key={i}>
                    <td style={{ ...tdStyle, color: STATE_COLORS[i], fontWeight: 600, fontSize: 12 }}>
                      {s.label}
                    </td>
                    <td style={{ ...tdStyle, textAlign: "right", fontWeight: 600 }}>
                      {(s.annualized_vol * 100).toFixed(1)}%
                    </td>
                    <td style={{
                      ...tdStyle, textAlign: "right",
                      color: s.mean_return >= 0 ? "#4CAF50" : "#F44336",
                    }}>
                      {s.mean_return >= 0 ? "+" : ""}{(s.mean_return * 100).toFixed(1)}%
                    </td>
                    <td style={{ ...tdStyle, textAlign: "right" }}>
                      {s.expected_duration_days.toFixed(0)}d
                    </td>
                    <td style={{ ...tdStyle, textAlign: "right" }}>
                      {(s.frequency * 100).toFixed(0)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* ── Row 2: State Probability Time Series ── */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <div style={{ ...headerStyle, margin: 0 }}>Smoothed State Probabilities</div>
          <span style={{ fontSize: 11, fontFamily: "monospace", color: "var(--muted-foreground)" }}>
            {ticker} · HMM K={data.n_states} · {state_probs.length} observations
          </span>
        </div>
        <div style={{ padding: 16, borderRadius: 6, background: "var(--background)", border: "1px solid var(--border)" }}>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={probChartData} stackOffset="expand">
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" strokeOpacity={0.3} />
              <XAxis
                dataKey="date"
                tickFormatter={fmtDate}
                tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                interval="preserveStartEnd"
                minTickGap={60}
              />
              <YAxis
                tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`}
                tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                width={40}
              />
              <Tooltip
                contentStyle={{
                  background: "var(--card-bg)",
                  border: "1px solid var(--border)",
                  borderRadius: 4,
                  fontSize: 11,
                  fontFamily: "monospace",
                }}
                formatter={(v: unknown, name: unknown) => {
                  const idx = parseInt(String(name).replace("state", ""));
                  return [`${(Number(v) * 100).toFixed(1)}%`, state_labels[idx] || String(name)];
                }}
              />
              {state_labels.map((_, i) => (
                <Area
                  key={i}
                  type="monotone"
                  dataKey={`state${i}`}
                  stackId="1"
                  stroke={STATE_COLORS[i]}
                  fill={STATE_COLORS[i]}
                  fillOpacity={0.6}
                  strokeWidth={0}
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
          <div style={{ display: "flex", justifyContent: "center", gap: 20, marginTop: 8, fontSize: 11, fontFamily: "monospace" }}>
            {state_labels.map((label, i) => (
              <span key={i} style={{ color: STATE_COLORS[i] }}>■ {label}</span>
            ))}
          </div>
        </div>
      </div>

      {/* ── Row 3: Per-Regime GARCH Parameters ── */}
      <div>
        <div style={{ ...headerStyle }}>Per-Regime GARCH(1,1) Parameters</div>
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${regime_garch.length}, 1fr)`, gap: 16 }}>
          {regime_garch.map((rg, i) => (
            <div key={i} style={{
              padding: 16, borderRadius: 6, background: "var(--background)",
              border: `1px solid var(--border)`, borderTop: `3px solid ${STATE_COLORS[i]}`,
            }}>
              <div style={{ fontSize: 12, fontWeight: 700, fontFamily: "monospace", color: STATE_COLORS[i], marginBottom: 10 }}>
                {rg.label}
              </div>
              {rg.garch_params ? (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 12px", fontSize: 11, fontFamily: "monospace" }}>
                  <span style={{ color: "var(--muted-foreground)" }}>α:</span>
                  <span style={{ fontWeight: 600 }}>{rg.garch_params.alpha.toFixed(4)}</span>
                  <span style={{ color: "var(--muted-foreground)" }}>β:</span>
                  <span style={{ fontWeight: 600 }}>{rg.garch_params.beta.toFixed(4)}</span>
                  <span style={{ color: "var(--muted-foreground)" }}>Persist.:</span>
                  <span style={{ fontWeight: 600 }}>{rg.garch_params.persistence.toFixed(4)}</span>
                  <span style={{ color: "var(--muted-foreground)" }}>Forecast:</span>
                  <span style={{ fontWeight: 700, color: "var(--foreground)" }}>{(rg.forecast_vol * 100).toFixed(1)}%</span>
                </div>
              ) : (
                <div style={{ fontSize: 11, color: "var(--muted-foreground)", fontFamily: "monospace" }}>
                  Insufficient data — using simple vol: {rg.fallback_vol ? `${(rg.fallback_vol * 100).toFixed(1)}%` : "N/A"}
                </div>
              )}
            </div>
          ))}
        </div>
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
  padding: "4px 6px",
  fontSize: 10,
  fontWeight: 600,
  color: "var(--muted-foreground)",
  textTransform: "uppercase" as const,
  letterSpacing: "0.05em",
  borderBottom: "1px solid var(--border)",
  textAlign: "left" as const,
};

const tdStyle: React.CSSProperties = {
  padding: "5px 6px",
  color: "var(--foreground)",
  borderBottom: "1px solid var(--border)",
};
