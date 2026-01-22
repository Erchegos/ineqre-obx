"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import MonteCarloChart from "@/components/MonteCarloChart";
import {
  generateMonteCarloSimulation,
  calculateFinalDistribution,
  calculateTheoreticalDistribution,
  calculatePercentiles,
  calculateParameters,
} from "@/lib/montecarlo";

type AnalyticsData = {
  ticker: string;
  count: number;
  prices: Array<{ date: string; close: number; adj_close?: number }>;
  returns: {
    adjusted: Array<{ date: string; return: number }>;
    raw: Array<{ date: string; return: number }>;
  };
  dateRange: {
    start: string;
    end: string;
  };
};

export default function MonteCarloPage() {
  const params = useParams<{ ticker?: string }>();

  const ticker = useMemo(() => {
    const t = params?.ticker;
    return typeof t === "string" && t.length ? decodeURIComponent(t).toUpperCase() : "";
  }, [params]);

  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Simulation parameters
  const [numPaths, setNumPaths] = useState(100);
  const [horizon, setHorizon] = useState<"1M" | "3M" | "6M" | "1Y">("1Y");

  // Custom parameters (null = use historical)
  const [customDrift, setCustomDrift] = useState<number | null>(null);
  const [customVolatility, setCustomVolatility] = useState<number | null>(null);

  // Fetch stock data
  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (!ticker) {
        setLoading(false);
        setData(null);
        setError("Missing ticker in route params.");
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const url = `/api/analytics/${encodeURIComponent(ticker)}?limit=${encodeURIComponent(String(500))}&adjusted=true`;

        const res = await fetch(url, {
          method: "GET",
          headers: { accept: "application/json" },
          cache: "no-store",
        });

        if (!res.ok) {
          const text = await res.text();
          if (!cancelled) {
            setError(`Analytics API failed (${res.status} ${res.statusText}): ${text}`);
            setData(null);
          }
          return;
        }

        const json = (await res.json()) as AnalyticsData;

        if (!cancelled) {
          setData(json);
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
  }, [ticker]);

  // Calculate simulation
  const simulation = useMemo(() => {
    if (!data || !data.returns || !data.prices) return null;

    // Use adjusted returns for realistic simulation
    const returns = data.returns.adjusted.map(r => r.return);

    if (returns.length < 20) return null;

    // Calculate parameters from historical data
    const { drift: historicalDrift, volatility: historicalVolatility } = calculateParameters(returns);

    // Use custom parameters if set, otherwise use historical
    const drift = customDrift !== null ? customDrift : historicalDrift;
    const volatility = customVolatility !== null ? customVolatility : historicalVolatility;

    // Get current price
    const currentPrice = data.prices[data.prices.length - 1].close;

    // Determine number of steps based on horizon
    const horizonDays: Record<typeof horizon, number> = {
      "1M": 21,
      "3M": 63,
      "6M": 126,
      "1Y": 252,
    };
    const numSteps = horizonDays[horizon];

    // Generate simulation (with outlier filtering)
    const paths = generateMonteCarloSimulation(
      currentPrice,
      numPaths,
      numSteps,
      drift,
      volatility,
      1,
      true // Filter outliers
    );

    const distribution = calculateFinalDistribution(paths, 60);
    const theoreticalDist = calculateTheoreticalDistribution(
      currentPrice,
      numSteps,
      drift,
      volatility,
      distribution
    );
    const percentiles = calculatePercentiles(paths);

    return {
      paths,
      distribution,
      theoreticalDist,
      percentiles,
      currentPrice,
      numSteps,
      drift,
      volatility,
      historicalDrift,
      historicalVolatility,
    };
  }, [data, numPaths, horizon, customDrift, customVolatility]);

  return (
    <main style={{ padding: 24, maxWidth: 1400, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 24, flexWrap: "wrap" }}>
        <h1 style={{ fontSize: 32, fontWeight: 600, margin: 0, letterSpacing: "-0.02em", color: "var(--foreground)" }}>
          {ticker || "?"} - Monte Carlo Simulation
        </h1>
        <Link
          href={`/stocks/${ticker}`}
          style={{
            display: "inline-block",
            color: "var(--foreground)",
            textDecoration: "none",
            fontSize: 14,
            fontWeight: 600,
            padding: "8px 16px",
            border: "1px solid var(--border)",
            borderRadius: 2,
            background: "var(--card-bg)",
            transition: "all 0.15s ease"
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
          ← Back to {ticker} analysis
        </Link>
      </div>

      {/* Description */}
      <div style={{
        marginBottom: 24,
        padding: 16,
        background: "var(--hover-bg)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        fontSize: 13,
        color: "var(--muted-foreground)",
        lineHeight: 1.6,
      }}>
        <p style={{ margin: 0, marginBottom: 8 }}>
          <strong>Monte Carlo Price Simulation</strong> - Visualize potential future price paths for {ticker} using historical volatility and returns.
        </p>
        <p style={{ margin: 0 }}>
          Each path represents one possible future scenario. The simulation uses <strong>Geometric Brownian Motion (GBM)</strong> with
          parameters calculated from the stock's historical performance. Extreme outlier paths are filtered for realistic results.
        </p>
      </div>

      {loading && (
        <div style={{ padding: 20, borderRadius: 4, border: "1px solid var(--border)", background: "var(--card-bg)", color: "var(--muted)", fontSize: 14 }}>
          Loading stock data...
        </div>
      )}

      {!loading && error && (
        <div style={{ padding: 20, borderRadius: 4, border: "1px solid var(--danger)", background: "var(--card-bg)" }}>
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 6, color: "var(--danger)" }}>Error</div>
          <div style={{ fontSize: 13, color: "var(--muted)" }}>{error}</div>
        </div>
      )}

      {!loading && data && simulation && (
        <>
          {/* Controls */}
          <div style={{
            marginBottom: 24,
            padding: 20,
            background: "var(--card-bg)",
            border: "1px solid var(--border)",
            borderRadius: 8,
          }}>
            <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16, color: "var(--foreground)" }}>
              Simulation Parameters
            </h2>

            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
              gap: 16,
            }}>
              {/* Number of Paths */}
              <div>
                <label style={{
                  display: "block",
                  fontSize: 12,
                  color: "var(--muted)",
                  marginBottom: 6,
                  fontWeight: 500,
                }}>
                  Number of Paths
                </label>
                <select
                  value={numPaths}
                  onChange={(e) => setNumPaths(Number(e.target.value))}
                  style={{
                    width: "100%",
                    padding: "8px 12px",
                    borderRadius: 4,
                    border: "1px solid var(--border)",
                    background: "var(--input-bg)",
                    color: "var(--foreground)",
                    fontSize: 14,
                    cursor: "pointer",
                  }}
                >
                  <option value={50}>50 paths</option>
                  <option value={100}>100 paths (recommended)</option>
                  <option value={200}>200 paths</option>
                  <option value={500}>500 paths</option>
                </select>
              </div>

              {/* Time Horizon */}
              <div>
                <label style={{
                  display: "block",
                  fontSize: 12,
                  color: "var(--muted)",
                  marginBottom: 6,
                  fontWeight: 500,
                }}>
                  Time Horizon
                </label>
                <select
                  value={horizon}
                  onChange={(e) => setHorizon(e.target.value as typeof horizon)}
                  style={{
                    width: "100%",
                    padding: "8px 12px",
                    borderRadius: 4,
                    border: "1px solid var(--border)",
                    background: "var(--input-bg)",
                    color: "var(--foreground)",
                    fontSize: 14,
                    cursor: "pointer",
                  }}
                >
                  <option value="1M">1 Month (21 days)</option>
                  <option value="3M">3 Months (63 days)</option>
                  <option value="6M">6 Months (126 days)</option>
                  <option value="1Y">1 Year (252 days)</option>
                </select>
              </div>

              {/* Drift (μ) - editable */}
              <div>
                <label style={{
                  display: "block",
                  fontSize: 12,
                  color: "var(--muted)",
                  marginBottom: 6,
                  fontWeight: 500,
                }}>
                  Drift (μ) - Daily
                </label>
                <input
                  type="number"
                  step="0.001"
                  value={customDrift !== null ? (customDrift * 100).toFixed(3) : (simulation.historicalDrift * 100).toFixed(3)}
                  onChange={(e) => {
                    const val = Number(e.target.value) / 100;
                    setCustomDrift(val);
                  }}
                  placeholder={`Historical: ${(simulation.historicalDrift * 100).toFixed(3)}%`}
                  style={{
                    width: "100%",
                    padding: "8px 12px",
                    borderRadius: 4,
                    border: "1px solid var(--border)",
                    background: customDrift !== null ? "var(--input-bg)" : "var(--card-bg)",
                    color: "var(--foreground)",
                    fontSize: 14,
                    fontFamily: "monospace",
                  }}
                />
                <button
                  onClick={() => setCustomDrift(null)}
                  style={{
                    marginTop: 4,
                    fontSize: 10,
                    color: "var(--muted)",
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    textDecoration: "underline",
                  }}
                >
                  Reset to historical
                </button>
              </div>

              {/* Volatility (σ) - editable */}
              <div>
                <label style={{
                  display: "block",
                  fontSize: 12,
                  color: "var(--muted)",
                  marginBottom: 6,
                  fontWeight: 500,
                }}>
                  Volatility (σ) - Daily
                </label>
                <input
                  type="number"
                  step="0.001"
                  value={customVolatility !== null ? (customVolatility * 100).toFixed(3) : (simulation.historicalVolatility * 100).toFixed(3)}
                  onChange={(e) => {
                    const val = Number(e.target.value) / 100;
                    setCustomVolatility(val);
                  }}
                  placeholder={`Historical: ${(simulation.historicalVolatility * 100).toFixed(3)}%`}
                  style={{
                    width: "100%",
                    padding: "8px 12px",
                    borderRadius: 4,
                    border: "1px solid var(--border)",
                    background: customVolatility !== null ? "var(--input-bg)" : "var(--card-bg)",
                    color: "var(--foreground)",
                    fontSize: 14,
                    fontFamily: "monospace",
                  }}
                />
                <button
                  onClick={() => setCustomVolatility(null)}
                  style={{
                    marginTop: 4,
                    fontSize: 10,
                    color: "var(--muted)",
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    textDecoration: "underline",
                  }}
                >
                  Reset to historical
                </button>
              </div>
            </div>
          </div>

          {/* Chart */}
          <div style={{
            padding: 20,
            background: "var(--card-bg)",
            border: "1px solid var(--border)",
            borderRadius: 8,
          }}>
            <MonteCarloChart
              paths={simulation.paths}
              distribution={simulation.distribution}
              theoreticalDistribution={simulation.theoreticalDist}
              startPrice={simulation.currentPrice}
              finalTime={simulation.numSteps}
              percentiles={simulation.percentiles}
              height={400}
              ticker={ticker}
            />
          </div>

          {/* Interpretation Guide */}
          <div style={{
            marginTop: 24,
            padding: 16,
            background: "var(--hover-bg)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            fontSize: 13,
            color: "var(--muted-foreground)",
            lineHeight: 1.6,
          }}>
            <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8, color: "var(--foreground)" }}>
              How to Interpret This Simulation
            </h3>
            <ul style={{ margin: 0, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 6 }}>
              <li><strong>Paths:</strong> Each line shows one possible future price trajectory based on historical patterns.</li>
              <li><strong>Magenta path:</strong> One randomly highlighted path for easier tracking.</li>
              <li><strong>Distribution:</strong> Shows the range of possible final prices. Bell curve shape indicates normal distribution.</li>
              <li><strong>Green area:</strong> Empirical distribution from simulation results.</li>
              <li><strong>Magenta curve:</strong> Theoretical normal distribution predicted by GBM model.</li>
              <li><strong>Percentiles:</strong> 5th and 95th percentiles show the range where 90% of outcomes fall.</li>
            </ul>
          </div>
        </>
      )}
    </main>
  );
}
