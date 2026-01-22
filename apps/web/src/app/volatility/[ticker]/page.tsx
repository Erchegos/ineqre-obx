"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";

// --- Components ---
import VolatilityChart from "@/components/VolatilityChart";
import SeasonalityChart from "@/components/SeasonalityChart";
import VolatilityCorrelationChart from "@/components/VolatilityCorrelationChart";

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
    rolling120: number | null;
    ewma94: number | null;
    ewma97: number | null;
    parkinson: number | null;
    garmanKlass: number | null;
    rogersSatchell: number | null;
    yangZhang: number | null;
  };
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

const fmtPct = (n: number | null | undefined) => (n !== null && n !== undefined ? `${(n * 100).toFixed(2)}%` : "—");

export default function VolatilityPage() {
  const params = useParams<{ ticker?: string }>();
  const searchParams = useSearchParams();

  const ticker = useMemo(() => {
    const t = params?.ticker;
    return typeof t === "string" && t.length ? decodeURIComponent(t).toUpperCase() : "";
  }, [params]);

  const initialLimit = useMemo(() => {
    return clampInt(searchParams.get("limit"), 1500, 100, 2000);
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
    "ewma94"
  ]);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (!ticker) return;
      setLoading(true);
      setError(null);
      try {
        // Fetch stock volatility data
        const url = `/api/volatility/${encodeURIComponent(ticker)}?limit=${limit}&adjusted=${isAdjusted}`;
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
    return () => { cancelled = true; };
  }, [ticker, limit, isAdjusted]);

  const toggleMeasure = (measure: string) => {
    setSelectedMeasures((prev) =>
      prev.includes(measure) ? prev.filter((m) => m !== measure) : [...prev, measure]
    );
  };

  // --- Derived Metrics ---
  const stats = useMemo(() => {
    if (!data) return null;

    // Primary volatility (YZ preferred, fallback to RS or R20)
    const primaryVol = data.current.yangZhang ?? data.current.rogersSatchell ?? data.current.rolling20 ?? 0;
    const percentile = data.percentiles.yangZhang ?? data.percentiles.rogersSatchell ?? data.percentiles.rolling20 ?? 0;

    // Vol regime based on percentile
    let regime = "Normal";
    if (percentile > 80) regime = "High";
    else if (percentile < 25) regime = "Low";

    // Trend: expanding or contracting
    const shortTerm = data.current.rolling20 ?? 0;
    const longTerm = data.current.rolling60 ?? 0;
    const volTrend = shortTerm > longTerm ? "Expanding" : "Contracting";

    // Historical range
    const seriesVals = data.series
        .map(s => s.yangZhang ?? s.rogersSatchell ?? s.rolling20)
        .filter((n): n is number => typeof n === 'number');
    const maxVol = seriesVals.length ? Math.max(...seriesVals) : 0;
    const minVol = seriesVals.length ? Math.min(...seriesVals) : 0;

    // Implied moves (normal distribution, 1 standard deviation)
    const impliedDay = (primaryVol / Math.sqrt(252)) * 100;
    const impliedWeek = (primaryVol / Math.sqrt(252)) * Math.sqrt(5) * 100;

    return { primaryVol, percentile, regime, volTrend, maxVol, minVol, impliedDay, impliedWeek };
  }, [data]);

  if (loading && !data) return <main style={{ padding: 24 }}>Loading...</main>;
  if (error || !data || !stats) return <main style={{ padding: 24 }}>Error: {error}</main>;

  return (
    <main style={{ padding: 24, maxWidth: 1400, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 32, flexWrap: "wrap", gap: 16 }}>
        <div>
          <Link
            href={`/stocks/${ticker}`}
            style={{
              display: "inline-block",
              color: "var(--muted)",
              fontSize: 13,
              marginBottom: 8,
              textDecoration: "none"
            }}
          >
            ← Back to {ticker}
          </Link>
          <h1 style={{ fontSize: 32, fontWeight: 700, margin: 0, color: "var(--foreground)" }}>
            Volatility Analysis
          </h1>
        </div>

        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          {/* Price Mode Toggle */}
          <div style={{ display: "flex", background: "var(--card-bg)", borderRadius: 6, border: "1px solid var(--border)", padding: 2 }}>
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
                transition: "all 0.15s"
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
                transition: "all 0.15s"
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
              { l: "All", v: 2000 }
            ].map((tf) => (
              <button
                key={tf.v}
                onClick={() => setLimit(tf.v)}
                style={{
                  padding: "6px 12px",
                  borderRadius: 4,
                  border: limit === tf.v ? "1px solid var(--accent)" : "1px solid var(--border)",
                  background: limit === tf.v ? "var(--accent)" : "transparent",
                  color: limit === tf.v ? "#fff" : "var(--muted)",
                  fontSize: 11,
                  fontWeight: 500,
                  cursor: "pointer",
                  transition: "all 0.15s"
                }}
              >
                {tf.l}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Key Metrics Grid - SIMPLIFIED */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
        gap: 16,
        marginBottom: 40
      }}>
        {/* Current Volatility */}
        <MetricCard
          label="Current Volatility"
          value={fmtPct(stats.primaryVol)}
          description="Annualized (Yang-Zhang estimator with gap adjustment)"
          highlight
        />

        {/* Historical Percentile */}
        <MetricCard
          label="Historical Rank"
          value={`${stats.percentile.toFixed(0)}th percentile`}
          description={`${stats.regime} regime relative to ${limit}d history`}
        />

        {/* Beta */}
        <MetricCard
          label="Market Beta"
          value={data.beta !== null ? data.beta.toFixed(2) : "—"}
          description={`Correlation with OBX index (${limit}d period)`}
        />

        {/* Volatility Trend */}
        <MetricCard
          label="Vol Trend"
          value={stats.volTrend}
          description="20d vs 60d: short-term relative to medium-term"
          valueColor={stats.volTrend === "Expanding" ? "#ef4444" : "#22c55e"}
        />

        {/* Implied 1-Day Move */}
        <MetricCard
          label="Expected Daily Move"
          value={`±${stats.impliedDay.toFixed(2)}%`}
          description="68% probability range (1σ, assumes normality)"
        />

        {/* Implied 1-Week Move */}
        <MetricCard
          label="Expected Weekly Move"
          value={`±${stats.impliedWeek.toFixed(2)}%`}
          description="68% probability range (5-day, 1σ)"
        />
      </div>

      {/* Chart Section */}
      <div style={{ marginBottom: 40 }}>
        <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 16, color: "var(--foreground)" }}>
          Volatility Time Series
        </h2>

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
                  transition: "all 0.15s"
                }}
              >
                <div
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: config.color,
                    opacity: isSelected ? 1 : 0.3
                  }}
                />
                {config.label}
              </button>
            );
          })}
        </div>

        {/* Chart */}
        <div style={{
          padding: 20,
          borderRadius: 6,
          border: "1px solid var(--border)",
          background: "var(--card-bg)"
        }}>
          <VolatilityChart
            data={data.series}
            selectedMeasures={selectedMeasures}
            height={420}
          />
        </div>
      </div>

      {/* Volatility Correlation Chart */}
      {marketData && (
        <div style={{ marginBottom: 40 }}>
          <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 16, color: "var(--foreground)" }}>
            Volatility Correlation with Market (OBX)
          </h2>
          <p style={{ fontSize: 12, color: "var(--muted)", marginBottom: 16, lineHeight: 1.5 }}>
            Rolling 30-day correlation between {ticker} volatility and OBX index volatility over the full available history.
            Shows how closely the stock's volatility moves with overall market volatility.
          </p>
          <div style={{
            padding: 20,
            borderRadius: 6,
            border: "1px solid var(--border)",
            background: "var(--card-bg)"
          }}>
            <VolatilityCorrelationChart
              stockData={data.series}
              marketData={marketData.series}
              height={280}
              window={30}
            />
          </div>
        </div>
      )}

      {/* Two-Column Layout: Seasonality + Info Box */}
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 24 }}>
        {/* Seasonality Chart */}
        <div>
          <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 12, color: "var(--foreground)" }}>
            Monthly Seasonality
          </h3>
          <p style={{ fontSize: 12, color: "var(--muted)", marginBottom: 16, lineHeight: 1.5 }}>
            Average annualized volatility by calendar month. Helps identify historically volatile periods.
          </p>
          <div style={{
            padding: 20,
            borderRadius: 6,
            border: "1px solid var(--border)",
            background: "var(--card-bg)",
            height: 280
          }}>
            <SeasonalityChart data={data.series} />
          </div>
        </div>

        {/* Volatility Estimators Explained */}
        <div>
          <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 12, color: "var(--foreground)" }}>
            Estimator Guide
          </h3>
          <div style={{
            display: "flex",
            flexDirection: "column",
            gap: 12
          }}>
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
    </main>
  );
}

// --- Helper Components ---
function MetricCard({
  label,
  value,
  description,
  highlight,
  valueColor
}: {
  label: string;
  value: string;
  description: string;
  highlight?: boolean;
  valueColor?: string;
}) {
  return (
    <div style={{
      padding: 20,
      borderRadius: 6,
      background: highlight ? "rgba(245, 158, 11, 0.05)" : "var(--card-bg)",
      border: highlight ? "1.5px solid #f59e0b" : "1px solid var(--border)",
      display: "flex",
      flexDirection: "column",
      gap: 8
    }}>
      <div style={{
        fontSize: 11,
        color: "var(--muted)",
        textTransform: "uppercase",
        fontWeight: 700,
        letterSpacing: "0.5px"
      }}>
        {label}
      </div>
      <div style={{
        fontSize: 24,
        fontWeight: 700,
        color: valueColor || "var(--foreground)",
        fontFamily: "monospace"
      }}>
        {value}
      </div>
      <div style={{
        fontSize: 11,
        color: "var(--muted-foreground)",
        lineHeight: 1.4
      }}>
        {description}
      </div>
    </div>
  );
}

function EstimatorBox({
  color,
  name,
  formula,
  whenToUse,
  pros,
  cons
}: {
  color: string;
  name: string;
  formula: string;
  whenToUse: string;
  pros: string;
  cons: string;
}) {
  return (
    <div style={{
      padding: 14,
      borderRadius: 6,
      border: `1px solid ${color}30`,
      background: `${color}08`,
      display: "flex",
      flexDirection: "column",
      gap: 6
    }}>
      {/* Header */}
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        marginBottom: 4
      }}>
        <div style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: color
        }} />
        <strong style={{
          fontSize: 12,
          fontWeight: 700,
          color: color
        }}>
          {name}
        </strong>
      </div>

      {/* Formula */}
      <div style={{
        fontSize: 10,
        fontFamily: "monospace",
        color: "var(--muted)",
        padding: "4px 8px",
        background: "var(--background)",
        borderRadius: 3,
        border: "1px solid var(--border)"
      }}>
        {formula}
      </div>

      {/* When to use */}
      <div style={{ fontSize: 11, lineHeight: 1.5 }}>
        <span style={{ color: "var(--foreground)", fontWeight: 600 }}>Use when: </span>
        <span style={{ color: "var(--muted)" }}>{whenToUse}</span>
      </div>

      {/* Pros/Cons */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 8,
        fontSize: 10
      }}>
        <div>
          <span style={{ color: "#22c55e", fontWeight: 600 }}>✓ </span>
          <span style={{ color: "var(--muted)" }}>{pros}</span>
        </div>
        <div>
          <span style={{ color: "#ef4444", fontWeight: 600 }}>✗ </span>
          <span style={{ color: "var(--muted)" }}>{cons}</span>
        </div>
      </div>
    </div>
  );
}
