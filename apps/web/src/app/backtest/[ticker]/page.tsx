"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Cell,
} from "recharts";

type Prediction = {
  prediction_date: string;
  target_date: string;
  ensemble_prediction: number;
  gb_prediction: number;
  rf_prediction: number;
  actual_return: number | null;
  p05: number;
  p25: number;
  p50: number;
  p75: number;
  p95: number;
  confidence_score: number;
  size_regime: string;
  turnover_regime: string;
  quintile: number;
  direction_correct: boolean | null;
};

type Summary = {
  n_predictions: number;
  n_total: number;
  hit_rate: number;
  mae: number;
  avg_quintile: number;
  avg_confidence: number;
  size_regime: string;
};

const cardStyle = {
  padding: 10,
  borderRadius: 2,
  background: "var(--card-bg)",
  border: "1px solid var(--terminal-border)",
};

const labelStyle = {
  fontSize: 9,
  color: "var(--muted)",
  marginBottom: 2,
  fontFamily: "monospace" as const,
  fontWeight: 600,
};

const valueStyle = {
  fontSize: 22,
  fontWeight: 700,
  fontFamily: "monospace" as const,
};

const subLabelStyle = {
  fontSize: 8,
  color: "var(--muted)",
  marginTop: 2,
  fontFamily: "monospace" as const,
  fontWeight: 600,
};

const tooltipStyle = {
  background: "var(--terminal-bg)",
  border: "1px solid var(--terminal-border)",
  borderRadius: 2,
  fontSize: 10,
  fontFamily: "monospace",
  padding: "6px 8px",
  color: "var(--foreground)",
};

const chartCardStyle = {
  padding: 12,
  borderRadius: 2,
  border: "1px solid var(--terminal-border)",
  background: "var(--terminal-bg)",
};

const sectionStyle = {
  padding: 12,
  borderRadius: 2,
  border: "1px solid var(--terminal-border)",
  background: "var(--terminal-bg)",
};

const sectionTitle = {
  fontSize: 10,
  fontWeight: 700,
  marginBottom: 10,
  color: "var(--foreground)",
  fontFamily: "monospace" as const,
};

const GLOSSARY = [
  { term: "Hit Rate", def: "Percentage of predictions where the direction (up/down) was correct. 50% is random." },
  { term: "MAE", def: "Mean Absolute Error — Average of |predicted return - actual return|. Lower is more accurate." },
  { term: "Quintile", def: "Stocks ranked 1-5 each month by predicted return. Q5 = highest predicted, Q1 = lowest predicted." },
  { term: "Confidence", def: "Model confidence score based on ensemble tree agreement. Higher means models agree more on the prediction." },
  { term: "Ensemble", def: "Combined prediction from Gradient Boosting (60%) and Random Forest (40%) models." },
  { term: "Direction", def: "Whether the model correctly predicted up or down movement. Check = correct, cross = incorrect." },
];

export default function TickerBacktestPage() {
  const params = useParams();
  const ticker = (params?.ticker as string)?.toUpperCase() || "";

  const [summary, setSummary] = useState<Summary | null>(null);
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ticker) return;

    async function fetchData() {
      try {
        const res = await fetch(`/api/backtest/${ticker}`);
        if (!res.ok) throw new Error("Failed to fetch backtest data");
        const data = await res.json();
        if (!data.success) throw new Error(data.error || "No data");
        setSummary(data.summary);
        setPredictions(data.predictions);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [ticker]);

  if (loading) {
    return (
      <div
        style={{
          maxWidth: 1600,
          margin: "0 auto",
          padding: "100px 16px 16px",
          fontFamily: "monospace",
          color: "var(--muted)",
          textAlign: "center",
        }}
      >
        LOADING BACKTEST DATA FOR {ticker}...
      </div>
    );
  }

  if (error || !summary) {
    return (
      <div
        style={{
          maxWidth: 1600,
          margin: "0 auto",
          padding: "100px 16px 16px",
          fontFamily: "monospace",
          color: "var(--danger)",
          textAlign: "center",
        }}
      >
        {error || `No backtest data for ${ticker}`}
      </div>
    );
  }

  // Prepare chart data — group by month for predicted vs actual
  const withActual = predictions.filter((p) => p.actual_return !== null);

  const barData = withActual.map((p) => {
    const month =
      typeof p.prediction_date === "string"
        ? p.prediction_date.slice(0, 7)
        : p.prediction_date;
    return {
      month,
      predicted: p.ensemble_prediction * 100,
      actual: (p.actual_return as number) * 100,
    };
  });

  // Cumulative return if following model signal
  const cumData = withActual.map((p, i) => {
    const cumReturn = withActual
      .slice(0, i + 1)
      .reduce((sum, r) => sum + (r.actual_return as number), 0);
    const month =
      typeof p.prediction_date === "string"
        ? p.prediction_date.slice(0, 7)
        : p.prediction_date;
    return {
      month,
      cumReturn: cumReturn * 100,
    };
  });

  const formatMonth = (val: string) => {
    if (!val || val.length < 7) return val;
    return val.slice(2, 7);
  };

  const hitColor =
    summary.hit_rate > 0.55
      ? "var(--success)"
      : summary.hit_rate > 0.5
        ? "var(--warning)"
        : "var(--danger)";

  const quintileColor =
    summary.avg_quintile > 3.2
      ? "var(--success)"
      : summary.avg_quintile > 2.8
        ? "var(--foreground)"
        : "var(--danger)";

  return (
    <div
      style={{
        maxWidth: 1600,
        margin: "0 auto",
        padding: 16,
        fontFamily: "system-ui, -apple-system, sans-serif",
        background: "var(--background)",
      }}
    >
      {/* Header */}
      <div
        style={{
          marginBottom: 16,
          padding: "12px 16px",
          background: "var(--terminal-bg)",
          border: "1px solid var(--terminal-border)",
          borderRadius: 2,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 16,
                marginBottom: 4,
              }}
            >
              <h1
                style={{
                  fontSize: 20,
                  fontWeight: 700,
                  color: "var(--foreground)",
                  fontFamily: "monospace",
                  letterSpacing: "0.5px",
                }}
              >
                BACKTEST: {ticker}
              </h1>
              {summary.size_regime && (
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    fontFamily: "monospace",
                    padding: "2px 8px",
                    background: "var(--accent)",
                    color: "#ffffff",
                    borderRadius: 2,
                    textTransform: "uppercase",
                  }}
                >
                  {summary.size_regime}
                </span>
              )}
            </div>
            <div
              style={{
                fontSize: 10,
                color: "var(--muted)",
                fontFamily: "monospace",
              }}
            >
              {summary.n_predictions} REALIZED PREDICTIONS &bull;{" "}
              {summary.n_total} TOTAL &bull; WALK-FORWARD OUT-OF-SAMPLE
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <Link
              href={`/stocks/${ticker}`}
              style={{
                fontSize: 10,
                color: "var(--accent)",
                textDecoration: "none",
                fontFamily: "monospace",
                fontWeight: 600,
                padding: "6px 12px",
                border: "1px solid var(--accent)",
                borderRadius: 2,
                background: "var(--input-bg)",
              }}
            >
              &larr; BACK TO STOCK
            </Link>
            <Link
              href={`/backtest?from=${ticker}`}
              style={{
                fontSize: 10,
                color: "var(--success)",
                textDecoration: "none",
                fontFamily: "monospace",
                fontWeight: 600,
                padding: "6px 12px",
                border: "1px solid var(--success)",
                borderRadius: 2,
                background: "var(--input-bg)",
              }}
            >
              BACKTEST ALL STOCKS &rarr;
            </Link>
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 8,
          marginBottom: 16,
        }}
      >
        <div style={{ ...cardStyle, borderColor: hitColor, borderWidth: 2 }}>
          <div style={labelStyle}>HIT RATE</div>
          <div style={{ ...valueStyle, color: hitColor }}>
            {(summary.hit_rate * 100).toFixed(1)}%
          </div>
          <div style={subLabelStyle}>DIRECTION ACCURACY</div>
        </div>

        <div
          style={{
            ...cardStyle,
            borderColor: "var(--info)",
            borderWidth: 2,
          }}
        >
          <div style={labelStyle}>MAE</div>
          <div style={{ ...valueStyle, color: "var(--info)" }}>
            {(summary.mae * 100).toFixed(2)}%
          </div>
          <div style={subLabelStyle}>MEAN ABSOLUTE ERROR</div>
        </div>

        <div
          style={{
            ...cardStyle,
            borderColor: quintileColor,
            borderWidth: 2,
          }}
        >
          <div style={labelStyle}>AVG QUINTILE</div>
          <div style={{ ...valueStyle, color: quintileColor }}>
            {summary.avg_quintile.toFixed(1)}
          </div>
          <div style={subLabelStyle}>PREDICTED RANK (1-5)</div>
        </div>

        <div
          style={{
            ...cardStyle,
            borderColor: "var(--accent)",
            borderWidth: 2,
          }}
        >
          <div style={labelStyle}>CONFIDENCE</div>
          <div style={{ ...valueStyle, color: "var(--accent)" }}>
            {(summary.avg_confidence * 100).toFixed(0)}%
          </div>
          <div style={subLabelStyle}>AVG MODEL CONFIDENCE</div>
        </div>
      </div>

      {/* Charts */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 16,
          marginBottom: 16,
        }}
      >
        {/* Predicted vs Actual */}
        <div style={chartCardStyle}>
          <div style={sectionTitle}>PREDICTED vs ACTUAL RETURNS</div>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart
              data={barData}
              margin={{ top: 5, right: 5, left: -20, bottom: 5 }}
              barGap={1}
              barSize={6}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="var(--chart-grid)"
                vertical={false}
              />
              <XAxis
                dataKey="month"
                stroke="var(--border)"
                style={{ fontSize: 9, fontFamily: "monospace" }}
                tick={{ fill: "var(--muted)" }}
                tickFormatter={formatMonth}
                minTickGap={40}
              />
              <YAxis
                stroke="var(--border)"
                style={{ fontSize: 9, fontFamily: "monospace" }}
                tick={{ fill: "var(--muted)" }}
                tickFormatter={(v: number) => `${v.toFixed(0)}%`}
              />
              <ReferenceLine
                y={0}
                stroke="var(--muted-foreground)"
                strokeWidth={1}
              />
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(value: any, name?: string) => [
                  `${Number(value).toFixed(2)}%`,
                  name === "predicted" ? "Predicted" : "Actual",
                ]}
                labelFormatter={(label: string) => label}
              />
              <Bar dataKey="predicted" fill="#3b82f6" opacity={0.7} radius={[1, 1, 0, 0]} />
              <Bar dataKey="actual" radius={[1, 1, 0, 0]}>
                {barData.map((entry, index) => (
                  <Cell
                    key={`cell-${index}`}
                    fill={entry.actual >= 0 ? "#10b981" : "#ef4444"}
                    opacity={0.8}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <div
            style={{
              display: "flex",
              gap: 16,
              justifyContent: "center",
              marginTop: 6,
              fontSize: 9,
              fontFamily: "monospace",
              color: "var(--muted)",
            }}
          >
            <span>
              <span style={{ color: "#3b82f6" }}>&#9632;</span> Predicted
            </span>
            <span>
              <span style={{ color: "#10b981" }}>&#9632;</span> Actual (+)
            </span>
            <span>
              <span style={{ color: "#ef4444" }}>&#9632;</span> Actual (-)
            </span>
          </div>
        </div>

        {/* Cumulative Return */}
        <div style={chartCardStyle}>
          <div style={sectionTitle}>CUMULATIVE RETURN (ACTUAL)</div>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart
              data={cumData}
              margin={{ top: 5, right: 5, left: -20, bottom: 5 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="var(--chart-grid)"
                vertical={false}
              />
              <XAxis
                dataKey="month"
                stroke="var(--border)"
                style={{ fontSize: 9, fontFamily: "monospace" }}
                tick={{ fill: "var(--muted)" }}
                tickFormatter={formatMonth}
                minTickGap={40}
              />
              <YAxis
                stroke="var(--border)"
                style={{ fontSize: 9, fontFamily: "monospace" }}
                tick={{ fill: "var(--muted)" }}
                tickFormatter={(v: number) => `${v.toFixed(0)}%`}
              />
              <ReferenceLine
                y={0}
                stroke="var(--muted-foreground)"
                strokeWidth={1}
              />
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(value: any) => [
                  `${Number(value).toFixed(1)}%`,
                  "Cumulative",
                ]}
                labelFormatter={(label: string) => label}
              />
              <Line
                type="monotone"
                dataKey="cumReturn"
                stroke="#3b82f6"
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Prediction History Table */}
      <div
        style={{
          marginBottom: 16,
          borderRadius: 2,
          border: "1px solid var(--terminal-border)",
          background: "var(--terminal-bg)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: "8px 12px",
            borderBottom: "1px solid var(--terminal-border)",
          }}
        >
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              fontFamily: "monospace",
              color: "var(--foreground)",
            }}
          >
            PREDICTION HISTORY
          </span>
          <span
            style={{
              fontSize: 9,
              color: "var(--muted)",
              fontFamily: "monospace",
              marginLeft: 8,
            }}
          >
            {predictions.length} PREDICTIONS
          </span>
        </div>
        <div style={{ maxHeight: 500, overflowY: "auto" }}>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontFamily: "monospace",
              fontSize: 9,
            }}
          >
            <thead>
              <tr
                style={{
                  borderBottom: "1px solid var(--terminal-border)",
                  position: "sticky",
                  top: 0,
                  background: "var(--terminal-bg)",
                  zIndex: 1,
                }}
              >
                {[
                  "DATE",
                  "PREDICTED",
                  "ACTUAL",
                  "ERROR",
                  "DIR",
                  "QUINTILE",
                  "CONFIDENCE",
                ].map((h) => (
                  <th
                    key={h}
                    style={{
                      textAlign: h === "DATE" ? "left" : "right",
                      padding: "6px 8px",
                      color: "var(--muted)",
                      fontWeight: 600,
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {predictions.map((p) => {
                const dateStr =
                  typeof p.prediction_date === "string"
                    ? p.prediction_date.slice(0, 10)
                    : p.prediction_date;
                const hasActual = p.actual_return !== null;
                const err = hasActual
                  ? Math.abs(
                      p.ensemble_prediction - (p.actual_return as number)
                    )
                  : null;
                return (
                  <tr
                    key={dateStr}
                    style={{
                      borderBottom: "1px solid var(--border-subtle)",
                    }}
                  >
                    <td
                      style={{
                        padding: "4px 8px",
                        color: "var(--foreground)",
                      }}
                    >
                      {dateStr}
                    </td>
                    <td
                      style={{
                        padding: "4px 8px",
                        textAlign: "right",
                        color:
                          p.ensemble_prediction >= 0
                            ? "var(--success)"
                            : "var(--danger)",
                      }}
                    >
                      {p.ensemble_prediction >= 0 ? "+" : ""}
                      {(p.ensemble_prediction * 100).toFixed(2)}%
                    </td>
                    <td
                      style={{
                        padding: "4px 8px",
                        textAlign: "right",
                        color: !hasActual
                          ? "var(--muted)"
                          : (p.actual_return as number) >= 0
                            ? "var(--success)"
                            : "var(--danger)",
                      }}
                    >
                      {hasActual
                        ? `${(p.actual_return as number) >= 0 ? "+" : ""}${((p.actual_return as number) * 100).toFixed(2)}%`
                        : "—"}
                    </td>
                    <td
                      style={{
                        padding: "4px 8px",
                        textAlign: "right",
                        color: "var(--foreground)",
                      }}
                    >
                      {err !== null ? `${(err * 100).toFixed(2)}%` : "—"}
                    </td>
                    <td
                      style={{
                        padding: "4px 8px",
                        textAlign: "right",
                        color:
                          p.direction_correct === null
                            ? "var(--muted)"
                            : p.direction_correct
                              ? "var(--success)"
                              : "var(--danger)",
                        fontWeight: 600,
                      }}
                    >
                      {p.direction_correct === null
                        ? "—"
                        : p.direction_correct
                          ? "Y"
                          : "N"}
                    </td>
                    <td
                      style={{
                        padding: "4px 8px",
                        textAlign: "right",
                        color:
                          p.quintile >= 4
                            ? "var(--success)"
                            : p.quintile <= 2
                              ? "var(--danger)"
                              : "var(--foreground)",
                        fontWeight: 600,
                      }}
                    >
                      Q{p.quintile}
                    </td>
                    <td
                      style={{
                        padding: "4px 8px",
                        textAlign: "right",
                        color: "var(--muted)",
                      }}
                    >
                      {(p.confidence_score * 100).toFixed(0)}%
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Glossary */}
      <div style={{ ...sectionStyle, marginBottom: 16 }}>
        <div style={sectionTitle}>GLOSSARY</div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            gap: "6px 24px",
            fontSize: 9,
            fontFamily: "monospace",
            lineHeight: 1.5,
          }}
        >
          {GLOSSARY.map((g) => (
            <div key={g.term}>
              <span style={{ color: "var(--accent)", fontWeight: 700 }}>
                {g.term}
              </span>
              <span style={{ color: "var(--muted)" }}> &mdash; {g.def}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
