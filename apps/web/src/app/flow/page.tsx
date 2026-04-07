"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import FlowPriceChart from "@/components/flow/FlowPriceChart";
import FlowRegimeBadge from "@/components/flow/FlowRegimeBadge";
import TradeTape from "@/components/flow/TradeTape";
import IcebergCard from "@/components/flow/IcebergCard";
import TradeTypeBreakdown from "@/components/flow/TradeTypeBreakdown";
import { detectIcebergs } from "@/lib/orderflow";

const LIVE_REFRESH_SEC = 60; // poll Euronext every 60s in live mode

// Oslo market hours: Mon–Fri 09:00–17:30
function isOsloMarketOpen(): boolean {
  const now = new Date();
  // Get Oslo local time components
  const oslo = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Oslo",
    weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(now);
  const weekday = oslo.find(p => p.type === "weekday")?.value ?? "";
  const hour = parseInt(oslo.find(p => p.type === "hour")?.value ?? "0", 10);
  const minute = parseInt(oslo.find(p => p.type === "minute")?.value ?? "0", 10);
  const isWeekday = !["Sat", "Sun"].includes(weekday);
  const minuteOfDay = hour * 60 + minute;
  return isWeekday && minuteOfDay >= 9 * 60 && minuteOfDay < 17 * 60 + 30;
}

function getTodayOslo(): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Oslo" }).format(new Date());
}

// ── Types ──────────────────────────────────────────────────────────────────
type Tick = { ts: string; price: number; size: number; side: number };
type TickerSignal = {
  ticker: string; ts: string;
  vpin: number; vpinPercentile: number; kyleLambda: number;
  ofiCumulative: number; ofi5m: number; toxicity: number;
  icebergProbability: number; blockAlert: boolean; blockEstSize: number;
  blockEstDirection: string; regime: string; spreadRegime: string;
  forecast: number; forecastConfidence: number;
};
type DateEntry = { date: string; tick_count: number };

const ACCENT = "#00e5ff";
const TICKERS = ["EQNR", "DNB", "MOWI", "YAR", "TEL"];

// ── Verdict logic ──────────────────────────────────────────────────────────
function getVerdict(ticks: Tick[]) {
  if (ticks.length < 50) return null;

  const totalBuy = ticks.filter(t => t.side === 1).reduce((s, t) => s + t.size, 0);
  const totalSell = ticks.filter(t => t.side === -1).reduce((s, t) => s + t.size, 0);
  const total = totalBuy + totalSell;
  if (total === 0) return null;
  const buyPct = (totalBuy / total) * 100;
  const ofi = totalBuy - totalSell;

  // Check for large uniform trades (iceberg signature)
  const sizes = ticks.map(t => t.size).sort((a, b) => a - b);
  const p75 = sizes[Math.floor(sizes.length * 0.75)];
  const p25 = sizes[Math.floor(sizes.length * 0.25)];
  const sizeUniformity = p75 > 0 ? (p75 - p25) / p75 : 1;
  const hasIcebergSig = sizeUniformity < 0.4 && ticks.length > 200;

  // VPIN proxy from ticks: last 50-bar rolling imbalance
  const recent = ticks.slice(-200);
  const rBuy = recent.filter(t => t.side === 1).reduce((s, t) => s + t.size, 0);
  const rSell = recent.filter(t => t.side === -1).reduce((s, t) => s + t.size, 0);
  const rTotal = rBuy + rSell;
  const recentImbalance = rTotal > 0 ? Math.abs(rBuy - rSell) / rTotal : 0;
  const highInformed = recentImbalance > 0.35;

  if (buyPct > 62 && hasIcebergSig) {
    return {
      verdict: "HIDDEN BUYERS DETECTED",
      detail: "Large orders are being broken into small pieces to avoid moving the price — a classic sign of an institution quietly buying. The total buy volume significantly outweighs selling.",
      color: "#10b981",
      action: "A buyer is working a large position. If this continues into the close, the stock often moves up in the following days.",
    };
  }
  if (buyPct < 38 && hasIcebergSig) {
    return {
      verdict: "HIDDEN SELLERS DETECTED",
      detail: "A large seller is distributing shares in small pieces to minimise their price impact. Sell volume is significantly higher than buying.",
      color: "#ef4444",
      action: "Someone with a large position is quietly exiting. This selling pressure often keeps the price suppressed until they're done.",
    };
  }
  if (highInformed && buyPct > 58) {
    return {
      verdict: "INFORMED BUYING",
      detail: "Recent trades are heavily skewed toward buyers, and the imbalance is statistically significant. This suggests participants who know something — not random retail trading.",
      color: "#10b981",
      action: "Bullish signal. Check if there's recent news or upcoming events. Informed flow often precedes a price move within 1-3 days.",
    };
  }
  if (highInformed && buyPct < 42) {
    return {
      verdict: "INFORMED SELLING",
      detail: "Recent trades are heavily skewed toward sellers. Participants appear to be exiting with conviction, not reacting to random noise.",
      color: "#ef4444",
      action: "Bearish signal. Wait for the selling pressure to normalize before considering a long position.",
    };
  }
  if (buyPct > 55) {
    return {
      verdict: "MODERATE BUY PRESSURE",
      detail: `Buyers have a slight edge today — ${buyPct.toFixed(0)}% of volume was buyer-initiated. Not dramatic, but the market is leaning bullish.`,
      color: "#10b981",
      action: "Mild positive flow. Not a strong signal on its own, but confirms the bullish side is more active.",
    };
  }
  if (buyPct < 45) {
    return {
      verdict: "MODERATE SELL PRESSURE",
      detail: `Sellers have a slight edge — ${(100 - buyPct).toFixed(0)}% of volume was seller-initiated. Market is leaning bearish today.`,
      color: "#ef4444",
      action: "Mild negative flow. Not alarming, but sellers are more active than buyers.",
    };
  }
  return {
    verdict: "BALANCED FLOW",
    detail: `Buyers and sellers are roughly equal today (${buyPct.toFixed(0)}% buys). No strong directional signal from the order flow.`,
    color: "#6b7280",
    action: "No actionable signal from microstructure today. Use other analysis (fundamentals, trend) to make decisions.",
  };
}

// ── Plain-English metric card ──────────────────────────────────────────────
function MetricBlock({
  label, value, valueColor, explanation, tooltipText,
}: {
  label: string; value: string; valueColor: string;
  explanation: string; tooltipText: string;
}) {
  const [showTip, setShowTip] = useState(false);
  return (
    <div style={{
      background: "#0d1117", border: "1px solid #21262d", borderRadius: 8,
      padding: "16px 18px", flex: 1, minWidth: 160, position: "relative",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <span style={{
          fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.5)",
          letterSpacing: "0.06em", textTransform: "uppercase" as const, flex: 1,
        }}>{label}</span>
        <span
          style={{
            fontSize: 9, color: "rgba(255,255,255,0.2)", border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: "50%", width: 16, height: 16, display: "flex", alignItems: "center",
            justifyContent: "center", cursor: "default", flexShrink: 0,
          }}
          onMouseEnter={() => setShowTip(true)}
          onMouseLeave={() => setShowTip(false)}
        >?</span>
        {showTip && (
          <div style={{
            position: "absolute", top: "100%", right: 0, zIndex: 200,
            background: "#0d1117", border: "1px solid #30363d", borderRadius: 6,
            padding: "10px 14px", fontSize: 10, color: "rgba(255,255,255,0.65)",
            width: 240, lineHeight: 1.6, marginTop: 4, boxShadow: "0 8px 24px rgba(0,0,0,0.6)",
          }}>{tooltipText}</div>
        )}
      </div>
      <div style={{ fontSize: 28, fontWeight: 800, color: valueColor, fontFamily: "monospace", marginBottom: 8, lineHeight: 1 }}>
        {value}
      </div>
      <div style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", lineHeight: 1.5 }}>
        {explanation}
      </div>
    </div>
  );
}

// ── Verdict Card ───────────────────────────────────────────────────────────
function VerdictCard({ verdict }: {
  verdict: { verdict: string; detail: string; color: string; action: string } | null;
}) {
  if (!verdict) return null;
  return (
    <div style={{
      background: `${verdict.color}0d`, border: `1px solid ${verdict.color}40`,
      borderRadius: 8, padding: "18px 22px", marginBottom: 24,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <span style={{
          fontSize: 18, fontWeight: 800, color: verdict.color,
          fontFamily: "monospace", letterSpacing: "0.03em",
        }}>{verdict.verdict}</span>
      </div>
      <p style={{ margin: "0 0 12px 0", fontSize: 13, color: "rgba(255,255,255,0.75)", lineHeight: 1.7 }}>
        {verdict.detail}
      </p>
      <div style={{
        fontSize: 11, color: "rgba(255,255,255,0.5)",
        borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: 10, lineHeight: 1.6,
      }}>
        <span style={{ color: "rgba(255,255,255,0.3)", textTransform: "uppercase" as const, letterSpacing: "0.06em", fontSize: 9, fontWeight: 700 }}>
          What this means for you:{" "}
        </span>
        {verdict.action}
      </div>
    </div>
  );
}

// ── Buy/Sell bar chart ─────────────────────────────────────────────────────
function BuySellBars({ ticks }: { ticks: Tick[] }) {
  if (ticks.length === 0) return (
    <div style={{ color: "rgba(255,255,255,0.3)", fontSize: 11, padding: 20, textAlign: "center" }}>
      No data
    </div>
  );

  // Build 5-min bars
  const BAR_MS = 5 * 60 * 1000;
  const barMap = new Map<number, { time: string; buyVol: number; sellVol: number }>();
  for (const t of ticks) {
    const tsMs = new Date(t.ts).getTime();
    const key = Math.floor(tsMs / BAR_MS) * BAR_MS;
    const d = new Date(key);
    const time = `${String(d.getUTCHours() + 2).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
    if (!barMap.has(key)) barMap.set(key, { time, buyVol: 0, sellVol: 0 });
    const b = barMap.get(key)!;
    if (t.side === 1) b.buyVol += t.size;
    else if (t.side === -1) b.sellVol += t.size;
  }
  const bars = [...barMap.values()].sort((a, b) => a.time.localeCompare(b.time));
  const maxVol = Math.max(...bars.map(b => b.buyVol + b.sellVol), 1);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: "rgba(255,255,255,0.3)", marginBottom: 8, fontFamily: "monospace" }}>
        <span>TIME (OSLO)</span>
        <div style={{ display: "flex", gap: 12 }}>
          <span style={{ color: "#10b981" }}>■ BUYERS</span>
          <span style={{ color: "#ef4444" }}>■ SELLERS</span>
          <span>VOL</span>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 2, maxHeight: 320, overflowY: "auto" }}>
        {bars.map((b, i) => {
          const total = b.buyVol + b.sellVol;
          const buyPct = total > 0 ? (b.buyVol / total) * 100 : 50;
          const isImbalanced = buyPct > 65 || buyPct < 35;
          const barWidth = (total / maxVol) * 100;
          return (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", width: 38, fontFamily: "monospace", flexShrink: 0 }}>
                {b.time}
              </span>
              <div style={{ flex: 1, height: 12, borderRadius: 2, overflow: "hidden", display: "flex", background: "#1a1f26", opacity: barWidth < 8 ? 0.4 : 1 }}>
                <div style={{ width: `${buyPct}%`, background: "#10b981" }} />
                <div style={{ width: `${100 - buyPct}%`, background: "#ef4444" }} />
              </div>
              <span style={{
                fontSize: 9, width: 44, textAlign: "right", fontFamily: "monospace", flexShrink: 0,
                color: isImbalanced ? (buyPct > 65 ? "#10b981" : "#ef4444") : "rgba(255,255,255,0.25)",
                fontWeight: isImbalanced ? 700 : 400,
              }}>
                {total >= 1000 ? `${(total / 1000).toFixed(0)}K` : total > 0 ? String(total) : "—"}
              </span>
            </div>
          );
        })}
      </div>
      <div style={{ marginTop: 10, fontSize: 10, color: "rgba(255,255,255,0.35)", lineHeight: 1.6 }}>
        Bars where one side has over 65% of volume are highlighted — these 5-minute windows show where buyers or sellers had clear control.
      </div>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────
export default function FlowPage() {
  const [selectedTicker, setSelectedTicker] = useState("EQNR");
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [availableDates, setAvailableDates] = useState<DateEntry[]>([]);
  const [ticks, setTicks] = useState<Tick[]>([]);
  const [signal, setSignal] = useState<TickerSignal | null>(null);
  const [icebergs, setIcebergs] = useState<any[]>([]);
  const [icebergSort, setIcebergSort] = useState<"date" | "volume" | "conf">("date");
  const [icebergScope, setIcebergScope] = useState<"today" | "all">("today");
  const [loading, setLoading] = useState(true);

  // Live mode state (EQNR only)
  const [liveMode, setLiveMode] = useState(false);
  const [liveLastUpdate, setLiveLastUpdate] = useState<Date | null>(null);
  const [liveLastTradeTime, setLiveLastTradeTime] = useState<string | null>(null);
  const [liveCountdown, setLiveCountdown] = useState(LIVE_REFRESH_SEC);
  const liveIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const liveCountdownRef = useRef<NodeJS.Timeout | null>(null);
  const autoLiveApplied = useRef(false); // prevent re-triggering on re-renders

  // Load available dates for ticker — auto-enables live mode if today is the latest date
  const loadDates = useCallback(async (ticker: string) => {
    try {
      const res = await fetch(`/api/flow/dates?ticker=${ticker}`);
      if (!res.ok) return;
      const d = await res.json();
      const dates: DateEntry[] = d.dates || [];
      setAvailableDates(dates);

      const today = getTodayOslo();
      const latestDate = dates[0]?.date ?? "";
      const isToday = latestDate === today;

      // Auto-enable live mode on first load if: today has data and market is open (all 5 tickers)
      if (!autoLiveApplied.current && isToday && isOsloMarketOpen()) {
        autoLiveApplied.current = true;
        setLiveMode(true);
        // Don't set selectedDate — live mode doesn't use it
      } else if (dates.length > 0) {
        setSelectedDate(dates[0].date);
      } else {
        setSelectedDate("");
      }
    } catch { setAvailableDates([]); setSelectedDate(""); }
  }, []);

  // Load ticks + signal for selected ticker+date
  const loadData = useCallback(async (ticker: string, date: string) => {
    if (!date) { setTicks([]); setLoading(false); return; }
    setLoading(true);

    // Run fetches independently so one failure doesn't kill the others
    const [tickRes, sigRes, iceRes] = await Promise.allSettled([
      fetch(`/api/flow/ticks/${ticker}?date=${date}&limit=20000`),
      fetch(`/api/flow/signals/${ticker}`),
      // Always fetch 30 days so scope toggle works client-side without refetch
      fetch(`/api/flow/icebergs/${ticker}?days=30`),
    ]);

    try {
      if (tickRes.status === "fulfilled" && tickRes.value.ok) {
        const d = await tickRes.value.json();
        setTicks(d.ticks || []);
      } else setTicks([]);
    } catch { setTicks([]); }

    try {
      if (sigRes.status === "fulfilled" && sigRes.value.ok) {
        setSignal(await sigRes.value.json());
      } else setSignal(null);
    } catch { setSignal(null); }

    try {
      if (iceRes.status === "fulfilled" && iceRes.value.ok) {
        const d = await iceRes.value.json();
        setIcebergs(d.detections || []);
      } else setIcebergs([]);
    } catch { setIcebergs([]); }

    setLoading(false);
  }, []);

  // Live fetch — hits Euronext directly, no DB (all 5 tickers supported)
  // Only show full loading spinner on first fetch; subsequent polls are silent
  const loadLive = useCallback(async (ticker: string, isFirstLoad = false) => {
    if (isFirstLoad) setLoading(true);
    try {
      const res = await fetch(`/api/flow/live/${ticker}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json();
      setTicks(d.ticks || []);
      setLiveLastUpdate(new Date());
      setLiveLastTradeTime(d.lastTradeTime);
      setLiveCountdown(LIVE_REFRESH_SEC);
    } catch {
      // keep existing ticks on failure
    }
    if (isFirstLoad) setLoading(false);
  }, []);

  // Start/stop live mode — works for all 5 tickers
  useEffect(() => {
    if (liveIntervalRef.current) clearInterval(liveIntervalRef.current);
    if (liveCountdownRef.current) clearInterval(liveCountdownRef.current);

    if (!liveMode) return;

    loadLive(selectedTicker, true); // first load shows spinner

    liveIntervalRef.current = setInterval(() => loadLive(selectedTicker, false), LIVE_REFRESH_SEC * 1000);
    liveCountdownRef.current = setInterval(() => {
      setLiveCountdown(c => (c <= 1 ? LIVE_REFRESH_SEC : c - 1));
    }, 1000);

    return () => {
      if (liveIntervalRef.current) clearInterval(liveIntervalRef.current);
      if (liveCountdownRef.current) clearInterval(liveCountdownRef.current);
    };
  }, [liveMode, selectedTicker, loadLive]);

  useEffect(() => { loadDates(selectedTicker); }, [selectedTicker, loadDates]);
  useEffect(() => {
    if (liveMode) return; // live mode handles its own fetching
    if (selectedDate) loadData(selectedTicker, selectedDate);
  }, [selectedTicker, selectedDate, loadData, liveMode]);

  // Derived stats from ticks
  const totalBuy = ticks.filter(t => t.side === 1).reduce((s, t) => s + t.size, 0);
  const totalSell = ticks.filter(t => t.side === -1).reduce((s, t) => s + t.size, 0);
  const totalVol = totalBuy + totalSell;
  const buyPct = totalVol > 0 ? (totalBuy / totalVol) * 100 : 50;
  const netOFI = totalBuy - totalSell;
  const tradeCount = ticks.length;
  const avgTradeSize = tradeCount > 0 ? Math.round(totalVol / tradeCount) : 0;
  const prices = ticks.map(t => t.price).filter(Boolean);
  const priceRange = prices.length > 1
    ? `${Math.min(...prices).toFixed(2)} – ${Math.max(...prices).toFixed(2)}`
    : "—";
  const vwap = ticks.length > 0
    ? ticks.reduce((s, t) => s + t.price * t.size, 0) / ticks.reduce((s, t) => s + t.size, 0)
    : 0;

  const verdict = getVerdict(ticks);

  // In live mode: run iceberg detection on the current live ticks client-side
  // Estimate ADV from session volume extrapolated to full 8.5h trading day
  const liveIcebergs = useMemo(() => {
    if (!liveMode || ticks.length === 0) return [];
    // Convert string-ts ticks to Date objects for the lib
    const libTicks = ticks.map(t => ({
      ts: new Date(new Date(t.ts).getTime() - 15 * 60 * 1000), // undo the 15-min delay offset
      price: t.price,
      size: t.size,
      side: t.side,
    }));
    // Estimate ADV: scale session volume to full 8.5h trading day
    const sessionVol = ticks.reduce((s, t) => s + t.size, 0);
    const sessionMs = ticks.length > 1
      ? new Date(ticks[ticks.length - 1].ts).getTime() - new Date(ticks[0].ts).getTime()
      : 1;
    const fullDayMs = 8.5 * 3600 * 1000;
    const advEst = sessionMs > 0 ? Math.round(sessionVol * (fullDayMs / sessionMs)) : sessionVol * 3;

    const raw = detectIcebergs(libTicks, advEst, 60_000, 5, 10_000);
    // Convert IcebergDetection → IcebergCard shape (DB snake_case)
    return raw.map(d => ({
      detected_at: d.startTs.toISOString(),
      start_ts: d.startTs.toISOString(),
      end_ts: d.endTs.toISOString(),
      direction: d.direction,
      total_volume: d.totalVolume,
      trade_count: d.tradeCount,
      avg_trade_size: Math.round(d.avgTradeSize),
      median_trade_size: Math.round(d.medianTradeSize),
      price_range_bps: d.priceRangeBps,
      vwap: d.vwap,
      est_block_pct: d.estBlockPct,
      detection_method: d.method,
      confidence: d.confidence,
    }));
  }, [liveMode, ticks]);

  return (
    <div style={{ minHeight: "100vh", background: "#0a0a0a", color: "#fff", fontFamily: "monospace" }}>
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "24px 24px" }}>

        {/* Header */}
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: 20, fontWeight: 800, margin: "0 0 6px 0", letterSpacing: "0.04em" }}>
            <span style={{ color: ACCENT }}>ORDER FLOW</span> ANALYSIS
          </h1>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", lineHeight: 1.5 }}>
            Detects hidden buyers/sellers and institutional activity from real Oslo Børs trade data.
          </div>
        </div>

        {/* Ticker + Date Selector */}
        <div style={{ display: "flex", gap: 10, marginBottom: 24, flexWrap: "wrap", alignItems: "center" }}>
          {TICKERS.map(t => (
            <button key={t}
              onClick={() => { setSelectedTicker(t); if (liveMode) setTicks([]); }}
              style={{
                padding: "8px 20px", borderRadius: 6, fontSize: 12, fontWeight: 700,
                fontFamily: "monospace",
                border: `1px solid ${selectedTicker === t ? ACCENT : "#30363d"}`,
                background: selectedTicker === t ? `${ACCENT}18` : "#161b22",
                color: selectedTicker === t ? ACCENT : "rgba(255,255,255,0.6)",
                cursor: "pointer",
              }}>
              {t}
            </button>
          ))}

          {/* LIVE button — all 5 tickers */}
          {(
            <button
              onClick={() => setLiveMode(m => !m)}
              style={{
                padding: "8px 16px", borderRadius: 6, fontSize: 11, fontWeight: 700,
                fontFamily: "monospace", letterSpacing: "0.06em",
                border: `1px solid ${liveMode ? "#10b981" : "#30363d"}`,
                background: liveMode ? "rgba(16,185,129,0.12)" : "#161b22",
                color: liveMode ? "#10b981" : "rgba(255,255,255,0.4)",
                cursor: "pointer",
                display: "flex", alignItems: "center", gap: 6,
              }}>
              <span style={{
                width: 7, height: 7, borderRadius: "50%",
                background: liveMode ? "#10b981" : "#30363d",
                display: "inline-block",
                animation: liveMode ? "livePulse 1.5s ease-in-out infinite" : "none",
              }} />
              {liveMode ? `LIVE — next in ${liveCountdown}s` : "LIVE"}
            </button>
          )}

          {/* Date picker — hidden in live mode */}
          {!liveMode && availableDates.length > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: "auto" }}>
              <span style={{ fontSize: 10, color: "rgba(255,255,255,0.35)" }}>DATE:</span>
              <select
                value={selectedDate}
                onChange={e => setSelectedDate(e.target.value)}
                style={{
                  background: "#161b22", border: "1px solid #30363d", borderRadius: 4,
                  color: "#e6edf3", fontSize: 11, padding: "5px 10px", fontFamily: "monospace",
                  cursor: "pointer",
                }}
              >
                {availableDates.map(d => (
                  <option key={d.date} value={d.date}>
                    {d.date} ({d.tick_count.toLocaleString()} trades)
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Live status */}
          {liveMode && liveLastUpdate && (
            <div style={{ marginLeft: "auto", fontSize: 10, color: "rgba(255,255,255,0.35)", fontFamily: "monospace" }}>
              {liveLastTradeTime && (
                <span>
                  last trade{" "}
                  <span style={{ color: "#10b981" }}>
                    {new Date(liveLastTradeTime).toLocaleTimeString("no-NO", { timeZone: "Europe/Oslo", hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                  </span>
                  {" "}Oslo · 15-min delayed
                </span>
              )}
            </div>
          )}

          {signal && !liveMode && <FlowRegimeBadge regime={signal.regime || "neutral"} />}
        </div>

        {/* No data state */}
        {!loading && ticks.length === 0 && (
          <div style={{ background: "#161b22", border: "1px solid #30363d", borderRadius: 8, padding: 40, textAlign: "center" }}>
            <div style={{ fontSize: 14, color: "rgba(255,255,255,0.4)", marginBottom: 12 }}>
              No tick data for {selectedTicker}
            </div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.25)", lineHeight: 1.8 }}>
              To load data, run in terminal from <code style={{ color: ACCENT }}>InEqRe_OBX/apps/web/</code>:
              <br />
              <code style={{ color: ACCENT, background: "#0d1117", padding: "4px 10px", borderRadius: 4, display: "inline-block", marginTop: 6 }}>
                pnpm run flow:fetch -- --ticker {selectedTicker}
              </code>
            </div>
          </div>
        )}

        {loading && (
          <div style={{ textAlign: "center", padding: 80, color: "rgba(255,255,255,0.3)", fontSize: 12 }}>
            {liveMode
              ? `Fetching today's EQNR trades from Euronext (15-min delayed)...`
              : `Loading ${selectedTicker} trades for ${selectedDate}...`}
          </div>
        )}

        {!loading && ticks.length > 0 && (
          <>
            {/* ── VERDICT ─────────────────────────────────────────────── */}
            <VerdictCard verdict={verdict} />

            {/* ── SESSION SUMMARY ──────────────────────────────────────── */}
            <div style={{ display: "flex", gap: 10, marginBottom: 24, flexWrap: "wrap" }}>
              <MetricBlock
                label="Buy vs Sell Split"
                value={`${buyPct.toFixed(0)}% BUY`}
                valueColor={buyPct > 53 ? "#10b981" : buyPct < 47 ? "#ef4444" : "#6b7280"}
                explanation={
                  buyPct > 55 ? "More shares were bought than sold today — buyers were in control."
                  : buyPct < 45 ? "More shares were sold than bought — sellers were in control."
                  : "Buying and selling were roughly equal — no strong directional bias."
                }
                tooltipText="Of all trades where we could identify direction, what percentage were buyer-initiated (someone hitting the ask) vs seller-initiated (someone hitting the bid). Above 55% = buyers dominating. Below 45% = sellers dominating."
              />
              <MetricBlock
                label="Net Buy Pressure"
                value={netOFI > 0 ? `+${(netOFI / 1000).toFixed(0)}K` : `${(netOFI / 1000).toFixed(0)}K`}
                valueColor={netOFI > 0 ? "#10b981" : netOFI < 0 ? "#ef4444" : "#6b7280"}
                explanation={
                  netOFI > 0
                    ? `${(netOFI / 1000).toFixed(0)}K more shares were bought than sold today.`
                    : `${(Math.abs(netOFI) / 1000).toFixed(0)}K more shares were sold than bought today.`
                }
                tooltipText="Order Flow Imbalance (OFI): the difference between buyer-initiated volume and seller-initiated volume. If buyers bought 300K shares and sellers sold 200K, the OFI is +100K. A large positive number means strong net demand."
              />
              <MetricBlock
                label="Trades Analysed"
                value={tradeCount.toLocaleString()}
                valueColor="#e6edf3"
                explanation={`${tradeCount.toLocaleString()} individual trades on ${selectedDate}. Avg trade size: ${avgTradeSize.toLocaleString()} shares.`}
                tooltipText="Total number of individual trade executions (prints) for this stock on this day. Each tick is one transaction between a buyer and a seller."
              />
              <MetricBlock
                label="VWAP"
                value={vwap > 0 ? vwap.toFixed(2) : "—"}
                valueColor="#e6edf3"
                explanation={`Volume-weighted average price for the day. Range: ${priceRange} NOK.`}
                tooltipText="VWAP (Volume-Weighted Average Price): the average price paid for the stock today, weighted by how much was traded at each price. Institutions use this as a benchmark — buying below VWAP is considered a 'good' execution."
              />
            </div>

            {/* ── PRICE + OFI CHART ────────────────────────────────────── */}
            <div style={{ background: "#161b22", border: "1px solid #30363d", borderRadius: 8, padding: 20, marginBottom: 20 }}>
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#fff", marginBottom: 4 }}>
                  Price, Volume & Net Buying Pressure
                </div>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", lineHeight: 1.6 }}>
                  The <span style={{ color: "#e6edf3", fontWeight: 600 }}>white line</span> is the stock price.
                  {" "}<span style={{ color: "#10b981", fontWeight: 600 }}>Green bars</span> show buyer volume and{" "}
                  <span style={{ color: "#ef4444", fontWeight: 600 }}>red bars</span> show seller volume each 5 minutes.
                  {" "}The <span style={{ color: ACCENT, fontWeight: 600 }}>cyan line</span> is cumulative net buying — it rises when buyers outweigh sellers cumulatively.
                  {" "}When the cyan line rises but price dips, it often means buyers are absorbing a temporary sell-off.
                </div>
              </div>
              <FlowPriceChart ticks={ticks} />
            </div>

            {/* ── WHO IS TRADING? ──────────────────────────────────────── */}
            <div style={{ background: "#161b22", border: "1px solid #30363d", borderRadius: 8, padding: 20, marginBottom: 20 }}>
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#fff", marginBottom: 4 }}>
                  Who Is Moving the Price?
                </div>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", lineHeight: 1.6 }}>
                  Each trade is classified by type — dark pool blocks, institutions building positions, algos, momentum traders, and retail. Click any row to understand what that type means and what today&apos;s direction tells you.
                </div>
              </div>
              <TradeTypeBreakdown ticks={ticks} />
            </div>

            {/* ── 2-COL: BUY/SELL BARS + ICEBERGS ─────────────────────── */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }}>
              <div style={{ background: "#161b22", border: "1px solid #30363d", borderRadius: 8, padding: 18 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#fff", marginBottom: 4 }}>
                  Who Was in Control Each 5 Minutes?
                </div>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginBottom: 14, lineHeight: 1.6 }}>
                  Each bar shows one 5-minute window. Mostly green = buyers had more volume. Mostly red = sellers. Look for runs of consecutive green or red — that&apos;s when directional pressure was sustained.
                </div>
                <BuySellBars ticks={ticks} />
              </div>

              <div style={{ background: "#161b22", border: "1px solid #30363d", borderRadius: 8, padding: 18 }}>
                {/* Header + controls */}
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#fff", flex: 1 }}>
                    Hidden Large Orders (Icebergs)
                  </div>
                  {/* Scope toggle */}
                  {(["today", "all"] as const).map(s => (
                    <button key={s} onClick={() => setIcebergScope(s)} style={{
                      padding: "3px 9px", borderRadius: 4, fontSize: 9, fontWeight: 700,
                      fontFamily: "monospace", letterSpacing: "0.05em",
                      border: `1px solid ${icebergScope === s ? ACCENT : "#30363d"}`,
                      background: icebergScope === s ? `${ACCENT}15` : "#0d1117",
                      color: icebergScope === s ? ACCENT : "rgba(255,255,255,0.35)",
                      cursor: "pointer",
                    }}>
                      {s === "today" ? "TODAY" : "30 DAYS"}
                    </button>
                  ))}
                  {/* Sort toggle */}
                  {(["date", "volume", "conf"] as const).map(s => (
                    <button key={s} onClick={() => setIcebergSort(s)} style={{
                      padding: "3px 9px", borderRadius: 4, fontSize: 9, fontWeight: 700,
                      fontFamily: "monospace", letterSpacing: "0.05em",
                      border: `1px solid ${icebergSort === s ? "#f59e0b" : "#30363d"}`,
                      background: icebergSort === s ? "rgba(245,158,11,0.1)" : "#0d1117",
                      color: icebergSort === s ? "#f59e0b" : "rgba(255,255,255,0.35)",
                      cursor: "pointer",
                    }}>
                      {s === "date" ? "DATE" : s === "volume" ? "VOL" : "CONF"}
                    </button>
                  ))}
                </div>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginBottom: 14, lineHeight: 1.6 }}>
                  Min 10K shares. <strong style={{ color: "rgba(255,255,255,0.6)" }}>Size uniformity</strong> (algo footprint) and <strong style={{ color: "rgba(255,255,255,0.6)" }}>time clustering</strong> (60s window). High conf ≥ 0.65 persists across sessions.
                </div>
                {(() => {
                  // In live mode: use client-side detected icebergs from live ticks
                  // In DB mode: filter by scope
                  const today = selectedDate;
                  const filtered = liveMode
                    ? liveIcebergs
                    : icebergScope === "today"
                    ? icebergs.filter(ice => (ice.start_ts || ice.detected_at || "").slice(0, 10) === today)
                    : icebergs; // "all" keeps 30-day window; high-conf from older dates preserved

                  // Sort
                  const sorted = [...filtered].sort((a, b) => {
                    if (icebergSort === "volume") return b.total_volume - a.total_volume;
                    if (icebergSort === "conf") return b.confidence - a.confidence;
                    // date: newest first
                    return new Date(b.start_ts || b.detected_at).getTime() - new Date(a.start_ts || a.detected_at).getTime();
                  });

                  if (sorted.length === 0) return (
                    <div style={{ color: "rgba(255,255,255,0.25)", fontSize: 11, padding: "30px 0", textAlign: "center", lineHeight: 1.8 }}>
                      {liveMode
                        ? "No icebergs ≥10K shares detected in today's live feed yet."
                        : icebergScope === "today"
                        ? `No icebergs ≥10K shares detected for ${today}.`
                        : "No icebergs in the last 30 days."}
                      <br />
                      {!liveMode && <span style={{ fontSize: 10 }}>Run the backtest pipeline to detect icebergs from stored tick data.</span>}
                    </div>
                  );

                  return (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {sorted.slice(0, 10).map((ice: any, i: number) => (
                        <IcebergCard key={i} detection={ice} />
                      ))}
                      {sorted.length > 10 && (
                        <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", textAlign: "center", padding: "4px 0" }}>
                          +{sorted.length - 10} more ({liveMode ? "live session" : icebergScope === "today" ? "today" : "30-day window"})
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            </div>

            {/* ── RECENT TRADES TAPE ───────────────────────────────────── */}
            <div style={{ background: "#161b22", border: "1px solid #30363d", borderRadius: 8, padding: 18, marginBottom: 20 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#fff", marginBottom: 4 }}>
                Last 200 Individual Trades
              </div>
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginBottom: 12, lineHeight: 1.6 }}>
                Every row is one single transaction.{" "}
                <span style={{ color: "#10b981" }}>Green = buyer came to the market</span> (they paid the ask price, showing urgency).{" "}
                <span style={{ color: "#ef4444" }}>Red = seller came to the market</span> (they hit the bid, accepting less than the mid-price).
                Large trades (big volume) are worth watching — they often indicate institutional activity.
              </div>
              <TradeTape ticks={ticks.slice(-200)} isLive={liveMode} />
            </div>

            {/* ── METHODOLOGY ──────────────────────────────────────────── */}
            <details>
              <summary style={{ fontSize: 10, color: "rgba(255,255,255,0.25)", cursor: "pointer", padding: "6px 0", letterSpacing: "0.04em" }}>
                ▸ How does this work? (methodology)
              </summary>
              <div style={{
                background: "#0d1117", border: "1px solid #21262d", borderRadius: 6,
                padding: 16, marginTop: 8, fontSize: 10, color: "rgba(255,255,255,0.4)", lineHeight: 1.9,
              }}>
                <p style={{ margin: "0 0 8px 0" }}>
                  <strong style={{ color: "rgba(255,255,255,0.6)" }}>Data source:</strong>{" "}
                  Euronext Live trade feed for Oslo Børs. Every individual trade execution is captured — the same raw data used by professional market microstructure desks.
                </p>
                <p style={{ margin: "0 0 8px 0" }}>
                  <strong style={{ color: "rgba(255,255,255,0.6)" }}>Trade direction (tick rule):</strong>{" "}
                  We don&apos;t have real-time quotes, so we use the tick rule: if a trade happened at a higher price than the previous trade, it was buyer-initiated; if lower, seller-initiated. This is ~85% accurate on liquid stocks.
                </p>
                <p style={{ margin: "0 0 8px 0" }}>
                  <strong style={{ color: "rgba(255,255,255,0.6)" }}>Iceberg detection:</strong>{" "}
                  We look for clusters of trades with suspiciously similar sizes at the same price level — the signature of an algorithm splitting a large block order to hide its size.
                </p>
                <p style={{ margin: 0 }}>
                  <strong style={{ color: "rgba(255,255,255,0.6)" }}>Limitations:</strong>{" "}
                  Live mode polls Euronext every 60 seconds and is 15 minutes delayed (Euronext policy). Historical data is fetched by cron every 5 minutes during market hours for EQNR, and once at day-end for all 5 tickers. Dark trades and auction prints are filtered out — only real on-exchange continuous trades are shown. The models are statistical — not every signal plays out as expected.
                </p>
              </div>
            </details>
          </>
        )}
      </div>
      <style>{`
        details summary::-webkit-details-marker { display: none; }
        @keyframes livePulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.4; transform: scale(1.4); }
        }
      `}</style>
    </div>
  );
}
