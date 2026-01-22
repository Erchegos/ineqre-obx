"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import PriceChart from "@/components/PriceChart";
import ReturnDistributionChart from "@/components/ReturnDistributionChart";
import ResidualSquaresChart from "@/components/ResidualSquaresChart";
import TimeframeSelector from "@/components/TimeframeSelector";

type Stats = {
  totalReturn: number;
  annualizedReturn: number;
  volatility: number;
  maxDrawdown: number;
  var95: number;
  cvar95: number;
  beta: number;
  sharpeRatio: number;
};

type AnalyticsData = {
  ticker: string;
  count: number;
  summary: {
    adjusted: Stats;
    raw: Stats;
  };
  prices: Array<{ date: string; close: number; adj_close?: number }>;
  returns: {
    adjusted: Array<{ date: string; return: number }>;
    raw: Array<{ date: string; return: number }>;
  };
  drawdown: {
    adjusted: Array<{ date: string; drawdown: number }>;
    raw: Array<{ date: string; drawdown: number }>;
  };
  dateRange: {
    start: string;
    end: string;
  };
};

function calculateReturnStats(returns: Array<{ date: string; return: number }>) {
  if (!returns || returns.length === 0) return null;

  const rets = returns.map(r => r.return);
  const positiveRets = rets.filter(r => r > 0);
  const negativeRets = rets.filter(r => r < 0);
  
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance = rets.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / rets.length;
  
  // Stats
  const skewness = rets.reduce((a, b) => a + Math.pow((b - mean) / Math.sqrt(variance), 3), 0) / rets.length;
  const kurtosis = rets.reduce((a, b) => a + Math.pow((b - mean) / Math.sqrt(variance), 4), 0) / rets.length - 3;
  
  return {
    winRate: (positiveRets.length / rets.length) * 100,
    avgGain: positiveRets.length > 0 ? positiveRets.reduce((a, b) => a + b, 0) / positiveRets.length : 0,
    avgLoss: negativeRets.length > 0 ? negativeRets.reduce((a, b) => a + b, 0) / negativeRets.length : 0,
    bestDay: Math.max(...rets),
    worstDay: Math.min(...rets),
    skewness,
    kurtosis,
    totalDays: rets.length,
    positiveDays: positiveRets.length,
    negativeDays: negativeRets.length,
  };
}

function clampInt(v: string | null, def: number, min: number, max: number) {
  const n = v ? Number(v) : Number.NaN;
  if (!Number.isFinite(n)) return def;
  return Math.min(Math.max(Math.trunc(n), min), max);
}

function fmtPct(x: number | null, digits = 2): string {
  if (x === null || !Number.isFinite(x)) return "NA";
  return (x * 100).toFixed(digits) + "%";
}

function fmtNum(x: number | null, digits = 2): string {
  if (x === null || !Number.isFinite(x)) return "NA";
  return x.toFixed(digits);
}

export default function StockTickerPage() {
  const params = useParams<{ ticker?: string }>();
  const searchParams = useSearchParams();

  const ticker = useMemo(() => {
    const t = params?.ticker;
    return typeof t === "string" && t.length ? decodeURIComponent(t).toUpperCase() : "";
  }, [params]);

  const initialLimit = useMemo(() => {
    return clampInt(searchParams.get("limit"), 1500, 20, 5000);
  }, [searchParams]);

  const [limit, setLimit] = useState<number>(initialLimit);
  const [loading, setLoading] = useState<boolean>(true);
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [error, setError] = useState<string | null>(null);

  // UI State: 'comparison' is the new mode
  const [chartMode, setChartMode] = useState<"price" | "total_return" | "comparison">("comparison");
  const [showInfo, setShowInfo] = useState<boolean>(false);

  const [returnsStartDate, setReturnsStartDate] = useState<string>("");
  const [returnsEndDate, setReturnsEndDate] = useState<string>("");

  // Residuals data
  const [residualsData, setResidualsData] = useState<Array<{
    date: string;
    stockReturn: number;
    marketReturn: number;
    residual: number;
    residualSquare: number;
  }> | null>(null);
  const [residualsRegression, setResidualsRegression] = useState<{
    alpha: number;
    beta: number;
    rSquared: number;
  } | null>(null);
  const [residualsLoading, setResidualsLoading] = useState<boolean>(false);
  const [residualsError, setResidualsError] = useState<string | null>(null);

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
        // --- CRITICAL FIX: Always request adjusted=true ---
        // This ensures the backend sends both Raw Price AND Total Return data
        const url = `/api/analytics/${encodeURIComponent(ticker)}?limit=${encodeURIComponent(
          String(limit)
        )}&adjusted=true`;

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
          
          if (json.returns?.adjusted?.length > 0) {
            const arr = json.returns.adjusted;
            const endDate = arr[arr.length - 1].date;
            const startDate = arr[Math.max(0, arr.length - 252)].date;
            setReturnsStartDate(startDate);
            setReturnsEndDate(endDate);
          }
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
  }, [ticker, limit]);

  // Fetch residuals data
  useEffect(() => {
    let cancelled = false;

    async function fetchResiduals() {
      if (!ticker) {
        setResidualsData(null);
        return;
      }

      setResidualsLoading(true);
      setResidualsError(null);

      try {
        const url = `/api/residuals/${encodeURIComponent(ticker)}?limit=${encodeURIComponent(
          String(limit)
        )}&adjusted=${chartMode !== "price"}`;

        const res = await fetch(url, {
          method: "GET",
          headers: { accept: "application/json" },
          cache: "no-store",
        });

        if (!res.ok) {
          const errorData = await res.json().catch(() => ({ error: res.statusText }));
          const errorMsg = errorData.error || res.statusText;
          console.warn("Residuals API failed:", errorMsg);
          if (!cancelled) {
            setResidualsError(errorMsg);
            setResidualsData(null);
            setResidualsLoading(false);
          }
          return;
        }

        const json = await res.json();

        if (!cancelled) {
          setResidualsData(json.returnsData || json.data || []);
          setResidualsRegression(json.regression || { alpha: 0, beta: 0, rSquared: 0 });
          setResidualsLoading(false);
        }
      } catch (e: any) {
        console.warn("Residuals fetch error:", e);
        if (!cancelled) {
          setResidualsError(e?.message || "Failed to fetch residuals data");
          setResidualsData(null);
          setResidualsLoading(false);
        }
      }
    }

    fetchResiduals();
    return () => {
      cancelled = true;
    };
  }, [ticker, limit, chartMode]);

  const activeStats = useMemo(() => {
    if (!data?.summary) return null;
    return chartMode === "price" ? data.summary.raw : data.summary.adjusted;
  }, [data, chartMode]);

  const activeDrawdown = useMemo(() => {
    if (!data?.drawdown) return [];
    return chartMode === "price" ? data.drawdown.raw : data.drawdown.adjusted;
  }, [data, chartMode]);

  const activeReturns = useMemo(() => {
    if (!data?.returns) return [];
    return chartMode === "price" ? data.returns.raw : data.returns.adjusted;
  }, [data, chartMode]);

  // --- CHART DATA TRANSFORMATION ---
  const chartData = useMemo(() => {
    if (!data?.prices || data.prices.length === 0) return [];
    
    // 1. Comparison Mode: Normalize both to % change starting at 0
    // Using keys 'raw' and 'total' so PriceChart can find them easily
    if (chartMode === "comparison") {
      const startPrice = data.prices[0].close;
      const startAdj = data.prices[0].adj_close ?? data.prices[0].close;

      return data.prices.map(p => ({
        date: p.date,
        // Green Line (Raw)
        raw: ((p.close - startPrice) / startPrice) * 100, 
        // Blue Line (Total Return)
        total: (((p.adj_close ?? p.close) - startAdj) / startAdj) * 100,
      }));
    }

    // 2. Standard Modes: Just show the absolute value
    // We map it to 'raw' so the chart draws the main line
    return data.prices.map((p) => ({
      date: p.date,
      raw: chartMode === "total_return" ? (p.adj_close ?? p.close) : p.close,
      total: null // No second line
    }));
  }, [data?.prices, chartMode]);

  const filteredReturns = useMemo(() => {
    return activeReturns.filter(r => {
      const date = r.date;
      if (returnsStartDate && date < returnsStartDate) return false;
      if (returnsEndDate && date > returnsEndDate) return false;
      return true;
    });
  }, [activeReturns, returnsStartDate, returnsEndDate]);

  const priceMap = useMemo(() => {
    if (!data?.prices) return {};
    return data.prices.reduce((acc, p) => {
      acc[p.date] = p;
      return acc;
    }, {} as Record<string, { date: string; close: number; adj_close?: number }>);
  }, [data?.prices]);

  const returnStats = useMemo(() => {
    return calculateReturnStats(filteredReturns);
  }, [filteredReturns]);

  const handleDateRangePreset = (preset: string) => {
    if (!activeReturns || activeReturns.length === 0) return;
    const endDate = activeReturns[activeReturns.length - 1].date;
    let startIdx = 0;
    
    switch (preset) {
      case "1M": startIdx = Math.max(0, activeReturns.length - 21); break;
      case "3M": startIdx = Math.max(0, activeReturns.length - 63); break;
      case "6M": startIdx = Math.max(0, activeReturns.length - 126); break;
      case "1Y": startIdx = Math.max(0, activeReturns.length - 252); break;
      case "3Y": startIdx = Math.max(0, activeReturns.length - 756); break;
      case "All": startIdx = 0; break;
    }
    
    setReturnsStartDate(activeReturns[startIdx].date);
    setReturnsEndDate(endDate);
  };

  const getModeLabel = () => {
    if (chartMode === 'price') return 'Price (Raw)';
    if (chartMode === 'total_return') return 'Total Return (Adjusted)';
    return 'Performance Comparison';
  };

  return (
    <main style={{ padding: 24, maxWidth: 1400, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 24, flexWrap: "wrap" }}>
        <h1 style={{ fontSize: 32, fontWeight: 600, margin: 0, letterSpacing: "-0.02em", color: "var(--foreground)" }}>
          {ticker || "?"}
        </h1>
        <Link
          href="/stocks"
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
          ← Back to stocks
        </Link>
        <div style={{ flex: 1 }} />
        <Link
          href={`/volatility/${ticker}`}
          style={{
            padding: "8px 16px",
            borderRadius: 4,
            background: "var(--card-bg)",
            border: "1px solid var(--card-border)",
            color: "var(--foreground)",
            fontSize: 13,
            fontWeight: 500,
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            textDecoration: "none",
            letterSpacing: "0.01em",
            transition: "all 0.15s",
          }}
        >
          Volatility Analysis
        </Link>
      </div>

      <div style={{ marginBottom: 24, display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ fontSize: 13, color: "var(--muted)", letterSpacing: "0.02em", textTransform: "uppercase" }}>
          Timeframe
        </span>
        <TimeframeSelector selected={limit} onChange={setLimit} />
      </div>

      {loading && (
        <div style={{ padding: 20, borderRadius: 4, border: "1px solid var(--border)", background: "var(--card-bg)", color: "var(--muted)", fontSize: 14 }}>
          Loading analytics...
        </div>
      )}

      {!loading && error && (
        <div style={{ padding: 20, borderRadius: 4, border: "1px solid var(--danger)", background: "var(--card-bg)" }}>
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 6, color: "var(--danger)" }}>Error</div>
          <div style={{ fontSize: 13, color: "var(--muted)" }}>{error}</div>
        </div>
      )}

      {!loading && data && activeStats && (
        <>
           {/* --- CONTROLS SECTION --- */}
           <div style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 20,
            padding: 16,
            background: "var(--card-bg)",
            border: "1px solid var(--card-border)",
            borderRadius: 4,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
               <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0, color: "var(--foreground)" }}>
                 Data Mode:
               </h2>
               <div style={{ display: "flex", gap: 4, background: "var(--input-bg)", padding: 4, borderRadius: 6 }}>
                  <button
                    onClick={() => setChartMode("price")}
                    style={{
                      padding: "6px 12px",
                      borderRadius: 4,
                      border: "none",
                      background: chartMode === "price" ? "var(--background)" : "transparent",
                      color: chartMode === "price" ? "var(--foreground)" : "var(--muted)",
                      fontSize: 13,
                      fontWeight: 500,
                      cursor: "pointer",
                      boxShadow: chartMode === "price" ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
                      transition: "all 0.1s"
                    }}
                  >
                    Price
                  </button>
                  <button
                    onClick={() => setChartMode("total_return")}
                    style={{
                      padding: "6px 12px",
                      borderRadius: 4,
                      border: "none",
                      background: chartMode === "total_return" ? "var(--background)" : "transparent",
                      color: chartMode === "total_return" ? "var(--accent)" : "var(--muted)",
                      fontSize: 13,
                      fontWeight: 500,
                      cursor: "pointer",
                      boxShadow: chartMode === "total_return" ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
                      transition: "all 0.1s"
                    }}
                  >
                    Total Return
                  </button>
                  <button
                    onClick={() => setChartMode("comparison")}
                    style={{
                      padding: "6px 12px",
                      borderRadius: 4,
                      border: "none",
                      background: chartMode === "comparison" ? "var(--background)" : "transparent",
                      color: chartMode === "comparison" ? "var(--success)" : "var(--muted)", // Green highlight
                      fontSize: 13,
                      fontWeight: 500,
                      cursor: "pointer",
                      boxShadow: chartMode === "comparison" ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
                      transition: "all 0.1s"
                    }}
                  >
                    Compare (%)
                  </button>
                </div>
                <button
                  onClick={() => setShowInfo(!showInfo)}
                  style={{ background: "none", border: "none", color: showInfo ? "var(--accent)" : "var(--muted)", cursor: "pointer", marginLeft: 8 }}
                  title="Info"
                >
                   <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="10"></circle>
                      <line x1="12" y1="16" x2="12" y2="12"></line>
                      <line x1="12" y1="8" x2="12.01" y2="8"></line>
                   </svg>
                </button>
            </div>
          </div>

           {/* --- INFO BOX --- */}
           {showInfo && (
              <div style={{
                marginBottom: 20,
                padding: "16px",
                background: "var(--hover-bg)",
                border: "1px solid var(--border)",
                borderRadius: 4,
                fontSize: 13,
                lineHeight: 1.5,
                color: "var(--foreground)",
                animation: "fadeIn 0.2s ease-in-out",
              }}>
                <div style={{ fontWeight: 600, marginBottom: 8, color: "var(--accent)" }}>
                  Mode Explanation:
                </div>
                <ul style={{ margin: 0, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 8 }}>
                  <li><strong>Price:</strong> Absolute share price in NOK. Ignores dividends.</li>
                  <li><strong>Total Return:</strong> Absolute theoretical price in NOK if dividends were reinvested.</li>
                  <li><strong>Compare (%):</strong> Shows the accumulated percentage return of both strategies side-by-side. The gap between the lines represents the value of dividends.</li>
                </ul>
              </div>
            )}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 28 }}>
            <MetricCard label="Total Return" value={fmtPct(activeStats.totalReturn)} colorType={activeStats.totalReturn >= 0 ? "success" : "danger"} />
            <MetricCard label="Annualized Return" value={fmtPct(activeStats.annualizedReturn)} />
            <MetricCard label="Volatility (Ann.)" value={fmtPct(activeStats.volatility)} />
            <MetricCard label="Max Drawdown" value={fmtPct(activeStats.maxDrawdown)} colorType="danger" />
            <MetricCard label="VaR (95%)" value={fmtPct(activeStats.var95)} />
            <MetricCard label="CVaR (95%)" value={fmtPct(activeStats.cvar95)} />
            <MetricCard label="Beta (vs OBX)" value={fmtNum(activeStats.beta, 3)} />
            <MetricCard label="Sharpe Ratio" value={fmtNum(activeStats.sharpeRatio, 3)} />
          </div>

          {/* CHARTS SECTION */}
          <div style={{ marginBottom: 24, padding: 20, borderRadius: 4, border: "1px solid var(--card-border)", background: "var(--card-bg)" }}>
            <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16, color: "var(--foreground)" }}>
               History ({getModeLabel()})
            </h2>
            <PriceChart 
              data={chartData} 
              height={320} 
            />
          </div>

          <div style={{ marginBottom: 24, padding: 20, borderRadius: 4, border: "1px solid var(--card-border)", background: "var(--card-bg)" }}>
            <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8, color: "var(--foreground)" }}>
              Return Distribution Analysis
            </h2>
            <p style={{ fontSize: 12, color: "var(--muted-foreground)", marginBottom: 16, lineHeight: 1.5 }}>
              <strong>Probability density at different timeframes.</strong> Shows how likely different returns are over various holding periods.
              Wider curves = more uncertainty. Skewness and kurtosis reveal tail risk.
            </p>
            <ReturnDistributionChart returns={activeReturns} height={320} />
          </div>

          <div style={{ marginBottom: 24, padding: 20, borderRadius: 4, border: "1px solid var(--card-border)", background: "var(--card-bg)" }}>
            <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8, color: "var(--foreground)" }}>
              Residual Squares Analysis
            </h2>
            <p style={{ fontSize: 12, color: "var(--muted-foreground)", marginBottom: 16, lineHeight: 1.5 }}>
              <strong>Unexplained variance from OBX beta model.</strong> Measures idiosyncratic risk not explained by market movements.
              Lower residuals = stock moves with market. Higher residuals = stock has unique drivers.
            </p>
            {residualsLoading && (
              <div style={{ padding: 40, textAlign: "center", color: "var(--muted)" }}>
                Loading residuals data...
              </div>
            )}
            {!residualsLoading && residualsError && (
              <div style={{ padding: 20, borderRadius: 4, border: "1px solid var(--danger)", background: "rgba(239, 68, 68, 0.05)" }}>
                <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6, color: "var(--danger)" }}>
                  Unable to load residuals data
                </div>
                <div style={{ fontSize: 12, color: "var(--muted-foreground)" }}>{residualsError}</div>
              </div>
            )}
            {!residualsLoading && !residualsError && residualsData && residualsData.length > 0 && (
              <ResidualSquaresChart
                data={residualsData}
                alpha={residualsRegression?.alpha || 0}
                beta={residualsRegression?.beta || 0}
                rSquared={residualsRegression?.rSquared || 0}
                height={320}
                ticker={ticker}
              />
            )}
            {!residualsLoading && !residualsError && (!residualsData || residualsData.length === 0) && (
              <div style={{ padding: 40, textAlign: "center", color: "var(--muted)" }}>
                No residuals data available
              </div>
            )}
          </div>

          <div style={{ padding: 20, borderRadius: 4, border: "1px solid var(--card-border)", background: "var(--card-bg)" }}>
            <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8, color: "var(--foreground)" }}>
              Daily Returns Analysis
            </h2>
            <p style={{ fontSize: 12, color: "var(--muted-foreground)", marginBottom: 16, lineHeight: 1.5 }}>
              <strong>Daily return time series with statistical measures.</strong> Each row shows the log return for that day,
              with cumulative return calculated from the oldest date in the selected range. Use timeframe controls to analyze
              different periods. Win rate, skewness, and kurtosis reveal return distribution characteristics.
            </p>

            {/* Date Controls */}
            <div style={{ marginBottom: 24, display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                {["1M", "3M", "6M", "1Y", "3Y", "All"].map(preset => (
                  <button
                    key={preset}
                    onClick={() => handleDateRangePreset(preset)}
                    style={{ padding: "6px 12px", borderRadius: 3, border: "1px solid var(--input-border)", background: "var(--input-bg)", color: "var(--foreground)", fontSize: 12, cursor: "pointer", fontWeight: 500 }}
                  >
                    {preset}
                  </button>
                ))}
              </div>
              <div style={{ flex: 1 }} />
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input type="date" value={returnsStartDate} onChange={(e) => setReturnsStartDate(e.target.value)} style={{ padding: "6px 10px", borderRadius: 3, border: "1px solid var(--input-border)", background: "var(--input-bg)", color: "var(--foreground)", fontSize: 12 }} />
                <span style={{ color: "var(--muted)" }}>→</span>
                <input type="date" value={returnsEndDate} onChange={(e) => setReturnsEndDate(e.target.value)} style={{ padding: "6px 10px", borderRadius: 3, border: "1px solid var(--input-border)", background: "var(--input-bg)", color: "var(--foreground)", fontSize: 12 }} />
              </div>
            </div>

            {returnStats && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginBottom: 24, padding: 16, borderRadius: 3, border: "1px solid var(--border-subtle)", background: "var(--card-bg)" }}>
                <StatItem label="Win Rate" value={`${returnStats.winRate.toFixed(1)}%`} />
                <StatItem label="Avg Gain" value={fmtPct(returnStats.avgGain, 3)} colorType="success" />
                <StatItem label="Avg Loss" value={fmtPct(returnStats.avgLoss, 3)} colorType="danger" />
                <StatItem label="Best Day" value={fmtPct(returnStats.bestDay, 3)} colorType="success" />
                <StatItem label="Worst Day" value={fmtPct(returnStats.worstDay, 3)} colorType="danger" />
                <StatItem
                  label="Green Days"
                  value={`${returnStats.positiveDays} ↑ ${((returnStats.positiveDays / returnStats.totalDays) * 100).toFixed(1)}%`}
                  colorType="success"
                />
                <StatItem
                  label="Red Days"
                  value={`${returnStats.negativeDays} ↓ ${((returnStats.negativeDays / returnStats.totalDays) * 100).toFixed(1)}%`}
                  colorType="danger"
                />
              </div>
            )}

            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ textAlign: "left" }}>
                    <th style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)", color: "var(--muted)" }}>Date</th>
                    <th style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)", color: "var(--muted)", textAlign: "right" }}>Close</th>
                    <th style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)", color: "var(--muted)", textAlign: "right" }}>Adj Close</th>
                    <th style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)", color: "var(--muted)", textAlign: "right" }}>Daily Return</th>
                    <th style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)", color: "var(--muted)", textAlign: "right" }}>Cumulative</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredReturns.slice().reverse().map((r, idx, arr) => {
                      const cumulativeReturn = arr.slice(idx).reduce((cum, ret) => cum * (1 + ret.return), 1) - 1;
                      const priceData = priceMap[r.date] || { close: 0, adj_close: 0 };
                      return (
                        <tr key={r.date} style={{ borderTop: "1px solid var(--table-border)" }}>
                          <td style={{ padding: "10px 12px", color: "var(--foreground)" }}>{r.date}</td>
                          <td style={{ padding: "10px 12px", fontFamily: "monospace", textAlign: "right" }}>{fmtNum(priceData.close)}</td>
                          <td style={{ padding: "10px 12px", fontFamily: "monospace", textAlign: "right", color: "var(--muted-foreground)" }}>{fmtNum(priceData.adj_close ?? priceData.close)}</td>
                          <td style={{ padding: "10px 12px", fontFamily: "monospace", textAlign: "right", color: r.return > 0 ? "var(--success)" : r.return < 0 ? "var(--danger)" : "var(--foreground)" }}>{fmtPct(r.return, 4)}</td>
                          <td style={{ padding: "10px 12px", fontFamily: "monospace", textAlign: "right", color: cumulativeReturn > 0 ? "var(--success)" : cumulativeReturn < 0 ? "var(--danger)" : "var(--foreground)" }}>{fmtPct(cumulativeReturn, 2)}</td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
            <div style={{ marginTop: 12, fontSize: 11, color: "var(--muted-foreground)", textAlign: "right" }}>
              Showing all {filteredReturns.length} days
            </div>
          </div>
        </>
      )}
    </main>
  );
}

// Subcomponents
function MetricCard({ label, value, colorType, tooltip }: { label: string; value: string; colorType?: "success" | "danger" | "warning"; tooltip?: string }) {
  const getColor = () => {
    if (colorType === "success") return "var(--success)";
    if (colorType === "danger") return "var(--danger)";
    if (colorType === "warning") return "var(--warning)";
    return "var(--foreground)";
  };
  return (
    <div style={{ padding: 14, borderRadius: 3, border: "1px solid var(--card-border)", background: "var(--card-bg)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
        <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase" }}>{label}</div>
        {tooltip && <div style={{ cursor: "help", color: "var(--muted-foreground)" }} title={tooltip}>?</div>}
      </div>
      <div style={{ fontSize: 22, fontWeight: 600, color: getColor(), fontFamily: "monospace" }}>{value}</div>
    </div>
  );
}

function StatItem({ label, value, colorType }: { label: string; value: string; colorType?: "success" | "danger" }) {
  const getColor = () => {
    if (colorType === "success") return "var(--success)";
    if (colorType === "danger") return "var(--danger)";
    return "var(--foreground)";
  };
  return (
    <div>
      <div style={{ fontSize: 10, color: "var(--muted-foreground)", marginBottom: 4, textTransform: "uppercase" }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 600, color: getColor(), fontFamily: "monospace" }}>{value}</div>
    </div>
  );
}