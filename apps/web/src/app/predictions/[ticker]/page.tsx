"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import PageNav from "@/components/ui/PageNav";
import { useEffect, useState, useMemo, useCallback } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  ResponsiveContainer, Tooltip, ReferenceLine,
} from "recharts";
import FactorDashboard from "@/components/FactorDashboard";
import PredictionChart from "@/components/PredictionChart";
import FeatureImportance from "@/components/FeatureImportance";
import ModelModeToggle from "@/components/ModelModeToggle";
import { runMLSimulation, SIM_DEFAULTS } from "@/lib/mlTradingEngine";
import type { SimInputBar, SimResult } from "@/lib/mlTradingEngine";

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

  // ── Backtest state ──
  const [btInput, setBtInput] = useState<SimInputBar[] | null>(null);
  const [btLoading, setBtLoading] = useState(false);
  const [btOpen, setBtOpen] = useState(false);
  const [btTradesOpen, setBtTradesOpen] = useState(false);

  const BACKTEST_PARAMS = useMemo(() => ({
    ...SIM_DEFAULTS,
    entryThreshold: 1.0,
    exitThreshold: 0.25,
    stopLossPct: 5.0,
    takeProfitPct: 20.0,
    minHoldDays: 3,
    maxHoldDays: 21,
    cooldownBars: 2,
    costBps: 10,
  }), []);

  const fetchBacktest = useCallback(() => {
    if (btInput || btLoading || !ticker) return;
    setBtLoading(true);
    fetch(`/api/predictions/${ticker}/backtest?days=756`)
      .then(r => r.json())
      .then(d => { setBtInput(d.input || []); setBtLoading(false); })
      .catch(() => setBtLoading(false));
  }, [btInput, btLoading, ticker]);

  const btResult: SimResult | null = useMemo(() => {
    if (!btInput || btInput.length < 50) return null;
    return runMLSimulation(btInput, BACKTEST_PARAMS);
  }, [btInput, BACKTEST_PARAMS]);

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
        maxWidth: 1400,
        margin: "0 auto",
        padding: "20px 24px",
        fontFamily: "monospace",
        background: "#0a0a0a",
        overflowX: "hidden" as const,
      }}
    >
      <PageNav crumbs={[{label:"Home",href:"/"},{label:"Stocks",href:"/stocks"},{label:ticker,href:`/stocks/${ticker}`},{label:"Predictions"}]} actions={[{label:"Volatility",href:`/volatility/${ticker}`},{label:"Montecarlo",href:`/montecarlo/${ticker}`},{label:"Backtest",href:`/backtest/${ticker}`},{label:"Options",href:`/options/${ticker}.US`}]} />
      {/* Terminal-style Header */}
      <div
        style={{
          marginBottom: 16,
          padding: "12px 16px",
          background: "rgba(255,255,255,0.02)",
          border: "1px solid #30363d",
          borderRadius: 2,
        }}
      >
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
              <h1
                style={{
                  fontSize: 18,
                  fontWeight: 700,
                  color: "#fff",
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
                  background: "#3b82f6",
                  color: "#ffffff",
                  borderRadius: 2,
                }}
              >
                {ticker}
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <ModelModeToggle
                mode={mode}
                onChange={setMode}
                hasOptimized={hasOptimized}
              />
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", fontFamily: "monospace" }}>
                {mode === "optimized" && optimizerData?.config
                  ? `OPTIMIZED • ${optimizerData.config.n_factors} FACTORS • ${Math.round(optimizerData.config.gb_weight * 100)}% GB + ${Math.round(optimizerData.config.rf_weight * 100)}% RF`
                  : "MACHINE LEARNING FORECASTS • ENSEMBLE MODELS • FACTOR ANALYSIS"}
              </div>
            </div>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <Link
              href={`/backtest/${ticker}`}
              style={{
                fontSize: 10,
                color: "#10b981",
                textDecoration: "none",
                fontFamily: "monospace",
                fontWeight: 600,
                padding: "6px 12px",
                border: "1px solid #10b981",
                borderRadius: 2,
                background: "#0d1117",
                whiteSpace: "nowrap",
              }}
            >
              BACKTEST &rarr;
            </Link>
            <Link
              href="/backtest"
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
                whiteSpace: "nowrap",
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
            border: "1px solid #f59e0b",
            background: "rgba(245,158,11,0.08)",
            textAlign: "center",
            marginBottom: 16,
          }}
        >
          <div
            style={{
              fontSize: 14,
              fontWeight: 700,
              marginBottom: 12,
              color: "#f59e0b",
              fontFamily: "monospace",
            }}
          >
            INCOMPLETE FACTOR DATA
          </div>
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", fontFamily: "monospace", lineHeight: 1.8, maxWidth: 600, margin: "0 auto" }}>
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
                color: "#3b82f6",
                textDecoration: "none",
                fontFamily: "monospace",
                fontWeight: 600,
                padding: "8px 16px",
                border: "1px solid #3b82f6",
                borderRadius: 2,
                background: "#0d1117",
              }}
            >
              {ticker} Stock Page
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

      {/* ═══ ML SIGNAL BACKTEST ═══ */}
      <div style={{ marginBottom: 16, background: "#161b22", border: "1px solid #30363d", borderRadius: 8, overflow: "hidden" }}>
        <button
          onClick={() => { setBtOpen(!btOpen); if (!btOpen) fetchBacktest(); }}
          style={{
            width: "100%", padding: "14px 16px", background: "transparent", border: "none",
            display: "flex", alignItems: "center", justifyContent: "space-between",
            cursor: "pointer", fontFamily: "monospace",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.6)", letterSpacing: "0.08em", textTransform: "uppercase" as const }}>
              ML Signal Backtest
            </span>
            <span style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", fontWeight: 600 }}>
              ENTRY ≥1% 21D PRED · EXIT ≤0.25% · DAILY ROLLING
            </span>
          </div>
          <span style={{ color: "rgba(255,255,255,0.4)", fontSize: 12 }}>{btOpen ? "▲" : "▼"}</span>
        </button>

        {btOpen && (
          <div style={{ padding: "0 16px 16px" }}>
            {btLoading && (
              <div style={{ padding: 40, textAlign: "center", color: "rgba(255,255,255,0.4)", fontSize: 11, fontFamily: "monospace" }}>
                Loading backtest data...
              </div>
            )}

            {btResult && (
              <>
                {/* Stats strip */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 8, marginBottom: 16 }}>
                  {[
                    { label: "TOTAL RETURN", value: `${btResult.stats.totalReturn >= 0 ? "+" : ""}${btResult.stats.totalReturn.toFixed(1)}%`, color: btResult.stats.totalReturn >= 0 ? "#10b981" : "#ef4444" },
                    { label: "ANN. RETURN", value: `${btResult.stats.annualizedReturn >= 0 ? "+" : ""}${btResult.stats.annualizedReturn.toFixed(1)}%`, color: btResult.stats.annualizedReturn >= 0 ? "#10b981" : "#ef4444" },
                    { label: "SHARPE", value: btResult.stats.sharpe.toFixed(2), color: btResult.stats.sharpe >= 1 ? "#10b981" : btResult.stats.sharpe >= 0.5 ? "#f59e0b" : "#ef4444" },
                    { label: "WIN RATE", value: `${(btResult.stats.winRate * 100).toFixed(0)}%`, color: btResult.stats.winRate >= 0.5 ? "#10b981" : "#ef4444" },
                    { label: "MAX DD", value: `${(btResult.stats.maxDrawdown * 100).toFixed(1)}%`, color: "#ef4444" },
                    { label: "TRADES", value: String(btResult.stats.trades), color: "#3b82f6" },
                  ].map(m => (
                    <div key={m.label} style={{ background: "#0d1117", border: "1px solid #21262d", borderRadius: 4, padding: "10px 8px", textAlign: "center" }}>
                      <div style={{ fontSize: 8, fontWeight: 600, color: "rgba(255,255,255,0.4)", letterSpacing: "0.06em", marginBottom: 4, fontFamily: "monospace" }}>{m.label}</div>
                      <div style={{ fontSize: 16, fontWeight: 800, color: m.color, fontFamily: "monospace" }}>{m.value}</div>
                    </div>
                  ))}
                </div>

                {/* Equity curve */}
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 9, fontWeight: 600, color: "rgba(255,255,255,0.4)", letterSpacing: "0.06em", marginBottom: 8, fontFamily: "monospace" }}>EQUITY CURVE (INDEXED 100)</div>
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={btResult.series.filter((_, i) => i % 3 === 0)} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#21262d" />
                      <XAxis dataKey="date" tick={{ fontSize: 8, fill: "rgba(255,255,255,0.3)" }} tickFormatter={(d: string) => d.slice(5, 10)} interval="preserveStartEnd" />
                      <YAxis tick={{ fontSize: 8, fill: "rgba(255,255,255,0.3)" }} domain={["auto", "auto"]} />
                      <Tooltip
                        contentStyle={{ background: "#0d1117", border: "1px solid #30363d", borderRadius: 4, fontSize: 10, fontFamily: "monospace" }}
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        formatter={(v: any, name: any) => [`${Number(v ?? 0).toFixed(1)}`, name === "equityValue" ? "Strategy" : "OBX"]}
                        labelFormatter={(d: string) => d}
                      />
                      <ReferenceLine y={100} stroke="#30363d" strokeDasharray="3 3" />
                      <Line type="monotone" dataKey="equityValue" stroke="#3b82f6" dot={false} strokeWidth={2} name="Strategy" />
                      <Line type="monotone" dataKey="benchmarkValue" stroke="rgba(255,255,255,0.2)" dot={false} strokeWidth={1} name="OBX" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>

                {/* Secondary stats */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginBottom: 16 }}>
                  {[
                    { label: "AVG WIN", value: `+${btResult.stats.avgWinPct.toFixed(2)}%` },
                    { label: "AVG LOSS", value: `${btResult.stats.avgLossPct.toFixed(2)}%` },
                    { label: "AVG HOLD", value: `${btResult.stats.avgHoldDays.toFixed(0)}d` },
                    { label: "PROFIT FACTOR", value: btResult.stats.profitFactor === Infinity ? "∞" : btResult.stats.profitFactor.toFixed(2) },
                  ].map(m => (
                    <div key={m.label} style={{ background: "#0d1117", border: "1px solid #21262d", borderRadius: 4, padding: "8px", textAlign: "center" }}>
                      <div style={{ fontSize: 8, fontWeight: 600, color: "rgba(255,255,255,0.35)", letterSpacing: "0.06em", fontFamily: "monospace" }}>{m.label}</div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: "#e6edf3", fontFamily: "monospace", marginTop: 2 }}>{m.value}</div>
                    </div>
                  ))}
                </div>

                {/* Trade log toggle */}
                <button
                  onClick={() => setBtTradesOpen(!btTradesOpen)}
                  style={{
                    background: "transparent", border: "1px solid #21262d", borderRadius: 4,
                    padding: "6px 12px", fontSize: 9, fontWeight: 600, fontFamily: "monospace",
                    color: "rgba(255,255,255,0.5)", cursor: "pointer", letterSpacing: "0.05em",
                  }}
                >
                  {btTradesOpen ? "HIDE" : "SHOW"} TRADE LOG ({btResult.trades.length})
                </button>

                {btTradesOpen && btResult.trades.length > 0 && (
                  <div style={{ marginTop: 8, maxHeight: 300, overflowY: "auto", border: "1px solid #21262d", borderRadius: 4 }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "monospace", fontSize: 9 }}>
                      <thead>
                        <tr style={{ borderBottom: "1px solid #30363d" }}>
                          {["ENTRY", "EXIT", "DAYS", "SIGNAL", "RETURN", "EXIT REASON"].map(h => (
                            <th key={h} style={{ padding: "6px 8px", textAlign: "left", fontSize: 8, fontWeight: 600, color: "rgba(255,255,255,0.4)", letterSpacing: "0.05em" }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {btResult.trades.map((t, i) => (
                          <tr key={i} style={{ borderBottom: "1px solid #161b22" }}>
                            <td style={{ padding: "5px 8px", color: "rgba(255,255,255,0.6)" }}>{t.entryDate.slice(5)}</td>
                            <td style={{ padding: "5px 8px", color: "rgba(255,255,255,0.6)" }}>{t.exitDate.slice(5)}</td>
                            <td style={{ padding: "5px 8px", color: "rgba(255,255,255,0.5)" }}>{t.daysHeld}</td>
                            <td style={{ padding: "5px 8px", color: "#3b82f6" }}>{(t.predAtEntry).toFixed(1)}%</td>
                            <td style={{ padding: "5px 8px", fontWeight: 700, color: t.pnlPct >= 0 ? "#10b981" : "#ef4444" }}>
                              {t.pnlPct >= 0 ? "+" : ""}{(t.pnlPct * 100).toFixed(2)}%
                            </td>
                            <td style={{ padding: "5px 8px", color: "rgba(255,255,255,0.35)" }}>{t.exitReason.replace(/_/g, " ")}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Methodology note */}
                <div style={{ marginTop: 12, fontSize: 9, color: "rgba(255,255,255,0.3)", fontFamily: "monospace", lineHeight: 1.6 }}>
                  Signal: 21-day forward return from daily prices (rolling). Entry when signal ≥ 1%. Exit when signal drops to ≤ 0.25%.
                  Stop loss: 5%. Take profit: 20%. Max hold: 21 days. Cost: 10 bps round-trip. Last 3 years of data.
                </div>
              </>
            )}

            {!btLoading && btInput && !btResult && (
              <div style={{ padding: 20, textAlign: "center", color: "rgba(255,255,255,0.4)", fontSize: 11, fontFamily: "monospace" }}>
                Insufficient data for backtest (need 50+ bars)
              </div>
            )}
          </div>
        )}
      </div>

      {/* Bottom Info Grid */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
        {/* Methodology - changes based on mode */}
        <div
          style={{
            padding: 12,
            borderRadius: 2,
            border: mode === "optimized" ? "1px solid #f59e0b" : "1px solid #30363d",
            background: "rgba(255,255,255,0.02)",
          }}
        >
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              marginBottom: 10,
              color: mode === "optimized" ? "#f59e0b" : "#fff",
              fontFamily: "monospace",
            }}
          >
            {mode === "optimized" ? "OPTIMIZED CONFIG" : "METHODOLOGY"}
          </div>
          {mode === "optimized" && optimizerData?.config ? (
            <div style={{ fontSize: 9, color: "rgba(255,255,255,0.5)", fontFamily: "monospace", lineHeight: 1.7 }}>
              <div style={{ marginBottom: 6 }}>
                <span style={{ color: "#fff", fontWeight: 600 }}>ENSEMBLE:</span>{" "}
                GB {Math.round(optimizerData.config.gb_weight * 100)}% + RF {Math.round(optimizerData.config.rf_weight * 100)}%
              </div>
              <div style={{ marginBottom: 6 }}>
                <span style={{ color: "#fff", fontWeight: 600 }}>FACTORS ({optimizerData.config.n_factors}):</span>{" "}
                {optimizerData.config.factors.map((f) => FACTOR_LABELS[f] || f).join(", ")}
              </div>
              <div style={{ marginBottom: 6 }}>
                <span style={{ color: "#fff", fontWeight: 600 }}>DROPPED:</span>{" "}
                <span style={{ opacity: 0.6 }}>
                  {optimizerData.factor_changes?.dropped.slice(0, 6).map((f) => FACTOR_LABELS[f] || f).join(", ")}
                  {(optimizerData.factor_changes?.dropped.length ?? 0) > 6 && "..."}
                </span>
              </div>
              <div style={{ marginBottom: 6 }}>
                <span style={{ color: "#fff", fontWeight: 600 }}>METHOD:</span>{" "}
                {optimizerData.config.optimization_method.replace("_", " ").toUpperCase()}
              </div>
              {optimizerData.performance && (
                <div style={{ marginTop: 8, padding: "6px 8px", background: "rgba(245, 158, 11, 0.1)", borderRadius: 2 }}>
                  <span style={{ color: "#f59e0b", fontWeight: 700 }}>
                    +{optimizerData.performance.improvement.hit_rate_delta.toFixed(1)}% HIT RATE
                  </span>
                  <span style={{ color: "rgba(255,255,255,0.5)", marginLeft: 8 }}>
                    vs default ({optimizerData.performance.default_baseline.hit_rate.toFixed(1)}% → {optimizerData.performance.optimized.hit_rate.toFixed(1)}%)
                  </span>
                </div>
              )}
            </div>
          ) : (
            <div style={{ fontSize: 9, color: "rgba(255,255,255,0.5)", fontFamily: "monospace", lineHeight: 1.7 }}>
              <div style={{ marginBottom: 6 }}>
                <span style={{ color: "#fff", fontWeight: 600 }}>MODELS:</span> Gradient Boosting
                (60%) + Random Forest (40%) ensemble
              </div>
              <div style={{ marginBottom: 6 }}>
                <span style={{ color: "#fff", fontWeight: 600 }}>TRAINING:</span> Historical Oslo
                Børs data (2018-2024)
              </div>
              <div style={{ marginBottom: 6 }}>
                <span style={{ color: "#fff", fontWeight: 600 }}>FACTORS:</span> 19 research-backed
                predictors (momentum, volatility, fundamentals, seasonality)
              </div>
              <div style={{ marginBottom: 6 }}>
                <span style={{ color: "#fff", fontWeight: 600 }}>TARGET:</span> 1-month forward
                returns with probability distributions
              </div>
              <div>
                <span style={{ color: "#fff", fontWeight: 600 }}>CONFIDENCE:</span> Percentiles
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
            border: "1px solid #30363d",
            background: "rgba(255,255,255,0.02)",
          }}
        >
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              marginBottom: 10,
              color: "#fff",
              fontFamily: "monospace",
            }}
          >
            ACADEMIC REFERENCES
          </div>
          <div style={{ fontSize: 9, color: "rgba(255,255,255,0.5)", fontFamily: "monospace", lineHeight: 1.6 }}>
            <div style={{ marginBottom: 10 }}>
              <div style={{ color: "#fff", fontWeight: 600, marginBottom: 2 }}>
                Gu, Kelly & Xiu (2020)
              </div>
              <div style={{ fontStyle: "italic", marginBottom: 2 }}>
                "Empirical Asset Pricing via Machine Learning"
              </div>
              <div style={{ fontSize: 8 }}>
                Review of Financial Studies, 33(5), 2223-2273
              </div>
              <div style={{ fontSize: 8, color: "#3b82f6", marginTop: 2 }}>
                → 19-factor specification, ML ensemble methodology
              </div>
            </div>
            <div>
              <div style={{ color: "#fff", fontWeight: 600, marginBottom: 2 }}>
                Medhat & Schmeling (2021)
              </div>
              <div style={{ fontStyle: "italic", marginBottom: 2 }}>
                "Short-term Momentum"
              </div>
              <div style={{ fontSize: 8 }}>
                Review of Financial Studies, 35(3), 1480-1526
              </div>
              <div style={{ fontSize: 8, color: "#3b82f6", marginTop: 2 }}>
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
            border: "1px solid #f59e0b",
            background: "rgba(245,158,11,0.08)",
          }}
        >
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              marginBottom: 10,
              color: "#f59e0b",
              fontFamily: "monospace",
            }}
          >
            ⚠ RISK DISCLAIMER
          </div>
          <div style={{ fontSize: 9, color: "rgba(255,255,255,0.5)", fontFamily: "monospace", lineHeight: 1.7 }}>
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

      {/* Data Sources */}
      <div style={{ borderTop: "1px solid #30363d", marginTop: 16, padding: "12px 16px", fontSize: 9, color: "rgba(255,255,255,0.5)", lineHeight: 1.8 }}>
        <span style={{ fontWeight: 700, letterSpacing: "0.06em" }}>DATA SOURCES</span>
        <div style={{ marginTop: 4 }}>
          <span style={{ color: "#fff", opacity: 0.5 }}>Factors:</span> 19 technical & fundamental factors (momentum, volatility, beta, IVOL, B/M, E/P, DY) &middot;{" "}
          <span style={{ color: "#fff", opacity: 0.5 }}>Model:</span> Ridge regression ensemble (60% Gradient Boosting + 40% Random Forest) &middot;{" "}
          <span style={{ color: "#fff", opacity: 0.5 }}>Prices:</span> Interactive Brokers TWS API, Yahoo Finance &middot;{" "}
          <span style={{ color: "#fff", opacity: 0.5 }}>Fundamentals:</span> Yahoo Finance
        </div>
      </div>
    </div>
  );
}
