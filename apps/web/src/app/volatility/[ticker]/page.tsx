"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";

// --- New Components ---
import RegimeHeader from "@/components/RegimeHeader";
import TradingImplications from "@/components/TradingImplications";
import ExpectedMoves from "@/components/ExpectedMoves";
import RegimeTimeline from "@/components/RegimeTimeline";
import MarketCorrelation from "@/components/MarketCorrelation";
import MethodologySection from "@/components/MethodologySection";

// --- Existing Components ---
import VolatilityChart from "@/components/VolatilityChart";
import SeasonalityChart from "@/components/SeasonalityChart";

// --- Utilities ---
import { getTradingImplications, getPortfolioImplications } from "@/lib/tradingImplications";
import { computeReturns, computeCorrelation } from "@/lib/metrics";
import type { VolatilityRegime } from "@/lib/regimeClassification";

// --- Types ---
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
  dateRange: {
    start: string;
    end: string;
  };
};

// --- Configuration ---
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
    return clampInt(searchParams.get("limit"), 252, 100, 2000); // Default to 1Y (252 days)
  }, [searchParams]);

  const [limit, setLimit] = useState<number>(initialLimit);
  const [isAdjusted, setIsAdjusted] = useState<boolean>(true);

  const [loading, setLoading] = useState<boolean>(true);
  const [data, setData] = useState<VolatilityData | null>(null);
  const [marketData, setMarketData] = useState<VolatilityData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [selectedMeasures, setSelectedMeasures] = useState<string[]>([
    "rolling20",
    "rolling60",
    "ewma94",
  ]);

  const [isMethodologyExpanded, setIsMethodologyExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (!ticker) return;
      setLoading(true);
      setError(null);
      try {
        // Fetch stock volatility data
        const url = `/api/volatility/${encodeURIComponent(
          ticker
        )}?limit=${limit}&adjusted=${isAdjusted}`;
        const res = await fetch(url, {
          method: "GET",
          headers: { accept: "application/json" },
          cache: "no-store",
        });

        if (!res.ok) {
          const text = await res.text();
          if (!cancelled) {
            setError(`Volatility API failed: ${text}`);
            setData(null);
          }
          return;
        }

        const json = (await res.json()) as VolatilityData;

        // Fetch OBX (market) volatility data for correlation
        let marketJson: VolatilityData | null = null;
        try {
          const marketUrl = `/api/volatility/OBX?limit=${limit}&adjusted=${isAdjusted}`;
          const marketRes = await fetch(marketUrl, {
            method: "GET",
            headers: { accept: "application/json" },
            cache: "no-store",
          });
          if (marketRes.ok) {
            marketJson = (await marketRes.json()) as VolatilityData;
          }
        } catch (e) {
          console.warn("Failed to fetch market volatility data:", e);
        }

        if (!cancelled) {
          setData(json);
          setMarketData(marketJson);
          setLoading(false);
        }
      } catch (e: any) {
        if (!cancelled) {
          setError(e?.message ?? String(e));
          setData(null);
          setLoading(false);
        }
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [ticker, limit, isAdjusted]);

  const toggleMeasure = (measure: string) => {
    setSelectedMeasures((prev) =>
      prev.includes(measure) ? prev.filter((m) => m !== measure) : [...prev, measure]
    );
  };

  // --- Derived Metrics (MUST be before early returns to satisfy Rules of Hooks) ---
  const avgCorrelation = useMemo(() => {
    if (!data || !marketData) return 0;

    // Calculate correlation between stock returns and market returns
    // This is consistent with how beta is calculated
    const stockPrices = data.series
      .map((s) => s.close)
      .filter((c): c is number => c !== null && c !== undefined && c > 0);
    const marketPrices = marketData.series
      .map((s) => s.close)
      .filter((c): c is number => c !== null && c !== undefined && c > 0);

    if (stockPrices.length < 30 || marketPrices.length < 30) return 0;

    const minLength = Math.min(stockPrices.length, marketPrices.length);
    const stockReturns = computeReturns(stockPrices.slice(0, minLength));
    const marketReturns = computeReturns(marketPrices.slice(0, minLength));

    return computeCorrelation(stockReturns, marketReturns);
  }, [data, marketData]);

  // Compute regime-related values (with safe fallbacks for when data is null)
  const hasRegimeData = data?.regime !== undefined;
  const regime = data?.regime || {
    current: "Normal" as VolatilityRegime,
    level: 0,
    percentile: 50,
    trend: "Stable" as const,
    duration: 0,
    lastShift: null,
    averageDuration: 0,
    interpretation: "Unable to determine regime classification.",
  };

  // Trading implications (MUST be before early returns)
  const tradingImplications = useMemo(
    () => getTradingImplications(regime.current, data?.beta ?? null),
    [regime.current, data?.beta]
  );

  const portfolioImplications = useMemo(
    () => getPortfolioImplications(regime.current, data?.beta ?? null),
    [regime.current, data?.beta]
  );

  // Early returns AFTER all hooks
  if (loading && !data) return <main style={{ padding: 24 }}>Loading...</main>;
  if (error || !data) return <main style={{ padding: 24 }}>Error: {error}</main>;

  // Now safe to use data
  const expectedMoves = data.expectedMoves || {
    currentPrice: 0,
    daily1Sigma: 0,
    weekly1Sigma: 0,
    daily2Sigma: 0,
  };

  const regimeHistory = data.regimeHistory || [];

  return (
    <main style={{ padding: 24, maxWidth: 1400, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ marginBottom: 32 }}>
        <Link
          href={`/stocks/${ticker}`}
          style={{
            display: "inline-block",
            padding: "8px 16px",
            marginBottom: 20,
            fontSize: 13,
            fontWeight: 500,
            color: "var(--foreground)",
            textDecoration: "none",
            border: "1px solid var(--border)",
            borderRadius: 4,
            background: "var(--card-bg)",
            transition: "all 0.15s ease",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = "var(--foreground)";
            e.currentTarget.style.background = "var(--hover-bg)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = "var(--border)";
            e.currentTarget.style.background = "var(--card-bg)";
          }}
        >
          Asset List
        </Link>
        <h1
          style={{
            fontSize: 32,
            fontWeight: 700,
            margin: 0,
            color: "var(--foreground)",
          }}
        >
          Volatility Analysis
        </h1>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 32,
          flexWrap: "wrap",
          gap: 16,
        }}
      >
        <div style={{ fontSize: 40, fontWeight: 700 }}>{ticker}</div>

        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          {/* Price Mode Toggle */}
          <div
            style={{
              display: "flex",
              background: "var(--card-bg)",
              borderRadius: 6,
              border: "1px solid var(--border)",
              padding: 2,
            }}
          >
            <button
              onClick={() => setIsAdjusted(false)}
              style={{
                padding: "6px 12px",
                fontSize: 12,
                fontWeight: 500,
                borderRadius: 4,
                border: "none",
                background: !isAdjusted ? "var(--foreground)" : "transparent",
                color: !isAdjusted ? "var(--background)" : "var(--muted)",
                cursor: "pointer",
                transition: "all 0.15s ease",
                transform: "scale(1)",
                boxShadow: !isAdjusted ? "0 2px 4px rgba(0,0,0,0.1)" : "none",
              }}
              onMouseEnter={(e) => {
                if (!isAdjusted) {
                  e.currentTarget.style.filter = "brightness(0.9)";
                } else {
                  e.currentTarget.style.background = "var(--hover-bg)";
                  e.currentTarget.style.borderColor = "var(--accent)";
                }
              }}
              onMouseLeave={(e) => {
                if (!isAdjusted) {
                  e.currentTarget.style.filter = "brightness(1)";
                } else {
                  e.currentTarget.style.background = "transparent";
                  e.currentTarget.style.borderColor = "transparent";
                }
              }}
              onMouseDown={(e) => {
                e.currentTarget.style.transform = "scale(0.95)";
              }}
              onMouseUp={(e) => {
                e.currentTarget.style.transform = "scale(1)";
              }}
            >
              Raw
            </button>
            <button
              onClick={() => setIsAdjusted(true)}
              style={{
                padding: "6px 12px",
                fontSize: 12,
                fontWeight: 500,
                borderRadius: 4,
                border: "none",
                background: isAdjusted ? "var(--accent)" : "transparent",
                color: isAdjusted ? "#fff" : "var(--muted)",
                cursor: "pointer",
                transition: "all 0.15s ease",
                transform: "scale(1)",
                boxShadow: isAdjusted ? "0 2px 4px rgba(0,0,0,0.1)" : "none",
              }}
              onMouseEnter={(e) => {
                if (isAdjusted) {
                  e.currentTarget.style.filter = "brightness(0.9)";
                } else {
                  e.currentTarget.style.background = "var(--hover-bg)";
                  e.currentTarget.style.borderColor = "var(--accent)";
                }
              }}
              onMouseLeave={(e) => {
                if (isAdjusted) {
                  e.currentTarget.style.filter = "brightness(1)";
                } else {
                  e.currentTarget.style.background = "transparent";
                  e.currentTarget.style.borderColor = "transparent";
                }
              }}
              onMouseDown={(e) => {
                e.currentTarget.style.transform = "scale(0.95)";
              }}
              onMouseUp={(e) => {
                e.currentTarget.style.transform = "scale(1)";
              }}
            >
              Total Return
            </button>
          </div>

          {/* Timeframe Buttons */}
          <div style={{ display: "flex", gap: 4 }}>
            {[
              { l: "3M", v: 63 },
              { l: "6M", v: 126 },
              { l: "1Y", v: 252 },
              { l: "2Y", v: 504 },
              { l: "5Y", v: 1260 },
              { l: "All", v: 2000 },
            ].map((tf) => {
              const isActive = limit === tf.v;
              return (
                <button
                  key={tf.v}
                  onClick={() => setLimit(tf.v)}
                  style={{
                    padding: "6px 12px",
                    borderRadius: 4,
                    border: `1px solid ${isActive ? "var(--accent)" : "var(--border)"}`,
                    background: isActive ? "var(--accent)" : "transparent",
                    color: isActive ? "#fff" : "var(--muted)",
                    fontSize: 11,
                    fontWeight: 500,
                    cursor: "pointer",
                    transition: "all 0.15s ease",
                    transform: "scale(1)",
                    boxShadow: isActive ? "0 2px 4px rgba(0,0,0,0.1)" : "none",
                  }}
                  onMouseEnter={(e) => {
                    if (isActive) {
                      e.currentTarget.style.filter = "brightness(0.9)";
                    } else {
                      e.currentTarget.style.background = "var(--hover-bg)";
                      e.currentTarget.style.borderColor = "var(--accent)";
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (isActive) {
                      e.currentTarget.style.filter = "brightness(1)";
                    } else {
                      e.currentTarget.style.background = "transparent";
                      e.currentTarget.style.borderColor = "var(--border)";
                    }
                  }}
                  onMouseDown={(e) => {
                    e.currentTarget.style.transform = "scale(0.95)";
                  }}
                  onMouseUp={(e) => {
                    e.currentTarget.style.transform = "scale(1)";
                  }}
                >
                  {tf.l}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* NEW SECTION 1: Regime Header */}
      {hasRegimeData && (
        <>
          <div
            style={{
              fontSize: 12,
              color: "var(--muted)",
              marginBottom: 8,
              textAlign: "right",
            }}
          >
            Analysis period: {data.count} trading days
          </div>
          <RegimeHeader
            regime={regime.current}
            currentLevel={regime.level}
            percentile={regime.percentile}
            trend={regime.trend}
            beta={data.beta}
            interpretation={regime.interpretation}
            ticker={ticker}
          />
        </>
      )}

      {/* NEW SECTION 2: Trading Implications */}
      {hasRegimeData && <TradingImplications implications={tradingImplications} />}

      {/* NEW SECTION 3: Expected Moves */}
      {hasRegimeData && expectedMoves.currentPrice > 0 && (
        <ExpectedMoves
          currentPrice={expectedMoves.currentPrice}
          daily1Sigma={expectedMoves.daily1Sigma}
          weekly1Sigma={expectedMoves.weekly1Sigma}
          daily2Sigma={expectedMoves.daily2Sigma}
        />
      )}

      {/* NEW SECTION 4: Regime Timeline */}
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

      {/* NEW SECTION 5: Simplified Volatility Metrics */}
      <div style={{ marginBottom: 40 }}>
        <h2
          style={{
            fontSize: 20,
            fontWeight: 600,
            marginBottom: 16,
            color: "var(--foreground)",
          }}
        >
          Volatility Metrics
        </h2>

        {/* Current Readings */}
        <div
          style={{
            display: "flex",
            gap: 16,
            marginBottom: 16,
            fontSize: 13,
            color: "var(--muted-foreground)",
            flexWrap: "wrap",
          }}
        >
          <div>
            <span style={{ fontWeight: 600 }}>20-Day:</span> {fmtPct(data.current.rolling20)}
          </div>
          <div>
            <span style={{ fontWeight: 600 }}>60-Day:</span> {fmtPct(data.current.rolling60)}
          </div>
          <div>
            <span style={{ fontWeight: 600 }}>EWMA (λ=0.94):</span> {fmtPct(data.current.ewma94)}
          </div>
          <div style={{ marginLeft: "auto" }}>
            <span style={{ fontWeight: 600 }}>Trend:</span>{" "}
            <span
              style={{
                color:
                  regime.trend === "Expanding"
                    ? "#ef4444"
                    : regime.trend === "Contracting"
                    ? "#22c55e"
                    : "var(--foreground)",
                fontWeight: 600,
              }}
            >
              {regime.trend}
            </span>
          </div>
        </div>

        {/* Chart */}
        <div
          style={{
            padding: 20,
            borderRadius: 6,
            border: "1px solid var(--border)",
            background: "var(--card-bg)",
          }}
        >
          <VolatilityChart
            data={data.series}
            selectedMeasures={selectedMeasures}
            height={380}
          />
        </div>
      </div>

      {/* NEW SECTION 6: Market Co-Movement */}
      {marketData && (
        <MarketCorrelation
          beta={data.beta}
          avgCorrelation={avgCorrelation}
          portfolioImplications={portfolioImplications}
          stockData={data.series}
          marketData={marketData.series}
        />
      )}

      {/* NEW SECTION 7: Advanced Methodology (Collapsible) */}
      <MethodologySection
        isExpanded={isMethodologyExpanded}
        onToggle={() => setIsMethodologyExpanded(!isMethodologyExpanded)}
      >
        {/* All Estimators Chart */}
        <div style={{ marginBottom: 32 }}>
          <h3
            style={{
              fontSize: 18,
              fontWeight: 600,
              marginBottom: 16,
              color: "var(--foreground)",
            }}
          >
            All Estimators Comparison
          </h3>

          {/* Measure Toggles */}
          <div style={{ marginBottom: 16, display: "flex", flexWrap: "wrap", gap: 8 }}>
            {MEASURE_CONFIG.map((config) => {
              const isSelected = selectedMeasures.includes(config.key);
              return (
                <button
                  key={config.key}
                  onClick={() => toggleMeasure(config.key)}
                  style={{
                    padding: "6px 12px",
                    borderRadius: 16,
                    border: `1.5px solid ${isSelected ? config.color : "var(--border)"}`,
                    background: isSelected ? `${config.color}10` : "transparent",
                    color: isSelected ? config.color : "var(--muted)",
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    transition: "all 0.15s",
                  }}
                >
                  <div
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      background: config.color,
                      opacity: isSelected ? 1 : 0.3,
                    }}
                  />
                  {config.label}
                </button>
              );
            })}
          </div>

          <div
            style={{
              padding: 20,
              borderRadius: 6,
              border: "1px solid var(--border)",
              background: "var(--card-bg)",
            }}
          >
            <VolatilityChart
              data={data.series}
              selectedMeasures={selectedMeasures}
              height={420}
            />
          </div>
        </div>

        {/* Two-Column Layout: Seasonality + Estimator Guide */}
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 24 }}>
          {/* Seasonality Chart */}
          <div>
            <h3
              style={{
                fontSize: 18,
                fontWeight: 600,
                marginBottom: 12,
                color: "var(--foreground)",
              }}
            >
              Monthly Seasonality Pattern
            </h3>
            <p
              style={{
                fontSize: 12,
                color: "var(--muted)",
                marginBottom: 16,
                lineHeight: 1.5,
              }}
            >
              Average annualized volatility by calendar month. Helps identify historically volatile
              periods, though sample size may be limited for statistical significance.
            </p>
            <div
              style={{
                padding: 20,
                borderRadius: 6,
                border: "1px solid var(--border)",
                background: "var(--card-bg)",
                height: 280,
              }}
            >
              <SeasonalityChart data={data.series} />
            </div>
          </div>

          {/* Volatility Estimators Explained */}
          <div>
            <h3
              style={{
                fontSize: 18,
                fontWeight: 600,
                marginBottom: 12,
                color: "var(--foreground)",
              }}
            >
              Estimator Guide
            </h3>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 12,
              }}
            >
              {/* Yang-Zhang */}
              <EstimatorBox
                color="#f59e0b"
                name="Yang-Zhang"
                formula="Combines overnight + open-to-close + close-to-close"
                whenToUse="Best for position sizing and risk management"
                pros="Most accurate, accounts for gaps"
                cons="Requires OHLC data"
              />

              {/* Rogers-Satchell */}
              <EstimatorBox
                color="#22c55e"
                name="Rogers-Satchell"
                formula="log(H/C) × log(H/O) + log(L/C) × log(L/O)"
                whenToUse="Trending markets with directional bias"
                pros="Drift-independent, no close bias"
                cons="Ignores overnight gaps"
              />

              {/* 20/60/120-Day Rolling */}
              <EstimatorBox
                color="#3b82f6"
                name="20/60/120-Day Rolling"
                formula="Standard deviation of log returns × √252"
                whenToUse="Simple baseline, compare short vs long term"
                pros="Easy to interpret, widely understood"
                cons="Backward-looking, slow to react"
              />

              {/* EWMA */}
              <EstimatorBox
                color="#6366f1"
                name="EWMA (λ=0.94)"
                formula="Exponentially weighted moving average"
                whenToUse="Regime change detection, recent data matters more"
                pros="Reacts fast to volatility shifts"
                cons="Can overreact to noise"
              />

              {/* Parkinson */}
              <EstimatorBox
                color="#ef4444"
                name="Parkinson"
                formula="(1/4ln2) × (H - L)²"
                whenToUse="High-frequency data, intraday range focus"
                pros="Efficient, uses high-low range"
                cons="Ignores open/close, overnight gaps"
              />

              {/* Garman-Klass */}
              <EstimatorBox
                color="#06b6d4"
                name="Garman-Klass"
                formula="0.5(H-L)² - (2ln2-1)(C-O)²"
                whenToUse="When you have OHLC but no overnight data"
                pros="More efficient than close-only"
                cons="Assumes zero drift"
              />
            </div>
          </div>
        </div>
      </MethodologySection>
    </main>
  );
}

// --- Helper Components ---
function EstimatorBox({
  color,
  name,
  formula,
  whenToUse,
  pros,
  cons,
}: {
  color: string;
  name: string;
  formula: string;
  whenToUse: string;
  pros: string;
  cons: string;
}) {
  return (
    <div
      style={{
        padding: 14,
        borderRadius: 6,
        border: `1px solid ${color}30`,
        background: `${color}08`,
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 4,
        }}
      >
        <div
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: color,
          }}
        />
        <strong
          style={{
            fontSize: 12,
            fontWeight: 700,
            color: color,
          }}
        >
          {name}
        </strong>
      </div>

      {/* Formula */}
      <div
        style={{
          fontSize: 10,
          fontFamily: "monospace",
          color: "var(--muted)",
          padding: "4px 8px",
          background: "var(--background)",
          borderRadius: 3,
          border: "1px solid var(--border)",
        }}
      >
        {formula}
      </div>

      {/* When to use */}
      <div style={{ fontSize: 11, lineHeight: 1.5 }}>
        <span style={{ color: "var(--foreground)", fontWeight: 600 }}>Use when: </span>
        <span style={{ color: "var(--muted)" }}>{whenToUse}</span>
      </div>

      {/* Pros/Cons */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 8,
          fontSize: 10,
        }}
      >
        <div>
          <span style={{ color: "#22c55e", fontWeight: 600 }}>+ </span>
          <span style={{ color: "var(--muted)" }}>{pros}</span>
        </div>
        <div>
          <span style={{ color: "#ef4444", fontWeight: 600 }}>- </span>
          <span style={{ color: "var(--muted)" }}>{cons}</span>
        </div>
      </div>
    </div>
  );
}
