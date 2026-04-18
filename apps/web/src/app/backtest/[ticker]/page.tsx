"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import PageNav from "@/components/ui/PageNav";
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
import ModelModeToggle from "@/components/ModelModeToggle";

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

type OptimizerData = {
  hasOptimized: boolean;
  config?: {
    factors: string[];
    gb_weight: number;
    rf_weight: number;
    n_factors: number;
    optimization_method: string;
    optimized_at: string;
  };
  performance?: {
    optimized: {
      hit_rate: number;
      mae: number;
      r2: number;
      ic: number;
      sharpe: number;
    };
    default_baseline: {
      hit_rate: number;
      mae: number;
      r2: number;
    };
    improvement: {
      hit_rate_delta: number;
      mae_delta: number;
    };
  };
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
  border: "1px solid #3b82f6",
  borderRadius: 4,
  boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
  fontSize: 11,
  fontFamily: "monospace",
  padding: "8px 12px",
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

const GLOSSARY = [
  { term: "Hit Rate", def: "Percentage of predictions where the direction (up/down) was correct. 50% is random." },
  { term: "MAE", def: "Mean Absolute Error — Average of |predicted return - actual return|. Lower is more accurate." },
  { term: "Quintile", def: "Stocks ranked 1-5 each month by predicted return. Q5 = highest predicted, Q1 = lowest predicted." },
  { term: "Confidence", def: "Model confidence score based on ensemble tree agreement. Higher means models agree more on the prediction." },
  { term: "Ensemble", def: "Combined prediction from Gradient Boosting (60%) and Random Forest (40%) models." },
  { term: "Direction", def: "Whether the model correctly predicted up or down movement. Check = correct, cross = incorrect." },
  { term: "Sharpe Ratio", def: "Risk-adjusted return: (Return - Risk-free) / Volatility. Higher is better. >1.0 is excellent." },
  { term: "Sortino Ratio", def: "Like Sharpe but only penalizes downside volatility. Better for asymmetric strategies." },
  { term: "Calmar Ratio", def: "Annualized return / Max drawdown. Measures return per unit of drawdown risk." },
  { term: "Max Drawdown", def: "Largest peak-to-trough decline. Shows worst-case loss if you invested at the peak." },
];

export default function TickerBacktestPage() {
  const params = useParams();
  const ticker = (params?.ticker as string)?.toUpperCase() || "";

  const [summary, setSummary] = useState<Summary | null>(null);
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [availableTickers, setAvailableTickers] = useState<string[]>([]);
  const [mode, setMode] = useState<"default" | "optimized">("default");
  const [optimizerData, setOptimizerData] = useState<OptimizerData | null>(null);
  const [strategy, setStrategy] = useState<"long-short" | "long-only">("long-only");

  // Fetch optimizer config on mount
  useEffect(() => {
    if (!ticker) return;
    fetch(`/api/optimizer-config/${ticker}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.success) {
          setOptimizerData(data);
        }
      })
      .catch(() => {});
  }, [ticker]);


  useEffect(() => {
    if (!ticker) return;

    async function fetchData() {
      setLoading(true);
      setError(null);
      try {
        // Pass model_type to get optimized predictions when in optimized mode
        const modelType = mode === "optimized" ? "optimized" : "default";
        const res = await fetch(`/api/backtest/${ticker}?model_type=${modelType}`);
        const data = await res.json();
        if (!res.ok || !data.success) {
          if (data.availableTickers) setAvailableTickers(data.availableTickers);
          throw new Error(data.message || data.error || "Failed to fetch backtest data");
        }
        setSummary(data.summary);
        setPredictions(data.predictions);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [ticker, mode]);

  const hasOptimized = optimizerData?.hasOptimized ?? false;
  const optPerf = optimizerData?.performance;

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
        LOADING BACKTEST DATA FOR {ticker}...
      </div>
    );
  }

  if (error || !summary) {
    const hasAvailable = availableTickers.length > 0;
    return (
      <div
        style={{
          maxWidth: 1200,
          margin: "0 auto",
          padding: "60px 16px 16px",
          fontFamily: "monospace",
        }}
      >
        {/* Processing banner */}
        <div
          style={{
            padding: "24px 32px",
            background: "#161b22",
            border: "1px solid #f59e0b",
            borderRadius: 2,
            marginBottom: 24,
            textAlign: "center",
          }}
        >
          <div
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: "#f59e0b",
              marginBottom: 8,
            }}
          >
            INSUFFICIENT BACKTEST DATA FOR {ticker}
          </div>
          <div
            style={{
              fontSize: 11,
              color: "rgba(255,255,255,0.5)",
              lineHeight: 1.6,
              maxWidth: 600,
              margin: "0 auto",
            }}
          >
            {error || "This stock does not have enough realized predictions for a meaningful backtest. At least 3 monthly predictions with actual returns are needed."}
          </div>
          <div
            style={{
              marginTop: 16,
              display: "flex",
              justifyContent: "center",
              gap: 12,
            }}
          >
            <Link
              href={`/predictions/${ticker}`}
              style={{
                fontSize: 10,
                color: "#3b82f6",
                textDecoration: "none",
                fontWeight: 600,
                padding: "6px 14px",
                border: "1px solid #3b82f6",
                borderRadius: 2,
                background: "#0d1117",
              }}
            >
              VIEW {ticker} PREDICTIONS
            </Link>
            <Link
              href="/backtest"
              style={{
                fontSize: 10,
                color: "#10b981",
                textDecoration: "none",
                fontWeight: 600,
                padding: "6px 14px",
                border: "1px solid #10b981",
                borderRadius: 2,
                background: "#0d1117",
              }}
            >
              AGGREGATE BACKTEST
            </Link>
          </div>
        </div>

        {/* Available stocks grid */}
        {hasAvailable && (
          <div
            style={{
              padding: 16,
              background: "#161b22",
              border: "1px solid #30363d",
              borderRadius: 2,
            }}
          >
            <div
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: "#fff",
                marginBottom: 4,
              }}
            >
              STOCKS WITH BACKTEST DATA ({availableTickers.length})
            </div>
            <div
              style={{
                fontSize: 9,
                color: "rgba(255,255,255,0.5)",
                marginBottom: 12,
              }}
            >
              Click any ticker to view its walk-forward backtest results
            </div>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 4,
              }}
            >
              {availableTickers.map((t) => (
                <Link
                  key={t}
                  href={`/backtest/${t}`}
                  style={{
                    fontSize: 9,
                    fontWeight: 600,
                    padding: "3px 8px",
                    borderRadius: 2,
                    textDecoration: "none",
                    background:
                      t === ticker
                        ? "#ef4444"
                        : "#161b22",
                    color:
                      t === ticker
                        ? "#fff"
                        : "#3b82f6",
                    border: `1px solid ${
                      t === ticker
                        ? "#ef4444"
                        : "#30363d"
                    }`,
                  }}
                >
                  {t}
                </Link>
              ))}
            </div>
          </div>
        )}
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

  // Calculate cumulative returns for both buy-and-hold and strategy
  const cumData = withActual.map((p, i) => {
    const cumReturn = withActual
      .slice(0, i + 1)
      .reduce((sum, r) => {
        const actualRet = r.actual_return as number;
        const predicted = r.ensemble_prediction;
        let strategyReturn: number;
        if (strategy === "long-only") {
          // Long only: go long when prediction > 0, stay flat otherwise
          strategyReturn = predicted >= 0 ? actualRet : 0;
        } else {
          // Long/short: go long when prediction > 0, short when < 0
          strategyReturn = predicted >= 0 ? actualRet : -actualRet;
        }
        return sum + strategyReturn;
      }, 0);

    const buyHoldReturn = withActual
      .slice(0, i + 1)
      .reduce((sum, r) => sum + (r.actual_return as number), 0);

    const month =
      typeof p.prediction_date === "string"
        ? p.prediction_date.slice(0, 7)
        : p.prediction_date;
    return {
      month,
      cumReturn: cumReturn * 100,
      buyHold: buyHoldReturn * 100,
    };
  });

  // Final returns for display
  const finalStrategyReturn = cumData.length > 0 ? cumData[cumData.length - 1].cumReturn : 0;
  const finalBuyHoldReturn = cumData.length > 0 ? cumData[cumData.length - 1].buyHold : 0;

  const formatMonth = (val: string) => {
    if (!val || val.length < 7) return val;
    return val.slice(2, 7);
  };

  // Color helpers for default mode
  const defaultHitColor =
    summary.hit_rate > 0.55
      ? "#10b981"
      : summary.hit_rate > 0.5
        ? "#f59e0b"
        : "#ef4444";

  const quintileColor =
    summary.avg_quintile > 3.2
      ? "#10b981"
      : summary.avg_quintile > 2.8
        ? "#fff"
        : "#ef4444";

  // Optimized mode: use optimizer's precomputed metrics
  const optHitRate = optPerf?.optimized.hit_rate ?? 0;
  const optHitColor = optHitRate > 55 ? "#10b981" : optHitRate > 50 ? "#f59e0b" : "#ef4444";

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
      <PageNav crumbs={[{label:"Home",href:"/"},{label:"Stocks",href:"/stocks"},{label:ticker,href:`/stocks/${ticker}`},{label:"Backtest"}]} actions={[{label:"Predictions",href:`/predictions/${ticker}`},{label:"Volatility",href:`/volatility/${ticker}`},{label:"Montecarlo",href:`/montecarlo/${ticker}`},{label:"Options",href:`/options/${ticker}.US`},{label:"All Backtests",href:"/backtest"}]} />
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
            alignItems: "flex-start",
          }}
        >
          <div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                marginBottom: 8,
              }}
            >
              <h1
                style={{
                  fontSize: 18,
                  fontWeight: 700,
                  color: "#fff",
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
                    padding: "3px 10px",
                    background: "#3b82f6",
                    color: "#ffffff",
                    borderRadius: 2,
                    textTransform: "uppercase",
                  }}
                >
                  {summary.size_regime}
                </span>
              )}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <ModelModeToggle
                mode={mode}
                onChange={setMode}
                hasOptimized={hasOptimized}
              />
              <div
                style={{
                  fontSize: 10,
                  color: "rgba(255,255,255,0.5)",
                  fontFamily: "monospace",
                }}
              >
                {mode === "optimized" && optPerf
                  ? `OPTIMIZER WALK-FORWARD • ${optPerf.optimized.hit_rate.toFixed(1)}% HIT RATE • ${optimizerData?.config?.n_factors} FACTORS`
                  : `${summary.n_predictions} REALIZED PREDICTIONS • ${summary.n_total} TOTAL • WALK-FORWARD OUT-OF-SAMPLE`}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Summary Cards - switches between default and optimized */}
      {mode === "optimized" && optPerf ? (
        <>
          {/* Optimized mode: 5 cards with optimizer's precomputed metrics */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(5, 1fr)",
              gap: 8,
              marginBottom: 8,
            }}
          >
            <div style={{ ...cardStyle, borderColor: optHitColor, borderWidth: 2 }}>
              <div style={labelStyle}>HIT RATE</div>
              <div style={{ ...valueStyle, color: optHitColor }}>
                {optPerf.optimized.hit_rate.toFixed(1)}%
              </div>
              <div style={subLabelStyle}>DIRECTION ACCURACY</div>
            </div>

            <div style={{ ...cardStyle, borderColor: "#06b6d4", borderWidth: 2 }}>
              <div style={labelStyle}>MAE</div>
              <div style={{ ...valueStyle, color: "#06b6d4" }}>
                {optPerf.optimized.mae.toFixed(2)}%
              </div>
              <div style={subLabelStyle}>MEAN ABSOLUTE ERROR</div>
            </div>

            <div style={{ ...cardStyle, borderColor: optPerf.optimized.r2 > 0 ? "#10b981" : "rgba(255,255,255,0.5)", borderWidth: 2 }}>
              <div style={labelStyle}>R²</div>
              <div style={{ ...valueStyle, color: optPerf.optimized.r2 > 0 ? "#10b981" : "rgba(255,255,255,0.5)" }}>
                {optPerf.optimized.r2.toFixed(3)}
              </div>
              <div style={subLabelStyle}>EXPLAINED VARIANCE</div>
            </div>

            <div style={{ ...cardStyle, borderColor: "#8b5cf6", borderWidth: 2 }}>
              <div style={labelStyle}>IC</div>
              <div style={{ ...valueStyle, color: "#8b5cf6" }}>
                {optPerf.optimized.ic.toFixed(3)}
              </div>
              <div style={subLabelStyle}>INFORMATION COEFF</div>
            </div>

            <div style={{ ...cardStyle, borderColor: optPerf.optimized.sharpe > 1 ? "#10b981" : "#f59e0b", borderWidth: 2 }}>
              <div style={labelStyle}>SHARPE</div>
              <div style={{ ...valueStyle, color: optPerf.optimized.sharpe > 1 ? "#10b981" : "#f59e0b" }}>
                {optPerf.optimized.sharpe.toFixed(2)}
              </div>
              <div style={subLabelStyle}>RISK-ADJ RETURN</div>
            </div>
          </div>

          {/* Improvement comparison banner */}
          <div
            style={{
              marginBottom: 16,
              padding: "8px 12px",
              background: "rgba(245, 158, 11, 0.1)",
              border: "1px solid #f59e0b",
              borderRadius: 2,
              fontFamily: "monospace",
              fontSize: 10,
              display: "flex",
              alignItems: "center",
              gap: 24,
            }}
          >
            <span style={{ color: "#f59e0b", fontWeight: 700 }}>
              IMPROVEMENT vs DEFAULT:
            </span>
            <span>
              <span style={{ color: "#fff", fontWeight: 600 }}>Hit Rate</span>{" "}
              <span style={{ color: optPerf.improvement.hit_rate_delta > 0 ? "#10b981" : "#ef4444" }}>
                {optPerf.improvement.hit_rate_delta > 0 ? "+" : ""}
                {optPerf.improvement.hit_rate_delta.toFixed(1)}pp
              </span>
              <span style={{ color: "rgba(255,255,255,0.5)", marginLeft: 4 }}>
                ({optPerf.default_baseline.hit_rate.toFixed(1)}% → {optPerf.optimized.hit_rate.toFixed(1)}%)
              </span>
            </span>
            <span>
              <span style={{ color: "#fff", fontWeight: 600 }}>MAE</span>{" "}
              <span style={{ color: optPerf.improvement.mae_delta > 0 ? "#10b981" : "#ef4444" }}>
                {optPerf.improvement.mae_delta > 0 ? "-" : "+"}
                {Math.abs(optPerf.improvement.mae_delta).toFixed(2)}%
              </span>
            </span>
            <span>
              <span style={{ color: "#fff", fontWeight: 600 }}>R²</span>{" "}
              <span style={{ color: "#10b981" }}>
                +{(optPerf.optimized.r2 - optPerf.default_baseline.r2).toFixed(3)}
              </span>
            </span>
          </div>
          <div
            style={{
              marginBottom: 8,
              padding: "6px 12px",
              background: "rgba(16, 185, 129, 0.1)",
              border: "1px solid #10b981",
              borderRadius: 2,
              fontFamily: "monospace",
              fontSize: 9,
              color: "#10b981",
            }}
          >
            Charts and predictions below use the optimized factor selection ({optimizerData?.config?.n_factors} factors).
          </div>
        </>
      ) : (
        /* Default mode: original 4 cards */
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: 8,
            marginBottom: 16,
          }}
        >
          <div style={{ ...cardStyle, borderColor: defaultHitColor, borderWidth: 2 }}>
            <div style={labelStyle}>HIT RATE</div>
            <div style={{ ...valueStyle, color: defaultHitColor }}>
              {(summary.hit_rate * 100).toFixed(1)}%
            </div>
            <div style={subLabelStyle}>DIRECTION ACCURACY</div>
          </div>

          <div
            style={{
              ...cardStyle,
              borderColor: "#06b6d4",
              borderWidth: 2,
            }}
          >
            <div style={labelStyle}>MAE</div>
            <div style={{ ...valueStyle, color: "#06b6d4" }}>
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
              borderColor: "#3b82f6",
              borderWidth: 2,
            }}
          >
            <div style={labelStyle}>CONFIDENCE</div>
            <div style={{ ...valueStyle, color: "#3b82f6" }}>
              {(summary.avg_confidence * 100).toFixed(0)}%
            </div>
            <div style={subLabelStyle}>AVG MODEL CONFIDENCE</div>
          </div>
        </div>
      )}


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
          <ResponsiveContainer width="100%" height={340}>
            <BarChart
              data={barData}
              margin={{ top: 5, right: 5, left: -20, bottom: 5 }}
              barGap={1}
              barSize={6}
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
                minTickGap={40}
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
                formatter={(value: any, name?: string) => [
                  <span key="val" style={{ color: "#10b981" }}>{Number(value).toFixed(2)}%</span>,
                  <span key="label" style={{ color: "#fff" }}>{name === "predicted" ? "Predicted" : "Actual"}</span>,
                ]}
                labelFormatter={(label: string) => <span style={{ color: "#fff", fontWeight: 600 }}>{label}</span>}
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
              color: "rgba(255,255,255,0.5)",
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

        {/* Cumulative Strategy Return */}
        <div style={chartCardStyle}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <div style={sectionTitle}>
              CUMULATIVE STRATEGY RETURN ({strategy === "long-only" ? "LONG ONLY" : "LONG/SHORT"})
            </div>
            <div style={{ display: "flex", gap: 0 }}>
              <button
                onClick={() => setStrategy("long-only")}
                style={{
                  fontSize: 8,
                  fontWeight: 600,
                  fontFamily: "monospace",
                  padding: "3px 8px",
                  border: "1px solid #30363d",
                  borderRadius: "3px 0 0 3px",
                  background: strategy === "long-only" ? "#3b82f6" : "#161b22",
                  color: strategy === "long-only" ? "#fff" : "rgba(255,255,255,0.5)",
                  cursor: "pointer",
                }}
              >
                LONG ONLY
              </button>
              <button
                onClick={() => setStrategy("long-short")}
                style={{
                  fontSize: 8,
                  fontWeight: 600,
                  fontFamily: "monospace",
                  padding: "3px 8px",
                  border: "1px solid #30363d",
                  borderLeft: "none",
                  borderRadius: "0 3px 3px 0",
                  background: strategy === "long-short" ? "#3b82f6" : "#161b22",
                  color: strategy === "long-short" ? "#fff" : "rgba(255,255,255,0.5)",
                  cursor: "pointer",
                }}
              >
                LONG/SHORT
              </button>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={340}>
            <LineChart
              data={cumData}
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
                minTickGap={40}
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
                formatter={(value, name) => [
                  <span key="val" style={{ color: Number(value) >= 0 ? "#10b981" : "#ef4444" }}>{Number(value).toFixed(1)}%</span>,
                  <span key="label" style={{ color: "#fff" }}>{name === "cumReturn" ? "Strategy" : "Buy & Hold"}</span>,
                ]}
                labelFormatter={(label) => <span style={{ color: "#fff", fontWeight: 600 }}>{label}</span>}
              />
              <Line
                type="monotone"
                dataKey="cumReturn"
                stroke="#10b981"
                strokeWidth={2}
                dot={false}
                isAnimationActive={true} animationDuration={800} animationEasing="ease-out"
                name="Strategy"
              />
              <Line
                type="monotone"
                dataKey="buyHold"
                stroke="#3b82f6"
                strokeWidth={1.5}
                strokeDasharray="5 5"
                dot={false}
                isAnimationActive={true} animationDuration={800} animationEasing="ease-out"
                name="Buy & Hold"
              />
            </LineChart>
          </ResponsiveContainer>
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              gap: 16,
              fontSize: 8,
              fontFamily: "monospace",
              color: "rgba(255,255,255,0.5)",
              marginTop: 6,
            }}
          >
            <span>
              <span style={{ color: "#10b981" }}>━━</span> Strategy: {finalStrategyReturn.toFixed(1)}%
            </span>
            <span>
              <span style={{ color: "#3b82f6" }}>- - -</span> Buy & Hold: {finalBuyHoldReturn.toFixed(1)}%
            </span>
          </div>
        </div>
      </div>

      {/* Prediction History Table */}
      <div
        style={{
          marginBottom: 16,
          borderRadius: 2,
          border: "1px solid #30363d",
          background: "#161b22",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: "8px 12px",
            borderBottom: "1px solid #30363d",
          }}
        >
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              fontFamily: "monospace",
              color: "#fff",
            }}
          >
            PREDICTION HISTORY
          </span>
          <span
            style={{
              fontSize: 9,
              color: "rgba(255,255,255,0.5)",
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
                  borderBottom: "1px solid #30363d",
                  position: "sticky",
                  top: 0,
                  background: "#161b22",
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
                      borderBottom: "1px solid #21262d",
                    }}
                  >
                    <td
                      style={{
                        padding: "4px 8px",
                        color: "#fff",
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
                            ? "#10b981"
                            : "#ef4444",
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
                          ? "rgba(255,255,255,0.5)"
                          : (p.actual_return as number) >= 0
                            ? "#10b981"
                            : "#ef4444",
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
                        color: "#fff",
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
                            ? "rgba(255,255,255,0.5)"
                            : p.direction_correct
                              ? "#10b981"
                              : "#ef4444",
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
                            ? "#10b981"
                            : p.quintile <= 2
                              ? "#ef4444"
                              : "#fff",
                        fontWeight: 600,
                      }}
                    >
                      Q{p.quintile}
                    </td>
                    <td
                      style={{
                        padding: "4px 8px",
                        textAlign: "right",
                        color: "rgba(255,255,255,0.5)",
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
              <span style={{ color: "#3b82f6", fontWeight: 700 }}>
                {g.term}
              </span>
              <span style={{ color: "rgba(255,255,255,0.5)" }}> &mdash; {g.def}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
