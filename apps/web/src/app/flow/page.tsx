"use client";

import { useState, useEffect, useCallback } from "react";
import FlowPriceChart from "@/components/flow/FlowPriceChart";
import FlowRegimeBadge from "@/components/flow/FlowRegimeBadge";
import TradeTape from "@/components/flow/TradeTape";
import IcebergCard from "@/components/flow/IcebergCard";

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
  const [loading, setLoading] = useState(true);

  // Load available dates for ticker
  const loadDates = useCallback(async (ticker: string) => {
    try {
      const res = await fetch(`/api/flow/dates?ticker=${ticker}`);
      if (!res.ok) return;
      const d = await res.json();
      const dates: DateEntry[] = d.dates || [];
      setAvailableDates(dates);
      if (dates.length > 0) setSelectedDate(dates[0].date);
      else setSelectedDate("");
    } catch { setAvailableDates([]); setSelectedDate(""); }
  }, []);

  // Load ticks + signal for selected ticker+date
  const loadData = useCallback(async (ticker: string, date: string) => {
    if (!date) { setTicks([]); setLoading(false); return; }
    setLoading(true);
    try {
      const [tickRes, sigRes, iceRes] = await Promise.all([
        fetch(`/api/flow/ticks/${ticker}?date=${date}&limit=20000`),
        fetch(`/api/flow/signals/${ticker}`),
        fetch(`/api/flow/icebergs/${ticker}?days=30`),
      ]);
      if (tickRes.ok) {
        const d = await tickRes.json();
        setTicks(d.ticks || []);
      } else setTicks([]);
      if (sigRes.ok) setSignal(await sigRes.json());
      else setSignal(null);
      if (iceRes.ok) { const d = await iceRes.json(); setIcebergs(d.detections || []); }
      else setIcebergs([]);
    } catch { setTicks([]); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadDates(selectedTicker); }, [selectedTicker, loadDates]);
  useEffect(() => { if (selectedDate) loadData(selectedTicker, selectedDate); }, [selectedTicker, selectedDate, loadData]);

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
            <button key={t} onClick={() => setSelectedTicker(t)}
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

          {/* Date picker */}
          {availableDates.length > 0 && (
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

          {signal && <FlowRegimeBadge regime={signal.regime || "neutral"} />}
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
            Loading {selectedTicker} trades for {selectedDate}...
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
                <div style={{ fontSize: 13, fontWeight: 700, color: "#fff", marginBottom: 4 }}>
                  Hidden Large Orders (Icebergs)
                </div>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginBottom: 14, lineHeight: 1.6 }}>
                  Institutions hide large orders by splitting them into many small trades of similar size. We detect this pattern. A hidden buy iceberg means someone is accumulating without revealing their full size.
                </div>
                {icebergs.length === 0 ? (
                  <div style={{ color: "rgba(255,255,255,0.25)", fontSize: 11, padding: "30px 0", textAlign: "center", lineHeight: 1.8 }}>
                    No iceberg orders detected in the last 30 days.
                    <br />
                    <span style={{ fontSize: 10 }}>This is normal — icebergs occur in roughly 5–15% of trading sessions.</span>
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {icebergs.slice(0, 5).map((ice: any, i: number) => (
                      <IcebergCard key={i} detection={ice} />
                    ))}
                  </div>
                )}
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
              <TradeTape ticks={ticks.slice(-200)} />
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
                  Data is fetched once per day (not real-time). Dark trades and auction prints may affect classification accuracy. The models are statistical — not every signal plays out as expected.
                </p>
              </div>
            </details>
          </>
        )}
      </div>
      <style>{`details summary::-webkit-details-marker { display: none; }`}</style>
    </div>
  );
}
