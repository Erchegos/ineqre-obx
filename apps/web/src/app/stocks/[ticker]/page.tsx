"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useRef } from "react";
import { useParams, useSearchParams } from "next/navigation";
import PriceChart from "@/components/PriceChart";
import ReturnDistributionChart from "@/components/ReturnDistributionChart";
import ResidualSquaresChart from "@/components/ResidualSquaresChart";
import TimeframeSelector from "@/components/TimeframeSelector";
import StockFundamentalsPanel from "@/components/StockFundamentalsPanel";
import CandlestickChart from "@/components/CandlestickChart";

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
    adjustedStart?: string; // When valid adj_close data begins
    fullStart?: string; // Earliest data available in database
    fullEnd?: string; // Latest data available in database
  };
};

type StdChannelData = {
  date: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  midLine: number | null;
  upperBand1: number | null;
  lowerBand1: number | null;
  upperBand2: number | null;
  lowerBand2: number | null;
};

type StdChannelResponse = {
  ticker: string;
  count: number;
  metadata: {
    windowSize: number;
    k1: number;
    k2: number;
    slope: number;
    intercept: number;
    sigma: number;
    r: number;
    r2: number;
    score: number;
  };
  data: StdChannelData[];
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
  const [customDateRange, setCustomDateRange] = useState<{ start: string; end: string } | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [data, setData] = useState<AnalyticsData | null>(null);

  // Cache the full date range once we have it (prevents flickering of timeframe buttons)
  const fullDateRangeRef = useRef<{ start: string; end: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // UI State: Toggle between historical analysis and STD channel
  const [viewMode, setViewMode] = useState<"historical" | "std_channel">("historical");
  const [chartMode, setChartMode] = useState<"price" | "total_return" | "comparison">("comparison");
  const [showInfo, setShowInfo] = useState<boolean>(false);
  const [isPanelOpen, setIsPanelOpen] = useState<boolean>(false);

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

  // STD Channel data and settings
  const [stdChannelData, setStdChannelData] = useState<StdChannelResponse | null>(null);
  const [stdChannelLoading, setStdChannelLoading] = useState<boolean>(false);
  const [stdChannelError, setStdChannelError] = useState<string | null>(null);
  const [k1, setK1] = useState<number>(1.0);
  const [k2, setK2] = useState<number>(2.0);
  const [showDeviation1, setShowDeviation1] = useState<boolean>(true);
  const [showDeviation2, setShowDeviation2] = useState<boolean>(true);
  const [minWindow, setMinWindow] = useState<number>(255);
  const [maxWindow, setMaxWindow] = useState<number>(1530);
  const [step, setStep] = useState<number>(20);
  const [fixedWindow, setFixedWindow] = useState<number | null>(null);
  const [showMethodology, setShowMethodology] = useState<boolean>(false);

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
        // Build URL with either date range or limit
        let url = `/api/analytics/${encodeURIComponent(ticker)}?adjusted=true`;

        if (customDateRange && customDateRange.start && customDateRange.end) {
          // Use date range
          url += `&startDate=${encodeURIComponent(customDateRange.start)}&endDate=${encodeURIComponent(customDateRange.end)}`;
        } else {
          // Use limit
          url += `&limit=${encodeURIComponent(String(limit))}`;
        }

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
  }, [ticker, limit, customDateRange]);

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

  // Fetch STD Channel data
  useEffect(() => {
    let cancelled = false;

    async function fetchStdChannel() {
      if (!ticker || viewMode !== "std_channel") {
        return;
      }

      setStdChannelLoading(true);
      setStdChannelError(null);

      try {
        // Use fixed limit of 1600 for STD channel analysis
        let url = `/api/std-channel/${encodeURIComponent(ticker)}?k1=${k1}&k2=${k2}&limit=1600`;

        if (fixedWindow) {
          url += `&windowSize=${fixedWindow}`;
        } else {
          url += `&minWindow=${minWindow}&maxWindow=${maxWindow}&step=${step}`;
        }

        const res = await fetch(url, {
          method: "GET",
          headers: { accept: "application/json" },
          cache: "no-store",
        });

        if (!res.ok) {
          const errorData = await res.json().catch(() => ({ error: res.statusText }));
          const errorMsg = errorData.error || res.statusText;
          if (!cancelled) {
            setStdChannelError(errorMsg);
            setStdChannelData(null);
            setStdChannelLoading(false);
          }
          return;
        }

        const json = await res.json();

        if (!cancelled) {
          setStdChannelData(json);
          setStdChannelLoading(false);
        }
      } catch (e: any) {
        if (!cancelled) {
          setStdChannelError(e?.message || "Failed to fetch STD channel data");
          setStdChannelData(null);
          setStdChannelLoading(false);
        }
      }
    }

    fetchStdChannel();
    return () => {
      cancelled = true;
    };
  }, [ticker, viewMode, k1, k2, minWindow, maxWindow, step, fixedWindow]);

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

  // Calculate total available days from FULL date range (not fetched count)
  const totalAvailableDays = useMemo(() => {
    // Use fullStart/fullEnd which represent the total available range in database
    const fullStart = data?.dateRange?.fullStart;
    const fullEnd = data?.dateRange?.fullEnd;

    // Cache the full range once we have it
    if (fullStart && fullEnd) {
      fullDateRangeRef.current = { start: fullStart, end: fullEnd };
    }

    // Use cached value if available, otherwise fall back to current data
    const cached = fullDateRangeRef.current;
    const startDate = cached?.start || data?.dateRange?.start;
    const endDate = cached?.end || data?.dateRange?.end;

    if (!startDate || !endDate) return undefined;

    const start = new Date(startDate);
    const end = new Date(endDate);
    const diffTime = Math.abs(end.getTime() - start.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
  }, [data?.dateRange]);

  // --- CHART DATA TRANSFORMATION ---
  const chartData = useMemo(() => {
    if (!data?.prices || data.prices.length === 0) return [];

    // 1. Comparison Mode: Normalize both to % change starting at 0
    // Using keys 'raw' and 'total' so PriceChart can find them easily
    if (chartMode === "comparison") {
      // Use adjustedStart as the common baseline for BOTH series
      // This ensures dividend impact is calculated correctly (apples-to-apples)
      const adjustedStart = data.dateRange?.adjustedStart || data.prices[0].date;

      // Find the index where adj_close data begins
      const adjStartIndex = data.prices.findIndex(p => p.date >= adjustedStart);

      if (adjStartIndex < 0) {
        // No valid adj_close data - fall back to using close for both
        const startPrice = data.prices[0].close;
        return data.prices.map(p => ({
          date: p.date,
          raw: ((p.close - startPrice) / startPrice) * 100,
          total: ((p.close - startPrice) / startPrice) * 100,
        }));
      }

      // Baseline prices at adjustedStart (where both series begin comparison)
      const baselineClose = data.prices[adjStartIndex].close;
      const baselineAdj = data.prices[adjStartIndex].adj_close ?? data.prices[adjStartIndex].close;

      return data.prices.map((p, i) => {
        if (i < adjStartIndex) {
          // Before adjustedStart: show only Price Return, no Total Return
          // Calculate from the very beginning to show full history
          const earlyStartPrice = data.prices[0].close;
          return {
            date: p.date,
            raw: ((p.close - earlyStartPrice) / earlyStartPrice) * 100,
            total: null,
          };
        } else {
          // From adjustedStart onwards: both lines start at 0% for fair comparison
          const priceReturn = ((p.close - baselineClose) / baselineClose) * 100;
          const totalReturn = (((p.adj_close ?? p.close) - baselineAdj) / baselineAdj) * 100;

          return {
            date: p.date,
            raw: priceReturn,      // Green Line (from adjustedStart = 0%)
            total: totalReturn,    // Blue Line (from adjustedStart = 0%)
          };
        }
      });
    }

    // 2. Standard Modes: Just show the absolute value
    // We map it to 'raw' so the chart draws the main line
    return data.prices.map((p) => ({
      date: p.date,
      raw: chartMode === "total_return" ? (p.adj_close ?? p.close) : p.close,
      total: null // No second line
    }));
  }, [data?.prices, data?.dateRange, chartMode]);

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

  // STD Channel chart data
  const stdChartData = useMemo(() => {
    if (!stdChannelData) return [];

    return stdChannelData.data.map(d => ({
      date: d.date,
      open: d.open ?? d.close,
      high: d.high ?? d.close,
      low: d.low ?? d.close,
      close: d.close!,
      midLine: d.midLine,
      upperBand1: d.upperBand1,
      lowerBand1: d.lowerBand1,
      upperBand2: d.upperBand2,
      lowerBand2: d.lowerBand2,
    }));
  }, [stdChannelData]);

  // Mean reversal analysis for STD Channel
  const meanReversalInfo = useMemo(() => {
    if (!stdChannelData || stdChartData.length === 0) return null;

    const lastBar = stdChartData[stdChartData.length - 1];
    if (!lastBar.midLine || !lastBar.upperBand2 || !lastBar.lowerBand2) return null;

    const sigma = stdChannelData.metadata.sigma;
    const distanceFromMid = lastBar.close - lastBar.midLine;
    const sigmaUnits = distanceFromMid / sigma;

    let position: 'extreme_high' | 'high' | 'neutral' | 'low' | 'extreme_low';
    if (sigmaUnits > 1.8) position = 'extreme_high';
    else if (sigmaUnits > 0.8) position = 'high';
    else if (sigmaUnits < -1.8) position = 'extreme_low';
    else if (sigmaUnits < -0.8) position = 'low';
    else position = 'neutral';

    const distanceToUpper2 = ((lastBar.upperBand2 - lastBar.close) / lastBar.close) * 100;
    const distanceToLower2 = ((lastBar.close - lastBar.lowerBand2) / lastBar.close) * 100;

    return {
      sigmaUnits,
      distanceFromMid,
      distanceToUpper2,
      distanceToLower2,
      position,
      lastClose: lastBar.close,
      midLine: lastBar.midLine,
      upperBand2: lastBar.upperBand2,
      lowerBand2: lastBar.lowerBand2,
    };
  }, [stdChannelData, stdChartData]);


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
        <Link
          href={`/montecarlo/${ticker}`}
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
          Monte Carlo Simulation
        </Link>
      </div>

      {/* View Mode Toggle */}
      <div style={{ marginBottom: 24, display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ fontSize: 13, color: "var(--muted)", letterSpacing: "0.02em", textTransform: "uppercase" }}>
          Analysis Mode
        </span>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => setViewMode("historical")}
            style={{
              padding: "8px 16px",
              borderRadius: 4,
              border: viewMode === "historical" ? "1px solid var(--accent)" : "1px solid var(--card-border)",
              background: viewMode === "historical" ? "var(--accent)" : "var(--card-bg)",
              color: viewMode === "historical" ? "white" : "var(--foreground)",
              fontSize: 13,
              fontWeight: 500,
              cursor: "pointer",
              transition: "all 0.15s",
            }}
          >
            Historical Analysis
          </button>
          <button
            onClick={() => setViewMode("std_channel")}
            style={{
              padding: "8px 16px",
              borderRadius: 4,
              border: viewMode === "std_channel" ? "1px solid #2962ff" : "1px solid var(--card-border)",
              background: viewMode === "std_channel" ? "#2962ff" : "var(--card-bg)",
              color: viewMode === "std_channel" ? "white" : "var(--foreground)",
              fontSize: 13,
              fontWeight: 500,
              cursor: "pointer",
              transition: "all 0.15s",
            }}
          >
            STD Channel Analysis
          </button>
        </div>
      </div>

      {/* Timeframe Selector - Only shown in Historical mode */}
      {viewMode === "historical" && (
        <div style={{ marginBottom: 24, display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 13, color: "var(--muted)", letterSpacing: "0.02em", textTransform: "uppercase" }}>
            Timeframe
          </span>
          <TimeframeSelector
            selected={limit}
            onChange={setLimit}
            onDateRangeChange={(start, end) => {
              if (start && end) {
                setCustomDateRange({ start, end });
              } else {
                setCustomDateRange(null);
              }
            }}
            customDateRange={customDateRange}
            availableDataDays={totalAvailableDays}
          />
        </div>
      )}

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

      {/* HISTORICAL ANALYSIS MODE */}
      {!loading && data && activeStats && viewMode === "historical" && (
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
            <button
              onClick={() => setIsPanelOpen(true)}
              style={{
                padding: "8px 16px",
                borderRadius: 4,
                background: "var(--card-bg)",
                border: "1px solid var(--card-border)",
                color: "var(--foreground)",
                fontSize: 13,
                fontWeight: 500,
                cursor: "pointer",
                transition: "all 0.15s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = "var(--foreground)";
                e.currentTarget.style.background = "var(--hover-bg)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = "var(--card-border)";
                e.currentTarget.style.background = "var(--card-bg)";
              }}
            >
              Fundamental Details
            </button>
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
        </>
      )}

      {/* STD CHANNEL ANALYSIS MODE */}
      {!loading && viewMode === "std_channel" && (
        <>
          {stdChannelLoading && (
            <div style={{ padding: 20, borderRadius: 4, border: "1px solid var(--border)", background: "var(--card-bg)", color: "var(--muted)" }}>
              Loading STD channel data...
            </div>
          )}

          {stdChannelError && (
            <div style={{ padding: 20, borderRadius: 4, border: "1px solid var(--danger)", background: "var(--card-bg)" }}>
              <div style={{ fontWeight: 600, color: "var(--danger)", marginBottom: 8 }}>Error</div>
              <div style={{ fontSize: 14, color: "var(--muted)" }}>{stdChannelError}</div>
            </div>
          )}

          {!stdChannelLoading && !stdChannelError && stdChannelData && (
            <>
              {/* Window Optimization Info */}
              <div style={{
                padding: 16,
                borderRadius: 4,
                border: "1px solid var(--card-border)",
                background: "var(--card-bg)",
                marginBottom: 20,
              }}>
                <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8, color: "var(--foreground)" }}>
                  Window Optimization
                </h3>
                <p style={{ fontSize: 12, color: "var(--muted)", marginBottom: 12, lineHeight: 1.6 }}>
                  The optimal window size is automatically selected by maximizing the R² (coefficient of determination) across different lookback periods.
                  This ensures the best linear fit for the regression channel. You can override this by setting a fixed window size or adjusting the search range.
                </p>

                <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                  <div style={{ flex: "0 1 120px" }}>
                    <label style={{ display: "block", fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>Fixed Window</label>
                    <input type="number" value={fixedWindow ?? ""} onChange={(e) => setFixedWindow(e.target.value === "" ? null : parseInt(e.target.value))} placeholder="Auto" min="50" max="3000" style={{ width: "100%", padding: "7px 10px", borderRadius: 4, border: "1px solid var(--input-border)", background: "var(--input-bg)", color: "var(--foreground)", fontSize: 13 }} />
                  </div>

                  <div style={{ flex: "0 1 120px" }}>
                    <label style={{ display: "block", fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>Min Window</label>
                    <input type="number" value={minWindow} onChange={(e) => setMinWindow(parseInt(e.target.value) || 255)} min="50" max="2000" disabled={fixedWindow !== null} style={{ width: "100%", padding: "7px 10px", borderRadius: 4, border: "1px solid var(--input-border)", background: fixedWindow ? "var(--hover-bg)" : "var(--input-bg)", color: fixedWindow ? "var(--muted)" : "var(--foreground)", fontSize: 13 }} />
                  </div>

                  <div style={{ flex: "0 1 120px" }}>
                    <label style={{ display: "block", fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>Max Window</label>
                    <input type="number" value={maxWindow} onChange={(e) => setMaxWindow(parseInt(e.target.value) || 1530)} min="20" max="3000" disabled={fixedWindow !== null} style={{ width: "100%", padding: "7px 10px", borderRadius: 4, border: "1px solid var(--input-border)", background: fixedWindow ? "var(--hover-bg)" : "var(--input-bg)", color: fixedWindow ? "var(--muted)" : "var(--foreground)", fontSize: 13 }} />
                  </div>

                  <div style={{ flex: "0 1 100px" }}>
                    <label style={{ display: "block", fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>Step Size</label>
                    <input type="number" value={step} onChange={(e) => setStep(parseInt(e.target.value) || 20)} min="1" max="100" disabled={fixedWindow !== null} style={{ width: "100%", padding: "7px 10px", borderRadius: 4, border: "1px solid var(--input-border)", background: fixedWindow ? "var(--hover-bg)" : "var(--input-bg)", color: fixedWindow ? "var(--muted)" : "var(--foreground)", fontSize: 13 }} />
                  </div>
                </div>

                {/* Deviation Bands Controls */}
                <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
                  <h4 style={{ fontSize: 12, fontWeight: 600, marginBottom: 12, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    Deviation Bands
                  </h4>

                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, cursor: "pointer", userSelect: "none", color: "var(--foreground)" }}>
                      <input type="checkbox" checked={showDeviation1} onChange={(e) => setShowDeviation1(e.target.checked)} style={{ width: 16, height: 16, cursor: "pointer" }} />
                      <span style={{ flex: 1 }}>±1σ Deviation</span>
                      <input type="number" value={k1} onChange={(e) => setK1(parseFloat(e.target.value) || 1.0)} min="0.1" max="5" step="0.1" disabled={!showDeviation1} style={{ width: "60px", padding: "5px 8px", borderRadius: 4, border: "1px solid var(--input-border)", background: showDeviation1 ? "var(--input-bg)" : "var(--hover-bg)", color: showDeviation1 ? "var(--foreground)" : "var(--muted)", fontSize: 13 }} />
                    </label>

                    <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, cursor: "pointer", userSelect: "none", color: "var(--foreground)" }}>
                      <input type="checkbox" checked={showDeviation2} onChange={(e) => setShowDeviation2(e.target.checked)} style={{ width: 16, height: 16, cursor: "pointer" }} />
                      <span style={{ flex: 1 }}>±2σ Deviation</span>
                      <input type="number" value={k2} onChange={(e) => setK2(parseFloat(e.target.value) || 2.0)} min="0.1" max="5" step="0.1" disabled={!showDeviation2} style={{ width: "60px", padding: "5px 8px", borderRadius: 4, border: "1px solid var(--input-border)", background: showDeviation2 ? "var(--input-bg)" : "var(--hover-bg)", color: showDeviation2 ? "var(--foreground)" : "var(--muted)", fontSize: 13 }} />
                    </label>
                  </div>
                </div>
              </div>

              {/* Channel Statistics */}
              <div style={{
                padding: 20,
                borderRadius: 4,
                border: "1px solid var(--card-border)",
                background: "var(--card-bg)",
                marginBottom: 20,
              }}>
                <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16, color: "var(--foreground)" }}>
                  Channel Statistics
                </h2>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 16 }}>
                  <div>
                    <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>Data Points</div>
                    <div style={{ fontSize: 22, fontWeight: 600, fontFamily: "monospace", color: "var(--foreground)" }}>
                      {stdChannelData.count}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>Window Size</div>
                    <div style={{ fontSize: 22, fontWeight: 600, fontFamily: "monospace", color: "#2962ff" }}>
                      {stdChannelData.metadata.windowSize}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>R² (Fit Quality)</div>
                    <div style={{
                      fontSize: 22,
                      fontWeight: 600,
                      fontFamily: "monospace",
                      color: stdChannelData.metadata.r2 > 0.8 ? "var(--success)"
                        : stdChannelData.metadata.r2 > 0.6 ? "#26a69a"
                        : stdChannelData.metadata.r2 > 0.4 ? "var(--warning)"
                        : "var(--danger)"
                    }}>
                      {stdChannelData.metadata.r2.toFixed(4)}
                    </div>
                    <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 2 }}>
                      {stdChannelData.metadata.r2 > 0.8 ? "Excellent" : stdChannelData.metadata.r2 > 0.6 ? "Good" : stdChannelData.metadata.r2 > 0.4 ? "Moderate" : "Poor"}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>Sigma (σ)</div>
                    <div style={{ fontSize: 22, fontWeight: 600, fontFamily: "monospace", color: "var(--foreground)" }}>
                      {stdChannelData.metadata.sigma.toFixed(2)}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>Slope (Trend)</div>
                    <div style={{
                      fontSize: 22,
                      fontWeight: 600,
                      fontFamily: "monospace",
                      color: stdChannelData.metadata.slope > 0 ? "var(--success)" : "var(--danger)"
                    }}>
                      {stdChannelData.metadata.slope > 0 ? "↑" : "↓"} {Math.abs(stdChannelData.metadata.slope).toFixed(4)}
                    </div>
                    <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 2 }}>
                      {stdChannelData.metadata.slope > 0 ? "Uptrend" : "Downtrend"}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>Correlation (R)</div>
                    <div style={{ fontSize: 22, fontWeight: 600, fontFamily: "monospace", color: "var(--foreground)" }}>
                      {stdChannelData.metadata.r.toFixed(4)}
                    </div>
                  </div>
                </div>
              </div>

              {/* Chart */}
              {stdChartData.length > 0 && (
                <div style={{
                  padding: 20,
                  borderRadius: 4,
                  border: "1px solid var(--card-border)",
                  background: "var(--card-bg)",
                  marginBottom: 20,
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                    <h2 style={{ fontSize: 16, fontWeight: 600, color: "var(--foreground)" }}>
                      {ticker} - Price Chart with STD Channels
                    </h2>
                    <div style={{ fontSize: 12, color: "var(--muted)", fontFamily: "monospace" }}>
                      Showing {stdChartData.length} bars | Window: {stdChannelData.metadata.windowSize} | k1={k1}, k2={k2}
                    </div>
                  </div>
                  <CandlestickChart
                    data={stdChartData}
                    height={600}
                    showStdChannel={true}
                    showDeviation1={showDeviation1}
                    showDeviation2={showDeviation2}
                    stdChannelColor="#2962ff"
                  />
                </div>
              )}

              {/* Position Analysis */}
              {meanReversalInfo && (
                <div style={{
                  padding: 20,
                  borderRadius: 4,
                  border: "1px solid var(--card-border)",
                  background: "var(--card-bg)",
                  marginBottom: 20,
                }}>
                  <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16, color: "var(--foreground)" }}>
                    Position Analysis
                  </h2>

                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 16, marginBottom: 16 }}>
                    <div>
                      <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>Current Price</div>
                      <div style={{ fontSize: 20, fontWeight: 600, fontFamily: "monospace", color: "var(--foreground)" }}>
                        {meanReversalInfo.lastClose.toFixed(2)}
                      </div>
                    </div>

                    <div>
                      <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>Distance from Regression Line</div>
                      <div style={{
                        fontSize: 20,
                        fontWeight: 600,
                        fontFamily: "monospace",
                        color: meanReversalInfo.sigmaUnits > 0 ? "var(--success)" : "var(--danger)"
                      }}>
                        {meanReversalInfo.sigmaUnits > 0 ? "+" : ""}{meanReversalInfo.sigmaUnits.toFixed(2)}σ
                      </div>
                      <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
                        {meanReversalInfo.distanceFromMid > 0 ? "+" : ""}{meanReversalInfo.distanceFromMid.toFixed(2)} pts
                      </div>
                    </div>

                    <div>
                      <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>Position Classification</div>
                      <div style={{
                        fontSize: 16,
                        fontWeight: 600,
                        color: meanReversalInfo.position === 'extreme_high' || meanReversalInfo.position === 'extreme_low' ? "var(--danger)"
                          : meanReversalInfo.position === 'high' || meanReversalInfo.position === 'low' ? "var(--warning)"
                          : "var(--muted)"
                      }}>
                        {meanReversalInfo.position === 'extreme_high' ? "Extreme High"
                          : meanReversalInfo.position === 'extreme_low' ? "Extreme Low"
                          : meanReversalInfo.position === 'high' ? "Elevated"
                          : meanReversalInfo.position === 'low' ? "Depressed"
                          : "Within Range"}
                      </div>
                    </div>

                    <div>
                      <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>
                        Distance to {meanReversalInfo.sigmaUnits > 0 ? "Upper" : "Lower"} Band (±2σ)
                      </div>
                      <div style={{ fontSize: 16, fontWeight: 600, fontFamily: "monospace", color: "var(--foreground)" }}>
                        {meanReversalInfo.sigmaUnits > 0
                          ? `${meanReversalInfo.distanceToUpper2.toFixed(2)}%`
                          : `${meanReversalInfo.distanceToLower2.toFixed(2)}%`
                        }
                      </div>
                      <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
                        Level: {meanReversalInfo.sigmaUnits > 0
                          ? meanReversalInfo.upperBand2.toFixed(2)
                          : meanReversalInfo.lowerBand2.toFixed(2)
                        }
                      </div>
                    </div>
                  </div>

                  <div style={{
                    padding: 14,
                    borderRadius: 4,
                    background: "var(--hover-bg)",
                    border: "1px solid var(--border)",
                  }}>
                    <div style={{ fontSize: 12, color: "var(--foreground)", lineHeight: 1.6 }}>
                      <strong style={{ color: "var(--muted)" }}>Analysis:</strong>{" "}
                      {meanReversalInfo.position === 'extreme_high' || meanReversalInfo.position === 'extreme_low' ? (
                        <>
                          Price is currently {Math.abs(meanReversalInfo.sigmaUnits).toFixed(1)}σ {meanReversalInfo.sigmaUnits > 0 ? "above" : "below"} the regression line,
                          indicating an extended move. Historical patterns suggest increased probability of mean reversion.
                          The midline at {meanReversalInfo.midLine.toFixed(2)} represents the statistical mean for this period.
                        </>
                      ) : meanReversalInfo.position === 'high' || meanReversalInfo.position === 'low' ? (
                        <>
                          Price is moderately {meanReversalInfo.sigmaUnits > 0 ? "elevated" : "depressed"} at {Math.abs(meanReversalInfo.sigmaUnits).toFixed(1)}σ
                          from the regression line. Monitor for potential continuation or reversal signals.
                        </>
                      ) : (
                        <>
                          Price is trading within normal range (±0.8σ) of the regression line. Current position suggests
                          trend continuation is more likely than mean reversion.
                        </>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Methodology (Collapsible) */}
              <div style={{
                padding: 20,
                borderRadius: 4,
                border: "1px solid var(--card-border)",
                background: "var(--card-bg)",
              }}>
                <div
                  onClick={() => setShowMethodology(!showMethodology)}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    cursor: "pointer",
                    userSelect: "none",
                  }}
                >
                  <h3 style={{ fontSize: 14, fontWeight: 600, color: "var(--foreground)" }}>
                    Methodology & Interpretation
                  </h3>
                  <span style={{ fontSize: 18, color: "var(--muted)" }}>
                    {showMethodology ? "−" : "+"}
                  </span>
                </div>

                {showMethodology && (
                  <div style={{ marginTop: 16, fontSize: 13, lineHeight: 1.7, color: "var(--foreground)" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                      <div>
                        <h4 style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: "var(--muted)" }}>Core Features:</h4>
                        <ul style={{ margin: 0, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 6, color: "var(--foreground)" }}>
                          <li><strong>Automatic Window Optimization:</strong> Identifies optimal lookback period (255-1530 bars) by maximizing R²</li>
                          <li><strong>Fixed Window Analysis:</strong> Manual window size selection for specific time periods</li>
                          <li><strong>Preset Time Ranges:</strong> Predefined configurations for short, medium, and long-term analysis</li>
                          <li><strong>Position Analysis:</strong> Statistical classification of price position relative to regression channel</li>
                        </ul>
                      </div>
                      <div>
                        <h4 style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: "var(--muted)" }}>Position Classifications:</h4>
                        <ul style={{ margin: 0, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 6, color: "var(--foreground)" }}>
                          <li><strong>Extreme High/Low:</strong> Price exceeds ±1.8σ - Elevated mean reversion probability</li>
                          <li><strong>Elevated/Depressed:</strong> Price between ±0.8σ and ±1.8σ - Moderate deviation range</li>
                          <li><strong>Within Range:</strong> Price within ±0.8σ - Normal statistical range</li>
                          <li><strong>R² Interpretation:</strong> Values &gt; 0.7 indicate strong linear trend and reliable channel structure</li>
                        </ul>
                      </div>
                    </div>
                    <div style={{ marginTop: 16, padding: 12, borderRadius: 4, background: "var(--hover-bg)", border: "1px solid var(--border)" }}>
                      <div style={{ fontSize: 11, color: "var(--muted)" }}>
                        <strong>Note:</strong> The standard deviation channel uses linear regression to identify the trend and statistical boundaries.
                        Higher R² values indicate better linear fit and more reliable mean reversion characteristics. Position analysis considers both
                        the distance from the regression line (in sigma units) and proximity to the outer bands. This tool is intended for analysis purposes
                        and should be used in conjunction with other technical and fundamental analysis methods.
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </>
      )}

      {/* SHARED ANALYSIS SECTIONS - Visible in both modes */}
      {!loading && data && activeReturns && (
        <>
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

      <StockFundamentalsPanel
        ticker={ticker}
        isOpen={isPanelOpen}
        onClose={() => setIsPanelOpen(false)}
      />
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