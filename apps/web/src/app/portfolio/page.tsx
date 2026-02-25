"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import {
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, BarChart, Bar, Cell, PieChart, Pie,
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
} from "recharts";

// ============================================================================
// Types
// ============================================================================

interface WeightItem {
  ticker: string;
  name: string;
  sector: string;
  currency: string;
  weight: number;
  sharesApprox: number;
  valueNOK: number;
  lastPrice: number;
}

interface Metrics {
  expectedReturn: number;
  volatility: number;
  sharpeRatio: number;
  sortinoRatio: number;
  var95: number;
  var99: number;
  cvar95: number;
  cvar99: number;
  maxDrawdown: number;
  betaToOBX: number;
  trackingError: number;
  herfindahlIndex: number;
  effectivePositions: number;
  diversificationRatio: number;
}

interface RiskDecomp {
  ticker: string;
  weight: number;
  marginalContribution: number;
  componentRisk: number;
  percentOfRisk: number;
  componentVaR95: number;
}

interface EFPoint {
  return: number;
  volatility: number;
  sharpe: number;
}

interface AssetPoint {
  ticker: string;
  return: number;
  volatility: number;
}

interface StressScenario {
  name: string;
  portfolioVol: number;
  var95: number;
  description: string;
}

interface HoldingRegime {
  ticker: string;
  regime: string;
  volatility: number;
  percentile: number;
}

interface HoldingSignal {
  ticker: string;
  mlSignal: 'Strong Buy' | 'Buy' | 'Hold' | 'Sell' | 'Strong Sell' | 'N/A';
  mlReturn: number;
  mlConfidence: number;
  mlPercentiles: { p05: number; p25: number; p50: number; p75: number; p95: number } | null;
  momentumSignal: 'Bullish' | 'Neutral' | 'Bearish';
  momentum: { ret1m: number; ret3m: number; ret6m: number; mom1m: number | null; mom6m: number | null };
  valuationSignal: 'Cheap' | 'Fair' | 'Expensive' | 'N/A';
  valuation: { ep: number | null; bm: number | null; dy: number | null; ev_ebitda: number | null; sp: number | null; mktcap: number | null; zScores: { ep: number | null; bm: number | null; dy: number | null; sp: number | null; ev_ebitda: number | null } | null };
  beta: number;
  currentDrawdown: number;
  conviction: number;
  researchCount: number;
  researchLatest: string | null;
  alerts: string[];
  cluster?: {
    cluster_id: number;
    z_score: number;
    half_life: number | null;
    signal: string;
  } | null;
  combinedSignal?: {
    combined_signal: number;
    classification: string;
    component_signals: Record<string, number>;
    weights_used: Record<string, number>;
    regime_adjusted: boolean;
  } | null;
}

interface ClusterInfo {
  id: number;
  tickers: string[];
  n_members: number;
  half_life: number | null;
  z_score: number;
  intra_cluster_correlation: number;
  mean_reversion_signal: string;
}

interface ClusterAnalysis {
  n_clusters: number;
  clusters: ClusterInfo[];
  assignments: Record<string, { cluster_id: number; z_score: number; half_life: number | null; signal: string }>;
  silhouette_score: number;
}

interface RiskAlert {
  level: 'info' | 'warning' | 'critical';
  message: string;
}

interface ModeMetrics {
  expectedReturn: number;
  volatility: number;
  sharpeRatio: number;
  sortinoRatio: number;
  maxDrawdown: number;
  var95: number;
  effectivePositions: number;
  diversificationRatio: number;
  mlExpectedReturn: number;
  mlSharpe: number;
  topHoldings: { ticker: string; weight: number }[];
}

interface OptimizationResult {
  weights: WeightItem[];
  metrics: Metrics;
  riskDecomposition: RiskDecomp[];
  efficientFrontier: EFPoint[];
  assetPoints?: AssetPoint[];
  correlationMatrix: { tickers: string[]; values: number[][] };
  sectorAllocation: { sector: string; weight: number }[];
  fxExposure: { currency: string; weightedExposure: number }[];
  regimeContext: {
    holdingRegimes: HoldingRegime[];
    portfolioRegime?: {
      current_state: number;
      current_state_label: string;
      current_probs: number[];
      state_labels: string[];
      transition_matrix: number[][];
      state_stats: {
        label: string;
        mean_return: number;
        annualized_vol: number;
        avg_correlation: number;
        expected_duration_days: number;
        frequency: number;
        n_observations: number;
        per_asset_returns: Record<string, number>;
      }[];
      regime_history: {
        state: number;
        label: string;
        probs: number[];
        date?: string;
      }[];
      regime_conditional_returns: Record<string, Record<string, number>>;
      bic: number;
      n_observations: number;
    } | null;
  };
  clusterAnalysis?: ClusterAnalysis | null;
  stressScenarios: StressScenario[];
  holdingSignals?: HoldingSignal[];
  riskAlerts?: RiskAlert[];
  modeComparison?: Record<string, ModeMetrics>;
  meta: {
    lookbackDays: number;
    covarianceMethod: string;
    mode: string;
    riskFreeRate: number;
    portfolioValueNOK: number;
    commonDates: number;
    shrinkageIntensity?: number;
    constraintAdjusted?: boolean;
    originalMaxPosition?: number;
    effectiveMaxPosition?: number;
  };
}

interface SavedConfig {
  id: number;
  name: string;
  description: string | null;
  tickers: string[];
  weights: number[];
  optimization_mode: string;
  constraints: Record<string, unknown>;
  portfolio_value_nok: number;
  lookback_days: number;
  covariance_method: string;
  updated_at: string;
}

interface StockOption {
  ticker: string;
  name: string;
  sector: string;
  last_close: number;
  rows: number;
}

// ============================================================================
// Constants
// ============================================================================

const REGIME_COLORS: Record<string, string> = {
  "Crisis": "#FF1744",
  "Extreme High": "#F44336",
  "Elevated": "#FF9800",
  "Normal": "#9E9E9E",
  "Low & Contracting": "#2196F3",
  "Low & Stable": "#4CAF50",
};

const HMM_REGIME_COLORS: Record<string, string> = {
  "Crisis": "#FF1744",
  "Neutral": "#FF9800",
  "Bull": "#4CAF50",
  "Bear": "#FF1744",
};

const CLUSTER_COLORS = [
  "#3b82f6", "#f59e0b", "#10b981", "#ef4444", "#8b5cf6",
  "#06b6d4", "#f97316", "#ec4899",
];

const MR_SIGNAL_COLORS: Record<string, string> = {
  "Strong Buy": "#00c853",
  "Buy": "#4caf50",
  "Neutral": "#9e9e9e",
  "Sell": "#ef5350",
  "Strong Sell": "#d50000",
};

const SECTOR_COLORS = [
  "#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6",
  "#06b6d4", "#f97316", "#84cc16", "#ec4899", "#6366f1",
  "#14b8a6", "#eab308",
];

const MODE_LABELS: Record<string, string> = {
  equal: "Equal Weight",
  min_variance: "Min Variance",
  max_sharpe: "Max Sharpe",
  risk_parity: "Risk Parity",
  max_diversification: "Max Diversification",
};

const SIGNAL_COLORS: Record<string, string> = {
  "Strong Buy": "#00c853",
  "Buy": "#4caf50",
  "Hold": "#9e9e9e",
  "Sell": "#ef5350",
  "Strong Sell": "#d50000",
  "N/A": "#616161",
  "Bullish": "#4caf50",
  "Neutral": "#9e9e9e",
  "Bearish": "#ef5350",
  "Cheap": "#4caf50",
  "Fair": "#9e9e9e",
  "Expensive": "#ef5350",
};

const ALERT_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  critical: { bg: "rgba(213,0,0,0.12)", border: "#d50000", text: "#ff5252" },
  warning: { bg: "rgba(255,152,0,0.10)", border: "#f57c00", text: "#ffb74d" },
  info: { bg: "rgba(33,150,243,0.08)", border: "#1976d2", text: "#64b5f6" },
};

// ============================================================================
// Styles
// ============================================================================

const cardStyle: React.CSSProperties = {
  background: "#161b22",
  border: "1px solid #30363d",
  borderRadius: 8,
  padding: 16,
};

const sectionTitle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  color: "rgba(255,255,255,0.6)",
  letterSpacing: "0.08em",
  textTransform: "uppercase" as const,
  marginBottom: 12,
  fontFamily: "monospace",
};

const btnStyle = (active: boolean): React.CSSProperties => ({
  padding: "6px 14px",
  borderRadius: 4,
  fontSize: 11,
  fontWeight: 600,
  border: `1px solid ${active ? "#3b82f6" : "#30363d"}`,
  background: active ? "#3b82f6" : "transparent",
  color: active ? "#fff" : "rgba(255,255,255,0.6)",
  cursor: "pointer",
  fontFamily: "monospace",
});

// ============================================================================
// Main Component
// ============================================================================

export default function PortfolioPage() {
  // Auth state — no persistence, require login each page load
  const [token, setToken] = useState<string | null>(null);
  const [profileName, setProfileName] = useState<string>("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);

  // Construction state
  const [availableStocks, setAvailableStocks] = useState<StockOption[]>([]);
  const [selectedTickers, setSelectedTickers] = useState<string[]>([]);
  const [tickerInput, setTickerInput] = useState("");
  const [mode, setMode] = useState("min_variance");
  const [portfolioValueNOK, setPortfolioValueNOK] = useState(10_000_000);
  const [lookbackDays, setLookbackDays] = useState(504);
  const [covMethod, setCovMethod] = useState("shrinkage");
  const [maxPosition, setMaxPosition] = useState(0.20);
  const [maxSector, setMaxSector] = useState(0.30);
  const [forceIncludeAll, setForceIncludeAll] = useState(true);

  // Results
  const [result, setResult] = useState<OptimizationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Saved configs
  const [configs, setConfigs] = useState<SavedConfig[]>([]);
  const [saveName, setSaveName] = useState("");
  const [showSaveForm, setShowSaveForm] = useState(false);

  // UI state
  const [riskSortKey, setRiskSortKey] = useState<keyof RiskDecomp>("percentOfRisk");
  const [riskSortAsc, setRiskSortAsc] = useState(false);
  const [holdingSortKey, setHoldingSortKey] = useState<string>("weight");
  const [holdingSortAsc, setHoldingSortAsc] = useState(false);
  const [hoveredMode, setHoveredMode] = useState<string | null>(null);
  const [hoveredAsset, setHoveredAsset] = useState<string | null>(null);

  // No session restore — always require fresh login

  // Fetch available stocks when authenticated
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/stocks?assetTypes=equity");
        if (res.ok) {
          const data = await res.json();
          if (!cancelled) {
            setAvailableStocks(
              (data.stocks || data)
                .filter((s: StockOption & { asset_type?: string }) => s.asset_type === "equity" || !s.asset_type)
                .map((s: any) => ({
                  ticker: s.ticker,
                  name: s.name || s.ticker,
                  sector: s.sector || "Unknown",
                  last_close: Number(s.last_close || 0),
                  rows: Number(s.rows || 0),
                }))
            );
          }
        }
      } catch (e) {
        console.error("Failed to fetch stocks:", e);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [token]);

  // Fetch saved configs when authenticated
  const loadConfigs = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch("/api/portfolio/configs", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401) { setToken(null); setProfileName(""); return; }
      if (res.ok) {
        const data = await res.json();
        setConfigs(data.configs || []);
      }
    } catch (e) {
      console.error("Failed to load configs:", e);
    }
  }, [token]);

  useEffect(() => { loadConfigs(); }, [loadConfigs]);

  // Auth handler
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
        setToken(data.token);
        setProfileName(data.profile || "");
      } else {
        setAuthError("Invalid username or password");
      }
    } catch {
      setAuthError("Connection error");
    } finally {
      setAuthLoading(false);
    }
  };

  // Auto-logout on 401 from any API call
  const handleAuthError = (res: Response) => {
    if (res.status === 401) {
      setToken(null);
      setProfileName("");
      setError("Session expired. Please sign in again.");
      return true;
    }
    return false;
  };

  // Signal explanation toggle
  const [showSignalGuide, setShowSignalGuide] = useState(true);

  // Sector browser state
  const [showSectorBrowser, setShowSectorBrowser] = useState(false);
  const [expandedSectors, setExpandedSectors] = useState<Set<string>>(new Set());
  const [sectorSort, setSectorSort] = useState<'name' | 'price' | 'data'>('name');
  const [sectorSearchFilter, setSectorSearchFilter] = useState('');

  // Stable sector color map
  const sectorColorMap = useMemo(() => {
    const allSectors = Array.from(new Set(availableStocks.map(s => s.sector || "Unknown"))).sort();
    const map: Record<string, string> = {};
    allSectors.forEach((sector, i) => {
      map[sector] = SECTOR_COLORS[i % SECTOR_COLORS.length];
    });
    return map;
  }, [availableStocks]);

  // Sector-grouped stocks for the browser
  const sectorGroups = useMemo(() => {
    const groups: Record<string, StockOption[]> = {};
    let stocks = availableStocks.filter(s => !selectedTickers.includes(s.ticker));
    if (sectorSearchFilter) {
      const q = sectorSearchFilter.toUpperCase();
      stocks = stocks.filter(s =>
        s.ticker.includes(q) || s.name.toUpperCase().includes(q)
      );
    }
    for (const stock of stocks) {
      const sector = stock.sector || "Unknown";
      if (!groups[sector]) groups[sector] = [];
      groups[sector].push(stock);
    }
    for (const sector of Object.keys(groups)) {
      groups[sector].sort((a, b) => {
        if (sectorSort === 'name') return a.name.localeCompare(b.name);
        if (sectorSort === 'price') return b.last_close - a.last_close;
        return b.rows - a.rows;
      });
    }
    return groups;
  }, [availableStocks, selectedTickers, sectorSort, sectorSearchFilter]);

  const sortedSectorNames = useMemo(() => {
    return Object.keys(sectorGroups).sort((a, b) =>
      sectorGroups[b].length - sectorGroups[a].length
    );
  }, [sectorGroups]);

  // Ticker management
  const filteredStocks = useMemo(() => {
    if (!tickerInput) return [];
    const q = tickerInput.toUpperCase();
    return availableStocks
      .filter(s =>
        !selectedTickers.includes(s.ticker) &&
        (s.ticker.includes(q) || s.name.toUpperCase().includes(q))
      )
      .slice(0, 8);
  }, [tickerInput, availableStocks, selectedTickers]);

  const addTicker = (ticker: string) => {
    if (!selectedTickers.includes(ticker)) {
      setSelectedTickers([...selectedTickers, ticker]);
    }
    setTickerInput("");
  };

  const removeTicker = (ticker: string) => {
    setSelectedTickers(selectedTickers.filter(t => t !== ticker));
  };

  // Run optimization (accepts optional overrideMode for strategy switching)
  const runOptimization = async (overrideMode?: string) => {
    if (selectedTickers.length < 2) {
      setError("Select at least 2 tickers");
      return;
    }
    setLoading(true);
    setError(null);
    const useMode = overrideMode || mode;
    try {
      const res = await fetch("/api/portfolio/optimize", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          tickers: selectedTickers,
          mode: useMode,
          constraints: {
            maxPositionSize: maxPosition,
            minPositionSize: forceIncludeAll ? 0.01 : 0,
            maxSectorExposure: maxSector,
            excludeTickers: [],
          },
          forceIncludeAll,
          lookbackDays,
          portfolioValueNOK,
          riskFreeRate: 0.045,
          covarianceMethod: covMethod,
        }),
      });

      if (!res.ok) {
        if (handleAuthError(res)) return;
        const errData = await res.json().catch(() => ({ error: "Request failed" }));
        setError(errData.error || `Error ${res.status}`);
        return;
      }

      const data = await res.json();
      setResult(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Optimization failed");
    } finally {
      setLoading(false);
    }
  };

  // Save config
  const saveConfig = async () => {
    if (!saveName || !result) return;
    try {
      await fetch("/api/portfolio/configs", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: saveName,
          tickers: selectedTickers,
          weights: result.weights.map(w => w.weight),
          optimization_mode: mode,
          constraints: { maxPositionSize: maxPosition, maxSectorExposure: maxSector },
          portfolio_value_nok: portfolioValueNOK,
          lookback_days: lookbackDays,
          covariance_method: covMethod,
        }),
      });
      setSaveName("");
      setShowSaveForm(false);
      loadConfigs();
    } catch (e) {
      console.error("Save failed:", e);
    }
  };

  // Load saved config
  const loadConfig = (config: SavedConfig) => {
    setSelectedTickers(config.tickers);
    setMode(config.optimization_mode);
    setPortfolioValueNOK(Number(config.portfolio_value_nok));
    setLookbackDays(config.lookback_days);
    setCovMethod(config.covariance_method);
    const c = config.constraints as { maxPositionSize?: number; maxSectorExposure?: number };
    if (c.maxPositionSize) setMaxPosition(c.maxPositionSize);
    if (c.maxSectorExposure) setMaxSector(c.maxSectorExposure);
  };

  // Delete config
  const deleteConfig = async (id: number) => {
    try {
      const res = await fetch(`/api/portfolio/configs/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (handleAuthError(res)) return;
      loadConfigs();
    } catch (e) {
      console.error("Delete failed:", e);
    }
  };

  // Sort helpers
  const sortedRiskDecomp = useMemo(() => {
    if (!result) return [];
    return [...result.riskDecomposition].sort((a, b) => {
      const av = a[riskSortKey] as number;
      const bv = b[riskSortKey] as number;
      return riskSortAsc ? av - bv : bv - av;
    });
  }, [result, riskSortKey, riskSortAsc]);

  const sortedWeights = useMemo(() => {
    if (!result) return [];
    return [...result.weights].sort((a, b) => {
      const av = (a as unknown as Record<string, unknown>)[holdingSortKey] as number;
      const bv = (b as unknown as Record<string, unknown>)[holdingSortKey] as number;
      return holdingSortAsc ? (av > bv ? 1 : -1) : (av < bv ? 1 : -1);
    });
  }, [result, holdingSortKey, holdingSortAsc]);

  // ============================================================================
  // Login Screen
  // ============================================================================

  if (!token) {
    const inputStyle = {
      width: "100%",
      padding: "10px 12px",
      background: "#0d1117",
      border: "1px solid #30363d",
      borderRadius: 4,
      color: "#fff",
      fontSize: 13,
      fontFamily: "monospace",
      marginBottom: 12,
      boxSizing: "border-box" as const,
    };
    return (
      <main style={{ padding: 24, maxWidth: 380, margin: "100px auto" }}>
        <form
          style={{ ...cardStyle, padding: 28 }}
          onSubmit={e => { e.preventDefault(); handleLogin(); }}
        >
          <div style={{ textAlign: "center", marginBottom: 24 }}>
            <div style={{ fontSize: 20, fontWeight: 700, fontFamily: "monospace", letterSpacing: "-0.02em" }}>
              Portfolio Optimizer
            </div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", fontFamily: "monospace", marginTop: 4 }}>
              Sign in to access your portfolio
            </div>
          </div>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", fontFamily: "monospace", marginBottom: 4, letterSpacing: "0.05em" }}>
            USERNAME
          </div>
          <input
            type="text"
            value={username}
            onChange={e => setUsername(e.target.value)}
            placeholder="Enter username"
            autoFocus
            autoComplete="username"
            style={inputStyle}
          />
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", fontFamily: "monospace", marginBottom: 4, letterSpacing: "0.05em" }}>
            PASSWORD
          </div>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="Enter password"
            autoComplete="current-password"
            style={inputStyle}
          />
          <button
            type="submit"
            disabled={authLoading || !password || !username}
            style={{
              width: "100%",
              padding: "11px 0",
              marginTop: 4,
              background: authLoading ? "#30363d" : "#3b82f6",
              color: "#fff",
              border: "none",
              borderRadius: 4,
              fontSize: 13,
              fontWeight: 600,
              fontFamily: "monospace",
              cursor: authLoading ? "wait" : "pointer",
              opacity: (authLoading || !password || !username) ? 0.5 : 1,
              transition: "opacity 0.15s",
            }}
          >
            {authLoading ? "Signing in..." : "Sign In"}
          </button>
          {authError && (
            <div style={{ color: "#ef4444", fontSize: 11, marginTop: 10, fontFamily: "monospace", textAlign: "center" }}>
              {authError}
            </div>
          )}
        </form>
      </main>
    );
  }

  // ============================================================================
  // Main Dashboard
  // ============================================================================

  const m = result?.metrics;

  return (
    <main style={{ padding: "20px 24px", maxWidth: 1400, margin: "0 auto" }}>
      {/* Loading bar for strategy switching */}
      {loading && result && (
        <>
          <style dangerouslySetInnerHTML={{ __html: "@keyframes loadSlide{0%{transform:translateX(-100%)}100%{transform:translateX(200%)}}" }} />
          <div style={{ position: "fixed", top: 0, left: 0, right: 0, height: 2, zIndex: 100, background: "#0d1117", overflow: "hidden" }}>
            <div style={{ height: "100%", width: "40%", background: "linear-gradient(90deg, transparent, #3b82f6, #10b981, transparent)", animation: "loadSlide 1.2s ease-in-out infinite" }} />
          </div>
        </>
      )}

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <Link href="/" style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", textDecoration: "none", fontFamily: "monospace" }}>
            ← Home
          </Link>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: "4px 0 0", fontFamily: "monospace", letterSpacing: "-0.02em" }}>
            Portfolio Optimizer
          </h1>
          {profileName && (
            <span style={{ fontSize: 10, color: "#3b82f6", fontFamily: "monospace", fontWeight: 600, padding: "2px 8px", background: "rgba(59,130,246,0.1)", borderRadius: 3, border: "1px solid rgba(59,130,246,0.2)" }}>
              {profileName}
            </span>
          )}
        </div>
        <button
          onClick={() => { setToken(null); setProfileName(""); setUsername(""); setPassword(""); }}
          style={{ ...btnStyle(false), fontSize: 10 }}
        >
          Logout
        </button>
      </div>

      {/* === SAVED PORTFOLIOS BAR === */}
      {configs.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", fontFamily: "monospace", letterSpacing: "0.08em" }}>
              SAVED PORTFOLIOS
            </div>
            <div style={{ flex: 1, height: 1, background: "#30363d" }} />
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {configs.map(c => {
              const isLoaded = selectedTickers.length === c.tickers.length && c.tickers.every(t => selectedTickers.includes(t));
              return (
                <div
                  key={c.id}
                  style={{
                    display: "flex", alignItems: "center", gap: 8,
                    padding: "8px 14px", borderRadius: 6,
                    background: isLoaded ? "rgba(59,130,246,0.12)" : "#161b22",
                    border: `1px solid ${isLoaded ? "rgba(59,130,246,0.4)" : "#30363d"}`,
                    cursor: "pointer",
                    transition: "all 0.15s ease",
                  }}
                  onClick={() => loadConfig(c)}
                >
                  <div style={{ width: 6, height: 6, borderRadius: "50%", background: isLoaded ? "#3b82f6" : "#484f58" }} />
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, fontFamily: "monospace", color: isLoaded ? "#3b82f6" : "#fff" }}>
                      {c.name}
                    </div>
                    <div style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", fontFamily: "monospace" }}>
                      {c.tickers.length} assets · {MODE_LABELS[c.optimization_mode] || c.optimization_mode} · {c.covariance_method}
                    </div>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); deleteConfig(c.id); }}
                    style={{ background: "none", border: "none", color: "rgba(255,255,255,0.2)", fontSize: 14, cursor: "pointer", fontFamily: "monospace", padding: "0 4px", lineHeight: 1 }}
                    onMouseEnter={e => (e.currentTarget.style.color = "#ef4444")}
                    onMouseLeave={e => (e.currentTarget.style.color = "rgba(255,255,255,0.2)")}
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* === PORTFOLIO CONSTRUCTION === */}
      <div style={{ ...cardStyle, marginBottom: 20, padding: 0, overflow: "hidden" }}>
        {/* Step 1: Asset Selection */}
        <div style={{ padding: "16px 20px", borderBottom: "1px solid #30363d" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
            <span style={{
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              width: 22, height: 22, borderRadius: "50%", background: "#3b82f6", color: "#fff",
              fontSize: 11, fontWeight: 800, fontFamily: "monospace",
            }}>1</span>
            <span style={{ fontSize: 13, fontWeight: 700, fontFamily: "monospace", color: "#fff" }}>Select Assets</span>
            <span style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", fontFamily: "monospace" }}>
              Choose equities from the OSE universe for your portfolio
            </span>
          </div>

          <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
            {/* Ticker Input */}
            <div style={{ flex: 1, position: "relative" }}>
              <div style={{ position: "relative" }}>
                <input
                  value={tickerInput}
                  onChange={e => setTickerInput(e.target.value)}
                  placeholder={selectedTickers.length === 0 ? "Type to search by ticker or company name..." : "Add more tickers..."}
                  style={{
                    width: "100%",
                    padding: "10px 14px",
                    paddingLeft: 36,
                    background: "#0d1117",
                    border: "1px solid #30363d",
                    borderRadius: 6,
                    color: "#fff",
                    fontSize: 13,
                    fontFamily: "monospace",
                    boxSizing: "border-box",
                    outline: "none",
                  }}
                  onFocus={e => (e.currentTarget.style.borderColor = "#3b82f6")}
                  onBlur={e => (e.currentTarget.style.borderColor = "#30363d")}
                />
                <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "rgba(255,255,255,0.3)", fontSize: 14 }}>
                  +
                </span>
              </div>

              {/* Enhanced Dropdown */}
              {filteredStocks.length > 0 && (
                <div style={{
                  position: "absolute",
                  top: "calc(100% + 4px)",
                  left: 0,
                  right: 0,
                  background: "#161b22",
                  border: "1px solid #3b82f6",
                  borderRadius: 6,
                  zIndex: 20,
                  maxHeight: 280,
                  overflowY: "auto",
                  boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
                }}>
                  {filteredStocks.map(s => {
                    const sectorColor = sectorColorMap[s.sector] || "#484f58";
                    return (
                      <div
                        key={s.ticker}
                        onClick={() => addTicker(s.ticker)}
                        style={{
                          padding: "8px 14px",
                          fontSize: 12,
                          fontFamily: "monospace",
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                          borderBottom: "1px solid #21262d",
                        }}
                        onMouseEnter={e => (e.currentTarget.style.background = "rgba(59,130,246,0.08)")}
                        onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                      >
                        <span style={{ fontWeight: 700, color: "#fff", minWidth: 50 }}>{s.ticker}</span>
                        <span style={{ color: "rgba(255,255,255,0.5)", flex: 1, fontSize: 11 }}>{s.name}</span>
                        <span style={{
                          fontSize: 8, padding: "2px 6px", borderRadius: 3,
                          background: `${sectorColor}20`, color: sectorColor,
                          fontWeight: 600, whiteSpace: "nowrap",
                        }}>{s.sector}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Selected count */}
            <div style={{
              padding: "10px 16px", borderRadius: 6, background: "#0d1117",
              border: "1px solid #30363d", textAlign: "center", minWidth: 80,
            }}>
              <div style={{ fontSize: 20, fontWeight: 800, fontFamily: "monospace", color: selectedTickers.length >= 2 ? "#3b82f6" : "#ef4444" }}>
                {selectedTickers.length}
              </div>
              <div style={{ fontSize: 8, color: "rgba(255,255,255,0.4)", fontFamily: "monospace", letterSpacing: "0.05em" }}>
                {selectedTickers.length === 1 ? "ASSET" : "ASSETS"}
              </div>
            </div>
          </div>

          {/* Sector Browser Toggle */}
          <button
            onClick={() => setShowSectorBrowser(!showSectorBrowser)}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "6px 0", marginTop: 8,
              background: "none", border: "none",
              color: showSectorBrowser ? "#3b82f6" : "rgba(255,255,255,0.4)",
              fontSize: 10, fontFamily: "monospace", cursor: "pointer",
              letterSpacing: "0.05em",
            }}
            onMouseEnter={e => { if (!showSectorBrowser) e.currentTarget.style.color = "#3b82f6"; }}
            onMouseLeave={e => { if (!showSectorBrowser) e.currentTarget.style.color = "rgba(255,255,255,0.4)"; }}
          >
            {showSectorBrowser ? "▲ HIDE SECTOR BROWSER" : "▼ BROWSE BY SECTOR"}
            <span style={{ fontSize: 9, opacity: 0.6 }}>
              ({availableStocks.filter(s => !selectedTickers.includes(s.ticker)).length} available)
            </span>
          </button>

          {/* Sector Browser Panel */}
          {showSectorBrowser && (
            <div style={{
              marginTop: 4, padding: 12,
              background: "#0d1117", border: "1px solid #30363d",
              borderRadius: 6, maxHeight: 420, overflowY: "auto",
            }}>
              {/* Top bar: filter + sort */}
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
                <input
                  value={sectorSearchFilter}
                  onChange={e => setSectorSearchFilter(e.target.value)}
                  placeholder="Filter stocks..."
                  style={{
                    flex: 1, padding: "6px 10px",
                    background: "#161b22", border: "1px solid #21262d",
                    borderRadius: 4, color: "#fff", fontSize: 11,
                    fontFamily: "monospace", outline: "none",
                  }}
                />
                <div style={{ display: "flex", gap: 2 }}>
                  {(['name', 'price', 'data'] as const).map(key => (
                    <button
                      key={key}
                      onClick={() => setSectorSort(key)}
                      style={{
                        padding: "4px 8px", borderRadius: 3,
                        fontSize: 9, fontWeight: 600, fontFamily: "monospace",
                        border: `1px solid ${sectorSort === key ? "#3b82f6" : "#21262d"}`,
                        background: sectorSort === key ? "#3b82f6" : "transparent",
                        color: sectorSort === key ? "#fff" : "rgba(255,255,255,0.4)",
                        cursor: "pointer",
                      }}
                    >
                      {key === 'name' ? 'A-Z' : key === 'price' ? 'PRICE' : 'DATA'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Sector groups */}
              {sortedSectorNames.map(sector => {
                const stocks = sectorGroups[sector];
                if (!stocks || stocks.length === 0) return null;
                const isExpanded = expandedSectors.has(sector);
                const color = sectorColorMap[sector] || "#484f58";

                return (
                  <div key={sector} style={{ marginBottom: 2 }}>
                    {/* Sector header */}
                    <button
                      onClick={() => {
                        setExpandedSectors(prev => {
                          const next = new Set(prev);
                          if (next.has(sector)) next.delete(sector); else next.add(sector);
                          return next;
                        });
                      }}
                      style={{
                        width: "100%", display: "flex", alignItems: "center", gap: 8,
                        padding: "8px 10px",
                        background: isExpanded ? `${color}10` : "transparent",
                        border: "none",
                        borderBottom: `1px solid ${isExpanded ? color + "30" : "#21262d"}`,
                        cursor: "pointer",
                        borderRadius: isExpanded ? "4px 4px 0 0" : 4,
                      }}
                      onMouseEnter={e => { if (!isExpanded) e.currentTarget.style.background = "#161b2280"; }}
                      onMouseLeave={e => { if (!isExpanded) e.currentTarget.style.background = isExpanded ? `${color}10` : "transparent"; }}
                    >
                      <span style={{ width: 8, height: 8, borderRadius: "50%", background: color, flexShrink: 0 }} />
                      <span style={{ fontSize: 11, fontWeight: 700, fontFamily: "monospace", color: isExpanded ? color : "#fff", flex: 1, textAlign: "left" }}>
                        {sector}
                      </span>
                      <span style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", fontFamily: "monospace" }}>
                        {stocks.length}
                      </span>
                      <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", transition: "transform 0.15s", transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)" }}>
                        ▾
                      </span>
                    </button>

                    {/* Stock list within sector */}
                    {isExpanded && (
                      <div style={{ background: `${color}05`, borderLeft: `2px solid ${color}30`, marginBottom: 4, borderRadius: "0 0 4px 4px" }}>
                        {stocks.map(stock => (
                          <div
                            key={stock.ticker}
                            onClick={() => addTicker(stock.ticker)}
                            style={{
                              display: "flex", alignItems: "center", gap: 10,
                              padding: "6px 12px 6px 16px", cursor: "pointer",
                              borderBottom: "1px solid rgba(33,38,45,0.3)",
                              fontSize: 11, fontFamily: "monospace",
                            }}
                            onMouseEnter={e => (e.currentTarget.style.background = `${color}15`)}
                            onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                          >
                            <span style={{ fontWeight: 700, color: "#fff", minWidth: 60 }}>{stock.ticker}</span>
                            <span style={{ flex: 1, color: "rgba(255,255,255,0.5)", fontSize: 10, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {stock.name}
                            </span>
                            {stock.last_close > 0 && (
                              <span style={{ fontSize: 10, color: "rgba(255,255,255,0.45)", minWidth: 55, textAlign: "right" }}>
                                {stock.last_close > 100 ? stock.last_close.toFixed(0) : stock.last_close.toFixed(1)}
                              </span>
                            )}
                            <span style={{
                              fontSize: 8, padding: "1px 5px", borderRadius: 2,
                              background: stock.rows > 2000 ? "rgba(16,185,129,0.15)" : stock.rows > 500 ? "rgba(245,158,11,0.15)" : "rgba(239,68,68,0.1)",
                              color: stock.rows > 2000 ? "#10b981" : stock.rows > 500 ? "#f59e0b" : "#ef4444",
                              fontWeight: 600,
                            }}>
                              {stock.rows > 2000 ? 'A' : stock.rows > 500 ? 'B' : 'C'}
                            </span>
                            <span style={{ color: "#3b82f6", fontSize: 14, opacity: 0.5, lineHeight: 1 }}>+</span>
                          </div>
                        ))}
                        <button
                          onClick={() => {
                            const newTickers = stocks.filter(s => !selectedTickers.includes(s.ticker)).map(s => s.ticker);
                            setSelectedTickers(prev => [...prev, ...newTickers]);
                          }}
                          style={{
                            width: "100%", padding: "5px 16px",
                            background: "none", border: "none",
                            borderTop: `1px solid ${color}20`,
                            color, fontSize: 9, fontFamily: "monospace",
                            fontWeight: 600, cursor: "pointer", textAlign: "left",
                            letterSpacing: "0.05em",
                          }}
                          onMouseEnter={e => (e.currentTarget.style.background = `${color}10`)}
                          onMouseLeave={e => (e.currentTarget.style.background = "none")}
                        >
                          + ADD ALL {sector.toUpperCase()} ({stocks.length})
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Selected Tickers Chips */}
          {selectedTickers.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
              {selectedTickers.map(t => {
                const stock = availableStocks.find(s => s.ticker === t);
                const sectorColor = stock ? (sectorColorMap[stock.sector] || "#484f58") : "#484f58";
                return (
                  <span key={t} style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "5px 10px",
                    background: "#0d1117",
                    borderRadius: 5,
                    fontSize: 11,
                    fontFamily: "monospace",
                    fontWeight: 600,
                    border: "1px solid #30363d",
                    borderLeft: `3px solid ${sectorColor}`,
                  }}>
                    {t}
                    {stock && <span style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", fontWeight: 400 }}>{stock.name.slice(0, 12)}</span>}
                    <span
                      onClick={() => removeTicker(t)}
                      style={{ cursor: "pointer", color: "rgba(255,255,255,0.3)", fontSize: 12, lineHeight: 1, marginLeft: 2 }}
                      onMouseEnter={e => (e.currentTarget.style.color = "#ef4444")}
                      onMouseLeave={e => (e.currentTarget.style.color = "rgba(255,255,255,0.3)")}
                    >
                      ×
                    </span>
                  </span>
                );
              })}
              {selectedTickers.length > 0 && (
                <button
                  onClick={() => setSelectedTickers([])}
                  style={{
                    padding: "5px 10px", borderRadius: 5, fontSize: 9, fontFamily: "monospace",
                    background: "none", border: "1px dashed #30363d", color: "rgba(255,255,255,0.3)",
                    cursor: "pointer",
                  }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = "#ef4444"; e.currentTarget.style.color = "#ef4444"; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = "#30363d"; e.currentTarget.style.color = "rgba(255,255,255,0.3)"; }}
                >
                  Clear all
                </button>
              )}
            </div>
          )}
        </div>

        {/* Step 2: Strategy Configuration */}
        <div style={{ padding: "16px 20px", borderBottom: "1px solid #30363d" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
            <span style={{
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              width: 22, height: 22, borderRadius: "50%", background: "#10b981", color: "#fff",
              fontSize: 11, fontWeight: 800, fontFamily: "monospace",
            }}>2</span>
            <span style={{ fontSize: 13, fontWeight: 700, fontFamily: "monospace", color: "#fff" }}>Configure Strategy</span>
            <span style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", fontFamily: "monospace" }}>
              Choose optimization objective and parameters
            </span>
          </div>

          {/* Optimization Mode Cards */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 8, marginBottom: 14 }}>
            {([
              { key: "equal", label: "Equal Weight", desc: "1/N allocation across all assets", icon: "=" },
              { key: "min_variance", label: "Min Variance", desc: "Minimize portfolio volatility via Markowitz", icon: "▽" },
              { key: "max_sharpe", label: "Max Sharpe", desc: "Maximize risk-adjusted return using ML forecasts", icon: "△" },
              { key: "risk_parity", label: "Risk Parity", desc: "Equalize risk contribution per asset", icon: "⊜" },
              { key: "max_diversification", label: "Max Diversification", desc: "Maximize diversification ratio w/σ", icon: "◎" },
            ] as const).map(opt => {
              const isActive = mode === opt.key;
              const modeColor = ({ equal: "#9e9e9e", min_variance: "#3b82f6", max_sharpe: "#10b981", risk_parity: "#f59e0b", max_diversification: "#8b5cf6" } as Record<string, string>)[opt.key] || "#fff";
              return (
                <button
                  key={opt.key}
                  onClick={() => setMode(opt.key)}
                  style={{
                    padding: "12px 10px",
                    borderRadius: 6,
                    border: `1px solid ${isActive ? modeColor : "#30363d"}`,
                    background: isActive ? `${modeColor}15` : "#0d1117",
                    cursor: "pointer",
                    textAlign: "left",
                    transition: "all 0.15s ease",
                    position: "relative",
                    overflow: "hidden",
                  }}
                >
                  {isActive && <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: modeColor }} />}
                  <div style={{ fontSize: 16, marginBottom: 4, filter: isActive ? "none" : "grayscale(0.5)", opacity: isActive ? 1 : 0.5 }}>{opt.icon}</div>
                  <div style={{
                    fontSize: 10, fontWeight: 700, fontFamily: "monospace",
                    color: isActive ? modeColor : "rgba(255,255,255,0.7)",
                    marginBottom: 4,
                  }}>
                    {opt.label}
                  </div>
                  <div style={{ fontSize: 8, color: "rgba(255,255,255,0.35)", fontFamily: "monospace", lineHeight: 1.4 }}>
                    {opt.desc}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Parameters Row */}
          <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
            <div style={{ flex: "0 0 auto" }}>
              <div style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", fontFamily: "monospace", marginBottom: 4, letterSpacing: "0.05em" }}>
                PORTFOLIO VALUE (NOK)
              </div>
              <input
                type="number"
                value={portfolioValueNOK}
                onChange={e => setPortfolioValueNOK(Number(e.target.value))}
                style={{
                  width: 140, padding: "8px 10px", background: "#0d1117",
                  border: "1px solid #30363d", borderRadius: 5,
                  color: "#fff", fontSize: 12, fontFamily: "monospace", boxSizing: "border-box",
                }}
              />
            </div>
            <div style={{ flex: "0 0 auto" }}>
              <div style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", fontFamily: "monospace", marginBottom: 4, letterSpacing: "0.05em" }}>
                LOOKBACK WINDOW
              </div>
              <div style={{ display: "flex", gap: 3 }}>
                {[{ l: "1Y", v: 252, desc: "252 days" }, { l: "2Y", v: 504, desc: "504 days" }, { l: "3Y", v: 756, desc: "756 days" }].map(tf => (
                  <button key={tf.v} onClick={() => setLookbackDays(tf.v)} title={tf.desc} style={{
                    ...btnStyle(lookbackDays === tf.v), padding: "8px 12px", borderRadius: 5,
                  }}>
                    {tf.l}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ flex: "0 0 auto" }}>
              <div style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", fontFamily: "monospace", marginBottom: 4, letterSpacing: "0.05em" }}>
                MAX POSITION
              </div>
              <input
                type="text"
                inputMode="numeric"
                value={maxPosition > 0 ? String(Math.round(maxPosition * 100)) : ""}
                onChange={e => {
                  const raw = e.target.value.replace(/[^0-9]/g, "");
                  if (raw === "") { setMaxPosition(0); return; }
                  const num = Math.min(100, Math.max(0, parseInt(raw, 10)));
                  setMaxPosition(num / 100);
                }}
                onBlur={() => { if (maxPosition <= 0) setMaxPosition(0.20); }}
                placeholder="20"
                style={{
                  width: 70, padding: "8px 10px", background: "#0d1117",
                  border: "1px solid #30363d", borderRadius: 5,
                  color: "#fff", fontSize: 12, fontFamily: "monospace", boxSizing: "border-box",
                  textAlign: "center",
                }}
              />
              <span style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", fontFamily: "monospace", marginLeft: 4 }}>%</span>
            </div>
            <div style={{ flex: "0 0 auto" }}>
              <div style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", fontFamily: "monospace", marginBottom: 4, letterSpacing: "0.05em" }}>
                COVARIANCE METHOD
              </div>
              <div style={{ display: "flex", gap: 3 }}>
                {([
                  { key: "shrinkage", label: "SHRINKAGE", desc: "Ledoit-Wolf shrinkage toward diagonal" },
                  { key: "ewma", label: "EWMA", desc: "Exponentially weighted, λ=0.94" },
                  { key: "sample", label: "SAMPLE", desc: "Raw sample covariance matrix" },
                ] as const).map(cm => (
                  <button key={cm.key} onClick={() => setCovMethod(cm.key)} title={cm.desc} style={{
                    ...btnStyle(covMethod === cm.key), padding: "8px 8px", fontSize: 9, borderRadius: 5,
                  }}>
                    {cm.label}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ flex: "0 0 auto" }}>
              <div style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", fontFamily: "monospace", marginBottom: 4, letterSpacing: "0.05em" }}>
                ALLOCATION
              </div>
              <div style={{ display: "flex", gap: 3 }}>
                <button onClick={() => setForceIncludeAll(true)} title="All selected tickers get weight ≥ 1%" style={{
                  ...btnStyle(forceIncludeAll), padding: "8px 8px", fontSize: 9, borderRadius: 5,
                }}>
                  ALL INCLUDED
                </button>
                <button onClick={() => setForceIncludeAll(false)} title="Optimizer may exclude tickers (0% weight)" style={{
                  ...btnStyle(!forceIncludeAll), padding: "8px 8px", fontSize: 9, borderRadius: 5,
                }}>
                  ALLOW ZERO
                </button>
              </div>
            </div>
            <div style={{ flex: 1 }} />

            {/* Optimize Button */}
            <button
              onClick={() => runOptimization()}
              disabled={loading || selectedTickers.length < 2}
              style={{
                padding: "10px 32px",
                background: loading ? "#30363d" : selectedTickers.length < 2 ? "#21262d" : "linear-gradient(135deg, #3b82f6, #2563eb)",
                color: selectedTickers.length < 2 ? "rgba(255,255,255,0.3)" : "#fff",
                border: "none",
                borderRadius: 6,
                fontSize: 13,
                fontWeight: 700,
                fontFamily: "monospace",
                cursor: loading ? "wait" : selectedTickers.length < 2 ? "not-allowed" : "pointer",
                letterSpacing: "0.05em",
                boxShadow: selectedTickers.length >= 2 && !loading ? "0 2px 12px rgba(59,130,246,0.3)" : "none",
              }}
            >
              {loading ? "OPTIMIZING..." : "OPTIMIZE"}
            </button>
          </div>
        </div>

        {/* Step 3: Results Summary (only when results exist) */}
        {result && m ? (
          <div style={{ padding: "16px 20px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{
                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                  width: 22, height: 22, borderRadius: "50%", background: "#f59e0b", color: "#000",
                  fontSize: 11, fontWeight: 800, fontFamily: "monospace",
                }}>3</span>
                <span style={{ fontSize: 13, fontWeight: 700, fontFamily: "monospace", color: "#fff" }}>Results</span>
                <span style={{
                  padding: "2px 8px", borderRadius: 3, fontSize: 9, fontWeight: 600,
                  background: "rgba(245,158,11,0.15)", color: "#f59e0b", fontFamily: "monospace",
                  border: "1px solid rgba(245,158,11,0.3)",
                }}>
                  {MODE_LABELS[result.meta.mode]}
                </span>
              </div>

              {/* Save / Load Buttons */}
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                {showSaveForm ? (
                  <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                    <input
                      value={saveName}
                      onChange={e => setSaveName(e.target.value)}
                      placeholder="Portfolio name..."
                      autoFocus
                      onKeyDown={e => { if (e.key === "Enter" && saveName) saveConfig(); if (e.key === "Escape") setShowSaveForm(false); }}
                      style={{
                        padding: "6px 10px", background: "#0d1117", width: 180,
                        border: "1px solid #3b82f6", borderRadius: 5,
                        color: "#fff", fontSize: 11, fontFamily: "monospace",
                        outline: "none",
                      }}
                    />
                    <button
                      onClick={saveConfig}
                      disabled={!saveName}
                      style={{
                        ...btnStyle(true), padding: "6px 14px", borderRadius: 5,
                        opacity: saveName ? 1 : 0.4,
                      }}
                    >
                      Save
                    </button>
                    <button onClick={() => setShowSaveForm(false)} style={{ ...btnStyle(false), padding: "6px 8px", borderRadius: 5 }}>
                      ×
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowSaveForm(true)}
                    style={{
                      padding: "6px 14px", borderRadius: 5, fontSize: 10, fontWeight: 600,
                      fontFamily: "monospace", cursor: "pointer",
                      background: "none", border: "1px solid #30363d", color: "rgba(255,255,255,0.6)",
                    }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = "#3b82f6"; e.currentTarget.style.color = "#3b82f6"; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = "#30363d"; e.currentTarget.style.color = "rgba(255,255,255,0.6)"; }}
                  >
                    Save Portfolio
                  </button>
                )}
              </div>
            </div>

            {/* Key Metrics Strip */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 8 }}>
              {[
                { label: "Expected Return", value: `${(m.expectedReturn * 100).toFixed(1)}%`, color: m.expectedReturn >= 0 ? "#10b981" : "#ef4444", desc: "Annualized" },
                { label: "Volatility", value: `${(m.volatility * 100).toFixed(1)}%`, color: "#fff", desc: "Annualized σ" },
                { label: "Sharpe Ratio", value: m.sharpeRatio.toFixed(2), color: m.sharpeRatio >= 1 ? "#10b981" : m.sharpeRatio >= 0.5 ? "#f59e0b" : "#ef4444", desc: "(R-Rf)/σ" },
                { label: "VaR 95%", value: `${(m.var95 * 100).toFixed(1)}%`, color: "#ef4444", desc: "1-day loss" },
                { label: "Max Drawdown", value: `${(m.maxDrawdown * 100).toFixed(1)}%`, color: "#ef4444", desc: "Peak-to-trough" },
                { label: "Eff. Positions", value: m.effectivePositions.toFixed(1), color: m.effectivePositions >= 3 ? "#10b981" : "#f59e0b", desc: `HHI ${(m.herfindahlIndex * 100).toFixed(0)}` },
              ].map(item => (
                <div key={item.label} style={{
                  padding: "10px 12px", borderRadius: 5,
                  background: "#0d1117", border: "1px solid #30363d",
                }}>
                  <div style={{ fontSize: 8, color: "rgba(255,255,255,0.4)", fontFamily: "monospace", letterSpacing: "0.05em", marginBottom: 2 }}>
                    {item.label}
                  </div>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                    <span style={{ fontSize: 18, fontWeight: 800, fontFamily: "monospace", color: item.color }}>
                      {item.value}
                    </span>
                    <span style={{ fontSize: 8, color: "rgba(255,255,255,0.25)", fontFamily: "monospace" }}>
                      {item.desc}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            {/* Additional metrics row */}
            <div style={{ display: "flex", gap: 16, marginTop: 8, fontSize: 10, fontFamily: "monospace", color: "rgba(255,255,255,0.4)", flexWrap: "wrap" }}>
              <span>Sortino: <span style={{ color: "rgba(255,255,255,0.7)", fontWeight: 600 }}>{m.sortinoRatio.toFixed(2)}</span></span>
              <span>CVaR 99%: <span style={{ color: "#ef4444", fontWeight: 600 }}>{(m.cvar99 * 100).toFixed(1)}%</span></span>
              <span>Beta to OBX: <span style={{ color: "rgba(255,255,255,0.7)", fontWeight: 600 }}>{m.betaToOBX.toFixed(2)}</span></span>
              <span>Tracking Error: <span style={{ color: "rgba(255,255,255,0.7)", fontWeight: 600 }}>{(m.trackingError * 100).toFixed(1)}%</span></span>
              <span>Diversification: <span style={{ color: "rgba(255,255,255,0.7)", fontWeight: 600 }}>{m.diversificationRatio.toFixed(2)}</span></span>
              <span style={{ marginLeft: "auto", color: "rgba(255,255,255,0.25)" }}>
                {result.meta.commonDates} days · {result.meta.covarianceMethod}{result.meta.shrinkageIntensity !== undefined ? ` (δ=${result.meta.shrinkageIntensity.toFixed(3)})` : ""} · Rf {(result.meta.riskFreeRate * 100).toFixed(1)}%
              </span>
            </div>
          </div>
        ) : (
          <div style={{ padding: "20px", textAlign: "center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, justifyContent: "center" }}>
              <span style={{
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                width: 22, height: 22, borderRadius: "50%", background: "#30363d", color: "rgba(255,255,255,0.4)",
                fontSize: 11, fontWeight: 800, fontFamily: "monospace",
              }}>3</span>
              <span style={{ fontSize: 12, color: "rgba(255,255,255,0.3)", fontFamily: "monospace" }}>
                {selectedTickers.length < 2
                  ? "Select at least 2 assets to begin optimization"
                  : "Click OPTIMIZE to compute optimal weights, risk metrics, and ML signals"
                }
              </span>
            </div>
          </div>
        )}

        {error && (
          <div style={{ padding: "8px 20px 12px", color: "#ef4444", fontSize: 11, fontFamily: "monospace" }}>
            {error}
          </div>
        )}
      </div>

      {/* === OPTIMAL WEIGHTS STRIP === */}
      {result && m && (
        <div style={{
          display: "flex", alignItems: "center", gap: 12, padding: "10px 16px",
          marginBottom: 12, borderRadius: 6,
          background: "linear-gradient(135deg, rgba(59,130,246,0.06) 0%, rgba(16,185,129,0.06) 100%)",
          border: "1px solid rgba(59,130,246,0.2)",
        }}>
          <div style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", fontFamily: "monospace", letterSpacing: "0.05em", whiteSpace: "nowrap" }}>
            WEIGHTS
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", flex: 1 }}>
            {result.weights.filter(w => w.weight > 0.005).sort((a, b) => b.weight - a.weight).map(w => (
              <div key={w.ticker} style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
                <span style={{ fontSize: 12, fontWeight: 800, fontFamily: "monospace", color: "#3b82f6" }}>
                  {w.ticker}
                </span>
                <span style={{ fontSize: 11, fontWeight: 600, fontFamily: "monospace", color: "rgba(255,255,255,0.7)" }}>
                  {(w.weight * 100).toFixed(1)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* === CONSTRAINT ADJUSTMENT WARNING === */}
      {result && result.meta.constraintAdjusted && (
        <div style={{
          padding: "8px 14px", borderRadius: 4, marginBottom: 8,
          background: "rgba(245,158,11,0.08)", borderLeft: "3px solid #f59e0b",
          fontSize: 11, fontFamily: "monospace", color: "#f59e0b",
          display: "flex", alignItems: "center", gap: 8,
        }}>
          <span style={{ fontWeight: 700, fontSize: 10, textTransform: "uppercase", minWidth: 60 }}>ADJUSTED</span>
          Max position raised from {((result.meta.originalMaxPosition ?? 0) * 100).toFixed(0)}% to {((result.meta.effectiveMaxPosition ?? 0) * 100).toFixed(0)}% — {selectedTickers.length} tickers require at least {(100 / selectedTickers.length).toFixed(1)}% each for full investment.
          {" "}Use &quot;ALLOW ZERO&quot; to keep strict position limits.
        </div>
      )}

      {/* === RISK ALERTS === */}
      {result && result.riskAlerts && result.riskAlerts.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 16 }}>
          {result.riskAlerts.map((alert, i) => {
            const colors = ALERT_COLORS[alert.level];
            return (
              <div key={i} style={{
                padding: "8px 14px",
                borderRadius: 4,
                background: colors.bg,
                borderLeft: `3px solid ${colors.border}`,
                fontSize: 11,
                fontFamily: "monospace",
                color: colors.text,
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}>
                <span style={{ fontWeight: 700, fontSize: 10, textTransform: "uppercase", minWidth: 60 }}>
                  {alert.level}
                </span>
                {alert.message}
              </div>
            );
          })}
        </div>
      )}

      {/* === MODE COMPARISON === */}
      {result && result.modeComparison && (() => {
        const MODE_COLORS: Record<string, string> = {
          equal: "#9e9e9e", min_variance: "#3b82f6", max_sharpe: "#10b981",
          risk_parity: "#f59e0b", max_diversification: "#8b5cf6",
        };
        const entries = Object.entries(result.modeComparison);
        const highlightedMode = hoveredMode || result.meta.mode;
        // Normalize for radar: scale each metric to 0-100 based on range across modes
        const allSharpes = entries.map(([, mc]) => mc.mlSharpe);
        const allReturns = entries.map(([, mc]) => mc.mlExpectedReturn * 100);
        const allStability = entries.map(([, mc]) => (1 - mc.maxDrawdown) * 100);
        const allDiv = entries.map(([, mc]) => mc.diversificationRatio);
        const allPos = entries.map(([, mc]) => mc.effectivePositions);
        const norm = (v: number, arr: number[]) => {
          const mn = Math.min(...arr); const mx = Math.max(...arr);
          return mx > mn ? ((v - mn) / (mx - mn)) * 80 + 20 : 50;
        };
        const radarData = [
          { metric: "Return", ...Object.fromEntries(entries.map(([k, mc]) => [k, norm(mc.mlExpectedReturn * 100, allReturns)])) },
          { metric: "Sharpe", ...Object.fromEntries(entries.map(([k, mc]) => [k, norm(mc.mlSharpe, allSharpes)])) },
          { metric: "Stability", ...Object.fromEntries(entries.map(([k, mc]) => [k, norm((1 - mc.maxDrawdown) * 100, allStability)])) },
          { metric: "Diversification", ...Object.fromEntries(entries.map(([k, mc]) => [k, norm(mc.diversificationRatio, allDiv)])) },
          { metric: "Breadth", ...Object.fromEntries(entries.map(([k, mc]) => [k, norm(mc.effectivePositions, allPos)])) },
        ];
        const hlColor = MODE_COLORS[highlightedMode] || "#fff";
        const hlMetrics = result.modeComparison[highlightedMode];
        return (
          <div style={{ ...cardStyle, marginBottom: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
              <div style={sectionTitle}>Strategy Comparison — All Optimization Modes</div>
              <span style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", fontFamily: "monospace" }}>
                Hover to preview · Click to switch
              </span>
            </div>
            <div style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", fontFamily: "monospace", marginBottom: 12 }}>
              ML Return uses XGB/LGBM forward predictions. Hist. metrics use backward-looking data. Max Sharpe optimizes for ML Sharpe.
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 16 }}>
              {/* Radar Chart — responds to hoveredMode */}
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                <ResponsiveContainer width="100%" height={260}>
                  <RadarChart data={radarData} cx="50%" cy="50%" outerRadius="75%">
                    <PolarGrid stroke="#30363d" />
                    <PolarAngleAxis dataKey="metric" tick={{ fontSize: 9, fill: "rgba(255,255,255,0.5)", fontFamily: "monospace" }} />
                    <PolarRadiusAxis tick={false} domain={[0, 100]} axisLine={false} />
                    {/* Render non-highlighted modes first (behind) */}
                    {entries.filter(([key]) => key !== highlightedMode).map(([key]) => (
                      <Radar key={key} name={MODE_LABELS[key] || key} dataKey={key}
                        stroke={MODE_COLORS[key] || "#fff"} fill={MODE_COLORS[key] || "#fff"}
                        fillOpacity={0.02}
                        strokeWidth={0.8}
                        strokeDasharray="4 3"
                        strokeOpacity={0.4}
                      />
                    ))}
                    {/* Highlighted mode on top */}
                    <Radar key={highlightedMode} name={MODE_LABELS[highlightedMode] || highlightedMode} dataKey={highlightedMode}
                      stroke={hlColor} fill={hlColor}
                      fillOpacity={0.25}
                      strokeWidth={2.5}
                    />
                  </RadarChart>
                </ResponsiveContainer>
                {/* Hovered mode summary under radar */}
                <div style={{ textAlign: "center", marginTop: 4, minHeight: 36 }}>
                  <div style={{ fontSize: 12, fontWeight: 800, fontFamily: "monospace", color: hlColor }}>
                    {MODE_LABELS[highlightedMode] || highlightedMode}
                    {highlightedMode === result.meta.mode && <span style={{ fontSize: 8, marginLeft: 4, opacity: 0.7 }}>ACTIVE</span>}
                  </div>
                  {hlMetrics && (
                    <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 2, fontSize: 9, fontFamily: "monospace" }}>
                      <span style={{ color: hlMetrics.mlExpectedReturn >= 0 ? "#10b981" : "#ef4444" }}>
                        Ret {(hlMetrics.mlExpectedReturn * 100).toFixed(1)}%
                      </span>
                      <span style={{ color: "rgba(255,255,255,0.5)" }}>
                        Vol {(hlMetrics.volatility * 100).toFixed(1)}%
                      </span>
                      <span style={{ color: hlMetrics.mlSharpe >= 1 ? "#10b981" : "#f59e0b" }}>
                        SR {hlMetrics.mlSharpe.toFixed(2)}
                      </span>
                      <span style={{ color: "#ef4444" }}>
                        DD {(hlMetrics.maxDrawdown * 100).toFixed(1)}%
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* Table — hover highlights radar, click switches */}
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, fontFamily: "monospace" }}>
                  <thead>
                    <tr>
                      {[
                        { h: "Mode", align: "left" },
                        { h: "Hist. Return", align: "right" },
                        { h: "ML Return", align: "right" },
                        { h: "Vol", align: "right" },
                        { h: "Hist. Sharpe", align: "right" },
                        { h: "ML Sharpe", align: "right" },
                        { h: "Sortino", align: "right" },
                        { h: "VaR 95%", align: "right" },
                        { h: "Max DD", align: "right" },
                        { h: "Eff. Pos", align: "right" },
                      ].map(col => (
                        <th key={col.h} style={{
                          padding: "8px 6px", textAlign: col.align as "left" | "right",
                          borderBottom: "1px solid #30363d", color: "rgba(255,255,255,0.5)", fontSize: 9,
                          fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", whiteSpace: "nowrap",
                        }}>{col.h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map(([modeKey, mc]) => {
                      const isActive = modeKey === result.meta.mode;
                      const isHovered = modeKey === hoveredMode;
                      const mColor = MODE_COLORS[modeKey] || "#fff";
                      return (
                        <tr
                          key={modeKey}
                          onClick={() => { if (!isActive && !loading) { setMode(modeKey); runOptimization(modeKey); } }}
                          onMouseEnter={() => setHoveredMode(modeKey)}
                          onMouseLeave={() => setHoveredMode(null)}
                          style={{
                            borderBottom: "1px solid #30363d",
                            background: isHovered ? `${mColor}15` : isActive ? `${mColor}10` : "transparent",
                            cursor: isActive ? "default" : "pointer",
                            transition: "background 0.1s ease",
                          }}
                        >
                          <td style={{ padding: "6px 6px", fontWeight: 700 }}>
                            <span style={{
                              display: "inline-block", width: 4, height: 14,
                              background: mColor, borderRadius: 2, marginRight: 6, verticalAlign: "middle",
                              boxShadow: isHovered ? `0 0 8px ${mColor}60` : "none",
                            }} />
                            <span style={{ color: isActive || isHovered ? mColor : "#fff" }}>
                              {MODE_LABELS[modeKey] || modeKey}
                            </span>
                            {isActive && <span style={{ fontSize: 8, color: mColor, marginLeft: 4, fontWeight: 800 }}>ACTIVE</span>}
                          </td>
                          <td style={{ padding: "6px 6px", textAlign: "right", color: mc.expectedReturn >= 0 ? "#10b981" : "#ef4444" }}>
                            {(mc.expectedReturn * 100).toFixed(1)}%
                          </td>
                          <td style={{ padding: "6px 6px", textAlign: "right", fontWeight: 700, color: mc.mlExpectedReturn >= 0 ? "#10b981" : "#ef4444" }}>
                            {(mc.mlExpectedReturn * 100).toFixed(1)}%
                          </td>
                          <td style={{ padding: "6px 6px", textAlign: "right" }}>{(mc.volatility * 100).toFixed(1)}%</td>
                          <td style={{ padding: "6px 6px", textAlign: "right", color: "rgba(255,255,255,0.5)" }}>
                            {mc.sharpeRatio.toFixed(2)}
                          </td>
                          <td style={{
                            padding: "6px 6px", textAlign: "right", fontWeight: 700,
                            color: mc.mlSharpe >= 1 ? "#10b981" : mc.mlSharpe >= 0.5 ? "#f59e0b" : "#ef4444",
                          }}>{mc.mlSharpe.toFixed(2)}</td>
                          <td style={{ padding: "6px 6px", textAlign: "right" }}>{mc.sortinoRatio.toFixed(2)}</td>
                          <td style={{ padding: "6px 6px", textAlign: "right", color: "#ef4444" }}>{(mc.var95 * 100).toFixed(1)}%</td>
                          <td style={{ padding: "6px 6px", textAlign: "right", color: "#ef4444" }}>{(mc.maxDrawdown * 100).toFixed(1)}%</td>
                          <td style={{ padding: "6px 6px", textAlign: "right" }}>{mc.effectivePositions.toFixed(1)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {loading && (
                  <div style={{
                    padding: "8px 0", textAlign: "center", fontSize: 10, fontFamily: "monospace",
                    color: "#3b82f6", letterSpacing: "0.1em",
                  }}>
                    Switching strategy...
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Results sections — dimmed during strategy switch */}
      <div style={{ opacity: loading && result ? 0.4 : 1, transition: "opacity 0.3s ease", pointerEvents: loading && result ? "none" : "auto" }}>

      {/* === PORTFOLIO ALPHA INTELLIGENCE === */}
      {result && result.holdingSignals && result.holdingSignals.length > 0 && (() => {
        const signals = result.holdingSignals
          .filter(s => { const w = result.weights.find(w => w.ticker === s.ticker); return w && w.weight > 0.001; })
          .sort((a, b) => {
            const wa = result.weights.find(w => w.ticker === a.ticker)?.weight ?? 0;
            const wb = result.weights.find(w => w.ticker === b.ticker)?.weight ?? 0;
            return wb - wa;
          });
        const total = signals.length;

        // Portfolio-level weighted alpha score
        const avgCombined = signals.reduce((sum, s) => {
          const w = result.weights.find(w => w.ticker === s.ticker)?.weight ?? 0;
          return sum + w * (s.combinedSignal?.combined_signal ?? s.conviction ?? 0);
        }, 0);

        const signalDist = {
          strongBuy: signals.filter(s => (s.combinedSignal?.classification ?? s.mlSignal) === "Strong Buy").length,
          buy: signals.filter(s => (s.combinedSignal?.classification ?? s.mlSignal) === "Buy").length,
          hold: signals.filter(s => { const c = s.combinedSignal?.classification ?? s.mlSignal; return c === "Hold" || c === "N/A"; }).length,
          sell: signals.filter(s => (s.combinedSignal?.classification ?? s.mlSignal) === "Sell").length,
          strongSell: signals.filter(s => (s.combinedSignal?.classification ?? s.mlSignal) === "Strong Sell").length,
        };
        const bullishPct = (signalDist.strongBuy + signalDist.buy) / total * 100;

        let alphaLabel = "Neutral";
        let alphaColor = "#9e9e9e";
        if (avgCombined > 0.35) { alphaLabel = "Strong Bullish"; alphaColor = "#00c853"; }
        else if (avgCombined > 0.12) { alphaLabel = "Bullish"; alphaColor = "#4caf50"; }
        else if (avgCombined > -0.12) { alphaLabel = "Neutral"; alphaColor = "#ff9800"; }
        else if (avgCombined > -0.35) { alphaLabel = "Bearish"; alphaColor = "#ef5350"; }
        else { alphaLabel = "Strong Bearish"; alphaColor = "#d50000"; }

        return (
          <div style={{ marginBottom: 20 }}>
            {/* ── Alpha Score Hero ── */}
            <div style={{
              ...cardStyle, marginBottom: 12, padding: 20,
              background: `linear-gradient(135deg, ${alphaColor}12 0%, #161b22 50%, ${alphaColor}08 100%)`,
              borderLeft: `3px solid ${alphaColor}`,
            }}>
              <div style={{ display: "grid", gridTemplateColumns: "180px 1fr 1fr", gap: 24, alignItems: "center" }}>
                {/* Score Gauge */}
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", fontFamily: "monospace", letterSpacing: "0.1em", marginBottom: 6 }}>
                    PORTFOLIO ALPHA
                  </div>
                  <div style={{ fontSize: 40, fontWeight: 800, fontFamily: "monospace", color: alphaColor, lineHeight: 1 }}>
                    {avgCombined > 0 ? "+" : ""}{avgCombined.toFixed(2)}
                  </div>
                  <div style={{ fontSize: 11, fontWeight: 700, fontFamily: "monospace", color: alphaColor, marginTop: 4, letterSpacing: "0.08em" }}>
                    {alphaLabel.toUpperCase()}
                  </div>
                  {/* Gauge bar */}
                  <div style={{ marginTop: 10, height: 6, background: "#21262d", borderRadius: 3, position: "relative", overflow: "hidden" }}>
                    <div style={{
                      position: "absolute",
                      left: avgCombined >= 0 ? "50%" : `${(0.5 + avgCombined / 2) * 100}%`,
                      top: 0, bottom: 0,
                      width: `${Math.abs(avgCombined) * 50}%`,
                      background: `linear-gradient(${avgCombined >= 0 ? "90deg" : "270deg"}, ${alphaColor}60, ${alphaColor})`,
                      borderRadius: 3,
                    }} />
                    <div style={{ position: "absolute", left: "50%", top: -1, bottom: -1, width: 1, background: "rgba(255,255,255,0.25)" }} />
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 8, color: "rgba(255,255,255,0.25)", fontFamily: "monospace", marginTop: 2 }}>
                    <span>SELL</span><span>HOLD</span><span>BUY</span>
                  </div>
                </div>

                {/* Signal Distribution */}
                <div>
                  <div style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", fontFamily: "monospace", letterSpacing: "0.1em", marginBottom: 8 }}>
                    SIGNAL DISTRIBUTION
                  </div>
                  <div style={{ display: "flex", height: 28, borderRadius: 5, overflow: "hidden", marginBottom: 8, border: "1px solid #30363d" }}>
                    {signalDist.strongBuy > 0 && <div style={{ flex: signalDist.strongBuy, background: "linear-gradient(180deg, #00e676, #00c853)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 800, color: "#fff" }}>{signalDist.strongBuy}</div>}
                    {signalDist.buy > 0 && <div style={{ flex: signalDist.buy, background: "linear-gradient(180deg, #66bb6a, #4caf50)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 800, color: "#fff" }}>{signalDist.buy}</div>}
                    {signalDist.hold > 0 && <div style={{ flex: signalDist.hold, background: "linear-gradient(180deg, #bdbdbd, #9e9e9e)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 800, color: "#fff" }}>{signalDist.hold}</div>}
                    {signalDist.sell > 0 && <div style={{ flex: signalDist.sell, background: "linear-gradient(180deg, #ef5350, #e53935)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 800, color: "#fff" }}>{signalDist.sell}</div>}
                    {signalDist.strongSell > 0 && <div style={{ flex: signalDist.strongSell, background: "linear-gradient(180deg, #ff1744, #d50000)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 800, color: "#fff" }}>{signalDist.strongSell}</div>}
                  </div>
                  <div style={{ display: "flex", gap: 10, fontSize: 9, fontFamily: "monospace", flexWrap: "wrap" }}>
                    {signalDist.strongBuy > 0 && <span style={{ color: "#00c853" }}>Strong Buy {signalDist.strongBuy}</span>}
                    {signalDist.buy > 0 && <span style={{ color: "#4caf50" }}>Buy {signalDist.buy}</span>}
                    {signalDist.hold > 0 && <span style={{ color: "#9e9e9e" }}>Hold {signalDist.hold}</span>}
                    {signalDist.sell > 0 && <span style={{ color: "#ef5350" }}>Sell {signalDist.sell}</span>}
                    {signalDist.strongSell > 0 && <span style={{ color: "#d50000" }}>Strong Sell {signalDist.strongSell}</span>}
                  </div>
                  <div style={{ marginTop: 8, fontSize: 11, fontFamily: "monospace" }}>
                    <span style={{ fontWeight: 700, color: "#4caf50" }}>{bullishPct.toFixed(0)}%</span>
                    <span style={{ color: "rgba(255,255,255,0.5)" }}> of holdings are bullish</span>
                  </div>
                </div>

                {/* Quick Metrics */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  {[
                    { label: "AVG ML RETURN", value: `${(signals.reduce((s, sig) => s + sig.mlReturn, 0) / total * 100).toFixed(1)}%`, color: signals.reduce((s, sig) => s + sig.mlReturn, 0) / total > 0 ? "#10b981" : "#ef4444" },
                    { label: "BULLISH MOM", value: `${signals.filter(s => s.momentumSignal === "Bullish").length}/${total}`, color: "#4caf50" },
                    { label: "CHEAP STOCKS", value: `${signals.filter(s => s.valuationSignal === "Cheap").length}/${total}`, color: "#f59e0b" },
                    { label: "IN DRAWDOWN", value: `${signals.filter(s => s.currentDrawdown > 0.05).length}/${total}`, color: signals.filter(s => s.currentDrawdown > 0.05).length > total / 2 ? "#ef4444" : "#10b981" },
                  ].map(item => (
                    <div key={item.label} style={{ padding: "8px 10px", borderRadius: 4, background: "#0d1117", border: "1px solid #30363d" }}>
                      <div style={{ fontSize: 8, color: "rgba(255,255,255,0.4)", fontFamily: "monospace", letterSpacing: "0.05em", marginBottom: 2 }}>{item.label}</div>
                      <div style={{ fontSize: 16, fontWeight: 800, fontFamily: "monospace", color: item.color }}>{item.value}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* ── Holdings Signal Cards ── */}
            <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(signals.length, 3)}, 1fr)`, gap: 12 }}>
              {signals.map(sig => {
                const w = result.weights.find(w => w.ticker === sig.ticker);
                const weight = w?.weight ?? 0;
                const combined = sig.combinedSignal?.combined_signal ?? sig.conviction ?? 0;
                const classification = sig.combinedSignal?.classification ?? sig.mlSignal;
                const classColor = SIGNAL_COLORS[classification] || "#616161";

                // Component signals
                const components = sig.combinedSignal?.component_signals ?? {};
                const weightsUsed = sig.combinedSignal?.weights_used ?? {};
                const componentList = [
                  { key: "ml", label: "ML", value: components["ml"] ?? (sig.mlReturn > 0 ? Math.min(1, sig.mlReturn * 10) : Math.max(-1, sig.mlReturn * 10)), color: "#3b82f6", available: (weightsUsed["ml"] ?? 0) > 0 || !sig.combinedSignal },
                  { key: "momentum", label: "MOM", value: components["momentum"] ?? (sig.momentumSignal === "Bullish" ? 0.6 : sig.momentumSignal === "Bearish" ? -0.6 : 0), color: "#10b981", available: (weightsUsed["momentum"] ?? 0) > 0 || !sig.combinedSignal },
                  { key: "valuation", label: "VAL", value: components["valuation"] ?? (sig.valuationSignal === "Cheap" ? 0.5 : sig.valuationSignal === "Expensive" ? -0.5 : 0), color: "#f59e0b", available: (weightsUsed["valuation"] ?? 0) > 0 || !sig.combinedSignal },
                  { key: "cluster", label: "CLU", value: components["cluster"] ?? (sig.cluster ? -sig.cluster.z_score / 3 : 0), color: "#8b5cf6", available: (weightsUsed["cluster"] ?? 0) > 0 },
                  { key: "regime", label: "REG", value: components["regime"] ?? 0, color: "#06b6d4", available: (weightsUsed["regime"] ?? 0) > 0 },
                  { key: "cnn", label: "CNN", value: components["cnn"] ?? 0, color: "#ec4899", available: (weightsUsed["cnn"] ?? 0) > 0 },
                ];

                return (
                  <div key={sig.ticker} style={{
                    ...cardStyle, padding: 0, overflow: "hidden",
                    borderTop: `3px solid ${classColor}`,
                  }}>
                    {/* Card Header */}
                    <div style={{
                      display: "flex", justifyContent: "space-between", alignItems: "center",
                      padding: "10px 14px", background: `${classColor}08`,
                    }}>
                      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                        <Link href={`/stocks/${sig.ticker}`} style={{ fontSize: 16, fontWeight: 800, fontFamily: "monospace", color: "#fff", textDecoration: "none" }}>
                          {sig.ticker}
                        </Link>
                        <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", fontFamily: "monospace" }}>
                          {(weight * 100).toFixed(1)}%
                        </span>
                      </div>
                      <span style={{
                        padding: "3px 12px", borderRadius: 4, fontSize: 10, fontWeight: 700,
                        background: classColor, color: "#fff", fontFamily: "monospace", letterSpacing: "0.05em",
                      }}>
                        {classification}
                      </span>
                    </div>

                    <div style={{ padding: "10px 14px 14px" }}>
                      {/* Combined Signal Bar */}
                      <div style={{ marginBottom: 14 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: "rgba(255,255,255,0.4)", fontFamily: "monospace", marginBottom: 4 }}>
                          <span>COMBINED SIGNAL</span>
                          <span style={{ color: classColor, fontWeight: 800, fontSize: 11 }}>
                            {combined > 0 ? "+" : ""}{combined.toFixed(2)}
                          </span>
                        </div>
                        <div style={{ height: 12, background: "#0d1117", borderRadius: 6, position: "relative", overflow: "hidden", border: "1px solid #21262d" }}>
                          {/* Background gradient track */}
                          <div style={{
                            position: "absolute", left: 0, right: 0, top: 0, bottom: 0,
                            background: "linear-gradient(90deg, #d50000 0%, #ef5350 20%, #424242 50%, #4caf50 80%, #00c853 100%)",
                            opacity: 0.12,
                          }} />
                          {/* Signal fill */}
                          <div style={{
                            position: "absolute",
                            left: combined >= 0 ? "50%" : `${(0.5 + combined / 2) * 100}%`,
                            top: 1, bottom: 1,
                            width: `${Math.abs(combined) / 2 * 100}%`,
                            background: `linear-gradient(${combined >= 0 ? "90deg" : "270deg"}, ${classColor}80, ${classColor})`,
                            borderRadius: 5,
                            boxShadow: `0 0 10px ${classColor}40`,
                          }} />
                          {/* Center line */}
                          <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 1, background: "rgba(255,255,255,0.15)" }} />
                        </div>
                      </div>

                      {/* Component Signal Breakdown */}
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 3, marginBottom: 12 }}>
                        {componentList.map(comp => {
                          const val = comp.value;
                          const isAvailable = comp.available;
                          const intensity = isAvailable ? Math.min(1, Math.abs(val)) : 0;
                          const dotColor = !isAvailable ? "#30363d" : val > 0.15 ? "#4caf50" : val < -0.15 ? "#ef5350" : "#616161";
                          return (
                            <div key={comp.key} style={{
                              display: "flex", alignItems: "center", gap: 4,
                              padding: "4px 6px", borderRadius: 3,
                              background: "#0d1117",
                              opacity: isAvailable ? 1 : 0.4,
                            }}>
                              <div style={{
                                width: 7, height: 7, borderRadius: "50%",
                                background: dotColor,
                                boxShadow: intensity > 0.3 ? `0 0 6px ${dotColor}80` : "none",
                              }} />
                              <span style={{ fontSize: 8, fontFamily: "monospace", color: "rgba(255,255,255,0.4)" }}>{comp.label}</span>
                              <span style={{ fontSize: 8, fontFamily: "monospace", color: isAvailable ? dotColor : "#30363d", fontWeight: 700, marginLeft: "auto" }}>
                                {isAvailable ? `${val > 0 ? "+" : ""}${val.toFixed(2)}` : "—"}
                              </span>
                            </div>
                          );
                        })}
                      </div>

                      {/* Tags Row */}
                      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 8 }}>
                        <span style={{
                          padding: "2px 7px", borderRadius: 3, fontSize: 9, fontWeight: 600, fontFamily: "monospace",
                          background: `${SIGNAL_COLORS[sig.momentumSignal]}18`, color: SIGNAL_COLORS[sig.momentumSignal],
                          border: `1px solid ${SIGNAL_COLORS[sig.momentumSignal]}30`,
                        }}>{sig.momentumSignal}</span>
                        <span style={{
                          padding: "2px 7px", borderRadius: 3, fontSize: 9, fontWeight: 600, fontFamily: "monospace",
                          background: `${SIGNAL_COLORS[sig.valuationSignal]}18`, color: SIGNAL_COLORS[sig.valuationSignal],
                          border: `1px solid ${SIGNAL_COLORS[sig.valuationSignal]}30`,
                        }}>{sig.valuationSignal}</span>
                        {sig.mlReturn !== 0 && (
                          <span style={{
                            padding: "2px 7px", borderRadius: 3, fontSize: 9, fontWeight: 600, fontFamily: "monospace",
                            background: sig.mlReturn > 0 ? "rgba(76,175,80,0.12)" : "rgba(244,67,54,0.12)",
                            color: sig.mlReturn > 0 ? "#4caf50" : "#ef5350",
                            border: `1px solid ${sig.mlReturn > 0 ? "rgba(76,175,80,0.3)" : "rgba(244,67,54,0.3)"}`,
                          }}>ML {sig.mlReturn > 0 ? "+" : ""}{(sig.mlReturn * 100).toFixed(1)}%</span>
                        )}
                        {sig.beta > 1.2 && (
                          <span style={{
                            padding: "2px 7px", borderRadius: 3, fontSize: 9, fontWeight: 600, fontFamily: "monospace",
                            background: "rgba(255,152,0,0.12)", color: "#f59e0b", border: "1px solid rgba(255,152,0,0.3)",
                          }}>β {sig.beta.toFixed(1)}</span>
                        )}
                      </div>

                      {/* VAL Breakdown — sector z-scores */}
                      {sig.valuation.zScores && (
                        <div style={{ marginBottom: 8, padding: "6px 8px", background: "rgba(245,158,11,0.04)", borderRadius: 4, border: "1px solid rgba(245,158,11,0.12)" }}>
                          <div style={{ fontSize: 8, fontFamily: "monospace", color: "rgba(255,255,255,0.4)", letterSpacing: "0.05em", marginBottom: 4 }}>
                            VAL PEER Z-SCORES <span style={{ color: "rgba(255,255,255,0.25)" }}>vs sector</span>
                          </div>
                          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 3 }}>
                            {([
                              { key: "ep" as const, label: "E/P", invert: false },
                              { key: "bm" as const, label: "P/B", invert: false },
                              { key: "dy" as const, label: "DY", invert: false },
                              { key: "ev_ebitda" as const, label: "EV/EB", invert: true },
                              { key: "sp" as const, label: "S/P", invert: false },
                            ]).map(metric => {
                              const z = sig.valuation.zScores?.[metric.key];
                              const raw = sig.valuation[metric.key];
                              const hasData = z != null && z !== 0;
                              // For most metrics, positive z = cheap (good). For EV/EBITDA, negative z = cheap.
                              const effectiveZ = hasData ? (metric.invert ? -(z as number) : (z as number)) : 0;
                              const zColor = !hasData ? "#30363d" : effectiveZ > 0.5 ? "#4caf50" : effectiveZ < -0.5 ? "#ef5350" : "#9e9e9e";
                              return (
                                <div key={metric.key} style={{ textAlign: "center" }}>
                                  <div style={{ fontSize: 7, fontFamily: "monospace", color: "rgba(255,255,255,0.35)", marginBottom: 1 }}>{metric.label}</div>
                                  <div style={{ fontSize: 10, fontWeight: 700, fontFamily: "monospace", color: zColor }}>
                                    {hasData ? `${effectiveZ > 0 ? "+" : ""}${effectiveZ.toFixed(1)}` : "—"}
                                  </div>
                                  {raw != null && raw !== 0 && (
                                    <div style={{ fontSize: 7, fontFamily: "monospace", color: "rgba(255,255,255,0.25)" }}>
                                      {metric.key === "ev_ebitda" ? `${raw.toFixed(1)}×` : metric.key === "dy" ? `${(raw * 100).toFixed(1)}%` : raw.toFixed(2)}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Drawdown + Alert */}
                      {(sig.currentDrawdown > 0.03 || sig.alerts.length > 0) && (
                        <div style={{ fontSize: 9, fontFamily: "monospace", color: "#ffb74d", padding: "4px 8px", background: "rgba(255,152,0,0.06)", borderRadius: 3, border: "1px solid rgba(255,152,0,0.15)" }}>
                          {sig.currentDrawdown > 0.03 ? `${(sig.currentDrawdown * 100).toFixed(1)}% drawdown` : ""}
                          {sig.currentDrawdown > 0.03 && sig.alerts.length > 0 ? " · " : ""}
                          {sig.alerts.length > 0 ? sig.alerts[0] : ""}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Signal Guide */}
            <div style={{ marginTop: 8 }}>
              <div
                onClick={() => setShowSignalGuide(!showSignalGuide)}
                style={{ display: "flex", gap: 14, fontSize: 8, color: "rgba(255,255,255,0.35)", fontFamily: "monospace", flexWrap: "wrap", justifyContent: "center", cursor: "pointer" }}
              >
                <span>ML: XGB/LGBM 1m forecast</span>
                <span>MOM: 1m/6m/11m trend</span>
                <span>VAL: Sector z-scores</span>
                <span>CLU: OU mean-reversion</span>
                <span>REG: HMM regime state</span>
                <span>CNN: 1D-CNN+Transformer</span>
                <span style={{ color: "rgba(255,255,255,0.5)" }}>{showSignalGuide ? "▲ HIDE" : "▼ EXPLAIN"}</span>
              </div>
              {showSignalGuide && (
                <div style={{ marginTop: 10, padding: 14, background: "rgba(255,255,255,0.03)", borderRadius: 6, fontSize: 10, lineHeight: 1.7, color: "rgba(255,255,255,0.55)", fontFamily: "monospace" }}>
                  <div style={{ fontWeight: 700, color: "rgba(255,255,255,0.7)", marginBottom: 6, fontSize: 11 }}>ALPHA SIGNAL METHODOLOGY</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 20px" }}>
                    <div><span style={{ color: "#4CAF50" }}>ML</span> — XGBoost/LightGBM ensemble trained on 19 factors (momentum, volatility, fundamentals). Predicts 1-month forward returns. Signal = prediction × 20 scaled to [-1,1]. Per-ticker.</div>
                    <div><span style={{ color: "#FF9800" }}>MOM</span> — Momentum composite: 1-month (40%), 6-month (30%), 11-month (30%) price trends. Positive momentum → buy signal. Per-ticker.</div>
                    <div><span style={{ color: "#F44336" }}>VAL</span> — Sector-relative valuation using z-scores (MAD-based) across 5 multiples: E/P, B/M, D/Y, EV/EBITDA, S/P. Each metric compared to sector peers; z=+1 means 1 MAD cheaper than median. EV/EBITDA inverted (lower=cheaper). Falls back to absolute thresholds if sector data unavailable. Per-ticker.</div>
                    <div><span style={{ color: "#2196F3" }}>CLU</span> — Spectral clustering groups correlated stocks, then fits Ornstein-Uhlenbeck mean-reversion models per cluster. Negative z-score = dislocated below fair value → buy. Per-cluster.</div>
                    <div><span style={{ color: "#9C27B0" }}>REG</span> — Hidden Markov Model detects market regime (Bull/Neutral/Crisis) from cross-asset returns. Bull → +0.8, Neutral → 0.0, Crisis → -0.8. Same for all tickers (market-level signal).</div>
                    <div><span style={{ color: "#00BCD4" }}>CNN</span> — 1D-CNN + Transformer trained on 60-day return windows. Detects residual patterns in price series. Signal ∈ [-1,1] where positive → expected up-move. Per-ticker.</div>
                  </div>
                  <div style={{ marginTop: 8, borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: 8 }}>
                    <span style={{ color: "rgba(255,255,255,0.4)" }}>Weights (normal):</span> ML 25% · CNN 20% · MOM 15% · VAL 15% · CLU 15% · REG 10%. In Crisis regime, REG weight increases to 30%. Unavailable signals are excluded and weights renormalized.
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* === EFFICIENT FRONTIER (full width) === */}
      {result && (
        <div style={{ marginBottom: 20 }}>
          <div style={cardStyle}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <div style={sectionTitle}>Efficient Frontier</div>
              <div style={{ fontSize: 9, fontFamily: "monospace", color: "rgba(255,255,255,0.3)" }}>
                Markowitz Mean-Variance  |  Rf = {(result.meta.riskFreeRate * 100).toFixed(1)}%
              </div>
            </div>
            {(() => {
              const rf = result.meta.riskFreeRate;
              const rfPct = rf * 100;
              const frontier = result.efficientFrontier.map(p => ({
                vol: p.volatility * 100, ret: p.return * 100, sharpe: p.sharpe,
              }));
              const assets = (result.assetPoints || []).map(a => ({
                vol: a.volatility * 100, ret: a.return * 100, ticker: a.ticker,
              }));
              const portfolio = { vol: m!.volatility * 100, ret: m!.expectedReturn * 100 };

              // Min-var = lowest vol on frontier
              const minVarPt = frontier.reduce((b, p) => p.vol < b.vol ? p : b, frontier[0]);

              // Tangency = max Sharpe on efficient part (above min-var)
              const efficientPart = frontier.filter(p => p.ret >= minVarPt.ret - 0.5);
              const tangencyPt = efficientPart.reduce((best, p) => {
                const sh = p.vol > 0 ? (p.ret - rfPct) / p.vol : 0;
                const bestSh = best.vol > 0 ? (best.ret - rfPct) / best.vol : 0;
                return sh > bestSh ? p : best;
              }, efficientPart[0] || frontier[0]);

              // Mode portfolio coordinates from comparison
              const MODE_COLORS_EF: Record<string, string> = {
                equal: "#9e9e9e", min_variance: "#3b82f6", max_sharpe: "#10b981",
                risk_parity: "#f59e0b", max_diversification: "#8b5cf6",
              };
              const modePortfolios = result.modeComparison
                ? Object.entries(result.modeComparison).map(([key, mc]) => ({
                    key, vol: mc.volatility * 100, ret: mc.expectedReturn * 100,
                    label: MODE_LABELS[key] || key,
                    color: MODE_COLORS_EF[key] || "#fff",
                    isActive: key === result.meta.mode,
                  }))
                : [];

              // ── coordinate system ──
              const W = 900, H = 520;
              const mg = { top: 24, right: 30, bottom: 50, left: 58 };
              const plotW = W - mg.left - mg.right;
              const plotH = H - mg.top - mg.bottom;

              const allVols = [...frontier.map(p => p.vol), ...assets.map(a => a.vol), portfolio.vol, ...modePortfolios.map(mp => mp.vol), 0];
              const allRets = [...frontier.map(p => p.ret), ...assets.map(a => a.ret), portfolio.ret, ...modePortfolios.map(mp => mp.ret), rfPct];
              const volMax = Math.max(...allVols) * 1.12;
              const retMin = Math.min(...allRets) - 3;
              const retMax = Math.max(...allRets) + 4;

              const toX = (v: number) => mg.left + (v / volMax) * plotW;
              const toY = (r: number) => mg.top + plotH - ((r - retMin) / (retMax - retMin)) * plotH;

              // ── ticks ──
              const volStep = volMax > 40 ? 10 : volMax > 20 ? 5 : 2;
              const retStep = (retMax - retMin) > 40 ? 10 : (retMax - retMin) > 20 ? 5 : 2;
              const volTicks: number[] = [];
              for (let v = 0; v <= volMax; v += volStep) volTicks.push(v);
              const retTicks: number[] = [];
              for (let r = Math.ceil(retMin / retStep) * retStep; r <= retMax; r += retStep) retTicks.push(r);

              // ── Catmull-Rom spline ──
              const splinePath = (pts: { vol: number; ret: number }[], tension = 0.5): string => {
                if (pts.length < 2) return "";
                const px = pts.map(p => toX(p.vol));
                const py = pts.map(p => toY(p.ret));
                let d = `M ${px[0].toFixed(1)},${py[0].toFixed(1)}`;
                for (let i = 0; i < pts.length - 1; i++) {
                  const i0 = Math.max(0, i - 1), i1 = i, i2 = i + 1, i3 = Math.min(pts.length - 1, i + 2);
                  const c1x = px[i1] + (px[i2] - px[i0]) / (6 / tension);
                  const c1y = py[i1] + (py[i2] - py[i0]) / (6 / tension);
                  const c2x = px[i2] - (px[i3] - px[i1]) / (6 / tension);
                  const c2y = py[i2] - (py[i3] - py[i1]) / (6 / tension);
                  d += ` C ${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${px[i2].toFixed(1)},${py[i2].toFixed(1)}`;
                }
                return d;
              };

              const sorted = [...frontier].sort((a, b) => a.ret - b.ret);
              const fullPath = splinePath(sorted);
              const efficientSorted = sorted.filter(p => p.ret >= minVarPt.ret - 0.3);
              const efficientPath = splinePath(efficientSorted);

              // ── CML: line from Rf THROUGH tangency, extended ──
              // Slope = Sharpe of tangency = (ret_t - rf) / vol_t
              const cmlSharpe = tangencyPt.vol > 0 ? (tangencyPt.ret - rfPct) / tangencyPt.vol : 0;
              // Extend CML to edge of chart
              const cmlEndVol = volMax;
              const cmlEndRet = rfPct + cmlSharpe * cmlEndVol;

              // ── asset labels with weight + collision resolution ──
              const labels = assets.map((a) => {
                const w = result.weights.find(wi => wi.ticker === a.ticker)?.weight ?? 0;
                return { ...a, px: toX(a.vol), py: toY(a.ret), ly: toY(a.ret) - 10, lx: toX(a.vol) + 7, weight: w };
              });
              // Multi-pass collision detection: push overlapping labels apart
              labels.sort((a, b) => a.py - b.py);
              for (let pass = 0; pass < 3; pass++) {
                for (let i = 1; i < labels.length; i++) {
                  for (let j = 0; j < i; j++) {
                    const dy = Math.abs(labels[i].ly - labels[j].ly);
                    const dx = Math.abs(labels[i].lx - labels[j].lx);
                    if (dy < 13 && dx < 50) {
                      labels[i].ly = labels[j].ly + 13;
                    }
                  }
                }
              }

              const hoveredLabel = hoveredAsset ? labels.find(l => l.ticker === hoveredAsset) : null;

              // Check if portfolio and min-var overlap
              const mvPx = toX(minVarPt.vol), mvPy = toY(minVarPt.ret);
              const pfPx = toX(portfolio.vol), pfPy = toY(portfolio.ret);


              return (
                <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block" }}
                  onMouseLeave={() => setHoveredAsset(null)}
                >
                  <defs>
                    <clipPath id="plotArea">
                      <rect x={mg.left} y={mg.top} width={plotW} height={plotH} />
                    </clipPath>
                    <filter id="dotGlow" x="-100%" y="-100%" width="300%" height="300%">
                      <feGaussianBlur stdDeviation="4" result="blur" />
                      <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
                    </filter>
                    <filter id="portfolioGlow" x="-100%" y="-100%" width="300%" height="300%">
                      <feGaussianBlur stdDeviation="6" result="blur" />
                      <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
                    </filter>
                    <linearGradient id="efAreaGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#60a5fa" stopOpacity={0.12} />
                      <stop offset="100%" stopColor="#60a5fa" stopOpacity={0.01} />
                    </linearGradient>
                    <linearGradient id="efStrokeGrad" x1="0" y1="1" x2="1" y2="0">
                      <stop offset="0%" stopColor="#3b82f6" />
                      <stop offset="50%" stopColor="#60a5fa" />
                      <stop offset="100%" stopColor="#93c5fd" />
                    </linearGradient>
                    <linearGradient id="cmlGrad" x1="0" y1="0" x2="1" y2="0">
                      <stop offset="0%" stopColor="#f97316" stopOpacity={0.8} />
                      <stop offset="100%" stopColor="#f97316" stopOpacity={0.15} />
                    </linearGradient>
                  </defs>

                  {/* Plot background */}
                  <rect x={mg.left} y={mg.top} width={plotW} height={plotH} fill="#0d1117" rx={4} />

                  {/* Clipped content */}
                  <g clipPath="url(#plotArea)">
                    {/* Grid */}
                    {volTicks.map(v => (
                      <line key={`gv${v}`} x1={toX(v)} y1={mg.top} x2={toX(v)} y2={mg.top + plotH} stroke="#1c2333" strokeWidth={0.5} />
                    ))}
                    {retTicks.map(r => (
                      <line key={`gr${r}`} x1={mg.left} y1={toY(r)} x2={mg.left + plotW} y2={toY(r)} stroke="#1c2333" strokeWidth={0.5} />
                    ))}

                    {/* Rf horizontal */}
                    <line x1={mg.left} y1={toY(rfPct)} x2={mg.left + plotW} y2={toY(rfPct)}
                      stroke="#f97316" strokeWidth={0.5} strokeDasharray="3 3" opacity={0.15} />

                    {/* CML */}
                    <line x1={toX(0)} y1={toY(rfPct)} x2={toX(cmlEndVol)} y2={toY(cmlEndRet)}
                      stroke="url(#cmlGrad)" strokeWidth={1.2} strokeDasharray="8 5" />

                    {/* Frontier area fill */}
                    {efficientPath && (() => {
                      const lastPt = efficientSorted[efficientSorted.length - 1];
                      const firstPt = efficientSorted[0];
                      const areaPath = efficientPath + ` L ${toX(lastPt.vol).toFixed(1)},${(mg.top + plotH).toFixed(1)} L ${toX(firstPt.vol).toFixed(1)},${(mg.top + plotH).toFixed(1)} Z`;
                      return <path d={areaPath} fill="url(#efAreaGrad)" />;
                    })()}

                    {/* Full frontier (thin, dashed) */}
                    {fullPath && <path d={fullPath} fill="none" stroke="#3b82f6" strokeWidth={0.8} strokeDasharray="4 3" opacity={0.2} />}

                    {/* Efficient frontier (gradient stroke) */}
                    {efficientPath && <path d={efficientPath} fill="none" stroke="url(#efStrokeGrad)" strokeWidth={2.5} />}

                    {/* Asset dots — interactive, weight-proportional */}
                    {labels.map((a, i) => {
                      const isHov = hoveredAsset === a.ticker;
                      const baseR = Math.max(2.5, 2.5 + a.weight * 16);
                      const r = isHov ? baseR + 1.5 : baseR;
                      const dimmed = hoveredAsset !== null && !isHov;
                      return (
                        <g key={`a${i}`}
                          onMouseEnter={() => setHoveredAsset(a.ticker)}
                          style={{ cursor: "pointer" }}
                        >
                          {/* Hover ring */}
                          {isHov && (
                            <circle cx={a.px} cy={a.py} r={r + 5} fill="none" stroke="#c4b5fd" strokeWidth={0.8} opacity={0.3}>
                              <animate attributeName="r" from={r + 3} to={r + 10} dur="1.5s" repeatCount="indefinite" />
                              <animate attributeName="opacity" from="0.4" to="0" dur="1.5s" repeatCount="indefinite" />
                            </circle>
                          )}
                          {/* Dot */}
                          <circle cx={a.px} cy={a.py} r={r}
                            fill={isHov ? "#a78bfa" : "#8b5cf6"}
                            opacity={isHov ? 0.95 : (dimmed ? 0.25 : 0.65)}
                            stroke={isHov ? "#c4b5fd" : "#a78bfa"}
                            strokeWidth={isHov ? 2 : 0.8}
                            filter={isHov ? "url(#dotGlow)" : undefined}
                          />
                          {/* Label */}
                          <text x={isHov ? a.px + r + 6 : a.lx} y={isHov ? a.py + 4 : a.ly}
                            textAnchor="start"
                            fill={isHov ? "#fff" : (dimmed ? "rgba(196,181,253,0.2)" : "#c4b5fd")}
                            fontSize={isHov ? 10 : 8}
                            fontFamily="monospace"
                            fontWeight={isHov ? 700 : 600}
                          >
                            {a.ticker}
                          </text>
                        </g>
                      );
                    })}

                    {/* Mode comparison portfolios (non-active, dashed rings with labels) */}
                    {(() => {
                      const MODE_ABBREV: Record<string, string> = {
                        equal: "EW", min_variance: "MV", max_sharpe: "MS",
                        risk_parity: "RP", max_diversification: "MD",
                      };
                      const nonActive = modePortfolios.filter(mp => !mp.isActive);
                      const mLabels = nonActive.map(mp => ({
                        ...mp, px: toX(mp.vol), py: toY(mp.ret),
                        lx: toX(mp.vol) + 9, ly: toY(mp.ret) + 3,
                        abbrev: MODE_ABBREV[mp.key] || mp.key.slice(0, 2).toUpperCase(),
                      }));
                      mLabels.sort((a, b) => a.py - b.py);
                      for (let pass = 0; pass < 3; pass++) {
                        for (let i = 1; i < mLabels.length; i++) {
                          for (let j = 0; j < i; j++) {
                            if (Math.abs(mLabels[i].ly - mLabels[j].ly) < 11 && Math.abs(mLabels[i].lx - mLabels[j].lx) < 30) {
                              mLabels[i].ly = mLabels[j].ly + 11;
                            }
                          }
                        }
                      }
                      return mLabels.map(mp => {
                        const isHov = hoveredMode === mp.key;
                        return (
                          <g key={`mode-${mp.key}`}>
                            <circle cx={mp.px} cy={mp.py} r={5}
                              fill="none" stroke={mp.color} strokeWidth={1.5}
                              strokeDasharray="3 2"
                              opacity={isHov ? 0.9 : 0.5}
                            />
                            {isHov && <circle cx={mp.px} cy={mp.py} r={2} fill={mp.color} />}
                            <text x={mp.lx} y={mp.ly}
                              fill={mp.color} fontSize={8} fontFamily="monospace"
                              fontWeight={isHov ? 700 : 600} opacity={isHov ? 1 : 0.7}>
                              {mp.abbrev}
                            </text>
                          </g>
                        );
                      });
                    })()}

                    {/* Special markers: Min Var, Tangency, Portfolio — with collision-resolved labels */}
                    {(() => {
                      const tPx = toX(tangencyPt.vol), tPy = toY(tangencyPt.ret);
                      type SLabel = { id: string; lx: number; ly: number; anchor: "start" | "end" | "middle"; color: string; text: string; fs: number; fw: number };
                      const sLabels: SLabel[] = [
                        { id: "tan", lx: tPx + 9, ly: tPy + 3, anchor: "start", color: "#10b981", text: "M", fs: 9, fw: 700 },
                        { id: "mv", lx: mvPx - 9, ly: mvPy + 4, anchor: "end", color: "#94a3b8", text: "Min Var", fs: 8, fw: 600 },
                      ];
                      // Collision resolution between special labels
                      for (let pass = 0; pass < 3; pass++) {
                        for (let i = 0; i < sLabels.length; i++) {
                          for (let j = i + 1; j < sLabels.length; j++) {
                            const a = sLabels[i], b = sLabels[j];
                            const aW = a.text.length * 6;
                            const bW = b.text.length * 6;
                            const aL = a.anchor === "end" ? a.lx - aW : a.lx;
                            const aR = a.anchor === "end" ? a.lx : a.lx + aW;
                            const bL = b.anchor === "end" ? b.lx - bW : b.lx;
                            const bR = b.anchor === "end" ? b.lx : b.lx + bW;
                            if (aL < bR + 4 && bL < aR + 4 && Math.abs(a.ly - b.ly) < 14) {
                              if (b.ly >= a.ly) { b.ly = a.ly + 14; } else { a.ly = b.ly + 14; }
                            }
                          }
                        }
                      }
                      return (
                        <>
                          {/* Min-Variance dot */}
                          <circle cx={mvPx} cy={mvPy} r={6} fill="none" stroke="#94a3b8" strokeWidth={1.5} />
                          <circle cx={mvPx} cy={mvPy} r={2.5} fill="#94a3b8" />
                          {/* Tangency dot */}
                          <circle cx={tPx} cy={tPy} r={7} fill="none" stroke="#10b981" strokeWidth={2} />
                          <circle cx={tPx} cy={tPy} r={3} fill="#10b981" />
                          {/* Portfolio diamond with pulse */}
                          <polygon
                            points={`${pfPx},${pfPy - 5} ${pfPx + 5},${pfPy} ${pfPx},${pfPy + 5} ${pfPx - 5},${pfPy}`}
                            fill="#f59e0b" stroke="#fbbf24" strokeWidth={1.2}
                          />
                          <circle cx={pfPx} cy={pfPy} r={8} fill="none" stroke="#f59e0b" strokeWidth={0.8}>
                            <animate attributeName="r" from="7" to="15" dur="2s" repeatCount="indefinite" />
                            <animate attributeName="opacity" from="0.4" to="0" dur="2s" repeatCount="indefinite" />
                          </circle>
                          {/* Collision-resolved labels */}
                          {sLabels.map(sl => (
                            <text key={sl.id} x={sl.lx} y={sl.ly} textAnchor={sl.anchor}
                              fill={sl.color} fontSize={sl.fs} fontFamily="monospace" fontWeight={sl.fw}>
                              {sl.text}
                            </text>
                          ))}
                        </>
                      );
                    })()}

                    {/* Rf */}
                    <circle cx={toX(0)} cy={toY(rfPct)} r={3.5} fill="#f97316" stroke="#fb923c" strokeWidth={1} />
                    <text x={toX(0) + 8} y={toY(rfPct) + 4} textAnchor="start"
                      fill="#fb923c" fontSize={8.5} fontFamily="monospace" fontWeight={600}>Rf {rfPct.toFixed(1)}%</text>

                    {/* Tooltip for hovered asset */}
                    {hoveredLabel && (() => {
                      const ttW = 150, ttH = 54;
                      const tx = hoveredLabel.px + 15 + ttW > mg.left + plotW ? hoveredLabel.px - ttW - 15 : hoveredLabel.px + 15;
                      const ty = hoveredLabel.py - 32 < mg.top ? hoveredLabel.py + 15 : hoveredLabel.py - 32;
                      return (
                        <g>
                          <rect x={tx} y={ty} width={ttW} height={ttH} fill="#1c2333" stroke="#60a5fa" strokeWidth={1} rx={5} opacity={0.95} />
                          <text x={tx + 10} y={ty + 16} fill="#fff" fontSize={11} fontFamily="monospace" fontWeight={700}>
                            {hoveredLabel.ticker}
                          </text>
                          <text x={tx + 10} y={ty + 30} fill="rgba(255,255,255,0.6)" fontSize={9} fontFamily="monospace">
                            Vol: {hoveredLabel.vol.toFixed(1)}%  Ret: {hoveredLabel.ret.toFixed(1)}%
                          </text>
                          <text x={tx + 10} y={ty + 43} fill="rgba(255,255,255,0.6)" fontSize={9} fontFamily="monospace">
                            Weight: {(hoveredLabel.weight * 100).toFixed(1)}%
                          </text>
                        </g>
                      );
                    })()}
                  </g>

                  {/* Axes (outside clip) */}
                  {volTicks.map(v => (
                    <g key={`xt${v}`}>
                      <line x1={toX(v)} y1={mg.top + plotH} x2={toX(v)} y2={mg.top + plotH + 4} stroke="#484f58" strokeWidth={0.7} />
                      <text x={toX(v)} y={mg.top + plotH + 16} textAnchor="middle"
                        fill="rgba(255,255,255,0.4)" fontSize={10} fontFamily="monospace">{v}%</text>
                    </g>
                  ))}
                  <text x={mg.left + plotW / 2} y={H - 4} textAnchor="middle"
                    fill="rgba(255,255,255,0.3)" fontSize={10} fontFamily="monospace">
                    Standard Deviation (σ)
                  </text>

                  {retTicks.map(r => (
                    <g key={`yt${r}`}>
                      <line x1={mg.left - 4} y1={toY(r)} x2={mg.left} y2={toY(r)} stroke="#484f58" strokeWidth={0.7} />
                      <text x={mg.left - 7} y={toY(r) + 3.5} textAnchor="end"
                        fill="rgba(255,255,255,0.4)" fontSize={10} fontFamily="monospace">{r}%</text>
                    </g>
                  ))}
                  <text x={16} y={mg.top + plotH / 2} textAnchor="middle"
                    fill="rgba(255,255,255,0.3)" fontSize={10} fontFamily="monospace"
                    transform={`rotate(-90, 14, ${mg.top + plotH / 2})`}>
                    Expected Return (E[R])
                  </text>
                </svg>
              );
            })()}
            {/* Legend */}
            <div style={{ display: "flex", justifyContent: "center", gap: 14, marginTop: 8, fontSize: 8.5, color: "rgba(255,255,255,0.4)", fontFamily: "monospace", flexWrap: "wrap" }}>
              <span><span style={{ display: "inline-block", width: 14, height: 2.5, background: "linear-gradient(90deg, #3b82f6, #93c5fd)", borderRadius: 1, verticalAlign: "middle", marginRight: 3 }} />Efficient Frontier</span>
              <span><span style={{ display: "inline-block", width: 12, height: 2, background: "#3b82f6", borderRadius: 1, verticalAlign: "middle", marginRight: 3, opacity: 0.4 }} />Feasible Set</span>
              <span><span style={{ display: "inline-block", width: 12, height: 1.5, background: "#f97316", borderRadius: 1, verticalAlign: "middle", marginRight: 3, opacity: 0.5 }} />CML</span>
              <span><span style={{ display: "inline-block", width: 6, height: 6, background: "#8b5cf6", borderRadius: "50%", verticalAlign: "middle", marginRight: 3, opacity: 0.7 }} />Assets</span>
              <span><span style={{ display: "inline-block", width: 6, height: 6, border: "1.5px solid #10b981", borderRadius: "50%", verticalAlign: "middle", marginRight: 3 }} />Tangency</span>
              <span><span style={{ display: "inline-block", width: 7, height: 7, background: "#f59e0b", transform: "rotate(45deg)", verticalAlign: "middle", marginRight: 3 }} />Portfolio</span>
              <span style={{ color: "rgba(255,255,255,0.25)" }}>|</span>
              <span><span style={{ display: "inline-block", width: 6, height: 6, border: "1.5px dashed #9e9e9e", borderRadius: "50%", verticalAlign: "middle", marginRight: 3 }} />Mode Portfolios</span>
            </div>
            <div style={{ textAlign: "center", marginTop: 4, fontSize: 8, color: "rgba(255,255,255,0.25)", fontFamily: "monospace" }}>
              Hover over assets to see details · Dot size = portfolio weight · Strategy positions shown on hover in comparison table
            </div>
          </div>
        </div>
      )}

      {/* === WEIGHT DISTRIBUTION === */}
      {result && (
        <div style={{ marginBottom: 20 }}>
          <div style={cardStyle}>
            <div style={sectionTitle}>Weight Distribution</div>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart
                data={result.weights.filter(w => w.weight > 0.001).sort((a, b) => b.weight - a.weight)}
                layout="vertical"
                margin={{ top: 5, right: 20, bottom: 5, left: 60 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" />
                <XAxis
                  type="number"
                  tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`}
                  tick={{ fontSize: 10, fill: "rgba(255,255,255,0.5)", fontFamily: "monospace" }}
                />
                <YAxis
                  dataKey="ticker"
                  type="category"
                  tick={{ fontSize: 10, fill: "rgba(255,255,255,0.5)", fontFamily: "monospace" }}
                  width={55}
                />
                <Tooltip
                  contentStyle={{ backgroundColor: "#161b22", border: "1px solid #30363d", fontSize: 11, fontFamily: "monospace", color: "#e6edf3" }} itemStyle={{ color: "#e6edf3" }}
                  formatter={(v: unknown) => [`${(Number(v) * 100).toFixed(2)}%`, "Weight"]}
                />
                <Bar dataKey="weight" radius={[0, 3, 3, 0]}>
                  {result.weights
                    .filter(w => w.weight > 0.001)
                    .sort((a, b) => b.weight - a.weight)
                    .map((_, i) => (
                      <Cell key={i} fill={SECTOR_COLORS[i % SECTOR_COLORS.length]} />
                    ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* === RISK DECOMPOSITION TABLE === */}
      {result && (
        <div style={{ ...cardStyle, marginBottom: 20 }}>
          <div style={sectionTitle}>Risk Decomposition</div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, fontFamily: "monospace" }}>
              <thead>
                <tr>
                  {[
                    { key: "ticker", label: "Ticker" },
                    { key: "weight", label: "Weight" },
                    { key: "marginalContribution", label: "Marginal Contribution" },
                    { key: "componentRisk", label: "Component Risk" },
                    { key: "percentOfRisk", label: "% of Total Risk" },
                    { key: "componentVaR95", label: "Component VaR 95%" },
                  ].map(col => (
                    <th
                      key={col.key}
                      onClick={() => {
                        if (riskSortKey === col.key) setRiskSortAsc(!riskSortAsc);
                        else { setRiskSortKey(col.key as keyof RiskDecomp); setRiskSortAsc(false); }
                      }}
                      style={{
                        padding: "8px 10px",
                        textAlign: col.key === "ticker" ? "left" : "right",
                        borderBottom: "1px solid #30363d",
                        color: "rgba(255,255,255,0.5)",
                        fontSize: 10,
                        fontWeight: 600,
                        cursor: "pointer",
                        textTransform: "uppercase",
                        letterSpacing: "0.05em",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {col.label} {riskSortKey === col.key ? (riskSortAsc ? "▲" : "▼") : ""}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedRiskDecomp.filter(r => r.weight > 0.001).map(r => (
                  <tr key={r.ticker} style={{ borderBottom: "1px solid #30363d" }}>
                    <td style={{ padding: "6px 10px", fontWeight: 600 }}>{r.ticker}</td>
                    <td style={{ padding: "6px 10px", textAlign: "right" }}>{(r.weight * 100).toFixed(1)}%</td>
                    <td style={{ padding: "6px 10px", textAlign: "right" }}>{(r.marginalContribution * 100).toFixed(2)}%</td>
                    <td style={{ padding: "6px 10px", textAlign: "right" }}>{(r.componentRisk * 100).toFixed(2)}%</td>
                    <td style={{ padding: "6px 10px", textAlign: "right" }}>
                      <span style={{
                        display: "inline-block",
                        width: Math.max(4, r.percentOfRisk * 2),
                        height: 10,
                        background: "#3b82f6",
                        borderRadius: 2,
                        marginRight: 6,
                        verticalAlign: "middle",
                      }} />
                      {r.percentOfRisk.toFixed(1)}%
                    </td>
                    <td style={{ padding: "6px 10px", textAlign: "right", color: "#ef4444" }}>
                      {(r.componentVaR95 * 100).toFixed(2)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* === CORRELATION + SECTOR === */}
      {result && (
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 16, marginBottom: 20 }}>
          {/* Correlation Heatmap */}
          <div style={cardStyle}>
            <div style={sectionTitle}>Correlation Matrix</div>
            <div style={{ overflowX: "auto", overflowY: "auto", maxHeight: 500 }}>
              <table style={{ borderCollapse: "collapse", fontSize: 11, fontFamily: "monospace" }}>
                <thead>
                  <tr>
                    <th style={{ padding: 6, position: "sticky", left: 0, background: "#161b22", zIndex: 2 }}></th>
                    {result.correlationMatrix.tickers.map(t => (
                      <th key={t} style={{
                        padding: "6px 4px",
                        color: "rgba(255,255,255,0.5)",
                        fontWeight: 700,
                        fontSize: 10,
                        textAlign: "center",
                        minWidth: 48,
                        whiteSpace: "nowrap",
                      }}>
                        {t}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.correlationMatrix.tickers.map((t, i) => (
                    <tr key={t}>
                      <td style={{
                        padding: "4px 8px",
                        fontWeight: 700,
                        color: "rgba(255,255,255,0.5)",
                        fontSize: 10,
                        whiteSpace: "nowrap",
                        position: "sticky",
                        left: 0,
                        background: "#161b22",
                        zIndex: 1,
                      }}>{t}</td>
                      {result.correlationMatrix.values[i].map((v, j) => {
                        const absV = Math.abs(v);
                        const bg = i === j
                          ? "#0d1117"
                          : v >= 0
                            ? `rgba(59, 130, 246, ${0.15 + absV * 0.65})`
                            : `rgba(239, 68, 68, ${0.15 + absV * 0.65})`;
                        return (
                          <td key={j} style={{
                            padding: "5px 3px",
                            textAlign: "center",
                            background: bg,
                            fontSize: 10,
                            fontWeight: i === j ? 700 : 400,
                            minWidth: 48,
                            color: "#fff",
                            borderRadius: 2,
                          }}>
                            {v.toFixed(2)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ display: "flex", justifyContent: "center", gap: 16, marginTop: 8, fontSize: 9, fontFamily: "monospace", color: "rgba(255,255,255,0.5)" }}>
              <span><span style={{ display: "inline-block", width: 10, height: 10, background: "rgba(59, 130, 246, 0.7)", borderRadius: 2, verticalAlign: "middle", marginRight: 4 }} />Positive</span>
              <span><span style={{ display: "inline-block", width: 10, height: 10, background: "rgba(239, 68, 68, 0.7)", borderRadius: 2, verticalAlign: "middle", marginRight: 4 }} />Negative</span>
            </div>
          </div>

          {/* Sector Allocation */}
          <div style={cardStyle}>
            <div style={sectionTitle}>Sector Allocation</div>
            <div style={{ display: "flex", justifyContent: "center", marginBottom: 8 }}>
              <ResponsiveContainer width="100%" height={180}>
                <PieChart>
                  <Pie
                    data={result.sectorAllocation.filter(s => s.weight > 0.005)}
                    dataKey="weight"
                    nameKey="sector"
                    cx="50%"
                    cy="50%"
                    innerRadius={35}
                    outerRadius={75}
                    strokeWidth={1}
                    stroke="#161b22"
                  >
                    {result.sectorAllocation.filter(s => s.weight > 0.005).map((_, i) => (
                      <Cell key={i} fill={SECTOR_COLORS[i % SECTOR_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ backgroundColor: "#161b22", border: "1px solid #30363d", fontSize: 10, fontFamily: "monospace", color: "#e6edf3" }} itemStyle={{ color: "#e6edf3" }}
                    formatter={(v: unknown) => [`${(Number(v) * 100).toFixed(1)}%`]}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div style={{ fontSize: 10, fontFamily: "monospace" }}>
              {result.sectorAllocation.filter(s => s.weight > 0.005).sort((a, b) => b.weight - a.weight).map((s, i) => (
                <div key={s.sector} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "3px 0" }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{
                      display: "inline-block",
                      width: 8,
                      height: 8,
                      borderRadius: 2,
                      background: SECTOR_COLORS[i % SECTOR_COLORS.length],
                    }} />
                    {s.sector}
                  </span>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <div style={{ width: 60, height: 4, background: "#21262d", borderRadius: 2, overflow: "hidden" }}>
                      <div style={{ width: `${s.weight * 100}%`, height: "100%", background: SECTOR_COLORS[i % SECTOR_COLORS.length], borderRadius: 2 }} />
                    </div>
                    <span style={{ fontWeight: 600, minWidth: 38, textAlign: "right" }}>{(s.weight * 100).toFixed(1)}%</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* === PORTFOLIO REGIME (Multivariate HMM) === */}
      {result?.regimeContext?.portfolioRegime && (() => {
        const pr = result.regimeContext.portfolioRegime;
        const currentColor = HMM_REGIME_COLORS[pr.current_state_label] || "#9E9E9E";
        const currentStats = pr.state_stats[pr.current_state];
        return (
          <div style={{ ...cardStyle, marginBottom: 20, borderLeft: `3px solid ${currentColor}` }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div style={sectionTitle}>Portfolio Regime (3-State HMM)</div>
              <span style={{
                display: "inline-block",
                padding: "3px 12px",
                borderRadius: 4,
                fontSize: 11,
                fontWeight: 700,
                background: currentColor,
                color: "#fff",
                fontFamily: "monospace",
              }}>
                {pr.current_state_label.toUpperCase()}
              </span>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, marginBottom: 16 }}>
              {/* State probabilities */}
              <div>
                <div style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", marginBottom: 6, fontFamily: "monospace" }}>STATE PROBABILITIES</div>
                {pr.state_labels.map((label, i) => {
                  const prob = pr.current_probs[i];
                  const color = HMM_REGIME_COLORS[label] || "#9E9E9E";
                  return (
                    <div key={label} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                      <div style={{ width: 8, height: 8, borderRadius: "50%", background: color, flexShrink: 0 }} />
                      <span style={{ fontSize: 10, color: "rgba(255,255,255,0.7)", fontFamily: "monospace", width: 50 }}>{label}</span>
                      <div style={{ flex: 1, height: 4, background: "#21262d", borderRadius: 2, overflow: "hidden" }}>
                        <div style={{ width: `${prob * 100}%`, height: "100%", background: color, borderRadius: 2 }} />
                      </div>
                      <span style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", fontFamily: "monospace", width: 36, textAlign: "right" }}>
                        {(prob * 100).toFixed(0)}%
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* Current state stats */}
              <div>
                <div style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", marginBottom: 6, fontFamily: "monospace" }}>CURRENT REGIME STATS</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {[
                    { label: "Ann. Return", value: `${(currentStats.mean_return * 100).toFixed(1)}%` },
                    { label: "Ann. Vol", value: `${(currentStats.annualized_vol * 100).toFixed(1)}%` },
                    { label: "Avg Corr", value: currentStats.avg_correlation.toFixed(2) },
                    { label: "Exp. Duration", value: `${currentStats.expected_duration_days.toFixed(0)}d` },
                    { label: "Frequency", value: `${(currentStats.frequency * 100).toFixed(0)}%` },
                  ].map(item => (
                    <div key={item.label} style={{ display: "flex", justifyContent: "space-between", fontSize: 10, fontFamily: "monospace" }}>
                      <span style={{ color: "rgba(255,255,255,0.5)" }}>{item.label}</span>
                      <span style={{ color: "rgba(255,255,255,0.9)", fontWeight: 600 }}>{item.value}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Transition matrix */}
              <div>
                <div style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", marginBottom: 6, fontFamily: "monospace" }}>TRANSITION MATRIX</div>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 9, fontFamily: "monospace" }}>
                  <thead>
                    <tr>
                      <th style={{ padding: "2px 4px", borderBottom: "1px solid #30363d", color: "rgba(255,255,255,0.3)", textAlign: "left" }}></th>
                      {pr.state_labels.map(l => (
                        <th key={l} style={{ padding: "2px 4px", borderBottom: "1px solid #30363d", color: HMM_REGIME_COLORS[l] || "#9E9E9E", textAlign: "right" }}>
                          {l.slice(0, 3)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pr.transition_matrix.map((row, i) => (
                      <tr key={i}>
                        <td style={{ padding: "2px 4px", color: HMM_REGIME_COLORS[pr.state_labels[i]] || "#9E9E9E", fontWeight: 600 }}>
                          {pr.state_labels[i].slice(0, 3)}
                        </td>
                        {row.map((p, j) => (
                          <td key={j} style={{
                            padding: "2px 4px",
                            textAlign: "right",
                            color: i === j ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.4)",
                            fontWeight: i === j ? 700 : 400,
                          }}>
                            {(p * 100).toFixed(0)}%
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Regime-conditional expected returns (top 5 assets) */}
            {pr.regime_conditional_returns[pr.current_state_label] && (
              <div>
                <div style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", marginBottom: 6, fontFamily: "monospace" }}>
                  REGIME-CONDITIONAL EXPECTED RETURNS ({pr.current_state_label.toUpperCase()})
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {Object.entries(pr.regime_conditional_returns[pr.current_state_label])
                    .sort(([, a], [, b]) => b - a)
                    .slice(0, 10)
                    .map(([ticker, ret]) => (
                      <div key={ticker} style={{
                        padding: "3px 8px",
                        borderRadius: 3,
                        background: ret > 0 ? "rgba(76,175,80,0.15)" : "rgba(244,67,54,0.15)",
                        border: `1px solid ${ret > 0 ? "rgba(76,175,80,0.3)" : "rgba(244,67,54,0.3)"}`,
                        fontSize: 9,
                        fontFamily: "monospace",
                      }}>
                        <span style={{ color: "rgba(255,255,255,0.7)", marginRight: 4 }}>{ticker}</span>
                        <span style={{ color: ret > 0 ? "#4caf50" : "#ef5350", fontWeight: 600 }}>
                          {ret > 0 ? "+" : ""}{(ret * 100).toFixed(1)}%
                        </span>
                      </div>
                    ))}
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {/* === CLUSTER ANALYSIS (Spectral Clustering + OU) === */}
      {result?.clusterAnalysis && (
        <div style={{ ...cardStyle, marginBottom: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div style={sectionTitle}>Spectral Clusters (Residual Correlation)</div>
            <span style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", fontFamily: "monospace" }}>
              {result.clusterAnalysis.n_clusters} clusters | silhouette {result.clusterAnalysis.silhouette_score.toFixed(2)}
            </span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(result.clusterAnalysis.n_clusters, 4)}, 1fr)`, gap: 12 }}>
            {result.clusterAnalysis.clusters.map(cluster => {
              const color = CLUSTER_COLORS[cluster.id % CLUSTER_COLORS.length];
              const signalColor = MR_SIGNAL_COLORS[cluster.mean_reversion_signal] || "#9e9e9e";
              return (
                <div key={cluster.id} style={{
                  padding: 12,
                  borderRadius: 6,
                  background: "#0d1117",
                  border: `1px solid ${color}40`,
                  borderTop: `3px solid ${color}`,
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color, fontFamily: "monospace" }}>
                      Cluster {cluster.id + 1}
                    </span>
                    <span style={{
                      fontSize: 8, fontWeight: 600, padding: "1px 6px", borderRadius: 3,
                      background: signalColor, color: "#fff",
                    }}>
                      {cluster.mean_reversion_signal}
                    </span>
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 3, marginBottom: 8 }}>
                    {cluster.tickers.map(t => (
                      <span key={t} style={{
                        fontSize: 8, fontWeight: 600, padding: "1px 4px", borderRadius: 2,
                        background: `${color}20`, color, fontFamily: "monospace",
                      }}>
                        {t}
                      </span>
                    ))}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: 9, fontFamily: "monospace" }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ color: "rgba(255,255,255,0.4)" }}>Z-Score</span>
                      <span style={{
                        fontWeight: 600,
                        color: Math.abs(cluster.z_score) > 2 ? "#ef5350" : Math.abs(cluster.z_score) > 1 ? "#ff9800" : "rgba(255,255,255,0.7)",
                      }}>
                        {cluster.z_score > 0 ? "+" : ""}{cluster.z_score.toFixed(2)}
                      </span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ color: "rgba(255,255,255,0.4)" }}>Half-Life</span>
                      <span style={{ color: "rgba(255,255,255,0.7)" }}>
                        {cluster.half_life ? `${cluster.half_life.toFixed(0)}d` : "N/A"}
                      </span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ color: "rgba(255,255,255,0.4)" }}>Intra-Corr</span>
                      <span style={{ color: "rgba(255,255,255,0.7)" }}>
                        {cluster.intra_cluster_correlation.toFixed(2)}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* === HOLDINGS REGIME === */}
      {result && result.regimeContext.holdingRegimes.length > 0 && (
        <div style={{ ...cardStyle, marginBottom: 20 }}>
          <div style={sectionTitle}>Holdings Regime Status</div>
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(result.regimeContext.holdingRegimes.filter(h => { const w = result.weights.find(w => w.ticker === h.ticker); return w && w.weight > 0.001; }).length, 6)}, 1fr)`, gap: 10 }}>
            {result.regimeContext.holdingRegimes
              .filter(h => { const w = result.weights.find(w => w.ticker === h.ticker); return w && w.weight > 0.001; })
              .sort((a, b) => b.percentile - a.percentile)
              .map(h => {
                const color = REGIME_COLORS[h.regime] || "#9E9E9E";
                return (
                  <div key={h.ticker} style={{
                    padding: 12, borderRadius: 6, background: "#0d1117",
                    border: `1px solid ${color}30`, borderTop: `3px solid ${color}`,
                    textAlign: "center",
                  }}>
                    <div style={{ fontSize: 13, fontWeight: 800, fontFamily: "monospace", marginBottom: 4 }}>{h.ticker}</div>
                    <span style={{
                      display: "inline-block", padding: "2px 8px", borderRadius: 3,
                      fontSize: 9, fontWeight: 700, background: color, color: "#fff", marginBottom: 6,
                    }}>{h.regime}</span>
                    <div style={{ display: "flex", justifyContent: "center", gap: 12, marginTop: 6, fontSize: 10, fontFamily: "monospace" }}>
                      <div>
                        <div style={{ fontSize: 8, color: "rgba(255,255,255,0.4)" }}>VOL</div>
                        <div style={{ fontWeight: 700 }}>{(h.volatility * 100).toFixed(1)}%</div>
                      </div>
                      <div>
                        <div style={{ fontSize: 8, color: "rgba(255,255,255,0.4)" }}>PCTILE</div>
                        <div style={{ fontWeight: 700, color }}>{h.percentile.toFixed(0)}</div>
                      </div>
                    </div>
                    {/* Vol percentile bar */}
                    <div style={{ marginTop: 6, height: 4, background: "#21262d", borderRadius: 2, overflow: "hidden" }}>
                      <div style={{ width: `${h.percentile}%`, height: "100%", background: color, borderRadius: 2 }} />
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {/* === FULL HOLDINGS TABLE === */}
      {result && (
        <div style={{ ...cardStyle, marginBottom: 20 }}>
          <div style={sectionTitle}>Holdings Detail</div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, fontFamily: "monospace" }}>
              <thead>
                <tr>
                  {[
                    { key: "ticker", label: "Ticker", align: "left" },
                    { key: "name", label: "Name", align: "left" },
                    { key: "sector", label: "Sector", align: "left" },
                    { key: "weight", label: "Weight", align: "right" },
                    { key: "valueNOK", label: "Value NOK", align: "right" },
                    { key: "sharesApprox", label: "Shares", align: "right" },
                    { key: "lastPrice", label: "Price", align: "right" },
                  ].map(col => (
                    <th
                      key={col.key}
                      onClick={() => {
                        if (holdingSortKey === col.key) setHoldingSortAsc(!holdingSortAsc);
                        else { setHoldingSortKey(col.key); setHoldingSortAsc(false); }
                      }}
                      style={{
                        padding: "8px 10px",
                        textAlign: col.align as "left" | "right",
                        borderBottom: "1px solid #30363d",
                        color: "rgba(255,255,255,0.5)",
                        fontSize: 10,
                        fontWeight: 600,
                        cursor: "pointer",
                        textTransform: "uppercase",
                        letterSpacing: "0.05em",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {col.label} {holdingSortKey === col.key ? (holdingSortAsc ? "▲" : "▼") : ""}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedWeights.filter(w => w.weight > 0.001).map(w => {
                  return (
                    <tr key={w.ticker} style={{ borderBottom: "1px solid #30363d" }}>
                      <td style={{ padding: "6px 10px", fontWeight: 700 }}>
                        <Link href={`/stocks/${w.ticker}`} style={{ color: "#3b82f6", textDecoration: "none" }}>
                          {w.ticker}
                        </Link>
                      </td>
                      <td style={{ padding: "6px 10px", color: "rgba(255,255,255,0.5)", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {w.name}
                      </td>
                      <td style={{ padding: "6px 10px", color: "rgba(255,255,255,0.5)" }}>{w.sector}</td>
                      <td style={{ padding: "6px 10px", textAlign: "right", fontWeight: 600 }}>
                        {(w.weight * 100).toFixed(1)}%
                      </td>
                      <td style={{ padding: "6px 10px", textAlign: "right" }}>
                        {w.valueNOK.toLocaleString("no-NO", { maximumFractionDigits: 0 })}
                      </td>
                      <td style={{ padding: "6px 10px", textAlign: "right" }}>{w.sharesApprox.toLocaleString()}</td>
                      <td style={{ padding: "6px 10px", textAlign: "right" }}>{w.lastPrice.toFixed(2)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      </div>{/* end results dimmer */}

      {/* Bottom spacer */}
      <div style={{ paddingBottom: 40 }} />
    </main>
  );
}

// ============================================================================
// Sub-Components
// ============================================================================

function MetricCard({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{
      padding: 10,
      borderRadius: 4,
      border: "1px solid #30363d",
      background: "#0d1117",
    }}>
      <div style={{ fontSize: 9, color: "rgba(255,255,255,0.5)", fontFamily: "monospace", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ fontSize: 16, fontWeight: 700, fontFamily: "monospace", color: color || "#fff" }}>
        {value}
      </div>
    </div>
  );
}

