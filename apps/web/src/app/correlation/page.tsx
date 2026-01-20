"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import CorrelationHeatmap from "@/components/CorrelationHeatmap";
import RollingCorrelationChart from "@/components/RollingCorrelationChart";

const PRESET_GROUPS = {
  "Norwegian Equities": ["AKER", "DNB", "EQNR", "MOWI", "OBX"],
  "Energy Giants": ["EQNR", "AKRBP", "VAR", "OBX"],
  "Seafood": ["MOWI", "SALM", "LSG", "OBX"],
  "Finance": ["DNB", "SB1NO", "MING", "STB"],
  "100B+ Club": ["DNB", "EQNR", "MOWI", "TEL", "YAR", "NHY", "AKRBP"],
};

const TIMEFRAMES = [
  { label: "6 Months", days: 180 },
  { label: "1 Year", days: 365 },
  { label: "3 Years", days: 1095 },
  { label: "5 Years", days: 1825 },
];

const ROLLING_WINDOWS = [
  { label: "20 Days (1 Month)", days: 20, desc: "Captures short-term co-movement" },
  { label: "60 Days (1 Quarter)", days: 60, desc: "Medium-term relationships" },
  { label: "120 Days (6 Months)", days: 120, desc: "Longer-term structural correlation" },
  { label: "252 Days (1 Year)", days: 252, desc: "Annual correlation cycle" },
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
  const [showTickerPanel, setShowTickerPanel] = useState(false);
  const [sortBy, setSortBy] = useState<"alpha" | "selected">("alpha");

  const [correlationData, setCorrelationData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Settings
  const [timeframe, setTimeframe] = useState(365);
  const [rollingWindow, setRollingWindow] = useState(60);
  const [dataMode, setDataMode] = useState<"price" | "total_return">("total_return");
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

  const sortedTickers = [...availableTickers].sort((a, b) => {
    if (sortBy === "selected") {
      const aSelected = selectedTickers.includes(a);
      const bSelected = selectedTickers.includes(b);
      if (aSelected && !bSelected) return -1;
      if (!aSelected && bSelected) return 1;
    }
    return a.localeCompare(b);
  });

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
      setError("Please select at least 2 tickers to compute correlations.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        tickers: selectedTickers.join(","),
        limit: timeframe.toString(),
        window: rollingWindow.toString(),
        mode: dataMode, // <--- Passing the new mode to API
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
        padding: "32px 24px",
      }}
    >
      <style dangerouslySetInnerHTML={{ __html: `
        @media (prefers-color-scheme: dark) {
          .card-enhanced {
            background: var(--card-bg);
            border: 1px solid var(--card-border);
            box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
          }
          .stat-box {
            background: rgba(255, 255, 255, 0.03) !important;
            border: 1px solid rgba(255, 255, 255, 0.08);
          }
          .stat-box:hover {
            background: rgba(255, 255, 255, 0.05) !important;
            border-color: rgba(59, 130, 246, 0.4);
          }
        }
        .toggle-btn {
          padding: 6px 12px;
          border-radius: 6px;
          border: none;
          font-size: 13px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s;
        }
        .toggle-btn.active {
          background: var(--background);
          color: var(--foreground);
          box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }
        .toggle-btn.inactive {
          background: transparent;
          color: var(--muted);
        }
        .toggle-btn.inactive:hover {
          color: var(--foreground);
        }
      `}} />
      
      <div style={{ maxWidth: 1400, margin: "0 auto" }}>
        
        {/* Header Section */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 32 }}>
          <div>
            <Link
              href="/stocks"
              style={{
                color: "var(--muted)",
                textDecoration: "none",
                fontSize: 14,
                marginBottom: 8,
                display: "inline-flex",
                alignItems: "center",
                gap: 4
              }}
            >
              ← Back to stocks
            </Link>
            <h1 style={{ fontSize: 32, fontWeight: 700, margin: 0, letterSpacing: "-0.02em" }}>
              Correlation Matrix
            </h1>
            <p style={{ color: "var(--muted)", margin: "8px 0 0 0", fontSize: 15 }}>
              Analyze how assets move in relation to each other.
            </p>
          </div>
          
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
             {/* Mode Toggle */}
             <div style={{ display: "flex", gap: 4, background: "var(--input-bg)", padding: 4, borderRadius: 8 }}>
                <button
                  onClick={() => setDataMode("price")}
                  className={`toggle-btn ${dataMode === "price" ? "active" : "inactive"}`}
                >
                  Price (Raw)
                </button>
                <button
                  onClick={() => setDataMode("total_return")}
                  className={`toggle-btn ${dataMode === "total_return" ? "active" : "inactive"}`}
                  style={{ color: dataMode === "total_return" ? "var(--accent)" : undefined }}
                >
                  Total Return
                </button>
              </div>

            {/* Info Button */}
            <button
              onClick={() => setShowInfo(!showInfo)}
              style={{
                background: "var(--card-bg)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                width: 36,
                height: 36,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                color: showInfo ? "var(--accent)" : "var(--muted)",
                transition: "all 0.2s"
              }}
              title="Show guide"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
            </button>
          </div>
        </div>

        {/* Info Panel */}
        {showInfo && (
          <div
            className="card-enhanced"
            style={{
              padding: 24,
              marginBottom: 32,
              fontSize: 13,
              lineHeight: 1.7,
              borderRadius: 8,
              animation: "fadeIn 0.2s ease-in-out"
            }}
          >
            <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12, color: "var(--foreground)" }}>
              How to Read This Analysis
            </h2>
            <p style={{ fontSize: 13, color: "var(--muted-foreground)", marginBottom: 20, lineHeight: 1.6 }}>
              Correlation measures how two stocks move together. Think of it like a dance: high correlation means they move in sync, low correlation means they dance independently.
            </p>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 24 }}>
              <div>
                <h3 style={{ fontSize: 13, fontWeight: 600, color: "var(--foreground)", marginBottom: 12, display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 16 }}>📊</span> What Are You Measuring?
                </h3>
                <div style={{ background: "rgba(59, 130, 246, 0.05)", padding: 12, borderRadius: 6, marginBottom: 10, border: "1px solid rgba(59, 130, 246, 0.2)" }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "var(--accent)", marginBottom: 4 }}>✓ Total Return (Recommended)</div>
                  <p style={{ fontSize: 11, color: "var(--muted-foreground)", margin: 0, lineHeight: 1.5 }}>
                    Includes dividends. Shows the real relationship. Example: If EQUINOR pays a big dividend, the stock price drops artificially — Total Return fixes this.
                  </p>
                </div>
                <div style={{ background: "var(--input-bg)", padding: 12, borderRadius: 6, border: "1px solid var(--border-subtle)" }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "var(--muted)", marginBottom: 4 }}>Price (Raw)</div>
                  <p style={{ fontSize: 11, color: "var(--muted-foreground)", margin: 0, lineHeight: 1.5 }}>
                    Only stock price. Can show fake breaks on dividend dates. Use for short-term or non-dividend stocks.
                  </p>
                </div>
              </div>

              <div>
                <h3 style={{ fontSize: 13, fontWeight: 600, color: "var(--foreground)", marginBottom: 12, display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 16 }}>🎯</span> Reading the Numbers
                </h3>
                <div style={{ display: "grid", gap: 8 }}>
                  <div style={{ padding: "8px 12px", background: "rgba(34, 197, 94, 0.1)", borderRadius: 4, border: "1px solid rgba(34, 197, 94, 0.3)" }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "#22c55e" }}>+0.8 to +1.0</div>
                    <div style={{ fontSize: 10, color: "var(--muted-foreground)" }}>Move together like twins. One goes up → the other goes up.</div>
                  </div>
                  <div style={{ padding: "8px 12px", background: "rgba(59, 130, 246, 0.1)", borderRadius: 4, border: "1px solid rgba(59, 130, 246, 0.3)" }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "#3b82f6" }}>+0.5 to +0.8</div>
                    <div style={{ fontSize: 10, color: "var(--muted-foreground)" }}>Often move together. Same sector stocks (e.g., all energy).</div>
                  </div>
                  <div style={{ padding: "8px 12px", background: "var(--input-bg)", borderRadius: 4, border: "1px solid var(--border-subtle)" }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)" }}>-0.2 to +0.5</div>
                    <div style={{ fontSize: 10, color: "var(--muted-foreground)" }}>No clear pattern. Independent businesses.</div>
                  </div>
                  <div style={{ padding: "8px 12px", background: "rgba(239, 68, 68, 0.1)", borderRadius: 4, border: "1px solid rgba(239, 68, 68, 0.3)" }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "#ef4444" }}>-1.0 to -0.5</div>
                    <div style={{ fontSize: 10, color: "var(--muted-foreground)" }}>Move opposite. Great for hedging (when one falls, other rises).</div>
                  </div>
                </div>
              </div>

              <div>
                <h3 style={{ fontSize: 13, fontWeight: 600, color: "var(--foreground)", marginBottom: 12, display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 16 }}>⏱️</span> Time Windows
                </h3>
                <p style={{ fontSize: 11, color: "var(--muted-foreground)", marginBottom: 12 }}>
                  Correlations change over time. The rolling window shows how stable the relationship is.
                </p>
                <div style={{ display: "grid", gap: 10 }}>
                  <div style={{ borderLeft: "3px solid #f59e0b", paddingLeft: 10 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: "var(--foreground)" }}>20 Days</div>
                    <div style={{ fontSize: 10, color: "var(--muted-foreground)", lineHeight: 1.4 }}>
                      Catches recent changes fast. Jumpy. Good for short-term traders.
                    </div>
                  </div>
                  <div style={{ borderLeft: "3px solid #3b82f6", paddingLeft: 10 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: "var(--foreground)" }}>60 Days</div>
                    <div style={{ fontSize: 10, color: "var(--muted-foreground)", lineHeight: 1.4 }}>
                      Balanced. Not too noisy. Best for most analyses.
                    </div>
                  </div>
                  <div style={{ borderLeft: "3px solid #8b5cf6", paddingLeft: 10 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: "var(--foreground)" }}>120-252 Days</div>
                    <div style={{ fontSize: 10, color: "var(--muted-foreground)", lineHeight: 1.4 }}>
                      Smooth, long-term trend. Ignores short blips.
                    </div>
                  </div>
                </div>
              </div>

              <div>
                <h3 style={{ fontSize: 13, fontWeight: 600, color: "var(--foreground)", marginBottom: 12, display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 16 }}>💡</span> Why This Matters
                </h3>
                <div style={{ display: "grid", gap: 10 }}>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: "var(--foreground)", marginBottom: 4 }}>Build a Better Portfolio</div>
                    <p style={{ fontSize: 10, color: "var(--muted-foreground)", margin: 0, lineHeight: 1.4 }}>
                      Want low risk? Pick stocks with low correlation. If one drops, the others won't necessarily follow.
                    </p>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: "var(--foreground)", marginBottom: 4 }}>Spot Market Crashes</div>
                    <p style={{ fontSize: 10, color: "var(--muted-foreground)", margin: 0, lineHeight: 1.4 }}>
                      During crises, correlations spike to +1. Everything falls together. The rolling chart shows this.
                    </p>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: "var(--foreground)", marginBottom: 4 }}>Find Trading Pairs</div>
                    <p style={{ fontSize: 10, color: "var(--muted-foreground)", margin: 0, lineHeight: 1.4 }}>
                      Two stocks with 0.8+ correlation usually move together. If they diverge, one might be mispriced.
                    </p>
                  </div>
                </div>
              </div>

              <div>
                <h3 style={{ fontSize: 13, fontWeight: 600, color: "var(--foreground)", marginBottom: 12, display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 16 }}>🔥</span> Market Stress Levels
                </h3>
                <p style={{ fontSize: 11, color: "var(--muted-foreground)", marginBottom: 12 }}>
                  The background color on the rolling chart shows market stress (similar to VIX).
                </p>
                <div style={{ display: "grid", gap: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ width: 12, height: 12, background: "#22c55e", borderRadius: 2 }}></div>
                    <div>
                      <div style={{ fontSize: 10, fontWeight: 600, color: "#22c55e" }}>Low Volatility</div>
                      <div style={{ fontSize: 9, color: "var(--muted-foreground)" }}>Calm market, stocks move independently</div>
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ width: 12, height: 12, background: "#3b82f6", borderRadius: 2 }}></div>
                    <div>
                      <div style={{ fontSize: 10, fontWeight: 600, color: "#3b82f6" }}>Normal</div>
                      <div style={{ fontSize: 9, color: "var(--muted-foreground)" }}>Business as usual</div>
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ width: 12, height: 12, background: "#fb923c", borderRadius: 2 }}></div>
                    <div>
                      <div style={{ fontSize: 10, fontWeight: 600, color: "#fb923c" }}>Elevated Risk</div>
                      <div style={{ fontSize: 9, color: "var(--muted-foreground)" }}>Market getting nervous</div>
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ width: 12, height: 12, background: "#ef4444", borderRadius: 2 }}></div>
                    <div>
                      <div style={{ fontSize: 10, fontWeight: 600, color: "#ef4444" }}>High Stress</div>
                      <div style={{ fontSize: 9, color: "var(--muted-foreground)" }}>Panic mode, everything moves together</div>
                    </div>
                  </div>
                </div>
              </div>

              <div>
                <h3 style={{ fontSize: 13, fontWeight: 600, color: "var(--foreground)", marginBottom: 12, display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 16 }}>⚠️</span> Things to Watch
                </h3>
                <div style={{ display: "grid", gap: 10 }}>
                  <div style={{ background: "rgba(251, 146, 60, 0.1)", padding: 10, borderRadius: 6, border: "1px solid rgba(251, 146, 60, 0.3)" }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: "#fb923c", marginBottom: 4 }}>Need Enough Data</div>
                    <p style={{ fontSize: 10, color: "var(--muted-foreground)", margin: 0 }}>
                      At least 60 trading days. Otherwise the numbers aren't trustworthy.
                    </p>
                  </div>
                  <div style={{ background: "rgba(251, 146, 60, 0.1)", padding: 10, borderRadius: 6, border: "1px solid rgba(251, 146, 60, 0.3)" }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: "#fb923c", marginBottom: 4 }}>Correlations Change</div>
                    <p style={{ fontSize: 10, color: "var(--muted-foreground)", margin: 0 }}>
                      What's true today might not be true next year. Check regularly.
                    </p>
                  </div>
                  <div style={{ background: "rgba(251, 146, 60, 0.1)", padding: 10, borderRadius: 6, border: "1px solid rgba(251, 146, 60, 0.3)" }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: "#fb923c", marginBottom: 4 }}>Crisis = Everything Correlates</div>
                    <p style={{ fontSize: 10, color: "var(--muted-foreground)", margin: 0 }}>
                      During market crashes, diversification often fails. Everything drops together.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Controls Grid */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
            gap: 20,
            marginBottom: 32,
          }}
        >
          {/* Preset Groups */}
          <div className="card-enhanced" style={{ padding: 20, borderRadius: 8 }}>
            <h3 style={{ fontSize: 12, fontWeight: 600, marginBottom: 16, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--muted)" }}>
              Quick Presets
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
                    borderRadius: 6,
                    cursor: "pointer",
                    fontSize: 12,
                    fontWeight: 500,
                    transition: "all 0.15s",
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.borderColor = "var(--accent)"}
                  onMouseLeave={(e) => e.currentTarget.style.borderColor = "var(--border)"}
                >
                  {group}
                </button>
              ))}
            </div>
          </div>

          {/* Add Ticker */}
          <div className="card-enhanced" style={{ padding: 20, borderRadius: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
               <h3 style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--muted)", margin: 0 }}>
                Selection ({selectedTickers.length})
              </h3>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={() => setShowTickerPanel(!showTickerPanel)}
                  style={{
                    background: "none",
                    border: "1px solid var(--border)",
                    fontSize: 11,
                    color: "var(--accent)",
                    cursor: "pointer",
                    padding: "4px 8px",
                    borderRadius: 4,
                    fontWeight: 500
                  }}
                >
                  {showTickerPanel ? "Hide" : "Show"} All Tickers
                </button>
                {selectedTickers.length > 0 && (
                  <button
                    onClick={() => setSelectedTickers([])}
                    style={{ background: "none", border: "none", fontSize: 11, color: "var(--danger)", cursor: "pointer", padding: 0 }}
                  >
                    Clear All
                  </button>
                )}
              </div>
            </div>

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
                placeholder="Type to search (e.g. TEL)..."
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  background: "var(--input-bg)",
                  color: "var(--foreground)",
                  border: "1px solid var(--input-border)",
                  borderRadius: 6,
                  fontSize: 13,
                  outline: "none",
                }}
              />

              {showDropdown && tickerInput && filteredTickers.length > 0 && (
                <div
                  style={{
                    position: "absolute",
                    top: "calc(100% + 4px)",
                    left: 0,
                    right: 0,
                    background: "var(--card-bg)",
                    border: "1px solid var(--border)",
                    borderRadius: 6,
                    maxHeight: 240,
                    overflowY: "auto",
                    zIndex: 20,
                    boxShadow: "0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)",
                  }}
                >
                  {filteredTickers.slice(0, 50).map((ticker) => (
                    <div
                      key={ticker}
                      onClick={() => addTicker(ticker)}
                      style={{
                        padding: "10px 12px",
                        cursor: "pointer",
                        fontSize: 13,
                        borderBottom: "1px solid var(--border-subtle)",
                        transition: "background 0.1s"
                      }}
                      className="hover:bg-accent/10"
                      onMouseEnter={(e) => e.currentTarget.style.background = "var(--hover-bg)"}
                      onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                    >
                      {ticker}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Configuration */}
          <div className="card-enhanced" style={{ padding: 20, borderRadius: 8 }}>
            <h3 style={{ fontSize: 12, fontWeight: 600, marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--muted)" }}>
              Settings
            </h3>
            <p style={{ fontSize: 11, color: "var(--muted-foreground)", marginBottom: 16 }}>
              Configure analysis parameters
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 16 }}>
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <label style={{ fontSize: 11, fontWeight: 600, color: "var(--muted)" }}>Lookback Period</label>
                  <span style={{ fontSize: 10, color: "var(--muted-foreground)" }}>Historical data range</span>
                </div>
                <select
                  value={timeframe}
                  onChange={(e) => setTimeframe(Number(e.target.value))}
                  style={{
                    width: "100%",
                    padding: "8px 10px",
                    background: "var(--input-bg)",
                    color: "var(--foreground)",
                    border: "1px solid var(--input-border)",
                    borderRadius: 6,
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
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <label style={{ fontSize: 11, fontWeight: 600, color: "var(--muted)" }}>Rolling Window</label>
                  <span style={{ fontSize: 10, color: "var(--muted-foreground)" }}>Correlation smoothing</span>
                </div>
                <select
                  value={rollingWindow}
                  onChange={(e) => setRollingWindow(Number(e.target.value))}
                  style={{
                    width: "100%",
                    padding: "8px 10px",
                    background: "var(--input-bg)",
                    color: "var(--foreground)",
                    border: "1px solid var(--input-border)",
                    borderRadius: 6,
                    fontSize: 13,
                  }}
                >
                  {ROLLING_WINDOWS.map((rw) => (
                    <option key={rw.days} value={rw.days}>
                      {rw.label}
                    </option>
                  ))}
                </select>
                <p style={{ fontSize: 10, color: "var(--muted-foreground)", marginTop: 4, fontStyle: "italic" }}>
                  {ROLLING_WINDOWS.find(w => w.days === rollingWindow)?.desc}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* All Tickers Panel - Sortable Checklist */}
        {showTickerPanel && (
          <div
            className="card-enhanced"
            style={{
              padding: 24,
              marginBottom: 24,
              borderRadius: 8,
              maxHeight: 500,
              overflowY: "auto"
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>
                All Available Tickers ({availableTickers.length})
              </h3>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ fontSize: 11, color: "var(--muted)" }}>Sort by:</span>
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as "alpha" | "selected")}
                  style={{
                    padding: "4px 8px",
                    background: "var(--input-bg)",
                    color: "var(--foreground)",
                    border: "1px solid var(--input-border)",
                    borderRadius: 4,
                    fontSize: 11,
                  }}
                >
                  <option value="alpha">Alphabetical</option>
                  <option value="selected">Selected First</option>
                </select>
              </div>
            </div>

            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))",
              gap: 8
            }}>
              {sortedTickers.map((ticker) => {
                const isSelected = selectedTickers.includes(ticker);
                return (
                  <label
                    key={ticker}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "8px 10px",
                      background: isSelected ? "rgba(59, 130, 246, 0.1)" : "var(--input-bg)",
                      border: `1px solid ${isSelected ? "var(--accent)" : "var(--border-subtle)"}`,
                      borderRadius: 6,
                      cursor: "pointer",
                      fontSize: 12,
                      fontWeight: isSelected ? 600 : 400,
                      color: isSelected ? "var(--accent)" : "var(--foreground)",
                      transition: "all 0.15s"
                    }}
                    onMouseEnter={(e) => {
                      if (!isSelected) {
                        e.currentTarget.style.borderColor = "var(--accent)";
                        e.currentTarget.style.background = "rgba(59, 130, 246, 0.05)";
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!isSelected) {
                        e.currentTarget.style.borderColor = "var(--border-subtle)";
                        e.currentTarget.style.background = "var(--input-bg)";
                      }
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={(e) => {
                        if (e.target.checked) {
                          addTicker(ticker);
                        } else {
                          removeTicker(ticker);
                        }
                      }}
                      style={{
                        width: 14,
                        height: 14,
                        cursor: "pointer",
                        accentColor: "var(--accent)"
                      }}
                    />
                    <span>{ticker}</span>
                  </label>
                );
              })}
            </div>
          </div>
        )}

        {/* Selected Tickers List */}
        <div
          className="card-enhanced"
          style={{
            padding: 16,
            marginBottom: 24,
            borderRadius: 8,
            minHeight: 60,
            display: "flex",
            alignItems: "center"
          }}
        >
          {selectedTickers.length === 0 ? (
            <span style={{ fontSize: 13, color: "var(--muted)", width: "100%", textAlign: "center" }}>
              No tickers selected. Choose a preset or search above.
            </span>
          ) : (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", width: "100%" }}>
              {selectedTickers.map((ticker) => (
                <div
                  key={ticker}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "6px 12px",
                    background: "var(--accent-bg, rgba(59, 130, 246, 0.15))",
                    color: "var(--accent, rgb(59, 130, 246))",
                    border: "1px solid var(--accent-border, rgba(59, 130, 246, 0.3))",
                    borderRadius: 20,
                    fontSize: 13,
                    fontWeight: 600,
                  }}
                >
                  {ticker}
                  <button
                    onClick={() => removeTicker(ticker)}
                    style={{
                      background: "transparent",
                      border: "none",
                      color: "currentColor",
                      cursor: "pointer",
                      fontSize: 16,
                      lineHeight: 0.5,
                      padding: "0 2px",
                      opacity: 0.7
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.opacity = "1"}
                    onMouseLeave={(e) => e.currentTarget.style.opacity = "0.7"}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Compute Button */}
        <button
          onClick={computeCorrelations}
          disabled={loading || selectedTickers.length < 2}
          style={{
            width: "100%",
            padding: "16px",
            background: loading || selectedTickers.length < 2 ? "var(--muted)" : "var(--accent)",
            color: "white",
            border: "none",
            borderRadius: 8,
            fontSize: 15,
            fontWeight: 600,
            cursor: loading || selectedTickers.length < 2 ? "not-allowed" : "pointer",
            marginBottom: 40,
            boxShadow: loading || selectedTickers.length < 2 ? "none" : "0 4px 12px rgba(59, 130, 246, 0.3)",
            transition: "all 0.2s",
            opacity: loading ? 0.8 : 1
          }}
        >
          {loading ? "Crunching Numbers..." : `Compute ${dataMode === 'total_return' ? 'Total Return' : 'Price'} Correlations`}
        </button>

        {/* Error */}
        {error && (
          <div
            style={{
              background: "rgba(239, 68, 68, 0.1)",
              border: "1px solid rgb(239, 68, 68)",
              color: "rgb(239, 68, 68)",
              padding: 16,
              borderRadius: 8,
              marginBottom: 32,
              fontSize: 14,
              display: "flex",
              alignItems: "center",
              gap: 12
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            {error}
          </div>
        )}

        {/* Results */}
        {correlationData && (
          <div style={{ animation: "slideUp 0.3s ease-out" }}>
            
            <div style={{ 
              display: "flex", 
              justifyContent: "center", 
              marginBottom: 24,
              fontSize: 13, 
              color: "var(--muted)", 
              gap: 24 
            }}>
              <span><strong>Period:</strong> {correlationData.startDate} — {correlationData.endDate}</span>
              <span><strong>Data Points:</strong> {correlationData.observations}</span>
              <span><strong>Mode:</strong> {dataMode === 'total_return' ? 'Adjusted' : 'Raw Price'}</span>
            </div>

            {/* Matrix & Stats Grid */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(500px, 1fr))", gap: 24, marginBottom: 24 }}>

              {/* Correlation Matrix */}
              {correlationData.matrix && (
                <div className="card-enhanced" style={{ padding: 24, borderRadius: 8 }}>
                  <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>
                    Correlation Matrix
                  </h2>
                  <p style={{ fontSize: 12, color: "var(--muted-foreground)", marginBottom: 16, lineHeight: 1.5 }}>
                    <strong>How to read:</strong> Each cell shows how two stocks move together. Darker blue = stronger correlation.
                    Look for light colors (low correlation) to find good diversification pairs.
                  </p>
                  <CorrelationHeatmap data={correlationData.matrix} />
                </div>
              )}

              {/* Average Correlations */}
              {correlationData.averageCorrelations && (
                <div className="card-enhanced" style={{ padding: 24, borderRadius: 8 }}>
                  <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>
                    Average Correlations
                  </h2>
                  <p style={{ fontSize: 12, color: "var(--muted-foreground)", marginBottom: 16, lineHeight: 1.5 }}>
                    <strong>What this shows:</strong> How strongly each stock correlates with all the others combined.
                    High number = moves with the group. Low number = independent stock.
                  </p>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12 }}>
                    {correlationData.averageCorrelations.map(
                      (item: { ticker: string; avgCorrelation: number }) => (
                        <div
                          key={item.ticker}
                          className="stat-box"
                          style={{
                            padding: 16,
                            borderRadius: 6,
                            textAlign: "center",
                            cursor: "help",
                          }}
                          title={`Average correlation of ${item.ticker}`}
                        >
                          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4, color: "var(--muted)" }}>
                            {item.ticker}
                          </div>
                          <div style={{ 
                            fontSize: 20, 
                            fontWeight: 700, 
                            color: item.avgCorrelation > 0.7 ? "var(--accent)" : 
                                   item.avgCorrelation < 0.3 ? "var(--muted)" : "var(--foreground)" 
                          }}>
                            {item.avgCorrelation.toFixed(2)}
                          </div>
                        </div>
                      )
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Rolling Correlation Chart */}
            {correlationData.rollingCorrelations && correlationData.rollingCorrelations.length > 0 && (
              <div className="card-enhanced" style={{ padding: 24, borderRadius: 8, marginBottom: 24 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <h2 style={{ fontSize: 18, fontWeight: 600 }}>
                    Rolling Correlation Over Time
                  </h2>
                  <span style={{ fontSize: 13, padding: "4px 8px", background: "var(--input-bg)", borderRadius: 4, fontWeight: 600 }}>
                    {selectedTickers[0]} vs {selectedTickers[1]}
                  </span>
                </div>
                <p style={{ fontSize: 12, color: "var(--muted-foreground)", marginBottom: 16, lineHeight: 1.5 }}>
                  <strong>What this shows:</strong> How the correlation changes day by day.
                  The <strong style={{ color: "#3b82f6" }}>blue line</strong> is correlation (left axis).
                  The <strong style={{ color: "var(--muted)" }}>background shading</strong> shows market stress levels (right axis).
                </p>
                <div style={{ background: "rgba(59, 130, 246, 0.05)", padding: 12, borderRadius: 6, marginBottom: 20, border: "1px solid rgba(59, 130, 246, 0.2)" }}>
                  <p style={{ fontSize: 11, color: "var(--muted-foreground)", margin: 0, lineHeight: 1.5 }}>
                    💡 <strong>Look for:</strong> Sudden spikes to +1 during red/orange periods = crisis mode (everything falls together).
                    Stable line in blue/green areas = normal market where stocks can move independently.
                  </p>
                </div>
                <div style={{ height: 400 }}>
                  <RollingCorrelationChart data={correlationData.rollingCorrelations} />
                </div>
              </div>
            )}

            {/* Market Regime Distribution */}
            {correlationData.regimeDistribution && (
              <div className="card-enhanced" style={{ padding: 24, borderRadius: 8 }}>
                <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>
                  Market Regime Distribution
                </h2>
                <p style={{ fontSize: 12, color: "var(--muted-foreground)", marginBottom: 20, lineHeight: 1.5 }}>
                  <strong>What this shows:</strong> What percentage of time the market was in each stress level during your selected period.
                  High stress = correlations spike, diversification fails.
                </p>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 16 }}>
                  {Object.entries(correlationData.regimeDistribution).map(
                    ([regime, pct]) => {
                      const colors: Record<string, string> = {
                        "High Stress": "rgb(239, 68, 68)",
                        "Elevated Risk": "rgb(251, 146, 60)",
                        "Normal": "rgb(59, 130, 246)",
                        "Low Volatility": "rgb(34, 197, 94)",
                      };
                      return (
                        <div key={regime} className="stat-box" style={{ padding: 16, borderRadius: 6, textAlign: "center" }}>
                          <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 8, color: "var(--muted)", textTransform: "uppercase" }}>
                            {regime}
                          </div>
                          <div style={{ fontSize: 24, fontWeight: 700, color: colors[regime] }}>
                            {(pct as number).toFixed(1)}%
                          </div>
                        </div>
                      );
                    }
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}