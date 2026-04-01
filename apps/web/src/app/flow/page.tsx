"use client";

import { useState, useEffect, useCallback } from "react";
import FlowHeatmap from "@/components/flow/FlowHeatmap";
import FlowPriceChart from "@/components/flow/FlowPriceChart";
import FlowSignalStrip from "@/components/flow/FlowSignalStrip";
import FlowRegimeBadge from "@/components/flow/FlowRegimeBadge";
import VPINChart from "@/components/flow/VPINChart";
import OrderbookVisual from "@/components/flow/OrderbookVisual";
import TradeTape from "@/components/flow/TradeTape";
import IcebergCard from "@/components/flow/IcebergCard";

// ── Types ──────────────────────────────────────────────────────────────────
type DashboardData = {
  kpi: {
    marketVpin: number;
    informedTickers: number;
    totalTickers: number;
    icebergsToday: number;
  };
  tickers: any[];
  recentIcebergs: any[];
  transitions: any[];
};

type TickerSignal = {
  ticker: string;
  ts: string;
  vpin: number;
  vpinPercentile: number;
  kyleLambda: number;
  ofiCumulative: number;
  ofi5m: number;
  toxicity: number;
  icebergProbability: number;
  blockAlert: boolean;
  blockEstSize: number;
  blockEstDirection: string;
  regime: string;
  spreadRegime: string;
  forecast: number;
  forecastConfidence: number;
};

// ── Accent ─────────────────────────────────────────────────────────────────
const ACCENT = "#00e5ff";

// ── KPI Card ───────────────────────────────────────────────────────────────
function KPICard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div
      style={{
        background: "#0d1117",
        border: "1px solid #21262d",
        borderRadius: 4,
        padding: "12px 16px",
        textAlign: "center",
        flex: 1,
        minWidth: 120,
      }}
    >
      <div
        style={{
          fontSize: 9,
          fontWeight: 600,
          color: "rgba(255,255,255,0.5)",
          letterSpacing: "0.06em",
          marginBottom: 6,
          textTransform: "uppercase" as const,
          fontFamily: "monospace",
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 800, color, fontFamily: "monospace" }}>{value}</div>
    </div>
  );
}

// ── Section Header ─────────────────────────────────────────────────────────
function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 11,
        fontWeight: 700,
        color: "rgba(255,255,255,0.6)",
        letterSpacing: "0.08em",
        textTransform: "uppercase" as const,
        fontFamily: "monospace",
        marginBottom: 10,
        marginTop: 20,
      }}
    >
      {children}
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────
export default function FlowPage() {
  const [activeTab, setActiveTab] = useState<"overview" | "detail">("overview");
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [selectedTicker, setSelectedTicker] = useState("EQNR");
  const [tickerSignal, setTickerSignal] = useState<TickerSignal | null>(null);
  const [bars, setBars] = useState<any[]>([]);
  const [vpinSeries, setVpinSeries] = useState<any[]>([]);
  const [depth, setDepth] = useState<any>(null);
  const [ticks, setTicks] = useState<any[]>([]);
  const [icebergs, setIcebergs] = useState<any[]>([]);
  const [sortBy, setSortBy] = useState<"vpin" | "ofi" | "toxicity" | "change">("vpin");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ── Fetch dashboard data ───────────────────────────────────────────────
  const fetchDashboard = useCallback(async () => {
    try {
      const res = await fetch("/api/flow/dashboard");
      if (!res.ok) throw new Error(`Dashboard: ${res.status}`);
      const data = await res.json();
      setDashboard(data);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Fetch ticker detail data ───────────────────────────────────────────
  const fetchTickerDetail = useCallback(async (ticker: string) => {
    try {
      const [sigRes, barsRes, vpinRes, depthRes, ticksRes, iceRes] = await Promise.all([
        fetch(`/api/flow/signals/${ticker}`),
        fetch(`/api/flow/bars/${ticker}?bar_type=time_5m&limit=200`),
        fetch(`/api/flow/vpin/${ticker}?days=5`),
        fetch(`/api/flow/depth/${ticker}`),
        fetch(`/api/flow/ticks/${ticker}?minutes=60&limit=200`),
        fetch(`/api/flow/icebergs/${ticker}?days=5`),
      ]);

      if (sigRes.ok) setTickerSignal(await sigRes.json());
      if (barsRes.ok) {
        const d = await barsRes.json();
        setBars(d.bars || []);
      }
      if (vpinRes.ok) {
        const d = await vpinRes.json();
        setVpinSeries(d.series || []);
      }
      if (depthRes.ok) {
        const d = await depthRes.json();
        setDepth(d.latest || null);
      }
      if (ticksRes.ok) {
        const d = await ticksRes.json();
        setTicks(d.ticks || []);
      }
      if (iceRes.ok) {
        const d = await iceRes.json();
        setIcebergs(d.detections || []);
      }
    } catch {
      // Silently fail — individual components show empty state
    }
  }, []);

  // ── Initial load + polling ─────────────────────────────────────────────
  useEffect(() => {
    fetchDashboard();
    const interval = setInterval(fetchDashboard, 30000);
    return () => clearInterval(interval);
  }, [fetchDashboard]);

  useEffect(() => {
    if (activeTab === "detail") {
      fetchTickerDetail(selectedTicker);
      const interval = setInterval(() => fetchTickerDetail(selectedTicker), 30000);
      return () => clearInterval(interval);
    }
  }, [activeTab, selectedTicker, fetchTickerDetail]);

  // ── Ticker click handler ───────────────────────────────────────────────
  const handleTickerClick = (ticker: string) => {
    setSelectedTicker(ticker);
    setActiveTab("detail");
  };

  const TICKERS = ["EQNR", "DNB", "MOWI", "YAR", "TEL"];

  return (
    <div style={{ minHeight: "100vh", background: "#0a0a0a", color: "#fff", fontFamily: "monospace" }}>
      <div style={{ maxWidth: 1400, margin: "0 auto", padding: "20px 24px" }}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>
              <span style={{ color: ACCENT }}>FLOW</span> INTELLIGENCE
            </h1>
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginTop: 4 }}>
              Microstructure Analytics — VPIN · Kyle λ · OFI · Iceberg Detection
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: error ? "#ef4444" : "#10b981",
                animation: error ? "none" : "pulse 2s infinite",
              }}
            />
            <span style={{ fontSize: 9, color: "rgba(255,255,255,0.4)" }}>
              {error ? "ERROR" : "LIVE"}
            </span>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", gap: 0, marginBottom: 20, borderBottom: "1px solid #30363d" }}>
          {(
            [
              { key: "overview", label: "FLOW OVERVIEW" },
              { key: "detail", label: "TICKER DEEP DIVE" },
            ] as const
          ).map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              style={{
                padding: "10px 20px",
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: "0.06em",
                fontFamily: "monospace",
                border: "none",
                background: "transparent",
                color: activeTab === tab.key ? ACCENT : "rgba(255,255,255,0.5)",
                borderBottom: activeTab === tab.key ? `2px solid ${ACCENT}` : "2px solid transparent",
                cursor: "pointer",
                transition: "all 0.2s",
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Loading state */}
        {loading && (
          <div
            style={{
              textAlign: "center",
              padding: 60,
              color: "rgba(255,255,255,0.4)",
              fontSize: 12,
            }}
          >
            Loading flow data...
          </div>
        )}

        {/* Error state */}
        {error && !loading && (
          <div
            style={{
              background: "rgba(239,68,68,0.1)",
              border: "1px solid rgba(239,68,68,0.3)",
              borderRadius: 6,
              padding: 16,
              marginBottom: 16,
              fontSize: 11,
              color: "#ef4444",
            }}
          >
            Connection error: {error}. Data may be stale. Make sure you have run{" "}
            <code style={{ background: "#161b22", padding: "2px 6px", borderRadius: 3 }}>
              pnpm run flow:generate && pnpm run flow:backtest
            </code>{" "}
            first.
          </div>
        )}

        {/* ════════════════════════════════════════════════════════════════ */}
        {/* TAB 1: FLOW OVERVIEW                                           */}
        {/* ════════════════════════════════════════════════════════════════ */}
        {activeTab === "overview" && dashboard && (
          <>
            {/* KPI Strip */}
            <div style={{ display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap" }}>
              <KPICard
                label="Market VPIN"
                value={dashboard.kpi.marketVpin.toFixed(3)}
                color={dashboard.kpi.marketVpin >= 0.6 ? "#ef4444" : dashboard.kpi.marketVpin >= 0.4 ? "#f59e0b" : ACCENT}
              />
              <KPICard
                label="Informed Tickers"
                value={`${dashboard.kpi.informedTickers} / ${dashboard.kpi.totalTickers}`}
                color={dashboard.kpi.informedTickers > 0 ? "#f59e0b" : "#10b981"}
              />
              <KPICard
                label="Icebergs Today"
                value={String(dashboard.kpi.icebergsToday)}
                color={dashboard.kpi.icebergsToday > 0 ? "#f59e0b" : "#6b7280"}
              />
              <KPICard
                label="Active Tickers"
                value={String(dashboard.kpi.totalTickers)}
                color={ACCENT}
              />
            </div>

            {/* Heatmap Grid */}
            <SectionHeader>Flow Heatmap</SectionHeader>
            <div style={{ background: "#161b22", border: "1px solid #30363d", borderRadius: 8, padding: 16 }}>
              <FlowHeatmap
                tickers={dashboard.tickers}
                sortBy={sortBy}
                onSortChange={setSortBy}
                onTickerClick={handleTickerClick}
              />
            </div>

            {/* Alerts Row */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 16 }}>
              {/* Recent Icebergs */}
              <div style={{ background: "#161b22", border: "1px solid #30363d", borderRadius: 8, padding: 16 }}>
                <SectionHeader>Recent Iceberg Alerts</SectionHeader>
                {dashboard.recentIcebergs.length === 0 ? (
                  <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 11, padding: "20px 0", textAlign: "center" }}>
                    No icebergs detected in last 24h
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {dashboard.recentIcebergs.slice(0, 5).map((ice: any, i: number) => (
                      <div
                        key={i}
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          padding: "6px 10px",
                          background: "#0d1117",
                          borderRadius: 4,
                          fontSize: 10,
                        }}
                      >
                        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                          <span style={{ fontWeight: 700, color: "#fff" }}>{ice.ticker}</span>
                          <span style={{ color: ice.direction === 1 ? "#10b981" : "#ef4444", fontWeight: 700 }}>
                            {ice.direction === 1 ? "BUY" : "SELL"}
                          </span>
                        </div>
                        <div style={{ display: "flex", gap: 10, color: "rgba(255,255,255,0.5)" }}>
                          <span>{(ice.total_volume || 0).toLocaleString()} shr</span>
                          <span style={{ color: "#f59e0b" }}>{((ice.confidence || 0) * 100).toFixed(0)}%</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Regime Transitions */}
              <div style={{ background: "#161b22", border: "1px solid #30363d", borderRadius: 8, padding: 16 }}>
                <SectionHeader>Regime Transitions</SectionHeader>
                {dashboard.transitions.length === 0 ? (
                  <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 11, padding: "20px 0", textAlign: "center" }}>
                    No regime changes in last 24h
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {dashboard.transitions.slice(0, 5).map((tr: any, i: number) => (
                      <div
                        key={i}
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          padding: "6px 10px",
                          background: "#0d1117",
                          borderRadius: 4,
                          fontSize: 10,
                        }}
                      >
                        <span style={{ fontWeight: 700, color: "#fff" }}>{tr.ticker}</span>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <FlowRegimeBadge regime={tr.prev_regime} />
                          <span style={{ color: "rgba(255,255,255,0.3)" }}>→</span>
                          <FlowRegimeBadge regime={tr.regime} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </>
        )}

        {/* ════════════════════════════════════════════════════════════════ */}
        {/* TAB 2: TICKER DEEP DIVE                                        */}
        {/* ════════════════════════════════════════════════════════════════ */}
        {activeTab === "detail" && (
          <>
            {/* Ticker Selector */}
            <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
              {TICKERS.map((t) => (
                <button
                  key={t}
                  onClick={() => setSelectedTicker(t)}
                  style={{
                    padding: "6px 16px",
                    borderRadius: 4,
                    fontSize: 11,
                    fontWeight: 700,
                    fontFamily: "monospace",
                    border: `1px solid ${selectedTicker === t ? ACCENT : "#30363d"}`,
                    background: selectedTicker === t ? `${ACCENT}15` : "#161b22",
                    color: selectedTicker === t ? ACCENT : "rgba(255,255,255,0.6)",
                    cursor: "pointer",
                    transition: "all 0.2s",
                  }}
                >
                  {t}
                </button>
              ))}
            </div>

            {/* Signal Strip */}
            {tickerSignal && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                  <span style={{ fontSize: 18, fontWeight: 800 }}>{selectedTicker}</span>
                  <FlowRegimeBadge regime={tickerSignal.regime || "neutral"} />
                  {tickerSignal.forecast != null && (
                    <span
                      style={{
                        fontSize: 10,
                        fontFamily: "monospace",
                        color: tickerSignal.forecast > 0 ? "#10b981" : "#ef4444",
                        background: tickerSignal.forecast > 0 ? "rgba(16,185,129,0.1)" : "rgba(239,68,68,0.1)",
                        padding: "2px 8px",
                        borderRadius: 4,
                      }}
                    >
                      30m: {tickerSignal.forecast > 0 ? "+" : ""}
                      {(tickerSignal.forecast * 100).toFixed(2)}%
                      {tickerSignal.forecastConfidence != null &&
                        ` (${(tickerSignal.forecastConfidence * 100).toFixed(0)}%)`}
                    </span>
                  )}
                </div>
                <FlowSignalStrip signal={tickerSignal} />
              </div>
            )}

            {/* Price + OFI Chart */}
            <div style={{ background: "#161b22", border: "1px solid #30363d", borderRadius: 8, padding: 16, marginBottom: 16 }}>
              <FlowPriceChart bars={bars} signals={vpinSeries} />
            </div>

            {/* 2-column: Volume chart + Orderbook */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
              {/* Buy/Sell Volume bars (simple inline) */}
              <div style={{ background: "#161b22", border: "1px solid #30363d", borderRadius: 8, padding: 16 }}>
                <div
                  style={{
                    fontSize: 9,
                    fontWeight: 600,
                    color: "rgba(255,255,255,0.5)",
                    letterSpacing: "0.06em",
                    marginBottom: 10,
                    textTransform: "uppercase" as const,
                  }}
                >
                  BUY / SELL VOLUME (5m Bars)
                </div>
                <div style={{ maxHeight: 250, overflowY: "auto" }}>
                  {bars.slice(-30).map((b: any, i: number) => {
                    const total = (b.buy_volume || 0) + (b.sell_volume || 0);
                    const buyPct = total > 0 ? ((b.buy_volume || 0) / total) * 100 : 50;
                    return (
                      <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                        <span style={{ fontSize: 8, color: "rgba(255,255,255,0.35)", width: 35, fontFamily: "monospace" }}>
                          {new Date(b.bar_open_ts).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                        </span>
                        <div style={{ flex: 1, height: 10, borderRadius: 2, overflow: "hidden", display: "flex", background: "#21262d" }}>
                          <div style={{ width: `${buyPct}%`, background: "#10b981", height: "100%" }} />
                          <div style={{ width: `${100 - buyPct}%`, background: "#ef4444", height: "100%" }} />
                        </div>
                        <span style={{ fontSize: 8, color: "rgba(255,255,255,0.35)", width: 40, textAlign: "right", fontFamily: "monospace" }}>
                          {total > 0 ? total.toLocaleString() : "—"}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Orderbook */}
              <div style={{ background: "#161b22", border: "1px solid #30363d", borderRadius: 8, padding: 16 }}>
                <OrderbookVisual depth={depth} />
              </div>
            </div>

            {/* VPIN + Lambda Chart */}
            <div style={{ background: "#161b22", border: "1px solid #30363d", borderRadius: 8, padding: 16, marginBottom: 16 }}>
              <VPINChart data={vpinSeries} />
            </div>

            {/* 2-column: Trade Tape + Icebergs */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              {/* Trade Tape */}
              <div style={{ background: "#161b22", border: "1px solid #30363d", borderRadius: 8, padding: 16 }}>
                <TradeTape ticks={ticks} />
              </div>

              {/* Iceberg Detections */}
              <div style={{ background: "#161b22", border: "1px solid #30363d", borderRadius: 8, padding: 16 }}>
                <SectionHeader>Iceberg Detections (5d)</SectionHeader>
                {icebergs.length === 0 ? (
                  <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 11, padding: "20px 0", textAlign: "center" }}>
                    No iceberg detections for {selectedTicker}
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {icebergs.map((ice: any, i: number) => (
                      <IcebergCard key={i} detection={ice} />
                    ))}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Pulse animation */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}
