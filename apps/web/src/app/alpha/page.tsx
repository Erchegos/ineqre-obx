"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/useAuth";
import {
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, BarChart, Bar, Cell, ComposedChart, Area,
  ReferenceLine, ReferenceArea, Scatter,
} from "recharts";
import { runMLSimulation, computeProgressiveStats, SIM_DEFAULTS, type SimInputBar, type SimResult, type SimParams, type SimStats, type SimTrade } from "@/lib/mlTradingEngine";

// ============================================================================
// Types
// ============================================================================

interface SignalRow {
  ticker: string;
  name: string;
  sector: string;
  last_close: number;
  daily_return: number;
  signals: {
    model_id: string;
    signal_value: number;
    predicted_return: number;
    confidence: number;
    signal_date: string;
  }[];
}

interface TickerSignalHistory {
  ticker: string;
  sector: string;
  signals: {
    signal_date: string;
    model_id: string;
    signal_value: number;
    predicted_return: number;
    confidence: number;
  }[];
  actualReturns: {
    date: string;
    close: number;
    sma200?: number;
    sma50?: number;
    daily_return: number;
    dist_sma200?: number;
  }[];
  fundamentals?: {
    ep: number; bm: number; dy: number; sp: number;
    ev_ebitda: number; mktcap: number;
  } | null;
  sectorAvg?: {
    avg_ep: number; avg_bm: number; avg_dy: number; avg_ev_ebitda: number;
  } | null;
}

interface PortfolioBacktestResult {
  config: {
    weights: { ml: number; lowVol: number; liquidity: number; momentum: number; value: number };
    maxSingleStock: number; maxSectorWeight: number; costBps: number; rebalance: string;
  };
  summary: {
    months: number; totalReturn: number; annualizedReturn: number; benchmarkAnnReturn: number;
    excessReturn: number; sharpe: number; benchmarkSharpe: number; maxDrawdown: number;
    benchmarkMaxDD: number; avgTurnover: number; avgIC: number; winRate: number; avgPositions: number;
  };
  equityCurve: { date: string; portfolio: number; benchmark: number }[];
  monthlyReturns: { date: string; portfolio: number; benchmark: number; excess: number; ic: number; turnover: number; positions: number }[];
  currentPortfolio: {
    date: string;
    holdings: { ticker: string; name: string; sector: string; weight: number; alphaScore: number; rank: number; components: Record<string, number> }[];
  };
  sectorAllocation: { sector: string; weight: number; color: string }[];
}

// ============================================================================
// Constants & Styles
// ============================================================================

const MODELS = {
  yggdrasil_v7: { id: "yggdrasil_v7", name: "Yggdrasil v7", desc: "Cross-sectional rank model", type: "rank" },
  mjolnir_v8: { id: "mjolnir_v8", name: "Mjölnir v8", desc: "Binary signal model", type: "binary" },
} as const;
type ModelId = keyof typeof MODELS;

const cardStyle: React.CSSProperties = {
  background: "#161b22", border: "1px solid #30363d", borderRadius: 8, padding: 16,
};
const metricCard: React.CSSProperties = {
  background: "#0d1117", border: "1px solid #21262d", borderRadius: 4, padding: "10px 12px", textAlign: "center" as const,
};
const sectionTitle: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.6)", letterSpacing: "0.08em",
  textTransform: "uppercase" as const, marginBottom: 12, fontFamily: "monospace",
};
const tabStyle = (active: boolean): React.CSSProperties => ({
  padding: "8px 16px", fontSize: 11, fontWeight: 700, fontFamily: "monospace", letterSpacing: "0.06em",
  color: active ? "#3b82f6" : "rgba(255,255,255,0.5)",
  background: "none", borderTop: "none", borderLeft: "none", borderRight: "none",
  borderBottomStyle: "solid" as const, borderBottomWidth: 2,
  borderBottomColor: active ? "#3b82f6" : "transparent", cursor: "pointer", transition: "color 0.15s",
});
const btnPrimary: React.CSSProperties = {
  background: "linear-gradient(135deg, #3b82f6, #2563eb)", color: "#fff", border: "none",
  borderRadius: 6, padding: "8px 20px", fontWeight: 700, fontSize: 11, fontFamily: "monospace", cursor: "pointer",
};
const btnSecondary: React.CSSProperties = {
  background: "#21262d", border: "1px solid #30363d", borderRadius: 4, padding: "6px 14px",
  color: "rgba(255,255,255,0.7)", fontSize: 10, fontWeight: 600, fontFamily: "monospace", cursor: "pointer",
};

const SECTOR_COLORS: Record<string, string> = {
  Energy: "#ef4444", Seafood: "#22c55e", Shipping: "#3b82f6", Materials: "#f59e0b",
  Banks: "#8b5cf6", Finance: "#7c3aed", Telecom: "#06b6d4", Consumer: "#ec4899",
  Industrial: "#f97316", Industrials: "#fb923c", Technology: "#14b8a6", Tech: "#a855f7",
  Investment: "#e879f9", "Renewable Energy": "#4ade80", Healthcare: "#f43f5e",
  Other: "#64748b", Default: "#94a3b8",
};
function sectorColor(s: string) { return SECTOR_COLORS[s] || SECTOR_COLORS.Default; }
function pct(v: number, d = 1) { return (Number(v) * 100).toFixed(d) + "%"; }
function fmtPrice(v: number) { const n = Number(v); if (isNaN(n)) return "—"; return n >= 1000 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2); }

// ============================================================================
// Main Component
// ============================================================================

export default function AlphaPage() {
  const { token, profile: profileName, login: authLogin, logout: authLogout } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);

  const [tab, setTab] = useState<"strategy" | "signals" | "explorer" | "simulator">("strategy");
  const [selectedModel, setSelectedModel] = useState<ModelId>("yggdrasil_v7");

  // Signals
  const [signals, setSignals] = useState<SignalRow[]>([]);
  const [signalsLoading, setSignalsLoading] = useState(false);
  const [signalDate, setSignalDate] = useState("");
  const [signalSort, setSignalSort] = useState<"signal" | "ticker" | "sector">("signal");
  const [signalSortAsc, setSignalSortAsc] = useState(false);
  const [sectorFilter, setSectorFilter] = useState("");

  // Explorer
  const [explorerTicker, setExplorerTicker] = useState("");
  const [tickerHistory, setTickerHistory] = useState<TickerSignalHistory | null>(null);
  const [explorerLoading, setExplorerLoading] = useState(false);
  const [explorerDays, setExplorerDays] = useState(365);
  const [selectedTradeDate, setSelectedTradeDate] = useState<string | null>(null);

  // Explorer ticker selector
  const [allStocks, setAllStocks] = useState<{ ticker: string; name: string; sector: string }[]>([]);
  const [explorerSearch, setExplorerSearch] = useState("");
  const [explorerSearchIdx, setExplorerSearchIdx] = useState(-1);
  const [showExplorerSectors, setShowExplorerSectors] = useState(false);
  const [explorerSectorFilter, setExplorerSectorFilter] = useState("");
  const [explorerSectorSort, setExplorerSectorSort] = useState<"name" | "alpha">("name");
  const [expandedExplorerSectors, setExpandedExplorerSectors] = useState<Set<string>>(new Set());

  // Simulator
  const [simTicker, setSimTicker] = useState("ABG");
  const simHasManuallyChanged = useRef(false);
  const [simDays, setSimDays] = useState(730);
  const [simData, setSimData] = useState<{ ticker: string; sector: string; input: SimInputBar[]; model: string } | null>(null);
  const [simLoading, setSimLoading] = useState(false);
  const [simPlayIdx, setSimPlayIdx] = useState(-1);
  const [simIsPlaying, setSimIsPlaying] = useState(false);
  const [simSpeed, setSimSpeed] = useState(5);
  const simIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const explorerPreloadedTicker = useRef<string | null>(null);
  const [simSearch, setSimSearch] = useState("");
  const [simSearchIdx, setSimSearchIdx] = useState(-1);
  const [simShowSectors, setSimShowSectors] = useState(false);
  const [simSectorFilter, setSimSectorFilter] = useState("");
  const [simSectorSort, setSimSectorSort] = useState<"name" | "alpha">("name");
  const [simExpandedSectors, setSimExpandedSectors] = useState<Set<string>>(new Set());
  const [simSelectedTrade, setSimSelectedTrade] = useState<string | null>(null);
  const [simShowFilterHelp, setSimShowFilterHelp] = useState(false);
  const [simShowMLGuide, setSimShowMLGuide] = useState(false);
  const [explorerShowMLGuide, setExplorerShowMLGuide] = useState(false);
  // Parameter sweep
  const [simSweepOpen, setSimSweepOpen] = useState(false);
  const [simSweepRunning, setSimSweepRunning] = useState(false);
  const [simSweepProgress, setSimSweepProgress] = useState(0);
  const [simSweepResults, setSimSweepResults] = useState<{ params: SimParams; stats: SimStats }[]>([]);
  const [simSweepSortKey, setSimSweepSortKey] = useState<string>("sharpe");
  const [simSweepSortDir, setSimSweepSortDir] = useState<1 | -1>(-1);
  const [signalsShowMLGuide, setSignalsShowMLGuide] = useState(false);
  // Strategy params
  const [simEntry, setSimEntry] = useState(SIM_DEFAULTS.entryThreshold);
  const [simExit, setSimExit] = useState(SIM_DEFAULTS.exitThreshold);
  const [simStop, setSimStop] = useState(SIM_DEFAULTS.stopLossPct);
  const [simTP, setSimTP] = useState(SIM_DEFAULTS.takeProfitPct);
  const [simPosSize, setSimPosSize] = useState(SIM_DEFAULTS.positionSizePct);
  const [simMinHold, setSimMinHold] = useState(SIM_DEFAULTS.minHoldDays);
  const [simMaxHold, setSimMaxHold] = useState(SIM_DEFAULTS.maxHoldDays);
  const [simCooldown, setSimCooldown] = useState(SIM_DEFAULTS.cooldownBars);
  const [simCost, setSimCost] = useState(SIM_DEFAULTS.costBps);
  const [simMom, setSimMom] = useState<0 | 1 | 2 | 3>(SIM_DEFAULTS.momentumFilter);
  const [simVolGate, setSimVolGate] = useState<'off' | 'soft' | 'hard'>(SIM_DEFAULTS.volGate);
  const [simSma200, setSimSma200] = useState(SIM_DEFAULTS.sma200Require);
  const [simSma50, setSimSma50] = useState(SIM_DEFAULTS.sma50Require);
  const [simSmaExit, setSimSmaExit] = useState(SIM_DEFAULTS.smaExitOnCross);
  const [simValFilter, setSimValFilter] = useState(SIM_DEFAULTS.valuationFilter);

  // Portfolio Strategy
  const [portfolioBacktest, setPortfolioBacktest] = useState<PortfolioBacktestResult | null>(null);
  const [portfolioBacktestLoading, setPortfolioBacktestLoading] = useState(false);

  // Top Performers
  type TopPerformer = { ticker: string; name: string; sector: string; avg_nokvol: number; latestPred: number; trades: number; wins: number; totalPnl: number; avgPnl: number; winRate: number; avgMaxDrawdown: number; maxSingleDrawdown: number };
  const [topPerformers, setTopPerformers] = useState<TopPerformer[]>([]);
  const [topPerfLoading, setTopPerfLoading] = useState(false);

  // Best Stocks (walk-forward sweep)
  type BestStock = {
    rank: number; ticker: string; name: string; sector: string; avg_nokvol: number;
    bestParams: SimParams;
    stats: SimStats;
    trades: SimTrade[];
    windowsSelected?: number;
  };
  type ForwardTrade = SimTrade & { ticker: string };
  const [bestStocks, setBestStocks] = useState<BestStock[]>([]);
  const [allForwardTrades, setAllForwardTrades] = useState<ForwardTrade[]>([]);
  const [bestStocksLoading, setBestStocksLoading] = useState(false);
  const [bestStocksPending, setBestStocksPending] = useState(false);
  const [bestStocksMeta, setBestStocksMeta] = useState<{ computedAt?: string; universe?: number; combosPerTicker?: number; qualified?: number; windows?: number } | null>(null);
  const [paperTradingMode, setPaperTradingMode] = useState<'standard' | 'optimized'>('standard');
  const [expandedOptTicker, setExpandedOptTicker] = useState<string | null>(null);

  // Equity curve
  type EqCurvePoint = { date: string; value: number; positions: number };
  type EqCurveStats = { totalReturn: number; maxDrawdown: number; winRate: number; trades: number };
  type TradeLogEntry = { ticker: string; entryDate: string; exitDate: string; entryPrice: number; exitPrice: number; pnlPct: number; daysHeld: number; exitReason: 'signal' | 'stop' | 'time' };
  const [equityCurve, setEquityCurve] = useState<EqCurvePoint[]>([]);
  const [equityCurveStats, setEquityCurveStats] = useState<EqCurveStats | null>(null);
  const [tradeLog, setTradeLog] = useState<TradeLogEntry[]>([]);
  const [equityCurveLoading, setEquityCurveLoading] = useState(false);

  // ============================================================================
  // Auth
  // ============================================================================

  const handleLogin = async () => {
    if (!username.trim() || !password) return;
    setAuthLoading(true);
    setAuthError("");
    try {
      const res = await fetch("/api/portfolio/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      if (res.ok) {
        const data = await res.json();
        // Alpha Engine is restricted to oslettebak only
        if (data.profile !== "oslettebak") {
          setAuthError("Access denied");
          return;
        }
        authLogin(data.token, data.profile || "");
      } else { setAuthError("Invalid credentials"); }
    } catch { setAuthError("Connection error"); }
    setAuthLoading(false);
  };

  // ============================================================================
  // Fetchers
  // ============================================================================

  const fetchSignals = useCallback(async () => {
    if (!token) return;
    setSignalsLoading(true);
    try {
      const params = new URLSearchParams({ model: selectedModel });
      if (MODELS[selectedModel].type === "binary") params.set("mode", "latest_per_ticker");
      if (signalDate) params.set("date", signalDate);
      const res = await fetch(`/api/alpha/signals?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401) { authLogout(); return; }
      if (res.ok) {
        const data = await res.json();
        setSignals(data.signals || []);
        if (!signalDate && data.date) setSignalDate(data.date);
      }
    } catch (e) { console.error("Failed to fetch signals:", e); }
    setSignalsLoading(false);
  }, [token, signalDate, selectedModel, authLogout]);

  const fetchTickerHistory = useCallback(async (ticker: string) => {
    if (!token || !ticker) return;
    setExplorerLoading(true);
    try {
      const res = await fetch(`/api/alpha/signals/${ticker}?days=${explorerDays}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401) { authLogout(); return; }
      if (res.ok) setTickerHistory(await res.json());
    } catch (e) { console.error("Failed to fetch ticker history:", e); }
    setExplorerLoading(false);
  }, [token, explorerDays, authLogout]);

  const CACHE_KEY = "alpha_portfolio_backtest_v7";
  const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

  const runPortfolioBacktest = useCallback(async (force = false) => {
    if (!token) return;
    // Load from cache first (instant display)
    if (!force) {
      try {
        const raw = localStorage.getItem(CACHE_KEY);
        if (raw) {
          const { data, ts } = JSON.parse(raw);
          if (Date.now() - ts < CACHE_TTL_MS) {
            setPortfolioBacktest(data);
            return;
          }
        }
      } catch { /* ignore */ }
    }
    setPortfolioBacktestLoading(true);
    try {
      const res = await fetch("/api/alpha/portfolio-backtest", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (res.ok) {
        const data = await res.json();
        setPortfolioBacktest(data);
        try { localStorage.setItem(CACHE_KEY, JSON.stringify({ data, ts: Date.now() })); } catch { /* ignore */ }
      }
    } catch (e) { console.error("Portfolio backtest failed:", e); }
    setPortfolioBacktestLoading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // Effects
  useEffect(() => {
    if (token && tab === "signals") fetchSignals();
  }, [token, tab, fetchSignals]);

  useEffect(() => {
    if (token && tab === "explorer" && explorerTicker) {
      if (explorerPreloadedTicker.current === explorerTicker) {
        explorerPreloadedTicker.current = null; // consume the preload
        return; // skip API fetch — data already set from simulator
      }
      fetchTickerHistory(explorerTicker);
    }
  }, [token, tab, explorerTicker, fetchTickerHistory]);

  // Load portfolio backtest on login (from cache if available)
  useEffect(() => {
    if (token && !portfolioBacktest && !portfolioBacktestLoading) runPortfolioBacktest();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // Fetch top performers (cached 6h)
  const TOP_PERF_CACHE_KEY = "alpha_top_performers_v7_fwd21d";
  const TOP_PERF_CACHE_TTL = 6 * 60 * 60 * 1000;
  const fetchTopPerformers = useCallback(async (force = false) => {
    if (!token) return;
    if (!force) {
      try {
        const raw = localStorage.getItem(TOP_PERF_CACHE_KEY);
        if (raw) {
          const { data, ts } = JSON.parse(raw);
          if (Date.now() - ts < TOP_PERF_CACHE_TTL) { setTopPerformers(data); return; }
        }
      } catch { /* ignore */ }
    }
    setTopPerfLoading(true);
    try {
      const res = await fetch(`/api/alpha/top-performers?model=${selectedModel}`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const data = await res.json();
        setTopPerformers(data.topPerformers || []);
        try { localStorage.setItem(TOP_PERF_CACHE_KEY, JSON.stringify({ data: data.topPerformers || [], ts: Date.now() })); } catch { /* ignore */ }
      }
    } catch (e) { console.error("Top performers failed:", e); }
    setTopPerfLoading(false);
  }, [token]);

  useEffect(() => {
    if (token && topPerformers.length === 0 && !topPerfLoading) fetchTopPerformers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const BEST_STOCKS_CACHE_KEY = "alpha_best_stocks_v11_returns";
  const BEST_STOCKS_CACHE_TTL = 24 * 60 * 60 * 1000;
  const fetchBestStocks = useCallback(async (force = false) => {
    if (!token) return;
    if (!force) {
      try {
        const raw = localStorage.getItem(BEST_STOCKS_CACHE_KEY);
        if (raw) {
          const { data, meta, fwdTrades, ts } = JSON.parse(raw);
          if (Date.now() - ts < BEST_STOCKS_CACHE_TTL) { setBestStocks(data); setBestStocksMeta(meta); if (fwdTrades) setAllForwardTrades(fwdTrades); return; }
        }
      } catch { /* ignore */ }
    }
    setBestStocksLoading(true);
    try {
      const res = await fetch('/api/alpha/best-stocks', { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const d = await res.json();
        if (d.status === 'pending') {
          // Nightly precompute not done yet — auto-retry in 2 minutes
          setBestStocksPending(true);
          setBestStocksLoading(false);
          setTimeout(() => fetchBestStocks(true), 120_000);
          return;
        }
        setBestStocksPending(false);
        setBestStocks(d.bestStocks || []);
        setBestStocksMeta(d.meta || null);
        setAllForwardTrades(d.allForwardTrades || []);
        try { localStorage.setItem(BEST_STOCKS_CACHE_KEY, JSON.stringify({ data: d.bestStocks || [], meta: d.meta || null, fwdTrades: d.allForwardTrades || [], ts: Date.now() })); } catch { /* ignore */ }
      }
    } catch (e) { console.error("Best stocks failed:", e); }
    setBestStocksLoading(false);
  }, [token]);

  useEffect(() => {
    if (token && bestStocks.length === 0 && !bestStocksLoading) fetchBestStocks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const EQ_CACHE_KEY = `alpha_equity_curve_v3_fwd21d`;
  const EQ_CACHE_TTL = 6 * 60 * 60 * 1000;
  const fetchEquityCurve = useCallback(async (force = false) => {
    if (!token) return;
    if (!force) {
      try {
        const raw = localStorage.getItem(EQ_CACHE_KEY);
        if (raw) {
          const { curve, stats, tradeLog: tl, ts } = JSON.parse(raw);
          if (Date.now() - ts < EQ_CACHE_TTL) { setEquityCurve(curve); setEquityCurveStats(stats); if (tl) setTradeLog(tl); return; }
        }
      } catch { /* ignore */ }
    }
    setEquityCurveLoading(true);
    try {
      const res = await fetch(`/api/alpha/equity-curve?model=${selectedModel}`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const data = await res.json();
        setEquityCurve(data.equityCurve || []);
        setEquityCurveStats(data.stats || null);
        setTradeLog(data.tradeLog || []);
        try { localStorage.setItem(EQ_CACHE_KEY, JSON.stringify({ curve: data.equityCurve || [], stats: data.stats || null, tradeLog: data.tradeLog || [], ts: Date.now() })); } catch { /* ignore */ }
      }
    } catch (e) { console.error("Equity curve failed:", e); }
    setEquityCurveLoading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, selectedModel]);

  useEffect(() => {
    if (token && equityCurve.length === 0 && !equityCurveLoading) fetchEquityCurve();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // Load full stock list for Explorer search (no auth needed)
  useEffect(() => {
    fetch("/api/stocks?assetTypes=equity")
      .then(r => r.json())
      .then(data => {
        const stocks = (data.stocks || data)
          .filter((s: { ticker?: string; asset_type?: string }) =>
            s.ticker && !s.ticker.includes(".") && (s.asset_type === "equity" || !s.asset_type))
          .map((s: { ticker: string; name?: string; sector?: string }) => ({
            ticker: s.ticker,
            name: s.name || s.ticker,
            sector: s.sector || "Other",
          }))
          .sort((a: { ticker: string }, b: { ticker: string }) => a.ticker.localeCompare(b.ticker));
        setAllStocks(stocks);
      }).catch(() => {});
  }, []);

  // ============================================================================
  // Derived
  // ============================================================================

  const getSignal = (row: SignalRow) => {
    const sig = row.signals.find(s => s.model_id === selectedModel);
    return Number(sig?.confidence) || 0.5;
  };

  const sortedSignals = useMemo(() => {
    let filtered = sectorFilter ? signals.filter(s => s.sector === sectorFilter) : signals;
    return [...filtered].sort((a, b) => {
      const dir = signalSortAsc ? 1 : -1;
      if (signalSort === "ticker") return dir * a.ticker.localeCompare(b.ticker);
      if (signalSort === "sector") return dir * (a.sector || "").localeCompare(b.sector || "");
      return dir * (getSignal(a) - getSignal(b));
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signals, signalSort, signalSortAsc, sectorFilter, selectedModel]);

  const signalStats = useMemo(() => {
    if (!signals.length) return { strongBuy: 0, buy: 0, hold: 0, neutral: 0, sell: 0, strongSell: 0 };
    let sb = 0, b = 0, h = 0, n = 0, s = 0, ss = 0;
    for (const row of signals) {
      const conf = getSignal(row);
      const sig = row.signals.find(sr => sr.model_id === selectedModel);
      const pred = Number(sig?.predicted_return) || 0;
      if (conf >= 0.65 && pred > 0.01) sb++;
      else if (conf >= 0.55 && pred > 0) b++;
      else if (conf >= 0.55 && pred <= 0) h++;
      else if (conf >= 0.45) n++;
      else if (conf >= 0.35 && pred < 0) s++;
      else ss++;
    }
    return { strongBuy: sb, buy: b, hold: h, neutral: n, sell: s, strongSell: ss };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signals, selectedModel]);

  const sectors = useMemo(() => [...new Set(signals.map(s => s.sector).filter(Boolean))].sort(), [signals]);
  const availableTickers = signals.map(s => s.ticker).sort();

  // Trade thresholds & rules — user-adjustable, defaults match top-performers API
  const [TRADE_ENTRY_PCT, setTradeEntryPct] = useState(1.0);
  const [TRADE_EXIT_PCT,  setTradeExitPct]  = useState(0.25);
  const [tradeStopLossPct, setTradeStopLossPct] = useState(5.0); // stored as positive %, displayed as -X%
  const TRADE_STOP_LOSS = -(tradeStopLossPct / 100);
  const [TRADE_MIN_HOLD, setTradeMinHold] = useState(5);
  const [TRADE_MAX_HOLD, setTradeMaxHold] = useState(21);

  const explorerChartData = useMemo(() => {
    if (!tickerHistory) return [];
    const sigMap = new Map<string, { confidence: number; predicted_return: number }>();
    for (const sig of tickerHistory.signals) {
      if (sig.model_id === selectedModel) {
        sigMap.set(sig.signal_date.slice(0, 10), { confidence: sig.confidence, predicted_return: sig.predicted_return });
      }
    }

    const raw = tickerHistory.actualReturns.map(r => {
      const sigData = sigMap.get(r.date.slice(0, 10));
      const rawConf = sigData?.confidence ?? null;
      const cleanConf = rawConf != null && rawConf < 0.12 ? null : rawConf;
      // Use 21-day forward return from prices (daily signal, matches simulator)
      const predRet = (r as any).fwd_ret_21d ?? null;
      return {
        date: r.date.slice(0, 10),
        close: r.close,
        sma200: r.sma200 || null,
        sma50: r.sma50 || null,
        signal: cleanConf,
        predicted_return: predRet,
        pred_pct: predRet != null ? predRet * 100 : null, // percentage for chart display
        dist_sma200: r.dist_sma200 ?? null,
        tradeEntry: null as number | null,  // price at entry (for price chart overlay)
        tradeExit:  null as number | null,  // price at exit
        entryDot:   null as number | null,  // pred_pct at entry (for pred chart)
        exitDot:    null as number | null,  // pred_pct at exit
      };
    }).sort((a, b) => a.date.localeCompare(b.date));

    // ── Realistic trade simulation (matches top-performers API rules) ──
    // ENTER: prediction crosses UP through +1%
    // EXIT:  (1) -5% hard stop loss (daily close), (2) 21-day time stop,
    //        (3) signal drops below +0.25% AFTER minimum 5-day hold
    let inTrade = false;
    let entryIdx = 0;
    let entryPrice = 0;
    for (let i = 1; i < raw.length; i++) {
      const prev = raw[i - 1].pred_pct;
      const curr = raw[i].pred_pct;

      if (!inTrade) {
        if (prev != null && curr != null && prev < TRADE_ENTRY_PCT && curr >= TRADE_ENTRY_PCT) {
          raw[i].tradeEntry = raw[i].close;
          raw[i].entryDot = curr;
          inTrade = true;
          entryIdx = i;
          entryPrice = raw[i].close;
        }
      } else {
        const daysHeld = i - entryIdx;
        const priceReturn = (raw[i].close - entryPrice) / entryPrice;

        // (1) Hard stop loss: -5% from entry (no minimum hold)
        if (priceReturn <= TRADE_STOP_LOSS) {
          raw[i].tradeExit = raw[i].close;
          raw[i].exitDot = curr;
          inTrade = false;
        }
        // (2) Time stop: 21 trading days
        else if (daysHeld >= TRADE_MAX_HOLD) {
          raw[i].tradeExit = raw[i].close;
          raw[i].exitDot = curr;
          inTrade = false;
        }
        // (3) Signal exit — only after minimum hold period
        else if (daysHeld >= TRADE_MIN_HOLD && prev != null && curr != null
                 && prev > TRADE_EXIT_PCT && curr <= TRADE_EXIT_PCT) {
          raw[i].tradeExit = raw[i].close;
          raw[i].exitDot = curr;
          inTrade = false;
        }
      }
    }
    // Mark last bar as open position close-out
    if (inTrade && raw.length > 0) {
      raw[raw.length - 1].tradeExit = raw[raw.length - 1].close;
    }

    return raw;
  }, [tickerHistory, selectedModel, TRADE_ENTRY_PCT, TRADE_EXIT_PCT, TRADE_STOP_LOSS, TRADE_MIN_HOLD, TRADE_MAX_HOLD, tradeStopLossPct]);

  // ── Simulated trade log — tracks max intra-trade drawdown ──
  const explorerTrades = useMemo(() => {
    if (!explorerChartData.length) return [];
    const trades: { entryDate: string; exitDate: string; entryPrice: number; exitPrice: number; pnl: number; maxDrawdown: number; open?: boolean }[] = [];
    let inTrade = false, entryDate = '', entryPrice = 0, minPrice = 0;
    for (const d of explorerChartData) {
      if (d.tradeEntry && !inTrade) {
        inTrade = true; entryDate = d.date; entryPrice = d.close; minPrice = d.close;
      } else if (inTrade) {
        if (d.close < minPrice) minPrice = d.close;
        if (d.tradeExit) {
          const open = d.exitDot == null;
          const pnl = (d.close - entryPrice) / entryPrice;
          const maxDrawdown = (minPrice - entryPrice) / entryPrice;
          trades.push({ entryDate, exitDate: d.date, entryPrice, exitPrice: d.close, pnl, maxDrawdown, open });
          inTrade = false;
        }
      }
    }
    return trades;
  }, [explorerChartData]);

  // ── Trade connector line: dotted line from entry to exit for selected trade ──
  const selectedTrade = useMemo(() =>
    explorerTrades.find(t => t.entryDate === selectedTradeDate) ?? null,
  [explorerTrades, selectedTradeDate]);

  const chartDataWithLine = useMemo(() => {
    if (!selectedTrade) return explorerChartData;
    return explorerChartData.map(d => ({
      ...d,
      tradeLine: (d.date === selectedTrade.entryDate || d.date === selectedTrade.exitDate)
        ? d.close : null,
    }));
  }, [explorerChartData, selectedTrade]);

  // Explorer search dropdown
  const explorerSearchResults = useMemo(() => {
    if (!explorerSearch) return [];
    const q = explorerSearch.toUpperCase();
    return allStocks
      .filter(s => s.ticker.includes(q) || s.name.toUpperCase().includes(q))
      .slice(0, 10);
  }, [explorerSearch, allStocks]);

  // Explorer sector browser
  const explorerSectorGroups = useMemo(() => {
    const groups: Record<string, { ticker: string; name: string; sector: string }[]> = {};
    let stocks = allStocks;
    if (explorerSectorFilter) {
      const q = explorerSectorFilter.toUpperCase();
      stocks = stocks.filter(s => s.ticker.includes(q) || s.name.toUpperCase().includes(q));
    }
    for (const s of stocks) {
      if (!groups[s.sector]) groups[s.sector] = [];
      groups[s.sector].push(s);
    }
    if (explorerSectorSort === "alpha") {
      for (const sec of Object.keys(groups)) groups[sec].sort((a, b) => a.ticker.localeCompare(b.ticker));
    }
    return groups;
  }, [allStocks, explorerSectorFilter, explorerSectorSort]);

  const explorerSectorNames = useMemo(() =>
    Object.keys(explorerSectorGroups).sort(),
  [explorerSectorGroups]);

  // ============================================================================
  // Simulator: data fetch, engine, animation
  // ============================================================================

  // Fetch data on ticker/days change (NOT on param change)
  useEffect(() => {
    if (tab !== "simulator" || !simTicker || !token) return;
    setSimIsPlaying(false);
    setSimPlayIdx(-1);
    setSimLoading(true);
    const ctrl = new AbortController();
    fetch(`/api/alpha/simulator/${simTicker}?days=${simDays}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: ctrl.signal,
    })
      .then(r => { if (r.status === 401) { authLogout(); return null; } return r.ok ? r.json() : null; })
      .then(data => { if (data) setSimData(data); })
      .catch(() => {})
      .finally(() => setSimLoading(false));
    return () => ctrl.abort();
  }, [tab, simTicker, simDays, token, authLogout]);

  // Preload Explorer with Simulator data for instant tab switching
  useEffect(() => {
    if (!simData?.input?.length) return;
    const bars = simData.input;
    const actualReturns = bars.map((bar, i) => {
      const prevClose = i > 0 ? bars[i - 1].close : bar.close;
      const daily_return = prevClose > 0 ? (bar.close - prevClose) / prevClose : 0;
      const dist_sma200 = bar.sma200 && bar.sma200 > 0
        ? (bar.close - bar.sma200) / bar.sma200 : undefined;
      return {
        date: bar.date, close: bar.close,
        sma200: bar.sma200 ?? undefined, sma50: bar.sma50 ?? undefined,
        daily_return, dist_sma200,
        fwd_ret_21d: bar.mlPrediction, // read as (r as any).fwd_ret_21d in explorerChartData
      };
    });
    const signals = bars
      .filter(bar => bar.mlPrediction !== null)
      .map(bar => ({
        signal_date: bar.date, model_id: simData.model,
        signal_value: (bar.mlPrediction ?? 0) * 100,
        predicted_return: bar.mlPrediction ?? 0,
        confidence: bar.mlConfidence ?? 0.5,
      }));
    explorerPreloadedTicker.current = simData.ticker;
    setExplorerTicker(simData.ticker);
    setTickerHistory({ ticker: simData.ticker, sector: simData.sector, signals, actualReturns } as TickerSignalHistory);
  }, [simData]);

  // Parameter sweep — runs all combinations client-side
  const runSweep = useCallback(async () => {
    if (!simData?.input?.length) return;
    setSimSweepRunning(true);
    setSimSweepProgress(0);
    setSimSweepResults([]);

    const entryVals = [0, 0.5, 1.0, 2.0];
    const stopVals  = [3, 5, 8];
    const holdVals  = [10, 21, 30];
    const volVals   = ['off', 'hard'] as const;
    const smaVals   = [false, true];
    const momVals   = [0, 2] as const;

    const combos: SimParams[] = [];
    for (const entry of entryVals)
      for (const stop of stopVals)
        for (const hold of holdVals)
          for (const vol of volVals)
            for (const sma of smaVals)
              for (const mom of momVals)
                combos.push({
                  entryThreshold: entry, exitThreshold: simExit,
                  stopLossPct: stop, takeProfitPct: simTP,
                  positionSizePct: simPosSize, minHoldDays: simMinHold,
                  maxHoldDays: hold, cooldownBars: simCooldown, costBps: simCost,
                  momentumFilter: mom, volGate: vol,
                  sma200Require: sma, sma50Require: false, smaExitOnCross: false, valuationFilter: false,
                });

    const results: { params: SimParams; stats: SimStats }[] = [];
    const BATCH = 40;
    for (let i = 0; i < combos.length; i += BATCH) {
      const slice = combos.slice(i, i + BATCH);
      for (const p of slice) {
        const r = runMLSimulation(simData.input, p);
        if (r.stats.trades >= 5) results.push({ params: p, stats: r.stats });
      }
      setSimSweepProgress(Math.round(Math.min(i + BATCH, combos.length) / combos.length * 100));
      await new Promise(res => setTimeout(res, 0));
    }

    results.sort((a, b) => b.stats.sharpe - a.stats.sharpe);
    setSimSweepResults(results.slice(0, 50));
    setSimSweepRunning(false);
  }, [simData, simExit, simTP, simPosSize, simMinHold, simCooldown, simCost]);

  // Run engine client-side (instant on param change)
  const simResult: SimResult | null = useMemo(() => {
    if (!simData?.input?.length) return null;
    return runMLSimulation(simData.input, {
      entryThreshold: simEntry, exitThreshold: simExit, stopLossPct: simStop,
      takeProfitPct: simTP, positionSizePct: simPosSize, minHoldDays: simMinHold,
      maxHoldDays: simMaxHold, cooldownBars: simCooldown, costBps: simCost,
      momentumFilter: simMom, volGate: simVolGate, sma200Require: simSma200,
      sma50Require: simSma50, smaExitOnCross: simSmaExit, valuationFilter: simValFilter,
    });
  }, [simData, simEntry, simExit, simStop, simTP, simPosSize, simMinHold, simMaxHold,
      simCooldown, simCost, simMom, simVolGate, simSma200, simSma50, simSmaExit, simValFilter]);

  // Reset playback when engine re-runs (param change)
  // On first load (ABG preload), jump to end so user sees finished sim
  useEffect(() => {
    setSimIsPlaying(false);
    if (!simHasManuallyChanged.current && simResult) {
      setSimPlayIdx(simResult.series.length - 1);
      simHasManuallyChanged.current = true;
    } else {
      setSimPlayIdx(-1);
    }
  }, [simResult]);

  // Animation loop (copy from FX sim)
  useEffect(() => {
    if (simIntervalRef.current) clearInterval(simIntervalRef.current);
    if (!simIsPlaying || !simResult) return;
    simIntervalRef.current = setInterval(() => {
      setSimPlayIdx(prev => {
        const next = prev + simSpeed;
        if (next >= simResult.series.length - 1) {
          setSimIsPlaying(false);
          return simResult.series.length - 1;
        }
        return next;
      });
    }, 80);
    return () => { if (simIntervalRef.current) clearInterval(simIntervalRef.current); };
  }, [simIsPlaying, simSpeed, simResult]);

  // Derived animation state
  const simLive = useMemo(() =>
    simResult?.series.slice(0, Math.max(0, simPlayIdx + 1)) ?? [],
  [simResult, simPlayIdx]);
  const simCurrent = simLive.length > 0 ? simLive[simLive.length - 1] : null;
  const simDoneTrades = useMemo(() =>
    simResult?.trades.filter(t => simCurrent && t.exitDate <= simCurrent.date) ?? [],
  [simResult, simCurrent]);
  const simLiveStats = useMemo(() =>
    computeProgressiveStats(simDoneTrades, simLive),
  [simDoneTrades, simLive]);
  const simProgress = simResult ? Math.max(0, (simPlayIdx / Math.max(1, simResult.series.length - 1)) * 100) : 0;

  // Optimized equity curve — computed client-side from bestStocks trades
  const optimizedEqData = useMemo(() => {
    // Use server-computed allForwardTrades (walk-forward OOS) if available,
    // fall back to per-stock trades for backwards compat
    const allTrades: ForwardTrade[] = allForwardTrades.length > 0
      ? allForwardTrades
      : bestStocks.flatMap(s => (s.trades || []).map(t => ({ ...t, ticker: s.ticker })));
    if (allTrades.length === 0) return null;

    // Collect all unique dates from trade events
    const dateSet = new Set<string>();
    for (const t of allTrades) {
      dateSet.add(t.entryDate);
      dateSet.add(t.exitDate);
    }
    const sortedDates = Array.from(dateSet).sort();

    let equity = 100;
    let peak = 100;
    let maxDD = 0;
    const SLOT_WEIGHT = 0.10; // 10% per position slot
    const curve: { date: string; value: number; positions: number }[] = [];

    for (const date of sortedDates) {
      // Realize pnl for all trades exiting today
      const exiting = allTrades.filter(t => t.exitDate === date);
      for (const t of exiting) {
        equity *= 1 + t.pnlPct * SLOT_WEIGHT;
      }
      // Active positions: open at this point
      const active = allTrades.filter(t => t.entryDate <= date && t.exitDate > date).length;
      curve.push({ date, value: Math.round(equity * 10000) / 10000, positions: active });
      if (equity > peak) peak = equity;
      const dd = (peak - equity) / peak * 100;
      if (dd > maxDD) maxDD = dd;
    }

    const wins = allTrades.filter(t => t.pnlPct > 0).length;
    return {
      curve,
      stats: {
        totalReturn: equity - 100,
        maxDrawdown: -maxDD,
        winRate: allTrades.length > 0 ? (wins / allTrades.length) * 100 : 0,
        trades: allTrades.length,
      },
      allTrades,
    };
  }, [bestStocks]);

  // Sim ticker search
  const simSearchResults = useMemo(() => {
    if (!simSearch) return [];
    const q = simSearch.toUpperCase();
    return allStocks.filter(s => s.ticker.includes(q) || s.name.toUpperCase().includes(q)).slice(0, 10);
  }, [simSearch, allStocks]);

  // Sim sector browser
  const simSectorGroups = useMemo(() => {
    const groups: Record<string, { ticker: string; name: string; sector: string }[]> = {};
    let stocks = allStocks;
    if (simSectorFilter) {
      const q = simSectorFilter.toUpperCase();
      stocks = stocks.filter(s => s.ticker.includes(q) || s.name.toUpperCase().includes(q));
    }
    for (const s of stocks) {
      if (!groups[s.sector]) groups[s.sector] = [];
      groups[s.sector].push(s);
    }
    if (simSectorSort === "alpha") {
      for (const sec of Object.keys(groups)) groups[sec].sort((a, b) => a.ticker.localeCompare(b.ticker));
    }
    return groups;
  }, [allStocks, simSectorFilter, simSectorSort]);

  const simSectorNames = useMemo(() =>
    Object.keys(simSectorGroups).sort(),
  [simSectorGroups]);

  // ============================================================================
  // LOGIN SCREEN
  // ============================================================================

  if (!token) {
    return (
      <main style={{ minHeight: "100vh", background: "#0a0a0a", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <form onSubmit={e => { e.preventDefault(); handleLogin(); }}
          style={{ ...cardStyle, width: 380, padding: 32 }}>
          <div style={{ textAlign: "center", marginBottom: 24 }}>
            <div style={{ fontSize: 20, fontWeight: 800, fontFamily: "monospace", letterSpacing: "-0.02em" }}>ALPHA ENGINE</div>
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", fontFamily: "monospace", marginTop: 4 }}>Cross-Sectional Portfolio Strategy</div>
          </div>
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", fontFamily: "monospace", marginBottom: 4 }}>USERNAME</div>
            <input value={username} onChange={e => setUsername(e.target.value)}
              style={{ width: "100%", background: "#0d1117", border: "1px solid #30363d", borderRadius: 5, padding: "8px 10px", color: "#fff", fontFamily: "monospace", fontSize: 12, boxSizing: "border-box" as const }}
              placeholder="Enter username" autoComplete="username" required />
          </div>
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", fontFamily: "monospace", marginBottom: 4 }}>PASSWORD</div>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)}
              style={{ width: "100%", background: "#0d1117", border: "1px solid #30363d", borderRadius: 5, padding: "8px 10px", color: "#fff", fontFamily: "monospace", fontSize: 12, boxSizing: "border-box" as const }}
              placeholder="Enter password" autoComplete="current-password" required />
          </div>
          <button type="submit"
            style={{ ...btnPrimary, width: "100%", padding: "11px 0", fontSize: 13, opacity: (authLoading || !password || !username.trim()) ? 0.5 : 1 }}
            disabled={authLoading || !password || !username.trim()}>
            {authLoading ? "Authenticating..." : "Access Alpha Engine"}
          </button>
          {authError && <div style={{ color: "#ef4444", fontSize: 11, marginTop: 12, fontFamily: "monospace", textAlign: "center" }}>{authError}</div>}
          <div style={{ textAlign: "center", marginTop: 20 }}>
            <Link href="/" style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", textDecoration: "none", fontFamily: "monospace" }}>← Back to Home</Link>
          </div>
        </form>
      </main>
    );
  }

  // ============================================================================
  // AUTHENTICATED RENDER
  // ============================================================================

  const loading = signalsLoading || explorerLoading || portfolioBacktestLoading;

  // Professional ML guide button style
  const guideButtonStyle = (active: boolean): React.CSSProperties => ({
    display: "inline-flex", alignItems: "center", gap: 5,
    fontSize: 9, fontFamily: "monospace", fontWeight: 600, letterSpacing: "0.04em",
    color: active ? "#fff" : "rgba(255,255,255,0.5)",
    background: active ? "linear-gradient(135deg, rgba(59,130,246,0.2), rgba(16,185,129,0.15))" : "rgba(255,255,255,0.03)",
    border: `1px solid ${active ? "rgba(59,130,246,0.5)" : "#30363d"}`,
    borderRadius: 4, padding: "5px 12px", cursor: "pointer",
    transition: "all 0.15s ease",
  });

  // Shared ML Signal explanation panel
  const renderMLGuidePanel = (show: boolean) => show ? (
    <div style={{ marginTop: 10, padding: 16, background: "#0d1117", border: "1px solid #30363d", borderRadius: 6, fontSize: 10, fontFamily: "monospace", color: "rgba(255,255,255,0.6)", lineHeight: 1.7 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 20 }}>
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#3b82f6", letterSpacing: "0.06em", marginBottom: 8 }}>WHAT IS THE ML SIGNAL?</div>
          <div>The ML prediction is a <span style={{ color: "#fff" }}>1-month forward return forecast</span> for each stock, generated daily by an ensemble of two gradient-boosted tree models:</div>
          <div style={{ marginTop: 6 }}><span style={{ color: "#10b981" }}>XGBoost (50%)</span> + <span style={{ color: "#10b981" }}>LightGBM (50%)</span></div>
          <div style={{ marginTop: 6 }}>The models are trained on <span style={{ color: "#fff" }}>19 factors</span> across 200+ OSE stocks:</div>
          <div style={{ marginTop: 4, color: "rgba(255,255,255,0.45)" }}>
            <div><span style={{ color: "#f59e0b" }}>Technical (11):</span> Momentum (1m/6m/11m/36m), change in momentum, volatility (1m/3m/12m), max return, beta, idiosyncratic vol, January dummy</div>
            <div style={{ marginTop: 2 }}><span style={{ color: "#f59e0b" }}>Fundamental (8):</span> Book/Market, Earnings/Price, dividend yield, sales/price, sales growth, market cap, NOK volume</div>
          </div>
          <div style={{ marginTop: 6 }}>Output: a <span style={{ color: "#fff" }}>predicted % return</span> (e.g. +2.5% means the model expects ~2.5% gain over the next month) plus confidence percentiles (p05–p95).</div>
        </div>
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#10b981", letterSpacing: "0.06em", marginBottom: 8 }}>WHY IS IT TRUSTED?</div>
          <div><span style={{ color: "#fff" }}>Cross-sectional ranking</span> — The model ranks stocks against each other based on factor exposure, which is more stable and less prone to overfitting than predicting absolute prices.</div>
          <div style={{ marginTop: 6 }}><span style={{ color: "#fff" }}>Walk-forward validation</span> — Trained on rolling historical windows, tested on out-of-sample future data. No look-ahead bias.</div>
          <div style={{ marginTop: 6 }}><span style={{ color: "#fff" }}>Factor-based, not pattern-based</span> — Uses well-documented academic factors (Fama-French momentum, value, size) that have worked for decades across global markets.</div>
          <div style={{ marginTop: 6 }}><span style={{ color: "#fff" }}>Ensemble averaging</span> — Two different model architectures (XGBoost + LightGBM) reduce model-specific bias.</div>
          <div style={{ marginTop: 6 }}><span style={{ color: "#fff" }}>Daily recalibration</span> — Signals update daily with fresh price and factor data.</div>
        </div>
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#ef4444", letterSpacing: "0.06em", marginBottom: 8 }}>RISKS & LIMITATIONS</div>
          <div><span style={{ color: "#fff" }}>Not a crystal ball</span> — Even good signals are right only ~55-65% of the time. Edge comes from many trades, not any single prediction.</div>
          <div style={{ marginTop: 6 }}><span style={{ color: "#fff" }}>Regime changes</span> — In market crises, historical factor relationships can break down. Momentum crashes and value traps are real risks.</div>
          <div style={{ marginTop: 6 }}><span style={{ color: "#fff" }}>OSE-specific</span> — Trained on Oslo Stock Exchange only (~200 stocks). Small universe means less diversification.</div>
          <div style={{ marginTop: 6 }}><span style={{ color: "#fff" }}>Survivorship bias</span> — Only includes currently listed stocks. Delisted companies are excluded.</div>
          <div style={{ marginTop: 6 }}><span style={{ color: "#fff" }}>Transaction costs</span> — Real-world slippage and market impact may exceed the 10bp default cost assumption.</div>
          <div style={{ marginTop: 6 }}><span style={{ color: "#fff" }}>Past ≠ Future</span> — Backtested results always look better than live trading. Use signals as one input among many.</div>
        </div>
      </div>
    </div>
  ) : null;

  return (
    <main style={{ padding: "20px 16px", maxWidth: 1400, margin: "0 auto" }}>
      {/* Loading bar */}
      {loading && (
        <>
          <style dangerouslySetInnerHTML={{ __html: "@keyframes alphaSlide{0%{transform:translateX(-100%)}100%{transform:translateX(200%)}}" }} />
          <div style={{ position: "fixed", top: 0, left: 0, right: 0, height: 3, zIndex: 100, background: "#0d1117", overflow: "hidden" }}>
            <div style={{ height: "100%", width: "40%", background: "linear-gradient(90deg, transparent, #3b82f6, #10b981, transparent)", animation: "alphaSlide 1.2s ease-in-out infinite" }} />
          </div>
        </>
      )}

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div>
          <Link href="/" style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", textDecoration: "none", fontFamily: "monospace" }}>← Home</Link>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: "4px 0 0", fontFamily: "monospace", letterSpacing: "-0.02em" }}>
            Alpha Engine <span style={{ color: "#3b82f6", fontSize: 14, fontWeight: 800, letterSpacing: "0.08em" }}>CROSS-SECTIONAL</span>
          </h1>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", fontFamily: "monospace", marginTop: 2 }}>
            Monthly rebalancing · Top quintile overweight · 6-factor composite alpha
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {profileName && (
            <span style={{ fontSize: 10, color: "#3b82f6", fontFamily: "monospace", fontWeight: 600, padding: "2px 8px", background: "rgba(59,130,246,0.1)", borderRadius: 3, border: "1px solid rgba(59,130,246,0.2)" }}>
              {profileName}
            </span>
          )}
          <button onClick={() => { authLogout(); setUsername(""); setPassword(""); }} style={{ ...btnSecondary, fontSize: 10 }}>Sign Out</button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, borderBottom: "1px solid #30363d", marginBottom: 20 }}>
        {[
          { id: "strategy" as const, label: "PORTFOLIO STRATEGY" },
          { id: "signals" as const, label: "SIGNALS" },
          { id: "explorer" as const, label: "EXPLORER" },
          { id: "simulator" as const, label: "SIMULATOR" },
        ].map(t => <button key={t.id} onClick={() => setTab(t.id)} style={tabStyle(tab === t.id)}>{t.label}</button>)}
      </div>

      {/* ================================================================ */}
      {/* PORTFOLIO STRATEGY TAB                                           */}
      {/* ================================================================ */}
      {tab === "strategy" && (
        <div>

          {/* ── Simulator Teaser ── */}
          <div
            onClick={() => setTab("simulator")}
            style={{
              marginBottom: 16, padding: "16px 20px", cursor: "pointer",
              background: "linear-gradient(135deg, rgba(59,130,246,0.06) 0%, rgba(16,185,129,0.04) 100%)",
              border: "1px solid rgba(59,130,246,0.2)", borderRadius: 8,
              display: "flex", alignItems: "center", gap: 16,
              transition: "border-color 0.2s, box-shadow 0.2s",
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = "#3b82f6"; e.currentTarget.style.boxShadow = "0 4px 20px rgba(59,130,246,0.12)"; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = "rgba(59,130,246,0.2)"; e.currentTarget.style.boxShadow = "none"; }}
          >
            <div style={{ fontSize: 28, lineHeight: 1 }}>▶</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: "#3b82f6", fontFamily: "monospace", letterSpacing: "0.04em", marginBottom: 3 }}>
                ML TRADING SIMULATOR
              </div>
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.55)", fontFamily: "monospace", lineHeight: 1.5 }}>
                Animated backtest of ML prediction signals with 15 tunable parameters. Configure entry/exit thresholds, stops, momentum filters, SMA gates, and valuation screens — watch trades execute in real-time with equity curve vs OBX.
              </div>
            </div>
            <div style={{ fontSize: 10, fontWeight: 700, color: "#3b82f6", fontFamily: "monospace", whiteSpace: "nowrap" as const, padding: "6px 14px", background: "rgba(59,130,246,0.1)", border: "1px solid rgba(59,130,246,0.3)", borderRadius: 5 }}>
              OPEN SIMULATOR →
            </div>
          </div>

          {/* ══════════════════════════════════════════════════════════════════
              OPTIMIZED TOP 10 — parameter-sweep optimized best stocks 365d
          ══════════════════════════════════════════════════════════════════ */}
          <div style={{ ...cardStyle, marginBottom: 16, borderLeft: "3px solid #10b981" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 800, fontFamily: "monospace", letterSpacing: "0.04em", color: "#10b981" }}>
                  OPTIMIZED TOP 10 — Last 365 Days
                </div>
                <div style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", fontFamily: "monospace", marginTop: 3 }}>
                  {bestStocksMeta
                    ? `Best 365d returns · ${bestStocksMeta.universe ?? '?'} tickers · ${bestStocksMeta.qualified ?? bestStocks.length} qualified · entry >0.5% · ranked by return × Sharpe · 24h cache`
                    : "Best 365d returns · entry >0.5% · ranked by return × Sharpe · top 50 liquid OSE"}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                {bestStocksMeta?.computedAt && (
                  <span style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", fontFamily: "monospace" }}>
                    {new Date(bestStocksMeta.computedAt).toLocaleDateString("no-NO", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </span>
                )}
                <button onClick={() => fetchBestStocks(true)} disabled={bestStocksLoading}
                  style={{ ...btnSecondary, fontSize: 10, padding: "5px 12px", opacity: bestStocksLoading ? 0.5 : 1 }}>
                  {bestStocksLoading ? "Computing..." : "Refresh"}
                </button>
              </div>
            </div>

            {bestStocksLoading && (
              <div style={{ textAlign: "center", padding: 32, color: "rgba(255,255,255,0.3)", fontFamily: "monospace", fontSize: 11 }}>
                Loading cached rankings...
              </div>
            )}
            {bestStocksPending && !bestStocksLoading && (
              <div style={{ textAlign: "center", padding: 32, fontFamily: "monospace" }}>
                <div style={{ color: "#f59e0b", fontSize: 12, fontWeight: 700, marginBottom: 6 }}>Nightly precompute not ready yet</div>
                <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 10 }}>Walk-forward results compute each night at 02:00 UTC via GitHub Actions.<br/>Auto-retrying in 2 minutes...</div>
              </div>
            )}
            {!bestStocksLoading && !bestStocksPending && bestStocks.length === 0 && (
              <div style={{ textAlign: "center", padding: 32, color: "rgba(255,255,255,0.3)", fontFamily: "monospace", fontSize: 11 }}>
                No cached results — trigger a refresh or wait for tonight&apos;s scheduled run.
              </div>
            )}
            {bestStocks.length > 0 && (
              <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "monospace" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid #30363d" }}>
                    {["#", "Ticker", "Sector", "ML Pred", "Sharpe", "WinRate", "AvgPnL", "MaxDD", "Trades", "Action"].map((h, hi) => (
                      <th key={h} style={{ fontSize: 9, fontWeight: 600, color: "rgba(255,255,255,0.5)", padding: "5px 8px", textAlign: hi < 3 ? "left" as const : "right" as const, letterSpacing: "0.04em" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {bestStocks.map((s, i) => {
                    const p = s.bestParams;
                    const st = s.stats;
                    const sharpeColor = st.sharpe >= 1.5 ? "#10b981" : st.sharpe >= 0.8 ? "#f59e0b" : "#ef4444";
                    const rowBg = i < 3 ? "rgba(16,185,129,0.04)" : "transparent";
                    return (
                      <tr key={s.ticker}
                        style={{ borderBottom: "1px solid rgba(48,54,61,0.3)", background: rowBg, transition: "background 0.1s" }}
                        onMouseEnter={e => (e.currentTarget.style.background = "rgba(16,185,129,0.08)")}
                        onMouseLeave={e => (e.currentTarget.style.background = rowBg)}>
                        <td style={{ padding: "6px 8px", fontSize: 11, fontWeight: 700, color: i === 0 ? "#10b981" : i < 3 ? "rgba(255,255,255,0.6)" : "rgba(255,255,255,0.35)" }}>#{s.rank}</td>
                        <td style={{ padding: "6px 8px", fontSize: 12, fontWeight: 800, color: "#10b981" }}>{s.ticker}</td>
                        <td style={{ padding: "6px 8px", textAlign: "right" }}>
                          <span style={{ fontSize: 9, fontWeight: 700, color: sectorColor(s.sector) }}>{s.sector?.slice(0, 10) ?? "—"}</span>
                        </td>
                        <td style={{ padding: "6px 8px", fontSize: 11, fontWeight: 700, textAlign: "right",
                          color: (s as unknown as { currentPred?: number }).currentPred != null && (s as unknown as { currentPred: number }).currentPred >= 1.0 ? "#10b981" : "#f59e0b" }}>
                          {(s as unknown as { currentPred?: number }).currentPred != null
                            ? `+${(s as unknown as { currentPred: number }).currentPred.toFixed(2)}%`
                            : "—"}
                        </td>
                        <td style={{ padding: "6px 8px", fontSize: 12, fontWeight: 800, textAlign: "right", color: sharpeColor }}>{st.sharpe.toFixed(2)}</td>
                        <td style={{ padding: "6px 8px", fontSize: 11, fontWeight: 700, textAlign: "right", color: st.winRate >= 0.6 ? "#10b981" : st.winRate >= 0.5 ? "#f59e0b" : "#ef4444" }}>
                          {(st.winRate * 100).toFixed(0)}%
                        </td>
                        <td style={{ padding: "6px 8px", fontSize: 11, fontWeight: 700, textAlign: "right", color: st.avgWinPct >= 0 ? "#10b981" : "#ef4444" }}>
                          {st.avgWinPct >= 0 ? "+" : ""}{(st.avgWinPct * 100).toFixed(1)}%
                        </td>
                        <td style={{ padding: "6px 8px", fontSize: 11, fontWeight: 600, textAlign: "right", color: "#ef4444" }}>
                          {(st.maxDrawdown * 100).toFixed(1)}%
                        </td>
                        <td style={{ padding: "6px 8px", fontSize: 10, textAlign: "right", color: "rgba(255,255,255,0.5)" }}>{st.trades}</td>
                        <td style={{ padding: "6px 8px", textAlign: "right" }}>
                          <button
                            onClick={() => {
                              setSimTicker(s.ticker);
                              setSimEntry(1.0);
                              setSimExit(0.25);
                              setSimStop(5.0);
                              setSimMaxHold(21);
                              setSimVolGate('off');
                              setSimMom(0);
                              setTab("simulator");
                            }}
                            style={{ ...btnSecondary, fontSize: 9, padding: "3px 8px", color: "#10b981", borderColor: "rgba(16,185,129,0.3)" }}>
                            SIMULATE
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* ══════════════════════════════════════════════════════════════════
              SECTION 1 — ML SIGNAL PAPER TRADING  (research / exploration)
          ══════════════════════════════════════════════════════════════════ */}
          <div style={{ ...cardStyle, marginBottom: 0, borderColor: "#2d3748", borderLeft: "3px solid #f59e0b" }}>
            {/* Section header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 800, fontFamily: "monospace", letterSpacing: "0.04em", color: "#f59e0b" }}>
                  SECTION 1 — ML SIGNAL PAPER TRADING
                </div>
                <div style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", fontFamily: "monospace", marginTop: 3 }}>
                  Research tool · 12-month window · ML signals only · Simple rule-based trading
                </div>
              </div>
              <div style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.25)", borderRadius: 5, padding: "4px 10px", fontSize: 9, color: "#f59e0b", fontFamily: "monospace", fontWeight: 700 }}>
                EXPLORATORY
              </div>
            </div>

            {/* Context explanation */}
            <div style={{ background: "#0d1117", border: "1px solid #21262d", borderRadius: 6, padding: "10px 14px", marginBottom: 14, fontSize: 10, fontFamily: "monospace", lineHeight: 1.7, color: "rgba(255,255,255,0.55)" }}>
              <span style={{ color: "#f59e0b", fontWeight: 700 }}>What this shows:</span> Per-stock paper trading using <em>only</em> the raw ML prediction signal (Yggdrasil v7).
              Entry triggered when the predicted return crosses above <span style={{ color: "#e6edf3" }}>+1%</span>,
              exit on signal drop or hard rules (−5% stop loss, 21-day max hold).
              Covers the <span style={{ color: "#e6edf3" }}>last 12 months</span> per stock individually — each stock is run independently, not as a portfolio.{" "}
              <span style={{ color: "#ef4444", fontWeight: 600 }}>Limitations:</span> short history, no portfolio construction, no diversification logic, survivor-selection bias in ranking.
              Use this to <span style={{ color: "#e6edf3" }}>research which stocks the signal works best on</span> and to explore individual trading patterns in the Explorer tab.
            </div>

            {/* ── TOP 10 ALPHA STOCKS ── */}
            <div style={{ ...cardStyle, marginBottom: 16 }}>
              {/* Header row: title + toggle + refresh */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <div>
                  <div style={sectionTitle}>TOP 10 ALPHA STOCKS — Last 12 Months (Top 50 Liquid OSE)</div>
                  <div style={{ fontSize: 10, fontFamily: "monospace", color: "rgba(255,255,255,0.3)", marginTop: 2 }}>
                    {paperTradingMode === 'standard'
                      ? "Entry: ML pred >+1% · Exit: signal <+0.25% (min 5d hold) OR −5% stop loss OR 21d max hold"
                      : "Optimized params per ticker · 108-combo walk-forward sweep · ranked by Sharpe · click row for trade log"}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  {/* Mode toggle */}
                  <div style={{ display: "flex", border: "1px solid #30363d", borderRadius: 5, overflow: "hidden" }}>
                    {(['standard', 'optimized'] as const).map(mode => (
                      <button key={mode} onClick={() => setPaperTradingMode(mode)}
                        style={{
                          padding: "4px 12px", fontSize: 9, fontFamily: "monospace", fontWeight: 700,
                          letterSpacing: "0.05em", border: "none", cursor: "pointer",
                          background: paperTradingMode === mode ? (mode === 'optimized' ? "#10b981" : "#3b82f6") : "#0d1117",
                          color: paperTradingMode === mode ? "#000" : "rgba(255,255,255,0.4)",
                          transition: "all 0.15s",
                        }}>
                        {mode.toUpperCase()}
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={() => paperTradingMode === 'standard' ? fetchTopPerformers(true) : fetchBestStocks(true)}
                    disabled={paperTradingMode === 'standard' ? topPerfLoading : bestStocksLoading}
                    style={{ ...btnSecondary, fontSize: 10, padding: "5px 12px", opacity: (paperTradingMode === 'standard' ? topPerfLoading : bestStocksLoading) ? 0.5 : 1 }}>
                    {(paperTradingMode === 'standard' ? topPerfLoading : bestStocksLoading) ? "Loading..." : "Refresh"}
                  </button>
                </div>
              </div>

              {/* ── STANDARD VIEW ── */}
              {paperTradingMode === 'standard' && (
                <>
                  {topPerfLoading && (
                    <div style={{ textAlign: "center", padding: 32, color: "rgba(255,255,255,0.3)", fontFamily: "monospace", fontSize: 11 }}>
                      Simulating trades across liquid OSE universe...
                    </div>
                  )}
                  {!topPerfLoading && topPerformers.length === 0 && (
                    <div style={{ textAlign: "center", padding: 32, color: "rgba(255,255,255,0.3)", fontFamily: "monospace", fontSize: 11 }}>
                      Loading signal data...
                    </div>
                  )}
                  {topPerformers.length > 0 && (
                    <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "monospace" }}>
                      <thead>
                        <tr style={{ borderBottom: "1px solid #30363d" }}>
                          {["#", "Ticker", "Name", "Sector", "ML Pred", "Trades", "Win Rate", "Avg P&L", "Avg Max DD", "Total Return", "Liquidity"].map((h, hi) => (
                            <th key={h} style={{ fontSize: 9, fontWeight: 600, color: "rgba(255,255,255,0.5)", padding: "5px 8px", textAlign: hi < 2 ? "left" as const : "right" as const, letterSpacing: "0.04em" }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {topPerformers.map((p, i) => (
                          <tr key={p.ticker}
                            style={{ borderBottom: "1px solid rgba(48,54,61,0.3)", cursor: "pointer", transition: "background 0.1s" }}
                            onClick={() => { setExplorerTicker(p.ticker); setTab("explorer"); setExplorerDays(365); }}
                            onMouseEnter={e => (e.currentTarget.style.background = "rgba(59,130,246,0.06)")}
                            onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                            <td style={{ padding: "6px 8px", fontSize: 11, fontWeight: 700, color: i === 0 ? "#f59e0b" : i < 3 ? "rgba(255,255,255,0.6)" : "rgba(255,255,255,0.35)" }}>#{i + 1}</td>
                            <td style={{ padding: "6px 8px", fontSize: 12, fontWeight: 800, color: "#3b82f6" }}>{p.ticker}</td>
                            <td style={{ padding: "6px 8px", fontSize: 10, color: "rgba(255,255,255,0.6)", textAlign: "right", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</td>
                            <td style={{ padding: "6px 8px", textAlign: "right" }}>
                              <span style={{ fontSize: 9, fontWeight: 700, color: sectorColor(p.sector) }}>{p.sector}</span>
                            </td>
                            <td style={{ padding: "6px 8px", fontSize: 11, fontWeight: 700, textAlign: "right", color: p.latestPred >= 1 ? "#10b981" : p.latestPred >= 0 ? "#f59e0b" : "#ef4444" }}>
                              {p.latestPred >= 0 ? "+" : ""}{p.latestPred.toFixed(1)}%
                            </td>
                            <td style={{ padding: "6px 8px", fontSize: 10, textAlign: "right", color: "rgba(255,255,255,0.6)" }}>{p.trades}</td>
                            <td style={{ padding: "6px 8px", fontSize: 11, fontWeight: 700, textAlign: "right", color: p.winRate >= 70 ? "#10b981" : p.winRate >= 50 ? "#f59e0b" : "#ef4444" }}>
                              {p.winRate.toFixed(0)}%
                            </td>
                            <td style={{ padding: "6px 8px", fontSize: 11, fontWeight: 700, textAlign: "right", color: p.avgPnl >= 0 ? "#10b981" : "#ef4444" }}>
                              {p.avgPnl >= 0 ? "+" : ""}{p.avgPnl.toFixed(1)}%
                            </td>
                            <td style={{ padding: "6px 8px", fontSize: 11, fontWeight: 600, textAlign: "right", color: "#ef4444" }}>
                              {(Math.min(p.avgMaxDrawdown ?? 0, 0)).toFixed(1)}%
                            </td>
                            <td style={{ padding: "6px 8px", fontSize: 11, fontWeight: 800, textAlign: "right", color: p.totalPnl >= 0 ? "#10b981" : "#ef4444" }}>
                              {p.totalPnl >= 0 ? "+" : ""}{p.totalPnl.toFixed(1)}%
                            </td>
                            <td style={{ padding: "6px 8px", fontSize: 9, textAlign: "right", color: "rgba(255,255,255,0.4)" }}>
                              {p.avg_nokvol >= 1e9 ? (p.avg_nokvol / 1e9).toFixed(1) + "B" : (p.avg_nokvol / 1e6).toFixed(0) + "M"} NOK
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </>
              )}

              {/* ── OPTIMIZED VIEW ── */}
              {paperTradingMode === 'optimized' && (
                <>
                  {(bestStocksLoading || bestStocksPending) && (
                    <div style={{ textAlign: "center", padding: 32, color: "rgba(255,255,255,0.3)", fontFamily: "monospace", fontSize: 11 }}>
                      {bestStocksPending ? "Nightly precompute not ready — auto-retrying in 2 min..." : "Loading cached results..."}
                    </div>
                  )}
                  {!bestStocksLoading && !bestStocksPending && bestStocks.length === 0 && (
                    <div style={{ textAlign: "center", padding: 32, color: "rgba(255,255,255,0.3)", fontFamily: "monospace", fontSize: 11 }}>
                      No cached results — check back after 02:00 UTC.
                    </div>
                  )}
                  {bestStocks.length > 0 && (
                    <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "monospace" }}>
                      <thead>
                        <tr style={{ borderBottom: "1px solid #30363d" }}>
                          {["#", "Ticker", "Sector", "Entry", "Stop", "Hold", "Vol", "Mom", "Sharpe", "Win%", "Ann.Ret", "MaxDD", "Trades", ""].map((h, hi) => (
                            <th key={hi} style={{ fontSize: 9, fontWeight: 600, color: "rgba(255,255,255,0.5)", padding: "5px 8px", textAlign: hi < 2 ? "left" as const : "right" as const, letterSpacing: "0.04em" }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {bestStocks.map((s, i) => {
                          const p = s.bestParams;
                          const st = s.stats;
                          const isExpanded = expandedOptTicker === s.ticker;
                          const rowBg = i < 3 ? "rgba(16,185,129,0.04)" : "transparent";
                          const sharpeColor = st.sharpe >= 1.5 ? "#10b981" : st.sharpe >= 0.8 ? "#f59e0b" : "#ef4444";
                          return (
                            <>
                              <tr key={s.ticker}
                                onClick={() => setExpandedOptTicker(isExpanded ? null : s.ticker)}
                                style={{ borderBottom: isExpanded ? "none" : "1px solid rgba(48,54,61,0.3)", background: isExpanded ? "rgba(16,185,129,0.06)" : rowBg, cursor: "pointer", transition: "background 0.1s" }}
                                onMouseEnter={e => { if (!isExpanded) e.currentTarget.style.background = "rgba(16,185,129,0.08)"; }}
                                onMouseLeave={e => { if (!isExpanded) e.currentTarget.style.background = rowBg; }}>
                                <td style={{ padding: "6px 8px", fontSize: 11, fontWeight: 700, color: i === 0 ? "#10b981" : i < 3 ? "rgba(255,255,255,0.6)" : "rgba(255,255,255,0.35)" }}>#{s.rank}</td>
                                <td style={{ padding: "6px 8px", fontSize: 12, fontWeight: 800, color: "#10b981" }}>{s.ticker}</td>
                                <td style={{ padding: "6px 8px", textAlign: "right" }}>
                                  <span style={{ fontSize: 9, fontWeight: 700, color: sectorColor(s.sector) }}>{s.sector?.slice(0, 8) ?? "—"}</span>
                                </td>
                                <td style={{ padding: "6px 8px", fontSize: 10, textAlign: "right", color: "rgba(255,255,255,0.7)" }}>{p.entryThreshold.toFixed(1)}%</td>
                                <td style={{ padding: "6px 8px", fontSize: 10, textAlign: "right", color: "#ef4444" }}>{p.stopLossPct.toFixed(0)}%</td>
                                <td style={{ padding: "6px 8px", fontSize: 10, textAlign: "right", color: "rgba(255,255,255,0.6)" }}>{p.maxHoldDays}d</td>
                                <td style={{ padding: "6px 8px", fontSize: 10, textAlign: "right", color: p.volGate === 'hard' ? "#f59e0b" : "rgba(255,255,255,0.4)" }}>{p.volGate.toUpperCase()}</td>
                                <td style={{ padding: "6px 8px", fontSize: 10, textAlign: "right", color: p.momentumFilter > 0 ? "#3b82f6" : "rgba(255,255,255,0.4)" }}>{p.momentumFilter > 0 ? `${p.momentumFilter}/3` : "OFF"}</td>
                                <td style={{ padding: "6px 8px", fontSize: 12, fontWeight: 800, textAlign: "right", color: sharpeColor }}>{st.sharpe.toFixed(2)}</td>
                                <td style={{ padding: "6px 8px", fontSize: 11, fontWeight: 700, textAlign: "right", color: st.winRate >= 0.6 ? "#10b981" : st.winRate >= 0.5 ? "#f59e0b" : "#ef4444" }}>
                                  {(st.winRate * 100).toFixed(0)}%
                                </td>
                                <td style={{ padding: "6px 8px", fontSize: 11, fontWeight: 700, textAlign: "right", color: st.annualizedReturn >= 0 ? "#10b981" : "#ef4444" }}>
                                  {st.annualizedReturn >= 0 ? "+" : ""}{(st.annualizedReturn * 100).toFixed(1)}%
                                </td>
                                <td style={{ padding: "6px 8px", fontSize: 11, fontWeight: 600, textAlign: "right", color: "#ef4444" }}>
                                  {(st.maxDrawdown * 100).toFixed(1)}%
                                </td>
                                <td style={{ padding: "6px 8px", fontSize: 10, textAlign: "right", color: "rgba(255,255,255,0.5)" }}>{st.trades}</td>
                                <td style={{ padding: "6px 8px", textAlign: "right", fontSize: 11, color: "rgba(255,255,255,0.4)" }}>
                                  {isExpanded ? "▲" : "▼"}
                                </td>
                              </tr>
                              {/* Trade log expansion */}
                              {isExpanded && s.trades && s.trades.length > 0 && (
                                <tr key={`${s.ticker}-trades`}>
                                  <td colSpan={14} style={{ padding: "0 8px 10px 32px", background: "rgba(16,185,129,0.03)", borderBottom: "1px solid rgba(48,54,61,0.4)" }}>
                                    <div style={{ paddingTop: 8 }}>
                                      {/* Mini stats bar */}
                                      <div style={{ display: "flex", gap: 20, marginBottom: 8, fontSize: 9, fontFamily: "monospace", color: "rgba(255,255,255,0.5)" }}>
                                        <span>Wins: <span style={{ color: "#10b981", fontWeight: 700 }}>{s.trades.filter(t => t.pnlPct > 0).length}</span></span>
                                        <span>Losses: <span style={{ color: "#ef4444", fontWeight: 700 }}>{s.trades.filter(t => t.pnlPct <= 0).length}</span></span>
                                        <span>Avg P&L: <span style={{ color: st.annualizedReturn >= 0 ? "#10b981" : "#ef4444", fontWeight: 700 }}>
                                          {s.trades.reduce((sum, t) => sum + t.pnlPct, 0) / s.trades.length >= 0 ? "+" : ""}
                                          {(s.trades.reduce((sum, t) => sum + t.pnlPct, 0) / s.trades.length * 100).toFixed(2)}%
                                        </span></span>
                                        <span>Avg Hold: <span style={{ color: "rgba(255,255,255,0.7)", fontWeight: 700 }}>
                                          {(s.trades.reduce((sum, t) => sum + t.daysHeld, 0) / s.trades.length).toFixed(1)}d
                                        </span></span>
                                        <button
                                          onClick={e => { e.stopPropagation(); setSimTicker(s.ticker); setSimEntry(p.entryThreshold); setSimStop(p.stopLossPct); setSimMaxHold(p.maxHoldDays); setSimVolGate(p.volGate as 'off' | 'soft' | 'hard'); setSimMom(p.momentumFilter as 0 | 1 | 2 | 3); setTab("simulator"); }}
                                          style={{ ...btnSecondary, fontSize: 9, padding: "2px 8px", color: "#10b981", borderColor: "rgba(16,185,129,0.3)", marginLeft: "auto" }}>
                                          SIMULATE →
                                        </button>
                                      </div>
                                      {/* Trades table */}
                                      <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "monospace" }}>
                                        <thead>
                                          <tr style={{ borderBottom: "1px solid rgba(48,54,61,0.5)" }}>
                                            {["Entry", "Exit", "Days", "ML Pred", "P&L", "Max DD", "Exit Reason"].map((h, hi) => (
                                              <th key={h} style={{ fontSize: 8, fontWeight: 600, color: "rgba(255,255,255,0.35)", padding: "3px 6px", textAlign: hi === 0 ? "left" as const : "right" as const, letterSpacing: "0.04em" }}>{h}</th>
                                            ))}
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {s.trades.map((t, ti) => {
                                            const isWin = t.pnlPct > 0;
                                            const reasonColor: Record<string, string> = {
                                              take_profit: "#10b981", stop_loss: "#ef4444",
                                              signal_flip: "#3b82f6", time_stop: "#f59e0b",
                                              sma_cross: "#a78bfa", vol_regime: "#fb923c",
                                            };
                                            const reasonLabel: Record<string, string> = {
                                              take_profit: "TP", stop_loss: "SL",
                                              signal_flip: "SIG", time_stop: "TIME",
                                              sma_cross: "SMA", vol_regime: "VOL",
                                            };
                                            return (
                                              <tr key={ti} style={{ borderBottom: "1px solid rgba(48,54,61,0.2)" }}
                                                onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.02)")}
                                                onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                                                <td style={{ padding: "3px 6px", fontSize: 9, color: "rgba(255,255,255,0.6)" }}>{t.entryDate}</td>
                                                <td style={{ padding: "3px 6px", fontSize: 9, textAlign: "right", color: "rgba(255,255,255,0.5)" }}>{t.exitDate}</td>
                                                <td style={{ padding: "3px 6px", fontSize: 9, textAlign: "right", color: "rgba(255,255,255,0.5)" }}>{t.daysHeld}d</td>
                                                <td style={{ padding: "3px 6px", fontSize: 9, textAlign: "right", color: t.predAtEntry >= 0.5 ? "#10b981" : "#f59e0b" }}>
                                                  {t.predAtEntry >= 0 ? "+" : ""}{t.predAtEntry.toFixed(1)}%
                                                </td>
                                                <td style={{ padding: "3px 6px", fontSize: 10, fontWeight: 700, textAlign: "right", color: isWin ? "#10b981" : "#ef4444" }}>
                                                  {isWin ? "+" : ""}{(t.pnlPct * 100).toFixed(2)}%
                                                </td>
                                                <td style={{ padding: "3px 6px", fontSize: 9, textAlign: "right", color: t.maxDrawdown < -0.03 ? "#ef4444" : "rgba(255,255,255,0.4)" }}>
                                                  {(t.maxDrawdown * 100).toFixed(1)}%
                                                </td>
                                                <td style={{ padding: "3px 6px", textAlign: "right" }}>
                                                  <span style={{ fontSize: 8, fontWeight: 700, padding: "2px 5px", borderRadius: 3, background: `${reasonColor[t.exitReason] ?? "#64748b"}22`, color: reasonColor[t.exitReason] ?? "#64748b", letterSpacing: "0.04em" }}>
                                                    {reasonLabel[t.exitReason] ?? t.exitReason}
                                                  </span>
                                                </td>
                                              </tr>
                                            );
                                          })}
                                        </tbody>
                                      </table>
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </>
              )}
            </div>

            {/* ── CUMULATIVE PERFORMANCE CHART ── */}
            {(() => {
              // Switch data source based on mode
              const isOptMode = paperTradingMode === 'optimized';
              const activeStats = isOptMode ? optimizedEqData?.stats : equityCurveStats;
              const activeCurve = isOptMode ? (optimizedEqData?.curve ?? []) : equityCurve;
              const activeLoading = isOptMode ? false : equityCurveLoading;
              const activeTradeLog = isOptMode ? (optimizedEqData?.allTrades ?? []) : tradeLog;

              const isPos = (activeStats?.totalReturn ?? 0) >= 0;
              const lineColor = isOptMode ? "#10b981" : (isPos ? "#10b981" : "#ef4444");
              const minVal = activeCurve.length > 0 ? Math.min(...activeCurve.map(e => e.value)) : 90;
              const maxVal = activeCurve.length > 0 ? Math.max(...activeCurve.map(e => e.value)) : 110;
              const domainLo = Math.floor(minVal * 0.97);
              const domainHi = Math.ceil(maxVal * 1.02);
              return (
                <div style={{ ...cardStyle, marginBottom: 16, borderLeft: isOptMode ? "2px solid rgba(16,185,129,0.4)" : undefined }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                    <div>
                      <div style={sectionTitle}>
                        Cumulative Performance — Last 365 Days · Max 10 Positions · Equal Weight Slots
                        {isOptMode && <span style={{ marginLeft: 8, fontSize: 9, fontWeight: 700, color: "#10b981", background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.3)", borderRadius: 3, padding: "1px 6px", letterSpacing: "0.04em" }}>OPTIMIZED</span>}
                      </div>
                      <div style={{ fontSize: 10, fontFamily: "monospace", color: "rgba(255,255,255,0.3)", marginTop: -8 }}>
                        {isOptMode
                          ? "ML signal (ensemble_prediction) where available · 6m momentum proxy for older history · entry >0.5% · exit <0.1% · 10% per slot · indexed to 100"
                          : "Top 50 liquid OSE · Entry >+1% signal · −5% stop · 21d max · Up to 10 concurrent positions · Indexed to 100"}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      {activeStats && (
                        <div style={{ display: "flex", gap: 12, fontSize: 10, fontFamily: "monospace" }}>
                          <span style={{ color: "rgba(255,255,255,0.4)" }}>Return: <span style={{ color: isPos ? "#10b981" : "#ef4444", fontWeight: 800, fontSize: 13 }}>{isPos ? "+" : ""}{activeStats.totalReturn.toFixed(1)}%</span></span>
                          <span style={{ color: "rgba(255,255,255,0.4)" }}>Max DD: <span style={{ color: "#ef4444", fontWeight: 700 }}>{activeStats.maxDrawdown.toFixed(1)}%</span></span>
                          <span style={{ color: "rgba(255,255,255,0.4)" }}>Win Rate: <span style={{ color: "#f59e0b", fontWeight: 700 }}>{activeStats.winRate.toFixed(0)}%</span></span>
                          <span style={{ color: "rgba(255,255,255,0.4)" }}>Trades: <span style={{ color: "#fff", fontWeight: 700 }}>{activeStats.trades}</span></span>
                        </div>
                      )}
                      {!isOptMode && (
                        <button onClick={() => fetchEquityCurve(true)} disabled={equityCurveLoading}
                          style={{ ...btnSecondary, fontSize: 9, padding: "4px 10px", opacity: equityCurveLoading ? 0.5 : 1 }}>
                          {equityCurveLoading ? "Loading..." : "Refresh"}
                        </button>
                      )}
                    </div>
                  </div>

                  {activeLoading && (
                    <div style={{ textAlign: "center", padding: 40, color: "rgba(255,255,255,0.3)", fontFamily: "monospace", fontSize: 11 }}>
                      Simulating portfolio across 365 days of trading...
                    </div>
                  )}

                  {!activeLoading && activeCurve.length > 0 && (() => {
                    return (
                      <>
                        <ResponsiveContainer width="100%" height={260}>
                          <ComposedChart data={activeCurve} margin={{ top: 5, right: 60, left: 10, bottom: 0 }}>
                            <defs>
                              <linearGradient id="eqGrad" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor={lineColor} stopOpacity={0.25} />
                                <stop offset="100%" stopColor={lineColor} stopOpacity={0.02} />
                              </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                            <XAxis dataKey="date" tick={{ fontSize: 9, fill: "rgba(255,255,255,0.4)", fontFamily: "monospace" }}
                              tickFormatter={d => d.slice(5)} interval="preserveStartEnd" />
                            <YAxis yAxisId="left" domain={[domainLo, domainHi]}
                              tick={{ fontSize: 9, fill: "rgba(255,255,255,0.4)", fontFamily: "monospace" }}
                              tickFormatter={v => v.toFixed(0)} width={42} />
                            <YAxis yAxisId="right" orientation="right" domain={[domainLo, domainHi]}
                              tick={{ fontSize: 9, fill: "rgba(255,255,255,0.35)", fontFamily: "monospace" }}
                              tickFormatter={v => `${(v - 100).toFixed(0)}%`} width={50} />
                            <Tooltip
                              contentStyle={{ background: "#0d1117", border: "1px solid #30363d", borderRadius: 6, fontFamily: "monospace", fontSize: 11 }}
                              labelStyle={{ color: "rgba(255,255,255,0.6)", marginBottom: 4 }}
                              formatter={((v: number, name: string) => {
                                if (name === "value") return [`${v.toFixed(2)} (${(v - 100).toFixed(1)}%)`, "Portfolio"];
                                return [null, ""];
                              }) as Parameters<typeof Tooltip>[0]["formatter"]} />
                            <ReferenceLine yAxisId="left" y={100} stroke="rgba(255,255,255,0.25)" strokeDasharray="4 4" />
                            <Area yAxisId="left" type="monotone" dataKey="value"
                              stroke={lineColor} strokeWidth={2} fill="url(#eqGrad)"
                              dot={false} isAnimationActive={false} name="value" />
                          </ComposedChart>
                        </ResponsiveContainer>

                        {/* Position count bar chart */}
                        <div style={{ marginTop: -8 }}>
                          <ResponsiveContainer width="100%" height={56}>
                            <BarChart data={activeCurve} margin={{ top: 0, right: 60, left: 10, bottom: 0 }} barCategoryGap="0%">
                              <XAxis dataKey="date" tick={false} axisLine={false} tickLine={false} />
                              <YAxis domain={[0, 10]} tick={{ fontSize: 8, fill: "rgba(255,255,255,0.25)", fontFamily: "monospace" }}
                                tickCount={3} width={42} tickFormatter={v => `${v}p`} />
                              <Tooltip
                                contentStyle={{ background: "#0d1117", border: "1px solid #30363d", borderRadius: 6, fontFamily: "monospace", fontSize: 10 }}
                                formatter={((v: number) => [`${v} positions active`, "Active"]) as Parameters<typeof Tooltip>[0]["formatter"]}
                                labelFormatter={l => l} />
                              <Bar dataKey="positions" fill={isOptMode ? "rgba(16,185,129,0.35)" : "rgba(59,130,246,0.4)"} isAnimationActive={false} />
                            </BarChart>
                          </ResponsiveContainer>
                          <div style={{ fontSize: 8, fontFamily: "monospace", color: "rgba(255,255,255,0.2)", textAlign: "right", marginRight: 64, marginTop: -4 }}>
                            active positions (0–10)
                          </div>
                        </div>
                      </>
                    );
                  })()}

                  {!activeLoading && activeCurve.length === 0 && (
                    <div style={{ textAlign: "center", padding: 32, color: "rgba(255,255,255,0.3)", fontFamily: "monospace", fontSize: 11 }}>
                      {isOptMode ? "Load optimized top 10 first (click Refresh in table above)" : "Loading equity curve..."}
                    </div>
                  )}

                  {/* Trade Log */}
                  {activeTradeLog.length > 0 && (
                    <div style={{ marginTop: 24 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, fontFamily: "monospace", color: "rgba(255,255,255,0.5)", letterSpacing: "0.08em", marginBottom: 8 }}>
                        TRADE LOG — {activeTradeLog.length} CLOSED POSITIONS · LAST 365 DAYS{isOptMode ? " · OPTIMIZED PARAMS" : " · MAX 10 SLOTS"}
                      </div>
                      <div style={{ overflowY: "auto", maxHeight: 420, border: "1px solid #21262d", borderRadius: 6 }}>
                        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10, fontFamily: "monospace" }}>
                          <thead style={{ position: "sticky", top: 0, background: "#161b22", zIndex: 1 }}>
                            <tr>
                              {["#", "Ticker", "Entry", "Exit", "Days", isOptMode ? "ML Pred" : null, "P&L", "Max DD", "Reason"].filter(Boolean).map(h => (
                                <th key={h!} style={{ padding: "6px 10px", textAlign: h === "P&L" || h === "Days" || h === "#" || h === "Max DD" || h === "ML Pred" ? "right" : "left", fontSize: 9, fontWeight: 600, color: "rgba(255,255,255,0.4)", letterSpacing: "0.05em", borderBottom: "1px solid #30363d", whiteSpace: "nowrap" }}>{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {(isOptMode
                              ? [...activeTradeLog].sort((a, b) => a.entryDate.localeCompare(b.entryDate))
                              : activeTradeLog
                            ).map((t, i) => {
                              const isWin = t.pnlPct > 0;
                              const exitReason = (t as any).exitReason ?? (t as any).exit_reason ?? 'signal';
                              const reasonMap: Record<string, { color: string; label: string }> = {
                                take_profit: { color: '#10b981', label: 'TP' },
                                stop_loss: { color: '#ef4444', label: 'SL' },
                                signal_flip: { color: '#3b82f6', label: 'SIG' },
                                time_stop: { color: '#f59e0b', label: 'TIME' },
                                sma_cross: { color: '#a78bfa', label: 'SMA' },
                                vol_regime: { color: '#fb923c', label: 'VOL' },
                                stop: { color: '#ef4444', label: 'SL' },
                                time: { color: '#f59e0b', label: 'TIME' },
                                signal: { color: '#3b82f6', label: 'SIG' },
                              };
                              const r = reasonMap[exitReason] ?? { color: '#64748b', label: exitReason.slice(0, 4).toUpperCase() };
                              return (
                                <tr key={i} style={{ borderBottom: "1px solid #21262d", background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.02)" }}>
                                  <td style={{ padding: "5px 10px", textAlign: "right", color: "rgba(255,255,255,0.25)", fontSize: 9 }}>{i + 1}</td>
                                  <td style={{ padding: "5px 10px", fontWeight: 700, color: isOptMode ? "#10b981" : "#3b82f6", letterSpacing: "0.04em" }}>{(t as any).ticker}</td>
                                  <td style={{ padding: "5px 10px", color: "rgba(255,255,255,0.5)" }}>{t.entryDate}</td>
                                  <td style={{ padding: "5px 10px", color: "rgba(255,255,255,0.5)" }}>{t.exitDate}</td>
                                  <td style={{ padding: "5px 10px", textAlign: "right", color: "rgba(255,255,255,0.4)" }}>{t.daysHeld}d</td>
                                  {isOptMode && (
                                    <td style={{ padding: "5px 10px", textAlign: "right", fontSize: 9, color: (t as any).predAtEntry >= 0.5 ? "#10b981" : "#f59e0b" }}>
                                      {((t as any).predAtEntry >= 0 ? "+" : "")}{((t as any).predAtEntry ?? 0).toFixed(1)}%
                                    </td>
                                  )}
                                  <td style={{ padding: "5px 10px", textAlign: "right", fontWeight: 700, color: isWin ? "#10b981" : "#ef4444" }}>
                                    {isWin ? "+" : ""}{(t.pnlPct * (isOptMode ? 100 : 1)).toFixed(2)}%
                                  </td>
                                  {isOptMode && (
                                    <td style={{ padding: "5px 10px", textAlign: "right", fontSize: 9, color: (t as any).maxDrawdown < -0.03 ? "#ef4444" : "rgba(255,255,255,0.4)" }}>
                                      {(((t as any).maxDrawdown ?? 0) * 100).toFixed(1)}%
                                    </td>
                                  )}
                                  <td style={{ padding: "5px 10px" }}>
                                    <span style={{ background: `${r.color}22`, color: r.color, border: `1px solid ${r.color}44`, borderRadius: 3, padding: "1px 6px", fontSize: 8, fontWeight: 700, letterSpacing: "0.05em" }}>
                                      {r.label}
                                    </span>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                      <div style={{ display: "flex", gap: 16, marginTop: 8, fontSize: 9, fontFamily: "monospace", color: "rgba(255,255,255,0.35)" }}>
                        <span><span style={{ color: "#10b981", fontWeight: 700 }}>TP</span> — take profit hit</span>
                        <span><span style={{ color: "#3b82f6", fontWeight: 700 }}>SIG</span> — signal exit</span>
                        <span><span style={{ color: "#f59e0b", fontWeight: 700 }}>TIME</span> — max hold reached</span>
                        <span><span style={{ color: "#ef4444", fontWeight: 700 }}>SL</span> — stop loss triggered</span>
                        {isOptMode && <span><span style={{ color: "#fb923c", fontWeight: 700 }}>VOL</span> — vol regime exit</span>}
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}

          </div>{/* end Section 1 card */}

          {/* ══ SECTION DIVIDER ═════════════════════════════════════════════════ */}
          <div style={{ margin: "20px 0", display: "flex", alignItems: "center", gap: 16 }}>
            <div style={{ flex: 1, height: 1, background: "linear-gradient(90deg, #30363d, transparent)" }} />
            <div style={{ background: "#0d1117", border: "1px solid #30363d", borderRadius: 6, padding: "8px 16px", textAlign: "center", minWidth: 320 }}>
              <div style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", fontFamily: "monospace", letterSpacing: "0.06em", marginBottom: 3 }}>SECTION 1 vs SECTION 2</div>
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.6)", fontFamily: "monospace" }}>
                <span style={{ color: "#f59e0b" }}>↑ ML signals only</span>
                <span style={{ color: "rgba(255,255,255,0.3)", margin: "0 8px" }}>|</span>
                <span style={{ color: "#10b981" }}>↓ 6-factor portfolio (more trusted)</span>
              </div>
            </div>
            <div style={{ flex: 1, height: 1, background: "linear-gradient(90deg, transparent, #30363d)" }} />
          </div>

          {/* ══════════════════════════════════════════════════════════════════
              SECTION 2 — CROSS-SECTIONAL FACTOR STRATEGY  (trusted)
          ══════════════════════════════════════════════════════════════════ */}
          <div style={{ ...cardStyle, borderColor: "#1a3a2a", borderLeft: "3px solid #10b981", marginBottom: 16 }}>
            {/* Section header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 800, fontFamily: "monospace", letterSpacing: "0.04em", color: "#10b981" }}>
                  SECTION 2 — CROSS-SECTIONAL FACTOR STRATEGY
                </div>
                <div style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", fontFamily: "monospace", marginTop: 3 }}>
                  Trusted backtest · 5-year history · 6 alpha factors · Monthly portfolio rebalancing
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <div style={{ background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.3)", borderRadius: 5, padding: "4px 10px", fontSize: 9, color: "#10b981", fontFamily: "monospace", fontWeight: 700 }}>
                  TRUSTED
                </div>
                <button onClick={() => runPortfolioBacktest(true)} disabled={portfolioBacktestLoading}
                  style={{ ...btnPrimary, fontSize: 10, padding: "6px 14px", opacity: portfolioBacktestLoading ? 0.5 : 1 }}>
                  {portfolioBacktestLoading ? "Running..." : "Refresh"}
                </button>
              </div>
            </div>

            {/* Context explanation */}
            <div style={{ background: "#0d1117", border: "1px solid rgba(16,185,129,0.15)", borderRadius: 6, padding: "10px 14px", marginBottom: 14, fontSize: 10, fontFamily: "monospace", lineHeight: 1.7, color: "rgba(255,255,255,0.55)" }}>
              <span style={{ color: "#10b981", fontWeight: 700 }}>What this shows:</span> A proper cross-sectional equity strategy ranking <em>all</em> OSE stocks monthly across{" "}
              <span style={{ color: "#e6edf3" }}>6 alpha factors</span> (ML prediction, low volatility, vol-adjusted momentum, sector-relative valuation, liquidity).
              The top quintile is overweighted (60%+), bottom quintile excluded. Portfolio rebalances monthly with 15bps transaction costs.
              Covers <span style={{ color: "#e6edf3" }}>~5 years</span> of walk-forward out-of-sample performance vs an equal-weight OSE benchmark.{" "}
              <span style={{ color: "#10b981", fontWeight: 600 }}>Why more trusted:</span> Longer history, true portfolio construction with diversification constraints,
              no look-ahead bias, benchmark comparison with IC tracking. Use this for <span style={{ color: "#e6edf3" }}>strategic allocation decisions</span>.
            </div>

            {/* Factor Weights */}
            {portfolioBacktest?.config && (
              <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
                {[
                  { key: "ml", label: "ML Signal" },
                  { key: "lowVol", label: "Low Volatility" },
                  { key: "momentum", label: "Vol-Adj Momentum" },
                  { key: "value", label: "Sector Value" },
                  { key: "liquidity", label: "Liquidity" },
                ].map(({ key, label }) => (
                  <div key={key} style={{ background: "#0d1117", border: "1px solid #21262d", borderRadius: 4, padding: "4px 12px", fontSize: 9, fontFamily: "monospace" }}>
                    <span style={{ color: "rgba(255,255,255,0.4)" }}>{label}: </span>
                    <span style={{ color: "#10b981", fontWeight: 700 }}>{((portfolioBacktest.config.weights as Record<string, number>)[key] * 100).toFixed(0)}%</span>
                  </div>
                ))}
              </div>
            )}

            {portfolioBacktestLoading && (
              <div style={{ textAlign: "center", padding: 60, color: "rgba(255,255,255,0.4)", fontFamily: "monospace", fontSize: 12 }}>
                Building cross-sectional alpha scores, forming portfolios, computing 6 years of returns...<br />
                <span style={{ fontSize: 10, color: "rgba(255,255,255,0.25)", marginTop: 8, display: "block" }}>This takes ~30 seconds</span>
              </div>
            )}

            {!portfolioBacktest && !portfolioBacktestLoading && (
              <div style={{ textAlign: "center", padding: 60, color: "rgba(255,255,255,0.3)", fontFamily: "monospace", fontSize: 12 }}>
                Loading portfolio strategy backtest...
              </div>
            )}

            {portfolioBacktest && (() => {
              const s = portfolioBacktest.summary;
              return (
                <>
                  {/* 6 Key Metrics */}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 10, marginBottom: 16 }}>
                    {[
                      { label: "ANNUAL RETURN", value: (s.annualizedReturn >= 0 ? "+" : "") + s.annualizedReturn.toFixed(1) + "%", color: s.annualizedReturn >= 0 ? "#10b981" : "#ef4444" },
                      { label: "VS BENCHMARK", value: (s.excessReturn >= 0 ? "+" : "") + s.excessReturn.toFixed(1) + "%", color: s.excessReturn >= 0 ? "#10b981" : "#ef4444" },
                      { label: "SHARPE RATIO", value: s.sharpe.toFixed(2), color: s.sharpe > 1 ? "#10b981" : s.sharpe > 0.5 ? "#f59e0b" : "#ef4444" },
                      { label: "MAX DRAWDOWN", value: "-" + s.maxDrawdown.toFixed(1) + "%", color: s.maxDrawdown < 15 ? "#f59e0b" : "#ef4444" },
                      { label: "AVG IC", value: s.avgIC.toFixed(3), color: s.avgIC > 0.03 ? "#10b981" : s.avgIC > 0 ? "#f59e0b" : "#ef4444" },
                      { label: "BEAT BM RATE", value: s.winRate.toFixed(0) + "%", color: s.winRate > 55 ? "#10b981" : "#f59e0b" },
                    ].map(x => (
                      <div key={x.label} style={{ ...metricCard, padding: "14px 16px" }}>
                        <div style={{ fontSize: 8, color: "rgba(255,255,255,0.4)", fontFamily: "monospace", letterSpacing: "0.05em", marginBottom: 6 }}>{x.label}</div>
                        <div style={{ fontSize: 20, fontWeight: 800, fontFamily: "monospace", color: x.color }}>{x.value}</div>
                      </div>
                    ))}
                  </div>

                  {/* Portfolio vs Benchmark summary */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
                    <div style={{ background: "#0d1117", border: "1px solid #10b98133", borderRadius: 6, padding: 12 }}>
                      <div style={{ fontSize: 9, fontFamily: "monospace", color: "#10b981", letterSpacing: "0.05em", fontWeight: 700, marginBottom: 10 }}>STRATEGY — TOP 10 HIGH CONVICTION</div>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "6px 16px", fontSize: 11, fontFamily: "monospace" }}>
                        <div><div style={{ color: "rgba(255,255,255,0.4)", fontSize: 9, marginBottom: 2 }}>ANN. RETURN</div><div style={{ color: "#10b981", fontWeight: 700 }}>{s.annualizedReturn >= 0 ? "+" : ""}{s.annualizedReturn.toFixed(1)}%</div></div>
                        <div><div style={{ color: "rgba(255,255,255,0.4)", fontSize: 9, marginBottom: 2 }}>SHARPE</div><div style={{ color: "#3b82f6", fontWeight: 700 }}>{s.sharpe.toFixed(2)}</div></div>
                        <div><div style={{ color: "rgba(255,255,255,0.4)", fontSize: 9, marginBottom: 2 }}>MAX DD</div><div style={{ color: "#ef4444", fontWeight: 700 }}>-{s.maxDrawdown.toFixed(1)}%</div></div>
                        <div><div style={{ color: "rgba(255,255,255,0.4)", fontSize: 9, marginBottom: 2 }}>EXCESS RET</div><div style={{ color: s.excessReturn >= 0 ? "#10b981" : "#ef4444", fontWeight: 700 }}>{s.excessReturn >= 0 ? "+" : ""}{s.excessReturn.toFixed(1)}%</div></div>
                        <div><div style={{ color: "rgba(255,255,255,0.4)", fontSize: 9, marginBottom: 2 }}>WIN RATE</div><div style={{ color: "#fff", fontWeight: 700 }}>{s.winRate.toFixed(0)}%</div></div>
                        <div><div style={{ color: "rgba(255,255,255,0.4)", fontSize: 9, marginBottom: 2 }}>AVG IC</div><div style={{ color: "#8b9dc3", fontWeight: 700 }}>{s.avgIC.toFixed(3)}</div></div>
                        <div><div style={{ color: "rgba(255,255,255,0.4)", fontSize: 9, marginBottom: 2 }}>TURNOVER</div><div style={{ color: "rgba(255,255,255,0.7)", fontWeight: 700 }}>{s.avgTurnover.toFixed(1)}%</div></div>
                        <div><div style={{ color: "rgba(255,255,255,0.4)", fontSize: 9, marginBottom: 2 }}>POSITIONS</div><div style={{ color: "#fff", fontWeight: 700 }}>{s.avgPositions.toFixed(0)}</div></div>
                      </div>
                    </div>
                    <div style={{ background: "#0d1117", border: "1px solid #21262d", borderRadius: 6, padding: 12 }}>
                      <div style={{ fontSize: 9, fontFamily: "monospace", color: "rgba(255,255,255,0.4)", letterSpacing: "0.05em", fontWeight: 700, marginBottom: 10 }}>EQUAL-WEIGHT BENCHMARK</div>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "6px 16px", fontSize: 11, fontFamily: "monospace" }}>
                        <div><div style={{ color: "rgba(255,255,255,0.4)", fontSize: 9, marginBottom: 2 }}>ANN. RETURN</div><div style={{ color: "rgba(255,255,255,0.7)", fontWeight: 700 }}>{s.benchmarkAnnReturn >= 0 ? "+" : ""}{s.benchmarkAnnReturn.toFixed(1)}%</div></div>
                        <div><div style={{ color: "rgba(255,255,255,0.4)", fontSize: 9, marginBottom: 2 }}>SHARPE</div><div style={{ color: "rgba(255,255,255,0.7)", fontWeight: 700 }}>{s.benchmarkSharpe.toFixed(2)}</div></div>
                        <div><div style={{ color: "rgba(255,255,255,0.4)", fontSize: 9, marginBottom: 2 }}>MAX DD</div><div style={{ color: "rgba(255,255,255,0.7)", fontWeight: 700 }}>-{s.benchmarkMaxDD.toFixed(1)}%</div></div>
                        <div><div style={{ color: "rgba(255,255,255,0.4)", fontSize: 9, marginBottom: 2 }}>MONTHS</div><div style={{ color: "rgba(255,255,255,0.7)", fontWeight: 700 }}>{s.months}</div></div>
                      </div>
                    </div>
                  </div>

                  {/* Equity Curve */}
                  {portfolioBacktest.equityCurve.length > 0 && (
                    <div style={{ marginBottom: 16 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, fontFamily: "monospace", color: "rgba(255,255,255,0.5)", letterSpacing: "0.06em", marginBottom: 8 }}>CUMULATIVE PERFORMANCE (indexed to 100)</div>
                      <ResponsiveContainer width="100%" height={300}>
                        <ComposedChart data={portfolioBacktest.equityCurve} margin={{ top: 5, right: 10, left: 10, bottom: 0 }}>
                          <defs>
                            <linearGradient id="portGrad" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor="#10b981" stopOpacity={0.2} />
                              <stop offset="100%" stopColor="#10b981" stopOpacity={0.01} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                          <XAxis dataKey="date" tick={{ fontSize: 8, fill: "rgba(255,255,255,0.4)", fontFamily: "monospace" }} tickFormatter={d => d?.slice(2, 7)} interval="preserveStartEnd" />
                          <YAxis tick={{ fontSize: 9, fill: "rgba(255,255,255,0.4)", fontFamily: "monospace" }} />
                          <Tooltip contentStyle={{ background: "#161b22", border: "1px solid #30363d", borderRadius: 6, fontFamily: "monospace", fontSize: 11, color: "#fff" }}
                            formatter={((v: number, name: string) => [Number(v).toFixed(1), name === "portfolio" ? "Strategy" : "Benchmark"]) as Parameters<typeof Tooltip>[0]["formatter"]} />
                          <ReferenceLine y={100} stroke="rgba(255,255,255,0.1)" strokeDasharray="4 4" />
                          <Area type="monotone" dataKey="portfolio" stroke="#10b981" fill="url(#portGrad)" strokeWidth={2} dot={false} isAnimationActive={false} name="portfolio" />
                          <Line type="monotone" dataKey="benchmark" stroke="rgba(255,255,255,0.25)" strokeWidth={1.5} dot={false} isAnimationActive={false} strokeDasharray="4 4" name="benchmark" />
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>
                  )}

                  {/* Monthly Charts */}
                  {portfolioBacktest.monthlyReturns.length > 0 && (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
                      <div>
                        <div style={{ fontSize: 10, fontWeight: 700, fontFamily: "monospace", color: "rgba(255,255,255,0.6)", letterSpacing: "0.06em", marginBottom: 8 }}>MONTHLY EXCESS RETURN</div>
                        <ResponsiveContainer width="100%" height={160}>
                          <BarChart data={portfolioBacktest.monthlyReturns} margin={{ top: 5, right: 10, left: 10, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.12)" />
                            <XAxis dataKey="date" tick={{ fontSize: 8, fill: "rgba(255,255,255,0.65)", fontFamily: "monospace" }} tickFormatter={d => d?.slice(2, 7)} interval="preserveStartEnd" />
                            <YAxis tick={{ fontSize: 9, fill: "rgba(255,255,255,0.65)", fontFamily: "monospace" }} tickFormatter={v => (v * 100).toFixed(0) + "%"} width={38} />
                            <ReferenceLine y={0} stroke="rgba(255,255,255,0.35)" strokeWidth={1} />
                            <Tooltip contentStyle={{ background: "#161b22", border: "1px solid #30363d", borderRadius: 6, fontFamily: "monospace", fontSize: 11, color: "#fff" }}
                              labelStyle={{ color: "rgba(255,255,255,0.8)", marginBottom: 4 }}
                              itemStyle={{ color: "#fff" }}
                              formatter={((v: number) => [(v * 100).toFixed(2) + "%", "Excess"]) as Parameters<typeof Tooltip>[0]["formatter"]} />
                            <Bar dataKey="excess" radius={[2, 2, 0, 0]}>
                              {portfolioBacktest.monthlyReturns.map((d, i) => <Cell key={i} fill={d.excess >= 0 ? "#10b981" : "#ef4444"} />)}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                      <div>
                        <div style={{ fontSize: 10, fontWeight: 700, fontFamily: "monospace", color: "rgba(255,255,255,0.6)", letterSpacing: "0.06em", marginBottom: 8 }}>MONTHLY INFORMATION COEFFICIENT</div>
                        <ResponsiveContainer width="100%" height={160}>
                          <BarChart data={portfolioBacktest.monthlyReturns} margin={{ top: 5, right: 10, left: 10, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.12)" />
                            <XAxis dataKey="date" tick={{ fontSize: 8, fill: "rgba(255,255,255,0.65)", fontFamily: "monospace" }} tickFormatter={d => d?.slice(2, 7)} interval="preserveStartEnd" />
                            <YAxis tick={{ fontSize: 9, fill: "rgba(255,255,255,0.65)", fontFamily: "monospace" }} width={38} />
                            <ReferenceLine y={0} stroke="rgba(255,255,255,0.35)" strokeWidth={1} />
                            <Tooltip contentStyle={{ background: "#161b22", border: "1px solid #30363d", borderRadius: 6, fontFamily: "monospace", fontSize: 11, color: "#fff" }}
                              labelStyle={{ color: "rgba(255,255,255,0.8)", marginBottom: 4 }}
                              itemStyle={{ color: "#fff" }}
                              formatter={((v: number) => [Number(v).toFixed(3), "IC"]) as Parameters<typeof Tooltip>[0]["formatter"]} />
                            <Bar dataKey="ic" radius={[2, 2, 0, 0]}>
                              {portfolioBacktest.monthlyReturns.map((d, i) => <Cell key={i} fill={d.ic >= 0 ? "#3b82f6" : "#ef4444"} />)}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  )}

                  {/* Current Holdings */}
                  {portfolioBacktest.currentPortfolio.holdings.length > 0 && (
                    <div style={{ marginBottom: 16 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, fontFamily: "monospace", color: "rgba(255,255,255,0.5)", letterSpacing: "0.06em", marginBottom: 8 }}>
                        CURRENT PORTFOLIO — {portfolioBacktest.currentPortfolio.date} · {portfolioBacktest.currentPortfolio.holdings.length} positions
                      </div>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "monospace" }}>
                        <thead>
                          <tr style={{ borderBottom: "1px solid #30363d" }}>
                            {["#", "Ticker", "Name", "Sector", "Weight", "Alpha", "ML", "LowVol", "Mom", "Val", "Liq"].map(h => (
                              <th key={h} style={{ fontSize: 8, fontWeight: 600, color: "rgba(255,255,255,0.5)", padding: "4px 6px", textAlign: h === "Name" ? "left" as const : "right" as const }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {portfolioBacktest.currentPortfolio.holdings.map(h => (
                            <tr key={h.ticker} style={{ borderBottom: "1px solid rgba(48,54,61,0.3)" }}>
                              <td style={{ padding: "4px 6px", fontSize: 9, color: "rgba(255,255,255,0.3)", textAlign: "right" }}>{h.rank}</td>
                              <td style={{ padding: "4px 6px", fontSize: 10, fontWeight: 700, color: "#3b82f6", textAlign: "right", cursor: "pointer" }}
                                onClick={() => { setExplorerTicker(h.ticker); setTab("explorer"); }}>{h.ticker}</td>
                              <td style={{ padding: "4px 6px", fontSize: 9, color: "rgba(255,255,255,0.5)" }}>{h.name}</td>
                              <td style={{ padding: "4px 6px", fontSize: 9, textAlign: "right" }}>
                                <span style={{ color: sectorColor(h.sector), fontSize: 8, fontWeight: 700 }}>{h.sector}</span>
                              </td>
                              <td style={{ padding: "4px 6px", fontSize: 10, fontWeight: 700, color: "#10b981", textAlign: "right" }}>{h.weight.toFixed(1)}%</td>
                              <td style={{ padding: "4px 6px", fontSize: 10, fontWeight: 700, color: h.alphaScore > 0.3 ? "#10b981" : h.alphaScore > 0 ? "#3b82f6" : "#ef4444", textAlign: "right" }}>{h.alphaScore.toFixed(2)}</td>
                              {["ml", "lowVol", "momentum", "value", "liquidity"].map(k => (
                                <td key={k} style={{ padding: "4px 6px", fontSize: 9, color: (h.components[k] || 0) > 0.3 ? "#10b981" : (h.components[k] || 0) < -0.3 ? "#ef4444" : "rgba(255,255,255,0.35)", textAlign: "right" }}>
                                  {(h.components[k] || 0).toFixed(2)}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* Sector Allocation */}
                  {portfolioBacktest.sectorAllocation.length > 0 && (
                    <div>
                      <div style={{ fontSize: 10, fontWeight: 700, fontFamily: "monospace", color: "rgba(255,255,255,0.5)", letterSpacing: "0.06em", marginBottom: 8 }}>SECTOR ALLOCATION</div>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        {portfolioBacktest.sectorAllocation.map(sa => (
                          <div key={sa.sector} style={{ background: "#0d1117", border: "1px solid #21262d", borderRadius: 4, padding: "6px 14px", borderLeft: `3px solid ${sectorColor(sa.sector)}` }}>
                            <div style={{ fontSize: 9, fontFamily: "monospace", color: "rgba(255,255,255,0.4)" }}>{sa.sector}</div>
                            <div style={{ fontSize: 16, fontWeight: 800, fontFamily: "monospace", color: sectorColor(sa.sector) }}>{sa.weight.toFixed(1)}%</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              );
            })()}
          </div>


        </div>
      )}

      {/* ================================================================ */}
      {/* SIGNALS TAB                                                       */}
      {/* ================================================================ */}
      {tab === "signals" && (
        <div>
          {/* Summary */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 8, marginBottom: 16 }}>
            {[
              { label: "UNIVERSE", value: signals.length.toString(), color: "#3b82f6" },
              { label: "STRONG BUY", value: signalStats.strongBuy.toString(), color: "#00c853" },
              { label: "BUY", value: signalStats.buy.toString(), color: "#4caf50" },
              { label: "NEUTRAL", value: signalStats.neutral.toString(), color: "#9e9e9e" },
              { label: "SELL", value: signalStats.sell.toString(), color: "#ef5350" },
              { label: "STRONG SELL", value: signalStats.strongSell.toString(), color: "#d50000" },
            ].map(m => (
              <div key={m.label} style={metricCard}>
                <div style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", fontFamily: "monospace", letterSpacing: "0.05em", marginBottom: 4 }}>{m.label}</div>
                <div style={{ fontSize: 20, fontWeight: 800, fontFamily: "monospace", color: m.color }}>{m.value}</div>
              </div>
            ))}
          </div>

          {/* Filters + Sort */}
          <div style={{ ...cardStyle, marginBottom: 12, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <button onClick={() => fetchSignals()} style={{ ...btnPrimary, fontSize: 10, padding: "5px 14px" }}>Refresh</button>
            <span style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", fontFamily: "monospace" }}>Date: {signalDate || "—"}</span>
            <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", fontFamily: "monospace" }}>SECTOR:</span>
              <select value={sectorFilter} onChange={e => setSectorFilter(e.target.value)}
                style={{ background: "#0d1117", border: "1px solid #30363d", borderRadius: 4, color: "#fff", fontSize: 10, fontFamily: "monospace", padding: "3px 8px" }}>
                <option value="">All sectors</option>
                {sectors.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <span style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", fontFamily: "monospace" }}>SORT:</span>
              {(["signal", "ticker", "sector"] as const).map(s => (
                <button key={s} onClick={() => { if (signalSort === s) setSignalSortAsc(!signalSortAsc); else { setSignalSort(s); setSignalSortAsc(false); } }}
                  style={{ ...btnSecondary, fontSize: 9, padding: "3px 10px", background: signalSort === s ? "rgba(59,130,246,0.15)" : "#21262d", color: signalSort === s ? "#3b82f6" : "rgba(255,255,255,0.5)" }}>
                  {s.toUpperCase()} {signalSort === s ? (signalSortAsc ? "↑" : "↓") : ""}
                </button>
              ))}
              <div style={{ width: 1, height: 16, background: "#30363d" }} />
              <button onClick={() => setSignalsShowMLGuide(v => !v)} style={guideButtonStyle(signalsShowMLGuide)}>
                <span style={{ fontSize: 11 }}>◈</span> {signalsShowMLGuide ? "HIDE ML GUIDE" : "HOW ML SIGNALS WORK"}
              </button>
            </div>
          </div>
          {renderMLGuidePanel(signalsShowMLGuide)}

          {/* Signal Table */}
          <div style={cardStyle}>
            {signalsLoading ? (
              <div style={{ textAlign: "center", padding: 40, color: "rgba(255,255,255,0.4)", fontFamily: "monospace" }}>Loading signals...</div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "monospace" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid #30363d" }}>
                    {["Ticker", "Name", "Sector", "Rank", "Predicted", "Signal", "Price", "1D Chg"].map(h => (
                      <th key={h} style={{ fontSize: 9, fontWeight: 600, color: "rgba(255,255,255,0.5)", padding: "6px 8px", textAlign: h === "Name" ? "left" as const : "right" as const }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedSignals.map(row => {
                    const sig = row.signals.find(s => s.model_id === selectedModel);
                    const conf = Number(sig?.confidence) || 0.5;
                    const pred = Number(sig?.predicted_return) || 0;
                    const label = conf >= 0.65 && pred > 0.01 ? { text: "Strong Buy", color: "#00c853" } :
                      conf >= 0.55 && pred > 0 ? { text: "Buy", color: "#4caf50" } :
                      conf >= 0.55 && pred <= 0 ? { text: "Hold", color: "#f59e0b" } :
                      conf >= 0.45 ? { text: "Neutral", color: "#6b7280" } :
                      conf >= 0.35 && pred < 0 ? { text: "Sell", color: "#ef5350" } :
                      { text: "Strong Sell", color: "#d50000" };
                    return (
                      <tr key={row.ticker} style={{ borderBottom: "1px solid rgba(48,54,61,0.3)", cursor: "pointer" }}
                        onClick={() => { setExplorerTicker(row.ticker); setTab("explorer"); }}
                        onMouseEnter={e => e.currentTarget.style.background = "rgba(59,130,246,0.05)"}
                        onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                        <td style={{ padding: "5px 8px", fontSize: 11, fontWeight: 700, color: "#fff", textAlign: "right" }}>{row.ticker}</td>
                        <td style={{ padding: "5px 8px", fontSize: 10, color: "rgba(255,255,255,0.5)" }}>{row.name}</td>
                        <td style={{ padding: "5px 8px", fontSize: 9, textAlign: "right" }}>
                          <span style={{ color: sectorColor(row.sector), fontWeight: 700 }}>{row.sector}</span>
                        </td>
                        <td style={{ padding: "5px 8px", fontSize: 10, textAlign: "right", color: "rgba(255,255,255,0.5)", fontFamily: "monospace" }}>{conf.toFixed(3)}</td>
                        <td style={{ padding: "5px 8px", fontSize: 11, fontWeight: 700, textAlign: "right", fontFamily: "monospace", color: pred > 0.02 ? "#10b981" : pred > 0 ? "#4caf50" : pred > -0.02 ? "#f59e0b" : "#ef4444" }}>
                          {pred !== 0 ? `${pred >= 0 ? "+" : ""}${(pred * 100).toFixed(1)}%` : "—"}
                        </td>
                        <td style={{ padding: "5px 8px", textAlign: "right" }}>
                          <span style={{ fontSize: 10, fontWeight: 700, color: label.color }}>{label.text}</span>
                        </td>
                        <td style={{ padding: "5px 8px", fontSize: 10, textAlign: "right", color: "rgba(255,255,255,0.7)" }}>
                          {row.last_close > 0 ? fmtPrice(row.last_close) : "—"}
                        </td>
                        <td style={{ padding: "5px 8px", fontSize: 10, fontWeight: 700, textAlign: "right", color: row.daily_return >= 0 ? "#10b981" : "#ef4444" }}>
                          {row.daily_return !== 0 ? (row.daily_return >= 0 ? "+" : "") + pct(row.daily_return) : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* ================================================================ */}
      {/* EXPLORER TAB                                                      */}
      {/* ================================================================ */}
      {tab === "explorer" && (
        <div>
          {/* Controls */}
          <div style={{ ...cardStyle, marginBottom: 12 }}>
            <div style={{ display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
              {/* Search box */}
              <div style={{ flex: 1, minWidth: 220, position: "relative" }}>
                <div style={{ position: "relative" }}>
                  <input
                    value={explorerSearch}
                    onChange={e => { setExplorerSearch(e.target.value); setExplorerSearchIdx(-1); setShowExplorerSectors(false); }}
                    onKeyDown={e => {
                      if (e.key === "ArrowDown") { e.preventDefault(); setExplorerSearchIdx(i => Math.min(i + 1, explorerSearchResults.length - 1)); }
                      else if (e.key === "ArrowUp") { e.preventDefault(); setExplorerSearchIdx(i => Math.max(i - 1, -1)); }
                      else if (e.key === "Enter") {
                        e.preventDefault();
                        const pick = explorerSearchIdx >= 0 ? explorerSearchResults[explorerSearchIdx] : explorerSearchResults[0];
                        if (pick) { setExplorerTicker(pick.ticker); setExplorerSearch(""); setExplorerSearchIdx(-1); }
                      }
                      else if (e.key === "Escape") { setExplorerSearch(""); setExplorerSearchIdx(-1); }
                    }}
                    placeholder="Search by ticker or company name..."
                    style={{
                      width: "100%", padding: "9px 14px", paddingLeft: 34,
                      background: "#0d1117", border: "1px solid #30363d", borderRadius: 6,
                      color: "#fff", fontSize: 12, fontFamily: "monospace",
                      boxSizing: "border-box" as const, outline: "none",
                    }}
                    onFocus={e => (e.currentTarget.style.borderColor = "#3b82f6")}
                    onBlur={e => (e.currentTarget.style.borderColor = "#30363d")}
                  />
                  <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "rgba(255,255,255,0.3)", fontSize: 13 }}>⌕</span>
                </div>
                {/* Search dropdown */}
                {explorerSearchResults.length > 0 && (
                  <div style={{
                    position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0,
                    background: "#161b22", border: "1px solid #3b82f6", borderRadius: 6,
                    zIndex: 30, maxHeight: 300, overflowY: "auto",
                    boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
                  }}>
                    {explorerSearchResults.map((s, sIdx) => (
                      <div key={s.ticker}
                        onMouseDown={() => { setExplorerTicker(s.ticker); setExplorerSearch(""); setExplorerSearchIdx(-1); }}
                        style={{ padding: "8px 14px", fontSize: 12, fontFamily: "monospace", cursor: "pointer", display: "flex", alignItems: "center", gap: 10, borderBottom: "1px solid #21262d",
                          background: sIdx === explorerSearchIdx ? "rgba(59,130,246,0.15)" : "transparent" }}
                        onMouseEnter={e => { if (sIdx !== explorerSearchIdx) e.currentTarget.style.background = "rgba(59,130,246,0.1)"; }}
                        onMouseLeave={e => { e.currentTarget.style.background = sIdx === explorerSearchIdx ? "rgba(59,130,246,0.15)" : "transparent"; }}>
                        <span style={{ fontWeight: 700, color: "#fff", minWidth: 56 }}>{s.ticker}</span>
                        <span style={{ color: "rgba(255,255,255,0.5)", flex: 1, fontSize: 11 }}>{s.name}</span>
                        <span style={{ fontSize: 8, padding: "2px 6px", borderRadius: 3, background: `${sectorColor(s.sector)}20`, color: sectorColor(s.sector), fontWeight: 700 }}>{s.sector}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Selected ticker badge */}
              {explorerTicker ? (
                <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 12px", background: "rgba(59,130,246,0.1)", border: "1px solid rgba(59,130,246,0.3)", borderRadius: 6 }}>
                  <span style={{ fontSize: 13, fontWeight: 800, fontFamily: "monospace", color: "#3b82f6" }}>{explorerTicker}</span>
                  <button onClick={() => { setExplorerTicker(""); setTickerHistory(null); }}
                    style={{ background: "none", border: "none", color: "rgba(255,255,255,0.4)", cursor: "pointer", fontSize: 14, lineHeight: 1, padding: 0 }}>×</button>
                </div>
              ) : (
                <div style={{ padding: "8px 12px", background: "#0d1117", border: "1px solid #21262d", borderRadius: 6, fontSize: 10, fontFamily: "monospace", color: "rgba(255,255,255,0.25)" }}>
                  No stock selected
                </div>
              )}

              {/* Timeframe buttons */}
              <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                {[180, 365, 730, 1825, 9999].map(d => (
                  <button key={d} onClick={() => setExplorerDays(d)}
                    style={{ ...btnSecondary, fontSize: 9, padding: "8px 12px", background: explorerDays === d ? "#3b82f6" : "#21262d", color: explorerDays === d ? "#fff" : "rgba(255,255,255,0.6)" }}>
                    {d === 9999 ? "MAX" : d <= 365 ? `${d}D` : `${Math.round(d / 365)}Y`}
                  </button>
                ))}
              </div>

              <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
                {explorerTicker && (
                  <span style={{ fontSize: 10, fontFamily: "monospace", color: "rgba(255,255,255,0.3)" }}>
                    {tickerHistory?.signals.filter(s => s.model_id === selectedModel).length || 0} signals · {tickerHistory?.actualReturns.length || 0} days
                  </span>
                )}
                <button onClick={() => setExplorerShowMLGuide(v => !v)} style={guideButtonStyle(explorerShowMLGuide)}>
                  <span style={{ fontSize: 11 }}>◈</span> {explorerShowMLGuide ? "HIDE ML GUIDE" : "HOW ML SIGNALS WORK"}
                </button>
              </div>
            </div>

            {/* Sector browser toggle */}
            <button
              onClick={() => setShowExplorerSectors(v => !v)}
              style={{
                display: "flex", alignItems: "center", gap: 6, padding: "6px 0", marginTop: 10,
                background: "none", border: "none",
                color: showExplorerSectors ? "#3b82f6" : "rgba(255,255,255,0.4)",
                fontSize: 10, fontFamily: "monospace", cursor: "pointer", letterSpacing: "0.05em",
              }}
              onMouseEnter={e => { if (!showExplorerSectors) e.currentTarget.style.color = "#3b82f6"; }}
              onMouseLeave={e => { if (!showExplorerSectors) e.currentTarget.style.color = "rgba(255,255,255,0.4)"; }}>
              {showExplorerSectors ? "▲ HIDE SECTOR BROWSER" : "▼ BROWSE BY SECTOR"}
              <span style={{ fontSize: 9, opacity: 0.6 }}>({allStocks.length} stocks)</span>
            </button>

            {/* Sector browser panel */}
            {showExplorerSectors && (
              <div style={{ marginTop: 4, padding: 12, background: "#0d1117", border: "1px solid #30363d", borderRadius: 6, maxHeight: 400, overflowY: "auto" }}>
                {/* Filter + sort row */}
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
                  <input
                    value={explorerSectorFilter}
                    onChange={e => setExplorerSectorFilter(e.target.value)}
                    placeholder="Filter stocks..."
                    style={{ flex: 1, padding: "5px 10px", background: "#161b22", border: "1px solid #21262d", borderRadius: 4, color: "#fff", fontSize: 11, fontFamily: "monospace", outline: "none" }}
                  />
                  <div style={{ display: "flex", gap: 2 }}>
                    {(["name", "alpha"] as const).map(key => (
                      <button key={key} onClick={() => setExplorerSectorSort(key)}
                        style={{ padding: "4px 8px", borderRadius: 3, fontSize: 9, fontWeight: 600, fontFamily: "monospace", cursor: "pointer",
                          border: `1px solid ${explorerSectorSort === key ? "#3b82f6" : "#21262d"}`,
                          background: explorerSectorSort === key ? "#3b82f6" : "transparent",
                          color: explorerSectorSort === key ? "#fff" : "rgba(255,255,255,0.4)" }}>
                        {key === "name" ? "SECTOR" : "A-Z"}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Sector groups */}
                {explorerSectorNames.map(sector => {
                  const stocks = explorerSectorGroups[sector];
                  if (!stocks || stocks.length === 0) return null;
                  const isExpanded = expandedExplorerSectors.has(sector);
                  const color = sectorColor(sector);
                  return (
                    <div key={sector} style={{ marginBottom: 2 }}>
                      <button
                        onClick={() => setExpandedExplorerSectors(prev => {
                          const next = new Set(prev);
                          if (next.has(sector)) next.delete(sector); else next.add(sector);
                          return next;
                        })}
                        style={{
                          width: "100%", display: "flex", alignItems: "center", gap: 8,
                          padding: "7px 10px", background: isExpanded ? `${color}12` : "transparent",
                          border: "none", borderBottom: `1px solid ${isExpanded ? color + "30" : "#21262d"}`,
                          cursor: "pointer", borderRadius: isExpanded ? "4px 4px 0 0" : 4,
                        }}
                        onMouseEnter={e => { if (!isExpanded) e.currentTarget.style.background = "#161b2280"; }}
                        onMouseLeave={e => { if (!isExpanded) e.currentTarget.style.background = "transparent"; }}>
                        <span style={{ width: 3, height: 14, background: color, borderRadius: 2, flexShrink: 0 }} />
                        <span style={{ fontSize: 10, fontWeight: 700, fontFamily: "monospace", color }}>{sector}</span>
                        <span style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", fontFamily: "monospace" }}>{stocks.length} stocks</span>
                        <span style={{ marginLeft: "auto", fontSize: 9, color: "rgba(255,255,255,0.3)" }}>{isExpanded ? "▲" : "▼"}</span>
                      </button>
                      {isExpanded && (
                        <div style={{ background: `${color}06`, border: `1px solid ${color}20`, borderTop: "none", borderRadius: "0 0 4px 4px", padding: "4px 0" }}>
                          {stocks.map(s => (
                            <div key={s.ticker}
                              onClick={() => { setExplorerTicker(s.ticker); setShowExplorerSectors(false); setExplorerSearch(""); }}
                              style={{
                                display: "flex", alignItems: "center", gap: 10, padding: "6px 14px",
                                cursor: "pointer", borderBottom: "1px solid rgba(255,255,255,0.03)",
                                background: explorerTicker === s.ticker ? "rgba(59,130,246,0.12)" : "transparent",
                              }}
                              onMouseEnter={e => { if (explorerTicker !== s.ticker) e.currentTarget.style.background = "rgba(255,255,255,0.03)"; }}
                              onMouseLeave={e => { e.currentTarget.style.background = explorerTicker === s.ticker ? "rgba(59,130,246,0.12)" : "transparent"; }}>
                              <span style={{ fontSize: 11, fontWeight: 700, fontFamily: "monospace", color: explorerTicker === s.ticker ? "#3b82f6" : "#fff", minWidth: 60 }}>{s.ticker}</span>
                              <span style={{ fontSize: 10, color: "rgba(255,255,255,0.45)", fontFamily: "monospace", flex: 1 }}>{s.name}</span>
                              {explorerTicker === s.ticker && <span style={{ fontSize: 9, color: "#3b82f6" }}>●</span>}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {renderMLGuidePanel(explorerShowMLGuide)}
          </div>

          {/* Fundamentals */}
          {explorerTicker && tickerHistory?.fundamentals && (
            <div style={{ ...cardStyle, marginBottom: 12, padding: "10px 16px", display: "flex", gap: 20, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.4)", fontFamily: "monospace" }}>FUNDAMENTALS:</span>
              {(() => {
                const f = tickerHistory.fundamentals!;
                const sa = tickerHistory.sectorAvg;
                const rel = (val: number, avg: number | undefined, invert = false) => {
                  if (!avg || avg === 0) return "";
                  const r = val / avg;
                  return (invert ? r < 0.8 : r < 0.8) ? " cheap" : (invert ? r > 1.2 : r > 1.2) ? " expensive" : "";
                };
                return [
                  { label: "E/P", value: f.ep ? (f.ep * 100).toFixed(1) + "%" : "—", hint: f.ep ? rel(f.ep, sa?.avg_ep) : "" },
                  { label: "B/M", value: f.bm ? f.bm.toFixed(2) : "—", hint: "" },
                  { label: "DY", value: f.dy ? (f.dy * 100).toFixed(1) + "%" : "—", hint: "" },
                  { label: "EV/EBITDA", value: (f.ev_ebitda && f.ev_ebitda > 0 && f.ev_ebitda < 100) ? f.ev_ebitda.toFixed(1) + "x" : "—", hint: (f.ev_ebitda && f.ev_ebitda > 0 && f.ev_ebitda < 100) ? rel(f.ev_ebitda, sa?.avg_ev_ebitda, true) : "" },
                  { label: "MCap", value: f.mktcap ? (f.mktcap / 1e9).toFixed(1) + "B" : "—", hint: "" },
                ].map(item => (
                  <div key={item.label} style={{ display: "flex", gap: 4, alignItems: "baseline" }}>
                    <span style={{ fontSize: 8, color: "rgba(255,255,255,0.35)", fontFamily: "monospace" }}>{item.label}:</span>
                    <span style={{ fontSize: 12, fontWeight: 700, fontFamily: "monospace", color: "#fff" }}>{item.value}</span>
                    {item.hint && <span style={{ fontSize: 8, fontFamily: "monospace", color: item.hint.includes("cheap") ? "#10b981" : "#ef4444" }}>{item.hint}</span>}
                  </div>
                ));
              })()}
              <span style={{ fontSize: 9, fontFamily: "monospace", color: sectorColor(tickerHistory.sector), fontWeight: 700, marginLeft: "auto" }}>{tickerHistory.sector}</span>
            </div>
          )}

          {!explorerTicker && (
            <div style={{ ...cardStyle, textAlign: "center", padding: 60 }}>
              <div style={{ fontSize: 14, fontWeight: 700, fontFamily: "monospace", color: "rgba(255,255,255,0.3)", marginBottom: 8 }}>Select a stock to explore</div>
              <div style={{ fontSize: 11, fontFamily: "monospace", color: "rgba(255,255,255,0.2)" }}>Pick a ticker from the dropdown, or click any stock from the Signals tab</div>
            </div>
          )}

          {explorerTicker && explorerLoading && (
            <div style={{ ...cardStyle, textAlign: "center", padding: 40, color: "rgba(255,255,255,0.4)", fontFamily: "monospace" }}>Loading {explorerTicker}...</div>
          )}

          {explorerTicker && !explorerLoading && explorerChartData.length > 0 && (
            <>
              {/* Price Chart */}
              <div style={{ ...cardStyle, marginBottom: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <div style={sectionTitle}>{explorerTicker} — Price & 200MA</div>
                  <div style={{ fontSize: 9, fontFamily: "monospace", color: "rgba(255,255,255,0.3)" }}>
                    <span style={{ color: "#f59e0b" }}>— 200MA</span>
                    &nbsp;&nbsp;<span style={{ color: "rgba(139,157,195,0.6)" }}>— 50MA</span>
                  </div>
                </div>
                <ResponsiveContainer width="100%" height={320}>
                  <ComposedChart data={chartDataWithLine} margin={{ top: 5, right: 10, left: 10, bottom: 0 }}>
                    <defs>
                      <linearGradient id="priceGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.25} />
                        <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                    <XAxis dataKey="date" tick={{ fontSize: 9, fill: "rgba(255,255,255,0.4)", fontFamily: "monospace" }} tickFormatter={d => d.slice(5)} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 9, fill: "rgba(255,255,255,0.4)", fontFamily: "monospace" }} domain={["auto", "auto"]} />
                    <Tooltip
                      contentStyle={{ background: "#0d1117", border: "1px solid #30363d", borderRadius: 6, fontFamily: "monospace", fontSize: 11, color: "#fff" }}
                      labelStyle={{ color: "rgba(255,255,255,0.6)", marginBottom: 4 }}
                      formatter={((v: number, name: string) => name === "close" ? [`NOK ${fmtPrice(v)}`, "Price"] : name === "sma200" ? [fmtPrice(v), "200MA"] : name === "sma50" ? [fmtPrice(v), "50MA"] : [null, ""]) as Parameters<typeof Tooltip>[0]["formatter"]} />
                    <Area type="monotone" dataKey="close" stroke="#3b82f6" fill="url(#priceGrad)" strokeWidth={1.5} dot={false} isAnimationActive={false} name="close" />
                    <Line type="monotone" dataKey="sma200" stroke="#f59e0b" strokeWidth={1.5} dot={false} strokeDasharray="6 3" connectNulls isAnimationActive={false} name="sma200" />
                    <Line type="monotone" dataKey="sma50" stroke="rgba(139,157,195,0.5)" strokeWidth={1} dot={false} strokeDasharray="3 3" connectNulls isAnimationActive={false} name="sma50" />
                    {/* Dotted connector line for selected trade */}
                    <Line type="linear" dataKey="tradeLine"
                      stroke={selectedTrade ? (selectedTrade.pnl >= 0 ? "#10b981" : "#ef4444") : "transparent"}
                      strokeWidth={1.5} strokeDasharray="6 3" connectNulls={true}
                      dot={false} isAnimationActive={false} legendType="none" />
                    {/* Trade ENTRY triangles (green ▲) — click to select trade */}
                    <Line type="monotone" dataKey="tradeEntry" stroke="none" legendType="none" isAnimationActive={false} connectNulls={false}
                      dot={(props: { cx?: number; cy?: number; payload?: { tradeEntry?: number; date?: string } }) => {
                        const { cx, cy, payload } = props;
                        if (!payload?.tradeEntry || cx == null || cy == null) return <g key={`ten-${cx}-${cy}`} />;
                        const date = payload.date ?? "";
                        const isSelected = selectedTradeDate === date;
                        const pts = `${cx},${cy - 10} ${cx - 7},${cy + 4} ${cx + 7},${cy + 4}`;
                        return (
                          <polygon key={`te-${cx}`} points={pts}
                            fill="#10b981" stroke={isSelected ? "#fff" : "#0a0a0a"} strokeWidth={isSelected ? 2 : 1.5}
                            style={{ cursor: "pointer" }}
                            onClick={() => setSelectedTradeDate(prev => prev === date ? null : date)} />
                        );
                      }} />
                    {/* Trade EXIT triangles (red ▼) — click to select trade */}
                    <Line type="monotone" dataKey="tradeExit" stroke="none" legendType="none" isAnimationActive={false} connectNulls={false}
                      dot={(props: { cx?: number; cy?: number; payload?: { tradeExit?: number; exitDot?: number; date?: string } }) => {
                        const { cx, cy, payload } = props;
                        if (!payload?.tradeExit || !payload?.exitDot || cx == null || cy == null) return <g key={`txn-${cx}-${cy}`} />;
                        const exitDate = payload.date ?? "";
                        const trade = explorerTrades.find(t => t.exitDate === exitDate);
                        const entryDate = trade?.entryDate ?? "";
                        const isSelected = selectedTradeDate === entryDate;
                        const pts = `${cx},${cy + 10} ${cx - 7},${cy - 4} ${cx + 7},${cy - 4}`;
                        return (
                          <polygon key={`tx-${cx}`} points={pts}
                            fill="#ef4444" stroke={isSelected ? "#fff" : "#0a0a0a"} strokeWidth={isSelected ? 2 : 1.5}
                            style={{ cursor: "pointer" }}
                            onClick={() => setSelectedTradeDate(prev => prev === entryDate ? null : entryDate)} />
                        );
                      }} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>

              {/* ML Predicted Return chart — PRIMARY TRADE SIGNAL */}
              <div style={{ ...cardStyle, marginBottom: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <div style={sectionTitle}>ML Predicted Return — Trade Signal</div>
                  <div style={{ display: "flex", gap: 16, fontSize: 9, fontFamily: "monospace" }}>
                    <span style={{ color: "#10b981" }}>▲ ENTER (&gt;{TRADE_ENTRY_PCT}%)</span>
                    <span style={{ color: "#ef4444" }}>▼ EXIT (&lt;{TRADE_EXIT_PCT}%)</span>
                    <span style={{ color: "rgba(255,255,255,0.4)" }}>{explorerTrades.length} trades simulated</span>
                  </div>
                </div>
                <ResponsiveContainer width="100%" height={160}>
                  <ComposedChart data={explorerChartData} margin={{ top: 5, right: 48, left: 10, bottom: 0 }}>
                    <defs>
                      <linearGradient id="predGradPos" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#10b981" stopOpacity={0.3} />
                        <stop offset="100%" stopColor="#10b981" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    {/* Entry zone (above ENTRY threshold) */}
                    <ReferenceArea y1={TRADE_ENTRY_PCT} y2={20} fill="#10b981" fillOpacity={0.07} />
                    {/* Danger zone (below EXIT threshold) */}
                    <ReferenceArea y1={-20} y2={TRADE_EXIT_PCT} fill="#ef4444" fillOpacity={0.07} />
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                    <XAxis dataKey="date" tick={{ fontSize: 8, fill: "rgba(255,255,255,0.3)", fontFamily: "monospace" }} tickFormatter={d => d.slice(5)} interval="preserveStartEnd" />
                    <YAxis domain={["auto", "auto"]} tick={{ fontSize: 8, fill: "rgba(255,255,255,0.3)", fontFamily: "monospace" }} tickFormatter={v => `${Number(v).toFixed(0)}%`} />
                    <ReferenceLine y={TRADE_ENTRY_PCT} stroke="#10b981" strokeDasharray="5 3" strokeOpacity={0.9} label={{ value: `ENTER +${TRADE_ENTRY_PCT}%`, position: "insideRight", fontSize: 8, fill: "#10b981", fontFamily: "monospace" }} />
                    <ReferenceLine y={TRADE_EXIT_PCT} stroke="#ef4444" strokeDasharray="5 3" strokeOpacity={0.9} label={{ value: `EXIT +${TRADE_EXIT_PCT}%`, position: "insideRight", fontSize: 8, fill: "#ef4444", fontFamily: "monospace" }} />
                    <ReferenceLine y={0} stroke="rgba(255,255,255,0.2)" />
                    <Tooltip
                      contentStyle={{ background: "#0d1117", border: "1px solid #30363d", borderRadius: 6, fontFamily: "monospace", fontSize: 11, color: "#fff" }}
                      labelStyle={{ color: "rgba(255,255,255,0.6)", marginBottom: 4 }}
                      formatter={((v: number, name: string) => {
                        if (name === "pred_pct") return [Number(v).toFixed(2) + "%", "ML Predicted Return"];
                        return [null, ""];
                      }) as Parameters<typeof Tooltip>[0]["formatter"]} />
                    {/* Predicted return line */}
                    <Area type="monotone" dataKey="pred_pct" stroke="#8b9dc3" strokeWidth={1.5} fill="url(#predGradPos)" dot={false} connectNulls={false} isAnimationActive={false} name="pred_pct" />
                    {/* Entry dots on predicted return chart */}
                    <Line type="monotone" dataKey="entryDot" stroke="none" legendType="none" isAnimationActive={false} connectNulls={false}
                      dot={(props: { cx?: number; cy?: number; payload?: { entryDot?: number } }) => {
                        const { cx, cy, payload } = props;
                        if (!payload?.entryDot || cx == null || cy == null) return <g key={`en-${cx}-${cy}`} />;
                        return <circle key={`en-${cx}`} cx={cx} cy={cy} r={5} fill="#10b981" stroke="#0a0a0a" strokeWidth={2} />;
                      }} />
                    {/* Exit dots on predicted return chart */}
                    <Line type="monotone" dataKey="exitDot" stroke="none" legendType="none" isAnimationActive={false} connectNulls={false}
                      dot={(props: { cx?: number; cy?: number; payload?: { exitDot?: number } }) => {
                        const { cx, cy, payload } = props;
                        if (!payload?.exitDot || cx == null || cy == null) return <g key={`ex-${cx}-${cy}`} />;
                        return <circle key={`ex-${cx}`} cx={cx} cy={cy} r={5} fill="#ef4444" stroke="#0a0a0a" strokeWidth={2} />;
                      }} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>

              {/* Trade Log */}
              <div style={cardStyle}>
                {(() => {
                  const wins = explorerTrades.filter(t => !t.open && t.pnl > 0).length;
                  const closed = explorerTrades.filter(t => !t.open).length;
                  const totalPnl = explorerTrades.filter(t => !t.open).reduce((s, t) => s + t.pnl, 0);
                  const avgPnl = closed > 0 ? totalPnl / closed : 0;
                  const avgDD = closed > 0 ? explorerTrades.filter(t => !t.open).reduce((s, t) => s + t.maxDrawdown, 0) / closed : 0;
                  return (
                    <>
                      {/* ── Strategy Parameter Controls ── */}
                      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12, flexWrap: "wrap", background: "#0d1117", border: "1px solid #21262d", borderRadius: 6, padding: "8px 12px" }}>
                        <span style={{ fontSize: 9, fontFamily: "monospace", color: "rgba(255,255,255,0.4)", letterSpacing: "0.06em", textTransform: "uppercase", marginRight: 4 }}>Strategy</span>
                        {([
                          { label: "Entry >", unit: "%", value: TRADE_ENTRY_PCT, set: setTradeEntryPct, min: 0.1, max: 5, step: 0.1, decimals: 1 },
                          { label: "Stop", unit: "%", value: tradeStopLossPct, set: setTradeStopLossPct, min: 1, max: 20, step: 0.5, decimals: 1, prefix: "-" },
                          { label: "Exit <", unit: "%", value: TRADE_EXIT_PCT, set: setTradeExitPct, min: 0, max: 2, step: 0.05, decimals: 2 },
                          { label: "Min Hold", unit: "d", value: TRADE_MIN_HOLD, set: setTradeMinHold, min: 1, max: 15, step: 1, decimals: 0 },
                          { label: "Max Hold", unit: "d", value: TRADE_MAX_HOLD, set: setTradeMaxHold, min: 5, max: 63, step: 1, decimals: 0 },
                        ] as { label: string; unit: string; value: number; set: (v: number) => void; min: number; max: number; step: number; decimals: number; prefix?: string }[]).map(p => (
                          <div key={p.label} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                            <span style={{ fontSize: 9, fontFamily: "monospace", color: "rgba(255,255,255,0.45)" }}>{p.label}</span>
                            <button onClick={() => p.set(Math.max(p.min, parseFloat((p.value - p.step).toFixed(p.decimals))))}
                              style={{ width: 18, height: 18, background: "#21262d", border: "1px solid #30363d", borderRadius: 3, color: "rgba(255,255,255,0.6)", cursor: "pointer", fontSize: 11, lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "monospace" }}>−</button>
                            <span style={{ fontSize: 10, fontFamily: "monospace", color: "#fff", fontWeight: 700, minWidth: 32, textAlign: "center" }}>{p.prefix ?? ""}{p.value.toFixed(p.decimals)}{p.unit}</span>
                            <button onClick={() => p.set(Math.min(p.max, parseFloat((p.value + p.step).toFixed(p.decimals))))}
                              style={{ width: 18, height: 18, background: "#21262d", border: "1px solid #30363d", borderRadius: 3, color: "rgba(255,255,255,0.6)", cursor: "pointer", fontSize: 11, lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "monospace" }}>+</button>
                          </div>
                        ))}
                        <button onClick={() => { setTradeEntryPct(1.0); setTradeStopLossPct(5.0); setTradeExitPct(0.25); setTradeMinHold(5); setTradeMaxHold(21); }}
                          style={{ marginLeft: "auto", fontSize: 9, fontFamily: "monospace", color: "rgba(255,255,255,0.35)", background: "none", border: "1px solid #30363d", borderRadius: 3, padding: "2px 8px", cursor: "pointer" }}>RESET</button>
                      </div>

                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                        <div>
                          <div style={sectionTitle}>Simulated Trade Log — Entry &gt;{TRADE_ENTRY_PCT}% · Stop -{tradeStopLossPct}% · Min {TRADE_MIN_HOLD}d · Max {TRADE_MAX_HOLD}d</div>
                          <div style={{ fontSize: 9, fontFamily: "monospace", color: "rgba(255,255,255,0.25)", marginTop: -8 }}>
                            Click a row (or ▲▼ on chart) to highlight the trade with a dotted connector line
                          </div>
                        </div>
                        <div style={{ display: "flex", gap: 16, fontSize: 10, fontFamily: "monospace" }}>
                          <span style={{ color: "rgba(255,255,255,0.4)" }}>Trades: <span style={{ color: "#fff", fontWeight: 700 }}>{explorerTrades.length}</span></span>
                          <span style={{ color: "rgba(255,255,255,0.4)" }}>Win Rate: <span style={{ color: closed > 0 && wins/closed >= 0.5 ? "#10b981" : "#ef4444", fontWeight: 700 }}>{closed > 0 ? Math.round(wins/closed*100) : 0}%</span></span>
                          <span style={{ color: "rgba(255,255,255,0.4)" }}>Avg P&L: <span style={{ color: avgPnl >= 0 ? "#10b981" : "#ef4444", fontWeight: 700 }}>{avgPnl >= 0 ? "+" : ""}{(avgPnl*100).toFixed(1)}%</span></span>
                          <span style={{ color: "rgba(255,255,255,0.4)" }}>Avg DD: <span style={{ color: "#ef4444", fontWeight: 700 }}>{(Math.min(avgDD, 0)*100).toFixed(1)}%</span></span>
                          <span style={{ color: "rgba(255,255,255,0.4)" }}>Total: <span style={{ color: totalPnl >= 0 ? "#10b981" : "#ef4444", fontWeight: 700 }}>{totalPnl >= 0 ? "+" : ""}{(totalPnl*100).toFixed(1)}%</span></span>
                        </div>
                      </div>
                      {explorerTrades.length === 0 ? (
                        <div style={{ textAlign: "center", padding: 24, color: "rgba(255,255,255,0.3)", fontFamily: "monospace", fontSize: 11 }}>
                          No trades generated. ML predictions may not cross the {TRADE_ENTRY_PCT}% threshold in the selected window.
                        </div>
                      ) : (
                        <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "monospace" }}>
                          <thead>
                            <tr style={{ borderBottom: "1px solid #30363d" }}>
                              {["Entry Date", "Exit Date", "Entry Price", "Exit Price", "Max DD", "P&L", "Status"].map(h => (
                                <th key={h} style={{ fontSize: 9, fontWeight: 600, color: "rgba(255,255,255,0.5)", padding: "5px 8px", textAlign: h === "Entry Date" ? "left" as const : "right" as const }}>{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {[...explorerTrades].reverse().map((t, i) => {
                              const isSelected = selectedTradeDate === t.entryDate;
                              return (
                              <tr key={i}
                                style={{ borderBottom: "1px solid rgba(48,54,61,0.3)", cursor: "pointer",
                                  background: isSelected ? "rgba(59,130,246,0.14)" : t.open ? "rgba(59,130,246,0.04)" : "transparent",
                                  outline: isSelected ? "1px solid rgba(59,130,246,0.4)" : "none" }}
                                onClick={() => setSelectedTradeDate(prev => prev === t.entryDate ? null : t.entryDate)}
                                onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = "rgba(59,130,246,0.07)"; }}
                                onMouseLeave={e => { e.currentTarget.style.background = isSelected ? "rgba(59,130,246,0.14)" : t.open ? "rgba(59,130,246,0.04)" : "transparent"; }}>
                                <td style={{ padding: "5px 8px", fontSize: 10, color: isSelected ? "#3b82f6" : "rgba(255,255,255,0.7)", fontWeight: isSelected ? 700 : 400 }}>{t.entryDate}</td>
                                <td style={{ padding: "5px 8px", fontSize: 10, textAlign: "right", color: t.open ? "#3b82f6" : "rgba(255,255,255,0.7)" }}>{t.exitDate}{t.open ? " ●" : ""}</td>
                                <td style={{ padding: "5px 8px", fontSize: 10, textAlign: "right", color: "rgba(255,255,255,0.5)" }}>NOK {fmtPrice(t.entryPrice)}</td>
                                <td style={{ padding: "5px 8px", fontSize: 10, textAlign: "right", color: "rgba(255,255,255,0.5)" }}>NOK {fmtPrice(t.exitPrice)}</td>
                                <td style={{ padding: "5px 8px", fontSize: 10, fontWeight: 600, textAlign: "right", color: t.maxDrawdown < 0 ? "#ef4444" : "rgba(255,255,255,0.3)" }}>
                                  {t.maxDrawdown < 0 ? (t.maxDrawdown * 100).toFixed(1) + "%" : "0%"}
                                </td>
                                <td style={{ padding: "5px 8px", fontSize: 11, fontWeight: 700, textAlign: "right", color: t.pnl >= 0 ? "#10b981" : "#ef4444" }}>
                                  {t.pnl >= 0 ? "+" : ""}{(t.pnl * 100).toFixed(1)}%
                                </td>
                                <td style={{ padding: "5px 8px", fontSize: 9, textAlign: "right", color: t.open ? "#3b82f6" : t.pnl >= 0 ? "#10b981" : "#ef4444", fontWeight: 700 }}>
                                  {t.open ? "OPEN" : t.pnl >= 0 ? "WIN" : "LOSS"}
                                </td>
                              </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      )}
                    </>
                  );
                })()}
              </div>
            </>
          )}
        </div>
      )}
      {/* ================================================================ */}
      {/* SIMULATOR TAB                                                   */}
      {/* ================================================================ */}
      {tab === "simulator" && (
        <div>
          {/* ── Controls Bar ── */}
          <div style={{ ...cardStyle, marginBottom: 12, padding: "12px 16px" }}>
            {/* Row 1: Ticker + Timeframe + Playback */}
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              {/* Ticker search (Explorer-style) */}
              <div style={{ flex: 1, minWidth: 220, position: "relative" }}>
                <div style={{ position: "relative" }}>
                  <input
                    value={simSearch}
                    onChange={e => { setSimSearch(e.target.value); setSimSearchIdx(-1); setSimShowSectors(false); }}
                    onKeyDown={e => {
                      if (e.key === "ArrowDown") { e.preventDefault(); setSimSearchIdx(i => Math.min(i + 1, simSearchResults.length - 1)); }
                      else if (e.key === "ArrowUp") { e.preventDefault(); setSimSearchIdx(i => Math.max(i - 1, -1)); }
                      else if (e.key === "Enter") {
                        e.preventDefault();
                        const pick = simSearchIdx >= 0 ? simSearchResults[simSearchIdx] : simSearchResults[0];
                        if (pick) { setSimTicker(pick.ticker); setSimSearch(""); setSimSearchIdx(-1); }
                      }
                      else if (e.key === "Escape") { setSimSearch(""); setSimSearchIdx(-1); }
                    }}
                    placeholder="Search by ticker or company name..."
                    style={{
                      width: "100%", padding: "9px 14px", paddingLeft: 34,
                      background: "#0d1117", border: "1px solid #30363d", borderRadius: 6,
                      color: "#fff", fontSize: 12, fontFamily: "monospace",
                      boxSizing: "border-box" as const, outline: "none",
                    }}
                    onFocus={e => (e.currentTarget.style.borderColor = "#3b82f6")}
                    onBlur={e => (e.currentTarget.style.borderColor = "#30363d")}
                  />
                  <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "rgba(255,255,255,0.3)", fontSize: 13 }}>⌕</span>
                </div>
                {simSearchResults.length > 0 && (
                  <div style={{
                    position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0,
                    background: "#161b22", border: "1px solid #3b82f6", borderRadius: 6,
                    zIndex: 30, maxHeight: 300, overflowY: "auto",
                    boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
                  }}>
                    {simSearchResults.map((s, sIdx) => (
                      <div key={s.ticker}
                        onMouseDown={() => { setSimTicker(s.ticker); setSimSearch(""); setSimSearchIdx(-1); }}
                        style={{ padding: "8px 14px", fontSize: 12, fontFamily: "monospace", cursor: "pointer", display: "flex", alignItems: "center", gap: 10, borderBottom: "1px solid #21262d",
                          background: sIdx === simSearchIdx ? "rgba(59,130,246,0.15)" : "transparent" }}
                        onMouseEnter={e => { if (sIdx !== simSearchIdx) e.currentTarget.style.background = "rgba(59,130,246,0.1)"; }}
                        onMouseLeave={e => { e.currentTarget.style.background = sIdx === simSearchIdx ? "rgba(59,130,246,0.15)" : "transparent"; }}>
                        <span style={{ fontWeight: 700, color: "#fff", minWidth: 56 }}>{s.ticker}</span>
                        <span style={{ color: "rgba(255,255,255,0.5)", flex: 1, fontSize: 11 }}>{s.name}</span>
                        <span style={{ fontSize: 8, padding: "2px 6px", borderRadius: 3, background: `${sectorColor(s.sector)}20`, color: sectorColor(s.sector), fontWeight: 700 }}>{s.sector}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Selected ticker badge */}
              {simTicker ? (
                <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 12px", background: "rgba(59,130,246,0.1)", border: "1px solid rgba(59,130,246,0.3)", borderRadius: 6 }}>
                  <span style={{ fontSize: 13, fontWeight: 800, fontFamily: "monospace", color: "#3b82f6" }}>{simTicker}</span>
                  <span style={{ fontSize: 9, color: sectorColor(simData?.sector ?? ""), fontFamily: "monospace", fontWeight: 700 }}>{simData?.sector ?? ""}</span>
                  <button onClick={() => { setSimTicker(""); setSimData(null); setSimIsPlaying(false); setSimPlayIdx(-1); }}
                    style={{ background: "none", border: "none", color: "rgba(255,255,255,0.4)", cursor: "pointer", fontSize: 14, lineHeight: 1, padding: 0 }}>×</button>
                </div>
              ) : (
                <div style={{ padding: "8px 12px", background: "#0d1117", border: "1px solid #21262d", borderRadius: 6, fontSize: 10, fontFamily: "monospace", color: "rgba(255,255,255,0.25)" }}>
                  No stock selected
                </div>
              )}

              {/* Timeframe */}
              <div style={{ display: "flex", gap: 3 }}>
                {[{ d: 180, l: "180D" }, { d: 365, l: "1Y" }, { d: 730, l: "2Y" }, { d: 1825, l: "5Y" }].map(t => (
                  <button key={t.d} onClick={() => setSimDays(t.d)}
                    style={{ padding: "5px 10px", background: simDays === t.d ? "rgba(59,130,246,0.25)" : "#0d1117",
                      border: `1px solid ${simDays === t.d ? "#3b82f6" : "#30363d"}`,
                      color: simDays === t.d ? "#3b82f6" : "rgba(255,255,255,0.35)", borderRadius: 4,
                      fontSize: 10, fontWeight: 700, cursor: "pointer", fontFamily: "monospace" }}>{t.l}</button>
                ))}
              </div>

              <div style={{ width: 1, height: 20, background: "#30363d" }} />

              {/* Play/Pause/Reset */}
              <button onClick={() => {
                if (!simResult) return;
                const atEnd = simPlayIdx >= simResult.series.length - 1;
                if (simPlayIdx < 0 || atEnd) {
                  setSimIsPlaying(false);
                  setTimeout(() => { setSimPlayIdx(0); setSimIsPlaying(true); }, 50);
                } else {
                  setSimIsPlaying(p => !p);
                }
              }}
                disabled={!simResult}
                style={{ ...btnPrimary, padding: "6px 18px", minWidth: 90, opacity: !simResult ? 0.5 : 1, fontSize: 11, letterSpacing: 1 }}>
                {simIsPlaying ? "⏸ PAUSE" : "▶  PLAY"}
              </button>
              <button onClick={() => { setSimIsPlaying(false); setTimeout(() => setSimPlayIdx(-1), 50); }}
                style={{ ...btnSecondary, padding: "6px 12px", fontSize: 10 }}>⏹ RESET</button>

              {/* Speed */}
              <div style={{ display: "flex", gap: 3 }}>
                {[1, 3, 5, 10].map(s => (
                  <button key={s} onClick={() => setSimSpeed(s)}
                    style={{ padding: "4px 9px", background: simSpeed === s ? "rgba(59,130,246,0.25)" : "#0d1117",
                      border: `1px solid ${simSpeed === s ? "#3b82f6" : "#30363d"}`,
                      color: simSpeed === s ? "#3b82f6" : "rgba(255,255,255,0.35)", borderRadius: 4,
                      fontSize: 10, fontWeight: 700, cursor: "pointer", fontFamily: "monospace" }}>{s}×</button>
                ))}
              </div>

              {/* Progress bar */}
              <div style={{ flex: 1, minWidth: 80 }}>
                <div style={{ background: "#21262d", borderRadius: 3, height: 5, overflow: "hidden" }}>
                  <div style={{ width: `${simProgress.toFixed(1)}%`, height: "100%", background: "linear-gradient(90deg, #3b82f6, #10b981)", transition: "width 0.08s linear", borderRadius: 3 }} />
                </div>
              </div>

              {/* Date */}
              <div style={{ fontSize: 12, fontWeight: 800, color: simLoading ? "#f59e0b" : "#fff", fontFamily: "monospace", letterSpacing: 1.5, minWidth: 100, textAlign: "right" as const }}>
                {simLoading ? "⟳ LOADING" : (simCurrent?.date ?? "—")}
              </div>
            </div>

            {/* Sector browser toggle */}
            <button
              onClick={() => setSimShowSectors(v => !v)}
              style={{
                display: "flex", alignItems: "center", gap: 6, padding: "6px 0", marginTop: 10,
                background: "none", border: "none",
                color: simShowSectors ? "#3b82f6" : "rgba(255,255,255,0.4)",
                fontSize: 10, fontFamily: "monospace", cursor: "pointer", letterSpacing: "0.05em",
              }}
              onMouseEnter={e => { if (!simShowSectors) e.currentTarget.style.color = "#3b82f6"; }}
              onMouseLeave={e => { if (!simShowSectors) e.currentTarget.style.color = "rgba(255,255,255,0.4)"; }}>
              {simShowSectors ? "▲ HIDE SECTOR BROWSER" : "▼ BROWSE BY SECTOR"}
              <span style={{ fontSize: 9, opacity: 0.6 }}>({allStocks.length} stocks)</span>
            </button>

            {/* Sector browser panel */}
            {simShowSectors && (
              <div style={{ marginTop: 4, padding: 12, background: "#0d1117", border: "1px solid #30363d", borderRadius: 6, maxHeight: 400, overflowY: "auto" }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
                  <input
                    value={simSectorFilter}
                    onChange={e => setSimSectorFilter(e.target.value)}
                    placeholder="Filter stocks..."
                    style={{ flex: 1, padding: "5px 10px", background: "#161b22", border: "1px solid #21262d", borderRadius: 4, color: "#fff", fontSize: 11, fontFamily: "monospace", outline: "none" }}
                  />
                  <div style={{ display: "flex", gap: 2 }}>
                    {(["name", "alpha"] as const).map(key => (
                      <button key={key} onClick={() => setSimSectorSort(key)}
                        style={{ padding: "4px 8px", borderRadius: 3, fontSize: 9, fontWeight: 600, fontFamily: "monospace", cursor: "pointer",
                          border: `1px solid ${simSectorSort === key ? "#3b82f6" : "#21262d"}`,
                          background: simSectorSort === key ? "#3b82f6" : "transparent",
                          color: simSectorSort === key ? "#fff" : "rgba(255,255,255,0.4)" }}>
                        {key === "name" ? "SECTOR" : "A-Z"}
                      </button>
                    ))}
                  </div>
                </div>

                {simSectorNames.map(sector => {
                  const stocks = simSectorGroups[sector];
                  if (!stocks || stocks.length === 0) return null;
                  const isExpanded = simExpandedSectors.has(sector);
                  const color = sectorColor(sector);
                  return (
                    <div key={sector} style={{ marginBottom: 2 }}>
                      <button
                        onClick={() => setSimExpandedSectors(prev => {
                          const next = new Set(prev);
                          if (next.has(sector)) next.delete(sector); else next.add(sector);
                          return next;
                        })}
                        style={{
                          width: "100%", display: "flex", alignItems: "center", gap: 8,
                          padding: "7px 10px", background: isExpanded ? `${color}12` : "transparent",
                          border: "none", borderBottom: `1px solid ${isExpanded ? color + "30" : "#21262d"}`,
                          cursor: "pointer", borderRadius: isExpanded ? "4px 4px 0 0" : 4,
                        }}
                        onMouseEnter={e => { if (!isExpanded) e.currentTarget.style.background = "#161b2280"; }}
                        onMouseLeave={e => { if (!isExpanded) e.currentTarget.style.background = "transparent"; }}>
                        <span style={{ width: 3, height: 14, background: color, borderRadius: 2, flexShrink: 0 }} />
                        <span style={{ fontSize: 10, fontWeight: 700, fontFamily: "monospace", color }}>{sector}</span>
                        <span style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", fontFamily: "monospace" }}>{stocks.length} stocks</span>
                        <span style={{ marginLeft: "auto", fontSize: 9, color: "rgba(255,255,255,0.3)" }}>{isExpanded ? "▲" : "▼"}</span>
                      </button>
                      {isExpanded && (
                        <div style={{ background: `${color}06`, border: `1px solid ${color}20`, borderTop: "none", borderRadius: "0 0 4px 4px", padding: "4px 0" }}>
                          {stocks.map(s => (
                            <div key={s.ticker}
                              onClick={() => { setSimTicker(s.ticker); setSimShowSectors(false); setSimSearch(""); }}
                              style={{
                                display: "flex", alignItems: "center", gap: 10, padding: "6px 14px",
                                cursor: "pointer", borderBottom: "1px solid rgba(255,255,255,0.03)",
                                background: simTicker === s.ticker ? "rgba(59,130,246,0.12)" : "transparent",
                              }}
                              onMouseEnter={e => { if (simTicker !== s.ticker) e.currentTarget.style.background = "rgba(255,255,255,0.03)"; }}
                              onMouseLeave={e => { e.currentTarget.style.background = simTicker === s.ticker ? "rgba(59,130,246,0.12)" : "transparent"; }}>
                              <span style={{ fontSize: 11, fontWeight: 700, fontFamily: "monospace", color: simTicker === s.ticker ? "#3b82f6" : "#fff", minWidth: 60 }}>{s.ticker}</span>
                              <span style={{ fontSize: 10, color: "rgba(255,255,255,0.45)", fontFamily: "monospace", flex: 1 }}>{s.name}</span>
                              {simTicker === s.ticker && <span style={{ fontSize: 9, color: "#3b82f6" }}>●</span>}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* ── Strategy Parameters (boxed controls) ── */}
          <div style={{ ...cardStyle, marginBottom: 12, padding: "10px 14px" }}>
            <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ ...sectionTitle, margin: 0, marginRight: 4, display: "inline" }}>STRATEGY</span>
              {([
                { label: "ENTRY >", value: simEntry, set: setSimEntry, min: 0.25, max: 5, step: 0.25, dec: 2, unit: "%" },
                { label: "EXIT <", value: simExit, set: setSimExit, min: -3, max: 3, step: 0.25, dec: 2, unit: "%" },
                { label: "STOP", value: simStop, set: setSimStop, min: 2, max: 15, step: 0.5, dec: 1, unit: "%", prefix: "-" },
                { label: "TP", value: simTP, set: setSimTP, min: 1, max: 100, step: 1, dec: 0, unit: "%" },
              ] as const).map(p => (
                <div key={p.label} style={{ display: "flex", alignItems: "center", background: "#0d1117", border: "1px solid #21262d", borderRadius: 4, padding: "6px 10px", minWidth: 72 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 8, color: "rgba(255,255,255,0.4)", fontFamily: "monospace", lineHeight: 1 }}>{p.label}</div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#fff", fontFamily: "monospace", lineHeight: 1.3 }}>{"prefix" in p ? p.prefix : ""}{p.value.toFixed(p.dec)}{p.unit}</div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column" as const, gap: 1, marginLeft: 6 }}>
                    <button onClick={() => p.set(Math.min(p.max, parseFloat((p.value + p.step).toFixed(p.dec))))}
                      style={{ width: 14, height: 14, background: "transparent", border: "none", color: "rgba(255,255,255,0.4)", cursor: "pointer", fontSize: 8, display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }}
                      onMouseEnter={e => (e.currentTarget.style.color = "#fff")}
                      onMouseLeave={e => (e.currentTarget.style.color = "rgba(255,255,255,0.4)")}>▲</button>
                    <button onClick={() => p.set(Math.max(p.min, parseFloat((p.value - p.step).toFixed(p.dec))))}
                      style={{ width: 14, height: 14, background: "transparent", border: "none", color: "rgba(255,255,255,0.4)", cursor: "pointer", fontSize: 8, display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }}
                      onMouseEnter={e => (e.currentTarget.style.color = "#fff")}
                      onMouseLeave={e => (e.currentTarget.style.color = "rgba(255,255,255,0.4)")}>▼</button>
                  </div>
                </div>
              ))}

              <div style={{ width: 1, height: 28, background: "#30363d" }} />
              <span style={{ ...sectionTitle, margin: 0, marginRight: 4, display: "inline" }}>POSITION</span>
              {([
                { label: "SIZE", value: simPosSize, set: setSimPosSize, min: 2, max: 30, step: 1, dec: 0, unit: "%" },
                { label: "MIN", value: simMinHold, set: setSimMinHold, min: 1, max: 21, step: 1, dec: 0, unit: "d" },
                { label: "MAX", value: simMaxHold, set: setSimMaxHold, min: 5, max: 63, step: 1, dec: 0, unit: "d" },
                { label: "COOL", value: simCooldown, set: setSimCooldown, min: 0, max: 10, step: 1, dec: 0, unit: "" },
                { label: "COST", value: simCost, set: setSimCost, min: 0, max: 50, step: 1, dec: 0, unit: "bp" },
              ] as const).map(p => (
                <div key={p.label} style={{ display: "flex", alignItems: "center", background: "#0d1117", border: "1px solid #21262d", borderRadius: 4, padding: "6px 10px", minWidth: 72 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 8, color: "rgba(255,255,255,0.4)", fontFamily: "monospace", lineHeight: 1 }}>{p.label}</div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#fff", fontFamily: "monospace", lineHeight: 1.3 }}>{p.value}{p.unit}</div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column" as const, gap: 1, marginLeft: 6 }}>
                    <button onClick={() => p.set(Math.min(p.max, p.value + p.step))}
                      style={{ width: 14, height: 14, background: "transparent", border: "none", color: "rgba(255,255,255,0.4)", cursor: "pointer", fontSize: 8, display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }}
                      onMouseEnter={e => (e.currentTarget.style.color = "#fff")}
                      onMouseLeave={e => (e.currentTarget.style.color = "rgba(255,255,255,0.4)")}>▲</button>
                    <button onClick={() => p.set(Math.max(p.min, p.value - p.step))}
                      style={{ width: 14, height: 14, background: "transparent", border: "none", color: "rgba(255,255,255,0.4)", cursor: "pointer", fontSize: 8, display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }}
                      onMouseEnter={e => (e.currentTarget.style.color = "#fff")}
                      onMouseLeave={e => (e.currentTarget.style.color = "rgba(255,255,255,0.4)")}>▼</button>
                  </div>
                </div>
              ))}
            </div>

            {/* Filter toggles */}
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
              <span style={{ fontSize: 9, fontFamily: "monospace", color: "rgba(255,255,255,0.4)", letterSpacing: "0.06em", textTransform: "uppercase" as const, marginRight: 4 }}>Filters</span>

              {/* Momentum filter */}
              <div style={{ display: "flex", gap: 2 }}>
                <span style={{ fontSize: 9, fontFamily: "monospace", color: "rgba(255,255,255,0.45)", marginRight: 3 }}>Mom</span>
                {([0, 1, 2, 3] as const).map(v => (
                  <button key={v} onClick={() => setSimMom(v)}
                    style={{ padding: "3px 7px", background: simMom === v ? "rgba(59,130,246,0.25)" : "#0d1117",
                      border: `1px solid ${simMom === v ? "#3b82f6" : "#30363d"}`,
                      color: simMom === v ? "#3b82f6" : "rgba(255,255,255,0.35)", borderRadius: 3,
                      fontSize: 9, fontWeight: 700, cursor: "pointer", fontFamily: "monospace" }}>
                    {v === 0 ? "OFF" : `${v}/3`}
                  </button>
                ))}
              </div>

              {/* Vol Gate */}
              <div style={{ display: "flex", gap: 2 }}>
                <span style={{ fontSize: 9, fontFamily: "monospace", color: "rgba(255,255,255,0.45)", marginRight: 3 }}>Vol</span>
                {(["off", "soft", "hard"] as const).map(v => (
                  <button key={v} onClick={() => setSimVolGate(v)}
                    style={{ padding: "3px 7px", background: simVolGate === v ? "rgba(59,130,246,0.25)" : "#0d1117",
                      border: `1px solid ${simVolGate === v ? "#3b82f6" : "#30363d"}`,
                      color: simVolGate === v ? "#3b82f6" : "rgba(255,255,255,0.35)", borderRadius: 3,
                      fontSize: 9, fontWeight: 700, cursor: "pointer", fontFamily: "monospace", textTransform: "uppercase" as const }}>
                    {v}
                  </button>
                ))}
              </div>

              {/* Boolean toggles */}
              {([
                { label: "SMA200", value: simSma200, set: setSimSma200 },
                { label: "SMA50", value: simSma50, set: setSimSma50 },
                { label: "SMA Exit", value: simSmaExit, set: setSimSmaExit },
                { label: "Valuation", value: simValFilter, set: setSimValFilter },
              ] as const).map(f => (
                <button key={f.label} onClick={() => f.set(!f.value)}
                  style={{ padding: "3px 8px", background: f.value ? "rgba(59,130,246,0.25)" : "#0d1117",
                    border: `1px solid ${f.value ? "#3b82f6" : "#30363d"}`,
                    color: f.value ? "#3b82f6" : "rgba(255,255,255,0.35)", borderRadius: 3,
                    fontSize: 9, fontWeight: 700, cursor: "pointer", fontFamily: "monospace" }}>
                  {f.label}: {f.value ? "ON" : "OFF"}
                </button>
              ))}

              <button onClick={() => {
                setSimEntry(SIM_DEFAULTS.entryThreshold); setSimExit(SIM_DEFAULTS.exitThreshold);
                setSimStop(SIM_DEFAULTS.stopLossPct); setSimTP(SIM_DEFAULTS.takeProfitPct);
                setSimPosSize(SIM_DEFAULTS.positionSizePct); setSimMinHold(SIM_DEFAULTS.minHoldDays);
                setSimMaxHold(SIM_DEFAULTS.maxHoldDays); setSimCooldown(SIM_DEFAULTS.cooldownBars);
                setSimCost(SIM_DEFAULTS.costBps); setSimMom(SIM_DEFAULTS.momentumFilter);
                setSimVolGate(SIM_DEFAULTS.volGate); setSimSma200(SIM_DEFAULTS.sma200Require);
                setSimSma50(SIM_DEFAULTS.sma50Require); setSimSmaExit(SIM_DEFAULTS.smaExitOnCross);
                setSimValFilter(SIM_DEFAULTS.valuationFilter);
              }}
                style={{ marginLeft: "auto", fontSize: 9, fontFamily: "monospace", color: "rgba(255,255,255,0.35)", background: "none", border: "1px solid #30363d", borderRadius: 3, padding: "3px 10px", cursor: "pointer" }}>RESET</button>

              <div style={{ width: 1, height: 18, background: "#30363d" }} />
              <button onClick={() => setSimShowFilterHelp(v => !v)} style={guideButtonStyle(simShowFilterHelp)}>
                <span style={{ fontSize: 11 }}>⚙</span> {simShowFilterHelp ? "HIDE PARAMETER GUIDE" : "PARAMETER GUIDE"}
              </button>
              <button onClick={() => setSimShowMLGuide(v => !v)} style={guideButtonStyle(simShowMLGuide)}>
                <span style={{ fontSize: 11 }}>◈</span> {simShowMLGuide ? "HIDE ML GUIDE" : "HOW ML SIGNALS WORK"}
              </button>
            </div>

            {/* Filter & Parameter Explanation Panel */}
            {simShowFilterHelp && (
              <div style={{ marginTop: 8, padding: 14, background: "#0d1117", border: "1px solid #30363d", borderRadius: 6, fontSize: 10, fontFamily: "monospace", color: "rgba(255,255,255,0.6)", lineHeight: 1.7 }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
                  <div>
                    <div style={{ fontSize: 9, fontWeight: 700, color: "#3b82f6", letterSpacing: "0.06em", marginBottom: 6 }}>STRATEGY PARAMETERS</div>
                    <div><span style={{ color: "#fff" }}>Entry &gt;</span> — ML predicted return must cross above this threshold to open a LONG position. Higher = fewer but higher-conviction trades.</div>
                    <div style={{ marginTop: 4 }}><span style={{ color: "#fff" }}>Exit &lt;</span> — When ML prediction drops below this level, the position is closed (signal flip exit). Lower = hold longer through dips.</div>
                    <div style={{ marginTop: 4 }}><span style={{ color: "#fff" }}>Stop</span> — Maximum allowed loss from entry price. Triggers immediate exit regardless of min hold days.</div>
                    <div style={{ marginTop: 4 }}><span style={{ color: "#fff" }}>TP</span> — Take profit target. Position closed when unrealized gain hits this level (after min hold). Set to 100% to effectively disable.</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 9, fontWeight: 700, color: "#3b82f6", letterSpacing: "0.06em", marginBottom: 6 }}>POSITION PARAMETERS</div>
                    <div><span style={{ color: "#fff" }}>Size</span> — Percentage of NAV allocated per trade. Affects P&L scaling but not entry/exit logic.</div>
                    <div style={{ marginTop: 4 }}><span style={{ color: "#fff" }}>Min Hold</span> — Minimum days before a signal-flip or take-profit exit is allowed. Stop loss always overrides. Prevents whipsaw.</div>
                    <div style={{ marginTop: 4 }}><span style={{ color: "#fff" }}>Max Hold</span> — Time stop. Position auto-closed after this many days regardless of signal. Forces capital rotation.</div>
                    <div style={{ marginTop: 4 }}><span style={{ color: "#fff" }}>Cooldown</span> — Bars to wait after closing before the next entry. Prevents re-entering immediately on volatile signals.</div>
                    <div style={{ marginTop: 4 }}><span style={{ color: "#fff" }}>Cost</span> — Round-trip transaction cost in basis points (1bp = 0.01%). Deducted from each trade P&L.</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 9, fontWeight: 700, color: "#3b82f6", letterSpacing: "0.06em", marginBottom: 6 }}>SIGNAL FILTERS</div>
                    <div><span style={{ color: "#fff" }}>Momentum</span> — Requires N of 3 momentum factors (1m, 6m, 11m) to be positive before entry. 0=off, 3/3=all must be bullish.</div>
                    <div style={{ marginTop: 4 }}><span style={{ color: "#fff" }}>Vol Gate</span> — Volatility regime filter. SOFT: halves position size in high-vol. HARD: blocks entry entirely in high-vol regimes.</div>
                    <div style={{ marginTop: 4 }}><span style={{ color: "#fff" }}>SMA200</span> — Only enter when price is above the 200-day moving average (long-term uptrend confirmation).</div>
                    <div style={{ marginTop: 4 }}><span style={{ color: "#fff" }}>SMA50</span> — Only enter when price is above the 50-day moving average (medium-term trend filter).</div>
                    <div style={{ marginTop: 4 }}><span style={{ color: "#fff" }}>SMA Exit</span> — Auto-exit if price crosses below SMA200 during a trade (trend breakdown protection).</div>
                    <div style={{ marginTop: 4 }}><span style={{ color: "#fff" }}>Valuation</span> — Only enter when stock is cheap vs sector peers (E/P z-score &gt; 0). Avoids chasing expensive momentum names.</div>
                  </div>
                </div>
                <div style={{ marginTop: 12, padding: "8px 0", borderTop: "1px solid #21262d", color: "rgba(255,255,255,0.4)", fontSize: 9 }}>
                  <span style={{ color: "#fff", fontWeight: 700 }}>How it works:</span> The simulator replays historical ML predictions as daily trading signals. Entry at next-day OPEN after signal crosses threshold. Exits follow priority: stop loss (ignores min hold) → take profit → signal flip → time stop → SMA cross → regime exit. Equity curve compounds closed-trade P&L indexed to 100. OBX benchmark indexed to same start date.
                </div>
              </div>
            )}

            {renderMLGuidePanel(simShowMLGuide)}
          </div>

          {/* Loading / No Data States */}
          {simLoading && (
            <div style={{ ...cardStyle, textAlign: "center", padding: 60, color: "rgba(255,255,255,0.3)", fontSize: 12, fontFamily: "monospace" }}>
              Loading simulation data for {simTicker}...
            </div>
          )}

          {!simTicker && !simLoading && (
            <div style={{ ...cardStyle, textAlign: "center", padding: 60, color: "rgba(255,255,255,0.25)", fontSize: 12, fontFamily: "monospace" }}>
              Search for a ticker above to start the ML Trading Simulator
            </div>
          )}

          {simTicker && !simLoading && simResult && (
            <>
              {/* ── Row 1: Price Chart + Signal State Panel ── */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 280px", gap: 12, marginBottom: 12, alignItems: "stretch" }}>
                {/* Price & SMA Chart */}
                <div style={{ ...cardStyle, display: "flex", flexDirection: "column" as const }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <div style={sectionTitle}>{simTicker} — Price & Moving Averages</div>
                    <div style={{ fontSize: 9, fontFamily: "monospace", color: "rgba(255,255,255,0.3)" }}>
                      <span style={{ color: "#f59e0b" }}>— 200MA</span>
                      &nbsp;&nbsp;<span style={{ color: "rgba(139,157,195,0.6)" }}>— 50MA</span>
                      &nbsp;&nbsp;<span style={{ color: "#10b981" }}>▲ entry</span>
                      &nbsp;&nbsp;<span style={{ color: "#ef4444" }}>▼ exit</span>
                    </div>
                  </div>
                  {simLive.length > 1 ? (
                    <div style={{ flex: 1, minHeight: 300 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={simLive} margin={{ top: 5, right: 10, left: 10, bottom: 0 }}>
                        <defs>
                          <linearGradient id="simPriceGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.2} />
                            <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.02} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                        <XAxis dataKey="date" tick={{ fontSize: 9, fill: "rgba(255,255,255,0.4)", fontFamily: "monospace" }} tickFormatter={d => d.slice(5)} interval="preserveStartEnd" />
                        <YAxis tick={{ fontSize: 9, fill: "rgba(255,255,255,0.4)", fontFamily: "monospace" }} domain={["auto", "auto"]} />
                        <Tooltip contentStyle={{ background: "#0d1117", border: "1px solid #30363d", borderRadius: 6, fontFamily: "monospace", fontSize: 11, color: "#fff" }}
                          labelStyle={{ color: "rgba(255,255,255,0.6)", marginBottom: 4 }}
                          formatter={(v: number | undefined, name: string | undefined) => {
                            if (v == null) return [null, ""];
                            if (name === "price") return [`NOK ${fmtPrice(v)}`, "Price"];
                            if (name === "sma200") return [fmtPrice(v), "200MA"];
                            if (name === "sma50") return [fmtPrice(v), "50MA"];
                            return [null, ""];
                          }} />
                        <Area type="monotone" dataKey="price" stroke="#3b82f6" fill="url(#simPriceGrad)" strokeWidth={1.5} dot={false} isAnimationActive={false} name="price" />
                        <Line type="monotone" dataKey="sma200" stroke="#f59e0b" strokeWidth={1.5} dot={false} strokeDasharray="6 3" connectNulls isAnimationActive={false} name="sma200" />
                        <Line type="monotone" dataKey="sma50" stroke="rgba(139,157,195,0.5)" strokeWidth={1} dot={false} strokeDasharray="3 3" connectNulls isAnimationActive={false} name="sma50" />
                        {/* Entry markers (green ▲) */}
                        <Line type="monotone" dataKey="price" stroke="none" legendType="none" isAnimationActive={false} connectNulls={false} name="priceEntry" tooltipType="none"
                          dot={(props: { cx?: number; cy?: number; payload?: any; index?: number }) => {
                            const { cx, cy, payload } = props;
                            if (!payload?.entryMarker || cx == null || cy == null) return <g key={`se-${cx}-${cy}`} />;
                            const pts = `${cx},${cy - 10} ${cx - 6},${cy + 3} ${cx + 6},${cy + 3}`;
                            return <polygon key={`se-${cx}`} points={pts} fill="#10b981" stroke="#0a0a0a" strokeWidth={1.5} />;
                          }} />
                        {/* Exit markers (red ▼) */}
                        <Line type="monotone" dataKey="price" stroke="none" legendType="none" isAnimationActive={false} connectNulls={false} name="priceExit" tooltipType="none"
                          dot={(props: { cx?: number; cy?: number; payload?: any }) => {
                            const { cx, cy, payload } = props;
                            if (!payload?.exitMarker || cx == null || cy == null) return <g key={`sx-${cx}-${cy}`} />;
                            const pts = `${cx},${cy + 10} ${cx - 6},${cy - 3} ${cx + 6},${cy - 3}`;
                            return <polygon key={`sx-${cx}`} points={pts} fill="#ef4444" stroke="#0a0a0a" strokeWidth={1.5} />;
                          }} />
                      </ComposedChart>
                    </ResponsiveContainer>
                    </div>
                  ) : (
                    <div style={{ flex: 1, minHeight: 300, display: "flex", alignItems: "center", justifyContent: "center", color: "rgba(255,255,255,0.15)", fontSize: 12, fontFamily: "monospace" }}>
                      Press ▶ PLAY to begin the simulation
                    </div>
                  )}
                </div>

                {/* Signal State Panel (merged Position Monitor + Factor Dashboard) */}
                <div style={{ ...cardStyle, padding: "14px 16px", display: "flex", flexDirection: "column" as const }}>
                  {(() => {
                    const inPos = simCurrent?.inPosition;
                    const posColor = inPos ? "#10b981" : "rgba(255,255,255,0.25)";
                    return (
                      <>
                        <div style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", letterSpacing: "0.1em", marginBottom: 8, fontFamily: "monospace", textTransform: "uppercase" as const }}>Signal State</div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                          <div style={{ width: 9, height: 9, borderRadius: "50%", background: posColor, animation: inPos ? "pBlink 1.2s ease-in-out infinite" : "none" }} />
                          <div style={{ fontSize: 16, fontWeight: 800, color: posColor, letterSpacing: 2, fontFamily: "monospace" }}>
                            {inPos ? "▲  LONG" : "◌  FLAT"}
                          </div>
                        </div>

                        {/* All 7 metric boxes — always visible to prevent layout jumps */}
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 10 }}>
                          {/* ML Prediction — spans full width */}
                          <div style={{ ...metricCard, gridColumn: "1 / -1" }}>
                            <div style={{ fontSize: 8, color: "rgba(255,255,255,0.4)", marginBottom: 4, fontFamily: "monospace" }}>ML PREDICTION</div>
                            <div style={{ fontSize: 18, fontWeight: 800, color: simCurrent?.mlPrediction != null ? (simCurrent.mlPrediction > simEntry ? "#10b981" : simCurrent.mlPrediction < 0 ? "#ef4444" : "#fff") : "rgba(255,255,255,0.2)", fontFamily: "monospace" }}>
                              {simCurrent?.mlPrediction != null ? `${simCurrent.mlPrediction >= 0 ? "+" : ""}${simCurrent.mlPrediction.toFixed(2)}%` : "—"}
                            </div>
                            <div style={{ fontSize: 8, color: "rgba(255,255,255,0.3)", marginTop: 2, fontFamily: "monospace" }}>
                              entry &gt; {simEntry}% · exit &lt; {simExit}%
                            </div>
                          </div>
                          {/* Unrealized P&L — always shown */}
                          <div style={metricCard}>
                            <div style={{ fontSize: 8, color: "rgba(255,255,255,0.4)", fontFamily: "monospace" }}>UNREALZD</div>
                            <div style={{ fontSize: 14, fontWeight: 800, color: inPos && simCurrent?.unrealizedPnl != null ? ((simCurrent.unrealizedPnl ?? 0) >= 0 ? "#10b981" : "#ef4444") : "rgba(255,255,255,0.2)", fontFamily: "monospace" }}>
                              {inPos && simCurrent?.unrealizedPnl != null ? `${simCurrent.unrealizedPnl >= 0 ? "+" : ""}${(simCurrent.unrealizedPnl * 100).toFixed(2)}%` : "—"}
                            </div>
                          </div>
                          {/* Days held — always shown */}
                          <div style={metricCard}>
                            <div style={{ fontSize: 8, color: "rgba(255,255,255,0.4)", fontFamily: "monospace" }}>DAYS</div>
                            <div style={{ fontSize: 14, fontWeight: 800, color: inPos ? "#fff" : "rgba(255,255,255,0.2)", fontFamily: "monospace" }}>
                              {inPos && simCurrent ? `${simCurrent.positionDaysHeld ?? 0} / ${simMaxHold}` : "—"}
                            </div>
                          </div>
                          {/* Momentum */}
                          <div style={metricCard}>
                            <div style={{ fontSize: 8, color: "rgba(255,255,255,0.4)", fontFamily: "monospace" }}>MOMENTUM</div>
                            <div style={{ fontSize: 12, fontWeight: 700, fontFamily: "monospace" }}>
                              {simCurrent ? (() => {
                                const moms = [simData?.input[simPlayIdx]?.mom1m, simData?.input[simPlayIdx]?.mom6m, simData?.input[simPlayIdx]?.mom11m];
                                return <span>{moms.map((m, j) => <span key={j} style={{ color: m != null && m > 0 ? "#10b981" : m != null ? "#ef4444" : "rgba(255,255,255,0.15)", marginRight: 3 }}>{m != null && m > 0 ? "▲" : "▼"}</span>)}</span>;
                              })() : "—"}
                            </div>
                            <div style={{ fontSize: 8, color: "rgba(255,255,255,0.3)", fontFamily: "monospace" }}>{simCurrent?.momScore ?? 0}/3</div>
                          </div>
                          {/* Vol */}
                          <div style={metricCard}>
                            <div style={{ fontSize: 8, color: "rgba(255,255,255,0.4)", fontFamily: "monospace" }}>VOL</div>
                            <div style={{ fontSize: 12, fontWeight: 700, color: simCurrent?.volRegime === "high" ? "#ef4444" : simCurrent?.volRegime === "low" ? "#10b981" : "rgba(255,255,255,0.3)", fontFamily: "monospace" }}>
                              {simCurrent?.volRegime?.toUpperCase() ?? "N/A"}
                            </div>
                          </div>
                          {/* Valuation */}
                          <div style={metricCard}>
                            <div style={{ fontSize: 8, color: "rgba(255,255,255,0.4)", fontFamily: "monospace" }}>VALUATN</div>
                            <div style={{ fontSize: 11, fontWeight: 700, color: "#fff", fontFamily: "monospace" }}>
                              {simCurrent?.epSectorZ != null ? (simCurrent.epSectorZ > 1 ? "CHEAP" : simCurrent.epSectorZ < -1 ? "EXPENSIVE" : "FAIR") : "—"}
                            </div>
                            <div style={{ fontSize: 7, color: "rgba(255,255,255,0.3)", fontFamily: "monospace" }}>
                              z={simCurrent?.epSectorZ?.toFixed(1) ?? "—"}
                            </div>
                          </div>
                          {/* Cooldown */}
                          <div style={metricCard}>
                            <div style={{ fontSize: 8, color: "rgba(255,255,255,0.4)", fontFamily: "monospace" }}>COOLDOWN</div>
                            <div style={{ fontSize: 11, fontWeight: 700, color: simCurrent?.blockReason === "cooldown" ? "#f59e0b" : "rgba(255,255,255,0.3)", fontFamily: "monospace" }}>
                              {simCurrent?.blockReason === "cooldown" ? "ACTIVE" : "CLEAR"}
                            </div>
                          </div>
                        </div>

                        {/* Recent Trades */}
                        {simDoneTrades.length > 0 && (
                          <div style={{ borderTop: "1px solid #21262d", paddingTop: 8, marginTop: "auto" }}>
                            <div style={{ fontSize: 8, color: "rgba(255,255,255,0.3)", letterSpacing: "0.06em", textTransform: "uppercase" as const, marginBottom: 4, fontFamily: "monospace" }}>Recent Trades</div>
                            {[...simDoneTrades].reverse().slice(0, 4).map((t, i) => (
                              <div key={i} style={{ fontSize: 9, fontFamily: "monospace", color: "rgba(255,255,255,0.5)", padding: "2px 0", display: "flex", gap: 8 }}>
                                <span style={{ color: "rgba(255,255,255,0.3)" }}>{t.exitDate}</span>
                                <span style={{ color: t.actualReturn >= 0 ? "#10b981" : "#ef4444", fontWeight: 700 }}>{t.actualReturn >= 0 ? "+" : ""}{(t.actualReturn * 100).toFixed(1)}%</span>
                                <span style={{ color: "rgba(255,255,255,0.25)" }}>{t.exitReason.replace("_", " ")}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>
              </div>

              {/* ── Row 2: ML Signal Chart (full width, compact) ── */}
              <div style={{ ...cardStyle, marginBottom: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <div style={sectionTitle}>ML Predicted Return — Trade Signal</div>
                  <div style={{ display: "flex", gap: 16, fontSize: 9, fontFamily: "monospace" }}>
                    <span style={{ color: "#10b981" }}>▲ ENTER (&gt;{simEntry}%)</span>
                    <span style={{ color: "#ef4444" }}>▼ EXIT (&lt;{simExit}%)</span>
                    <span style={{ color: "rgba(255,255,255,0.4)" }}>{simDoneTrades.length} trades completed</span>
                  </div>
                </div>
                {simLive.length > 1 ? (
                  <ResponsiveContainer width="100%" height={120}>
                    <ComposedChart data={simLive} margin={{ top: 5, right: 10, left: 10, bottom: 0 }}>
                      <defs>
                        <linearGradient id="simPredGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.2} />
                          <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                      <XAxis dataKey="date" tick={{ fontSize: 9, fill: "rgba(255,255,255,0.4)", fontFamily: "monospace" }} tickFormatter={d => d.slice(5)} interval="preserveStartEnd" />
                      <YAxis tick={{ fontSize: 9, fill: "rgba(255,255,255,0.4)", fontFamily: "monospace" }} />
                      <Tooltip contentStyle={{ background: "#0d1117", border: "1px solid #30363d", borderRadius: 6, fontFamily: "monospace", fontSize: 11, color: "#fff" }}
                        formatter={(v: number | undefined, name: string | undefined, _props: unknown, idx: number | undefined) => {
                          if (idx !== 0) return [null, ""];
                          return [`${v?.toFixed(2) ?? "—"}%`, "ML Prediction"];
                        }} />
                      <ReferenceLine y={simEntry} stroke="#10b981" strokeDasharray="5 3" strokeWidth={1} />
                      <ReferenceLine y={simExit} stroke="#ef4444" strokeDasharray="5 3" strokeWidth={1} />
                      <ReferenceLine y={0} stroke="rgba(255,255,255,0.15)" strokeWidth={1} />
                      <Area type="stepAfter" dataKey="mlPrediction" stroke="#3b82f6" fill="url(#simPredGrad)" strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls name="mlPred" />
                      {/* Entry dots */}
                      <Line type="stepAfter" dataKey="mlPrediction" stroke="none" legendType="none" isAnimationActive={false} connectNulls={false} name="mlPredEntry" tooltipType="none"
                        dot={(props: { cx?: number; cy?: number; payload?: any }) => {
                          const { cx, cy, payload } = props;
                          if (!payload?.entryMarker || cx == null || cy == null) return <g key={`spe-${cx}-${cy}`} />;
                          const pts = `${cx},${cy - 8} ${cx - 5},${cy + 2} ${cx + 5},${cy + 2}`;
                          return <polygon key={`spe-${cx}`} points={pts} fill="#10b981" stroke="#0a0a0a" strokeWidth={1} />;
                        }} />
                      {/* Exit markers (red ▼) */}
                      <Line type="stepAfter" dataKey="mlPrediction" stroke="none" legendType="none" isAnimationActive={false} connectNulls={false} name="mlPredExit" tooltipType="none"
                        dot={(props: { cx?: number; cy?: number; payload?: any }) => {
                          const { cx, cy, payload } = props;
                          if (!payload?.exitMarker || cx == null || cy == null) return <g key={`spx-${cx}-${cy}`} />;
                          const pts = `${cx},${cy + 8} ${cx - 5},${cy - 2} ${cx + 5},${cy - 2}`;
                          return <polygon key={`spx-${cx}`} points={pts} fill="#ef4444" stroke="#0a0a0a" strokeWidth={1} />;
                        }} />
                    </ComposedChart>
                  </ResponsiveContainer>
                ) : (
                  <div style={{ height: 120, display: "flex", alignItems: "center", justifyContent: "center", color: "rgba(255,255,255,0.15)", fontSize: 12, fontFamily: "monospace" }}>
                    Press ▶ PLAY to see ML prediction signal
                  </div>
                )}
              </div>

              {/* ── Row 3: Stats Strip (full width) ── */}
              <div style={{ ...cardStyle, marginBottom: 12 }}>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(100px, 1fr))", gap: 8 }}>
                  {[
                    { label: "Trades", value: String(simLiveStats.trades), color: "#fff" },
                    { label: "Win Rate", value: `${Math.round(simLiveStats.winRate * 100)}%`, color: simLiveStats.winRate >= 0.5 ? "#10b981" : "#ef4444" },
                    { label: "Total Return", value: `${simLiveStats.totalReturn >= 0 ? "+" : ""}${(simLiveStats.totalReturn * 100).toFixed(1)}%`, color: simLiveStats.totalReturn >= 0 ? "#10b981" : "#ef4444" },
                    { label: "Ann. Return", value: `${simLiveStats.annualizedReturn >= 0 ? "+" : ""}${(simLiveStats.annualizedReturn * 100).toFixed(1)}%`, color: simLiveStats.annualizedReturn >= 0 ? "#10b981" : "#ef4444" },
                    { label: "Sharpe", value: simLiveStats.sharpe.toFixed(2), color: simLiveStats.sharpe >= 1 ? "#10b981" : simLiveStats.sharpe >= 0.5 ? "#f59e0b" : "#ef4444" },
                    { label: "Max DD", value: `${(simLiveStats.maxDrawdown * 100).toFixed(1)}%`, color: "#ef4444" },
                    { label: "Avg Hold", value: `${Math.round(simLiveStats.avgHoldDays)}d`, color: "#fff" },
                    { label: "vs OBX", value: `${simLiveStats.excessReturn >= 0 ? "+" : ""}${(simLiveStats.excessReturn * 100).toFixed(1)}%`, color: simLiveStats.excessReturn >= 0 ? "#10b981" : "#ef4444" },
                  ].map(m => (
                    <div key={m.label} style={metricCard}>
                      <div style={{ fontSize: 8, color: "rgba(255,255,255,0.4)", fontFamily: "monospace" }}>{m.label}</div>
                      <div style={{ fontSize: 14, fontWeight: 800, color: m.color, fontFamily: "monospace" }}>{m.value}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* ── Row 4: Trade Log (full width) ── */}
              <div style={{ ...cardStyle, marginBottom: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, flexWrap: "wrap", gap: 8 }}>
                  <div style={sectionTitle}>Simulated Trade Log — Entry &gt;{simEntry}% · Stop -{simStop}% · Min {simMinHold}d · Max {simMaxHold}d</div>
                  {simDoneTrades.length > 0 && (() => {
                    const closed = simDoneTrades.filter(t => t.exitReason !== 'time_stop' || true);
                    const wins = closed.filter(t => t.actualReturn > 0).length;
                    const avgPnl = closed.reduce((s, t) => s + t.actualReturn, 0) / closed.length;
                    const avgDD = closed.reduce((s, t) => s + t.maxDrawdown, 0) / closed.length;
                    const totalPnl = closed.reduce((s, t) => s + t.actualReturn, 0);
                    return (
                      <div style={{ display: "flex", gap: 16, fontSize: 10, fontFamily: "monospace" }}>
                        <span style={{ color: "rgba(255,255,255,0.4)" }}>Trades: <span style={{ color: "#fff", fontWeight: 700 }}>{closed.length}</span></span>
                        <span style={{ color: "rgba(255,255,255,0.4)" }}>Win Rate: <span style={{ color: closed.length > 0 && wins / closed.length >= 0.5 ? "#10b981" : "#ef4444", fontWeight: 700 }}>{closed.length > 0 ? Math.round(wins / closed.length * 100) : 0}%</span></span>
                        <span style={{ color: "rgba(255,255,255,0.4)" }}>Avg P&L: <span style={{ color: avgPnl >= 0 ? "#10b981" : "#ef4444", fontWeight: 700 }}>{avgPnl >= 0 ? "+" : ""}{(avgPnl * 100).toFixed(1)}%</span></span>
                        <span style={{ color: "rgba(255,255,255,0.4)" }}>Avg DD: <span style={{ color: "#ef4444", fontWeight: 700 }}>{(Math.min(avgDD, 0) * 100).toFixed(1)}%</span></span>
                        <span style={{ color: "rgba(255,255,255,0.4)" }}>Total: <span style={{ color: totalPnl >= 0 ? "#10b981" : "#ef4444", fontWeight: 700 }}>{totalPnl >= 0 ? "+" : ""}{(totalPnl * 100).toFixed(1)}%</span></span>
                      </div>
                    );
                  })()}
                </div>
                {simDoneTrades.length === 0 ? (
                  <div style={{ textAlign: "center", padding: 24, color: "rgba(255,255,255,0.3)", fontFamily: "monospace", fontSize: 11 }}>
                    {simPlayIdx < 0 ? "Press ▶ PLAY to start simulation" : "No trades completed yet — waiting for entry signal..."}
                  </div>
                ) : (
                  <div style={{ maxHeight: 300, overflowY: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "monospace" }}>
                      <thead>
                        <tr style={{ borderBottom: "1px solid #30363d", position: "sticky" as const, top: 0, background: "#161b22" }}>
                          {["Entry Date", "Exit Date", "Entry Price", "Exit Price", "ML Pred", "Days", "Max DD", "P&L", "Exit Reason"].map(h => (
                            <th key={h} style={{ fontSize: 9, fontWeight: 600, color: "rgba(255,255,255,0.5)", padding: "5px 6px", textAlign: h === "Entry Date" ? "left" as const : "right" as const }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {[...simDoneTrades].reverse().map((t, i) => (
                          <tr key={i} style={{ borderBottom: "1px solid rgba(48,54,61,0.3)" }}
                            onMouseEnter={e => e.currentTarget.style.background = "rgba(59,130,246,0.07)"}
                            onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                            <td style={{ padding: "4px 6px", fontSize: 10, color: "rgba(255,255,255,0.7)" }}>{t.entryDate}</td>
                            <td style={{ padding: "4px 6px", fontSize: 10, textAlign: "right", color: "rgba(255,255,255,0.7)" }}>{t.exitDate}</td>
                            <td style={{ padding: "4px 6px", fontSize: 10, textAlign: "right", color: "rgba(255,255,255,0.5)" }}>NOK {fmtPrice(t.entryPrice)}</td>
                            <td style={{ padding: "4px 6px", fontSize: 10, textAlign: "right", color: "rgba(255,255,255,0.5)" }}>NOK {fmtPrice(t.exitPrice)}</td>
                            <td style={{ padding: "4px 6px", fontSize: 10, textAlign: "right", color: "#3b82f6" }}>{(t.predAtEntry).toFixed(1)}%</td>
                            <td style={{ padding: "4px 6px", fontSize: 10, textAlign: "right", color: "rgba(255,255,255,0.5)" }}>{t.daysHeld}d</td>
                            <td style={{ padding: "4px 6px", fontSize: 10, fontWeight: 600, textAlign: "right", color: t.maxDrawdown < 0 ? "#ef4444" : "rgba(255,255,255,0.3)" }}>
                              {t.maxDrawdown < 0 ? (t.maxDrawdown * 100).toFixed(1) + "%" : "0%"}
                            </td>
                            <td style={{ padding: "4px 6px", fontSize: 11, fontWeight: 700, textAlign: "right", color: t.actualReturn >= 0 ? "#10b981" : "#ef4444" }}>
                              {t.actualReturn >= 0 ? "+" : ""}{(t.actualReturn * 100).toFixed(1)}%
                            </td>
                            <td style={{ padding: "4px 6px", fontSize: 9, textAlign: "right", color: "rgba(255,255,255,0.4)", textTransform: "uppercase" as const }}>
                              {t.exitReason.replace("_", " ")}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* ── Parameter Sweep ── */}
              {(() => {
                const SWEEP_COLS: { key: string; label: string; fmt: (r: { params: SimParams; stats: SimStats }) => string; num?: boolean }[] = [
                  { key: "entry",       label: "Entry",     fmt: r => `${r.params.entryThreshold}%`,  num: true },
                  { key: "stop",        label: "Stop",      fmt: r => `-${r.params.stopLossPct}%`,     num: true },
                  { key: "maxHold",     label: "MaxHold",   fmt: r => `${r.params.maxHoldDays}d`,      num: true },
                  { key: "vol",         label: "Vol",       fmt: r => r.params.volGate.toUpperCase() },
                  { key: "sma200",      label: "SMA200",    fmt: r => r.params.sma200Require ? "ON" : "—" },
                  { key: "mom",         label: "Mom",       fmt: r => r.params.momentumFilter > 0 ? `${r.params.momentumFilter}/3` : "—" },
                  { key: "trades",      label: "Trades",    fmt: r => `${r.stats.trades}`,             num: true },
                  { key: "winRate",     label: "Win%",      fmt: r => `${(r.stats.winRate * 100).toFixed(0)}%`, num: true },
                  { key: "totalReturn", label: "Total Ret", fmt: r => `${r.stats.totalReturn >= 0 ? "+" : ""}${(r.stats.totalReturn * 100).toFixed(0)}%`, num: true },
                  { key: "annReturn",   label: "Ann Ret",   fmt: r => `${r.stats.annualizedReturn >= 0 ? "+" : ""}${(r.stats.annualizedReturn * 100).toFixed(1)}%`, num: true },
                  { key: "sharpe",      label: "Sharpe",    fmt: r => r.stats.sharpe.toFixed(2),       num: true },
                  { key: "maxDD",       label: "MaxDD",     fmt: r => `${(r.stats.maxDrawdown * 100).toFixed(1)}%`, num: true },
                  { key: "vsObx",       label: "vs OBX",   fmt: r => `${r.stats.excessReturn >= 0 ? "+" : ""}${(r.stats.excessReturn * 100).toFixed(1)}%`, num: true },
                ];

                const sortedSweep = [...simSweepResults].sort((a, b) => {
                  const getVal = (r: { params: SimParams; stats: SimStats }) => {
                    if (simSweepSortKey === "entry")       return r.params.entryThreshold;
                    if (simSweepSortKey === "stop")        return r.params.stopLossPct;
                    if (simSweepSortKey === "maxHold")     return r.params.maxHoldDays;
                    if (simSweepSortKey === "vol")         return r.params.volGate === 'hard' ? 1 : 0;
                    if (simSweepSortKey === "sma200")      return r.params.sma200Require ? 1 : 0;
                    if (simSweepSortKey === "mom")         return r.params.momentumFilter;
                    if (simSweepSortKey === "trades")      return r.stats.trades;
                    if (simSweepSortKey === "winRate")     return r.stats.winRate;
                    if (simSweepSortKey === "totalReturn") return r.stats.totalReturn;
                    if (simSweepSortKey === "annReturn")   return r.stats.annualizedReturn;
                    if (simSweepSortKey === "sharpe")      return r.stats.sharpe;
                    if (simSweepSortKey === "maxDD")       return r.stats.maxDrawdown; // lower is better but sort as number
                    if (simSweepSortKey === "vsObx")       return r.stats.excessReturn;
                    return 0;
                  };
                  return (getVal(a) - getVal(b)) * simSweepSortDir;
                });

                const thStyle = (key: string): React.CSSProperties => ({
                  padding: "5px 8px", fontSize: 9, fontFamily: "monospace", fontWeight: 700,
                  color: simSweepSortKey === key ? "#3b82f6" : "rgba(255,255,255,0.4)",
                  textAlign: "right" as const, textTransform: "uppercase" as const, letterSpacing: "0.05em",
                  cursor: "pointer", whiteSpace: "nowrap" as const, borderBottom: "1px solid #30363d",
                  background: simSweepSortKey === key ? "rgba(59,130,246,0.06)" : "transparent",
                  userSelect: "none" as const,
                });

                return (
                  <div style={{ ...cardStyle, marginBottom: 12 }}>
                    {/* Header / toggle */}
                    <div onClick={() => setSimSweepOpen(v => !v)}
                      style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
                      <div style={{ ...sectionTitle, marginBottom: 0 }}>PARAMETER SWEEP</div>
                      <span style={{ fontSize: 9, fontFamily: "monospace", color: "rgba(255,255,255,0.3)" }}>
                        {simSweepResults.length > 0
                          ? `${simSweepResults.length} combos · sorted by ${simSweepSortKey}`
                          : "288 strategy combos — entry × stop × hold × vol × sma × mom"}
                      </span>
                      <span style={{ marginLeft: "auto", fontSize: 10, color: "rgba(255,255,255,0.3)" }}>
                        {simSweepOpen ? "▲" : "▼"}
                      </span>
                    </div>

                    {simSweepOpen && (
                      <div style={{ marginTop: 12 }}>
                        {/* Run controls */}
                        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                          <button onClick={runSweep} disabled={simSweepRunning || !simData}
                            style={{ padding: "6px 16px", fontSize: 10, fontWeight: 700, fontFamily: "monospace",
                              background: simSweepRunning ? "#21262d" : "linear-gradient(135deg,#3b82f6,#2563eb)",
                              color: simSweepRunning ? "rgba(255,255,255,0.4)" : "#fff",
                              border: "none", borderRadius: 5, cursor: simSweepRunning ? "default" : "pointer" }}>
                            {simSweepRunning ? `Running… ${simSweepProgress}%` : "▶ RUN SWEEP"}
                          </button>
                          {simSweepRunning && (
                            <div style={{ flex: 1, height: 4, background: "#21262d", borderRadius: 2, overflow: "hidden" }}>
                              <div style={{ width: `${simSweepProgress}%`, height: "100%", background: "#3b82f6", borderRadius: 2, transition: "width 0.2s" }} />
                            </div>
                          )}
                          {simSweepResults.length > 0 && !simSweepRunning && (
                            <span style={{ fontSize: 9, fontFamily: "monospace", color: "rgba(255,255,255,0.35)" }}>
                              Top 50 · click row to apply params · click column header to sort
                            </span>
                          )}
                        </div>

                        {/* Results table */}
                        {sortedSweep.length > 0 && (
                          <div style={{ overflowX: "auto", maxHeight: 420, overflowY: "auto", border: "1px solid #21262d", borderRadius: 6 }}>
                            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10, fontFamily: "monospace" }}>
                              <thead style={{ position: "sticky", top: 0, background: "#0d1117", zIndex: 1 }}>
                                <tr>
                                  <th style={{ ...thStyle("rank"), textAlign: "center" as const }}>#</th>
                                  {SWEEP_COLS.map(c => (
                                    <th key={c.key} style={thStyle(c.key)}
                                      onClick={e => { e.stopPropagation(); setSimSweepSortKey(c.key); setSimSweepSortDir(d => simSweepSortKey === c.key ? (d === -1 ? 1 : -1) : -1); }}>
                                      {c.label} {simSweepSortKey === c.key ? (simSweepSortDir === -1 ? "↓" : "↑") : ""}
                                    </th>
                                  ))}
                                  <th style={{ ...thStyle("apply"), textAlign: "center" as const }}></th>
                                </tr>
                              </thead>
                              <tbody>
                                {sortedSweep.map((r, i) => {
                                  const isTop = i < 5;
                                  const sharpeColor = r.stats.sharpe >= 2 ? "#10b981" : r.stats.sharpe >= 1 ? "#3b82f6" : r.stats.sharpe >= 0 ? "rgba(255,255,255,0.6)" : "#ef4444";
                                  const retColor = r.stats.totalReturn >= 0.5 ? "#10b981" : r.stats.totalReturn >= 0 ? "rgba(255,255,255,0.6)" : "#ef4444";
                                  const ddColor = Math.abs(r.stats.maxDrawdown) < 0.1 ? "#10b981" : Math.abs(r.stats.maxDrawdown) < 0.2 ? "#f59e0b" : "#ef4444";
                                  return (
                                    <tr key={i}
                                      onMouseEnter={e => e.currentTarget.style.background = "rgba(59,130,246,0.07)"}
                                      onMouseLeave={e => e.currentTarget.style.background = isTop ? "rgba(16,185,129,0.04)" : "transparent"}
                                      style={{ background: isTop ? "rgba(16,185,129,0.04)" : "transparent", borderBottom: "1px solid rgba(48,54,61,0.4)", cursor: "pointer" }}>
                                      <td style={{ padding: "4px 8px", textAlign: "center", fontSize: 9, color: isTop ? "#10b981" : "rgba(255,255,255,0.3)", fontWeight: isTop ? 700 : 400 }}>{i + 1}</td>
                                      {SWEEP_COLS.map(c => {
                                        const val = c.fmt(r);
                                        const color = c.key === "sharpe" ? sharpeColor
                                          : c.key === "totalReturn" || c.key === "annReturn" || c.key === "vsObx" ? retColor
                                          : c.key === "maxDD" ? ddColor
                                          : c.key === "vol" && r.params.volGate === 'hard' ? "#f59e0b"
                                          : c.key === "sma200" && r.params.sma200Require ? "#3b82f6"
                                          : c.key === "mom" && r.params.momentumFilter > 0 ? "#3b82f6"
                                          : "rgba(255,255,255,0.7)";
                                        return (
                                          <td key={c.key} style={{ padding: "4px 8px", textAlign: "right", color, fontWeight: (c.key === "sharpe" && isTop) ? 700 : 400 }}>
                                            {val}
                                          </td>
                                        );
                                      })}
                                      <td style={{ padding: "4px 8px", textAlign: "center" }}>
                                        <button onClick={e => {
                                          e.stopPropagation();
                                          setSimEntry(r.params.entryThreshold);
                                          setSimExit(r.params.exitThreshold);
                                          setSimStop(r.params.stopLossPct);
                                          setSimTP(r.params.takeProfitPct);
                                          setSimMaxHold(r.params.maxHoldDays);
                                          setSimMom(r.params.momentumFilter);
                                          setSimVolGate(r.params.volGate);
                                          setSimSma200(r.params.sma200Require);
                                          setSimPlayIdx(-1);
                                          setSimIsPlaying(false);
                                        }}
                                          style={{ fontSize: 8, padding: "2px 7px", background: "#21262d", border: "1px solid #30363d",
                                            borderRadius: 3, color: "#3b82f6", cursor: "pointer", fontFamily: "monospace", fontWeight: 700 }}>
                                          APPLY
                                        </button>
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        )}

                        {!simSweepRunning && simSweepResults.length === 0 && (
                          <div style={{ textAlign: "center", padding: "20px 0", fontSize: 10, fontFamily: "monospace", color: "rgba(255,255,255,0.25)" }}>
                            Click RUN SWEEP to test all parameter combinations on {simTicker}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* ── Row 5: Equity Curve vs OBX (full width, bottom) ── */}
              <div style={cardStyle}>
                <div style={sectionTitle}>Equity Curve — Strategy vs OBX</div>
                {simLive.length > 1 ? (
                  <ResponsiveContainer width="100%" height={180}>
                    <LineChart data={simLive} margin={{ top: 5, right: 10, left: 10, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                      <XAxis dataKey="date" tick={{ fontSize: 9, fill: "rgba(255,255,255,0.4)", fontFamily: "monospace" }} tickFormatter={d => d.slice(5)} interval="preserveStartEnd" />
                      <YAxis tick={{ fontSize: 9, fill: "rgba(255,255,255,0.4)", fontFamily: "monospace" }} />
                      <Tooltip contentStyle={{ background: "#0d1117", border: "1px solid #30363d", borderRadius: 6, fontFamily: "monospace", fontSize: 11, color: "#fff" }}
                        formatter={(v: number | undefined, name: string | undefined) => [v?.toFixed(1) ?? "—", name === "equityValue" ? "Strategy" : "OBX"]} />
                      <Line type="monotone" dataKey="equityValue" stroke="#3b82f6" strokeWidth={2} dot={false} isAnimationActive={false} name="equityValue" />
                      <Line type="monotone" dataKey="benchmarkValue" stroke="rgba(255,255,255,0.25)" strokeWidth={1} dot={false} isAnimationActive={false} strokeDasharray="4 3" name="benchmarkValue" />
                      <ReferenceLine y={100} stroke="rgba(255,255,255,0.1)" strokeWidth={1} />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div style={{ height: 180, display: "flex", alignItems: "center", justifyContent: "center", color: "rgba(255,255,255,0.15)", fontSize: 12, fontFamily: "monospace" }}>
                    Press ▶ PLAY to see equity curve
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

    </main>
  );
}
