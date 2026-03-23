"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/useAuth";
import {
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, BarChart, Bar, Cell, ComposedChart, Area,
  ReferenceLine, ReferenceArea, Scatter,
} from "recharts";

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

  const [tab, setTab] = useState<"strategy" | "signals" | "explorer">("strategy");
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
  const [showExplorerSectors, setShowExplorerSectors] = useState(false);
  const [explorerSectorFilter, setExplorerSectorFilter] = useState("");
  const [explorerSectorSort, setExplorerSectorSort] = useState<"name" | "alpha">("name");
  const [expandedExplorerSectors, setExpandedExplorerSectors] = useState<Set<string>>(new Set());

  // Portfolio Strategy
  const [portfolioBacktest, setPortfolioBacktest] = useState<PortfolioBacktestResult | null>(null);
  const [portfolioBacktestLoading, setPortfolioBacktestLoading] = useState(false);

  // Top Performers
  type TopPerformer = { ticker: string; name: string; sector: string; avg_nokvol: number; latestPred: number; trades: number; wins: number; totalPnl: number; avgPnl: number; winRate: number; avgMaxDrawdown: number; maxSingleDrawdown: number };
  const [topPerformers, setTopPerformers] = useState<TopPerformer[]>([]);
  const [topPerfLoading, setTopPerfLoading] = useState(false);

  // Equity curve
  type EqCurvePoint = { date: string; value: number; positions: number };
  type EqCurveStats = { totalReturn: number; maxDrawdown: number; winRate: number; trades: number };
  const [equityCurve, setEquityCurve] = useState<EqCurvePoint[]>([]);
  const [equityCurveStats, setEquityCurveStats] = useState<EqCurveStats | null>(null);
  const [equityCurveLoading, setEquityCurveLoading] = useState(false);

  // ============================================================================
  // Auth
  // ============================================================================

  const handleLogin = async () => {
    setAuthLoading(true);
    setAuthError("");
    try {
      const res = await fetch("/api/portfolio/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username || undefined, password }),
      });
      if (res.ok) {
        const data = await res.json();
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

  const CACHE_KEY = "alpha_portfolio_backtest_v5";
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
    if (token && tab === "explorer" && explorerTicker) fetchTickerHistory(explorerTicker);
  }, [token, tab, explorerTicker, fetchTickerHistory]);

  // Load portfolio backtest on login (from cache if available)
  useEffect(() => {
    if (token && !portfolioBacktest && !portfolioBacktestLoading) runPortfolioBacktest();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // Fetch top performers (cached 6h)
  const TOP_PERF_CACHE_KEY = "alpha_top_performers_v6";
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

  const EQ_CACHE_KEY = `alpha_equity_curve_v1_${selectedModel}`;
  const EQ_CACHE_TTL = 6 * 60 * 60 * 1000;
  const fetchEquityCurve = useCallback(async (force = false) => {
    if (!token) return;
    if (!force) {
      try {
        const raw = localStorage.getItem(EQ_CACHE_KEY);
        if (raw) {
          const { curve, stats, ts } = JSON.parse(raw);
          if (Date.now() - ts < EQ_CACHE_TTL) { setEquityCurve(curve); setEquityCurveStats(stats); return; }
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
        try { localStorage.setItem(EQ_CACHE_KEY, JSON.stringify({ curve: data.equityCurve || [], stats: data.stats || null, ts: Date.now() })); } catch { /* ignore */ }
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

  // Trade thresholds & rules — must match top-performers API exactly
  const TRADE_ENTRY_PCT = 1.0;   // Enter when ML predicts >+1% monthly return
  const TRADE_EXIT_PCT  = 0.25;  // Signal exit threshold
  const TRADE_STOP_LOSS = -0.05; // Hard stop: -5% from entry (daily close)
  const TRADE_MIN_HOLD  = 5;     // Min trading days before signal exit allowed
  const TRADE_MAX_HOLD  = 21;    // Max trading days (1-month ML horizon)

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
      const predRet = sigData?.predicted_return ?? null;
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
      let prev: number | null = null;
      for (let j = i - 1; j >= Math.max(0, i - 5); j--) {
        if (raw[j].predicted_return != null) { prev = raw[j].predicted_return! * 100; break; }
      }
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
  }, [tickerHistory, selectedModel, TRADE_ENTRY_PCT, TRADE_EXIT_PCT, TRADE_STOP_LOSS, TRADE_MIN_HOLD, TRADE_MAX_HOLD]);

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
            <div style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", fontFamily: "monospace", marginBottom: 4 }}>USERNAME (OPTIONAL)</div>
            <input value={username} onChange={e => setUsername(e.target.value)}
              style={{ width: "100%", background: "#0d1117", border: "1px solid #30363d", borderRadius: 5, padding: "8px 10px", color: "#fff", fontFamily: "monospace", fontSize: 12, boxSizing: "border-box" as const }}
              placeholder="Leave blank if none" autoComplete="username" />
          </div>
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", fontFamily: "monospace", marginBottom: 4 }}>PASSWORD</div>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)}
              style={{ width: "100%", background: "#0d1117", border: "1px solid #30363d", borderRadius: 5, padding: "8px 10px", color: "#fff", fontFamily: "monospace", fontSize: 12, boxSizing: "border-box" as const }}
              placeholder="Enter password" autoComplete="current-password" />
          </div>
          <button type="submit"
            style={{ ...btnPrimary, width: "100%", padding: "11px 0", fontSize: 13, opacity: (authLoading || !password) ? 0.5 : 1 }}>
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
        ].map(t => <button key={t.id} onClick={() => setTab(t.id)} style={tabStyle(tab === t.id)}>{t.label}</button>)}
      </div>

      {/* ================================================================ */}
      {/* PORTFOLIO STRATEGY TAB                                           */}
      {/* ================================================================ */}
      {tab === "strategy" && (
        <div>
          <div style={{ ...cardStyle, marginBottom: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div>
                <div style={sectionTitle}>Cross-Sectional Portfolio Strategy — Monthly Rebalancing</div>
                <div style={{ fontSize: 10, fontFamily: "monospace", color: "rgba(255,255,255,0.3)", marginTop: -8, marginBottom: 4 }}>
                  Ranks all OSE stocks monthly on 6 alpha factors. Top quintile overweight (60%), bottom excluded. 15bps costs per rebalance.
                </div>
              </div>
              <button onClick={() => runPortfolioBacktest(true)} disabled={portfolioBacktestLoading}
                style={{ ...btnPrimary, fontSize: 10, padding: "6px 14px", opacity: portfolioBacktestLoading ? 0.5 : 1 }}>
                {portfolioBacktestLoading ? "Running..." : "Refresh"}
              </button>
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
                    <span style={{ color: "#3b82f6", fontWeight: 700 }}>{((portfolioBacktest.config.weights as Record<string, number>)[key] * 100).toFixed(0)}%</span>
                  </div>
                ))}
              </div>
            )}

            {/* ── TOP 10 ALPHA STOCKS ── */}
            <div style={{ ...cardStyle, marginBottom: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <div>
                  <div style={sectionTitle}>TOP 10 ALPHA STOCKS — Last 12 Months (Top 50 Liquid OSE)</div>
                  <div style={{ fontSize: 10, fontFamily: "monospace", color: "rgba(255,255,255,0.3)", marginTop: 2 }}>
                    Entry: ML pred &gt;+1% · Exit: signal &lt;+0.25% (min 5d hold) OR −5% stop loss OR 21d max hold
                  </div>
                </div>
                <button onClick={() => fetchTopPerformers(true)} disabled={topPerfLoading}
                  style={{ ...btnSecondary, fontSize: 10, padding: "5px 12px", opacity: topPerfLoading ? 0.5 : 1 }}>
                  {topPerfLoading ? "Loading..." : "Refresh"}
                </button>
              </div>
              {/* Simulation disclaimer */}
              <div style={{ background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.18)", borderRadius: 5, padding: "7px 12px", marginBottom: 12, display: "flex", gap: 8, alignItems: "flex-start" }}>
                <span style={{ color: "#f59e0b", fontSize: 13, lineHeight: 1 }}>⚠</span>
                <div style={{ fontSize: 10, fontFamily: "monospace", color: "rgba(255,255,255,0.4)", lineHeight: 1.5 }}>
                  <strong style={{ color: "rgba(255,255,255,0.55)" }}>Backtested simulation with realistic rules:</strong>{" "}
                  −5% hard stop loss · 5-day minimum hold · 21-day max hold (1-month ML horizon) · No future data used.
                  Corporate events (takeovers, surprise earnings) inflate returns during held periods — the ML did not predict these.
                  Expected live: <strong style={{ color: "#f59e0b" }}>55–65% win rate · 1–4% avg P&L/trade.</strong>{" "}
                  Click any row to drill into Explorer.
                </div>
              </div>
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
            </div>

            {/* ── CUMULATIVE PERFORMANCE CHART ── */}
            {(() => {
              const isPos = (equityCurveStats?.totalReturn ?? 0) >= 0;
              const lineColor = isPos ? "#10b981" : "#ef4444";
              const minVal = equityCurve.length > 0 ? Math.min(...equityCurve.map(e => e.value)) : 90;
              const maxVal = equityCurve.length > 0 ? Math.max(...equityCurve.map(e => e.value)) : 110;
              const domainLo = Math.floor(minVal * 0.97);
              const domainHi = Math.ceil(maxVal * 1.02);
              return (
                <div style={{ ...cardStyle, marginBottom: 16 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                    <div>
                      <div style={sectionTitle}>Cumulative Performance — Last 365 Days · Max 10 Positions · Equal Weight Slots</div>
                      <div style={{ fontSize: 10, fontFamily: "monospace", color: "rgba(255,255,255,0.3)", marginTop: -8 }}>
                        Top 50 liquid OSE · Entry &gt;+1% signal · −5% stop · 21d max · Up to 10 concurrent positions · Indexed to 100
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      {equityCurveStats && (
                        <div style={{ display: "flex", gap: 12, fontSize: 10, fontFamily: "monospace" }}>
                          <span style={{ color: "rgba(255,255,255,0.4)" }}>Return: <span style={{ color: isPos ? "#10b981" : "#ef4444", fontWeight: 800, fontSize: 13 }}>{isPos ? "+" : ""}{equityCurveStats.totalReturn.toFixed(1)}%</span></span>
                          <span style={{ color: "rgba(255,255,255,0.4)" }}>Max DD: <span style={{ color: "#ef4444", fontWeight: 700 }}>{equityCurveStats.maxDrawdown.toFixed(1)}%</span></span>
                          <span style={{ color: "rgba(255,255,255,0.4)" }}>Win Rate: <span style={{ color: "#f59e0b", fontWeight: 700 }}>{equityCurveStats.winRate.toFixed(0)}%</span></span>
                          <span style={{ color: "rgba(255,255,255,0.4)" }}>Trades: <span style={{ color: "#fff", fontWeight: 700 }}>{equityCurveStats.trades}</span></span>
                        </div>
                      )}
                      <button onClick={() => fetchEquityCurve(true)} disabled={equityCurveLoading}
                        style={{ ...btnSecondary, fontSize: 9, padding: "4px 10px", opacity: equityCurveLoading ? 0.5 : 1 }}>
                        {equityCurveLoading ? "Loading..." : "Refresh"}
                      </button>
                    </div>
                  </div>

                  {equityCurveLoading && (
                    <div style={{ textAlign: "center", padding: 40, color: "rgba(255,255,255,0.3)", fontFamily: "monospace", fontSize: 11 }}>
                      Simulating portfolio across 365 days of trading...
                    </div>
                  )}

                  {!equityCurveLoading && equityCurve.length > 0 && (() => {
                    // Add gradientId with gradient fill
                    return (
                      <>
                        {/* Main equity curve */}
                        <ResponsiveContainer width="100%" height={260}>
                          <ComposedChart data={equityCurve} margin={{ top: 5, right: 60, left: 10, bottom: 0 }}>
                            <defs>
                              <linearGradient id="eqGrad" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor={lineColor} stopOpacity={0.25} />
                                <stop offset="100%" stopColor={lineColor} stopOpacity={0.02} />
                              </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                            <XAxis dataKey="date" tick={{ fontSize: 9, fill: "rgba(255,255,255,0.4)", fontFamily: "monospace" }}
                              tickFormatter={d => d.slice(5)} interval="preserveStartEnd" />
                            {/* Left axis: indexed price */}
                            <YAxis yAxisId="left" domain={[domainLo, domainHi]}
                              tick={{ fontSize: 9, fill: "rgba(255,255,255,0.4)", fontFamily: "monospace" }}
                              tickFormatter={v => v.toFixed(0)} width={42} />
                            {/* Right axis: returns % */}
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
                            <BarChart data={equityCurve} margin={{ top: 0, right: 60, left: 10, bottom: 0 }} barCategoryGap="0%">
                              <XAxis dataKey="date" tick={false} axisLine={false} tickLine={false} />
                              <YAxis domain={[0, 10]} tick={{ fontSize: 8, fill: "rgba(255,255,255,0.25)", fontFamily: "monospace" }}
                                tickCount={3} width={42} tickFormatter={v => `${v}p`} />
                              <Tooltip
                                contentStyle={{ background: "#0d1117", border: "1px solid #30363d", borderRadius: 6, fontFamily: "monospace", fontSize: 10 }}
                                formatter={((v: number) => [`${v} / 10 positions`, "Active"]) as Parameters<typeof Tooltip>[0]["formatter"]}
                                labelFormatter={l => l} />
                              <Bar dataKey="positions" fill="rgba(59,130,246,0.4)" isAnimationActive={false} />
                            </BarChart>
                          </ResponsiveContainer>
                          <div style={{ fontSize: 8, fontFamily: "monospace", color: "rgba(255,255,255,0.2)", textAlign: "right", marginRight: 64, marginTop: -4 }}>
                            active positions (0–10)
                          </div>
                        </div>
                      </>
                    );
                  })()}

                  {!equityCurveLoading && equityCurve.length === 0 && (
                    <div style={{ textAlign: "center", padding: 32, color: "rgba(255,255,255,0.3)", fontFamily: "monospace", fontSize: 11 }}>
                      Loading equity curve...
                    </div>
                  )}
                </div>
              );
            })()}

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
                      <div style={{ fontSize: 9, fontFamily: "monospace", color: "#10b981", letterSpacing: "0.05em", fontWeight: 700, marginBottom: 10 }}>STRATEGY — TOP 15 CONCENTRATED</div>
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
                              {portfolioBacktest.monthlyReturns.map((d, i) => <Cell key={i} fill={d.excess >= 0 ? "#34d399" : "#f87171"} />)}
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
                              {portfolioBacktest.monthlyReturns.map((d, i) => <Cell key={i} fill={d.ic >= 0 ? "#60a5fa" : "#f87171"} />)}
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
                          <div key={sa.sector} style={{ background: "#0d1117", border: "1px solid #21262d", borderRadius: 4, padding: "6px 14px", borderLeft: `3px solid ${sa.color}` }}>
                            <div style={{ fontSize: 9, fontFamily: "monospace", color: "rgba(255,255,255,0.4)" }}>{sa.sector}</div>
                            <div style={{ fontSize: 16, fontWeight: 800, fontFamily: "monospace", color: sa.color }}>{sa.weight.toFixed(1)}%</div>
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
            </div>
          </div>

          {/* Signal Table */}
          <div style={cardStyle}>
            {signalsLoading ? (
              <div style={{ textAlign: "center", padding: 40, color: "rgba(255,255,255,0.4)", fontFamily: "monospace" }}>Loading signals...</div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "monospace" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid #30363d" }}>
                    {["Ticker", "Name", "Sector", "Rank", "Signal", "Price", "1D Chg"].map(h => (
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
                    onChange={e => { setExplorerSearch(e.target.value); setShowExplorerSectors(false); }}
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
                    {explorerSearchResults.map(s => (
                      <div key={s.ticker}
                        onMouseDown={() => { setExplorerTicker(s.ticker); setExplorerSearch(""); }}
                        style={{ padding: "8px 14px", fontSize: 12, fontFamily: "monospace", cursor: "pointer", display: "flex", alignItems: "center", gap: 10, borderBottom: "1px solid #21262d" }}
                        onMouseEnter={e => (e.currentTarget.style.background = "rgba(59,130,246,0.1)")}
                        onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
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

              {explorerTicker && (
                <span style={{ marginLeft: "auto", fontSize: 10, fontFamily: "monospace", color: "rgba(255,255,255,0.3)", alignSelf: "center" }}>
                  {tickerHistory?.signals.filter(s => s.model_id === selectedModel).length || 0} signals · {tickerHistory?.actualReturns.length || 0} days
                </span>
              )}
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
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                        <div>
                          <div style={sectionTitle}>Simulated Trade Log — Entry &gt;{TRADE_ENTRY_PCT}% · Stop {TRADE_STOP_LOSS*100}% · Min {TRADE_MIN_HOLD}d · Max {TRADE_MAX_HOLD}d</div>
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
    </main>
  );
}
