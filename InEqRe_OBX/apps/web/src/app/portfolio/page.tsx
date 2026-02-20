"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import {
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, BarChart, Bar, Cell, PieChart, Pie,
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

interface OptimizationResult {
  weights: WeightItem[];
  metrics: Metrics;
  riskDecomposition: RiskDecomp[];
  efficientFrontier: EFPoint[];
  assetPoints?: AssetPoint[];
  correlationMatrix: { tickers: string[]; values: number[][] };
  sectorAllocation: { sector: string; weight: number }[];
  fxExposure: { currency: string; weightedExposure: number }[];
  regimeContext: { holdingRegimes: HoldingRegime[] };
  stressScenarios: StressScenario[];
  meta: {
    lookbackDays: number;
    covarianceMethod: string;
    mode: string;
    riskFreeRate: number;
    portfolioValueNOK: number;
    commonDates: number;
    shrinkageIntensity?: number;
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
  // Auth state
  const [token, setToken] = useState<string | null>(null);
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
  const [maxPosition, setMaxPosition] = useState(0.10);
  const [maxSector, setMaxSector] = useState(0.30);

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

  // Check for existing session
  useEffect(() => {
    const saved = sessionStorage.getItem("portfolio_token");
    if (saved) setToken(saved);
  }, []);

  // Fetch available stocks when authenticated
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/stocks?assetTypes=equity", { cache: "no-store" });
        if (res.ok) {
          const data = await res.json();
          if (!cancelled) {
            setAvailableStocks(
              (data.stocks || data)
                .filter((s: StockOption & { asset_type?: string }) => s.asset_type === "equity" || !s.asset_type)
                .map((s: StockOption & { ticker: string; name: string; sector: string }) => ({
                  ticker: s.ticker,
                  name: s.name || s.ticker,
                  sector: s.sector || "Unknown",
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
        cache: "no-store",
      });
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
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        const data = await res.json();
        setToken(data.token);
        sessionStorage.setItem("portfolio_token", data.token);
      } else {
        setAuthError("Invalid password");
      }
    } catch {
      setAuthError("Connection error");
    } finally {
      setAuthLoading(false);
    }
  };

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

  // Run optimization
  const runOptimization = async () => {
    if (selectedTickers.length < 2) {
      setError("Select at least 2 tickers");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/portfolio/optimize", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          tickers: selectedTickers,
          mode,
          constraints: {
            maxPositionSize: maxPosition,
            minPositionSize: 0.01,
            maxSectorExposure: maxSector,
            excludeTickers: [],
          },
          lookbackDays,
          portfolioValueNOK,
          riskFreeRate: 0.045,
          covarianceMethod: covMethod,
        }),
      });

      if (!res.ok) {
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
      await fetch(`/api/portfolio/configs/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
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
    return (
      <main style={{ padding: 24, maxWidth: 400, margin: "120px auto" }}>
        <form
          style={cardStyle}
          onSubmit={e => { e.preventDefault(); handleLogin(); }}
        >
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 4, fontFamily: "monospace" }}>
            Portfolio Optimizer
          </div>
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", marginBottom: 20, fontFamily: "monospace" }}>
            Authenticate to access portfolio management
          </div>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="Password"
            autoFocus
            style={{
              width: "100%",
              padding: "10px 12px",
              background: "#0d1117",
              border: "1px solid #30363d",
              borderRadius: 4,
              color: "#fff",
              fontSize: 13,
              fontFamily: "monospace",
              marginBottom: 12,
              boxSizing: "border-box",
            }}
          />
          <button
            type="submit"
            disabled={authLoading || !password}
            style={{
              width: "100%",
              padding: "10px 0",
              background: authLoading ? "#30363d" : "#3b82f6",
              color: "#fff",
              border: "none",
              borderRadius: 4,
              fontSize: 13,
              fontWeight: 600,
              fontFamily: "monospace",
              cursor: authLoading ? "wait" : "pointer",
              opacity: authLoading ? 0.6 : 1,
            }}
          >
            {authLoading ? "Authenticating..." : "Login"}
          </button>
          {authError && (
            <div style={{ color: "#ef4444", fontSize: 12, marginTop: 8, fontFamily: "monospace" }}>
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
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <Link href="/stocks" style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", textDecoration: "none", fontFamily: "monospace" }}>
            ← Asset List
          </Link>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: "4px 0 0", fontFamily: "monospace", letterSpacing: "-0.02em" }}>
            Portfolio Optimizer
          </h1>
        </div>
        <button
          onClick={() => { setToken(null); sessionStorage.removeItem("portfolio_token"); }}
          style={{ ...btnStyle(false), fontSize: 10 }}
        >
          Logout
        </button>
      </div>

      {/* === CONSTRUCTION + RISK DASHBOARD === */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 16, marginBottom: 20 }}>
        {/* LEFT: Construction Panel */}
        <div style={cardStyle}>
          <div style={sectionTitle}>Portfolio Construction</div>

          {/* Saved Configs */}
          {configs.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", fontFamily: "monospace", marginBottom: 4 }}>
                SAVED PORTFOLIOS
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {configs.map(c => (
                  <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <button
                      onClick={() => loadConfig(c)}
                      style={{ ...btnStyle(false), flex: 1, textAlign: "left", fontSize: 10, padding: "4px 8px" }}
                    >
                      {c.name} ({c.tickers.length} tickers)
                    </button>
                    <button
                      onClick={() => deleteConfig(c.id)}
                      style={{ background: "none", border: "none", color: "#ef4444", fontSize: 10, cursor: "pointer", fontFamily: "monospace" }}
                    >
                      x
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Ticker Input */}
          <div style={{ marginBottom: 12, position: "relative" }}>
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", fontFamily: "monospace", marginBottom: 4 }}>
              ADD TICKERS ({selectedTickers.length} selected)
            </div>
            <input
              value={tickerInput}
              onChange={e => setTickerInput(e.target.value)}
              placeholder="Search ticker or name..."
              style={{
                width: "100%",
                padding: "8px 10px",
                background: "#0d1117",
                border: "1px solid #30363d",
                borderRadius: 4,
                color: "#fff",
                fontSize: 12,
                fontFamily: "monospace",
                boxSizing: "border-box",
              }}
            />
            {/* Dropdown */}
            {filteredStocks.length > 0 && (
              <div style={{
                position: "absolute",
                top: "100%",
                left: 0,
                right: 0,
                background: "#161b22",
                border: "1px solid #30363d",
                borderRadius: 4,
                zIndex: 10,
                maxHeight: 200,
                overflowY: "auto",
              }}>
                {filteredStocks.map(s => (
                  <div
                    key={s.ticker}
                    onClick={() => addTicker(s.ticker)}
                    style={{
                      padding: "6px 10px",
                      fontSize: 11,
                      fontFamily: "monospace",
                      cursor: "pointer",
                      display: "flex",
                      justifyContent: "space-between",
                      borderBottom: "1px solid #30363d",
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = "#0d1117")}
                    onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                  >
                    <span style={{ fontWeight: 600 }}>{s.ticker}</span>
                    <span style={{ color: "rgba(255,255,255,0.5)", fontSize: 10 }}>{s.name.slice(0, 20)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Selected Tickers Chips */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 14 }}>
            {selectedTickers.map(t => (
              <span key={t} style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                padding: "3px 8px",
                background: "#0d1117",
                borderRadius: 3,
                fontSize: 10,
                fontFamily: "monospace",
                fontWeight: 600,
                border: "1px solid #30363d",
              }}>
                {t}
                <span onClick={() => removeTicker(t)} style={{ cursor: "pointer", color: "rgba(255,255,255,0.5)" }}>
                  x
                </span>
              </span>
            ))}
          </div>

          {/* Mode */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", fontFamily: "monospace", marginBottom: 4 }}>
              OPTIMIZATION MODE
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {Object.entries(MODE_LABELS).map(([key, label]) => (
                <button key={key} onClick={() => setMode(key)} style={btnStyle(mode === key)}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Parameters */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", fontFamily: "monospace", marginBottom: 2 }}>VALUE (NOK)</div>
              <input
                type="number"
                value={portfolioValueNOK}
                onChange={e => setPortfolioValueNOK(Number(e.target.value))}
                style={{
                  width: "100%", padding: "6px 8px", background: "#0d1117",
                  border: "1px solid #30363d", borderRadius: 4,
                  color: "#fff", fontSize: 11, fontFamily: "monospace", boxSizing: "border-box",
                }}
              />
            </div>
            <div>
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", fontFamily: "monospace", marginBottom: 2 }}>LOOKBACK</div>
              <div style={{ display: "flex", gap: 2 }}>
                {[{ l: "1Y", v: 252 }, { l: "2Y", v: 504 }, { l: "3Y", v: 756 }].map(tf => (
                  <button key={tf.v} onClick={() => setLookbackDays(tf.v)} style={{ ...btnStyle(lookbackDays === tf.v), padding: "6px 8px" }}>
                    {tf.l}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", fontFamily: "monospace", marginBottom: 2 }}>MAX POS %</div>
              <input
                type="number"
                value={Math.round(maxPosition * 100)}
                onChange={e => setMaxPosition(Number(e.target.value) / 100)}
                min={1} max={100}
                style={{
                  width: "100%", padding: "6px 8px", background: "#0d1117",
                  border: "1px solid #30363d", borderRadius: 4,
                  color: "#fff", fontSize: 11, fontFamily: "monospace", boxSizing: "border-box",
                }}
              />
            </div>
            <div>
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", fontFamily: "monospace", marginBottom: 2 }}>COV METHOD</div>
              <div style={{ display: "flex", gap: 2 }}>
                {["shrinkage", "ewma", "sample"].map(cm => (
                  <button key={cm} onClick={() => setCovMethod(cm)} style={{ ...btnStyle(covMethod === cm), padding: "6px 6px", fontSize: 9 }}>
                    {cm.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Optimize Button */}
          <button
            onClick={runOptimization}
            disabled={loading || selectedTickers.length < 2}
            style={{
              width: "100%",
              padding: "12px 0",
              background: loading ? "#30363d" : "#3b82f6",
              color: "#fff",
              border: "none",
              borderRadius: 4,
              fontSize: 13,
              fontWeight: 700,
              fontFamily: "monospace",
              cursor: loading ? "wait" : "pointer",
              letterSpacing: "0.05em",
            }}
          >
            {loading ? "OPTIMIZING..." : "OPTIMIZE PORTFOLIO"}
          </button>

          {/* Save Button */}
          {result && (
            <div style={{ marginTop: 8 }}>
              {!showSaveForm ? (
                <button onClick={() => setShowSaveForm(true)} style={{ ...btnStyle(false), width: "100%", fontSize: 10 }}>
                  Save Portfolio
                </button>
              ) : (
                <div style={{ display: "flex", gap: 4 }}>
                  <input
                    value={saveName}
                    onChange={e => setSaveName(e.target.value)}
                    placeholder="Portfolio name..."
                    style={{
                      flex: 1, padding: "6px 8px", background: "#0d1117",
                      border: "1px solid #30363d", borderRadius: 4,
                      color: "#fff", fontSize: 11, fontFamily: "monospace",
                    }}
                  />
                  <button onClick={saveConfig} style={btnStyle(true)}>Save</button>
                  <button onClick={() => setShowSaveForm(false)} style={btnStyle(false)}>x</button>
                </div>
              )}
            </div>
          )}

          {error && (
            <div style={{ color: "#ef4444", fontSize: 11, marginTop: 8, fontFamily: "monospace" }}>
              {error}
            </div>
          )}
        </div>

        {/* RIGHT: Risk Dashboard */}
        <div style={cardStyle}>
          <div style={sectionTitle}>Risk Dashboard</div>
          {!m ? (
            <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 12, fontFamily: "monospace", padding: "40px 0", textAlign: "center" }}>
              Select tickers and click OPTIMIZE to see results
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
              <MetricCard label="Expected Return" value={`${(m.expectedReturn * 100).toFixed(1)}%`} color={m.expectedReturn >= 0 ? "#10b981" : "#ef4444"} />
              <MetricCard label="Volatility" value={`${(m.volatility * 100).toFixed(1)}%`} />
              <MetricCard label="Sharpe Ratio" value={m.sharpeRatio.toFixed(2)} color={m.sharpeRatio >= 0.5 ? "#10b981" : m.sharpeRatio >= 0 ? "#f59e0b" : "#ef4444"} />
              <MetricCard label="Sortino Ratio" value={m.sortinoRatio.toFixed(2)} color={m.sortinoRatio >= 1 ? "#10b981" : "#f59e0b"} />
              <MetricCard label="VaR 95%" value={`${(m.var95 * 100).toFixed(1)}%`} color="#ef4444" />
              <MetricCard label="CVaR 99%" value={`${(m.cvar99 * 100).toFixed(1)}%`} color="#ef4444" />
              <MetricCard label="Max Drawdown" value={`${(m.maxDrawdown * 100).toFixed(1)}%`} color="#ef4444" />
              <MetricCard label="Beta to OBX" value={m.betaToOBX.toFixed(2)} />
              <MetricCard label="Eff. Positions" value={m.effectivePositions.toFixed(1)} />
              <MetricCard label="Tracking Error" value={`${(m.trackingError * 100).toFixed(1)}%`} />
              <MetricCard label="Diversification" value={m.diversificationRatio.toFixed(2)} />
              <MetricCard label="HHI" value={(m.herfindahlIndex * 100).toFixed(0)} />
            </div>
          )}
        </div>
      </div>

      {/* === OPTIMAL WEIGHTS SUMMARY === */}
      {result && m && (
        <div style={{
          ...cardStyle,
          marginBottom: 20,
          background: "linear-gradient(135deg, rgba(59,130,246,0.08) 0%, rgba(16,185,129,0.08) 100%)",
          border: "1px solid rgba(59,130,246,0.3)",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 16 }}>
            <div>
              <div style={{ ...sectionTitle, marginBottom: 6 }}>Optimal Portfolio — {MODE_LABELS[result.meta.mode]}</div>
              <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
                {result.weights.filter(w => w.weight > 0.005).sort((a, b) => b.weight - a.weight).map(w => (
                  <div key={w.ticker} style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 14, fontWeight: 800, fontFamily: "monospace", color: "#fff" }}>
                      {(w.weight * 100).toFixed(1)}%
                    </div>
                    <div style={{ fontSize: 10, fontWeight: 600, fontFamily: "monospace", color: "#3b82f6" }}>
                      {w.ticker}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 18, fontWeight: 800, fontFamily: "monospace", color: m.expectedReturn >= 0 ? "#10b981" : "#ef4444" }}>
                  {(m.expectedReturn * 100).toFixed(1)}%
                </div>
                <div style={{ fontSize: 9, color: "rgba(255,255,255,0.5)", fontFamily: "monospace" }}>RETURN</div>
              </div>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 18, fontWeight: 800, fontFamily: "monospace" }}>
                  {(m.volatility * 100).toFixed(1)}%
                </div>
                <div style={{ fontSize: 9, color: "rgba(255,255,255,0.5)", fontFamily: "monospace" }}>VOL</div>
              </div>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 18, fontWeight: 800, fontFamily: "monospace", color: m.sharpeRatio >= 0.5 ? "#10b981" : "#f59e0b" }}>
                  {m.sharpeRatio.toFixed(2)}
                </div>
                <div style={{ fontSize: 9, color: "rgba(255,255,255,0.5)", fontFamily: "monospace" }}>SHARPE</div>
              </div>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 18, fontWeight: 800, fontFamily: "monospace", color: "#ef4444" }}>
                  {(m.var95 * 100).toFixed(1)}%
                </div>
                <div style={{ fontSize: 9, color: "rgba(255,255,255,0.5)", fontFamily: "monospace" }}>VaR 95%</div>
              </div>
            </div>
          </div>
        </div>
      )}

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

              // ── coordinate system (larger) ──
              const W = 900, H = 500;
              const mg = { top: 20, right: 30, bottom: 48, left: 58 };
              const plotW = W - mg.left - mg.right;
              const plotH = H - mg.top - mg.bottom;

              const allVols = [...frontier.map(p => p.vol), ...assets.map(a => a.vol), portfolio.vol, 0];
              const allRets = [...frontier.map(p => p.ret), ...assets.map(a => a.ret), portfolio.ret, rfPct];
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

              // ── asset labels ──
              const labels = assets.map((a) => ({
                ...a, px: toX(a.vol), py: toY(a.ret), ly: toY(a.ret) - 12,
              }));
              labels.sort((a, b) => a.py - b.py);
              for (let i = 1; i < labels.length; i++) {
                if (Math.abs(labels[i].ly - labels[i - 1].ly) < 13 && Math.abs(labels[i].px - labels[i - 1].px) < 60) {
                  labels[i].ly = labels[i - 1].ly + 14;
                }
              }

              // Check if portfolio and min-var overlap (within 2% vol and 2% ret)
              const mvPx = toX(minVarPt.vol), mvPy = toY(minVarPt.ret);
              const pfPx = toX(portfolio.vol), pfPy = toY(portfolio.ret);
              const pfMvOverlap = Math.abs(mvPx - pfPx) < 30 && Math.abs(mvPy - pfPy) < 25;

              return (
                <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block" }}>
                  <defs>
                    <clipPath id="plotArea">
                      <rect x={mg.left} y={mg.top} width={plotW} height={plotH} />
                    </clipPath>
                  </defs>

                  {/* Plot background */}
                  <rect x={mg.left} y={mg.top} width={plotW} height={plotH} fill="#0d1117" rx={2} />

                  {/* Clipped content — everything inside the plot area */}
                  <g clipPath="url(#plotArea)">
                    {/* Grid */}
                    {volTicks.map(v => (
                      <line key={`gv${v}`} x1={toX(v)} y1={mg.top} x2={toX(v)} y2={mg.top + plotH} stroke="#21262d" strokeWidth={0.5} />
                    ))}
                    {retTicks.map(r => (
                      <line key={`gr${r}`} x1={mg.left} y1={toY(r)} x2={mg.left + plotW} y2={toY(r)} stroke="#21262d" strokeWidth={0.5} />
                    ))}

                    {/* Rf horizontal */}
                    <line x1={mg.left} y1={toY(rfPct)} x2={mg.left + plotW} y2={toY(rfPct)}
                      stroke="#f97316" strokeWidth={0.5} strokeDasharray="3 3" opacity={0.25} />

                    {/* CML — clipped to plot area */}
                    <line x1={toX(0)} y1={toY(rfPct)} x2={toX(cmlEndVol)} y2={toY(cmlEndRet)}
                      stroke="#f97316" strokeWidth={1.2} strokeDasharray="8 5" opacity={0.5} />

                    {/* Full bullet (thin, dashed) */}
                    {fullPath && <path d={fullPath} fill="none" stroke="#3b82f6" strokeWidth={1} strokeDasharray="4 3" opacity={0.3} />}

                    {/* Efficient frontier (bold) */}
                    {efficientPath && <path d={efficientPath} fill="none" stroke="#60a5fa" strokeWidth={2.5} />}

                    {/* Asset dots */}
                    {labels.map((a, i) => (
                      <g key={`a${i}`}>
                        <circle cx={a.px} cy={a.py} r={4} fill="#8b5cf6" opacity={0.6} stroke="#a78bfa" strokeWidth={0.8} />
                        <text x={a.px + 7} y={a.ly} textAnchor="start"
                          fill="#c4b5fd" fontSize={9} fontFamily="monospace" fontWeight={600}>{a.ticker}</text>
                      </g>
                    ))}

                    {/* Min-Variance — label to the left */}
                    <circle cx={mvPx} cy={mvPy} r={5} fill="none" stroke="#94a3b8" strokeWidth={1.5} />
                    <circle cx={mvPx} cy={mvPy} r={2} fill="#94a3b8" />
                    {!pfMvOverlap && (
                      <text x={mvPx - 9} y={mvPy + 4} textAnchor="end"
                        fill="#94a3b8" fontSize={8} fontFamily="monospace" fontWeight={600}>Min Var</text>
                    )}

                    {/* Tangency (M) — label to the right */}
                    <circle cx={toX(tangencyPt.vol)} cy={toY(tangencyPt.ret)} r={6} fill="none" stroke="#10b981" strokeWidth={2} />
                    <circle cx={toX(tangencyPt.vol)} cy={toY(tangencyPt.ret)} r={2.5} fill="#10b981" />
                    <text x={toX(tangencyPt.vol) + 10} y={toY(tangencyPt.ret) + 4} textAnchor="start"
                      fill="#10b981" fontSize={9} fontFamily="monospace" fontWeight={700}>M</text>

                    {/* Portfolio (diamond) — label above-left */}
                    <polygon
                      points={`${pfPx},${pfPy - 7} ${pfPx + 7},${pfPy} ${pfPx},${pfPy + 7} ${pfPx - 7},${pfPy}`}
                      fill="#f59e0b" stroke="#fbbf24" strokeWidth={1.2}
                    />
                    <text x={pfPx - 10} y={pfPy - 10} textAnchor="end"
                      fill="#fbbf24" fontSize={9} fontFamily="monospace" fontWeight={700}>
                      {pfMvOverlap ? "Portfolio (Min Var)" : "Portfolio"}
                    </text>

                    {/* Rf */}
                    <circle cx={toX(0)} cy={toY(rfPct)} r={3.5} fill="#f97316" stroke="#fb923c" strokeWidth={1} />
                    <text x={toX(0) + 8} y={toY(rfPct) + 4} textAnchor="start"
                      fill="#fb923c" fontSize={8.5} fontFamily="monospace" fontWeight={600}>Rf {rfPct.toFixed(1)}%</text>
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
            <div style={{ display: "flex", justifyContent: "center", gap: 14, marginTop: 6, fontSize: 8.5, color: "rgba(255,255,255,0.4)", fontFamily: "monospace", flexWrap: "wrap" }}>
              <span><span style={{ display: "inline-block", width: 12, height: 2.5, background: "#60a5fa", borderRadius: 1, verticalAlign: "middle", marginRight: 3 }} />Efficient Frontier</span>
              <span><span style={{ display: "inline-block", width: 12, height: 2, background: "#3b82f6", borderRadius: 1, verticalAlign: "middle", marginRight: 3, opacity: 0.5 }} />Feasible Set</span>
              <span><span style={{ display: "inline-block", width: 12, height: 1.5, background: "#f97316", borderRadius: 1, verticalAlign: "middle", marginRight: 3, opacity: 0.5 }} />CML</span>
              <span><span style={{ display: "inline-block", width: 6, height: 6, background: "#8b5cf6", borderRadius: "50%", verticalAlign: "middle", marginRight: 3, opacity: 0.7 }} />Assets</span>
              <span><span style={{ display: "inline-block", width: 6, height: 6, border: "1.5px solid #10b981", borderRadius: "50%", verticalAlign: "middle", marginRight: 3 }} />Tangency</span>
              <span><span style={{ display: "inline-block", width: 7, height: 7, background: "#f59e0b", transform: "rotate(45deg)", verticalAlign: "middle", marginRight: 3 }} />Portfolio</span>
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

      {/* === CORRELATION + SECTOR + FX === */}
      {result && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }}>
          {/* Correlation Heatmap */}
          <div style={{ ...cardStyle, gridColumn: result.correlationMatrix.tickers.length > 8 ? "1 / -1" : undefined }}>
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
                            color: absV > 0.4 && i !== j ? "#fff" : "#fff",
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

          {/* Sector + FX */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {/* Sector Allocation */}
            <div style={cardStyle}>
              <div style={sectionTitle}>Sector Allocation</div>
              <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
                <ResponsiveContainer width="50%" height={160}>
                  <PieChart>
                    <Pie
                      data={result.sectorAllocation.filter(s => s.weight > 0.005)}
                      dataKey="weight"
                      nameKey="sector"
                      cx="50%"
                      cy="50%"
                      innerRadius={30}
                      outerRadius={65}
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
                <div style={{ flex: 1, fontSize: 10, fontFamily: "monospace" }}>
                  {result.sectorAllocation.filter(s => s.weight > 0.005).map((s, i) => (
                    <div key={s.sector} style={{ display: "flex", justifyContent: "space-between", padding: "2px 0" }}>
                      <span>
                        <span style={{
                          display: "inline-block",
                          width: 8,
                          height: 8,
                          borderRadius: 2,
                          background: SECTOR_COLORS[i % SECTOR_COLORS.length],
                          marginRight: 6,
                          verticalAlign: "middle",
                        }} />
                        {s.sector}
                      </span>
                      <span style={{ fontWeight: 600 }}>{(s.weight * 100).toFixed(1)}%</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* FX Exposure */}
            <div style={cardStyle}>
              <div style={sectionTitle}>FX Exposure (Revenue-Weighted)</div>
              <ResponsiveContainer width="100%" height={100}>
                <BarChart data={result.fxExposure.filter(f => f.weightedExposure > 0.5)} layout="vertical" margin={{ left: 40, right: 20 }}>
                  <XAxis type="number" tickFormatter={(v: number) => `${v.toFixed(0)}%`} tick={{ fontSize: 9, fontFamily: "monospace", fill: "rgba(255,255,255,0.5)" }} />
                  <YAxis dataKey="currency" type="category" tick={{ fontSize: 10, fontFamily: "monospace", fill: "rgba(255,255,255,0.5)" }} width={35} />
                  <Tooltip contentStyle={{ backgroundColor: "#161b22", border: "1px solid #30363d", fontSize: 10, fontFamily: "monospace", color: "#e6edf3" }} itemStyle={{ color: "#e6edf3" }} />
                  <Bar dataKey="weightedExposure" radius={[0, 3, 3, 0]}>
                    {result.fxExposure.filter(f => f.weightedExposure > 0.5).map((f, i) => (
                      <Cell key={i} fill={f.currency === "NOK" ? "#10b981" : f.currency === "USD" ? "#3b82f6" : f.currency === "EUR" ? "#f59e0b" : "#8b5cf6"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      {/* === REGIME + STRESS === */}
      {result && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }}>
          {/* Regime Context */}
          <div style={cardStyle}>
            <div style={sectionTitle}>Holdings Regime Status</div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10, fontFamily: "monospace" }}>
                <thead>
                  <tr>
                    <th style={{ padding: "6px 8px", textAlign: "left", borderBottom: "1px solid #30363d", color: "rgba(255,255,255,0.5)", fontSize: 9 }}>TICKER</th>
                    <th style={{ padding: "6px 8px", textAlign: "left", borderBottom: "1px solid #30363d", color: "rgba(255,255,255,0.5)", fontSize: 9 }}>REGIME</th>
                    <th style={{ padding: "6px 8px", textAlign: "right", borderBottom: "1px solid #30363d", color: "rgba(255,255,255,0.5)", fontSize: 9 }}>VOL</th>
                    <th style={{ padding: "6px 8px", textAlign: "right", borderBottom: "1px solid #30363d", color: "rgba(255,255,255,0.5)", fontSize: 9 }}>PCTILE</th>
                  </tr>
                </thead>
                <tbody>
                  {result.regimeContext.holdingRegimes
                    .filter(h => {
                      const w = result.weights.find(w => w.ticker === h.ticker);
                      return w && w.weight > 0.001;
                    })
                    .sort((a, b) => b.percentile - a.percentile)
                    .map(h => (
                    <tr key={h.ticker} style={{ borderBottom: "1px solid #30363d" }}>
                      <td style={{ padding: "4px 8px", fontWeight: 600 }}>{h.ticker}</td>
                      <td style={{ padding: "4px 8px" }}>
                        <span style={{
                          display: "inline-block",
                          padding: "1px 6px",
                          borderRadius: 3,
                          fontSize: 9,
                          fontWeight: 600,
                          background: REGIME_COLORS[h.regime] || "#9E9E9E",
                          color: "#fff",
                        }}>
                          {h.regime}
                        </span>
                      </td>
                      <td style={{ padding: "4px 8px", textAlign: "right" }}>{(h.volatility * 100).toFixed(1)}%</td>
                      <td style={{ padding: "4px 8px", textAlign: "right" }}>{h.percentile.toFixed(0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Stress Scenarios */}
          <div style={cardStyle}>
            <div style={sectionTitle}>Stress Scenarios</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {result.stressScenarios.map(s => (
                <div key={s.name} style={{
                  padding: 12,
                  borderRadius: 4,
                  border: "1px solid #30363d",
                  background: "#0d1117",
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                    <span style={{ fontWeight: 600, fontSize: 11, fontFamily: "monospace" }}>{s.name}</span>
                    <span style={{ color: "#ef4444", fontWeight: 700, fontSize: 12, fontFamily: "monospace" }}>
                      Vol: {(s.portfolioVol * 100).toFixed(1)}%
                    </span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                    <span style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", fontFamily: "monospace" }}>
                      {s.description}
                    </span>
                    <span style={{ color: "#ef4444", fontSize: 11, fontFamily: "monospace" }}>
                      VaR95: {(s.var95 * 100).toFixed(1)}%
                    </span>
                  </div>
                  {/* Comparison bar */}
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
                    <span style={{ fontSize: 9, color: "rgba(255,255,255,0.5)", fontFamily: "monospace", width: 40 }}>Base</span>
                    <div style={{ height: 6, background: "#3b82f6", borderRadius: 3, width: `${Math.min(100, (m!.volatility / s.portfolioVol) * 100)}%` }} />
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 2 }}>
                    <span style={{ fontSize: 9, color: "rgba(255,255,255,0.5)", fontFamily: "monospace", width: 40 }}>Stress</span>
                    <div style={{ height: 6, background: "#ef4444", borderRadius: 3, width: "100%" }} />
                  </div>
                </div>
              ))}
            </div>
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
                  const regime = result.regimeContext.holdingRegimes.find(h => h.ticker === w.ticker);
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

      {/* Meta info */}
      {result && (
        <div style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", fontFamily: "monospace", textAlign: "center", paddingBottom: 40 }}>
          Mode: {MODE_LABELS[result.meta.mode]} | Lookback: {result.meta.commonDates} days |
          Covariance: {result.meta.covarianceMethod}{result.meta.shrinkageIntensity !== undefined ? ` (δ=${result.meta.shrinkageIntensity.toFixed(3)})` : ""} |
          Risk-free: {(result.meta.riskFreeRate * 100).toFixed(1)}%
        </div>
      )}
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
