"use client";

import { useEffect, useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  ReferenceLine,
} from "recharts";

type Prediction = {
  ticker: string;
  prediction_date: string;
  target_date: string;
  ensemble_prediction: number;
  gb_prediction: number;
  rf_prediction: number;
  percentiles: {
    p05: number;
    p25: number;
    p50: number;
    p75: number;
    p95: number;
  };
  feature_importance: Record<string, number>;
  confidence_score: number;
  methodology?: {
    model_version: string;
    ensemble_weights?: { gb: number; rf: number };
    is_optimized?: boolean;
    n_factors?: number;
    selected_factors?: string[];
  };
};

type Props = {
  ticker: string;
  mode?: "default" | "optimized";
};

function formatPercent(value: number): string {
  const sign = value >= 0 ? "+" : "";
  return `${sign}${(value * 100).toFixed(2)}%`;
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  const day = date.getDate().toString().padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export default function PredictionChart({ ticker, mode = "default" }: Props) {
  const [prediction, setPrediction] = useState<Prediction | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  async function generatePrediction() {
    setGenerating(true);
    setError(null);

    try {
      const response = await fetch("/api/predictions/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker, mode }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to generate prediction");
      }

      const result = await response.json();
      setPrediction(result.prediction);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setGenerating(false);
    }
  }

  useEffect(() => {
    if (!ticker) return;

    async function fetchOrGenerate() {
      setLoading(true);
      setError(null);

      try {
        // Try to fetch existing prediction
        const modeParam = mode === "optimized" ? "?mode=optimized" : "";
        const response = await fetch(`/api/predictions/${ticker}${modeParam}`);

        if (response.ok) {
          const result = await response.json();
          if (result.success && result.predictions && result.predictions.length > 0) {
            setPrediction(result.predictions[0]);
            setLoading(false);
            return;
          }
        }

        // No existing prediction - auto-generate
        const genResponse = await fetch("/api/predictions/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ticker, mode }),
        });

        if (genResponse.ok) {
          const genResult = await genResponse.json();
          if (genResult.success && genResult.prediction) {
            setPrediction(genResult.prediction);
            return;
          }
        }

        // If generation also failed
        setPrediction(null);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }

    fetchOrGenerate();
  }, [ticker, mode]);

  if (loading) {
    return (
      <div
        style={{
          padding: 20,
          textAlign: "center",
          color: "var(--muted)",
          borderRadius: 2,
          border: "1px solid var(--terminal-border)",
          background: "var(--terminal-bg)",
        }}
      >
        <div style={{ fontSize: 11, fontFamily: "monospace" }}>Loading ML prediction...</div>
      </div>
    );
  }

  if (!prediction && !error) {
    return (
      <div
        style={{
          padding: 16,
          borderRadius: 2,
          border: "1px solid var(--terminal-border)",
          background: "var(--terminal-bg)",
        }}
      >
        <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 8, color: "var(--foreground)", fontFamily: "monospace" }}>
          NO PREDICTION DATA
        </div>
        <div style={{ fontSize: 10, color: "var(--muted)", marginBottom: 12, fontFamily: "monospace" }}>
          Generate prediction using current factor data
        </div>
        <button
          onClick={generatePrediction}
          disabled={generating}
          style={{
            padding: "6px 12px",
            borderRadius: 2,
            border: "1px solid var(--accent)",
            background: generating ? "var(--muted)" : "var(--accent)",
            color: "#ffffff",
            fontSize: 10,
            fontWeight: 600,
            cursor: generating ? "not-allowed" : "pointer",
            fontFamily: "monospace",
            letterSpacing: "0.5px",
          }}
        >
          {generating ? "GENERATING..." : "GENERATE"}
        </button>
      </div>
    );
  }

  if (error) {
    return (
      <div
        style={{
          padding: 16,
          borderRadius: 2,
          border: "1px solid var(--danger)",
          background: "var(--danger-bg)",
        }}
      >
        <div style={{ fontSize: 11, fontWeight: 600, color: "var(--danger)", marginBottom: 6, fontFamily: "monospace" }}>
          ERROR: {error}
        </div>
        <button
          onClick={generatePrediction}
          disabled={generating}
          style={{
            padding: "6px 12px",
            borderRadius: 2,
            border: "1px solid var(--accent)",
            background: generating ? "var(--muted)" : "var(--accent)",
            color: "#ffffff",
            fontSize: 10,
            fontWeight: 600,
            cursor: generating ? "not-allowed" : "pointer",
            fontFamily: "monospace",
          }}
        >
          {generating ? "GENERATING..." : "RETRY"}
        </button>
      </div>
    );
  }

  if (!prediction) return null;

  const ensemblePct = prediction.ensemble_prediction * 100;
  const p05 = prediction.percentiles.p05 * 100;
  const p25 = prediction.percentiles.p25 * 100;
  const p50 = prediction.percentiles.p50 * 100;
  const p75 = prediction.percentiles.p75 * 100;
  const p95 = prediction.percentiles.p95 * 100;
  const range90 = p95 - p05;
  const range50 = p75 - p25;

  const distributionData = [
    { name: "P05", value: p05, label: "5%" },
    { name: "P25", value: p25, label: "25%" },
    { name: "P50", value: p50, label: "50%" },
    { name: "P75", value: p75, label: "75%" },
    { name: "P95", value: p95, label: "95%" },
  ];

  const getColor = (value: number) => {
    if (value > 5) return "var(--success)";
    if (value > 0) return "#60a5fa";
    if (value > -5) return "#fbbf24";
    return "var(--danger)";
  };

  return (
    <div
      style={{
        borderRadius: 2,
        border: "1px solid var(--terminal-border)",
        background: "var(--terminal-bg)",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "8px 12px",
          background: "var(--card-bg)",
          borderBottom: "1px solid var(--terminal-border)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 11, fontWeight: 700, fontFamily: "monospace", color: "var(--foreground)" }}>
            ML FORECAST
          </span>
          <span style={{ fontSize: 9, color: "var(--muted)", fontFamily: "monospace" }}>
            {formatDate(prediction.prediction_date)} → {formatDate(prediction.target_date)}
          </span>
        </div>
        <button
          onClick={generatePrediction}
          disabled={generating}
          style={{
            padding: "4px 10px",
            borderRadius: 2,
            border: "1px solid var(--border)",
            background: "var(--input-bg)",
            color: "var(--foreground)",
            fontSize: 9,
            fontWeight: 600,
            cursor: generating ? "not-allowed" : "pointer",
            fontFamily: "monospace",
            opacity: generating ? 0.5 : 1,
          }}
        >
          {generating ? "UPDATING..." : "UPDATE"}
        </button>
      </div>

      {/* Main Metrics Grid */}
      <div style={{ padding: 12 }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: 8,
            marginBottom: 12,
          }}
        >
          {/* Ensemble Prediction */}
          <div
            style={{
              padding: 10,
              background: ensemblePct >= 0 ? "#10b981" : "#ef4444",
              borderRadius: 2,
            }}
          >
            <div style={{ fontSize: 9, color: "rgba(255,255,255,0.8)", marginBottom: 2, fontFamily: "monospace", fontWeight: 600 }}>
              PREDICTION
            </div>
            <div
              style={{
                fontSize: 22,
                fontWeight: 700,
                fontFamily: "monospace",
                color: "#ffffff",
                letterSpacing: "-0.5px",
              }}
            >
              {ensemblePct >= 0 ? "+" : ""}
              {ensemblePct.toFixed(2)}%
            </div>
            <div style={{ fontSize: 8, color: "rgba(255,255,255,0.7)", marginTop: 2, fontFamily: "monospace", fontWeight: 600 }}>
              ENSEMBLE
            </div>
          </div>

          {/* 90% CI */}
          <div
            style={{
              padding: 10,
              background: "var(--terminal-bg)",
              border: "1px solid var(--terminal-border)",
              borderRadius: 2,
            }}
          >
            <div style={{ fontSize: 9, color: "var(--muted)", marginBottom: 2, fontFamily: "monospace", fontWeight: 600 }}>
              90% CI
            </div>
            <div style={{ fontSize: 14, fontWeight: 600, fontFamily: "monospace", color: p05 >= 0 ? "#10b981" : "#ef4444" }}>
              {p05 >= 0 ? "+" : ""}{p05.toFixed(1)}%
            </div>
            <div style={{ fontSize: 14, fontWeight: 600, fontFamily: "monospace", color: p95 >= 0 ? "#10b981" : "#ef4444" }}>
              {p95 >= 0 ? "+" : ""}{p95.toFixed(1)}%
            </div>
          </div>

          {/* Uncertainty */}
          <div
            style={{
              padding: 10,
              background: "#f59e0b",
              borderRadius: 2,
            }}
          >
            <div style={{ fontSize: 9, color: "rgba(0,0,0,0.7)", marginBottom: 2, fontFamily: "monospace", fontWeight: 600 }}>
              UNCERTAINTY
            </div>
            <div style={{ fontSize: 18, fontWeight: 700, fontFamily: "monospace", color: "#000000" }}>
              ±{range90.toFixed(1)}%
            </div>
            <div style={{ fontSize: 8, color: "rgba(0,0,0,0.6)", marginTop: 2, fontFamily: "monospace", fontWeight: 600 }}>
              90% RANGE
            </div>
          </div>

          {/* Confidence */}
          <div
            style={{
              padding: 10,
              background: "#06b6d4",
              borderRadius: 2,
            }}
          >
            <div style={{ fontSize: 9, color: "rgba(0,0,0,0.7)", marginBottom: 2, fontFamily: "monospace", fontWeight: 600 }}>
              CONFIDENCE
            </div>
            <div style={{ fontSize: 18, fontWeight: 700, fontFamily: "monospace", color: "#000000" }}>
              {(prediction.confidence_score * 100).toFixed(1)}%
            </div>
            <div style={{ fontSize: 8, color: "rgba(0,0,0,0.6)", marginTop: 2, fontFamily: "monospace", fontWeight: 600 }}>
              SCORE
            </div>
          </div>
        </div>

        {/* Distribution Chart */}
        <div
          style={{
            background: "var(--card-bg)",
            border: "1px solid var(--border)",
            borderRadius: 2,
            padding: 12,
            marginBottom: 12,
          }}
        >
          <div style={{ fontSize: 10, fontWeight: 600, marginBottom: 10, color: "var(--foreground)", fontFamily: "monospace" }}>
            RETURN DISTRIBUTION
          </div>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={distributionData} margin={{ top: 5, right: 5, left: -20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
              <XAxis
                dataKey="label"
                stroke="var(--border)"
                style={{ fontSize: 9, fontFamily: "monospace" }}
                tick={{ fill: "var(--foreground)", opacity: 0.8 }}
              />
              <YAxis
                stroke="var(--border)"
                style={{ fontSize: 9, fontFamily: "monospace" }}
                tickFormatter={(value) => `${value.toFixed(0)}%`}
                tick={{ fill: "var(--foreground)", opacity: 0.8 }}
              />
              <Tooltip
                contentStyle={{
                  background: "var(--terminal-bg)",
                  border: "1px solid var(--accent)",
                  borderRadius: 4,
                  fontSize: 11,
                  fontFamily: "monospace",
                  padding: "8px 12px",
                  boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
                }}
                labelStyle={{ color: "var(--foreground)", fontWeight: 600 }}
                itemStyle={{ color: "#10b981", fontWeight: 600 }}
                formatter={(value: any) => [
                  <span key="val" style={{ color: "#10b981" }}>{value.toFixed(2)}%</span>,
                  <span key="label" style={{ color: "var(--foreground)" }}>Return</span>
                ]}
                labelFormatter={(label) => <span style={{ color: "var(--foreground)", fontWeight: 600 }}>{label}</span>}
              />
              <ReferenceLine y={0} stroke="var(--foreground)" strokeWidth={1} strokeOpacity={0.3} />
              <Bar dataKey="value" radius={[2, 2, 0, 0]}>
                {distributionData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={getColor(entry.value)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <div style={{ fontSize: 8, color: "var(--muted)", marginTop: 8, fontFamily: "monospace", textAlign: "center" }}>
            P50 = MEDIAN • 90% OF OUTCOMES BETWEEN P05-P95
          </div>
        </div>

        {/* Model Components & Stats */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <div
            style={{
              background: "var(--card-bg)",
              border: "1px solid var(--border)",
              borderRadius: 2,
              padding: 10,
            }}
          >
            <div style={{ fontSize: 9, color: "var(--muted)", marginBottom: 6, fontFamily: "monospace", fontWeight: 600 }}>
              MODEL COMPONENTS
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
              <span style={{ fontSize: 10, color: "var(--muted)", fontFamily: "monospace" }}>GB ({Math.round((prediction.methodology?.ensemble_weights?.gb ?? 0.6) * 100)}%)</span>
              <span style={{ fontSize: 13, fontWeight: 700, fontFamily: "monospace", color: getColor(prediction.gb_prediction * 100) }}>
                {formatPercent(prediction.gb_prediction)}
              </span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ fontSize: 10, color: "var(--muted)", fontFamily: "monospace" }}>RF ({Math.round((prediction.methodology?.ensemble_weights?.rf ?? 0.4) * 100)}%)</span>
              <span style={{ fontSize: 13, fontWeight: 700, fontFamily: "monospace", color: getColor(prediction.rf_prediction * 100) }}>
                {formatPercent(prediction.rf_prediction)}
              </span>
            </div>
          </div>

          <div
            style={{
              background: "var(--card-bg)",
              border: "1px solid var(--border)",
              borderRadius: 2,
              padding: 10,
            }}
          >
            <div style={{ fontSize: 9, color: "var(--muted)", marginBottom: 6, fontFamily: "monospace", fontWeight: 600 }}>
              RISK METRICS
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
              <span style={{ fontSize: 10, color: "var(--muted)", fontFamily: "monospace" }}>50% Range</span>
              <span style={{ fontSize: 13, fontWeight: 700, fontFamily: "monospace", color: "var(--warning)" }}>
                ±{range50.toFixed(1)}%
              </span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ fontSize: 10, color: "var(--muted)", fontFamily: "monospace" }}>Median</span>
              <span style={{ fontSize: 13, fontWeight: 700, fontFamily: "monospace", color: getColor(p50) }}>
                {p50 >= 0 ? "+" : ""}
                {p50.toFixed(2)}%
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
