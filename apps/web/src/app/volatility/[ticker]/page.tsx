"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";

// Components
import VolatilityHero from "@/components/VolatilityHero";
import TradingImplications from "@/components/TradingImplications";
import RegimeTimeline from "@/components/RegimeTimeline";
import VolatilityCorrelationChart from "@/components/VolatilityCorrelationChart";
import VolatilityChart from "@/components/VolatilityChart";
import SeasonalityChart from "@/components/SeasonalityChart";
import GarchParametersTab from "@/components/GarchParametersTab";
import RegimeModelTab from "@/components/RegimeModelTab";
import VarBacktestTab from "@/components/VarBacktestTab";
import VolConeChart from "@/components/VolConeChart";

// Utilities
import { getTradingImplications } from "@/lib/tradingImplications";
import { type VolatilityRegime } from "@/lib/regimeClassification";

// Types
type VolatilityData = {
  ticker: string;
  count: number;
  beta: number | null;
  current: {
    date: string;
    historical: number | null;
    rolling20: number | null;
    rolling60: number | null;
    rolling120: number | null;
    ewma94: number | null;
    ewma97: number | null;
    parkinson: number | null;
    garmanKlass: number | null;
    rogersSatchell: number | null;
    yangZhang: number | null;
  };
  percentiles: {
    rolling20: number | null;
    rolling60: number | null;
    ewma94: number | null;
    rogersSatchell: number | null;
    yangZhang: number | null;
  };
  regime?: {
    current: VolatilityRegime;
    level: number;
    percentile: number;
    trend: "Expanding" | "Contracting" | "Stable";
    duration: number;
    lastShift: string | null;
    averageDuration: number;
    interpretation: string;
  };
  expectedMoves?: {
    currentPrice: number;
    daily1Sigma: number;
    weekly1Sigma: number;
    daily2Sigma: number;
  };
  regimeHistory?: Array<{
    date: string;
    regime: string;
    volatility: number;
    close: number;
  }>;
  series: Array<{
    date: string;
    historical?: number;
    rolling20?: number;
    rolling60?: number;
    rolling120?: number;
    ewma94?: number;
    ewma97?: number;
    parkinson?: number;
    garmanKlass?: number;
    rogersSatchell?: number;
    yangZhang?: number;
    close?: number;
  }>;
  dateRange: { start: string; end: string };
  volCone?: Array<{
    window: number;
    p5: number;
    p25: number;
    p50: number;
    p75: number;
    p95: number;
    current: number;
  }> | null;
  volDecomposition?: {
    totalVol: number | null;
    systematicVol: number | null;
    idiosyncraticVol: number | null;
    systematicPct: number | null;
    idiosyncraticPct: number | null;
    marketVol: number | null;
    beta: number | null;
  } | null;
};

const MEASURE_CONFIG = [
  { key: "yangZhang", label: "Yang-Zhang", color: "#f59e0b" },
  { key: "rogersSatchell", label: "Rogers-Satchell", color: "#22c55e" },
  { key: "rolling20", label: "20-Day Rolling", color: "#3b82f6" },
  { key: "rolling60", label: "60-Day Rolling", color: "#10b981" },
  { key: "rolling120", label: "120-Day Rolling", color: "#8b5cf6" },
  { key: "ewma94", label: "EWMA (λ=0.94)", color: "#6366f1" },
  { key: "parkinson", label: "Parkinson", color: "#ef4444" },
  { key: "garmanKlass", label: "Garman-Klass", color: "#06b6d4" },
];

function clampInt(v: string | null, def: number, min: number, max: number) {
  const n = v ? Number(v) : Number.NaN;
  if (!Number.isFinite(n)) return def;
  return Math.min(Math.max(Math.trunc(n), min), max);
}

const fmtPct = (n: number | null | undefined) =>
  n !== null && n !== undefined ? `${(n * 100).toFixed(2)}%` : "—";

export default function VolatilityPage() {
  const params = useParams<{ ticker?: string }>();
  const searchParams = useSearchParams();

  const ticker = useMemo(() => {
    const t = params?.ticker;
    return typeof t === "string" && t.length ? decodeURIComponent(t).toUpperCase() : "";
  }, [params]);

  const initialLimit = useMemo(() => {
    return clampInt(searchParams.get("limit"), 504, 100, 2000);
  }, [searchParams]);

  const [limit, setLimit] = useState<number>(initialLimit);
  const [isAdjusted, setIsAdjusted] = useState<boolean>(true);
  const [loading, setLoading] = useState<boolean>(true);
  const [data, setData] = useState<VolatilityData | null>(null);
  const [marketData, setMarketData] = useState<VolatilityData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedMeasures, setSelectedMeasures] = useState<string[]>([
    "rolling20", "rolling60", "ewma94",
  ]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [mlData, setMlData] = useState<any>(null);
  const [mlLoading, setMlLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!ticker) return;
      setLoading(true);
      setError(null);
      try {
        const url = `/api/volatility/${encodeURIComponent(ticker)}?limit=${limit}&adjusted=${isAdjusted}`;
        const res = await fetch(url, { method: "GET", headers: { accept: "application/json" } });
        if (!res.ok) {
          const text = await res.text();
          if (!cancelled) { setError(`Volatility API failed: ${text}`); setData(null); }
          return;
        }
        const json = (await res.json()) as VolatilityData;

        let marketJson: VolatilityData | null = null;
        try {
          const marketRes = await fetch(`/api/volatility/OBX?limit=${limit}&adjusted=${isAdjusted}`, {
            method: "GET", headers: { accept: "application/json" },
          });
          if (marketRes.ok) marketJson = (await marketRes.json()) as VolatilityData;
        } catch (e) {
          console.warn("Failed to fetch market volatility data:", e);
        }

        if (!cancelled) { setData(json); setMarketData(marketJson); setLoading(false); }
      } catch (e: any) {
        if (!cancelled) { setError(e?.message ?? String(e)); setData(null); setLoading(false); }
      }
    }
    run();
    return () => { cancelled = true; };
  }, [ticker, limit, isAdjusted]);

  // Fetch ML model data (GARCH, MSGARCH, VaR, Jumps) — non-blocking
  useEffect(() => {
    let cancelled = false;
    async function fetchML() {
      if (!ticker) return;
      setMlLoading(true);
      try {
        const res = await fetch(`/api/volatility/ml/${encodeURIComponent(ticker)}?limit=${limit}`, {
          method: "GET", headers: { accept: "application/json" },
        });
        if (res.ok && !cancelled) {
          const json = await res.json();
          setMlData(json);
        }
      } catch {
        // ML service unavailable — tabs will show placeholder
      } finally {
        if (!cancelled) setMlLoading(false);
      }
    }
    fetchML();
    return () => { cancelled = true; };
  }, [ticker, limit]);

  const toggleMeasure = (measure: string) => {
    setSelectedMeasures((prev) =>
      prev.includes(measure) ? prev.filter((m) => m !== measure) : [...prev, measure]
    );
  };

  const hasRegimeData = data?.regime !== undefined;
  const regime = data?.regime || {
    current: "Normal" as VolatilityRegime,
    level: 0, percentile: 50, trend: "Stable" as const,
    duration: 0, lastShift: null, averageDuration: 0,
    interpretation: "Unable to determine regime classification.",
  };

  const tradingImplications = useMemo(
    () => getTradingImplications(regime.current, data?.beta ?? null),
    [regime.current, data?.beta]
  );
  // Early returns
  if (loading && !data) return <main style={{ padding: 24 }}>Loading...</main>;
  if (error || !data) return <main style={{ padding: 24 }}>Error: {error}</main>;

  const expectedMoves = data.expectedMoves || { currentPrice: 0, daily1Sigma: 0, weekly1Sigma: 0, daily2Sigma: 0 };
  const regimeHistory = data.regimeHistory || [];

  return (
    <main style={{ padding: "20px 24px", maxWidth: 1400, margin: "0 auto" }}>

      {/* ═══ HEADER: ticker + controls ═══ */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 20,
          flexWrap: "wrap",
          gap: 12,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Link
            href="/stocks"
            style={{
              fontSize: 12, fontWeight: 600, color: "var(--muted-foreground)",
              textDecoration: "none", fontFamily: "monospace",
            }}
          >
            ← Asset List
          </Link>
          <span style={{ color: "var(--border)" }}>|</span>
          <Link
            href="/volatility/obx"
            style={{
              fontSize: 12, fontWeight: 600, color: "var(--muted-foreground)",
              textDecoration: "none", fontFamily: "monospace",
            }}
          >
            OBX Dashboard
          </Link>
          <span style={{ color: "var(--border)" }}>|</span>
          <span style={{ fontSize: 24, fontWeight: 700, fontFamily: "monospace", color: "var(--foreground)" }}>
            {ticker}
          </span>
          <span style={{ fontSize: 14, color: "var(--muted-foreground)", fontFamily: "monospace" }}>
            Volatility Analysis
          </span>
          <span style={{ fontSize: 11, color: "var(--muted-foreground)", fontFamily: "monospace" }}>
            ({data.count}d)
          </span>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <div style={{ display: "flex", background: "var(--card-bg)", borderRadius: 4, border: "1px solid var(--border)", padding: 2 }}>
            {[{ label: "Raw", val: false }, { label: "Total Return", val: true }].map((opt) => {
              const isActive = isAdjusted === opt.val;
              return (
                <button
                  key={opt.label}
                  onClick={() => setIsAdjusted(opt.val)}
                  style={{
                    padding: "4px 10px", fontSize: 11, fontWeight: 600, borderRadius: 3, border: "none",
                    background: isActive ? "var(--accent)" : "transparent",
                    color: isActive ? "#fff" : "var(--muted-foreground)",
                    cursor: "pointer", fontFamily: "monospace", transition: "all 0.15s",
                  }}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>

          <div style={{ display: "flex", gap: 2 }}>
            {[
              { l: "3M", v: 63 }, { l: "6M", v: 126 }, { l: "1Y", v: 252 },
              { l: "2Y", v: 504 }, { l: "5Y", v: 1260 }, { l: "All", v: 2000 },
            ].map((tf) => {
              const isActive = limit === tf.v;
              return (
                <button
                  key={tf.v}
                  onClick={() => setLimit(tf.v)}
                  style={{
                    padding: "4px 10px", borderRadius: 3, fontSize: 11, fontWeight: 600,
                    border: `1px solid ${isActive ? "var(--accent)" : "var(--border)"}`,
                    background: isActive ? "var(--accent)" : "transparent",
                    color: isActive ? "#fff" : "var(--muted-foreground)",
                    cursor: "pointer", fontFamily: "monospace", transition: "all 0.15s",
                  }}
                >
                  {tf.l}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* ═══ 1. VOLATILITY DASHBOARD (replaces flashy hero) ═══ */}
      {hasRegimeData && (
        <VolatilityHero
          regime={regime.current}
          annualizedVol={regime.level}
          percentile={regime.percentile}
          trend={regime.trend}
          beta={data.beta}
          rolling20={data.current.rolling20}
          rolling60={data.current.rolling60}
          rolling120={data.current.rolling120}
          ewma94={data.current.ewma94}
          yangZhang={data.current.yangZhang}
          interpretation={regime.interpretation}
          ticker={ticker}
          regimeDuration={regime.duration}
          percentiles={{
            rolling20: data.percentiles.rolling20,
            rolling60: data.percentiles.rolling60,
            ewma94: data.percentiles.ewma94,
            yangZhang: data.percentiles.yangZhang,
          }}
          expectedMoves={expectedMoves}
        />
      )}

      {/* ═══ 2. PRICE HISTORY WITH REGIME OVERLAY ═══ */}
      {hasRegimeData && regimeHistory.length > 0 && (
        <RegimeTimeline
          data={regimeHistory}
          regimeStats={{
            currentDuration: regime.duration,
            averageDuration: regime.averageDuration,
            lastShift: regime.lastShift,
          }}
        />
      )}

      {/* ═══ 2b. VOL CONE + VOL DECOMPOSITION ═══ */}
      {(data.volCone || data.volDecomposition) && (
        <div style={{ display: "grid", gridTemplateColumns: data.volCone && data.volDecomposition ? "2fr 1fr" : "1fr", gap: 20, marginBottom: 24 }}>
          {data.volCone && <VolConeChart data={data.volCone} />}
          {data.volDecomposition && (
            <VolDecompositionPanel decomp={data.volDecomposition} ticker={ticker} />
          )}
        </div>
      )}

      {/* ═══ 3. REGIME MODEL ═══ */}
      <MlSection title="Regime Model (MSGARCH)" loading={mlLoading} hasData={!!mlData?.regime && !mlData.regime.error}>
        {mlData?.regime && !mlData.regime.error && (
          <RegimeModelTab data={mlData.regime} ticker={ticker} />
        )}
      </MlSection>

      {/* ═══ 5. VAR BACKTEST ═══ */}
      <MlSection title="VaR Backtest" loading={mlLoading} hasData={!!(mlData?.var || mlData?.var_backtest || mlData?.jumps)}>
        <VarBacktestTab
          varLevels={mlData?.var && !mlData.var.error ? mlData.var : null}
          backtestResults={mlData?.var_backtest?.results && !mlData.var_backtest.error ? mlData.var_backtest.results : null}
          backtestChart={mlData?.var_backtest?.chart && !mlData.var_backtest.error ? mlData.var_backtest.chart : null}
          jumps={mlData?.jumps && !mlData.jumps.error ? mlData.jumps : null}
          ticker={ticker}
        />
      </MlSection>

      {/* ═══ 6. VOLATILITY TIME SERIES ═══ */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <h2 style={{ fontSize: 14, fontWeight: 700, color: "var(--foreground)", fontFamily: "monospace", margin: 0 }}>
            Volatility Time Series
          </h2>
          <div style={{ display: "flex", gap: 12, fontSize: 11, fontFamily: "monospace", color: "var(--muted-foreground)" }}>
            <span style={{ color: "#3b82f6" }}>● 20d: {fmtPct(data.current.rolling20)}</span>
            <span style={{ color: "#10b981" }}>● 60d: {fmtPct(data.current.rolling60)}</span>
            <span style={{ color: "#6366f1" }}>● EWMA: {fmtPct(data.current.ewma94)}</span>
          </div>
        </div>
        <div style={{ padding: 16, borderRadius: 6, border: "1px solid var(--border)", borderBottom: marketData ? "none" : undefined, borderBottomLeftRadius: marketData ? 0 : 6, borderBottomRightRadius: marketData ? 0 : 6, background: "var(--card-bg)" }}>
          <VolatilityChart data={data.series} selectedMeasures={selectedMeasures} height={300} />
        </div>
        {marketData && (
          <div style={{ padding: 16, borderRadius: "0 0 6px 6px", border: "1px solid var(--border)", borderTop: "1px dashed var(--border)", background: "var(--card-bg)" }}>
            <VolatilityCorrelationChart
              stockData={data.series}
              marketData={marketData.series}
              height={200}
            />
          </div>
        )}
      </div>

      {/* ═══ 7. ESTIMATORS (collapsible) ═══ */}
      <EstimatorsCollapsible
        series={data.series}
        selectedMeasures={selectedMeasures}
        toggleMeasure={toggleMeasure}
        garchData={mlData?.garch && !mlData.garch.error ? mlData.garch : null}
        ticker={ticker}
      />

      {/* ═══ 8. TRADING IMPLICATIONS ═══ */}
      {hasRegimeData && (
        <TradingImplications
          implications={tradingImplications}
          regime={regime.current}
        />
      )}
    </main>
  );
}

function VolDecompositionPanel({ decomp, ticker }: {
  decomp: NonNullable<VolatilityData["volDecomposition"]>;
  ticker: string;
}) {
  const sysPct = decomp.systematicPct ?? 0;
  const idioPct = decomp.idiosyncraticPct ?? 0;
  const total = (sysPct + idioPct) || 1;
  const sysWidth = (sysPct / total) * 100;
  const idioWidth = (idioPct / total) * 100;

  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--muted-foreground)", fontFamily: "monospace", marginBottom: 8 }}>
        Volatility Decomposition
      </div>
      <div style={{ padding: 16, borderRadius: 6, border: "1px solid var(--border)", background: "var(--background)", height: "100%", boxSizing: "border-box" }}>
        {/* Stacked bar */}
        <div style={{ display: "flex", height: 20, borderRadius: 4, overflow: "hidden", marginBottom: 16 }}>
          <div
            style={{ width: `${sysWidth}%`, background: "#6366f1", display: "flex", alignItems: "center", justifyContent: "center" }}
            title={`Systematic: ${sysPct.toFixed(0)}%`}
          >
            {sysWidth > 15 && <span style={{ fontSize: 9, fontWeight: 700, color: "#fff", fontFamily: "monospace" }}>{sysPct.toFixed(0)}%</span>}
          </div>
          <div
            style={{ width: `${idioWidth}%`, background: "#f59e0b", display: "flex", alignItems: "center", justifyContent: "center" }}
            title={`Idiosyncratic: ${idioPct.toFixed(0)}%`}
          >
            {idioWidth > 15 && <span style={{ fontSize: 9, fontWeight: 700, color: "#fff", fontFamily: "monospace" }}>{idioPct.toFixed(0)}%</span>}
          </div>
        </div>

        {/* Metrics */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <DecompRow label="Total Vol" value={fmtPct(decomp.totalVol)} bold />
          <DecompRow label="Systematic (β × σ_m)" value={fmtPct(decomp.systematicVol)} color="#6366f1" />
          <DecompRow label="Idiosyncratic" value={fmtPct(decomp.idiosyncraticVol)} color="#f59e0b" />
          <div style={{ borderTop: "1px solid var(--border)", marginTop: 4, paddingTop: 6 }}>
            <DecompRow label={`Beta vs OBX`} value={decomp.beta?.toFixed(2) ?? "—"} />
            <DecompRow label="OBX Vol" value={fmtPct(decomp.marketVol)} />
          </div>
        </div>

        {/* Interpretation */}
        <div style={{ marginTop: 12, fontSize: 10, color: "var(--muted-foreground)", lineHeight: 1.5, fontFamily: "monospace" }}>
          {sysPct > 60
            ? `${ticker} risk is dominated by market movements. Hedging with OBX index is effective.`
            : sysPct > 35
              ? `${ticker} has a balanced risk profile — both market and stock-specific factors contribute.`
              : `${ticker} risk is primarily idiosyncratic. Stock-specific catalysts dominate price moves.`}
        </div>
      </div>
    </div>
  );
}

function DecompRow({ label, value, color, bold }: { label: string; value: string; color?: string; bold?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", fontFamily: "monospace", fontSize: 12 }}>
      <span style={{ color: color || "var(--muted-foreground)", fontSize: 11, display: "flex", alignItems: "center", gap: 4 }}>
        {color && <span style={{ width: 6, height: 6, borderRadius: "50%", background: color, display: "inline-block" }} />}
        {label}
      </span>
      <span style={{ fontWeight: bold ? 700 : 600, fontSize: bold ? 14 : 12, color: color || "var(--foreground)" }}>
        {value}
      </span>
    </div>
  );
}

function MlSection({ title, loading, hasData, children }: {
  title: string;
  loading: boolean;
  hasData: boolean;
  children: React.ReactNode;
}) {
  if (!loading && !hasData) return null; // ML service not available — hide section entirely

  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{
        fontSize: 11, fontWeight: 700, textTransform: "uppercase",
        letterSpacing: "0.08em", color: "var(--muted-foreground)",
        fontFamily: "monospace", marginBottom: 10,
      }}>
        {title}
      </div>
      {loading && !hasData ? (
        <div style={{
          padding: "32px 20px", borderRadius: 6,
          border: "1px solid var(--border)", background: "var(--card-bg)",
          textAlign: "center", fontFamily: "monospace", fontSize: 12,
          color: "var(--muted-foreground)",
        }}>
          <span style={{ display: "inline-block", animation: "spin 1s linear infinite", marginRight: 8 }}>◐</span>
          Fitting {title.toLowerCase()}...
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      ) : (
        <div style={{
          padding: 20, borderRadius: 6,
          border: "1px solid var(--border)", background: "var(--card-bg)",
        }}>
          {children}
        </div>
      )}
    </div>
  );
}

function EstimatorsCollapsible({ series, selectedMeasures, toggleMeasure, garchData, ticker }: {
  series: VolatilityData["series"];
  selectedMeasures: string[];
  toggleMeasure: (m: string) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  garchData: any | null;
  ticker: string;
}) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div style={{ marginBottom: 24 }}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        style={{
          width: "100%", padding: "10px 16px",
          borderRadius: isOpen ? "6px 6px 0 0" : 6,
          border: "1px solid var(--border)", background: "var(--card-bg)",
          color: "var(--foreground)", fontSize: 12, fontWeight: 700,
          cursor: "pointer", display: "flex", alignItems: "center",
          justifyContent: "space-between", fontFamily: "monospace",
        }}
      >
        Estimators, GARCH & Seasonality
        <span style={{ fontSize: 11, color: "var(--muted-foreground)" }}>
          {isOpen ? "▲" : "▼"}
        </span>
      </button>
      {isOpen && (
        <div style={{
          padding: 20, border: "1px solid var(--border)", borderTop: "none",
          borderRadius: "0 0 6px 6px", background: "var(--card-bg)",
        }}>
          {/* GARCH Parameters */}
          {garchData && (
            <div style={{ marginBottom: 24 }}>
              <GarchParametersTab data={garchData} ticker={ticker} />
            </div>
          )}

          {/* Estimator selector */}
          <div style={{ marginBottom: 16, display: "flex", flexWrap: "wrap", gap: 6 }}>
            {MEASURE_CONFIG.map((config) => {
              const isSelected = selectedMeasures.includes(config.key);
              return (
                <button
                  key={config.key}
                  onClick={() => toggleMeasure(config.key)}
                  style={{
                    padding: "4px 10px", borderRadius: 12, fontSize: 11, fontWeight: 600,
                    border: `1px solid ${isSelected ? config.color : "var(--border)"}`,
                    background: isSelected ? `${config.color}15` : "transparent",
                    color: isSelected ? config.color : "var(--muted-foreground)",
                    cursor: "pointer", fontFamily: "monospace", transition: "all 0.15s",
                    display: "flex", alignItems: "center", gap: 5,
                  }}
                >
                  <div style={{ width: 5, height: 5, borderRadius: "50%", background: config.color, opacity: isSelected ? 1 : 0.3 }} />
                  {config.label}
                </button>
              );
            })}
          </div>

          <div style={{ padding: 16, borderRadius: 6, border: "1px solid var(--border)", background: "var(--background)", marginBottom: 24 }}>
            <VolatilityChart data={series} selectedMeasures={selectedMeasures} height={380} />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 20 }}>
            <div>
              <h3 style={{ fontSize: 13, fontWeight: 700, marginBottom: 10, fontFamily: "monospace", color: "var(--foreground)" }}>
                Monthly Seasonality
              </h3>
              <div style={{ padding: 16, borderRadius: 6, border: "1px solid var(--border)", background: "var(--background)", height: 260 }}>
                <SeasonalityChart data={series} />
              </div>
            </div>
            <div>
              <h3 style={{ fontSize: 13, fontWeight: 700, marginBottom: 10, fontFamily: "monospace", color: "var(--foreground)" }}>
                Estimator Reference
              </h3>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <EstimatorBox color="#f59e0b" name="Yang-Zhang" desc="Gap-adjusted, most accurate. Best for risk management." />
                <EstimatorBox color="#22c55e" name="Rogers-Satchell" desc="Drift-independent. Best for trending markets." />
                <EstimatorBox color="#3b82f6" name="Rolling (20/60/120d)" desc="Std dev of log returns. Simple baseline." />
                <EstimatorBox color="#6366f1" name="EWMA (λ=0.94)" desc="Recent data weighted more. Fast regime detection." />
                <EstimatorBox color="#ef4444" name="Parkinson" desc="High-low range. Efficient but ignores gaps." />
                <EstimatorBox color="#06b6d4" name="Garman-Klass" desc="OHLC-based. More efficient than close-only." />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function EstimatorBox({ color, name, desc }: { color: string; name: string; desc: string }) {
  return (
    <div style={{
      padding: "6px 10px", borderRadius: 4,
      border: "1px solid var(--border)",
      borderLeft: `3px solid ${color}`,
    }}>
      <div style={{ fontSize: 11, fontWeight: 700, color, fontFamily: "monospace", marginBottom: 1 }}>{name}</div>
      <div style={{ fontSize: 10, color: "var(--muted-foreground)", lineHeight: 1.4 }}>{desc}</div>
    </div>
  );
}
