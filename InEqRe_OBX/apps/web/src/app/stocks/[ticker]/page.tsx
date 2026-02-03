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
import { LiquidityBadge } from "@/components/LiquidityBadge";

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
    return clampInt(searchParams.get("limit"), 1260, 20, 15000); // Default to 5Y (1260 trading days), max 15000 (~60 years)
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

  // Stock metadata for ML predictions eligibility
  const [totalRows, setTotalRows] = useState<number>(0);
  const [stockMetaLoading, setStockMetaLoading] = useState<boolean>(true);
  const [hasFactorData, setHasFactorData] = useState<boolean>(false);

  // Filter and sort state for Daily Returns table
  const [returnFilter, setReturnFilter] = useState<"all" | "positive" | "negative" | "large_positive" | "large_negative" | "custom">("all");
  const [customFilterThreshold, setCustomFilterThreshold] = useState<number>(5);
  const [sortColumn, setSortColumn] = useState<"date" | "close" | "adj_close" | "return" | "cumulative">("date");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");

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

  // Fetch stock metadata and check if factor data exists
  useEffect(() => {
    let cancelled = false;

    async function fetchStockMeta() {
      if (!ticker) {
        setStockMetaLoading(false);
        setTotalRows(0);
        setHasFactorData(false);
        return;
      }

      setStockMetaLoading(true);

      try {
        // Check if factor data exists for this ticker
        const factorRes = await fetch(`/api/factors/${ticker}?type=technical&limit=1`, {
          method: "GET",
          headers: { accept: "application/json" },
          cache: "no-store",
        });

        const factorExists = factorRes.ok && (await factorRes.json()).count > 0;

        // Get stock metadata
        const res = await fetch(`/api/stocks`, {
          method: "GET",
          headers: { accept: "application/json" },
          cache: "no-store",
        });

        if (!res.ok) {
          console.warn("Failed to fetch stock metadata");
          setTotalRows(0);
          setHasFactorData(false);
          return;
        }

        const stocks = await res.json();
        const stock = stocks.find((s: any) => s.ticker === ticker);

        if (!cancelled) {
          setTotalRows(stock?.rows || 0);
          setHasFactorData(factorExists);
        }
      } catch (e) {
        console.warn("Error fetching stock metadata:", e);
        if (!cancelled) {
          setTotalRows(0);
          setHasFactorData(false);
        }
      } finally {
        if (!cancelled) {
          setStockMetaLoading(false);
        }
      }
    }

    fetchStockMeta();
    return () => {
      cancelled = true;
    };
  }, [ticker]);

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
    let filtered = activeReturns.filter(r => {
      const date = r.date;
      if (returnsStartDate && date < returnsStartDate) return false;
      if (returnsEndDate && date > returnsEndDate) return false;
      return true;
    });

    // Apply return filter
    if (returnFilter === "positive") {
      filtered = filtered.filter(r => r.return > 0);
    } else if (returnFilter === "negative") {
      filtered = filtered.filter(r => r.return < 0);
    } else if (returnFilter === "large_positive") {
      filtered = filtered.filter(r => r.return > 0.05); // > 5%
    } else if (returnFilter === "large_negative") {
      filtered = filtered.filter(r => r.return < -0.05); // < -5%
    } else if (returnFilter === "custom") {
      const threshold = customFilterThreshold / 100;
      filtered = filtered.filter(r => Math.abs(r.return) >= threshold);
    }

    return filtered;
  }, [activeReturns, returnsStartDate, returnsEndDate, returnFilter, customFilterThreshold]);

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

  // Sorted and filtered returns for table display
  const sortedReturns = useMemo(() => {
    const reversed = filteredReturns.slice().reverse(); // Newest first by default

    // Calculate cumulative returns for sorting
    const withCumulative = reversed.map((r, idx, arr) => {
      const cumulativeReturn = arr.slice(idx).reduce((cum, ret) => cum * (1 + ret.return), 1) - 1;
      const priceData = priceMap[r.date] || { close: 0, adj_close: 0 };
      return {
        ...r,
        cumulative: cumulativeReturn,
        close: priceData.close,
        adj_close: priceData.adj_close ?? priceData.close,
      };
    });

    // Sort by selected column
    withCumulative.sort((a, b) => {
      let aVal: number | string = 0;
      let bVal: number | string = 0;

      switch (sortColumn) {
        case "date":
          aVal = a.date;
          bVal = b.date;
          break;
        case "close":
          aVal = a.close;
          bVal = b.close;
          break;
        case "adj_close":
          aVal = a.adj_close;
          bVal = b.adj_close;
          break;
        case "return":
          aVal = a.return;
          bVal = b.return;
          break;
        case "cumulative":
          aVal = a.cumulative;
          bVal = b.cumulative;
          break;
      }

      if (typeof aVal === "string" && typeof bVal === "string") {
        return sortDirection === "asc" ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      } else {
        const numA = typeof aVal === "number" ? aVal : 0;
        const numB = typeof bVal === "number" ? bVal : 0;
        return sortDirection === "asc" ? numA - numB : numB - numA;
      }
    });

    return withCumulative;
  }, [filteredReturns, priceMap, sortColumn, sortDirection]);

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
    // When "All" is selected, just clear the date filters to show everything
    if (preset === "All") {
      setLimit(15000); // Set to max limit to fetch all data
      // Clear date filters to show all data
      setReturnsStartDate("");
      setReturnsEndDate("");
      return;
    }

    if (!activeReturns || activeReturns.length === 0) return;
    const endDate = activeReturns[activeReturns.length - 1].date;
    let startIdx = 0;

    switch (preset) {
      case "1M": startIdx = Math.max(0, activeReturns.length - 21); break;
      case "3M": startIdx = Math.max(0, activeReturns.length - 63); break;
      case "6M": startIdx = Math.max(0, activeReturns.length - 126); break;
      case "1Y": startIdx = Math.max(0, activeReturns.length - 252); break;
      case "3Y": startIdx = Math.max(0, activeReturns.length - 756); break;
      case "5Y": startIdx = Math.max(0, activeReturns.length - 1260); break;
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
      {/* Header Section */}
      <div style={{ marginBottom: 24 }}>
        {/* Terminal-style Header */}
      <div
        style={{
          padding: "10px 12px",
          background: "var(--terminal-bg)",
          border: "1px solid var(--terminal-border)",
          borderRadius: 2,
          marginBottom: 16,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <h1 style={{ fontSize: 18, fontWeight: 700, margin: 0, fontFamily: "monospace", color: "var(--foreground)" }}>
              {ticker || "?"}
            </h1>
            {ticker && <LiquidityBadge ticker={ticker} />}
          </div>
          <Link
            href="/stocks"
            style={{
              fontSize: 10,
              color: "var(--accent)",
              textDecoration: "none",
              fontFamily: "monospace",
              fontWeight: 600,
              padding: "4px 10px",
              border: "1px solid var(--border)",
              borderRadius: 2,
              background: "var(--input-bg)",
            }}
          >
            ← BACK TO ASSET LIST
          </Link>
        </div>

        {/* Navigation Links */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Link
            href={`/volatility/${ticker}`}
            style={{
              padding: "6px 10px",
              borderRadius: 2,
              background: "var(--card-bg)",
              border: "1px solid var(--border)",
              color: "var(--foreground)",
              fontSize: 10,
              fontWeight: 600,
              textDecoration: "none",
              fontFamily: "monospace",
              transition: "all 0.15s",
            }}
          >
            VOLATILITY ANALYSIS
          </Link>
          <Link
            href={`/montecarlo/${ticker}`}
            style={{
              padding: "6px 10px",
              borderRadius: 2,
              background: "var(--card-bg)",
              border: "1px solid var(--border)",
              color: "var(--foreground)",
              fontSize: 10,
              fontWeight: 600,
              textDecoration: "none",
              fontFamily: "monospace",
              transition: "all 0.15s",
            }}
          >
            MONTE CARLO SIMULATION
          </Link>
          {totalRows >= 756 && hasFactorData && (
            <Link
              href={`/predictions/${ticker}`}
              style={{
                padding: "6px 10px",
                borderRadius: 2,
                background: "var(--card-bg)",
                border: "1px solid var(--border)",
                color: "var(--foreground)",
                fontSize: 10,
                fontWeight: 600,
                textDecoration: "none",
                fontFamily: "monospace",
                transition: "all 0.15s",
              }}
            >
              ML PREDICTIONS
            </Link>
          )}
        </div>
      </div>
      </div>

      {/* View Mode Toggle */}
      <div style={{ marginBottom: 24, display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ fontSize: 13, color: "var(--muted)", letterSpacing: "0.02em", textTransform: "uppercase" }}>
          Analysis Mode
        </span>
        <div style={{
          display: "inline-flex",
          border: "1px solid var(--border)",
          borderRadius: 6,
          background: "var(--card-bg)",
          padding: 2,
        }}>
          <button
            onClick={() => setViewMode("historical")}
            style={{
              padding: "9px 16px",
              borderRadius: 4,
              border: "none",
              background: viewMode === "historical" ? "var(--accent)" : "transparent",
              color: viewMode === "historical" ? "white" : "var(--foreground)",
              fontSize: 13,
              fontWeight: 500,
              cursor: "pointer",
              transition: "all 0.2s",
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-start",
              gap: 3,
            }}
          >
            <span>Historical Analysis</span>
            <span style={{ fontSize: 10, opacity: 0.7, fontWeight: 400 }}>
              Returns • Drawdowns • Beta
            </span>
          </button>
          <button
            onClick={() => setViewMode("std_channel")}
            style={{
              padding: "9px 16px",
              borderRadius: 4,
              border: "none",
              background: viewMode === "std_channel" ? "#2962ff" : "transparent",
              color: viewMode === "std_channel" ? "white" : "var(--foreground)",
              fontSize: 13,
              fontWeight: 500,
              cursor: "pointer",
              transition: "all 0.2s",
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-start",
              gap: 3,
            }}
          >
            <span>STD Channel Analysis</span>
            <span style={{ fontSize: 10, opacity: 0.7, fontWeight: 400 }}>
              Regression • Bands • Mean reversion
            </span>
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
                e.currentTarget.style.borderColor = "var(--accent)";
                e.currentTarget.style.background = "var(--hover-bg)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = "var(--card-border)";
                e.currentTarget.style.background = "var(--card-bg)";
              }}
          onMouseDown={(e) => {
            e.currentTarget.style.transform = "scale(0.95)";
          }}
          onMouseUp={(e) => {
            e.currentTarget.style.transform = "scale(1)";
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

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 16, marginBottom: 28 }}>
            <MetricCard
              label="Total Return"
              value={fmtPct(activeStats.totalReturn)}
              colorType={activeStats.totalReturn >= 0 ? "success" : "danger"}
              subtitle={(() => {
                // Calculate actual time period from date range
                const startDate = data?.dateRange?.start;
                const endDate = data?.dateRange?.end;
                if (!startDate || !endDate) return "";

                const start = new Date(startDate);
                const end = new Date(endDate);
                const days = Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
                const years = days / 365.25;

                if (years < 1) {
                  const months = Math.round(years * 12);
                  return `Over ${months} month${months !== 1 ? 's' : ''}`;
                }

                // Calculate CAGR (Compound Annual Growth Rate)
                const cagr = ((Math.pow(1 + activeStats.totalReturn / 100, 1 / years) - 1) * 100);
                return `${fmtPct(cagr)} CAGR (${years.toFixed(1)}y)`;
              })()}
            />
            <MetricCard
              label="Volatility (Ann.)"
              value={fmtPct(activeStats.volatility)}
              subtitle={(() => {
                // Convert to daily volatility for context
                const dailyVol = activeStats.volatility / Math.sqrt(252);
                return `${fmtPct(dailyVol)} daily · ${(dailyVol * 100).toFixed(2)}% avg daily swing`;
              })()}
            />
            <MetricCard
              label="Max Drawdown"
              value={fmtPct(activeStats.maxDrawdown)}
              colorType="danger"
              subtitle={(() => {
                // Find when the max drawdown occurred
                const drawdownPoint = activeDrawdown.reduce((min, curr) =>
                  curr.drawdown < min.drawdown ? curr : min,
                  activeDrawdown[0] || { drawdown: 0, date: "" }
                );
                if (!drawdownPoint?.date) return "Peak-to-trough decline";
                const year = new Date(drawdownPoint.date).getFullYear();
                return `Lowest point in ${year}`;
              })()}
            />
            <div style={{ padding: 14, borderRadius: 3, border: "1px solid var(--card-border)", background: "var(--card-bg)" }}>
              <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", marginBottom: 8 }}>
                Risk Metrics (95%)
              </div>
              <div style={{ display: "flex", gap: 16, alignItems: "baseline" }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 9, color: "var(--muted-foreground)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.05em" }}>VaR</div>
                  <div style={{ fontSize: 22, fontWeight: 600, fontFamily: "monospace", color: "var(--foreground)" }}>
                    {fmtPct(activeStats.var95)}
                  </div>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 9, color: "var(--muted-foreground)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.05em" }}>CVaR</div>
                  <div style={{ fontSize: 22, fontWeight: 600, fontFamily: "monospace", color: "var(--foreground)" }}>
                    {fmtPct(activeStats.cvar95)}
                  </div>
                </div>
              </div>
              <div style={{ fontSize: 10, color: "var(--muted-foreground)", marginTop: 8, lineHeight: 1.4 }}>
                5% chance of losing {fmtPct(Math.abs(activeStats.var95))} or more
              </div>
            </div>
            <MetricCard
              label="Sharpe Ratio"
              value={fmtNum(activeStats.sharpeRatio, 3)}
              subtitle={(() => {
                // Show return per unit of risk
                const returnPerRisk = activeStats.sharpeRatio * activeStats.volatility;
                return `${fmtPct(returnPerRisk)} excess return/year`;
              })()}
            />
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

                <div style={{ display: "flex", gap: 24, alignItems: "flex-start" }}>
                  {/* Window Controls */}
                  <div style={{ flex: 1, display: "flex", gap: 16, flexWrap: "wrap" }}>
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
                  <div style={{ flex: "0 0 auto", minWidth: "220px", paddingLeft: 24, borderLeft: "1px solid var(--border)" }}>
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
                    <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>Data Points</div>
                    <div style={{ fontSize: 22, fontWeight: 600, fontFamily: "monospace", color: "var(--foreground)" }}>
                      {stdChannelData.count}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>Window Size</div>
                    <div style={{ fontSize: 22, fontWeight: 600, fontFamily: "monospace", color: "var(--accent)" }}>
                      {stdChannelData.metadata.windowSize}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>R² (Fit Quality)</div>
                    <div style={{
                      fontSize: 22,
                      fontWeight: 600,
                      fontFamily: "monospace",
                      color: stdChannelData.metadata.r2 > 0.8 ? "var(--success)"
                        : stdChannelData.metadata.r2 > 0.6 ? "var(--success)"
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
                    <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>Slope (Trend)</div>
                    <div style={{
                      fontSize: 22,
                      fontWeight: 600,
                      fontFamily: "monospace",
                      color: stdChannelData.metadata.slope > 0 ? "var(--success)" : "var(--danger)"
                    }}>
                      {stdChannelData.metadata.slope > 0 ? "+" : ""}{stdChannelData.metadata.slope.toFixed(4)}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
                      {stdChannelData.metadata.slope > 0 ? "Uptrend" : "Downtrend"}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>Correlation (R)</div>
                    <div style={{ fontSize: 22, fontWeight: 600, fontFamily: "monospace", color: "var(--foreground)" }}>
                      {stdChannelData.metadata.r.toFixed(4)}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2, lineHeight: 1.4 }}>
                      Strength of linear trend
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
                      <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>Current Price</div>
                      <div style={{ fontSize: 20, fontWeight: 600, fontFamily: "monospace", color: "var(--foreground)" }}>
                        {meanReversalInfo.lastClose.toFixed(2)}
                      </div>
                    </div>

                    <div>
                      <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>Distance from Regression Line</div>
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
                      <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>Position Classification</div>
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
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
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

                    <div style={{ borderTop: "1px solid var(--border)", paddingTop: 16 }}>
                      <h4 style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: "var(--muted)" }}>Statistical Metrics:</h4>
                      <ul style={{ margin: 0, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 6, color: "var(--foreground)" }}>
                        <li>
                          <strong>R² (Fit Quality):</strong> Measures how well the linear regression fits the price data.
                          Values range from 0 (no fit) to 1 (perfect fit). Higher R² means the trend line better explains price movements,
                          making channel boundaries more reliable for analysis.
                        </li>
                        <li>
                          <strong>Correlation (R):</strong> Strength of linear relationship between time and price.
                          Values closer to +1 or −1 indicate stronger directional trends. Values near 0 suggest sideways or non-linear movement.
                        </li>
                        <li>
                          <strong>±1σ and ±2σ Bands:</strong> Statistical deviation bands around the trend line.
                          ±1σ typically contains ~68% of price movements (closer bands), while ±2σ contains ~95% (wider bands).
                          Prices touching outer bands suggest potential mean reversion opportunities.
                        </li>
                      </ul>
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
              with cumulative return calculated from the oldest date in the selected range. Win rate, skewness, and kurtosis reveal return distribution characteristics.
            </p>

            {/* Date Controls */}
            <div style={{ marginBottom: 16, display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                {["1M", "3M", "6M", "1Y", "3Y", "5Y", "All"].map(preset => (
                  <button
                    key={preset}
                    onClick={() => handleDateRangePreset(preset)}
                    style={{
                      padding: "6px 12px",
                      borderRadius: 3,
                      border: "1px solid var(--input-border)",
                      background: "var(--input-bg)",
                      color: "var(--foreground)",
                      fontSize: 12,
                      cursor: "pointer",
                      fontWeight: 500,
                      transition: "all 0.15s ease",
                      transform: "scale(1)"
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = "var(--hover-bg)";
                      e.currentTarget.style.borderColor = "var(--accent)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = "var(--input-bg)";
                      e.currentTarget.style.borderColor = "var(--input-border)";
                    }}
                    onMouseDown={(e) => {
                      e.currentTarget.style.transform = "scale(0.95)";
                    }}
                    onMouseUp={(e) => {
                      e.currentTarget.style.transform = "scale(1)";
                    }}
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

            {/* Filter Controls */}
            <div style={{ marginBottom: 24, padding: 14, borderRadius: 4, border: "1px solid var(--border-subtle)", background: "var(--hover-bg)" }}>
              <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", marginBottom: 10, fontWeight: 600 }}>Filter Returns</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                <button
                  onClick={() => setReturnFilter("all")}
                  style={{
                    padding: "6px 12px",
                    borderRadius: 3,
                    border: "1px solid var(--input-border)",
                    background: returnFilter === "all" ? "var(--accent)" : "var(--input-bg)",
                    color: returnFilter === "all" ? "white" : "var(--foreground)",
                    fontSize: 12,
                    cursor: "pointer",
                    fontWeight: 500,
                    transition: "all 0.15s ease",
                    transform: "scale(1)",
                    boxShadow: returnFilter === "all" ? "0 2px 4px rgba(0,0,0,0.1)" : "none"
                  }}
                  onMouseEnter={(e) => {
                    if (returnFilter === "all") {
                      e.currentTarget.style.filter = "brightness(0.9)";
                    } else {
                      e.currentTarget.style.background = "var(--hover-bg)";
                      e.currentTarget.style.borderColor = "var(--accent)";
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (returnFilter === "all") {
                      e.currentTarget.style.filter = "brightness(1)";
                    } else {
                      e.currentTarget.style.background = "var(--input-bg)";
                      e.currentTarget.style.borderColor = "var(--input-border)";
                    }
                  }}
                  onMouseDown={(e) => {
                    e.currentTarget.style.transform = "scale(0.95)";
                  }}
                  onMouseUp={(e) => {
                    e.currentTarget.style.transform = "scale(1)";
                  }}
                >
                  All Days
                </button>
                <button
                  onClick={() => setReturnFilter("positive")}
                  style={{
                    padding: "6px 12px",
                    borderRadius: 3,
                    border: "1px solid var(--input-border)",
                    background: returnFilter === "positive" ? "var(--success)" : "var(--input-bg)",
                    color: returnFilter === "positive" ? "white" : "var(--foreground)",
                    fontSize: 12,
                    cursor: "pointer",
                    fontWeight: 500,
                    transition: "all 0.15s ease",
                    transform: "scale(1)",
                    boxShadow: returnFilter === "positive" ? "0 2px 4px rgba(0,0,0,0.1)" : "none"
                  }}
                  onMouseEnter={(e) => {
                    if (returnFilter === "positive") {
                      e.currentTarget.style.filter = "brightness(0.9)";
                    } else {
                      e.currentTarget.style.background = "var(--hover-bg)";
                      e.currentTarget.style.borderColor = "var(--success)";
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (returnFilter === "positive") {
                      e.currentTarget.style.filter = "brightness(1)";
                    } else {
                      e.currentTarget.style.background = "var(--input-bg)";
                      e.currentTarget.style.borderColor = "var(--input-border)";
                    }
                  }}
                  onMouseDown={(e) => {
                    e.currentTarget.style.transform = "scale(0.95)";
                  }}
                  onMouseUp={(e) => {
                    e.currentTarget.style.transform = "scale(1)";
                  }}
                >
                  Positive Only
                </button>
                <button
                  onClick={() => setReturnFilter("negative")}
                  style={{
                    padding: "6px 12px",
                    borderRadius: 3,
                    border: "1px solid var(--input-border)",
                    background: returnFilter === "negative" ? "var(--danger)" : "var(--input-bg)",
                    color: returnFilter === "negative" ? "white" : "var(--foreground)",
                    fontSize: 12,
                    cursor: "pointer",
                    fontWeight: 500,
                    transition: "all 0.15s ease",
                    transform: "scale(1)",
                    boxShadow: returnFilter === "negative" ? "0 2px 4px rgba(0,0,0,0.1)" : "none"
                  }}
                  onMouseEnter={(e) => {
                    if (returnFilter === "negative") {
                      e.currentTarget.style.filter = "brightness(0.9)";
                    } else {
                      e.currentTarget.style.background = "var(--hover-bg)";
                      e.currentTarget.style.borderColor = "var(--danger)";
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (returnFilter === "negative") {
                      e.currentTarget.style.filter = "brightness(1)";
                    } else {
                      e.currentTarget.style.background = "var(--input-bg)";
                      e.currentTarget.style.borderColor = "var(--input-border)";
                    }
                  }}
                  onMouseDown={(e) => {
                    e.currentTarget.style.transform = "scale(0.95)";
                  }}
                  onMouseUp={(e) => {
                    e.currentTarget.style.transform = "scale(1)";
                  }}
                >
                  Negative Only
                </button>
                <button
                  onClick={() => setReturnFilter("large_positive")}
                  style={{
                    padding: "6px 12px",
                    borderRadius: 3,
                    border: "1px solid var(--input-border)",
                    background: returnFilter === "large_positive" ? "var(--success)" : "var(--input-bg)",
                    color: returnFilter === "large_positive" ? "white" : "var(--foreground)",
                    fontSize: 12,
                    cursor: "pointer",
                    fontWeight: 500,
                    transition: "all 0.15s ease",
                    transform: "scale(1)",
                    boxShadow: returnFilter === "large_positive" ? "0 2px 4px rgba(0,0,0,0.1)" : "none"
                  }}
                  onMouseEnter={(e) => {
                    if (returnFilter === "large_positive") {
                      e.currentTarget.style.filter = "brightness(0.9)";
                    } else {
                      e.currentTarget.style.background = "var(--hover-bg)";
                      e.currentTarget.style.borderColor = "var(--success)";
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (returnFilter === "large_positive") {
                      e.currentTarget.style.filter = "brightness(1)";
                    } else {
                      e.currentTarget.style.background = "var(--input-bg)";
                      e.currentTarget.style.borderColor = "var(--input-border)";
                    }
                  }}
                  onMouseDown={(e) => {
                    e.currentTarget.style.transform = "scale(0.95)";
                  }}
                  onMouseUp={(e) => {
                    e.currentTarget.style.transform = "scale(1)";
                  }}
                >
                  &gt; +5%
                </button>
                <button
                  onClick={() => setReturnFilter("large_negative")}
                  style={{
                    padding: "6px 12px",
                    borderRadius: 3,
                    border: "1px solid var(--input-border)",
                    background: returnFilter === "large_negative" ? "var(--danger)" : "var(--input-bg)",
                    color: returnFilter === "large_negative" ? "white" : "var(--foreground)",
                    fontSize: 12,
                    cursor: "pointer",
                    fontWeight: 500,
                    transition: "all 0.15s ease",
                    transform: "scale(1)",
                    boxShadow: returnFilter === "large_negative" ? "0 2px 4px rgba(0,0,0,0.1)" : "none"
                  }}
                  onMouseEnter={(e) => {
                    if (returnFilter === "large_negative") {
                      e.currentTarget.style.filter = "brightness(0.9)";
                    } else {
                      e.currentTarget.style.background = "var(--hover-bg)";
                      e.currentTarget.style.borderColor = "var(--danger)";
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (returnFilter === "large_negative") {
                      e.currentTarget.style.filter = "brightness(1)";
                    } else {
                      e.currentTarget.style.background = "var(--input-bg)";
                      e.currentTarget.style.borderColor = "var(--input-border)";
                    }
                  }}
                  onMouseDown={(e) => {
                    e.currentTarget.style.transform = "scale(0.95)";
                  }}
                  onMouseUp={(e) => {
                    e.currentTarget.style.transform = "scale(1)";
                  }}
                >
                  &lt; -5%
                </button>
                <button
                  onClick={() => setReturnFilter("custom")}
                  style={{
                    padding: "6px 12px",
                    borderRadius: 3,
                    border: "1px solid var(--input-border)",
                    background: returnFilter === "custom" ? "var(--accent)" : "var(--input-bg)",
                    color: returnFilter === "custom" ? "white" : "var(--foreground)",
                    fontSize: 12,
                    cursor: "pointer",
                    fontWeight: 500,
                    transition: "all 0.15s ease",
                    transform: "scale(1)",
                    boxShadow: returnFilter === "custom" ? "0 2px 4px rgba(0,0,0,0.1)" : "none"
                  }}
                  onMouseEnter={(e) => {
                    if (returnFilter === "custom") {
                      e.currentTarget.style.filter = "brightness(0.9)";
                    } else {
                      e.currentTarget.style.background = "var(--hover-bg)";
                      e.currentTarget.style.borderColor = "var(--accent)";
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (returnFilter === "custom") {
                      e.currentTarget.style.filter = "brightness(1)";
                    } else {
                      e.currentTarget.style.background = "var(--input-bg)";
                      e.currentTarget.style.borderColor = "var(--input-border)";
                    }
                  }}
                  onMouseDown={(e) => {
                    e.currentTarget.style.transform = "scale(0.95)";
                  }}
                  onMouseUp={(e) => {
                    e.currentTarget.style.transform = "scale(1)";
                  }}
                >
                  Custom
                </button>
                {returnFilter === "custom" && (
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <span style={{ fontSize: 12, color: "var(--muted)" }}>|±| ≥</span>
                    <input
                      type="number"
                      value={customFilterThreshold}
                      onChange={(e) => setCustomFilterThreshold(parseFloat(e.target.value) || 0)}
                      min="0"
                      max="100"
                      step="0.5"
                      style={{
                        width: "60px",
                        padding: "6px 8px",
                        borderRadius: 3,
                        border: "1px solid var(--input-border)",
                        background: "var(--input-bg)",
                        color: "var(--foreground)",
                        fontSize: 12
                      }}
                    />
                    <span style={{ fontSize: 12, color: "var(--muted)" }}>%</span>
                  </div>
                )}
              </div>
            </div>

            {returnStats && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 16, marginBottom: 24, padding: 16, borderRadius: 3, border: "1px solid var(--border-subtle)", background: "var(--card-bg)" }}>
                <StatItem label="Win Rate" value={`${returnStats.winRate.toFixed(1)}%`} />
                <StatItem label="Avg Gain" value={fmtPct(returnStats.avgGain, 3)} colorType="success" />
                <StatItem label="Avg Loss" value={fmtPct(returnStats.avgLoss, 3)} colorType="danger" />
                <StatItem label="Best Day" value={fmtPct(returnStats.bestDay, 3)} colorType="success" />
                <StatItem label="Worst Day" value={fmtPct(returnStats.worstDay, 3)} colorType="danger" />
                <StatItem
                  label="Green Days"
                  value={`${returnStats.positiveDays} (${((returnStats.positiveDays / returnStats.totalDays) * 100).toFixed(1)}%)`}
                  colorType="success"
                />
                <StatItem
                  label="Red Days"
                  value={`${returnStats.negativeDays} (${((returnStats.negativeDays / returnStats.totalDays) * 100).toFixed(1)}%)`}
                  colorType="danger"
                />
              </div>
            )}

            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr>
                    {[
                      { key: "date" as const, label: "Date", align: "left" },
                      { key: "close" as const, label: "Close", align: "right" },
                      { key: "adj_close" as const, label: "Adj Close", align: "right" },
                      { key: "return" as const, label: "Daily Return", align: "right" },
                      { key: "cumulative" as const, label: "Cumulative", align: "right" }
                    ].map(({ key, label, align }) => (
                      <th
                        key={key}
                        onClick={() => {
                          if (sortColumn === key) {
                            setSortDirection(sortDirection === "asc" ? "desc" : "asc");
                          } else {
                            setSortColumn(key);
                            setSortDirection(key === "date" ? "desc" : "desc");
                          }
                        }}
                        style={{
                          padding: "10px 12px",
                          borderBottom: "1px solid var(--border)",
                          color: sortColumn === key ? "var(--accent)" : "var(--muted)",
                          textAlign: align as any,
                          cursor: "pointer",
                          userSelect: "none",
                          fontWeight: sortColumn === key ? 600 : 400,
                          transition: "color 0.2s"
                        }}
                        onMouseEnter={(e) => {
                          if (sortColumn !== key) e.currentTarget.style.color = "var(--foreground)";
                        }}
                        onMouseLeave={(e) => {
                          if (sortColumn !== key) e.currentTarget.style.color = "var(--muted)";
                        }}
                      >
                        {label}
                        {sortColumn === key && (
                          <span style={{ marginLeft: 6, fontSize: 10 }}>
                            {sortDirection === "asc" ? "↑" : "↓"}
                          </span>
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedReturns.map((row, idx) => (
                    <tr key={row.date} style={{
                      borderBottom: "1px solid var(--border)",
                      backgroundColor: idx % 2 === 0 ? "transparent" : "rgba(255,255,255,0.02)"
                    }}>
                      <td style={{ padding: "10px 12px", color: "var(--foreground)" }}>{row.date}</td>
                      <td style={{ padding: "10px 12px", fontFamily: "monospace", textAlign: "right" }}>{fmtNum(row.close)}</td>
                      <td style={{ padding: "10px 12px", fontFamily: "monospace", textAlign: "right", color: "var(--muted-foreground)" }}>{fmtNum(row.adj_close)}</td>
                      <td style={{ padding: "10px 12px", fontFamily: "monospace", textAlign: "right", color: row.return > 0 ? "var(--success)" : row.return < 0 ? "var(--danger)" : "var(--foreground)" }}>{fmtPct(row.return, 4)}</td>
                      <td style={{ padding: "10px 12px", fontFamily: "monospace", textAlign: "right", color: row.cumulative > 0 ? "var(--success)" : row.cumulative < 0 ? "var(--danger)" : "var(--foreground)" }}>{fmtPct(row.cumulative, 2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ marginTop: 12, fontSize: 11, color: "var(--muted-foreground)", textAlign: "right" }}>
              Showing {sortedReturns.length} days
              {returnFilter !== "all" && ` (filtered from ${activeReturns.length} total)`}
              {sortColumn !== "date" && ` • Sorted by ${sortColumn === "return" ? "Daily Return" : sortColumn === "cumulative" ? "Cumulative" : sortColumn === "close" ? "Close" : "Adj Close"} ${sortDirection === "asc" ? "↑" : "↓"}`}
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
function MetricCard({ label, value, colorType, tooltip, subtitle }: { label: string; value: string; colorType?: "success" | "danger" | "warning"; tooltip?: string; subtitle?: string }) {
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
      <div style={{ fontSize: 22, fontWeight: 600, color: getColor(), fontFamily: "monospace", marginBottom: subtitle ? 6 : 0 }}>{value}</div>
      {subtitle && <div style={{ fontSize: 10, color: "var(--muted-foreground)", lineHeight: 1.4 }}>{subtitle}</div>}
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
