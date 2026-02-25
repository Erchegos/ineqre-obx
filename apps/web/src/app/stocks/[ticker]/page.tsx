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
import NewsFeed from "@/components/NewsFeed";
import WhyDidItMove from "@/components/WhyDidItMove";

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
  betaInfo?: {
    rawDataPoints: number;
    adjDataPoints: number;
    benchmark: string;
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

type OptimizeTrade = {
  entryDate: string;
  exitDate: string;
  signal: "LONG" | "SHORT";
  returnPct: number;
  holdingDays: number;
  exitReason: "TARGET" | "TIME" | "STOP";
};

type StdChannelOptimizeResult = {
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
  avgReturn: number;
  avgHoldingDays: number;
  exitBreakdown: { target: number; time: number; stop: number };
  score: number;
  trades?: OptimizeTrade[];
};

type StdChannelOptimizeResponse = {
  success: boolean;
  ticker: string;
  tested: number;
  dataPoints: number;
  dateRange: { start: string; end: string };
  results: StdChannelOptimizeResult[];
  best: StdChannelOptimizeResult | null;
  parametersUsed?: {
    entrySigmas: number[];
    stopSigmas: number[];
    maxDaysList: number[];
    minR2s: number[];
    windowSizes: number[];
    minTrades: number;
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
  const [isPanelOpen, setIsPanelOpen] = useState<boolean>(false);

  // Inline fundamentals (compact strip next to mode toggle)
  const [inlineFundamentals, setInlineFundamentals] = useState<{
    ep: number | null; bm: number | null; dy: number | null; mktcap: number | null;
  } | null>(null);

  const [returnsStartDate, setReturnsStartDate] = useState<string>("");
  const [returnsEndDate, setReturnsEndDate] = useState<string>("");

  // Stock metadata for ML predictions eligibility
  const [totalRows, setTotalRows] = useState<number>(0);
  const [stockMetaLoading, setStockMetaLoading] = useState<boolean>(true);
  const [hasFactorData, setHasFactorData] = useState<boolean>(false);
  const [stockName, setStockName] = useState<string>("");
  const [stockSector, setStockSector] = useState<string>("");

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

  // STD Channel Backtest Optimizer
  const [stdBacktestData, setStdBacktestData] = useState<StdChannelOptimizeResponse | null>(null);
  const [stdBacktestLoading, setStdBacktestLoading] = useState<boolean>(false);
  const [stdBacktestError, setStdBacktestError] = useState<string | null>(null);
  const [showOptimizer, setShowOptimizer] = useState<boolean>(false);
  const [optimizerProgress, setOptimizerProgress] = useState<number>(0);
  const [showOptimizerParams, setShowOptimizerParams] = useState<boolean>(false);
  const [showTrades, setShowTrades] = useState<boolean>(false);

  // Optimizer parameter state - use Sets for checkbox selections
  // Better risk/reward: stop offset from entry (not absolute sigma)
  const [optEntrySigmas, setOptEntrySigmas] = useState<Set<number>>(new Set([2, 2.5, 3]));
  const [optStopOffsets, setOptStopOffsets] = useState<Set<number>>(new Set([0.5, 1.0])); // Stop = Entry + offset (tighter risk)
  const [optMaxDays, setOptMaxDays] = useState<Set<number>>(new Set([7, 14, 21]));
  const [optMinR2s, setOptMinR2s] = useState<Set<number>>(new Set([0.5, 0.7]));
  const [optWindows, setOptWindows] = useState<Set<number>>(new Set([126, 252]));
  const [optMinTrades, setOptMinTrades] = useState<number>(3);

  // Toggle helper for checkbox selections
  const toggleSetValue = (set: Set<number>, value: number, setter: React.Dispatch<React.SetStateAction<Set<number>>>) => {
    const newSet = new Set(set);
    if (newSet.has(value)) {
      if (newSet.size > 1) newSet.delete(value); // Keep at least one selected
    } else {
      newSet.add(value);
    }
    setter(newSet);
  };

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

  // Fetch stock metadata, factor eligibility, AND fundamentals in parallel
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
        // Run ALL 3 API calls in PARALLEL for faster load
        const [factorRes, stocksRes, fundRes] = await Promise.all([
          fetch(`/api/factors/tickers`, {
            method: "GET",
            headers: { accept: "application/json" },
          }),
          fetch(`/api/stocks`, {
            method: "GET",
            headers: { accept: "application/json" },
          }),
          fetch(`/api/factors/${encodeURIComponent(ticker)}?type=fundamental&limit=1`),
        ]);

        let factorExists = false;
        if (factorRes.ok) {
          const factorData = await factorRes.json();
          factorExists = factorData.success && factorData.tickers?.includes(ticker);
        }

        // Parse fundamentals
        if (!cancelled && fundRes.ok) {
          const fundJson = await fundRes.json();
          if (fundJson.success && fundJson.data?.length > 0) {
            const d = fundJson.data[0];
            setInlineFundamentals({
              ep: d.ep != null ? Number(d.ep) : null,
              bm: d.bm != null ? Number(d.bm) : null,
              dy: d.dy != null ? Number(d.dy) : null,
              mktcap: d.mktcap != null ? Number(d.mktcap) : null,
            });
          }
        }

        if (!stocksRes.ok) {
          console.warn("Failed to fetch stock metadata");
          setTotalRows(0);
          setHasFactorData(false);
          return;
        }

        const stocks = await stocksRes.json();
        const stock = stocks.find((s: any) => s.ticker === ticker);

        if (!cancelled) {
          setTotalRows(stock?.rows || 0);
          setHasFactorData(factorExists);
          setStockName(stock?.name || "");
          setStockSector(stock?.sector || "");
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

  // Function to run STD Channel optimizer for this ticker
  const runStdChannelOptimizer = async () => {
    if (!ticker) return;

    setStdBacktestLoading(true);
    setStdBacktestError(null);
    setShowOptimizer(true);
    setShowTrades(false);

    try {
      // Build URL with custom parameters - send offsets directly
      const params = new URLSearchParams();
      params.set("entrySigmas", Array.from(optEntrySigmas).sort((a, b) => a - b).join(","));
      params.set("stopOffsets", Array.from(optStopOffsets).sort((a, b) => a - b).join(",")); // Send offsets, not absolute stops
      params.set("maxDays", Array.from(optMaxDays).sort((a, b) => a - b).join(","));
      params.set("minR2s", Array.from(optMinR2s).sort((a, b) => a - b).join(","));
      params.set("windows", Array.from(optWindows).sort((a, b) => a - b).join(","));
      params.set("minTrades", String(optMinTrades));

      const res = await fetch(`/api/std-channel-optimize/${encodeURIComponent(ticker)}?${params.toString()}`, {
        method: "GET",
        headers: { accept: "application/json" },
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({ error: res.statusText }));
        setStdBacktestError(errorData.error || res.statusText);
        setStdBacktestData(null);
      } else {
        const json = await res.json();
        setStdBacktestData(json);
      }
    } catch (e: any) {
      setStdBacktestError(e?.message || "Failed to run optimizer");
      setStdBacktestData(null);
    }

    setStdBacktestLoading(false);
  };

  // Optimizer progress animation - very fast and smooth
  useEffect(() => {
    if (!stdBacktestLoading) return;

    setOptimizerProgress(0);

    const interval = setInterval(() => {
      setOptimizerProgress(prev => {
        // Very fast: reach 90% in ~1.5 seconds
        if (prev < 70) return prev + 6;
        if (prev < 88) return prev + 3;
        if (prev < 96) return prev + 1;
        return Math.min(prev + 0.3, 99);
      });
    }, 40);

    return () => clearInterval(interval);
  }, [stdBacktestLoading]);

  const activeStats = useMemo(() => {
    if (!data?.summary) return null;
    return chartMode === "price" ? data.summary.raw : data.summary.adjusted;
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

  // Compute last price + daily change for hero bar
  const priceInfo = useMemo(() => {
    if (!data?.prices || data.prices.length < 2) return null;
    const last = data.prices[data.prices.length - 1];
    const prev = data.prices[data.prices.length - 2];
    const price = last.adj_close ?? last.close;
    const prevPrice = prev.adj_close ?? prev.close;
    const change = price - prevPrice;
    const changePct = prevPrice !== 0 ? (change / prevPrice) * 100 : 0;
    return { price, change, changePct, date: last.date };
  }, [data]);

  // Compute CAGR for hero bar
  const cagr = useMemo(() => {
    if (!activeStats || !data?.dateRange?.start || !data?.dateRange?.end) return null;
    const start = new Date(data.dateRange.start);
    const end = new Date(data.dateRange.end);
    const years = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24 * 365.25);
    if (years < 0.5) return null;
    return (Math.pow(1 + activeStats.totalReturn / 100, 1 / years) - 1) * 100;
  }, [activeStats, data]);

  return (
    <main style={{ padding: "16px 24px", maxWidth: 1400, margin: "0 auto", minHeight: "100vh", background: "var(--background)", color: "var(--foreground)" }}>
      <style>{`
        .stock-hero-metrics { display: flex; flex-wrap: wrap; }
        .stock-chart-news { display: grid; grid-template-columns: 3fr 2fr; gap: 10px; }
        .stock-metric-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 6px; }
        .stock-mode-fundamentals { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 24px; }
        .stock-mode-fundamentals .fundamentals-strip { margin-left: auto; display: flex; align-items: center; gap: 14px; }
        @media (max-width: 900px) {
          .stock-chart-news { grid-template-columns: 1fr; }
          .stock-metric-grid { grid-template-columns: repeat(3, 1fr); }
          .stock-mode-fundamentals .fundamentals-strip { margin-left: 0; width: 100%; }
        }
        @media (max-width: 600px) {
          .stock-metric-grid { grid-template-columns: repeat(2, 1fr); }
        }
      `}</style>
      {/* ═══ BLOOMBERG-STYLE HERO BAR ═══ */}
      <div style={{
        background: "rgba(255,255,255,0.02)",
        border: "1px solid var(--border)",
        borderRadius: 3,
        padding: "10px 14px",
        marginBottom: 12,
        fontFamily: "'Geist Mono', monospace",
      }}>
        {/* Row 1: Ticker + Name + Badge + Nav */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0, letterSpacing: "-0.02em" }}>
              {ticker || "?"}
            </h1>
            {stockName && (
              <span style={{ fontSize: 12, color: "var(--muted-foreground)", fontWeight: 400 }}>
                {stockName}
              </span>
            )}
            {ticker && <LiquidityBadge ticker={ticker} />}
            {stockSector && (
              <span style={{ fontSize: 9, padding: "1px 5px", borderRadius: 2, background: "rgba(255,255,255,0.06)", color: "var(--muted-foreground)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                {stockSector}
              </span>
            )}
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <Link href="/" style={{ fontSize: 10, color: "var(--muted-foreground)", textDecoration: "none" }}>← Home</Link>
            <Link href="/stocks" style={{ fontSize: 10, color: "var(--muted-foreground)", textDecoration: "none" }}>← Stocks</Link>
            <Link href="/news" style={{ fontSize: 10, color: "var(--muted-foreground)", textDecoration: "none" }}>News</Link>
          </div>
        </div>

        {/* Row 2: Price + Change + Key Metrics Strip */}
        <div style={{ display: "flex", alignItems: "baseline", gap: 16, marginBottom: 8, flexWrap: "wrap" }}>
          {priceInfo ? (
            <>
              <span style={{ fontSize: 24, fontWeight: 700 }}>{priceInfo.price.toFixed(2)}</span>
              <span style={{
                fontSize: 14, fontWeight: 700,
                color: priceInfo.change >= 0 ? "#22c55e" : "#ef4444",
              }}>
                {priceInfo.change >= 0 ? "▲" : "▼"} {priceInfo.change >= 0 ? "+" : ""}{priceInfo.changePct.toFixed(2)}%
              </span>
              <span style={{ fontSize: 11, color: "var(--muted-foreground)" }}>
                {priceInfo.change >= 0 ? "+" : ""}{priceInfo.change.toFixed(2)}
              </span>
            </>
          ) : (
            <span style={{ fontSize: 14, color: "var(--muted-foreground)" }}>Loading...</span>
          )}

          {activeStats && (
            <>
              <span style={{ width: 1, height: 16, background: "var(--border)" }} />
              {[
                { label: "VOL", value: fmtPct(activeStats.volatility) },
                { label: "SHARPE", value: fmtNum(activeStats.sharpeRatio, 2) },
                { label: "β", value: fmtNum(activeStats.beta, 2), tooltip: data?.betaInfo ? `vs ${data.betaInfo.benchmark} · ${data.betaInfo.rawDataPoints} days overlap` : undefined, warn: data?.betaInfo && data.betaInfo.rawDataPoints < 200 },
                { label: "DD", value: fmtPct(activeStats.maxDrawdown), color: "#ef4444" },
                { label: "RET", value: fmtPct(activeStats.totalReturn), color: activeStats.totalReturn >= 0 ? "#22c55e" : "#ef4444" },
                ...(cagr !== null ? [{ label: "CAGR", value: fmtPct(cagr), color: cagr >= 0 ? "#22c55e" : "#ef4444" }] : []),
              ].map((m) => (
                <div key={m.label} style={{ display: "flex", alignItems: "baseline", gap: 4 }} title={(m as any).tooltip || undefined}>
                  <span style={{ fontSize: 9, color: "var(--muted-foreground)", fontWeight: 700, letterSpacing: "0.04em" }}>{m.label}</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: m.color || "var(--foreground)" }}>{m.value}</span>
                  {(m as any).warn && (
                    <span style={{ fontSize: 8, color: "#f59e0b", fontWeight: 600 }} title={(m as any).tooltip}>*</span>
                  )}
                </div>
              ))}
            </>
          )}
        </div>

        {/* Row 3: Navigation Links */}
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {[
            { href: `/volatility/${ticker}`, label: "VOLATILITY" },
            { href: `/montecarlo/${ticker}`, label: "MONTE CARLO" },
            ...(!stockMetaLoading && totalRows >= 756 && hasFactorData ? [{ href: `/predictions/${ticker}`, label: "ML PREDICTIONS" }] : []),
            ...(["EQNR.US", "BORR.US", "FLNG.US", "FRO.US"].includes(ticker) ? [{ href: `/options/${ticker}`, label: "OPTIONS" }] : []),
            { href: "/std-channel-strategy", label: "STD OPTIMIZER" },
          ].map((link) => (
            <Link key={link.href} href={link.href} style={{
              padding: "4px 8px", borderRadius: 2, background: "rgba(255,255,255,0.04)",
              border: "1px solid var(--border)", color: "var(--foreground)",
              fontSize: 9, fontWeight: 600, textDecoration: "none", letterSpacing: "0.03em",
              transition: "all 0.15s",
            }}>
              {link.label}
            </Link>
          ))}
        </div>
      </div>

      {/* View Mode Toggle + Inline Fundamentals */}
      <div className="stock-mode-fundamentals">
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

        {/* Inline Fundamentals Strip */}
        {inlineFundamentals && (
          <div className="fundamentals-strip" style={{ fontFamily: "'Geist Mono', monospace" }}>
            {inlineFundamentals.ep !== null && (
              <span style={{ fontSize: 11, color: "var(--muted-foreground)" }}>
                <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.04em", marginRight: 3 }}>E/P</span>
                <span style={{ fontWeight: 600, color: "var(--foreground)" }}>{(inlineFundamentals.ep * 100).toFixed(1)}%</span>
              </span>
            )}
            {inlineFundamentals.bm !== null && (
              <span style={{ fontSize: 11, color: "var(--muted-foreground)" }}>
                <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.04em", marginRight: 3 }}>B/M</span>
                <span style={{ fontWeight: 600, color: "var(--foreground)" }}>{inlineFundamentals.bm.toFixed(2)}</span>
              </span>
            )}
            {inlineFundamentals.dy !== null && (
              <span style={{ fontSize: 11, color: "var(--muted-foreground)" }}>
                <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.04em", marginRight: 3 }}>DY</span>
                <span style={{ fontWeight: 600, color: "var(--foreground)" }}>{(inlineFundamentals.dy * 100).toFixed(1)}%</span>
              </span>
            )}
            {inlineFundamentals.mktcap !== null && (
              <span style={{ fontSize: 11, color: "var(--muted-foreground)" }}>
                <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.04em", marginRight: 3 }}>MCAP</span>
                <span style={{ fontWeight: 600, color: "var(--foreground)" }}>
                  {inlineFundamentals.mktcap >= 1e9
                    ? `${(inlineFundamentals.mktcap / 1e9).toFixed(0)}B`
                    : `${(inlineFundamentals.mktcap / 1e6).toFixed(0)}M`}
                </span>
              </span>
            )}
            <button
              onClick={() => setIsPanelOpen(true)}
              style={{
                padding: "2px 8px", borderRadius: 2, border: "1px solid var(--border)",
                background: "transparent", color: "var(--accent)", fontSize: 9,
                fontWeight: 700, fontFamily: "monospace", cursor: "pointer",
                letterSpacing: "0.04em", transition: "border-color 0.15s",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.borderColor = "var(--accent)")}
              onMouseLeave={(e) => (e.currentTarget.style.borderColor = "var(--border)")}
            >
              MORE ▸
            </button>
          </div>
        )}
      </div>

      {/* Timeframe Selector - compact, only in Historical mode */}
      {viewMode === "historical" && (
        <div style={{ marginBottom: 10, display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 9, color: "var(--muted-foreground)", letterSpacing: "0.06em", textTransform: "uppercase", fontFamily: "monospace", fontWeight: 700 }}>
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

      {/* ═══ HISTORICAL ANALYSIS ═══ */}
      {!loading && data && activeStats && viewMode === "historical" && (
        <>
          {/* Row 1: Metric cards — full width, single row */}
          <div className="stock-metric-grid" style={{ marginBottom: 10 }}>
            {[
              { label: "TOT RET", value: fmtPct(activeStats.totalReturn), color: activeStats.totalReturn >= 0 ? "#22c55e" : "#ef4444" },
              { label: "CAGR", value: cagr !== null ? fmtPct(cagr) : "—", color: (cagr ?? 0) >= 0 ? "#22c55e" : "#ef4444" },
              { label: "MAX DD", value: fmtPct(activeStats.maxDrawdown), color: "#ef4444" },
              { label: "VaR 95%", value: fmtPct(activeStats.var95), color: "var(--foreground)" },
              { label: "CVaR 95%", value: fmtPct(activeStats.cvar95), color: "var(--foreground)" },
              { label: "SHARPE", value: fmtNum(activeStats.sharpeRatio, 3), color: "var(--foreground)" },
              { label: `β vs ${data.betaInfo?.benchmark || "OBX"}`, value: fmtNum(activeStats.beta, 3), color: "var(--foreground)", sub: data.betaInfo ? `${data.betaInfo.rawDataPoints}d overlap` : undefined, warn: data.betaInfo && data.betaInfo.rawDataPoints < 200 },
            ].map((m) => (
              <div key={m.label} style={{
                padding: "6px 8px",
                background: "rgba(255,255,255,0.02)",
                border: `1px solid ${(m as any).warn ? "rgba(245,158,11,0.3)" : "var(--border)"}`,
                borderRadius: 3,
              }}>
                <div style={{ fontSize: 8, fontWeight: 700, color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 3, fontFamily: "monospace" }}>
                  {m.label}
                </div>
                <div style={{ fontSize: 15, fontWeight: 700, color: m.color, fontFamily: "monospace" }}>
                  {m.value}
                </div>
                {(m as any).sub && (
                  <div style={{ fontSize: 8, color: (m as any).warn ? "#f59e0b" : "var(--muted-foreground)", marginTop: 1, fontFamily: "monospace" }}>
                    {(m as any).sub}{(m as any).warn ? " ⚠" : ""}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Row 2: Chart + News side-by-side */}
          <div className="stock-chart-news" style={{ marginBottom: 10 }}>
            {/* Chart panel (left) */}
            <div style={{ padding: "8px 12px", borderRadius: 3, border: "1px solid var(--border)", background: "rgba(255,255,255,0.02)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <div style={{ display: "flex", gap: 2 }}>
                  {(["price", "total_return", "comparison"] as const).map((mode) => (
                    <button
                      key={mode}
                      onClick={() => setChartMode(mode)}
                      style={{
                        padding: "3px 8px", borderRadius: 2, border: "1px solid var(--border)",
                        background: chartMode === mode ? "var(--accent)" : "transparent",
                        color: chartMode === mode ? "#fff" : "var(--muted-foreground)",
                        fontSize: 9, fontWeight: 600, fontFamily: "monospace", cursor: "pointer",
                        letterSpacing: "0.03em", textTransform: "uppercase",
                      }}
                    >
                      {mode === "price" ? "PRICE" : mode === "total_return" ? "TOTAL RET" : "COMPARE %"}
                    </button>
                  ))}
                </div>
                <span style={{ fontSize: 9, color: "var(--muted-foreground)", fontFamily: "monospace" }}>
                  {getModeLabel()}
                </span>
              </div>
              <PriceChart data={chartData} height={340} />
            </div>

            {/* News panel (right) */}
            <div style={{ border: "1px solid var(--border)", borderRadius: 3, overflow: "hidden", display: "flex", flexDirection: "column" }}>
              <div style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                padding: "4px 8px", background: "rgba(255,255,255,0.03)",
                borderBottom: "1px solid var(--border)", flexShrink: 0,
              }}>
                <span style={{ fontSize: 9, fontWeight: 700, fontFamily: "monospace", letterSpacing: "0.06em", color: "var(--muted-foreground)" }}>
                  NEWS
                </span>
                <Link href="/news" style={{ fontSize: 9, color: "var(--accent)", textDecoration: "none", fontFamily: "monospace" }}>
                  ALL →
                </Link>
              </div>
              <div style={{ maxHeight: 370, overflowY: "auto", padding: "0 6px", flex: 1 }}>
                <NewsFeed ticker={ticker} limit={20} compact refreshInterval={120} />
              </div>
            </div>
          </div>

          {/* Row 3: Significant Moves — full width */}
          <div style={{ border: "1px solid var(--border)", borderRadius: 3, overflow: "hidden", marginBottom: 10 }}>
            <div style={{
              padding: "4px 8px", background: "rgba(255,255,255,0.03)",
              borderBottom: "1px solid var(--border)",
              fontSize: 9, fontWeight: 700, fontFamily: "monospace", letterSpacing: "0.06em",
              color: "var(--muted-foreground)",
            }}>
              SIGNIFICANT MOVES (2σ)
            </div>
            <div style={{ maxHeight: 180, overflowY: "auto", padding: "0 6px" }}>
              <WhyDidItMove ticker={ticker} days={60} sigma={2} />
            </div>
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

              {/* STD Channel Backtest Optimizer */}
              <div style={{
                padding: 20,
                borderRadius: 4,
                border: "1px solid var(--card-border)",
                background: "var(--card-bg)",
                marginBottom: 20,
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
                  <div>
                    <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 4, color: "var(--foreground)" }}>
                      Mean Reversion Backtest
                    </h2>
                    <div style={{ fontSize: 12, color: "var(--muted-foreground)" }}>
                      Optimized parameters for {ticker} using slope-aligned mean reversion
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <button
                      onClick={() => setShowOptimizerParams(!showOptimizerParams)}
                      title="Configure parameters"
                      style={{
                        padding: "8px 10px",
                        borderRadius: 4,
                        border: "1px solid var(--border)",
                        background: showOptimizerParams ? "var(--accent)" : "transparent",
                        color: showOptimizerParams ? "#fff" : "var(--muted)",
                        fontSize: 14,
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        transition: "all 0.2s",
                      }}
                    >
                      ⚙
                    </button>
                    <button
                      onClick={runStdChannelOptimizer}
                      disabled={stdBacktestLoading}
                      style={{
                        padding: "8px 16px",
                        borderRadius: 4,
                        border: "none",
                        background: stdBacktestLoading ? "var(--muted)" : "#f59e0b",
                        color: "#fff",
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: stdBacktestLoading ? "not-allowed" : "pointer",
                        opacity: stdBacktestLoading ? 0.7 : 1,
                      }}
                    >
                      {stdBacktestLoading ? "Optimizing..." : showOptimizer && stdBacktestData ? "Re-Optimize" : "Run Backtest"}
                    </button>
                  </div>
                </div>

                {/* Parameter Configuration Panel */}
                {showOptimizerParams && (
                  <div style={{
                    padding: 16,
                    background: "linear-gradient(135deg, var(--card-bg) 0%, var(--hover-bg) 100%)",
                    borderRadius: 6,
                    marginBottom: 16,
                    border: "1px solid var(--accent)",
                    borderLeftWidth: 3,
                  }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                      {/* Entry Sigma - when to enter */}
                      <div>
                        <div style={{ fontSize: 10, color: "var(--muted)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                          Entry σ <span style={{ textTransform: "none", opacity: 0.7 }}>(distance from mean to enter)</span>
                        </div>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          {[1.5, 2, 2.5, 3, 3.5].map(v => (
                            <button
                              key={v}
                              onClick={() => toggleSetValue(optEntrySigmas, v, setOptEntrySigmas)}
                              style={{
                                padding: "4px 10px",
                                borderRadius: 4,
                                border: optEntrySigmas.has(v) ? "1px solid var(--accent)" : "1px solid var(--border)",
                                background: optEntrySigmas.has(v) ? "var(--accent)" : "transparent",
                                color: optEntrySigmas.has(v) ? "#fff" : "var(--foreground)",
                                fontSize: 12,
                                fontFamily: "monospace",
                                cursor: "pointer",
                              }}
                            >
                              {v}σ
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Stop Offset - risk per trade */}
                      <div>
                        <div style={{ fontSize: 10, color: "var(--muted)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                          Stop Offset <span style={{ textTransform: "none", opacity: 0.7 }}>(stop = entry + offset, controls risk)</span>
                        </div>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          {[0.5, 0.75, 1.0, 1.5].map(v => (
                            <button
                              key={v}
                              onClick={() => toggleSetValue(optStopOffsets, v, setOptStopOffsets)}
                              style={{
                                padding: "4px 10px",
                                borderRadius: 4,
                                border: optStopOffsets.has(v) ? "1px solid #ef4444" : "1px solid var(--border)",
                                background: optStopOffsets.has(v) ? "rgba(239, 68, 68, 0.2)" : "transparent",
                                color: optStopOffsets.has(v) ? "#ef4444" : "var(--foreground)",
                                fontSize: 12,
                                fontFamily: "monospace",
                                cursor: "pointer",
                              }}
                            >
                              +{v}σ
                            </button>
                          ))}
                        </div>
                        <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 4, fontStyle: "italic" }}>
                          e.g. Entry 2σ + Offset 0.5σ = Stop at 2.5σ (risk 0.5σ per trade)
                        </div>
                      </div>

                      {/* Max Holding Days */}
                      <div>
                        <div style={{ fontSize: 10, color: "var(--muted)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                          Max Days <span style={{ textTransform: "none", opacity: 0.7 }}>(time limit per trade)</span>
                        </div>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          {[5, 7, 10, 14, 21, 30].map(v => (
                            <button
                              key={v}
                              onClick={() => toggleSetValue(optMaxDays, v, setOptMaxDays)}
                              style={{
                                padding: "4px 10px",
                                borderRadius: 4,
                                border: optMaxDays.has(v) ? "1px solid #3b82f6" : "1px solid var(--border)",
                                background: optMaxDays.has(v) ? "rgba(59, 130, 246, 0.2)" : "transparent",
                                color: optMaxDays.has(v) ? "#3b82f6" : "var(--foreground)",
                                fontSize: 12,
                                fontFamily: "monospace",
                                cursor: "pointer",
                              }}
                            >
                              {v}d
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Second row - Filters */}
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 120px", gap: 12 }}>
                        {/* Min R² */}
                        <div>
                          <div style={{ fontSize: 10, color: "var(--muted)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                            Min R² <span style={{ textTransform: "none", opacity: 0.7 }}>(channel quality)</span>
                          </div>
                          <div style={{ display: "flex", gap: 6 }}>
                            {[0.3, 0.5, 0.7].map(v => (
                              <button
                                key={v}
                                onClick={() => toggleSetValue(optMinR2s, v, setOptMinR2s)}
                                style={{
                                  padding: "4px 10px",
                                  borderRadius: 4,
                                  border: optMinR2s.has(v) ? "1px solid #10b981" : "1px solid var(--border)",
                                  background: optMinR2s.has(v) ? "rgba(16, 185, 129, 0.2)" : "transparent",
                                  color: optMinR2s.has(v) ? "#10b981" : "var(--foreground)",
                                  fontSize: 12,
                                  fontFamily: "monospace",
                                  cursor: "pointer",
                                }}
                              >
                                {v}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Window Sizes */}
                        <div>
                          <div style={{ fontSize: 10, color: "var(--muted)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                            Window <span style={{ textTransform: "none", opacity: 0.7 }}>(lookback)</span>
                          </div>
                          <div style={{ display: "flex", gap: 6 }}>
                            {[126, 189, 252].map(v => (
                              <button
                                key={v}
                                onClick={() => toggleSetValue(optWindows, v, setOptWindows)}
                                style={{
                                  padding: "4px 8px",
                                  borderRadius: 4,
                                  border: optWindows.has(v) ? "1px solid var(--foreground)" : "1px solid var(--border)",
                                  background: optWindows.has(v) ? "var(--hover-bg)" : "transparent",
                                  color: optWindows.has(v) ? "var(--foreground)" : "var(--muted)",
                                  fontSize: 11,
                                  fontFamily: "monospace",
                                  cursor: "pointer",
                                }}
                              >
                                {v}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Min Trades */}
                        <div>
                          <div style={{ fontSize: 10, color: "var(--muted)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                            Min Trades
                          </div>
                          <input
                            type="number"
                            value={optMinTrades}
                            onChange={(e) => setOptMinTrades(parseInt(e.target.value) || 3)}
                            min={1}
                            max={20}
                            style={{
                              width: "100%",
                              padding: "4px 8px",
                              borderRadius: 4,
                              border: "1px solid var(--input-border)",
                              background: "var(--input-bg)",
                              color: "var(--foreground)",
                              fontSize: 12,
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Optimizer Results */}
                {showOptimizer && (
                  <div>
                    {stdBacktestLoading && (
                      <div style={{
                        padding: 20,
                        background: "linear-gradient(135deg, var(--card-bg) 0%, #1a1a2e 100%)",
                        borderRadius: 6,
                        border: "1px solid var(--accent)",
                      }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                          <div style={{
                            width: 40,
                            height: 40,
                            borderRadius: "50%",
                            background: "linear-gradient(135deg, #f59e0b 0%, #fbbf24 100%)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            flexShrink: 0,
                          }}>
                            <div style={{
                              width: 16,
                              height: 16,
                              borderRadius: "50%",
                              border: "2px solid rgba(255,255,255,0.3)",
                              borderTopColor: "#fff",
                            }} />
                          </div>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4, color: "var(--foreground)" }}>
                              Optimizing {ticker}
                            </div>
                            <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 8 }}>
                              Testing ~270 parameter combinations...
                            </div>
                            <div style={{
                              height: 4,
                              background: "var(--border)",
                              borderRadius: 2,
                              overflow: "hidden",
                            }}>
                              <div style={{
                                height: "100%",
                                width: `${optimizerProgress}%`,
                                background: "linear-gradient(90deg, #f59e0b 0%, #fbbf24 100%)",
                                borderRadius: 2,
                                transition: "width 0.15s ease-out",
                              }} />
                            </div>
                            <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 4, fontFamily: "monospace" }}>
                              {optimizerProgress.toFixed(0)}% complete
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {stdBacktestError && (
                      <div style={{ padding: 12, background: "var(--danger-bg)", border: "1px solid var(--danger)", borderRadius: 4, color: "var(--danger)", fontSize: 12 }}>
                        {stdBacktestError}
                      </div>
                    )}

                    {stdBacktestData && stdBacktestData.best && (
                      <>
                        {/* Best Result Summary */}
                        <div style={{
                          display: "grid",
                          gridTemplateColumns: "repeat(6, 1fr)",
                          gap: 12,
                          marginBottom: 16,
                        }}>
                          <div style={{ background: "rgba(16, 185, 129, 0.1)", padding: 12, borderRadius: 4, border: "1px solid rgba(16, 185, 129, 0.2)" }}>
                            <div style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase", marginBottom: 4 }}>Total Return</div>
                            <div style={{ fontSize: 20, fontWeight: 700, color: "#10b981", fontFamily: "monospace" }}>
                              {(stdBacktestData.best.totalReturn * 100).toFixed(0)}%
                            </div>
                            <div style={{ fontSize: 10, color: "var(--muted-foreground)" }}>{stdBacktestData.best.totalTrades} trades</div>
                          </div>
                          <div style={{ background: "var(--hover-bg)", padding: 12, borderRadius: 4 }}>
                            <div style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase", marginBottom: 4 }}>Win Rate</div>
                            <div style={{ fontSize: 20, fontWeight: 700, color: stdBacktestData.best.winRate >= 0.5 ? "#10b981" : "#ef4444", fontFamily: "monospace" }}>
                              {(stdBacktestData.best.winRate * 100).toFixed(0)}%
                            </div>
                          </div>
                          <div style={{ background: "var(--hover-bg)", padding: 12, borderRadius: 4 }}>
                            <div style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase", marginBottom: 4 }}>Sharpe</div>
                            <div style={{ fontSize: 20, fontWeight: 700, color: stdBacktestData.best.sharpe >= 1 ? "#10b981" : "var(--foreground)", fontFamily: "monospace" }}>
                              {stdBacktestData.best.sharpe.toFixed(2)}
                            </div>
                          </div>
                          <div style={{ background: "var(--hover-bg)", padding: 12, borderRadius: 4 }}>
                            <div style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase", marginBottom: 4 }}>Profit Factor</div>
                            <div style={{ fontSize: 20, fontWeight: 700, color: "var(--foreground)", fontFamily: "monospace" }}>
                              {stdBacktestData.best.profitFactor > 10 ? ">10" : stdBacktestData.best.profitFactor.toFixed(2)}
                            </div>
                          </div>
                          <div style={{ background: "rgba(239, 68, 68, 0.1)", padding: 12, borderRadius: 4, border: "1px solid rgba(239, 68, 68, 0.2)" }}>
                            <div style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase", marginBottom: 4 }}>Max Drawdown</div>
                            <div style={{ fontSize: 20, fontWeight: 700, color: "#ef4444", fontFamily: "monospace" }}>
                              -{(stdBacktestData.best.maxDrawdown * 100).toFixed(1)}%
                            </div>
                          </div>
                          <div style={{ background: "var(--hover-bg)", padding: 12, borderRadius: 4 }}>
                            <div style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase", marginBottom: 4 }}>Avg Hold</div>
                            <div style={{ fontSize: 20, fontWeight: 700, color: "var(--foreground)", fontFamily: "monospace" }}>
                              {stdBacktestData.best.avgHoldingDays.toFixed(0)}d
                            </div>
                          </div>
                        </div>

                        {/* Best Parameters */}
                        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
                          <div style={{ fontSize: 11, color: "var(--muted)" }}>
                            <strong style={{ color: "var(--foreground)" }}>Best Parameters:</strong>{" "}
                            Entry {stdBacktestData.best.params.entrySigma}σ, Stop {stdBacktestData.best.params.stopSigma}σ,
                            Max {stdBacktestData.best.params.maxDays}d, R² ≥ {stdBacktestData.best.params.minR2},
                            Window {stdBacktestData.best.params.windowSize}
                          </div>
                          <div style={{ fontSize: 11, color: "var(--muted)" }}>
                            <strong style={{ color: "var(--foreground)" }}>Data:</strong>{" "}
                            {stdBacktestData.dateRange.start} to {stdBacktestData.dateRange.end} ({stdBacktestData.dataPoints} days)
                          </div>
                        </div>

                        {/* Exit Breakdown */}
                        <div style={{ display: "flex", gap: 16, fontSize: 11, marginBottom: 16 }}>
                          <span style={{ color: "#10b981" }}>
                            ● Target: {((stdBacktestData.best.exitBreakdown.target / stdBacktestData.best.totalTrades) * 100).toFixed(0)}%
                          </span>
                          <span style={{ color: "#3b82f6" }}>
                            ● Time: {((stdBacktestData.best.exitBreakdown.time / stdBacktestData.best.totalTrades) * 100).toFixed(0)}%
                          </span>
                          <span style={{ color: "#ef4444" }}>
                            ● Stop: {((stdBacktestData.best.exitBreakdown.stop / stdBacktestData.best.totalTrades) * 100).toFixed(0)}%
                          </span>
                        </div>

                        {/* Trade History */}
                        {stdBacktestData.best.trades && stdBacktestData.best.trades.length > 0 && (
                          <div style={{ marginBottom: 16 }}>
                            <button
                              onClick={() => setShowTrades(!showTrades)}
                              style={{
                                padding: "6px 12px",
                                borderRadius: 4,
                                border: "1px solid var(--border)",
                                background: showTrades ? "var(--hover-bg)" : "transparent",
                                color: "var(--accent)",
                                fontSize: 12,
                                fontWeight: 500,
                                cursor: "pointer",
                                marginBottom: 12,
                              }}
                            >
                              {showTrades ? "Hide" : "Show"} {stdBacktestData.best.trades.length} Trades
                            </button>

                            {showTrades && (
                              <div style={{ overflowX: "auto" }}>
                                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                                  <thead>
                                    <tr style={{ color: "var(--muted)", textAlign: "left", borderBottom: "1px solid var(--border)" }}>
                                      <th style={{ padding: "8px 6px", fontWeight: 500 }}>#</th>
                                      <th style={{ padding: "8px 6px", fontWeight: 500 }}>Entry Date</th>
                                      <th style={{ padding: "8px 6px", fontWeight: 500 }}>Exit Date</th>
                                      <th style={{ padding: "8px 6px", fontWeight: 500 }}>Signal</th>
                                      <th style={{ padding: "8px 6px", fontWeight: 500 }}>Days</th>
                                      <th style={{ padding: "8px 6px", fontWeight: 500 }}>Return</th>
                                      <th style={{ padding: "8px 6px", fontWeight: 500 }}>Exit</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {stdBacktestData.best.trades.map((trade, idx) => (
                                      <tr
                                        key={idx}
                                        style={{
                                          borderBottom: "1px solid var(--border)",
                                          background: idx % 2 === 0 ? "transparent" : "var(--hover-bg)",
                                        }}
                                      >
                                        <td style={{ padding: "8px 6px", color: "var(--muted)" }}>{idx + 1}</td>
                                        <td style={{ padding: "8px 6px", fontFamily: "monospace" }}>{trade.entryDate}</td>
                                        <td style={{ padding: "8px 6px", fontFamily: "monospace" }}>{trade.exitDate}</td>
                                        <td style={{
                                          padding: "8px 6px",
                                          color: trade.signal === "LONG" ? "#10b981" : "#ef4444",
                                          fontWeight: 500,
                                        }}>
                                          {trade.signal}
                                        </td>
                                        <td style={{ padding: "8px 6px", fontFamily: "monospace" }}>{trade.holdingDays}d</td>
                                        <td style={{
                                          padding: "8px 6px",
                                          fontFamily: "monospace",
                                          fontWeight: 600,
                                          color: trade.returnPct >= 0 ? "#10b981" : "#ef4444",
                                        }}>
                                          {trade.returnPct >= 0 ? "+" : ""}{(trade.returnPct * 100).toFixed(1)}%
                                        </td>
                                        <td style={{
                                          padding: "8px 6px",
                                          color: trade.exitReason === "TARGET" ? "#10b981" :
                                                 trade.exitReason === "TIME" ? "#3b82f6" : "#ef4444",
                                        }}>
                                          {trade.exitReason}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </div>
                        )}

                        {/* All Results Table (collapsed by default, expandable) */}
                        {stdBacktestData.results.length > 1 && (
                          <details style={{ marginTop: 16 }}>
                            <summary style={{ cursor: "pointer", fontSize: 12, color: "var(--accent)", fontWeight: 500 }}>
                              Show all {stdBacktestData.results.length} optimized parameter sets
                            </summary>
                            <div style={{ overflowX: "auto", marginTop: 12 }}>
                              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                                <thead>
                                  <tr style={{ color: "var(--muted)", textAlign: "left", borderBottom: "1px solid var(--border)" }}>
                                    <th style={{ padding: "6px 8px", fontWeight: 500 }}>Entry σ</th>
                                    <th style={{ padding: "6px 8px", fontWeight: 500 }}>Stop σ</th>
                                    <th style={{ padding: "6px 8px", fontWeight: 500 }}>Max Days</th>
                                    <th style={{ padding: "6px 8px", fontWeight: 500 }}>Min R²</th>
                                    <th style={{ padding: "6px 8px", fontWeight: 500 }}>Window</th>
                                    <th style={{ padding: "6px 8px", fontWeight: 500, textAlign: "right" }}>Trades</th>
                                    <th style={{ padding: "6px 8px", fontWeight: 500, textAlign: "right" }}>Win %</th>
                                    <th style={{ padding: "6px 8px", fontWeight: 500, textAlign: "right" }}>Return</th>
                                    <th style={{ padding: "6px 8px", fontWeight: 500, textAlign: "right" }}>Sharpe</th>
                                    <th style={{ padding: "6px 8px", fontWeight: 500, textAlign: "right" }}>Max DD</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {stdBacktestData.results.map((r, idx) => (
                                    <tr key={idx} style={{ borderBottom: "1px solid var(--table-border)", background: idx === 0 ? "#2a2a1a" : "#141414" }}>
                                      <td style={{ padding: "8px", fontFamily: "monospace" }}>{r.params.entrySigma}</td>
                                      <td style={{ padding: "8px", fontFamily: "monospace" }}>{r.params.stopSigma}</td>
                                      <td style={{ padding: "8px", fontFamily: "monospace" }}>{r.params.maxDays}</td>
                                      <td style={{ padding: "8px", fontFamily: "monospace" }}>{r.params.minR2}</td>
                                      <td style={{ padding: "8px", fontFamily: "monospace" }}>{r.params.windowSize}</td>
                                      <td style={{ padding: "8px", textAlign: "right", fontFamily: "monospace" }}>{r.totalTrades}</td>
                                      <td style={{ padding: "8px", textAlign: "right", fontFamily: "monospace", color: r.winRate >= 0.5 ? "#10b981" : "#ef4444" }}>
                                        {(r.winRate * 100).toFixed(0)}%
                                      </td>
                                      <td style={{ padding: "8px", textAlign: "right", fontFamily: "monospace", color: r.totalReturn > 0 ? "#10b981" : "#ef4444" }}>
                                        {(r.totalReturn * 100).toFixed(0)}%
                                      </td>
                                      <td style={{ padding: "8px", textAlign: "right", fontFamily: "monospace" }}>{r.sharpe.toFixed(2)}</td>
                                      <td style={{ padding: "8px", textAlign: "right", fontFamily: "monospace", color: "#ef4444" }}>
                                        -{(r.maxDrawdown * 100).toFixed(0)}%
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </details>
                        )}
                      </>
                    )}
                  </div>
                )}

                {/* Initial state - show hint */}
                {!showOptimizer && (
                  <div style={{ fontSize: 12, color: "var(--muted-foreground)", fontStyle: "italic" }}>
                    Click &quot;Configure&quot; to adjust parameters, then &quot;Run Backtest&quot; to find the best STD Channel mean reversion strategy for {ticker}.
                  </div>
                )}
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
