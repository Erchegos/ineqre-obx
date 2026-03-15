"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  AreaChart,
  Area,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";

type BacktestRun = {
  id: string;
  model_version: string;
  n_months: number;
  n_total_predictions: number;
  overall_hit_rate: number;
  overall_mae: number;
  overall_ic_mean: number;
  overall_ic_ir: number;
  long_short_total_return: number;
  long_short_annualized: number;
  long_short_sharpe: number;
  long_short_max_drawdown: number;
  p90_calibration: number;
  metrics_by_size_regime: Record<
    string,
    { ic: number; hitRate: number; avgLS: number; n: number }
  >;
  config: Record<string, any>;
  created_at: string;
};

type MonthlyData = {
  month: string;
  n_tickers: number;
  hit_rate: number;
  mae: number;
  ic: number;
  long_return: number;
  short_return: number;
  long_short_return: number;
  p90_calibration: number;
};

const cardStyle = {
  padding: 10,
  borderRadius: 2,
  background: "#161b22",
  border: "1px solid #30363d",
};

const labelStyle = {
  fontSize: 9,
  color: "rgba(255,255,255,0.5)",
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
  color: "rgba(255,255,255,0.5)",
  marginTop: 2,
  fontFamily: "monospace" as const,
  fontWeight: 600,
};

const tooltipStyle = {
  background: "#161b22",
  border: "1px solid #30363d",
  borderRadius: 2,
  fontSize: 10,
  fontFamily: "monospace",
  padding: "6px 8px",
  color: "#fff",
};

const chartCardStyle = {
  padding: 12,
  borderRadius: 2,
  border: "1px solid #30363d",
  background: "#161b22",
};

const sectionStyle = {
  padding: 12,
  borderRadius: 2,
  border: "1px solid #30363d",
  background: "#161b22",
};

const sectionTitle = {
  fontSize: 10,
  fontWeight: 700,
  marginBottom: 10,
  color: "#fff",
  fontFamily: "monospace" as const,
};

const REGIME_ORDER = ["microcap", "small", "mid", "large", "mega"];

const GLOSSARY = [
  { term: "IC", def: "Information Coefficient — Spearman rank correlation between predicted and actual returns each month. Higher means better ranking ability." },
  { term: "ICIR", def: "IC Information Ratio — Mean IC divided by its standard deviation. Measures consistency of predictive power. Above 0.5 is strong." },
  { term: "L/S", def: "Long-Short — Strategy that buys top-quintile predicted stocks (Q5) and sells bottom-quintile (Q1). Return = Long minus Short." },
  { term: "Hit Rate", def: "Percentage of predictions where the direction (up/down) was correct. 50% is random." },
  { term: "MAE", def: "Mean Absolute Error — Average of |predicted return - actual return|. Lower is more accurate." },
  { term: "Sharpe", def: "Risk-adjusted return — annualized return divided by annualized volatility. Above 0.5 is decent." },
  { term: "Quintile", def: "Stocks ranked 1-5 each month by predicted return. Q5 = highest predicted, Q1 = lowest predicted." },
  { term: "Calibration", def: "Percentage of actual returns falling within the predicted confidence interval. P90 should capture ~90%." },
  { term: "Max DD", def: "Maximum Drawdown — Largest peak-to-trough cumulative loss of the L/S strategy." },
];

export default function BacktestPage() {
  const [run, setRun] = useState<BacktestRun | null>(null);
  const [monthly, setMonthly] = useState<MonthlyData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchBacktest() {
      try {
        const res = await fetch("/api/backtest");
        if (!res.ok) throw new Error("Failed to fetch backtest data");
        const data = await res.json();
        if (!data.success) throw new Error(data.error || "Unknown error");
        setRun(data.run);
        setMonthly(data.monthly);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    fetchBacktest();
  }, []);

  if (loading) {
    return (
      <div
        style={{
          maxWidth: 1600,
          margin: "0 auto",
          padding: "100px 16px 16px",
          fontFamily: "monospace",
          color: "rgba(255,255,255,0.5)",
          textAlign: "center",
        }}
      >
        LOADING BACKTEST DATA...
      </div>
    );
  }

  if (error || !run) {
    return (
      <div
        style={{
          maxWidth: 1600,
          margin: "0 auto",
          padding: "100px 16px 16px",
          fontFamily: "monospace",
          color: "#ef4444",
          textAlign: "center",
        }}
      >
        {error || "No backtest data available"}
      </div>
    );
  }

  const chartData = monthly.map((m, i) => {
    const cumReturn = monthly
      .slice(0, i + 1)
      .reduce((sum, row) => sum + row.long_short_return, 0);
    return {
      month: typeof m.month === "string" ? m.month.slice(0, 10) : m.month,
      cumReturn: cumReturn * 100,
      ic: m.ic,
      lsReturn: m.long_short_return * 100,
    };
  });

  const formatMonth = (val: string) => {
    if (!val || val.length < 7) return val;
    return val.slice(2, 7);
  };

  const hitColor =
    run.overall_hit_rate > 0.55
      ? "#10b981"
      : run.overall_hit_rate > 0.5
        ? "#f59e0b"
        : "#ef4444";

  const lsColor =
    run.long_short_annualized > 0 ? "#10b981" : "#ef4444";

  const calColor =
    run.p90_calibration > 0.85 && run.p90_calibration < 0.95
      ? "#10b981"
      : "#f59e0b";

  return (
    <div
      style={{
        maxWidth: 1600,
        margin: "0 auto",
        padding: 16,
        fontFamily: "monospace",
        background: "#0a0a0a",
      }}
    >
      {/* Header */}
      <div
        style={{
          marginBottom: 16,
          padding: "12px 16px",
          background: "#161b22",
          border: "1px solid #30363d",
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
                  color: "#fff",
                  fontFamily: "monospace",
                  letterSpacing: "0.5px",
                }}
              >
                BACKTEST: 19-FACTOR ML MODEL
              </h1>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  fontFamily: "monospace",
                  padding: "2px 8px",
                  background: "#3b82f6",
                  color: "#ffffff",
                  borderRadius: 2,
                }}
              >
                {run.model_version}
              </span>
            </div>
            <div
              style={{
                fontSize: 10,
                color: "rgba(255,255,255,0.5)",
                fontFamily: "monospace",
              }}
            >
              {run.n_months} MONTHS &bull; {run.n_total_predictions.toLocaleString()} PREDICTIONS &bull; WALK-FORWARD OUT-OF-SAMPLE
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => window.history.back()}
              style={{
                fontSize: 10,
                color: "#3b82f6",
                textDecoration: "none",
                fontFamily: "monospace",
                fontWeight: 600,
                padding: "6px 12px",
                border: "1px solid #3b82f6",
                borderRadius: 2,
                background: "#0d1117",
                cursor: "pointer",
              }}
            >
              &larr; BACK TO STOCK BACKTEST
            </button>
            <Link
              href="/"
              style={{
                fontSize: 10,
                color: "rgba(255,255,255,0.5)",
                textDecoration: "none",
                fontFamily: "monospace",
                fontWeight: 600,
                padding: "6px 12px",
                border: "1px solid #30363d",
                borderRadius: 2,
                background: "#0d1117",
              }}
            >
              HOME
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
          <div style={labelStyle}>DIRECTION ACCURACY</div>
          <div style={{ ...valueStyle, color: hitColor }}>
            {(run.overall_hit_rate * 100).toFixed(1)}%
          </div>
          <div style={subLabelStyle}>HIT RATE (BASELINE 50%)</div>
        </div>

        <div
          style={{
            ...cardStyle,
            borderColor: "#06b6d4",
            borderWidth: 2,
          }}
        >
          <div style={labelStyle}>INFORMATION COEFFICIENT</div>
          <div style={{ ...valueStyle, color: "#06b6d4" }}>
            {run.overall_ic_mean.toFixed(3)}
          </div>
          <div style={subLabelStyle}>
            ICIR: {run.overall_ic_ir.toFixed(3)}
          </div>
        </div>

        <div style={{ ...cardStyle, borderColor: lsColor, borderWidth: 2 }}>
          <div style={labelStyle}>LONG-SHORT RETURN</div>
          <div style={{ ...valueStyle, color: lsColor }}>
            {run.long_short_annualized >= 0 ? "+" : ""}
            {(run.long_short_annualized * 100).toFixed(1)}%
          </div>
          <div style={subLabelStyle}>
            ANNUALIZED &bull; SHARPE {run.long_short_sharpe.toFixed(2)}
          </div>
        </div>

        <div style={{ ...cardStyle, borderColor: calColor, borderWidth: 2 }}>
          <div style={labelStyle}>P90 CALIBRATION</div>
          <div style={{ ...valueStyle, color: calColor }}>
            {(run.p90_calibration * 100).toFixed(1)}%
          </div>
          <div style={subLabelStyle}>TARGET: 90%</div>
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
        {/* Monthly IC */}
        <div style={chartCardStyle}>
          <div style={sectionTitle}>
            MONTHLY INFORMATION COEFFICIENT
          </div>
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart
              data={chartData}
              margin={{ top: 5, right: 5, left: -20, bottom: 5 }}
            >
              <defs>
                <linearGradient id="icFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="#21262d"
                vertical={false}
              />
              <XAxis
                dataKey="month"
                stroke="#30363d"
                style={{ fontSize: 9, fontFamily: "monospace" }}
                tick={{ fill: "rgba(255,255,255,0.5)" }}
                tickFormatter={formatMonth}
                minTickGap={50}
              />
              <YAxis
                stroke="#30363d"
                style={{ fontSize: 9, fontFamily: "monospace" }}
                tick={{ fill: "rgba(255,255,255,0.5)" }}
                tickFormatter={(v: number) => v.toFixed(1)}
              />
              <ReferenceLine
                y={0}
                stroke="rgba(255,255,255,0.5)"
                strokeWidth={1}
              />
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(value: any) => [value.toFixed(3), "IC"]}
                labelFormatter={(label: string) => label?.slice(0, 7)}
              />
              <Area
                type="monotone"
                dataKey="ic"
                stroke="#10b981"
                strokeWidth={1.5}
                fill="url(#icFill)"
                fillOpacity={1}
                dot={false}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Cumulative L/S Return */}
        <div style={chartCardStyle}>
          <div style={sectionTitle}>
            CUMULATIVE LONG-SHORT RETURN
          </div>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart
              data={chartData}
              margin={{ top: 5, right: 5, left: -20, bottom: 5 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="#21262d"
                vertical={false}
              />
              <XAxis
                dataKey="month"
                stroke="#30363d"
                style={{ fontSize: 9, fontFamily: "monospace" }}
                tick={{ fill: "rgba(255,255,255,0.5)" }}
                tickFormatter={formatMonth}
                minTickGap={50}
              />
              <YAxis
                stroke="#30363d"
                style={{ fontSize: 9, fontFamily: "monospace" }}
                tick={{ fill: "rgba(255,255,255,0.5)" }}
                tickFormatter={(v: number) => `${v.toFixed(0)}%`}
              />
              <ReferenceLine
                y={0}
                stroke="rgba(255,255,255,0.5)"
                strokeWidth={1}
              />
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(value: any) => [
                  `${value.toFixed(1)}%`,
                  "Cumulative L/S",
                ]}
                labelFormatter={(label: string) => label?.slice(0, 7)}
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

      {/* Size Regime Table */}
      <div style={{ ...sectionStyle, marginBottom: 16 }}>
        <div style={sectionTitle}>
          PERFORMANCE BY SIZE REGIME
        </div>
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontFamily: "monospace",
            fontSize: 10,
          }}
        >
          <thead>
            <tr style={{ borderBottom: "1px solid #30363d" }}>
              {["REGIME", "N", "HIT RATE", "IC", "AVG L/S"].map((h) => (
                <th
                  key={h}
                  style={{
                    textAlign: h === "REGIME" ? "left" : "right",
                    padding: 8,
                    color: "rgba(255,255,255,0.5)",
                    fontWeight: 600,
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {REGIME_ORDER.filter(
              (r) => run.metrics_by_size_regime?.[r]
            ).map((regime) => {
              const m = run.metrics_by_size_regime[regime];
              return (
                <tr
                  key={regime}
                  style={{ borderBottom: "1px solid #21262d" }}
                >
                  <td style={{ padding: 8, color: "#fff", fontWeight: 600, textTransform: "uppercase" }}>
                    {regime}
                  </td>
                  <td style={{ padding: 8, textAlign: "right", color: "rgba(255,255,255,0.5)" }}>
                    {m.n.toLocaleString()}
                  </td>
                  <td style={{ padding: 8, textAlign: "right", color: m.hitRate > 0.55 ? "#10b981" : m.hitRate > 0.5 ? "#fff" : "#ef4444" }}>
                    {(m.hitRate * 100).toFixed(1)}%
                  </td>
                  <td style={{ padding: 8, textAlign: "right", color: m.ic > 0.05 ? "#10b981" : m.ic > 0 ? "#fff" : "#ef4444" }}>
                    {m.ic.toFixed(3)}
                  </td>
                  <td style={{ padding: 8, textAlign: "right", color: m.avgLS > 0 ? "#10b981" : "#ef4444" }}>
                    {m.avgLS >= 0 ? "+" : ""}{(m.avgLS * 100).toFixed(2)}%
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Monthly Detail Table */}
      <div
        style={{
          marginBottom: 16,
          borderRadius: 2,
          border: "1px solid #30363d",
          background: "#161b22",
          overflow: "hidden",
        }}
      >
        <div style={{ padding: "8px 12px", borderBottom: "1px solid #30363d" }}>
          <span style={{ fontSize: 10, fontWeight: 700, fontFamily: "monospace", color: "#fff" }}>
            MONTHLY BREAKDOWN
          </span>
          <span style={{ fontSize: 9, color: "rgba(255,255,255,0.5)", fontFamily: "monospace", marginLeft: 8 }}>
            {monthly.length} MONTHS
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
                  borderBottom: "1px solid #30363d",
                  position: "sticky",
                  top: 0,
                  background: "#161b22",
                  zIndex: 1,
                }}
              >
                {["MONTH", "TICKERS", "IC", "HIT %", "MAE %", "LONG %", "SHORT %", "L/S %"].map((h) => (
                  <th
                    key={h}
                    style={{
                      textAlign: h === "MONTH" ? "left" : "right",
                      padding: "6px 8px",
                      color: "rgba(255,255,255,0.5)",
                      fontWeight: 600,
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {monthly.map((m) => {
                const monthStr = typeof m.month === "string" ? m.month.slice(0, 7) : m.month;
                return (
                  <tr key={monthStr} style={{ borderBottom: "1px solid #21262d" }}>
                    <td style={{ padding: "4px 8px", color: "#fff" }}>{monthStr}</td>
                    <td style={{ padding: "4px 8px", textAlign: "right", color: "rgba(255,255,255,0.5)" }}>{m.n_tickers}</td>
                    <td style={{ padding: "4px 8px", textAlign: "right", color: m.ic > 0 ? "#10b981" : "#ef4444" }}>{m.ic.toFixed(3)}</td>
                    <td style={{ padding: "4px 8px", textAlign: "right", color: m.hit_rate > 0.55 ? "#10b981" : m.hit_rate < 0.5 ? "#ef4444" : "#fff" }}>{(m.hit_rate * 100).toFixed(1)}</td>
                    <td style={{ padding: "4px 8px", textAlign: "right", color: "#fff" }}>{(m.mae * 100).toFixed(2)}</td>
                    <td style={{ padding: "4px 8px", textAlign: "right", color: m.long_return > 0 ? "#10b981" : "#ef4444" }}>{(m.long_return * 100).toFixed(2)}</td>
                    <td style={{ padding: "4px 8px", textAlign: "right", color: m.short_return > 0 ? "#10b981" : "#ef4444" }}>{(m.short_return * 100).toFixed(2)}</td>
                    <td style={{ padding: "4px 8px", textAlign: "right", fontWeight: 600, color: m.long_short_return > 0 ? "#10b981" : "#ef4444" }}>
                      {m.long_short_return >= 0 ? "+" : ""}{(m.long_short_return * 100).toFixed(2)}
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
              <span style={{ color: "#3b82f6", fontWeight: 700 }}>{g.term}</span>
              <span style={{ color: "rgba(255,255,255,0.5)" }}> &mdash; {g.def}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Methodology / Caveat */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div style={sectionStyle}>
          <div style={{ ...sectionTitle, marginBottom: 8 }}>METHODOLOGY</div>
          <div style={{ fontSize: 9, color: "rgba(255,255,255,0.5)", fontFamily: "monospace", lineHeight: 1.6 }}>
            <div><strong>BACKTEST:</strong> Walk-forward out-of-sample, monthly rebalance, no lookahead bias</div>
            <div><strong>UNIVERSE:</strong> Oslo Bors equities with factor data on rebalance date</div>
            <div><strong>STRATEGY:</strong> Long Q5 (top quintile predicted), Short Q1 (bottom quintile)</div>
            <div><strong>MODEL:</strong> 19-factor ensemble (Gradient Boosting 60% + Random Forest 40%)</div>
            <div><strong>RETURNS:</strong> Log returns over 21 trading days (1 month forward)</div>
            <div>
              <strong>MAE:</strong> {(run.overall_mae * 100).toFixed(2)}% &bull;{" "}
              <strong>MAX DD:</strong> {(run.long_short_max_drawdown * 100).toFixed(1)}% &bull;{" "}
              <strong>TOTAL L/S:</strong> {run.long_short_total_return >= 0 ? "+" : ""}{(run.long_short_total_return * 100).toFixed(1)}%
            </div>
          </div>
        </div>

        <div
          style={{
            padding: 12,
            borderRadius: 2,
            border: "1px solid #f59e0b",
            background: "rgba(245,158,11,0.08)",
          }}
        >
          <div style={{ fontSize: 10, fontWeight: 700, marginBottom: 8, color: "#f59e0b", fontFamily: "monospace" }}>
            IMPORTANT CAVEAT
          </div>
          <div style={{ fontSize: 9, color: "rgba(255,255,255,0.5)", fontFamily: "monospace", lineHeight: 1.6 }}>
            Model weights (FACTOR_WEIGHTS_GB, FACTOR_WEIGHTS_RF) are fixed
            constants derived from academic research &mdash; not trained on
            historical data. This backtest measures how well these
            research-derived factor premia apply to Oslo Bors equities. It is
            not a true out-of-sample test of a trained ML model. Past
            performance is not indicative of future results.
          </div>
        </div>
      </div>
    </div>
  );
}
