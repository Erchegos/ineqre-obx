"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import CorrelationHeatmap from "@/components/CorrelationHeatmap";
import RollingCorrelationChart from "@/components/RollingCorrelationChart";

const PRESET_GROUPS = {
  "Norwegian Equities": ["AKER", "DNB", "EQNR", "MOWI", "OBX"],
  "Energy": ["EQNR", "AKRBP"],
  "100 Billion NOK Club": ["DNB", "EQNR", "MOWI", "TEL", "YAR", "NHY", "ORK", "GJF", "AKRBP"],
};

const TIMEFRAMES = [
  { label: "6 Months", days: 180 },
  { label: "1 Year", days: 365 },
  { label: "3 Years", days: 1095 },
  { label: "5 Years", days: 1825 },
];

const ROLLING_WINDOWS = [
  { label: "20 Days", days: 20 },
  { label: "60 Days", days: 60 },
  { label: "120 Days", days: 120 },
  { label: "252 Days", days: 252 },
];

export default function CorrelationPage() {
  const [selectedTickers, setSelectedTickers] = useState<string[]>([
    "AKER",
    "DNB",
    "EQNR",
    "OBX",
  ]);
  const [availableTickers, setAvailableTickers] = useState<string[]>([]);
  const [tickerInput, setTickerInput] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
  const [correlationData, setCorrelationData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [timeframe, setTimeframe] = useState(365);
  const [rollingWindow, setRollingWindow] = useState(60);
  const [showInfo, setShowInfo] = useState(false);

  useEffect(() => {
    fetchTickers();
  }, []);

  async function fetchTickers() {
    try {
      const res = await fetch("/api/stocks");
      if (res.ok) {
        const stocks = await res.json();
        setAvailableTickers(stocks);
      }
    } catch (e) {
      console.error("Failed to fetch tickers:", e);
    }
  }

  const filteredTickers = availableTickers.filter(
    (t) =>
      t.toLowerCase().includes(tickerInput.toLowerCase()) &&
      !selectedTickers.includes(t)
  );

  function handlePresetGroup(group: keyof typeof PRESET_GROUPS) {
    setSelectedTickers(PRESET_GROUPS[group]);
  }

  function addTicker(ticker: string) {
    if (!selectedTickers.includes(ticker)) {
      setSelectedTickers([...selectedTickers, ticker]);
    }
    setTickerInput("");
    setShowDropdown(false);
  }

  function removeTicker(ticker: string) {
    setSelectedTickers(selectedTickers.filter((t) => t !== ticker));
  }

  async function computeCorrelations() {
    if (selectedTickers.length < 2) {
      setError("Select at least 2 tickers");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        tickers: selectedTickers.join(","),
        limit: timeframe.toString(),
        window: rollingWindow.toString(),
      });

      const res = await fetch(`/api/correlation?${params}`);
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to compute correlations");
        setCorrelationData(null);
      } else {
        setCorrelationData(data);
      }
    } catch (e: any) {
      setError(e.message);
      setCorrelationData(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "var(--background)",
        color: "var(--foreground)",
        padding: 32,
      }}
    >
      <style dangerouslySetInnerHTML={{ __html: `
        @media (prefers-color-scheme: dark) {
          .card-enhanced {
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
          }
          .stat-box {
            background: rgba(255, 255, 255, 0.03) !important;
            border: 1px solid rgba(255, 255, 255, 0.08);
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
          }
          .stat-box:hover {
            background: rgba(255, 255, 255, 0.05) !important;
            border-color: rgba(59, 130, 246, 0.3);
          }
        }
      `}} />
      
      <div style={{ maxWidth: 1400, margin: "0 auto" }}>
        {/* Header with Info Button */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 }}>
          <div>
            <Link
              href="/stocks"
              style={{
                color: "var(--muted)",
                textDecoration: "none",
                fontSize: 14,
                marginBottom: 8,
                display: "inline-block",
              }}
            >
              ← Back to stocks
            </Link>
            <h1 style={{ fontSize: 32, fontWeight: 700, margin: 0 }}>
              Correlation Matrix
            </h1>
          </div>
          
          {/* Info Button */}
          <button
            onClick={() => setShowInfo(!showInfo)}
            style={{
              background: "var(--card-bg)",
              border: "1px solid var(--border)",
              borderRadius: 4,
              width: 32,
              height: 32,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              fontSize: 16,
              fontWeight: 600,
              color: "var(--foreground)",
            }}
            title="Show information"
          >
            ?
          </button>
        </div>

        {/* Info Panel */}
        {showInfo && (
          <div
            className="card-enhanced"
            style={{
              background: "var(--card-bg)",
              border: "1px solid var(--card-border)",
              borderRadius: 8,
              padding: 20,
              marginBottom: 24,
              fontSize: 14,
              lineHeight: 1.6,
            }}
          >
            <strong>Correlation Matrix:</strong> Pairwise correlations between assets (-1 to +1)
            <br />
            <strong>Average Correlations:</strong> Mean correlation per ticker vs others
            <br />
            <strong>Rolling Correlation:</strong> Time-series with volatility overlay
            <br />
            <strong>Market Regimes:</strong> Volatility distribution (High Stress &gt; 2σ, Elevated &gt; 1σ, Normal &gt; 0.5σ, Low ≤ 0.5σ)
          </div>
        )}

        {/* Controls Grid */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
            gap: 16,
            marginBottom: 24,
          }}
        >
          {/* Preset Groups */}
          <div
            className="card-enhanced"
            style={{
              background: "var(--card-bg)",
              border: "1px solid var(--card-border)",
              borderRadius: 8,
              padding: 16,
            }}
          >
            <h3 style={{ fontSize: 12, fontWeight: 600, marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--muted)" }}>
              Preset Groups
            </h3>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {Object.keys(PRESET_GROUPS).map((group) => (
                <button
                  key={group}
                  onClick={() => handlePresetGroup(group as keyof typeof PRESET_GROUPS)}
                  style={{
                    padding: "6px 12px",
                    background: "var(--button-bg)",
                    color: "var(--foreground)",
                    border: "1px solid var(--border)",
                    borderRadius: 4,
                    cursor: "pointer",
                    fontSize: 13,
                    fontWeight: 500,
                    transition: "all 0.2s",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = "rgb(59, 130, 246)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = "var(--border)";
                  }}
                >
                  {group}
                </button>
              ))}
            </div>
          </div>

          {/* Add Ticker */}
          <div
            className="card-enhanced"
            style={{
              background: "var(--card-bg)",
              border: "1px solid var(--card-border)",
              borderRadius: 8,
              padding: 16,
            }}
          >
            <h3 style={{ fontSize: 12, fontWeight: 600, marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--muted)" }}>
              Add Ticker
            </h3>
            <div style={{ position: "relative" }}>
              <input
                type="text"
                value={tickerInput}
                onChange={(e) => {
                  setTickerInput(e.target.value);
                  setShowDropdown(true);
                }}
                onFocus={() => setShowDropdown(true)}
                onBlur={() => setTimeout(() => setShowDropdown(false), 200)}
                placeholder="Search ticker..."
                style={{
                  width: "100%",
                  padding: "8px 12px",
                  background: "var(--input-bg)",
                  color: "var(--foreground)",
                  border: "1px solid var(--border)",
                  borderRadius: 4,
                  fontSize: 13,
                }}
              />
              
              {showDropdown && tickerInput && filteredTickers.length > 0 && (
                <div
                  style={{
                    position: "absolute",
                    top: "100%",
                    left: 0,
                    right: 0,
                    background: "var(--card-bg)",
                    border: "1px solid var(--border)",
                    borderRadius: 4,
                    marginTop: 4,
                    maxHeight: 200,
                    overflowY: "auto",
                    zIndex: 10,
                    boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
                  }}
                >
                  {filteredTickers.slice(0, 15).map((ticker) => (
                    <div
                      key={ticker}
                      onClick={() => addTicker(ticker)}
                      style={{
                        padding: "8px 12px",
                        cursor: "pointer",
                        fontSize: 13,
                        borderBottom: "1px solid var(--border)",
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = "var(--hover-bg)";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = "transparent";
                      }}
                    >
                      {ticker}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Timeframe */}
          <div
            className="card-enhanced"
            style={{
              background: "var(--card-bg)",
              border: "1px solid var(--card-border)",
              borderRadius: 8,
              padding: 16,
            }}
          >
            <h3 style={{ fontSize: 12, fontWeight: 600, marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--muted)" }}>
              Timeframe
            </h3>
            <select
              value={timeframe}
              onChange={(e) => setTimeframe(Number(e.target.value))}
              style={{
                width: "100%",
                padding: "8px 12px",
                background: "var(--input-bg)",
                color: "var(--foreground)",
                border: "1px solid var(--border)",
                borderRadius: 4,
                fontSize: 13,
              }}
            >
              {TIMEFRAMES.map((tf) => (
                <option key={tf.days} value={tf.days}>
                  {tf.label}
                </option>
              ))}
            </select>
          </div>

          {/* Rolling Window */}
          <div
            className="card-enhanced"
            style={{
              background: "var(--card-bg)",
              border: "1px solid var(--card-border)",
              borderRadius: 8,
              padding: 16,
            }}
          >
            <h3 style={{ fontSize: 12, fontWeight: 600, marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--muted)" }}>
              Rolling Window
            </h3>
            <select
              value={rollingWindow}
              onChange={(e) => setRollingWindow(Number(e.target.value))}
              style={{
                width: "100%",
                padding: "8px 12px",
                background: "var(--input-bg)",
                color: "var(--foreground)",
                border: "1px solid var(--border)",
                borderRadius: 4,
                fontSize: 13,
              }}
            >
              {ROLLING_WINDOWS.map((rw) => (
                <option key={rw.days} value={rw.days}>
                  {rw.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Selected Tickers */}
        <div
          className="card-enhanced"
          style={{
            background: "var(--card-bg)",
            border: "1px solid var(--card-border)",
            borderRadius: 8,
            padding: 16,
            marginBottom: 16,
          }}
        >
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {selectedTickers.map((ticker) => (
              <div
                key={ticker}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "4px 10px",
                  background: "rgb(59, 130, 246)",
                  color: "white",
                  borderRadius: 4,
                  fontSize: 13,
                  fontWeight: 500,
                  boxShadow: "0 2px 4px rgba(59, 130, 246, 0.3)",
                }}
              >
                {ticker}
                <button
                  onClick={() => removeTicker(ticker)}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "white",
                    cursor: "pointer",
                    fontSize: 14,
                    lineHeight: 1,
                  }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Compute Button */}
        <button
          onClick={computeCorrelations}
          disabled={loading || selectedTickers.length < 2}
          style={{
            width: "100%",
            padding: "14px",
            background:
              loading || selectedTickers.length < 2
                ? "var(--muted)"
                : "rgb(59, 130, 246)",
            color: "white",
            border: "none",
            borderRadius: 8,
            fontSize: 15,
            fontWeight: 600,
            cursor:
              loading || selectedTickers.length < 2 ? "not-allowed" : "pointer",
            marginBottom: 24,
            boxShadow: loading || selectedTickers.length < 2 ? "none" : "0 4px 12px rgba(59, 130, 246, 0.4)",
            transition: "all 0.2s",
          }}
          onMouseEnter={(e) => {
            if (!loading && selectedTickers.length >= 2) {
              e.currentTarget.style.transform = "translateY(-1px)";
              e.currentTarget.style.boxShadow = "0 6px 16px rgba(59, 130, 246, 0.5)";
            }
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = "translateY(0)";
            e.currentTarget.style.boxShadow = loading || selectedTickers.length < 2 ? "none" : "0 4px 12px rgba(59, 130, 246, 0.4)";
          }}
        >
          {loading ? "Computing..." : "Compute Correlations"}
        </button>

        {/* Error */}
        {error && (
          <div
            style={{
              background: "rgba(239, 68, 68, 0.1)",
              border: "1px solid rgb(239, 68, 68)",
              color: "rgb(239, 68, 68)",
              padding: 14,
              borderRadius: 8,
              marginBottom: 24,
              fontSize: 13,
              boxShadow: "0 2px 8px rgba(239, 68, 68, 0.2)",
            }}
          >
            {error}
          </div>
        )}

        {/* Results */}
        {correlationData && (
          <>
            {/* Period Info */}
            <div style={{ marginBottom: 20, fontSize: 13, color: "var(--muted)", textAlign: "center" }}>
              {correlationData.startDate} to {correlationData.endDate} • {correlationData.observations} observations • {rollingWindow}d window
            </div>

            {/* Correlation Matrix */}
            {correlationData.matrix && (
              <div
                className="card-enhanced"
                style={{
                  background: "var(--card-bg)",
                  border: "1px solid var(--card-border)",
                  borderRadius: 8,
                  padding: 24,
                  marginBottom: 20,
                }}
              >
                <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16 }}>
                  Correlation Matrix
                </h2>
                <CorrelationHeatmap data={correlationData.matrix} />
              </div>
            )}

            {/* Average Correlations */}
            {correlationData.averageCorrelations && correlationData.averageCorrelations.length > 0 && (
              <div
                className="card-enhanced"
                style={{
                  background: "var(--card-bg)",
                  border: "1px solid var(--card-border)",
                  borderRadius: 8,
                  padding: 24,
                  marginBottom: 20,
                }}
              >
                <h2 
                  style={{ fontSize: 18, fontWeight: 600, marginBottom: 16 }}
                  title="Mean correlation of each ticker vs all other selected assets"
                >
                  Average Correlations
                </h2>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
                    gap: 12,
                  }}
                >
                  {correlationData.averageCorrelations.map(
                    (item: { ticker: string; avgCorrelation: number }) => (
                      <div
                        key={item.ticker}
                        className="stat-box"
                        style={{
                          padding: 16,
                          background: "var(--hover-bg)",
                          borderRadius: 6,
                          textAlign: "center",
                          cursor: "help",
                          transition: "all 0.2s",
                        }}
                        title={`Average correlation of ${item.ticker} with other assets. Higher = more synchronized movement.`}
                      >
                        <div
                          style={{
                            fontSize: 13,
                            fontWeight: 600,
                            marginBottom: 6,
                            color: "var(--muted)",
                          }}
                        >
                          {item.ticker}
                        </div>
                        <div style={{ fontSize: 22, fontWeight: 700, color: "rgb(59, 130, 246)" }}>
                          {item.avgCorrelation.toFixed(3)}
                        </div>
                      </div>
                    )
                  )}
                </div>
              </div>
            )}

            {/* Rolling Correlation Chart */}
            {correlationData.rollingCorrelations && correlationData.rollingCorrelations.length > 0 && (
              <div
                className="card-enhanced"
                style={{
                  background: "var(--card-bg)",
                  border: "1px solid var(--card-border)",
                  borderRadius: 8,
                  padding: 24,
                  marginBottom: 20,
                }}
              >
                <h2 
                  style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}
                  title="Time-series view of correlation between two assets with volatility overlay"
                >
                  Rolling Correlation ({selectedTickers[0]} vs {selectedTickers[1]})
                </h2>
                <p style={{ fontSize: 12, color: "var(--muted)", marginBottom: 16 }}>
                  Blue line: correlation (left axis) • Yellow area: volatility (right axis)
                </p>
                <RollingCorrelationChart
                  data={correlationData.rollingCorrelations}
                />
              </div>
            )}

            {/* Market Regime Distribution */}
            {correlationData.regimeDistribution && (
              <div
                className="card-enhanced"
                style={{
                  background: "var(--card-bg)",
                  border: "1px solid var(--card-border)",
                  borderRadius: 8,
                  padding: 24,
                }}
              >
                <h2 
                  style={{ fontSize: 18, fontWeight: 600, marginBottom: 16 }}
                  title="Percentage of time spent in different volatility regimes"
                >
                  Market Regime Distribution
                </h2>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
                    gap: 12,
                  }}
                >
                  {Object.entries(correlationData.regimeDistribution).map(
                    ([regime, pct]) => {
                      const tooltips: Record<string, string> = {
                        "High Stress": "Volatility > 2 standard deviations above mean",
                        "Elevated Risk": "Volatility between 1σ and 2σ above mean",
                        "Normal": "Volatility between 0.5σ and 1σ above mean",
                        "Low Volatility": "Volatility ≤ 0.5σ above mean",
                      };

                      const colors: Record<string, string> = {
                        "High Stress": "rgb(239, 68, 68)",
                        "Elevated Risk": "rgb(251, 146, 60)",
                        "Normal": "rgb(59, 130, 246)",
                        "Low Volatility": "rgb(34, 197, 94)",
                      };

                      return (
                        <div
                          key={regime}
                          className="stat-box"
                          style={{
                            padding: 14,
                            background: "var(--hover-bg)",
                            borderRadius: 6,
                            textAlign: "center",
                            cursor: "help",
                            transition: "all 0.2s",
                          }}
                          title={tooltips[regime] || regime}
                        >
                          <div
                            style={{
                              fontSize: 11,
                              fontWeight: 600,
                              marginBottom: 6,
                              color: "var(--muted)",
                              textTransform: "uppercase",
                              letterSpacing: "0.03em",
                            }}
                          >
                            {regime}
                          </div>
                          <div style={{ fontSize: 22, fontWeight: 700, color: colors[regime] || "var(--foreground)" }}>
                            {(pct as number).toFixed(1)}%
                          </div>
                        </div>
                      );
                    }
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}