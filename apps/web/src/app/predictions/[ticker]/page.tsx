"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { useEffect, useState } from "react";
import FactorDashboard from "@/components/FactorDashboard";
import PredictionChart from "@/components/PredictionChart";
import FeatureImportance from "@/components/FeatureImportance";
import ModelModeToggle from "@/components/ModelModeToggle";

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
  factor_changes?: {
    dropped: string[];
    added: string[];
    n_factors: number;
  };
};

const FACTOR_LABELS: Record<string, string> = {
  mom1m: "1M Mom",
  mom6m: "6M Mom",
  mom11m: "11M Mom",
  mom36m: "36M Mom",
  chgmom: "Mom Δ",
  vol1m: "1M Vol",
  vol3m: "3M Vol",
  vol12m: "12M Vol",
  maxret: "Max Ret",
  beta: "Beta",
  ivol: "Idio Vol",
  bm: "B/M",
  ep: "E/P",
  dy: "Div Yld",
  sp: "S/P",
  sg: "Sales Grw",
  mktcap: "Mkt Cap",
  nokvol: "NOK Vol",
  dum_jan: "Jan Effect",
};

export default function PredictionsPage() {
  const params = useParams();
  const ticker = (params?.ticker as string)?.toUpperCase() || "";

  const [prediction, setPrediction] = useState<Prediction | null>(null);
  const [loading, setLoading] = useState(true);
  const [dataComplete, setDataComplete] = useState(true);
  const [mode, setMode] = useState<"default" | "optimized">("default");
  const [optimizerData, setOptimizerData] = useState<OptimizerData | null>(null);

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

    const fetchOrGenerate = async () => {
      setLoading(true);
      try {
        // First check if this ticker has complete factor data
        const tickersRes = await fetch("/api/factors/tickers", {
          method: "GET",
          headers: { accept: "application/json" },
        });

        if (tickersRes.ok) {
          const tickersData = await tickersRes.json();
          if (tickersData.success && !tickersData.tickers?.includes(ticker)) {
            setDataComplete(false);
            setLoading(false);
            return;
          }
        }

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

        // No existing prediction - auto-generate from factor data
        const genResponse = await fetch("/api/predictions/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ticker, mode }),
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
  }, [ticker, mode]);

  const hasOptimized = optimizerData?.hasOptimized ?? false;

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
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
              <h1
                style={{
                  fontSize: 18,
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
                  fontSize: 14,
                  fontWeight: 700,
                  fontFamily: "monospace",
                  padding: "3px 10px",
                  background: "var(--accent)",
                  color: "#ffffff",
                  borderRadius: 2,
                }}
              >
                {ticker}
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <ModelModeToggle
                mode={mode}
                onChange={setMode}
                hasOptimized={hasOptimized}
              />
              <div style={{ fontSize: 10, color: "var(--muted)", fontFamily: "monospace" }}>
                {mode === "optimized" && optimizerData?.config
                  ? `OPTIMIZED • ${optimizerData.config.n_factors} FACTORS • ${Math.round(optimizerData.config.gb_weight * 100)}% GB + ${Math.round(optimizerData.config.rf_weight * 100)}% RF`
                  : "MACHINE LEARNING FORECASTS • ENSEMBLE MODELS • FACTOR ANALYSIS"}
              </div>
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
              BACKTEST ALL STOCKS
            </Link>
          </div>
        </div>
      </div>

      {/* Incomplete data guard */}
      {!loading && !dataComplete && (
        <div
          style={{
            padding: 32,
            borderRadius: 2,
            border: "1px solid var(--warning)",
            background: "var(--warning-bg)",
            textAlign: "center",
            marginBottom: 16,
          }}
        >
          <div
            style={{
              fontSize: 14,
              fontWeight: 700,
              marginBottom: 12,
              color: "var(--warning)",
              fontFamily: "monospace",
            }}
          >
            INCOMPLETE FACTOR DATA
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)", fontFamily: "monospace", lineHeight: 1.8, maxWidth: 600, margin: "0 auto" }}>
            <div style={{ marginBottom: 8 }}>
              {ticker} is missing key factors required for the 19-factor prediction model
              (beta, IVOL, fundamentals, or NOK volume).
            </div>
            <div style={{ marginBottom: 16 }}>
              ML predictions are restricted to stocks with complete data to ensure accuracy.
            </div>
            <Link
              href={`/stocks/${ticker}`}
              style={{
                display: "inline-block",
                fontSize: 11,
                color: "var(--accent)",
                textDecoration: "none",
                fontFamily: "monospace",
                fontWeight: 600,
                padding: "8px 16px",
                border: "1px solid var(--accent)",
                borderRadius: 2,
                background: "var(--input-bg)",
              }}
            >
              ← BACK TO {ticker}
            </Link>
          </div>
        </div>
      )}

      {dataComplete && (
        <>
      {/* Two Column Layout */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
        {/* Left Column: Prediction */}
        <div>
          <PredictionChart ticker={ticker} mode={mode} />
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
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
        {/* Methodology - changes based on mode */}
        <div
          style={{
            padding: 12,
            borderRadius: 2,
            border: mode === "optimized" ? "1px solid #f59e0b" : "1px solid var(--terminal-border)",
            background: "var(--terminal-bg)",
          }}
        >
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              marginBottom: 10,
              color: mode === "optimized" ? "#f59e0b" : "var(--foreground)",
              fontFamily: "monospace",
            }}
          >
            {mode === "optimized" ? "OPTIMIZED CONFIG" : "METHODOLOGY"}
          </div>
          {mode === "optimized" && optimizerData?.config ? (
            <div style={{ fontSize: 9, color: "var(--muted)", fontFamily: "monospace", lineHeight: 1.7 }}>
              <div style={{ marginBottom: 6 }}>
                <span style={{ color: "var(--foreground)", fontWeight: 600 }}>ENSEMBLE:</span>{" "}
                GB {Math.round(optimizerData.config.gb_weight * 100)}% + RF {Math.round(optimizerData.config.rf_weight * 100)}%
              </div>
              <div style={{ marginBottom: 6 }}>
                <span style={{ color: "var(--foreground)", fontWeight: 600 }}>FACTORS ({optimizerData.config.n_factors}):</span>{" "}
                {optimizerData.config.factors.map((f) => FACTOR_LABELS[f] || f).join(", ")}
              </div>
              <div style={{ marginBottom: 6 }}>
                <span style={{ color: "var(--foreground)", fontWeight: 600 }}>DROPPED:</span>{" "}
                <span style={{ opacity: 0.6 }}>
                  {optimizerData.factor_changes?.dropped.slice(0, 6).map((f) => FACTOR_LABELS[f] || f).join(", ")}
                  {(optimizerData.factor_changes?.dropped.length ?? 0) > 6 && "..."}
                </span>
              </div>
              <div style={{ marginBottom: 6 }}>
                <span style={{ color: "var(--foreground)", fontWeight: 600 }}>METHOD:</span>{" "}
                {optimizerData.config.optimization_method.replace("_", " ").toUpperCase()}
              </div>
              {optimizerData.performance && (
                <div style={{ marginTop: 8, padding: "6px 8px", background: "rgba(245, 158, 11, 0.1)", borderRadius: 2 }}>
                  <span style={{ color: "#f59e0b", fontWeight: 700 }}>
                    +{optimizerData.performance.improvement.hit_rate_delta.toFixed(1)}% HIT RATE
                  </span>
                  <span style={{ color: "var(--muted)", marginLeft: 8 }}>
                    vs default ({optimizerData.performance.default_baseline.hit_rate.toFixed(1)}% → {optimizerData.performance.optimized.hit_rate.toFixed(1)}%)
                  </span>
                </div>
              )}
            </div>
          ) : (
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
          )}
        </div>

        {/* Academic References */}
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
            ACADEMIC REFERENCES
          </div>
          <div style={{ fontSize: 9, color: "var(--muted)", fontFamily: "monospace", lineHeight: 1.6 }}>
            <div style={{ marginBottom: 10 }}>
              <div style={{ color: "var(--foreground)", fontWeight: 600, marginBottom: 2 }}>
                Gu, Kelly & Xiu (2020)
              </div>
              <div style={{ fontStyle: "italic", marginBottom: 2 }}>
                "Empirical Asset Pricing via Machine Learning"
              </div>
              <div style={{ fontSize: 8 }}>
                Review of Financial Studies, 33(5), 2223-2273
              </div>
              <div style={{ fontSize: 8, color: "var(--accent)", marginTop: 2 }}>
                → 19-factor specification, ML ensemble methodology
              </div>
            </div>
            <div>
              <div style={{ color: "var(--foreground)", fontWeight: 600, marginBottom: 2 }}>
                Medhat & Schmeling (2021)
              </div>
              <div style={{ fontStyle: "italic", marginBottom: 2 }}>
                "Short-term Momentum"
              </div>
              <div style={{ fontSize: 8 }}>
                Review of Financial Studies, 35(3), 1480-1526
              </div>
              <div style={{ fontSize: 8, color: "var(--accent)", marginTop: 2 }}>
                → Turnover interactions, size-conditional effects
              </div>
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
        </>
      )}
    </div>
  );
}
