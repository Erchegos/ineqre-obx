"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  BarChart,
  Bar,
  Cell,
} from "recharts";

interface Trade {
  ticker: string;
  entryDate: string;
  exitDate: string;
  signal: "LONG" | "SHORT";
  entryPrice: number;
  exitPrice: number;
  returnPct: number;
  holdingDays: number;
  exitReason: string;
  sigmaAtEntry: number;
  r2: number;
  slope: number;
  eventScore?: number;
}

interface EventFilter {
  name: string;
  score: number;
  reason: string;
}

interface CurrentSignal {
  ticker: string;
  signal: "LONG" | "SHORT";
  sigmaDistance: number;
  r2: number;
  slope: number;
  ep: number | null;
  bm: number | null;
  mom6m: number | null;
  eventScore?: number;
  eventRecommendation?: string;
  eventFilters?: EventFilter[];
}

interface BacktestSummary {
  totalTrades: number;
  winRate: number;
  avgReturn: number;
  totalReturn: number;
  maxDrawdown: number;
  worstTradeLoss?: number;  // Single worst trade loss (more realistic)
  sharpeRatio: number;
  profitFactor: number;
  avgHoldingDays: number;
  exitBreakdown: {
    target: number;
    time: number;
    stop: number;
  };
}

interface StrategyParams {
  entryThresholdSigma: number;
  stopSigma: number;
  maxHoldingDays: number;
  minR2: number;
  minSlope: number;
  minBM: number;
  minEP: number;
  windowSize: number;
}

interface StrategyData {
  success: boolean;
  params: StrategyParams;
  summary: BacktestSummary;
  currentSignals: CurrentSignal[];
  recentTrades: Trade[];
  stats: {
    tickersAnalyzed: number;
    tickersWithSignals: number;
    avgR2: number;
  };
  filterStats?: {
    avgScore: number;
    candidatesFiltered: number;
    totalCandidates: number;
    filterRate: string;
  };
}

interface OptimizationResult {
  params: {
    entrySigma: number;
    stopSigma: number;
    maxDays: number;
    minR2: number;
    windowSize: number;
  };
  totalTrades: number;
  winRate: number;
  totalReturn: number;
  sharpe: number;
  profitFactor: number;
  maxDrawdown: number;
  score: number;
}

// Shared styles
const cardStyle: React.CSSProperties = {
  background: "var(--card-bg)",
  border: "1px solid var(--card-border)",
  borderRadius: 6,
  padding: 16,
};

const sectionTitle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: "var(--muted)",
  letterSpacing: "0.05em",
  textTransform: "uppercase",
  marginBottom: 12,
};

const tooltipStyle: React.CSSProperties = {
  backgroundColor: "#18181b",
  border: "1px solid #3f3f46",
  borderRadius: 6,
  padding: "10px 14px",
  fontSize: 12,
  boxShadow: "0 8px 24px rgba(0,0,0,0.6)",
};

const inputStyle: React.CSSProperties = {
  background: "var(--input-bg)",
  border: "1px solid var(--input-border)",
  borderRadius: 4,
  padding: "6px 10px",
  fontSize: 13,
  color: "var(--foreground)",
  width: "100%",
  fontFamily: "monospace",
};

const labelStyle: React.CSSProperties = {
  fontSize: 10,
  color: "var(--muted)",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  marginBottom: 4,
  display: "block",
};

const buttonStyle: React.CSSProperties = {
  background: "var(--accent)",
  color: "#fff",
  border: "none",
  borderRadius: 4,
  padding: "8px 16px",
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
};

export default function STDChannelStrategyPage() {
  const [data, setData] = useState<StrategyData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [initialLoad, setInitialLoad] = useState(true);

  // Editable parameters - OPTIMIZED DEFAULTS (333% return, 12% max DD over 5yr)
  // Best return/risk from optimization: 2.41 Sharpe, 3.11 Profit Factor
  const [entrySigma, setEntrySigma] = useState(3.0);   // Entry at 3σ deviation
  const [stopSigma, setStopSigma] = useState(4.75);    // Optimized stop level
  const [maxDays, setMaxDays] = useState(21);          // Full month to revert
  const [minR2, setMinR2] = useState(0.5);             // Good channel quality
  const [minSlope, setMinSlope] = useState(0.0001);
  const [minBM, setMinBM] = useState(0.3);             // Value stocks
  const [minEP, setMinEP] = useState(0);               // Positive earnings
  const [windowSize, setWindowSize] = useState(189);   // 9-month lookback
  const [maxPositions, setMaxPositions] = useState(3); // Concentrated for higher returns
  const [maxDD, setMaxDD] = useState(12); // 12% circuit breaker (optimized)

  // Event filter settings
  const [useEventFilters, setUseEventFilters] = useState(true);
  const [minEventScoreStr, setMinEventScoreStr] = useState("0.5"); // String for editable input
  const minEventScore = parseFloat(minEventScoreStr) || 0;
  const [expandedSignal, setExpandedSignal] = useState<string | null>(null);

  // Optimizer state
  const [optimizing, setOptimizing] = useState(false);
  const [runBacktestTrigger, setRunBacktestTrigger] = useState(0); // Trigger to auto-run backtest
  const [optimResults, setOptimResults] = useState<OptimizationResult[] | null>(null);
  const [showOptimizer, setShowOptimizer] = useState(false);

  // Loading progress animation
  const [loadingProgress, setLoadingProgress] = useState(0);

  useEffect(() => {
    if (loading && initialLoad) {
      setLoadingProgress(10);
      const interval = setInterval(() => {
        setLoadingProgress(prev => {
          // Very fast progress - reaches ~90% in ~5 seconds
          if (prev < 60) return prev + 8;      // 0-60% in ~1 second
          if (prev < 80) return prev + 4;      // 60-80% in ~0.6 seconds
          if (prev < 92) return prev + 2;      // 80-92% in ~0.7 seconds
          if (prev < 97) return prev + 0.5;    // 92-97% slow crawl
          return Math.min(prev + 0.1, 99);     // never quite hit 100 until done
        });
      }, 100); // Very fast interval
      return () => clearInterval(interval);
    } else if (!loading && !initialLoad) {
      // Jump to 100% when loading completes
      setLoadingProgress(100);
    }
  }, [loading, initialLoad]);

  const fetchData = async () => {
    setLoading(true);
    setError(null);

    const params = new URLSearchParams({
      entrySigma: String(entrySigma),
      stopSigma: String(stopSigma),
      maxDays: String(maxDays),
      minR2: String(minR2),
      minSlope: String(minSlope),
      minBM: String(minBM),
      minEP: String(minEP),
      window: String(windowSize),
      maxPos: String(maxPositions),
      maxDD: String(maxDD / 100), // Convert percentage (15) to decimal (0.15) for API
      useFilters: String(useEventFilters),
      minEventScore: String(minEventScore),
    });

    try {
      const res = await fetch(`/api/std-channel-strategy?${params}`);
      const d = await res.json();
      if (d.success) {
        setData(d);
      } else {
        setError(d.error || "Failed to load strategy data");
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unknown error");
    }
    setLoading(false);
    setInitialLoad(false);
  };

  const runOptimizer = async () => {
    setOptimizing(true);
    setShowOptimizer(true);
    try {
      const res = await fetch("/api/std-channel-optimize");
      const d = await res.json();
      if (d.success) {
        setOptimResults(d.results);
      }
    } catch {
      // Ignore errors
    }
    setOptimizing(false);
  };

  const applyOptimalParams = (result: OptimizationResult) => {
    // Apply all params from optimization result
    setEntrySigma(result.params.entrySigma);
    setStopSigma(result.params.stopSigma);
    setMaxDays(result.params.maxDays);
    setMinR2(result.params.minR2);
    setWindowSize(result.params.windowSize);
    // Position controls
    setMaxPositions(5);
    // Set max DD to worst trade + 1% buffer (so the worst trade is included)
    // maxDrawdown is negative (e.g., -0.17 = -17%), convert to positive percentage
    const worstTradePct = Math.ceil(Math.abs(result.maxDrawdown) * 100) + 1;
    setMaxDD(worstTradePct); // Worst trade + 1% buffer
    setMinBM(0.3);
    setMinEP(0);
    setShowOptimizer(false);
    // Trigger backtest run via useEffect (ensures state is updated first)
    setRunBacktestTrigger(prev => prev + 1);
  };

  // Initial load
  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-run backtest when triggered (after applying optimal params)
  useEffect(() => {
    if (runBacktestTrigger > 0) {
      fetchData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runBacktestTrigger]);

  // Show configuration screen when no data loaded yet, or loading screen when backtest is running
  if (!data && !error) {
    return (
      <div style={{ minHeight: "100vh", background: "var(--background)", color: "var(--foreground)" }}>
        {/* Header */}
        <header style={{ borderBottom: "1px solid var(--border)", padding: "16px 24px" }}>
          <div style={{ maxWidth: 1400, margin: "0 auto" }}>
            <Link href="/stocks" style={{ color: "var(--muted)", fontSize: 12, textDecoration: "none" }}>← Back to Stocks</Link>
            <h1 style={{ fontSize: 20, fontWeight: 600, marginTop: 4 }}>STD Channel Mean Reversion</h1>
            <p style={{ color: "var(--muted)", fontSize: 12, marginTop: 2 }}>
              Slope-aligned mean reversion with fundamental quality filter
            </p>
          </div>
        </header>

        <main style={{ maxWidth: 1400, margin: "0 auto", padding: 24 }}>
          {/* Status card - changes based on loading state */}
          {loading ? (
            <div style={{
              ...cardStyle,
              marginBottom: 24,
              display: "flex",
              alignItems: "center",
              gap: 16,
              background: "linear-gradient(135deg, var(--card-bg) 0%, #1a1a2e 100%)",
              borderColor: "var(--accent)",
            }}>
              <div style={{
                width: 48,
                height: 48,
                borderRadius: "50%",
                background: "linear-gradient(135deg, var(--accent) 0%, #60a5fa 100%)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}>
                <div style={{
                  width: 20,
                  height: 20,
                  borderRadius: "50%",
                  border: "2px solid rgba(255,255,255,0.3)",
                  borderTopColor: "#fff",
                }} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>
                  Running Full Backtest
                </div>
                <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>
                  Analyzing {windowSize}-day channels across all OBX tickers with fundamental filters...
                </div>
                <div style={{
                  height: 4,
                  background: "var(--border)",
                  borderRadius: 2,
                  overflow: "hidden",
                }}>
                  <div style={{
                    height: "100%",
                    width: `${loadingProgress}%`,
                    background: "linear-gradient(90deg, var(--accent) 0%, #60a5fa 100%)",
                    borderRadius: 2,
                    transition: "width 0.5s ease-out",
                  }} />
                </div>
                <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 4, fontFamily: "monospace" }}>
                  {loadingProgress.toFixed(0)}% complete
                </div>
              </div>
            </div>
          ) : (
            <div style={{
              ...cardStyle,
              marginBottom: 24,
              display: "flex",
              alignItems: "center",
              gap: 16,
              background: "linear-gradient(135deg, var(--card-bg) 0%, #1a2a1a 100%)",
              borderColor: "#10b981",
            }}>
              <div style={{
                width: 48,
                height: 48,
                borderRadius: "50%",
                background: "linear-gradient(135deg, #10b981 0%, #059669 100%)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                fontSize: 20,
              }}>
                ▶
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>
                  Ready to Run Backtest
                </div>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>
                  Configure parameters below and click &quot;Run Backtest&quot; to analyze {windowSize}-day channels across all OBX tickers
                </div>
              </div>
            </div>
          )}

          {/* Editable Parameters */}
          <section style={{ ...cardStyle, marginBottom: 24, background: "var(--hover-bg)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div style={sectionTitle}>Strategy Parameters</div>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={runOptimizer}
                  disabled={optimizing || loading}
                  style={{
                    ...buttonStyle,
                    background: optimizing || loading ? "var(--muted)" : "#f59e0b",
                    opacity: optimizing || loading ? 0.6 : 1,
                    cursor: optimizing || loading ? "not-allowed" : "pointer",
                  }}
                >
                  {optimizing ? "Optimizing..." : "Find Optimal"}
                </button>
                <button
                  onClick={fetchData}
                  disabled={loading}
                  style={{
                    ...buttonStyle,
                    background: loading ? "var(--muted)" : "var(--accent)",
                    opacity: loading ? 0.6 : 1,
                    cursor: loading ? "not-allowed" : "pointer",
                  }}
                >
                  {loading ? "Running..." : "Run Backtest"}
                </button>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12 }}>
              <div>
                <label style={labelStyle}>Entry Sigma (σ)</label>
                <input
                  type="number"
                  step="0.25"
                  value={entrySigma}
                  onChange={(e) => setEntrySigma(parseFloat(e.target.value) || 2.0)}
                  style={inputStyle}
                  disabled={loading}
                />
              </div>
              <div>
                <label style={labelStyle}>Stop Sigma (σ)</label>
                <input
                  type="number"
                  step="0.25"
                  value={stopSigma}
                  onChange={(e) => setStopSigma(parseFloat(e.target.value) || 2.5)}
                  style={inputStyle}
                  disabled={loading}
                />
              </div>
              <div>
                <label style={labelStyle}>Max Holding Days</label>
                <input
                  type="number"
                  step="1"
                  value={maxDays}
                  onChange={(e) => setMaxDays(parseInt(e.target.value) || 14)}
                  style={inputStyle}
                  disabled={loading}
                />
              </div>
              <div>
                <label style={labelStyle}>Max Positions</label>
                <input
                  type="number"
                  step="1"
                  min="1"
                  max="20"
                  value={maxPositions}
                  onChange={(e) => setMaxPositions(parseInt(e.target.value) || 5)}
                  style={inputStyle}
                  disabled={loading}
                />
              </div>
              <div>
                <label style={labelStyle}>Max Drawdown %</label>
                <input
                  type="number"
                  step="1"
                  min="5"
                  max="50"
                  value={maxDD}
                  onChange={(e) => setMaxDD(parseFloat(e.target.value) || 15)}
                  style={inputStyle}
                  disabled={loading}
                />
              </div>
              <div>
                <label style={labelStyle}>Min R²</label>
                <input
                  type="number"
                  step="0.05"
                  value={minR2}
                  onChange={(e) => setMinR2(parseFloat(e.target.value) || 0.5)}
                  style={inputStyle}
                  disabled={loading}
                />
              </div>
              <div>
                <label style={labelStyle}>Min Book/Market</label>
                <input
                  type="number"
                  step="0.1"
                  value={minBM}
                  onChange={(e) => setMinBM(parseFloat(e.target.value))}
                  style={inputStyle}
                  disabled={loading}
                />
              </div>
              <div>
                <label style={labelStyle}>Min E/P (Earnings)</label>
                <input
                  type="number"
                  step="0.01"
                  value={minEP}
                  onChange={(e) => setMinEP(parseFloat(e.target.value))}
                  style={inputStyle}
                  disabled={loading}
                />
              </div>
              <div>
                <label style={labelStyle}>Window Size</label>
                <input
                  type="number"
                  step="10"
                  value={windowSize}
                  onChange={(e) => setWindowSize(parseInt(e.target.value) || 252)}
                  style={inputStyle}
                  disabled={loading}
                />
              </div>
              <div>
                <label style={labelStyle}>Min Slope</label>
                <input
                  type="number"
                  step="0.0001"
                  value={minSlope}
                  onChange={(e) => setMinSlope(parseFloat(e.target.value) || 0.0001)}
                  style={inputStyle}
                  disabled={loading}
                />
              </div>
            </div>

            {/* Event Filter Section */}
            <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 12 }}>
                <div style={{ ...sectionTitle, margin: 0 }}>Event-Driven Filters</div>
                <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: loading ? "not-allowed" : "pointer" }}>
                  <input
                    type="checkbox"
                    checked={useEventFilters}
                    onChange={(e) => setUseEventFilters(e.target.checked)}
                    style={{ width: 16, height: 16 }}
                    disabled={loading}
                  />
                  <span style={{ fontSize: 12, color: useEventFilters ? "var(--foreground)" : "var(--muted)" }}>
                    {useEventFilters ? "Enabled" : "Disabled"}
                  </span>
                </label>
              </div>
              {useEventFilters && (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
                  <div>
                    <label style={labelStyle}>Min Event Score</label>
                    <input
                      type="text"
                      value={minEventScoreStr}
                      onChange={(e) => setMinEventScoreStr(e.target.value)}
                      style={inputStyle}
                      disabled={loading}
                      placeholder="0.5"
                    />
                  </div>
                  <div style={{ gridColumn: "span 3", display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: "var(--muted)" }}>
                    <span style={{ padding: "2px 6px", background: "rgba(16, 185, 129, 0.15)", color: "#10b981", borderRadius: 3 }}>Volume</span>
                    <span style={{ padding: "2px 6px", background: "rgba(59, 130, 246, 0.15)", color: "#3b82f6", borderRadius: 3 }}>Gap</span>
                    <span style={{ padding: "2px 6px", background: "rgba(168, 85, 247, 0.15)", color: "#a855f7", borderRadius: 3 }}>Market</span>
                    <span style={{ padding: "2px 6px", background: "rgba(249, 115, 22, 0.15)", color: "#f97316", borderRadius: 3 }}>Volatility</span>
                    <span style={{ padding: "2px 6px", background: "rgba(236, 72, 153, 0.15)", color: "#ec4899", borderRadius: 3 }}>Fundamentals</span>
                    <span style={{ padding: "2px 6px", background: "rgba(20, 184, 166, 0.15)", color: "#14b8a6", borderRadius: 3 }}>Research</span>
                    <span style={{ padding: "2px 6px", background: "rgba(251, 191, 36, 0.15)", color: "#fbbf24", borderRadius: 3 }}>Liquidity</span>
                    <span style={{ padding: "2px 6px", background: "rgba(139, 92, 246, 0.15)", color: "#8b5cf6", borderRadius: 3 }}>Momentum</span>
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* Placeholder metric cards */}
          <div style={sectionTitle}>Performance Metrics</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 24 }}>
            {["Win Rate", "Sharpe Ratio", "Total Return", "Profit Factor", "Avg Return", "Max Drawdown", "Avg Holding", "Avg R²"].map((label, i) => (
              <div key={i} style={cardStyle}>
                <div style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
                  {label}
                </div>
                <div style={{ fontSize: 22, fontWeight: 700, color: "var(--muted)", fontFamily: "monospace" }}>
                  --
                </div>
                <div style={{ fontSize: 10, color: "var(--muted-foreground)", marginTop: 2 }}>Run backtest</div>
              </div>
            ))}
          </div>

          {/* Info message */}
          <div style={{
            textAlign: "center",
            padding: 24,
            color: "var(--muted)",
            fontSize: 13,
            border: "1px dashed var(--border)",
            borderRadius: 6,
          }}>
            {loading ? (
              <>
                <div style={{ marginBottom: 8 }}>Estimated time: 30-60 seconds</div>
                <div style={{ fontSize: 11 }}>
                  Calculating 5-year historical returns, Sharpe ratios, and drawdown analysis for each ticker...
                </div>
              </>
            ) : (
              <>
                <div style={{ marginBottom: 8 }}>Configure your parameters above</div>
                <div style={{ fontSize: 11 }}>
                  Click &quot;Run Backtest&quot; to analyze all OBX tickers with your selected parameters
                </div>
              </>
            )}
          </div>
        </main>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div style={{ minHeight: "100vh", background: "var(--background)", color: "var(--foreground)", padding: 24 }}>
        <div style={{ maxWidth: 1400, margin: "0 auto" }}>
          <div style={{ background: "var(--danger-bg)", border: "1px solid var(--danger)", borderRadius: 6, padding: 16 }}>
            <div style={{ color: "var(--danger)", fontWeight: 600 }}>Error loading strategy</div>
            <div style={{ color: "var(--danger)", fontSize: 13, marginTop: 4 }}>{error}</div>
          </div>
        </div>
      </div>
    );
  }

  const { summary, currentSignals, recentTrades, stats } = data || {
    summary: { totalTrades: 0, winRate: 0, avgReturn: 0, totalReturn: 0, maxDrawdown: 0, worstTradeLoss: 0, sharpeRatio: 0, profitFactor: 0, avgHoldingDays: 0, exitBreakdown: { target: 0, time: 0, stop: 0 } },
    currentSignals: [],
    recentTrades: [],
    stats: { tickersAnalyzed: 0, tickersWithSignals: 0, avgR2: 0 },
  };

  // Calculate actual worst trade from trades list (more reliable than API value)
  const actualWorstTrade = recentTrades.length > 0
    ? Math.min(...recentTrades.map(t => t.returnPct))
    : 0;

  // Build cumulative return chart data from trades (portfolio-weighted, compounded)
  // Each trade is weighted as 1/maxPositions of the portfolio (same as API calculation)
  const sortedTrades = [...recentTrades].sort((a, b) => a.exitDate.localeCompare(b.exitDate));
  let equity = 1.0;
  const cumulativeData = sortedTrades.map((trade) => {
    // Portfolio-weighted return: each trade impacts 1/maxPositions of the portfolio
    equity *= (1 + trade.returnPct / maxPositions);
    return {
      date: trade.exitDate,
      return: (trade.returnPct / maxPositions) * 100, // Portfolio impact per trade
      cumulative: (equity - 1) * 100, // Convert to percentage
      ticker: trade.ticker,
    };
  });

  // Trade distribution by exit reason
  const exitReasonData = [
    { name: "Target", value: summary.exitBreakdown.target, color: "#10b981" },
    { name: "Time", value: summary.exitBreakdown.time, color: "#3b82f6" },
    { name: "Stop", value: summary.exitBreakdown.stop, color: "#ef4444" },
  ];

  return (
    <div style={{ minHeight: "100vh", background: "var(--background)", color: "var(--foreground)" }}>
      {/* Header */}
      <header style={{ borderBottom: "1px solid var(--border)", padding: "16px 24px" }}>
        <div style={{ maxWidth: 1400, margin: "0 auto", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <Link href="/stocks" style={{ color: "var(--muted)", fontSize: 12, textDecoration: "none" }}>
              ← Back to Stocks
            </Link>
            <h1 style={{ fontSize: 20, fontWeight: 600, marginTop: 4 }}>STD Channel Mean Reversion</h1>
            <p style={{ color: "var(--muted)", fontSize: 12, marginTop: 2 }}>
              Slope-aligned mean reversion with fundamental quality filter
            </p>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Strategy Status
            </div>
            <div style={{ fontSize: 16, fontWeight: 600, color: currentSignals.length > 0 ? "var(--success)" : "var(--muted)" }}>
              {currentSignals.length > 0 ? `${currentSignals.length} Active Signal${currentSignals.length > 1 ? "s" : ""}` : "No Active Signals"}
            </div>
          </div>
        </div>
      </header>

      <main style={{ maxWidth: 1400, margin: "0 auto", padding: 24 }}>
        {/* Strategy Parameters - Editable */}
        <section style={{ ...cardStyle, marginBottom: 24, background: "var(--hover-bg)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <div style={sectionTitle}>Strategy Parameters</div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={runOptimizer}
                disabled={optimizing}
                style={{
                  ...buttonStyle,
                  background: optimizing ? "var(--muted)" : "#f59e0b",
                  opacity: optimizing ? 0.6 : 1,
                  cursor: optimizing ? "not-allowed" : "pointer",
                }}
              >
                {optimizing ? "Optimizing..." : "Find Optimal"}
              </button>
              <button
                onClick={fetchData}
                disabled={loading}
                style={{
                  ...buttonStyle,
                  background: loading ? "var(--muted)" : "var(--accent)",
                  opacity: loading ? 0.6 : 1,
                  cursor: loading ? "not-allowed" : "pointer",
                }}
              >
                {loading ? "Running..." : "Run Backtest"}
              </button>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12 }}>
            <div>
              <label style={labelStyle}>Entry Sigma (σ)</label>
              <input
                type="number"
                step="0.25"
                value={entrySigma}
                onChange={(e) => setEntrySigma(parseFloat(e.target.value) || 2.0)}
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>Stop Sigma (σ)</label>
              <input
                type="number"
                step="0.25"
                value={stopSigma}
                onChange={(e) => setStopSigma(parseFloat(e.target.value) || 2.5)}
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>Max Holding Days</label>
              <input
                type="number"
                step="1"
                value={maxDays}
                onChange={(e) => setMaxDays(parseInt(e.target.value) || 14)}
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>Max Positions</label>
              <input
                type="number"
                step="1"
                min="1"
                max="20"
                value={maxPositions}
                onChange={(e) => setMaxPositions(parseInt(e.target.value) || 5)}
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>Max Drawdown %</label>
              <input
                type="number"
                step="1"
                min="5"
                max="50"
                value={maxDD}
                onChange={(e) => setMaxDD(parseFloat(e.target.value) || 15)}
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>Min R²</label>
              <input
                type="number"
                step="0.05"
                value={minR2}
                onChange={(e) => setMinR2(parseFloat(e.target.value) || 0.5)}
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>Min Book/Market</label>
              <input
                type="number"
                step="0.1"
                value={minBM}
                onChange={(e) => setMinBM(parseFloat(e.target.value))}
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>Min E/P (Earnings)</label>
              <input
                type="number"
                step="0.01"
                value={minEP}
                onChange={(e) => setMinEP(parseFloat(e.target.value))}
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>Window Size</label>
              <input
                type="number"
                step="10"
                value={windowSize}
                onChange={(e) => setWindowSize(parseInt(e.target.value) || 252)}
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>Min Slope</label>
              <input
                type="number"
                step="0.0001"
                value={minSlope}
                onChange={(e) => setMinSlope(parseFloat(e.target.value) || 0.0001)}
                style={inputStyle}
              />
            </div>
          </div>

          {/* Event Filter Section */}
          <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 12 }}>
              <div style={{ ...sectionTitle, margin: 0 }}>Event-Driven Filters</div>
              <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={useEventFilters}
                  onChange={(e) => setUseEventFilters(e.target.checked)}
                  style={{ width: 16, height: 16 }}
                />
                <span style={{ fontSize: 12, color: useEventFilters ? "var(--foreground)" : "var(--muted)" }}>
                  {useEventFilters ? "Enabled" : "Disabled"}
                </span>
              </label>
            </div>
            {useEventFilters && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
                <div>
                  <label style={labelStyle}>Min Event Score</label>
                  <input
                    type="text"
                    value={minEventScoreStr}
                    onChange={(e) => setMinEventScoreStr(e.target.value)}
                    style={inputStyle}
                    placeholder="0.5"
                  />
                </div>
                <div style={{ gridColumn: "span 3", display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: "var(--muted)" }}>
                  <span style={{ padding: "2px 6px", background: "rgba(16, 185, 129, 0.15)", color: "#10b981", borderRadius: 3 }}>Volume</span>
                  <span style={{ padding: "2px 6px", background: "rgba(59, 130, 246, 0.15)", color: "#3b82f6", borderRadius: 3 }}>Gap</span>
                  <span style={{ padding: "2px 6px", background: "rgba(168, 85, 247, 0.15)", color: "#a855f7", borderRadius: 3 }}>Market</span>
                  <span style={{ padding: "2px 6px", background: "rgba(249, 115, 22, 0.15)", color: "#f97316", borderRadius: 3 }}>Volatility</span>
                  <span style={{ padding: "2px 6px", background: "rgba(236, 72, 153, 0.15)", color: "#ec4899", borderRadius: 3 }}>Fundamentals</span>
                  <span style={{ padding: "2px 6px", background: "rgba(20, 184, 166, 0.15)", color: "#14b8a6", borderRadius: 3 }}>Research</span>
                  <span style={{ padding: "2px 6px", background: "rgba(251, 191, 36, 0.15)", color: "#fbbf24", borderRadius: 3 }}>Liquidity</span>
                  <span style={{ padding: "2px 6px", background: "rgba(139, 92, 246, 0.15)", color: "#8b5cf6", borderRadius: 3 }}>Momentum</span>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* Optimizer Results */}
        {showOptimizer && (
          <section style={{ ...cardStyle, marginBottom: 24, background: "#1a1a0a", borderColor: "#4a4a2a" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div style={sectionTitle}>Optimization Results (Top 10)</div>
              <button onClick={() => setShowOptimizer(false)} style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: 18 }}>×</button>
            </div>
            {optimizing ? (
              <div style={{ textAlign: "center", padding: 32, color: "var(--muted)" }}>
                Testing 270 parameter combinations... This takes ~30 seconds.
              </div>
            ) : optimResults ? (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead>
                    <tr style={{ color: "var(--muted)", textAlign: "left", borderBottom: "1px solid var(--border)" }}>
                      <th style={{ padding: "8px", fontWeight: 500 }}>Entry σ</th>
                      <th style={{ padding: "8px", fontWeight: 500 }}>Stop σ</th>
                      <th style={{ padding: "8px", fontWeight: 500 }}>Max Days</th>
                      <th style={{ padding: "8px", fontWeight: 500 }}>Min R²</th>
                      <th style={{ padding: "8px", fontWeight: 500 }}>Window</th>
                      <th style={{ padding: "8px", fontWeight: 500, textAlign: "right" }}>Trades</th>
                      <th style={{ padding: "8px", fontWeight: 500, textAlign: "right" }}>Win Rate</th>
                      <th style={{ padding: "8px", fontWeight: 500, textAlign: "right" }}>Return</th>
                      <th style={{ padding: "8px", fontWeight: 500, textAlign: "right" }}>Sharpe</th>
                      <th style={{ padding: "8px", fontWeight: 500, textAlign: "right" }}>PF</th>
                      <th style={{ padding: "8px", fontWeight: 500, textAlign: "right" }}>Worst Trade</th>
                      <th style={{ padding: "8px", fontWeight: 500 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {optimResults.slice(0, 10).map((r, idx) => (
                      <tr key={idx} style={{ borderBottom: "1px solid var(--table-border)", background: idx === 0 ? "#2a2a1a" : "#141414" }}>
                        <td style={{ padding: "10px 8px", fontFamily: "monospace" }}>{r.params.entrySigma.toFixed(2)}</td>
                        <td style={{ padding: "10px 8px", fontFamily: "monospace" }}>{r.params.stopSigma.toFixed(1)}</td>
                        <td style={{ padding: "10px 8px", fontFamily: "monospace" }}>{r.params.maxDays}</td>
                        <td style={{ padding: "10px 8px", fontFamily: "monospace" }}>{r.params.minR2.toFixed(2)}</td>
                        <td style={{ padding: "10px 8px", fontFamily: "monospace" }}>{r.params.windowSize}</td>
                        <td style={{ padding: "10px 8px", textAlign: "right", fontFamily: "monospace" }}>{r.totalTrades}</td>
                        <td style={{ padding: "10px 8px", textAlign: "right", fontFamily: "monospace", color: r.winRate >= 0.5 ? "#10b981" : "#ef4444" }}>
                          {(r.winRate * 100).toFixed(0)}%
                        </td>
                        <td style={{ padding: "10px 8px", textAlign: "right", fontFamily: "monospace", color: r.totalReturn > 0 ? "#10b981" : "#ef4444" }}>
                          {(r.totalReturn * 100).toFixed(0)}%
                        </td>
                        <td style={{ padding: "10px 8px", textAlign: "right", fontFamily: "monospace", color: r.sharpe >= 1 ? "#10b981" : "var(--muted)" }}>
                          {r.sharpe.toFixed(2)}
                        </td>
                        <td style={{ padding: "10px 8px", textAlign: "right", fontFamily: "monospace" }}>
                          {r.profitFactor > 10 ? ">10" : r.profitFactor.toFixed(2)}
                        </td>
                        <td style={{ padding: "10px 8px", textAlign: "right", fontFamily: "monospace", color: "#ef4444" }}>
                          {(r.maxDrawdown * 100).toFixed(0)}%
                        </td>
                        <td style={{ padding: "10px 8px" }}>
                          <button
                            onClick={() => applyOptimalParams(r)}
                            style={{ ...buttonStyle, padding: "4px 10px", fontSize: 11, background: idx === 0 ? "#f59e0b" : "var(--accent)" }}
                          >
                            Apply
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </section>
        )}

        {/* Performance Summary Cards */}
        <section style={{ marginBottom: 24 }}>
          <div style={sectionTitle}>Backtest Performance Summary {loading && <span style={{ color: "var(--warning)" }}>(updating...)</span>}</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
            <MetricCard
              label="Win Rate"
              value={`${(summary.winRate * 100).toFixed(0)}%`}
              subtext={`${summary.totalTrades} trades`}
              positive={summary.winRate >= 0.5}
            />
            <MetricCard
              label="Sharpe Ratio"
              value={summary.sharpeRatio.toFixed(2)}
              subtext="Risk-adjusted"
              positive={summary.sharpeRatio >= 1}
            />
            <MetricCard
              label="Total Return"
              value={`${(summary.totalReturn * 100).toFixed(0)}%`}
              subtext="Cumulative"
              positive={summary.totalReturn > 0}
            />
            <MetricCard
              label="Profit Factor"
              value={summary.profitFactor > 99 ? ">99" : summary.profitFactor.toFixed(2)}
              subtext="Win/Loss ratio"
              positive={summary.profitFactor >= 2}
            />
            <MetricCard
              label="Avg Return"
              value={`${(summary.avgReturn * 100).toFixed(1)}%`}
              subtext="Per trade"
              positive={summary.avgReturn > 0}
            />
            <MetricCard
              label="Worst Trade"
              value={`${(actualWorstTrade * 100).toFixed(1)}%`}
              subtext="Single trade loss"
              positive={false}
              neutral
            />
            <MetricCard
              label="Avg Holding"
              value={`${summary.avgHoldingDays.toFixed(0)}d`}
              subtext="Days per trade"
              positive={true}
              neutral
            />
            <MetricCard
              label="Avg R²"
              value={stats.avgR2.toFixed(2)}
              subtext={`${stats.tickersAnalyzed} analyzed`}
              positive={stats.avgR2 >= 0.5}
            />
          </div>
        </section>

        {/* Event Filter Methodology & Statistics */}
        {useEventFilters && (
          <section style={{ ...cardStyle, marginBottom: 24, background: "#08080c", borderColor: "#1a1a2a" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
              <div>
                <div style={{ ...sectionTitle, display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                  <span style={{ width: 8, height: 8, background: "#8b5cf6", borderRadius: 2 }} />
                  Signal Quality Filter
                </div>
                <p style={{ fontSize: 11, color: "var(--muted)", margin: 0 }}>
                  8-factor scoring: Mean reversion vs regime shift classification
                </p>
              </div>
              {data?.filterStats && (
                <div style={{ display: "flex", gap: 12, padding: "6px 12px", background: "rgba(139, 92, 246, 0.05)", borderRadius: 4, border: "1px solid rgba(139, 92, 246, 0.15)", fontSize: 10 }}>
                  <div>
                    <span style={{ color: "var(--muted)" }}>Score: </span>
                    <span style={{ fontWeight: 700, fontFamily: "monospace", color: data.filterStats.avgScore >= 0.7 ? "#10b981" : "#fbbf24" }}>
                      {(data.filterStats.avgScore * 100).toFixed(0)}%
                    </span>
                  </div>
                  <div>
                    <span style={{ color: "var(--muted)" }}>Filtered: </span>
                    <span style={{ fontWeight: 700, fontFamily: "monospace", color: "#ef4444" }}>
                      {data.filterStats.candidatesFiltered}
                    </span>
                    <span style={{ color: "var(--muted)" }}> ({data.filterStats.filterRate})</span>
                  </div>
                </div>
              )}
            </div>

            {/* Filter Weight Visualization */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
              <FilterWeightCard
                name="Volume Anomaly"
                weight={20}
                color="#10b981"
                description="High volume + extreme σ = news-driven. Normal volume = technical overreaction."
                logic="HIGH VOL → AVOID | NORMAL → TRADE"
              />
              <FilterWeightCard
                name="Gap Detection"
                weight={15}
                color="#3b82f6"
                description="Overnight gaps reveal news events. Large gaps = fundamental repricing."
                logic="GAP > 2% → AVOID | GAP < 1% → TRADE"
              />
              <FilterWeightCard
                name="Market Context"
                weight={15}
                color="#a855f7"
                description="Beta-adjusted: systematic moves are noise, idiosyncratic = opportunity."
                logic="β × MKT → SYSTEMATIC | RESIDUAL → IDIO"
              />
              <FilterWeightCard
                name="Volatility Regime"
                weight={10}
                color="#f97316"
                description="High-vol regime: extremes common. Low-vol: unusual, better reversion."
                logic="HIGH VOL → COMMON | LOW VOL → UNUSUAL"
              />
              <FilterWeightCard
                name="Fundamental Stability"
                weight={10}
                color="#ec4899"
                description="E/P or B/M changes = repricing. Stable fundamentals = technical move."
                logic="Δ FUND → REGIME | STABLE → TECHNICAL"
              />
              <FilterWeightCard
                name="Research Activity"
                weight={10}
                color="#14b8a6"
                description="Recent analyst reports = news-driven. No coverage = inefficiency."
                logic="REPORT → NEWS | NO COVERAGE → TRADE"
              />
              <FilterWeightCard
                name="Liquidity Quality"
                weight={10}
                color="#fbbf24"
                description="Illiquid: moves persist. High liquidity: faster mean reversion."
                logic="ILLIQUID → PERSIST | LIQUID → REVERT"
              />
              <FilterWeightCard
                name="Momentum Divergence"
                weight={10}
                color="#8b5cf6"
                description="Short vs long-term divergence = exhaustion. Aligned = continuation."
                logic="DIVERGE → REVERSAL | ALIGNED → CONT"
              />
            </div>

            {/* Scoring Legend */}
            <div style={{ marginTop: 12, display: "flex", gap: 20, padding: "8px 12px", background: "rgba(0,0,0,0.2)", borderRadius: 4, alignItems: "center", fontSize: 10 }}>
              <span style={{ color: "var(--muted)", fontWeight: 500 }}>ACTION:</span>
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{ width: 8, height: 8, background: "#10b981", borderRadius: 1 }} />
                <span style={{ color: "#10b981", fontWeight: 600 }}>≥70%</span>
                <span style={{ color: "var(--muted)" }}>PROCEED</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{ width: 8, height: 8, background: "#fbbf24", borderRadius: 1 }} />
                <span style={{ color: "#fbbf24", fontWeight: 600 }}>50-70%</span>
                <span style={{ color: "var(--muted)" }}>CAUTION</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{ width: 8, height: 8, background: "#ef4444", borderRadius: 1 }} />
                <span style={{ color: "#ef4444", fontWeight: 600 }}>&lt;50%</span>
                <span style={{ color: "var(--muted)" }}>AVOID</span>
              </div>
            </div>
          </section>
        )}

        {/* Charts Section */}
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 16, marginBottom: 24 }}>
          {/* Cumulative Returns Chart */}
          <div style={cardStyle}>
            <div style={sectionTitle}>Cumulative Returns</div>
            <div style={{ height: 300 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={cumulativeData} margin={{ top: 10, right: 20, bottom: 5, left: 0 }}>
                  <defs>
                    <linearGradient id="cumGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
                  <XAxis
                    dataKey="date"
                    stroke="var(--muted)"
                    fontSize={10}
                    tickFormatter={(v) => v.slice(5)}
                    minTickGap={50}
                  />
                  <YAxis
                    stroke="var(--muted)"
                    fontSize={10}
                    tickFormatter={(v) => `${v.toFixed(0)}%`}
                    domain={["auto", "auto"]}
                  />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    labelStyle={{ color: "#a1a1aa", marginBottom: 6 }}
                    formatter={(value, name, props) => {
                      const numValue = typeof value === 'number' ? value : 0;
                      const ticker = (props?.payload as { ticker?: string })?.ticker || "";
                      return [
                        <span key="v" style={{ color: numValue >= 0 ? "#10b981" : "#ef4444", fontWeight: 600 }}>
                          {numValue.toFixed(2)}%
                        </span>,
                        <span key="l" style={{ color: "#e4e4e7" }}>
                          {name === "cumulative" ? `Cumulative (${ticker})` : name}
                        </span>,
                      ];
                    }}
                    labelFormatter={(label) => <span style={{ color: "#e4e4e7", fontWeight: 600 }}>Exit: {label}</span>}
                  />
                  <ReferenceLine y={0} stroke="var(--border)" strokeDasharray="3 3" />
                  <Area
                    type="monotone"
                    dataKey="cumulative"
                    stroke="#10b981"
                    strokeWidth={2}
                    fill="url(#cumGradient)"
                    dot={{ fill: "#10b981", r: 2, strokeWidth: 0 }}
                    activeDot={{ r: 4, fill: "#10b981" }}
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Exit Reason Distribution */}
          <div style={cardStyle}>
            <div style={sectionTitle}>Exit Breakdown</div>
            <div style={{ height: 300 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={exitReasonData} layout="vertical" margin={{ left: 10, right: 30 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" horizontal={false} />
                  <XAxis type="number" stroke="var(--muted)" fontSize={10} tickFormatter={(v) => `${v}%`} />
                  <YAxis type="category" dataKey="name" stroke="var(--muted)" fontSize={11} width={50} />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    labelStyle={{ color: "#a1a1aa", marginBottom: 4 }}
                    formatter={(value) => [
                      <span key="v" style={{ color: "#e4e4e7", fontWeight: 600 }}>{value}%</span>,
                      <span key="l" style={{ color: "#a1a1aa" }}>of trades</span>,
                    ]}
                  />
                  <Bar dataKey="value" radius={[0, 4, 4, 0]} isAnimationActive={false}>
                    {exitReasonData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {/* Current Signals with Event Filters */}
        {currentSignals.length > 0 && (
          <section style={{ ...cardStyle, marginBottom: 24, background: "#0a1a14", borderColor: "#1a4a3a" }}>
            <div style={{ ...sectionTitle, display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ width: 8, height: 8, background: "#10b981", borderRadius: "50%" }} />
              Current Active Signals
              {useEventFilters && <span style={{ fontSize: 10, color: "var(--muted)", fontWeight: 400 }}>(with event filter analysis)</span>}
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ color: "var(--muted)", textAlign: "left", borderBottom: "1px solid var(--border)" }}>
                    <th style={{ padding: "8px 12px 8px 0", fontWeight: 500 }}>Ticker</th>
                    <th style={{ padding: "8px 12px", fontWeight: 500 }}>Signal</th>
                    <th style={{ padding: "8px 12px", fontWeight: 500, textAlign: "right" }}>Sigma</th>
                    <th style={{ padding: "8px 12px", fontWeight: 500, textAlign: "right" }}>R²</th>
                    {useEventFilters && (
                      <>
                        <th style={{ padding: "8px 12px", fontWeight: 500, textAlign: "center" }}>Event Score</th>
                        <th style={{ padding: "8px 12px", fontWeight: 500 }}>Recommendation</th>
                      </>
                    )}
                    <th style={{ padding: "8px 12px", fontWeight: 500, textAlign: "right" }}>B/M</th>
                    <th style={{ padding: "8px 12px", fontWeight: 500, textAlign: "right" }}>E/P</th>
                    <th style={{ padding: "8px 0 8px 12px", fontWeight: 500, textAlign: "right" }}>Mom 6M</th>
                  </tr>
                </thead>
                <tbody>
                  {currentSignals.map((signal, idx) => (
                    <>
                      <tr
                        key={idx}
                        style={{
                          borderBottom: expandedSignal === signal.ticker ? "none" : "1px solid var(--table-border)",
                          cursor: signal.eventFilters ? "pointer" : "default",
                        }}
                        onClick={() => signal.eventFilters && setExpandedSignal(expandedSignal === signal.ticker ? null : signal.ticker)}
                      >
                        <td style={{ padding: "10px 12px 10px 0" }}>
                          <Link href={`/stocks/${signal.ticker}`} style={{ color: "var(--accent)", fontWeight: 600, textDecoration: "none" }} onClick={(e) => e.stopPropagation()}>
                            {signal.ticker}
                          </Link>
                          {signal.eventFilters && (
                            <span style={{ marginLeft: 6, fontSize: 10, color: "var(--muted)" }}>
                              {expandedSignal === signal.ticker ? "▼" : "▶"}
                            </span>
                          )}
                        </td>
                        <td style={{ padding: "10px 12px" }}>
                          <span style={{
                            padding: "2px 8px",
                            borderRadius: 4,
                            fontSize: 11,
                            fontWeight: 600,
                            background: signal.signal === "LONG" ? "rgba(16, 185, 129, 0.15)" : "rgba(239, 68, 68, 0.15)",
                            color: signal.signal === "LONG" ? "#10b981" : "#ef4444",
                          }}>
                            {signal.signal}
                          </span>
                        </td>
                        <td style={{ padding: "10px 12px", textAlign: "right", fontFamily: "monospace" }}>
                          {signal.sigmaDistance.toFixed(2)}σ
                        </td>
                        <td style={{ padding: "10px 12px", textAlign: "right", fontFamily: "monospace" }}>{signal.r2.toFixed(2)}</td>
                        {useEventFilters && (
                          <>
                            <td style={{ padding: "10px 12px", textAlign: "center" }}>
                              <div style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 6,
                                padding: "2px 8px",
                                borderRadius: 4,
                                background: (signal.eventScore || 0) >= 0.7 ? "rgba(16, 185, 129, 0.15)" :
                                           (signal.eventScore || 0) >= 0.5 ? "rgba(251, 191, 36, 0.15)" : "rgba(239, 68, 68, 0.15)",
                              }}>
                                <div style={{
                                  width: 40,
                                  height: 4,
                                  background: "var(--border)",
                                  borderRadius: 2,
                                  overflow: "hidden",
                                }}>
                                  <div style={{
                                    width: `${(signal.eventScore || 0) * 100}%`,
                                    height: "100%",
                                    background: (signal.eventScore || 0) >= 0.7 ? "#10b981" :
                                               (signal.eventScore || 0) >= 0.5 ? "#fbbf24" : "#ef4444",
                                  }} />
                                </div>
                                <span style={{
                                  fontFamily: "monospace",
                                  fontSize: 11,
                                  fontWeight: 600,
                                  color: (signal.eventScore || 0) >= 0.7 ? "#10b981" :
                                         (signal.eventScore || 0) >= 0.5 ? "#fbbf24" : "#ef4444",
                                }}>
                                  {((signal.eventScore || 0) * 100).toFixed(0)}%
                                </span>
                              </div>
                            </td>
                            <td style={{ padding: "10px 12px" }}>
                              <span style={{
                                padding: "2px 8px",
                                borderRadius: 4,
                                fontSize: 10,
                                fontWeight: 600,
                                background: signal.eventRecommendation === "PROCEED" ? "rgba(16, 185, 129, 0.15)" :
                                           signal.eventRecommendation === "CAUTION" ? "rgba(251, 191, 36, 0.15)" : "rgba(239, 68, 68, 0.15)",
                                color: signal.eventRecommendation === "PROCEED" ? "#10b981" :
                                       signal.eventRecommendation === "CAUTION" ? "#fbbf24" : "#ef4444",
                              }}>
                                {signal.eventRecommendation || "N/A"}
                              </span>
                            </td>
                          </>
                        )}
                        <td style={{ padding: "10px 12px", textAlign: "right", fontFamily: "monospace" }}>
                          {signal.bm !== null ? signal.bm.toFixed(2) : "-"}
                        </td>
                        <td style={{ padding: "10px 12px", textAlign: "right", fontFamily: "monospace" }}>
                          {signal.ep !== null ? signal.ep.toFixed(2) : "-"}
                        </td>
                        <td style={{ padding: "10px 0 10px 12px", textAlign: "right", fontFamily: "monospace" }}>
                          {signal.mom6m !== null ? (
                            <span style={{ color: signal.mom6m >= 0 ? "#10b981" : "#ef4444" }}>
                              {signal.mom6m >= 0 ? "+" : ""}{(signal.mom6m * 100).toFixed(1)}%
                            </span>
                          ) : "-"}
                        </td>
                      </tr>
                      {/* Expanded Event Filter Details */}
                      {expandedSignal === signal.ticker && signal.eventFilters && (
                        <tr key={`${idx}-filters`}>
                          <td colSpan={useEventFilters ? 9 : 7} style={{ padding: "0 0 12px 12px", background: "#0d1f17" }}>
                            <div style={{ padding: 12, borderRadius: 4, background: "#0a1510", border: "1px solid #1a3a2a" }}>
                              <div style={{ fontSize: 10, color: "var(--muted)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                                Event Filter Breakdown
                              </div>
                              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
                                {signal.eventFilters.map((filter, fIdx) => (
                                  <div key={fIdx} style={{
                                    padding: 8,
                                    borderRadius: 4,
                                    background: "var(--card-bg)",
                                    border: `1px solid ${filter.score >= 0.7 ? "#1a4a3a" : filter.score >= 0.5 ? "#4a4a2a" : "#4a2a2a"}`,
                                  }}>
                                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                                      <span style={{ fontSize: 10, fontWeight: 600, color: "var(--foreground)" }}>{filter.name}</span>
                                      <span style={{
                                        fontSize: 10,
                                        fontWeight: 600,
                                        fontFamily: "monospace",
                                        color: filter.score >= 0.7 ? "#10b981" : filter.score >= 0.5 ? "#fbbf24" : "#ef4444",
                                      }}>
                                        {(filter.score * 100).toFixed(0)}%
                                      </span>
                                    </div>
                                    <div style={{
                                      width: "100%",
                                      height: 3,
                                      background: "var(--border)",
                                      borderRadius: 2,
                                      marginBottom: 6,
                                    }}>
                                      <div style={{
                                        width: `${filter.score * 100}%`,
                                        height: "100%",
                                        background: filter.score >= 0.7 ? "#10b981" : filter.score >= 0.5 ? "#fbbf24" : "#ef4444",
                                        borderRadius: 2,
                                      }} />
                                    </div>
                                    <div style={{ fontSize: 9, color: "var(--muted)", lineHeight: 1.3 }}>
                                      {filter.reason}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* Trade Execution Log */}
        <section style={{ ...cardStyle, marginBottom: 24, background: "#08080c" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={sectionTitle}>Trade Log ({recentTrades.length})</div>
              <div style={{ display: "flex", gap: 8, fontSize: 9 }}>
                <span style={{ color: "#10b981" }}>■ TARGET</span>
                <span style={{ color: "#3b82f6" }}>■ TIME</span>
                <span style={{ color: "#ef4444" }}>■ STOP</span>
              </div>
            </div>
          </div>
          <div style={{ overflowX: "auto", maxHeight: 600 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
              <thead style={{ position: "sticky", top: 0, background: "var(--card-bg)", zIndex: 1 }}>
                <tr style={{ borderBottom: "2px solid var(--border)" }}>
                  <th style={{ padding: "10px 8px 10px 0", fontWeight: 600, color: "var(--muted)", textAlign: "left", fontSize: 9, textTransform: "uppercase", letterSpacing: "0.1em" }}>Ticker</th>
                  <th style={{ padding: "10px 8px", fontWeight: 600, color: "var(--muted)", textAlign: "left", fontSize: 9, textTransform: "uppercase", letterSpacing: "0.1em" }}>Direction</th>
                  <th style={{ padding: "10px 8px", fontWeight: 600, color: "var(--muted)", textAlign: "center", fontSize: 9, textTransform: "uppercase", letterSpacing: "0.1em" }}>Event Score</th>
                  <th style={{ padding: "10px 8px", fontWeight: 600, color: "var(--muted)", textAlign: "right", fontSize: 9, textTransform: "uppercase", letterSpacing: "0.1em" }}>P&L</th>
                  <th style={{ padding: "10px 8px", fontWeight: 600, color: "var(--muted)", textAlign: "left", fontSize: 9, textTransform: "uppercase", letterSpacing: "0.1em" }}>Entry → Exit</th>
                  <th style={{ padding: "10px 8px", fontWeight: 600, color: "var(--muted)", textAlign: "right", fontSize: 9, textTransform: "uppercase", letterSpacing: "0.1em" }}>Entry $</th>
                  <th style={{ padding: "10px 8px", fontWeight: 600, color: "var(--muted)", textAlign: "right", fontSize: 9, textTransform: "uppercase", letterSpacing: "0.1em" }}>Exit $</th>
                  <th style={{ padding: "10px 8px", fontWeight: 600, color: "var(--muted)", textAlign: "right", fontSize: 9, textTransform: "uppercase", letterSpacing: "0.1em" }}>Days</th>
                  <th style={{ padding: "10px 8px", fontWeight: 600, color: "var(--muted)", textAlign: "center", fontSize: 9, textTransform: "uppercase", letterSpacing: "0.1em" }}>Exit</th>
                  <th style={{ padding: "10px 8px", fontWeight: 600, color: "var(--muted)", textAlign: "left", fontSize: 9, textTransform: "uppercase", letterSpacing: "0.1em", minWidth: 200 }}>Signal Analysis</th>
                </tr>
              </thead>
              <tbody>
                {recentTrades.map((trade, idx) => {
                  // Use actual event score from backtest (filters trades at entry)
                  const eventScore = trade.eventScore ?? 1.0;

                  // Generate event description based on signal characteristics
                  const sigmaMagnitude = Math.abs(trade.sigmaAtEntry);
                  const isExtreme = sigmaMagnitude >= 3.5;
                  const isStrong = sigmaMagnitude >= 2.5;
                  const channelQuality = trade.r2 >= 0.8 ? "strong" : trade.r2 >= 0.6 ? "solid" : "weak";

                  let eventType = "";
                  if (trade.signal === "LONG") {
                    if (isExtreme) {
                      eventType = "Deep oversold";
                    } else if (isStrong) {
                      eventType = "Oversold bounce";
                    } else {
                      eventType = "Channel support";
                    }
                  } else {
                    if (isExtreme) {
                      eventType = "Extended rally";
                    } else if (isStrong) {
                      eventType = "Overbought fade";
                    } else {
                      eventType = "Channel resistance";
                    }
                  }

                  // Generate reasoning with event context
                  const eventDescription = `${eventType} (${channelQuality} channel)`;

                  const outcomeText = trade.exitReason === "TARGET"
                    ? "→ Mean reverted"
                    : trade.exitReason === "TIME"
                    ? "→ Time exit"
                    : "→ Stopped out";

                  return (
                    <tr
                      key={idx}
                      style={{
                        borderBottom: "1px solid var(--table-border)",
                        background: idx % 2 === 0 ? "transparent" : "rgba(255,255,255,0.01)",
                        borderLeft: `3px solid ${trade.exitReason === "TARGET" ? "#10b981" : trade.exitReason === "STOP" ? "#ef4444" : "#3b82f6"}`,
                      }}
                    >
                      <td style={{ padding: "12px 8px 12px 8px" }}>
                        <Link href={`/stocks/${trade.ticker}`} style={{ color: "var(--accent)", fontWeight: 700, textDecoration: "none", fontSize: 12 }}>
                          {trade.ticker}
                        </Link>
                      </td>
                      <td style={{ padding: "12px 8px" }}>
                        <span style={{
                          padding: "3px 8px",
                          borderRadius: 4,
                          fontSize: 10,
                          fontWeight: 700,
                          letterSpacing: "0.05em",
                          background: trade.signal === "LONG" ? "rgba(16, 185, 129, 0.15)" : "rgba(239, 68, 68, 0.15)",
                          color: trade.signal === "LONG" ? "#10b981" : "#ef4444",
                          border: `1px solid ${trade.signal === "LONG" ? "#10b98130" : "#ef444430"}`,
                        }}>
                          {trade.signal}
                        </span>
                      </td>
                      <td style={{ padding: "12px 8px", textAlign: "center" }}>
                        <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                          <div style={{
                            width: 36,
                            height: 6,
                            background: "var(--border)",
                            borderRadius: 3,
                            overflow: "hidden",
                          }}>
                            <div style={{
                              width: `${eventScore * 100}%`,
                              height: "100%",
                              background: eventScore >= 0.7 ? "#10b981" : eventScore >= 0.5 ? "#fbbf24" : "#ef4444",
                              borderRadius: 3,
                            }} />
                          </div>
                          <span style={{
                            fontFamily: "monospace",
                            fontSize: 10,
                            fontWeight: 700,
                            color: eventScore >= 0.7 ? "#10b981" : eventScore >= 0.5 ? "#fbbf24" : "#ef4444",
                          }}>
                            {(eventScore * 100).toFixed(0)}%
                          </span>
                        </div>
                      </td>
                      <td style={{ padding: "12px 8px", textAlign: "right" }}>
                        <span style={{
                          fontFamily: "monospace",
                          fontSize: 12,
                          fontWeight: 700,
                          color: trade.returnPct >= 0 ? "#10b981" : "#ef4444",
                        }}>
                          {trade.returnPct >= 0 ? "+" : ""}{(trade.returnPct * 100).toFixed(1)}%
                        </span>
                      </td>
                      <td style={{ padding: "12px 8px", fontFamily: "monospace", fontSize: 9, color: "var(--muted)" }}>
                        {trade.entryDate.slice(2)} → {trade.exitDate.slice(2)}
                      </td>
                      <td style={{ padding: "12px 8px", textAlign: "right", fontFamily: "monospace", fontSize: 11 }}>
                        {trade.entryPrice.toFixed(2)}
                      </td>
                      <td style={{ padding: "12px 8px", textAlign: "right", fontFamily: "monospace", fontSize: 11 }}>
                        {trade.exitPrice.toFixed(2)}
                      </td>
                      <td style={{ padding: "12px 8px", textAlign: "right", fontFamily: "monospace", fontSize: 11, color: trade.holdingDays <= 7 ? "#10b981" : trade.holdingDays <= 14 ? "var(--foreground)" : "#fbbf24" }}>
                        {trade.holdingDays}
                      </td>
                      <td style={{ padding: "12px 8px", textAlign: "center" }}>
                        <span style={{
                          padding: "3px 8px",
                          borderRadius: 4,
                          fontSize: 9,
                          fontWeight: 600,
                          letterSpacing: "0.05em",
                          background: trade.exitReason === "TARGET" ? "rgba(16, 185, 129, 0.15)" :
                                      trade.exitReason === "STOP" ? "rgba(239, 68, 68, 0.15)" : "rgba(59, 130, 246, 0.15)",
                          color: trade.exitReason === "TARGET" ? "#10b981" :
                                 trade.exitReason === "STOP" ? "#ef4444" : "#3b82f6",
                        }}>
                          {trade.exitReason}
                        </span>
                      </td>
                      <td style={{ padding: "12px 8px" }}>
                        <div style={{ fontSize: 11, lineHeight: 1.5 }}>
                          <div style={{ color: "var(--foreground)", fontWeight: 500, marginBottom: 3 }}>
                            <span style={{ color: eventScore >= 0.7 ? "#10b981" : eventScore >= 0.5 ? "#fbbf24" : "#ef4444" }}>●</span>{" "}
                            {eventDescription}
                          </div>
                          <div style={{ color: "var(--muted)", fontSize: 10 }}>
                            {(eventScore * 100).toFixed(0)}% • σ={trade.sigmaAtEntry.toFixed(1)} • R²={trade.r2.toFixed(2)} {outcomeText}
                          </div>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Summary Statistics Bar */}
          <div style={{
            marginTop: 12,
            padding: "8px 12px",
            background: "rgba(0,0,0,0.2)",
            borderRadius: 4,
            display: "flex",
            gap: 24,
            fontSize: 10,
          }}>
            <div>
              <span style={{ color: "var(--muted)" }}>Avg Event Score: </span>
              <span style={{ fontFamily: "monospace", fontWeight: 600 }}>
                {recentTrades.length > 0 ? (
                  recentTrades.reduce((sum, t) => sum + (t.eventScore ?? 1), 0) / recentTrades.length * 100
                ).toFixed(0) : 0}%
              </span>
            </div>
            <div>
              <span style={{ color: "var(--muted)" }}>Avg σ: </span>
              <span style={{ fontFamily: "monospace", fontWeight: 600 }}>
                {recentTrades.length > 0 ? (
                  recentTrades.reduce((sum, t) => sum + Math.abs(t.sigmaAtEntry), 0) / recentTrades.length
                ).toFixed(2) : 0}
              </span>
            </div>
            <div>
              <span style={{ color: "var(--muted)" }}>R²: </span>
              <span style={{ fontFamily: "monospace", fontWeight: 600 }}>
                {recentTrades.length > 0 ? (
                  recentTrades.reduce((sum, t) => sum + t.r2, 0) / recentTrades.length
                ).toFixed(2) : 0}
              </span>
            </div>
            <div>
              <span style={{ color: "#10b981" }}>Target: </span>
              <span style={{ fontFamily: "monospace", fontWeight: 600, color: "#10b981" }}>
                {recentTrades.length > 0 ? (
                  (recentTrades.filter(t => t.exitReason === "TARGET").length / recentTrades.length * 100)
                ).toFixed(0) : 0}%
              </span>
            </div>
            <div>
              <span style={{ color: "#ef4444" }}>Stop: </span>
              <span style={{ fontFamily: "monospace", fontWeight: 600, color: "#ef4444" }}>
                {recentTrades.length > 0 ? (
                  (recentTrades.filter(t => t.exitReason === "STOP").length / recentTrades.length * 100)
                ).toFixed(0) : 0}%
              </span>
            </div>
          </div>
        </section>

        {/* Strategy Documentation */}
        <section style={{ ...cardStyle, background: "linear-gradient(135deg, #0f0f14 0%, #0a0a0f 100%)", border: "1px solid #1a1a2a" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
            <div>
              <div style={sectionTitle}>Strategy Specification</div>
              <p style={{ fontSize: 11, color: "var(--muted)", margin: 0 }}>
                Institutional-grade mean reversion system with multi-factor quality controls
              </p>
            </div>
            <div style={{ padding: "4px 10px", background: "rgba(16, 185, 129, 0.1)", border: "1px solid rgba(16, 185, 129, 0.2)", borderRadius: 4, fontSize: 10, color: "#10b981", fontWeight: 600 }}>
              v2.1 PRODUCTION
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
            {/* Entry Logic */}
            <div style={{ padding: 16, background: "rgba(0,0,0,0.3)", borderRadius: 6, border: "1px solid #1a2a1a" }}>
              <div style={{ fontSize: 10, color: "#10b981", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 12 }}>
                Entry Logic
              </div>
              <div style={{ fontSize: 12, color: "var(--foreground)", marginBottom: 8 }}>
                <strong>Extreme Deviation Only</strong>
              </div>
              <ul style={{ fontSize: 11, color: "var(--muted)", lineHeight: 1.6, margin: 0, paddingLeft: 16 }}>
                <li>LONG: Price &lt; -{entrySigma}σ in <span style={{ color: "#10b981" }}>uptrend</span> (slope &gt; 0)</li>
                <li>SHORT: Price &gt; +{entrySigma}σ in <span style={{ color: "#ef4444" }}>downtrend</span> (slope &lt; 0)</li>
                <li>Slope alignment prevents counter-trend trades</li>
              </ul>
              <div style={{ marginTop: 12, padding: 8, background: "rgba(16, 185, 129, 0.1)", borderRadius: 4, fontSize: 10, fontFamily: "monospace" }}>
                σ_threshold = {entrySigma} | window = {windowSize}d
              </div>
            </div>

            {/* Quality Filters */}
            <div style={{ padding: 16, background: "rgba(0,0,0,0.3)", borderRadius: 6, border: "1px solid #1a1a3a" }}>
              <div style={{ fontSize: 10, color: "#8b5cf6", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 12 }}>
                Quality Gates
              </div>
              <div style={{ fontSize: 12, color: "var(--foreground)", marginBottom: 8 }}>
                <strong>Multi-Factor Screen</strong>
              </div>
              <ul style={{ fontSize: 11, color: "var(--muted)", lineHeight: 1.6, margin: 0, paddingLeft: 16 }}>
                <li>R² ≥ {minR2} (statistical significance)</li>
                <li>B/M ≥ {minBM} (value factor tilt)</li>
                <li>E/P ≥ {minEP} (earnings quality)</li>
                <li>Slope ≥ {minSlope.toFixed(4)} (trend strength)</li>
              </ul>
              <div style={{ marginTop: 12, padding: 8, background: "rgba(139, 92, 246, 0.1)", borderRadius: 4, fontSize: 10, fontFamily: "monospace" }}>
                Event Score ≥ {(minEventScore * 100).toFixed(0)}% (8-filter)
              </div>
            </div>

            {/* Risk Management */}
            <div style={{ padding: 16, background: "rgba(0,0,0,0.3)", borderRadius: 6, border: "1px solid #2a1a1a" }}>
              <div style={{ fontSize: 10, color: "#ef4444", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 12 }}>
                Risk Controls
              </div>
              <div style={{ fontSize: 12, color: "var(--foreground)", marginBottom: 8 }}>
                <strong>Drawdown Protection</strong>
              </div>
              <ul style={{ fontSize: 11, color: "var(--muted)", lineHeight: 1.6, margin: 0, paddingLeft: 16 }}>
                <li>Stop Loss: ±{stopSigma}σ from regression</li>
                <li>Time Exit: {maxDays} days max holding</li>
                <li>Max Positions: {maxPositions} concurrent</li>
                <li style={{ color: "#ef4444" }}>Circuit Breaker: {maxDD.toFixed(0)}% portfolio DD</li>
              </ul>
              <div style={{ marginTop: 12, padding: 8, background: "rgba(239, 68, 68, 0.1)", borderRadius: 4, fontSize: 10, fontFamily: "monospace" }}>
                Target: Mean reversion to regression line
              </div>
            </div>
          </div>

          {/* Mathematical Basis */}
          <div style={{ marginTop: 16, padding: 16, background: "rgba(0,0,0,0.2)", borderRadius: 6, border: "1px solid var(--border)" }}>
            <div style={{ fontSize: 10, color: "var(--muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8 }}>
              Mathematical Foundation
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, fontSize: 11 }}>
              <div>
                <div style={{ color: "var(--muted)", marginBottom: 4 }}>Channel Model</div>
                <code style={{ fontSize: 10, color: "#a855f7", fontFamily: "monospace" }}>
                  P(t) = α + βt + ε, ε ~ N(0, σ²)
                </code>
              </div>
              <div>
                <div style={{ color: "var(--muted)", marginBottom: 4 }}>Z-Score</div>
                <code style={{ fontSize: 10, color: "#a855f7", fontFamily: "monospace" }}>
                  z = (P - P̂) / σ_residual
                </code>
              </div>
              <div>
                <div style={{ color: "var(--muted)", marginBottom: 4 }}>Quality Metric</div>
                <code style={{ fontSize: 10, color: "#a855f7", fontFamily: "monospace" }}>
                  R² = 1 - SS_res / SS_tot
                </code>
              </div>
              <div>
                <div style={{ color: "var(--muted)", marginBottom: 4 }}>Event Score</div>
                <code style={{ fontSize: 10, color: "#a855f7", fontFamily: "monospace" }}>
                  S = Σ(wᵢ × fᵢ), Σwᵢ = 1
                </code>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

function MetricCard({ label, value, subtext, positive, neutral }: {
  label: string;
  value: string;
  subtext: string;
  positive: boolean;
  neutral?: boolean;
}) {
  const valueColor = neutral ? "var(--foreground)" : positive ? "#10b981" : "#ef4444";

  return (
    <div style={cardStyle}>
      <div style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, color: valueColor, fontFamily: "monospace" }}>
        {value}
      </div>
      <div style={{ fontSize: 10, color: "var(--muted-foreground)", marginTop: 2 }}>{subtext}</div>
    </div>
  );
}

function FilterWeightCard({ name, weight, color, description, logic }: {
  name: string;
  weight: number;
  color: string;
  description: string;
  logic: string;
}) {
  return (
    <div style={{
      padding: 10,
      background: "rgba(0,0,0,0.3)",
      borderRadius: 4,
      border: `1px solid ${color}20`,
      position: "relative",
      overflow: "hidden",
    }}>
      {/* Weight indicator bar */}
      <div style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: `${weight * 5}%`,
        height: 2,
        background: color,
      }} />

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6, marginTop: 2 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 6, height: 6, background: color, borderRadius: 1 }} />
          <span style={{ fontSize: 10, fontWeight: 600, color: "var(--foreground)" }}>{name}</span>
        </div>
        <span style={{
          fontSize: 9,
          fontWeight: 700,
          fontFamily: "monospace",
          color: color,
        }}>
          {weight}%
        </span>
      </div>

      {/* Description */}
      <p style={{ fontSize: 9, color: "var(--muted)", lineHeight: 1.3, margin: "0 0 6px 0" }}>
        {description}
      </p>

      {/* Logic indicator */}
      <div style={{
        fontSize: 7,
        fontFamily: "monospace",
        color: color,
        background: `${color}10`,
        padding: "3px 5px",
        borderRadius: 2,
        letterSpacing: "0.03em",
      }}>
        {logic}
      </div>
    </div>
  );
}
