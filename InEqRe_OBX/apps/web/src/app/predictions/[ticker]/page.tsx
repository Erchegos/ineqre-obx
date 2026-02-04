"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { useEffect, useState } from "react";
import FactorDashboard from "@/components/FactorDashboard";
import PredictionChart from "@/components/PredictionChart";
import FeatureImportance from "@/components/FeatureImportance";

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
};

export default function PredictionsPage() {
  const params = useParams();
  const ticker = (params?.ticker as string)?.toUpperCase() || "";

  const [prediction, setPrediction] = useState<Prediction | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!ticker) return;

    const fetchOrGenerate = async () => {
      try {
        // Try to fetch existing prediction
        const response = await fetch(`/api/predictions/${ticker}`);
        if (response.ok) {
          const result = await response.json();
          if (result.success && result.predictions && result.predictions.length > 0) {
            setPrediction(result.predictions[0]);
            setLoading(false);
            return;
          }
        }

        // No existing prediction - auto-generate from factor data
        const genResponse = await fetch("/api/predictions/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ticker }),
        });

        if (genResponse.ok) {
          const genResult = await genResponse.json();
          if (genResult.success && genResult.prediction) {
            setPrediction(genResult.prediction);
          }
        }
      } catch (err) {
        console.error("Error fetching prediction:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchOrGenerate();
  }, [ticker]);

  return (
    <div
      style={{
        maxWidth: 1600,
        margin: "0 auto",
        padding: "16px",
        fontFamily: "system-ui, -apple-system, sans-serif",
        background: "var(--background)",
      }}
    >
      {/* Terminal-style Header */}
      <div
        style={{
          marginBottom: 16,
          padding: "12px 16px",
          background: "var(--terminal-bg)",
          border: "1px solid var(--terminal-border)",
          borderRadius: 2,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 4 }}>
              <h1
                style={{
                  fontSize: 20,
                  fontWeight: 700,
                  color: "var(--foreground)",
                  fontFamily: "monospace",
                  letterSpacing: "0.5px",
                }}
              >
                PREDICTIVE ANALYTICS
              </h1>
              <span
                style={{
                  fontSize: 16,
                  fontWeight: 700,
                  fontFamily: "monospace",
                  padding: "2px 8px",
                  background: "var(--accent)",
                  color: "#ffffff",
                  borderRadius: 2,
                }}
              >
                {ticker}
              </span>
            </div>
            <div style={{ fontSize: 10, color: "var(--muted)", fontFamily: "monospace" }}>
              MACHINE LEARNING FORECASTS • ENSEMBLE MODELS • FACTOR ANALYSIS
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
              href={`/backtest/${ticker}`}
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
              BACKTEST &rarr;
            </Link>
            <Link
              href="/backtest"
              style={{
                fontSize: 10,
                color: "var(--muted)",
                textDecoration: "none",
                fontFamily: "monospace",
                fontWeight: 600,
                padding: "6px 12px",
                border: "1px solid var(--border)",
                borderRadius: 2,
                background: "var(--input-bg)",
              }}
            >
              ALL STOCKS
            </Link>
          </div>
        </div>
      </div>

      {/* Two Column Layout */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
        {/* Left Column: Prediction */}
        <div>
          <PredictionChart ticker={ticker} />
        </div>

        {/* Right Column: Feature Importance */}
        <div>
          {prediction && prediction.feature_importance && (
            <FeatureImportance
              featureImportance={prediction.feature_importance}
              title="Top Predictive Factors"
            />
          )}
        </div>
      </div>

      {/* Factor Dashboard */}
      <div style={{ marginBottom: 16 }}>
        <FactorDashboard ticker={ticker} />
      </div>

      {/* Bottom Info Grid */}
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 16 }}>
        {/* Methodology */}
        <div
          style={{
            padding: 12,
            borderRadius: 2,
            border: "1px solid var(--terminal-border)",
            background: "var(--terminal-bg)",
          }}
        >
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              marginBottom: 10,
              color: "var(--foreground)",
              fontFamily: "monospace",
            }}
          >
            METHODOLOGY
          </div>
          <div style={{ fontSize: 9, color: "var(--muted)", fontFamily: "monospace", lineHeight: 1.7 }}>
            <div style={{ marginBottom: 6 }}>
              <span style={{ color: "var(--foreground)", fontWeight: 600 }}>MODELS:</span> Gradient Boosting
              (60%) + Random Forest (40%) ensemble
            </div>
            <div style={{ marginBottom: 6 }}>
              <span style={{ color: "var(--foreground)", fontWeight: 600 }}>TRAINING:</span> Historical Oslo
              Børs data (2018-2024)
            </div>
            <div style={{ marginBottom: 6 }}>
              <span style={{ color: "var(--foreground)", fontWeight: 600 }}>FACTORS:</span> 19 research-backed
              predictors (momentum, volatility, fundamentals, seasonality)
            </div>
            <div style={{ marginBottom: 6 }}>
              <span style={{ color: "var(--foreground)", fontWeight: 600 }}>TARGET:</span> 1-month forward
              returns with probability distributions
            </div>
            <div>
              <span style={{ color: "var(--foreground)", fontWeight: 600 }}>CONFIDENCE:</span> Percentiles
              estimated from ensemble tree variance
            </div>
          </div>
        </div>

        {/* Risk Disclaimer */}
        <div
          style={{
            padding: 12,
            borderRadius: 2,
            border: "1px solid var(--warning)",
            background: "var(--warning-bg)",
          }}
        >
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              marginBottom: 10,
              color: "var(--warning)",
              fontFamily: "monospace",
            }}
          >
            ⚠ RISK DISCLAIMER
          </div>
          <div style={{ fontSize: 9, color: "var(--muted)", fontFamily: "monospace", lineHeight: 1.7 }}>
            <div style={{ marginBottom: 4 }}>
              FOR RESEARCH PURPOSES ONLY
            </div>
            <div style={{ marginBottom: 4 }}>
              NOT INVESTMENT ADVICE
            </div>
            <div style={{ marginBottom: 4 }}>
              PAST PERFORMANCE ≠ FUTURE RESULTS
            </div>
            <div>
              MODEL ACCURACY VARIES WITH MARKET CONDITIONS
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
