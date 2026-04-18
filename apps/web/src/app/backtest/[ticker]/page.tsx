"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import PageNav from "@/components/ui/PageNav";
import { useEffect, useState, useCallback } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  ReferenceArea,
} from "recharts";

/* ─── Types ─── */

type SimStats = {
  totalReturn: number;
  annualizedReturn: number;
  benchmarkReturn: number;
  benchmarkAnnReturn: number;
  excessReturn: number;
  sharpe: number;
  maxDrawdown: number;
  winRate: number;
  trades: number;
  avgHoldDays: number;
  avgWinPct: number;
  avgLossPct: number;
  profitFactor: number;
};

type SimTrade = {
  entryDate: string;
  exitDate: string;
  entryPrice: number;
  exitPrice: number;
  predictedReturn: number;
  actualReturn: number;
  pnlPct: number;
  daysHeld: number;
  exitReason: string;
  maxDrawdown: number;
  momAtEntry: number;
  volAtEntry: string | null;
  predAtEntry: number;
};

type SeriesPoint = {
  date: string;
  price: number;
  equity: number;
  benchmark: number;
  inPosition: boolean;
  entryMarker: boolean;
  exitMarker: boolean;
  exitWin: boolean | null;
  mlPrediction: number | null;
};

type BacktestResult = {
  success: boolean;
  ticker: string;
  sector: string;
  signal: "daily" | "monthly";
  days: number;
  params: Record<string, number | string | boolean>;
  stats: SimStats;
  trades: SimTrade[];
  series: SeriesPoint[];
  error?: string;
  availableTickers?: string[];
};

/* ─── Styles ─── */

const cardStyle = {
  padding: "10px 12px",
  borderRadius: 4,
  background: "#0d1117",
  border: "1px solid #21262d",
};

const tooltipStyle = {
  background: "#161b22",
  border: "1px solid #3b82f6",
  borderRadius: 4,
  fontSize: 10,
  fontFamily: "monospace",
  padding: "6px 10px",
};

const EXIT_COLORS: Record<string, string> = {
  signal_flip: "#3b82f6",
  take_profit: "#10b981",
  stop_loss: "#ef4444",
  time_stop: "#f59e0b",
  sma_cross: "#8b5cf6",
  vol_regime: "#f97316",
};

const EXIT_LABELS: Record<string, string> = {
  signal_flip: "Signal",
  take_profit: "TP",
  stop_loss: "SL",
  time_stop: "Time",
  sma_cross: "SMA",
  vol_regime: "Vol",
};

/* ─── Param Config ─── */

type ParamDef = {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  suffix: string;
};

const PARAM_DEFS: ParamDef[] = [
  { key: "entry", label: "ENTRY", min: 0.1, max: 5.0, step: 0.1, suffix: "%" },
  { key: "exit", label: "EXIT", min: -2.0, max: 2.0, step: 0.05, suffix: "%" },
  { key: "stop", label: "STOP LOSS", min: 1, max: 15, step: 0.5, suffix: "%" },
  { key: "tp", label: "TAKE PROFIT", min: 3, max: 50, step: 1, suffix: "%" },
  { key: "maxHold", label: "MAX HOLD", min: 5, max: 60, step: 1, suffix: "d" },
  { key: "minHold", label: "MIN HOLD", min: 1, max: 10, step: 1, suffix: "d" },
];

const DEFAULT_PARAMS: Record<string, number> = {
  entry: 1.0,
  exit: 0.25,
  stop: 5.0,
  tp: 15.0,
  maxHold: 21,
  minHold: 3,
};

/* ─── Component ─── */

export default function TickerBacktestPage() {
  const params = useParams();
  const ticker = (params?.ticker as string)?.toUpperCase() || "";

  const [result, setResult] = useState<BacktestResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [signal, setSignal] = useState<"daily" | "monthly">("daily");
  const [days, setDays] = useState(1260);
  const [simParams, setSimParams] = useState<Record<string, number>>({ ...DEFAULT_PARAMS });
  const [pendingParams, setPendingParams] = useState<Record<string, number>>({ ...DEFAULT_PARAMS });
  const [expandedTrades, setExpandedTrades] = useState(false);

  const fetchBacktest = useCallback(
    async (p: Record<string, number>, sig: string, d: number) => {
      if (!ticker) return;
      setLoading(true);
      setError(null);
      try {
        const qs = new URLSearchParams({
          signal: sig,
          days: String(d),
          ...Object.fromEntries(Object.entries(p).map(([k, v]) => [k, String(v)])),
        });
        const res = await fetch(`/api/backtest/${ticker}?${qs}`);
        const data: BacktestResult = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error || "Failed to fetch backtest");
        }
        setResult(data);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    },
    [ticker]
  );

  // Initial fetch
  useEffect(() => {
    fetchBacktest(simParams, signal, days);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticker]);

  const handleRun = () => {
    setSimParams({ ...pendingParams });
    fetchBacktest(pendingParams, signal, days);
  };

  const handleSignalChange = (s: "daily" | "monthly") => {
    setSignal(s);
    fetchBacktest(simParams, s, days);
  };

  const handleDaysChange = (d: number) => {
    setDays(d);
    fetchBacktest(simParams, signal, d);
  };

  const stats = result?.stats;
  const trades = result?.trades || [];
  const series = result?.series || [];

  // Format helpers
  const pct = (v: number, decimals = 1) => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(decimals)}%`;
  const pctRaw = (v: number, decimals = 1) => `${v >= 0 ? "+" : ""}${v.toFixed(decimals)}%`;

  // Equity curve data — thin to ~300 points for perf
  const stride = Math.max(1, Math.floor(series.length / 300));
  const chartData = series.filter((_, i) => i % stride === 0 || i === series.length - 1);

  // Trade position bands for chart shading
  const positionBands: { start: string; end: string; win: boolean }[] = [];
  for (const t of trades) {
    positionBands.push({
      start: t.entryDate,
      end: t.exitDate,
      win: t.pnlPct > 0,
    });
  }

  // Exit reason breakdown
  const exitBreakdown: Record<string, number> = {};
  for (const t of trades) {
    exitBreakdown[t.exitReason] = (exitBreakdown[t.exitReason] || 0) + 1;
  }

  if (error && !result) {
    const availableTickers = (result as any)?.availableTickers || [];
    return (
      <div style={{ maxWidth: 1600, margin: "0 auto", padding: "60px 16px", fontFamily: "monospace" }}>
        <div style={{ padding: "24px 32px", background: "#161b22", border: "1px solid #f59e0b", borderRadius: 4, textAlign: "center" }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#f59e0b", marginBottom: 8 }}>
            NO DATA FOR {ticker}
          </div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)" }}>{error}</div>
          <div style={{ marginTop: 16, display: "flex", justifyContent: "center", gap: 12 }}>
            <Link href="/backtest" style={{ fontSize: 10, color: "#3b82f6", textDecoration: "none", fontWeight: 600, padding: "6px 14px", border: "1px solid #3b82f6", borderRadius: 4, background: "#0d1117" }}>
              ALL BACKTESTS
            </Link>
            <Link href={`/stocks/${ticker}`} style={{ fontSize: 10, color: "#10b981", textDecoration: "none", fontWeight: 600, padding: "6px 14px", border: "1px solid #10b981", borderRadius: 4, background: "#0d1117" }}>
              VIEW {ticker}
            </Link>
          </div>
        </div>
        {availableTickers.length > 0 && (
          <div style={{ marginTop: 16, padding: 16, background: "#161b22", border: "1px solid #30363d", borderRadius: 4 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "#fff", marginBottom: 8 }}>AVAILABLE TICKERS</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {availableTickers.map((t: string) => (
                <Link key={t} href={`/backtest/${t}`} style={{ fontSize: 9, fontWeight: 600, padding: "3px 8px", borderRadius: 3, textDecoration: "none", background: "#0d1117", color: "#3b82f6", border: "1px solid #30363d" }}>
                  {t}
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1600, margin: "0 auto", padding: 16, fontFamily: "monospace", background: "#0a0a0a" }}>
      <PageNav
        crumbs={[
          { label: "Home", href: "/" },
          { label: "Stocks", href: "/stocks" },
          { label: ticker, href: `/stocks/${ticker}` },
          { label: "Backtest" },
        ]}
        actions={[
          { label: "Predictions", href: `/predictions/${ticker}` },
          { label: "Volatility", href: `/volatility/${ticker}` },
          { label: "Montecarlo", href: `/montecarlo/${ticker}` },
          { label: "All Backtests", href: "/backtest" },
        ]}
      />

      {/* ── Header ── */}
      <div style={{ marginBottom: 12, padding: "12px 16px", background: "#161b22", border: "1px solid #30363d", borderRadius: 4 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <h1 style={{ fontSize: 18, fontWeight: 700, color: "#fff", fontFamily: "monospace" }}>
              BACKTEST: {ticker}
            </h1>
            {result?.sector && (
              <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 8px", background: "rgba(59,130,246,0.15)", color: "#3b82f6", borderRadius: 3, border: "1px solid rgba(59,130,246,0.3)" }}>
                {result.sector}
              </span>
            )}
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            {/* Signal mode toggle */}
            <div style={{ display: "flex", gap: 0 }}>
              {(["daily", "monthly"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => handleSignalChange(s)}
                  style={{
                    fontSize: 9, fontWeight: 600, fontFamily: "monospace", padding: "4px 10px",
                    border: "1px solid #30363d",
                    borderRadius: s === "daily" ? "4px 0 0 4px" : "0 4px 4px 0",
                    borderLeft: s === "monthly" ? "none" : undefined,
                    background: signal === s ? "#3b82f6" : "#0d1117",
                    color: signal === s ? "#fff" : "rgba(255,255,255,0.5)",
                    cursor: "pointer",
                  }}
                >
                  {s === "daily" ? "DAILY SIGNAL" : "MONTHLY ML"}
                </button>
              ))}
            </div>
            {/* Lookback */}
            <div style={{ display: "flex", gap: 0 }}>
              {[{ label: "2Y", d: 504 }, { label: "3Y", d: 756 }, { label: "5Y", d: 1260 }].map(({ label, d }, i) => (
                <button
                  key={d}
                  onClick={() => handleDaysChange(d)}
                  style={{
                    fontSize: 9, fontWeight: 600, fontFamily: "monospace", padding: "4px 8px",
                    border: "1px solid #30363d",
                    borderRadius: i === 0 ? "4px 0 0 4px" : i === 2 ? "0 4px 4px 0" : "0",
                    borderLeft: i > 0 ? "none" : undefined,
                    background: days === d ? "#3b82f6" : "#0d1117",
                    color: days === d ? "#fff" : "rgba(255,255,255,0.5)",
                    cursor: "pointer",
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", marginTop: 6 }}>
          {signal === "daily" ? "21-day forward return signal (daily rolling)" : "ML ensemble predictions (monthly, step-held)"} · {result?.days || "—"} trading days · {trades.length} trades
        </div>
      </div>

      {/* ── Parameter Controls ── */}
      <div style={{ marginBottom: 12, padding: "10px 16px", background: "#161b22", border: "1px solid #30363d", borderRadius: 4 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: "#fff", letterSpacing: "0.05em" }}>STRATEGY PARAMETERS</span>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              onClick={() => setPendingParams({ ...DEFAULT_PARAMS })}
              style={{ fontSize: 8, fontWeight: 600, fontFamily: "monospace", padding: "3px 10px", border: "1px solid #30363d", borderRadius: 4, background: "#0d1117", color: "rgba(255,255,255,0.5)", cursor: "pointer" }}
            >
              RESET
            </button>
            <button
              onClick={handleRun}
              disabled={loading}
              style={{
                fontSize: 9, fontWeight: 700, fontFamily: "monospace", padding: "4px 16px",
                border: "none", borderRadius: 4,
                background: loading ? "#21262d" : "linear-gradient(135deg, #3b82f6, #2563eb)",
                color: "#fff", cursor: loading ? "default" : "pointer",
                opacity: loading ? 0.5 : 1,
              }}
            >
              {loading ? "RUNNING..." : "RUN BACKTEST"}
            </button>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 10 }}>
          {PARAM_DEFS.map((p) => (
            <div key={p.key}>
              <div style={{ fontSize: 8, color: "rgba(255,255,255,0.4)", marginBottom: 3, fontWeight: 600, letterSpacing: "0.08em" }}>
                {p.label}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <input
                  type="range"
                  min={p.min}
                  max={p.max}
                  step={p.step}
                  value={pendingParams[p.key]}
                  onChange={(e) => setPendingParams((prev) => ({ ...prev, [p.key]: parseFloat(e.target.value) }))}
                  style={{ flex: 1, accentColor: "#3b82f6", height: 2 }}
                />
                <span style={{ fontSize: 10, fontWeight: 700, color: "#fff", minWidth: 36, textAlign: "right" }}>
                  {Number.isInteger(p.step) ? pendingParams[p.key] : pendingParams[p.key].toFixed(p.step < 0.1 ? 2 : 1)}{p.suffix}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Stats Cards ── */}
      {stats && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 8, marginBottom: 12 }}>
          <div style={{ ...cardStyle, borderColor: stats.totalReturn >= 0 ? "#10b981" : "#ef4444" }}>
            <div style={{ fontSize: 8, color: "rgba(255,255,255,0.4)", fontWeight: 600 }}>TOTAL RETURN</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: stats.totalReturn >= 0 ? "#10b981" : "#ef4444" }}>
              {pct(stats.totalReturn)}
            </div>
            <div style={{ fontSize: 8, color: "rgba(255,255,255,0.35)" }}>Ann: {pct(stats.annualizedReturn)}</div>
          </div>
          <div style={{ ...cardStyle, borderColor: stats.excessReturn >= 0 ? "#10b981" : "#ef4444" }}>
            <div style={{ fontSize: 8, color: "rgba(255,255,255,0.4)", fontWeight: 600 }}>VS BENCHMARK</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: stats.excessReturn >= 0 ? "#10b981" : "#ef4444" }}>
              {pct(stats.excessReturn)}
            </div>
            <div style={{ fontSize: 8, color: "rgba(255,255,255,0.35)" }}>OBX: {pct(stats.benchmarkAnnReturn)}</div>
          </div>
          <div style={{ ...cardStyle, borderColor: stats.sharpe >= 1 ? "#10b981" : stats.sharpe >= 0.5 ? "#f59e0b" : "#ef4444" }}>
            <div style={{ fontSize: 8, color: "rgba(255,255,255,0.4)", fontWeight: 600 }}>SHARPE</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: stats.sharpe >= 1 ? "#10b981" : stats.sharpe >= 0.5 ? "#f59e0b" : "#ef4444" }}>
              {stats.sharpe.toFixed(2)}
            </div>
            <div style={{ fontSize: 8, color: "rgba(255,255,255,0.35)" }}>Risk-adj return</div>
          </div>
          <div style={{ ...cardStyle, borderColor: stats.winRate >= 0.55 ? "#10b981" : stats.winRate >= 0.45 ? "#f59e0b" : "#ef4444" }}>
            <div style={{ fontSize: 8, color: "rgba(255,255,255,0.4)", fontWeight: 600 }}>WIN RATE</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: stats.winRate >= 0.55 ? "#10b981" : stats.winRate >= 0.45 ? "#f59e0b" : "#ef4444" }}>
              {(stats.winRate * 100).toFixed(0)}%
            </div>
            <div style={{ fontSize: 8, color: "rgba(255,255,255,0.35)" }}>{stats.trades} trades</div>
          </div>
          <div style={cardStyle}>
            <div style={{ fontSize: 8, color: "rgba(255,255,255,0.4)", fontWeight: 600 }}>MAX DRAWDOWN</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: "#ef4444" }}>
              {(stats.maxDrawdown * 100).toFixed(1)}%
            </div>
            <div style={{ fontSize: 8, color: "rgba(255,255,255,0.35)" }}>Peak to trough</div>
          </div>
          <div style={cardStyle}>
            <div style={{ fontSize: 8, color: "rgba(255,255,255,0.4)", fontWeight: 600 }}>PROFIT FACTOR</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: stats.profitFactor >= 1.5 ? "#10b981" : stats.profitFactor >= 1.0 ? "#f59e0b" : "#ef4444" }}>
              {stats.profitFactor === Infinity ? "∞" : stats.profitFactor.toFixed(2)}
            </div>
            <div style={{ fontSize: 8, color: "rgba(255,255,255,0.35)" }}>
              W: {pct(stats.avgWinPct)} / L: {pct(stats.avgLossPct)}
            </div>
          </div>
        </div>
      )}

      {/* ── Secondary stats strip ── */}
      {stats && (
        <div style={{ display: "flex", gap: 16, padding: "6px 16px", marginBottom: 12, background: "#161b22", border: "1px solid #30363d", borderRadius: 4, fontSize: 9, color: "rgba(255,255,255,0.5)" }}>
          <span>Avg hold: <b style={{ color: "#fff" }}>{stats.avgHoldDays.toFixed(1)}d</b></span>
          <span>Avg win: <b style={{ color: "#10b981" }}>{pct(stats.avgWinPct)}</b></span>
          <span>Avg loss: <b style={{ color: "#ef4444" }}>{pct(stats.avgLossPct)}</b></span>
          <span>Benchmark: <b style={{ color: "#fff" }}>{pct(stats.benchmarkReturn)}</b></span>
          {/* Exit breakdown */}
          <span style={{ marginLeft: "auto" }}>Exits:</span>
          {Object.entries(exitBreakdown).sort((a, b) => b[1] - a[1]).map(([reason, count]) => (
            <span key={reason}>
              <b style={{ color: EXIT_COLORS[reason] || "#fff" }}>{count}</b>{" "}
              <span style={{ color: "rgba(255,255,255,0.35)" }}>{EXIT_LABELS[reason] || reason}</span>
            </span>
          ))}
        </div>
      )}

      {/* ── Equity Curve Chart ── */}
      <div style={{ marginBottom: 12, padding: 12, background: "#161b22", border: "1px solid #30363d", borderRadius: 4 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: "#fff", marginBottom: 8 }}>EQUITY CURVE</div>
        <ResponsiveContainer width="100%" height={360}>
          <LineChart data={chartData} margin={{ top: 5, right: 5, left: -15, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#21262d" vertical={false} />
            <XAxis
              dataKey="date"
              stroke="#30363d"
              style={{ fontSize: 8, fontFamily: "monospace" }}
              tick={{ fill: "rgba(255,255,255,0.4)" }}
              tickFormatter={(v: string) => v.slice(2, 7)}
              minTickGap={50}
            />
            <YAxis
              stroke="#30363d"
              style={{ fontSize: 8, fontFamily: "monospace" }}
              tick={{ fill: "rgba(255,255,255,0.4)" }}
              tickFormatter={(v: number) => v.toFixed(0)}
            />
            <ReferenceLine y={100} stroke="rgba(255,255,255,0.2)" strokeWidth={1} />
            {/* Position shading */}
            {positionBands.map((b, i) => (
              <ReferenceArea
                key={i}
                x1={b.start}
                x2={b.end}
                fill={b.win ? "rgba(16,185,129,0.06)" : "rgba(239,68,68,0.06)"}
                strokeOpacity={0}
              />
            ))}
            <Tooltip
              contentStyle={tooltipStyle}
              formatter={(value: any, name?: string) => [
                <span key="v" style={{ color: name === "equity" ? "#10b981" : "#3b82f6" }}>{Number(value).toFixed(1)}</span>,
                <span key="n" style={{ color: "#fff" }}>{name === "equity" ? "Strategy" : "OBX"}</span>,
              ]}
              labelFormatter={(l: string) => <span style={{ color: "#fff", fontWeight: 600 }}>{l}</span>}
            />
            <Line type="monotone" dataKey="equity" stroke="#10b981" strokeWidth={2} dot={false} isAnimationActive={true} animationDuration={800} animationEasing="ease-out" />
            <Line type="monotone" dataKey="benchmark" stroke="#3b82f6" strokeWidth={1.2} strokeDasharray="5 5" dot={false} isAnimationActive={true} animationDuration={800} animationEasing="ease-out" />
          </LineChart>
        </ResponsiveContainer>
        <div style={{ display: "flex", justifyContent: "center", gap: 16, fontSize: 8, color: "rgba(255,255,255,0.5)", marginTop: 4 }}>
          <span><span style={{ color: "#10b981" }}>━━</span> Strategy: {stats ? pct(stats.totalReturn) : "—"}</span>
          <span><span style={{ color: "#3b82f6" }}>- - -</span> OBX: {stats ? pct(stats.benchmarkReturn) : "—"}</span>
          <span style={{ color: "rgba(255,255,255,0.3)" }}>Green shading = in position (win) · Red = in position (loss)</span>
        </div>
      </div>

      {/* ── Trade Log ── */}
      <div style={{ marginBottom: 12, background: "#161b22", border: "1px solid #30363d", borderRadius: 4, overflow: "hidden" }}>
        <div style={{ padding: "8px 12px", borderBottom: "1px solid #30363d", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <span style={{ fontSize: 10, fontWeight: 700, color: "#fff" }}>TRADE LOG</span>
            <span style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", marginLeft: 8 }}>{trades.length} trades</span>
          </div>
          <button
            onClick={() => setExpandedTrades(!expandedTrades)}
            style={{ fontSize: 8, fontWeight: 600, fontFamily: "monospace", padding: "3px 10px", border: "1px solid #30363d", borderRadius: 4, background: "#0d1117", color: "rgba(255,255,255,0.5)", cursor: "pointer" }}
          >
            {expandedTrades ? "COLLAPSE" : "SHOW ALL"}
          </button>
        </div>
        <div style={{ maxHeight: expandedTrades ? "none" : 350, overflowY: expandedTrades ? "visible" : "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "monospace", fontSize: 9 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #30363d", position: "sticky", top: 0, background: "#161b22", zIndex: 1 }}>
                {["#", "ENTRY", "EXIT", "DAYS", "SIGNAL", "RETURN", "P&L", "EXIT TYPE", "MAX DD", "MOM"].map((h) => (
                  <th key={h} style={{ textAlign: h === "ENTRY" || h === "EXIT" ? "left" : "right", padding: "5px 8px", color: "rgba(255,255,255,0.4)", fontWeight: 600, fontSize: 8 }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {trades.map((t, i) => (
                <tr key={i} style={{ borderBottom: "1px solid #21262d" }}>
                  <td style={{ padding: "4px 8px", textAlign: "right", color: "rgba(255,255,255,0.3)" }}>{i + 1}</td>
                  <td style={{ padding: "4px 8px", color: "#fff" }}>{t.entryDate.slice(2)}</td>
                  <td style={{ padding: "4px 8px", color: "#fff" }}>{t.exitDate.slice(2)}</td>
                  <td style={{ padding: "4px 8px", textAlign: "right", color: "rgba(255,255,255,0.5)" }}>{t.daysHeld}</td>
                  <td style={{ padding: "4px 8px", textAlign: "right", color: t.predAtEntry >= 0 ? "#10b981" : "#ef4444" }}>
                    {pctRaw(t.predAtEntry)}
                  </td>
                  <td style={{ padding: "4px 8px", textAlign: "right", color: t.actualReturn >= 0 ? "#10b981" : "#ef4444", fontWeight: 600 }}>
                    {pct(t.actualReturn)}
                  </td>
                  <td style={{ padding: "4px 8px", textAlign: "right", color: t.pnlPct >= 0 ? "#10b981" : "#ef4444" }}>
                    {pct(t.pnlPct)}
                  </td>
                  <td style={{ padding: "4px 8px", textAlign: "right" }}>
                    <span style={{ fontSize: 8, fontWeight: 600, padding: "1px 5px", borderRadius: 3, background: `${EXIT_COLORS[t.exitReason] || "#fff"}20`, color: EXIT_COLORS[t.exitReason] || "#fff" }}>
                      {EXIT_LABELS[t.exitReason] || t.exitReason}
                    </span>
                  </td>
                  <td style={{ padding: "4px 8px", textAlign: "right", color: "rgba(255,255,255,0.4)" }}>
                    {(t.maxDrawdown * 100).toFixed(1)}%
                  </td>
                  <td style={{ padding: "4px 8px", textAlign: "right", color: t.momAtEntry >= 2 ? "#10b981" : t.momAtEntry >= 1 ? "#f59e0b" : "rgba(255,255,255,0.3)" }}>
                    {t.momAtEntry}/3
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Methodology ── */}
      <div style={{ padding: "10px 16px", background: "#161b22", border: "1px solid #30363d", borderRadius: 4, fontSize: 9, color: "rgba(255,255,255,0.4)", lineHeight: 1.6 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.6)", marginBottom: 6 }}>METHODOLOGY</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "6px 24px" }}>
          <div><b style={{ color: "#3b82f6" }}>Daily Signal</b> — 21-day forward return from prices. BUY when signal exceeds entry threshold, SELL when below exit threshold.</div>
          <div><b style={{ color: "#3b82f6" }}>Monthly ML</b> — Ensemble predictions (XGBoost + LightGBM) step-held daily. Same buy/sell logic applied to monthly signal.</div>
          <div><b style={{ color: "#3b82f6" }}>Equity Curve</b> — Compounded returns from trade P&L after costs. Position sizing not applied (shows raw signal quality).</div>
          <div><b style={{ color: "#3b82f6" }}>Exit Priority</b> — Stop loss (always) → Take profit → Signal flip → Time stop → SMA cross → Vol regime.</div>
          <div><b style={{ color: "#3b82f6" }}>Costs</b> — {simParams.cost || 10} bps round-trip deducted from each trade return.</div>
          <div><b style={{ color: "#3b82f6" }}>Benchmark</b> — OBX total return index over same period. Excess return = strategy annualized − OBX annualized.</div>
        </div>
      </div>
    </div>
  );
}
