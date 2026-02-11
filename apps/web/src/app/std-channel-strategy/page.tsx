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
    // Use actual historical max DD from backtest result + buffer for safety
    // maxDrawdown is negative (e.g., -0.02 = -2%), convert to positive percentage
    const historicalDD = Math.abs(result.maxDrawdown) * 100;
    const ddWithBuffer = Math.ceil(historicalDD * 1.5); // 50% buffer for variance
    setMaxDD(Math.max(ddWithBuffer, 3)); // Minimum 3%
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

  if (initialLoad && loading) {
    return (
      <div style={{ minHeight: "100vh", background: "var(--background)", color: "var(--foreground)" }}>
        {/* Header */}
        <header style={{ borderBottom: "1px solid var(--border)", padding: "16px 24px" }}>
          <div style={{ maxWidth: 1400, margin: "0 auto" }}>
            <div style={{ color: "var(--muted)", fontSize: 12 }}>← Back to Stocks</div>
            <h1 style={{ fontSize: 20, fontWeight: 600, marginTop: 4 }}>STD Channel Mean Reversion</h1>
            <p style={{ color: "var(--muted)", fontSize: 12, marginTop: 2 }}>
              Slope-aligned mean reversion with fundamental quality filter
            </p>
          </div>
        </header>

        {/* Loading Content */}
        <main style={{ maxWidth: 1400, margin: "0 auto", padding: 24 }}>
          {/* Loading indicator card */}
          <div style={{
            ...cardStyle,
            marginBottom: 24,
            display: "flex",
            alignItems: "center",
            gap: 16,
            background: "linear-gradient(135deg, var(--card-bg) 0%, #1a1a2e 100%)",
            borderColor: "var(--accent)",
          }}>
            {/* Pulsing dot indicator */}
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
              {/* Animated progress bar */}
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

          {/* Parameters preview */}
          <div style={{ ...cardStyle, marginBottom: 24, background: "var(--hover-bg)" }}>
            <div style={sectionTitle}>Active Parameters</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12 }}>
              <div style={{ padding: "8px 12px", background: "var(--card-bg)", borderRadius: 4, border: "1px solid var(--border)" }}>
                <div style={{ fontSize: 10, color: "var(--muted)", marginBottom: 2 }}>ENTRY σ</div>
                <div style={{ fontSize: 16, fontWeight: 600, fontFamily: "monospace" }}>{entrySigma}</div>
              </div>
              <div style={{ padding: "8px 12px", background: "var(--card-bg)", borderRadius: 4, border: "1px solid var(--border)" }}>
                <div style={{ fontSize: 10, color: "var(--muted)", marginBottom: 2 }}>STOP σ</div>
                <div style={{ fontSize: 16, fontWeight: 600, fontFamily: "monospace" }}>{stopSigma}</div>
              </div>
              <div style={{ padding: "8px 12px", background: "var(--card-bg)", borderRadius: 4, border: "1px solid var(--border)" }}>
                <div style={{ fontSize: 10, color: "var(--muted)", marginBottom: 2 }}>MAX DAYS</div>
                <div style={{ fontSize: 16, fontWeight: 600, fontFamily: "monospace" }}>{maxDays}</div>
              </div>
              <div style={{ padding: "8px 12px", background: "var(--card-bg)", borderRadius: 4, border: "1px solid var(--border)" }}>
                <div style={{ fontSize: 10, color: "var(--muted)", marginBottom: 2 }}>MIN R²</div>
                <div style={{ fontSize: 16, fontWeight: 600, fontFamily: "monospace" }}>{minR2}</div>
              </div>
              <div style={{ padding: "8px 12px", background: "var(--card-bg)", borderRadius: 4, border: "1px solid var(--border)" }}>
                <div style={{ fontSize: 10, color: "var(--muted)", marginBottom: 2 }}>MAX DD</div>
                <div style={{ fontSize: 16, fontWeight: 600, fontFamily: "monospace" }}>{maxDD}%</div>
              </div>
            </div>
          </div>

          {/* Placeholder metric cards */}
          <div style={sectionTitle}>Performance Metrics</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 24 }}>
            {["Win Rate", "Sharpe Ratio", "Total Return", "Profit Factor", "Avg Return", "Max Drawdown", "Avg Holding", "Avg R²"].map((label, i) => (
              <div key={i} style={cardStyle}>
                <div style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
                  {label}
                </div>
                <div style={{
                  height: 24,
                  background: "linear-gradient(90deg, var(--border) 0%, var(--hover-bg) 50%, var(--border) 100%)",
                  borderRadius: 4,
                  width: "60%",
                }} />
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
            <div style={{ marginBottom: 8 }}>⏱ Estimated time: 30-60 seconds</div>
            <div style={{ fontSize: 11 }}>
              Calculating 5-year historical returns, Sharpe ratios, and drawdown analysis for each ticker...
            </div>
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

        {/* Current Signals */}
        {currentSignals.length > 0 && (
          <section style={{ ...cardStyle, marginBottom: 24, background: "#0a1a14", borderColor: "#1a4a3a" }}>
            <div style={{ ...sectionTitle, display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ width: 8, height: 8, background: "#10b981", borderRadius: "50%" }} />
              Current Active Signals
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ color: "var(--muted)", textAlign: "left", borderBottom: "1px solid var(--border)" }}>
                    <th style={{ padding: "8px 12px 8px 0", fontWeight: 500 }}>Ticker</th>
                    <th style={{ padding: "8px 12px", fontWeight: 500 }}>Signal</th>
                    <th style={{ padding: "8px 12px", fontWeight: 500, textAlign: "right" }}>Sigma Dist.</th>
                    <th style={{ padding: "8px 12px", fontWeight: 500, textAlign: "right" }}>R²</th>
                    <th style={{ padding: "8px 12px", fontWeight: 500, textAlign: "right" }}>Slope</th>
                    <th style={{ padding: "8px 12px", fontWeight: 500, textAlign: "right" }}>B/M</th>
                    <th style={{ padding: "8px 12px", fontWeight: 500, textAlign: "right" }}>E/P</th>
                    <th style={{ padding: "8px 0 8px 12px", fontWeight: 500, textAlign: "right" }}>Mom 6M</th>
                  </tr>
                </thead>
                <tbody>
                  {currentSignals.map((signal, idx) => (
                    <tr key={idx} style={{ borderBottom: "1px solid var(--table-border)" }}>
                      <td style={{ padding: "10px 12px 10px 0" }}>
                        <Link href={`/stocks/${signal.ticker}`} style={{ color: "var(--accent)", fontWeight: 600, textDecoration: "none" }}>
                          {signal.ticker}
                        </Link>
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
                      <td style={{ padding: "10px 12px", textAlign: "right", fontFamily: "monospace" }}>
                        {signal.slope >= 0 ? "+" : ""}{signal.slope.toFixed(4)}
                      </td>
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
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* Recent Trades Table */}
        <section style={{ ...cardStyle, marginBottom: 24 }}>
          <div style={sectionTitle}>Recent Trades ({recentTrades.length} total)</div>
          <div style={{ overflowX: "auto", maxHeight: 500 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead style={{ position: "sticky", top: 0, background: "var(--card-bg)" }}>
                <tr style={{ color: "var(--muted)", textAlign: "left", borderBottom: "1px solid var(--border)" }}>
                  <th style={{ padding: "8px 8px 8px 0", fontWeight: 500 }}>Ticker</th>
                  <th style={{ padding: "8px", fontWeight: 500 }}>Signal</th>
                  <th style={{ padding: "8px", fontWeight: 500 }}>Entry</th>
                  <th style={{ padding: "8px", fontWeight: 500 }}>Exit</th>
                  <th style={{ padding: "8px", fontWeight: 500, textAlign: "right" }}>Entry Price</th>
                  <th style={{ padding: "8px", fontWeight: 500, textAlign: "right" }}>Exit Price</th>
                  <th style={{ padding: "8px", fontWeight: 500, textAlign: "right" }}>Return</th>
                  <th style={{ padding: "8px", fontWeight: 500, textAlign: "right" }}>Days</th>
                  <th style={{ padding: "8px", fontWeight: 500 }}>Exit Reason</th>
                  <th style={{ padding: "8px", fontWeight: 500, textAlign: "right" }}>σ Entry</th>
                  <th style={{ padding: "8px 0 8px 8px", fontWeight: 500, textAlign: "right" }}>R²</th>
                </tr>
              </thead>
              <tbody>
                {recentTrades.map((trade, idx) => (
                  <tr key={idx} style={{ borderBottom: "1px solid var(--table-border)" }}>
                    <td style={{ padding: "10px 8px 10px 0" }}>
                      <Link href={`/stocks/${trade.ticker}`} style={{ color: "var(--accent)", fontWeight: 600, textDecoration: "none" }}>
                        {trade.ticker}
                      </Link>
                    </td>
                    <td style={{ padding: "10px 8px" }}>
                      <span style={{
                        padding: "2px 6px",
                        borderRadius: 3,
                        fontSize: 10,
                        fontWeight: 600,
                        background: trade.signal === "LONG" ? "rgba(16, 185, 129, 0.15)" : "rgba(239, 68, 68, 0.15)",
                        color: trade.signal === "LONG" ? "#10b981" : "#ef4444",
                      }}>
                        {trade.signal}
                      </span>
                    </td>
                    <td style={{ padding: "10px 8px", color: "var(--muted)", fontSize: 11 }}>{trade.entryDate}</td>
                    <td style={{ padding: "10px 8px", color: "var(--muted)", fontSize: 11 }}>{trade.exitDate}</td>
                    <td style={{ padding: "10px 8px", textAlign: "right", fontFamily: "monospace" }}>{trade.entryPrice.toFixed(2)}</td>
                    <td style={{ padding: "10px 8px", textAlign: "right", fontFamily: "monospace" }}>{trade.exitPrice.toFixed(2)}</td>
                    <td style={{ padding: "10px 8px", textAlign: "right", fontFamily: "monospace" }}>
                      <span style={{ fontWeight: 600, color: trade.returnPct >= 0 ? "#10b981" : "#ef4444" }}>
                        {trade.returnPct >= 0 ? "+" : ""}{(trade.returnPct * 100).toFixed(1)}%
                      </span>
                    </td>
                    <td style={{ padding: "10px 8px", textAlign: "right", color: "var(--muted)" }}>{trade.holdingDays}</td>
                    <td style={{ padding: "10px 8px" }}>
                      <span style={{
                        padding: "2px 6px",
                        borderRadius: 3,
                        fontSize: 10,
                        background: trade.exitReason === "TARGET" ? "rgba(16, 185, 129, 0.15)" :
                                    trade.exitReason === "STOP" ? "rgba(239, 68, 68, 0.15)" : "rgba(59, 130, 246, 0.15)",
                        color: trade.exitReason === "TARGET" ? "#10b981" :
                               trade.exitReason === "STOP" ? "#ef4444" : "#3b82f6",
                      }}>
                        {trade.exitReason}
                      </span>
                    </td>
                    <td style={{ padding: "10px 8px", textAlign: "right", fontFamily: "monospace", color: "var(--muted)" }}>
                      {trade.sigmaAtEntry.toFixed(2)}σ
                    </td>
                    <td style={{ padding: "10px 0 10px 8px", textAlign: "right", fontFamily: "monospace", color: "var(--muted)" }}>
                      {trade.r2.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Strategy Notes */}
        <section style={{ ...cardStyle, background: "var(--hover-bg)" }}>
          <div style={sectionTitle}>Strategy Logic - Pension Grade</div>
          <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.6 }}>
            <p style={{ marginBottom: 8 }}>
              <strong style={{ color: "var(--foreground)" }}>High Conviction Entry:</strong> Only trades extreme deviations ({entrySigma}σ+).
              LONG when price drops below -{entrySigma}σ in uptrend, SHORT above +{entrySigma}σ in downtrend.
            </p>
            <p style={{ marginBottom: 8 }}>
              <strong style={{ color: "var(--foreground)" }}>Fundamental Screen:</strong> Requires B/M ≥ {minBM} (value bias)
              {minEP >= 0 && ` and E/P ≥ ${minEP} (positive earnings required)`}.
            </p>
            <p style={{ marginBottom: 8 }}>
              <strong style={{ color: "var(--foreground)" }}>Quality Gate:</strong> R² ≥ {minR2} ensures statistically meaningful channels.
            </p>
            <p style={{ marginBottom: 8 }}>
              <strong style={{ color: "var(--foreground)" }}>Position Limits:</strong> Max {maxPositions} concurrent positions,
              equal-weighted. Conviction scoring prioritizes best opportunities.
            </p>
            <p>
              <strong style={{ color: "var(--foreground)" }}>Risk Controls:</strong> Stop at ±{stopSigma}σ, max {maxDays} days hold,
              <span style={{ color: "#ef4444" }}> circuit breaker at {maxDD.toFixed(0)}% portfolio drawdown</span>.
            </p>
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
