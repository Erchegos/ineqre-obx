"use client";

import { useState, useEffect, useCallback } from "react";
import FlowPriceChart from "@/components/flow/FlowPriceChart";
import FlowRegimeBadge from "@/components/flow/FlowRegimeBadge";
import VPINChart from "@/components/flow/VPINChart";
import TradeTape from "@/components/flow/TradeTape";
import IcebergCard from "@/components/flow/IcebergCard";

// ── Types ──────────────────────────────────────────────────────────────────
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

const ACCENT = "#00e5ff";

const TICKERS = ["EQNR", "DNB", "MOWI", "YAR", "TEL"];

// ── Verdict logic ──────────────────────────────────────────────────────────
// Translates raw signals into a plain-English headline + what it means
function getVerdict(signal: TickerSignal | null, bars: any[], icebergs: any[]) {
  if (!signal) return null;

  const { vpin, ofiCumulative, toxicity, regime, kyleLambda, blockAlert } = signal;

  const buyPressure = ofiCumulative > 5000;
  const sellPressure = ofiCumulative < -5000;
  const highToxicity = toxicity >= 60;
  const elevatedVpin = vpin >= 0.5;
  const recentIceberg = icebergs.some(
    (ice: any) => Date.now() - new Date(ice.detected_at).getTime() < 60 * 60 * 1000
  );

  // Determine bars flow dominance (last 10 bars)
  const recent = bars.slice(-10);
  const totalBuy = recent.reduce((s: number, b: any) => s + (b.buy_volume || 0), 0);
  const totalSell = recent.reduce((s: number, b: any) => s + (b.sell_volume || 0), 0);
  const buyDom = totalBuy / (totalBuy + totalSell + 1);

  if (blockAlert && buyPressure) {
    return {
      verdict: "HIDDEN BUYERS DETECTED",
      detail:
        "A large institutional buyer appears to be active — splitting orders to avoid moving the price. Cumulative buy pressure is building.",
      color: "#10b981",
      icon: "🟢",
      action: "Monitor for continued accumulation. If price holds or rises on declining sell volume, a breakout may follow.",
    };
  }
  if (blockAlert && sellPressure) {
    return {
      verdict: "HIDDEN SELLERS DETECTED",
      detail:
        "A large seller is distributing into the market — slicing orders to minimise impact. Cumulative sell pressure is elevated.",
      color: "#ef4444",
      icon: "🔴",
      action: "Reduce exposure or hedge. This pattern often precedes a drift lower as the seller works their position.",
    };
  }
  if (regime === "informed_buying" || (highToxicity && buyPressure)) {
    return {
      verdict: "INFORMED BUYING",
      detail:
        "Flow toxicity is elevated and buy-side imbalance is significant. This typically indicates participants trading on information or strong conviction.",
      color: "#10b981",
      icon: "🟢",
      action:
        "This is a bullish signal. Consider the flow in context of any recent news or catalyst. High toxicity buying often precedes a meaningful move.",
    };
  }
  if (regime === "informed_selling" || (highToxicity && sellPressure)) {
    return {
      verdict: "INFORMED SELLING",
      detail:
        "Elevated toxicity combined with sell-side flow imbalance. Smart money appears to be exiting.",
      color: "#ef4444",
      icon: "🔴",
      action: "Be cautious. Informed selling pressure tends to persist until the seller is done. Wait for flow to normalise before entering long.",
    };
  }
  if (recentIceberg && buyDom > 0.55) {
    return {
      verdict: "INSTITUTIONAL ACCUMULATION",
      detail:
        "An iceberg order (large order hidden as small trades) was detected in the last hour with net buy flow dominant.",
      color: "#10b981",
      icon: "🟢",
      action: "Buy interest is being absorbed quietly. Watch for price to break higher once the accumulation phase completes.",
    };
  }
  if (recentIceberg && buyDom < 0.45) {
    return {
      verdict: "INSTITUTIONAL DISTRIBUTION",
      detail:
        "Hidden sell orders detected in the last hour with sell flow dominant. An institution is quietly exiting a position.",
      color: "#ef4444",
      icon: "🔴",
      action: "Avoid buying dips here. Distribution can last hours. The stock is likely to underperform until the seller is done.",
    };
  }
  if (elevatedVpin && !highToxicity) {
    return {
      verdict: "ELEVATED UNCERTAINTY",
      detail:
        "Trade arrival is accelerating (high VPIN) but without strong directional bias. Market participants are disagreeing on value.",
      color: "#f59e0b",
      icon: "🟡",
      action: "Be patient. The market is indecisive. Wait for a clear directional signal before committing.",
    };
  }
  return {
    verdict: "NORMAL FLOW",
    detail:
      "No unusual activity detected. Order flow is balanced and toxicity is low — typical retail-driven trading.",
    color: "#6b7280",
    icon: "⚪",
    action: "Nothing actionable from microstructure. Base decisions on fundamentals and broader trend.",
  };
}

// ── Metric explanations ────────────────────────────────────────────────────
function metricExplain(key: string, value: number | null): { short: string; color: string } {
  if (value == null) return { short: "No data", color: "#6b7280" };
  switch (key) {
    case "vpin":
      if (value >= 0.7) return { short: "Very high informed trading activity", color: "#ef4444" };
      if (value >= 0.5) return { short: "Elevated — watch for directional move", color: "#f59e0b" };
      return { short: "Low — mostly passive/retail flow", color: "#10b981" };
    case "ofi":
      if (value > 20000) return { short: "Strong net buying pressure", color: "#10b981" };
      if (value > 5000) return { short: "Mild net buying", color: "#10b981" };
      if (value < -20000) return { short: "Strong net selling pressure", color: "#ef4444" };
      if (value < -5000) return { short: "Mild net selling", color: "#ef4444" };
      return { short: "Balanced — no directional bias", color: "#6b7280" };
    case "toxicity":
      if (value >= 70) return { short: "High — likely informed or news-driven", color: "#ef4444" };
      if (value >= 40) return { short: "Moderate — some directional intent", color: "#f59e0b" };
      return { short: "Low — normal background flow", color: "#10b981" };
    default:
      return { short: "", color: "#6b7280" };
  }
}

// ── Explained Metric Card ──────────────────────────────────────────────────
function ExplainedMetric({
  label,
  tooltip,
  value,
  explain,
  color,
}: {
  label: string;
  tooltip: string;
  value: string;
  explain: string;
  color: string;
}) {
  const [hover, setHover] = useState(false);
  return (
    <div
      style={{
        background: "#0d1117",
        border: "1px solid #21262d",
        borderRadius: 6,
        padding: "14px 16px",
        flex: 1,
        minWidth: 150,
        position: "relative",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            color: "rgba(255,255,255,0.5)",
            letterSpacing: "0.06em",
            textTransform: "uppercase" as const,
            fontFamily: "monospace",
          }}
        >
          {label}
        </span>
        <span
          style={{
            fontSize: 9,
            color: "rgba(255,255,255,0.25)",
            cursor: "default",
            border: "1px solid rgba(255,255,255,0.15)",
            borderRadius: "50%",
            width: 14,
            height: 14,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
          onMouseEnter={() => setHover(true)}
          onMouseLeave={() => setHover(false)}
        >
          ?
        </span>
        {hover && (
          <div
            style={{
              position: "absolute",
              top: "100%",
              left: 0,
              zIndex: 100,
              background: "#161b22",
              border: "1px solid #30363d",
              borderRadius: 6,
              padding: "8px 12px",
              fontSize: 10,
              color: "rgba(255,255,255,0.7)",
              width: 220,
              lineHeight: 1.5,
              marginTop: 4,
              boxShadow: "0 4px 20px rgba(0,0,0,0.5)",
            }}
          >
            {tooltip}
          </div>
        )}
      </div>
      <div style={{ fontSize: 24, fontWeight: 800, color, fontFamily: "monospace", marginBottom: 6 }}>
        {value}
      </div>
      <div style={{ fontSize: 10, color: "rgba(255,255,255,0.45)", lineHeight: 1.4 }}>{explain}</div>
    </div>
  );
}

// ── Buy/Sell bars ──────────────────────────────────────────────────────────
function BuySellBars({ bars }: { bars: any[] }) {
  const recent = bars.slice(-25);
  if (recent.length === 0)
    return (
      <div style={{ color: "rgba(255,255,255,0.3)", fontSize: 11, padding: 20, textAlign: "center" }}>
        No bar data available
      </div>
    );

  const maxVol = Math.max(...recent.map((b: any) => (b.buy_volume || 0) + (b.sell_volume || 0)), 1);

  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: 9,
          color: "rgba(255,255,255,0.3)",
          marginBottom: 8,
          fontFamily: "monospace",
        }}
      >
        <span>TIME (OSLO)</span>
        <div style={{ display: "flex", gap: 12 }}>
          <span style={{ color: "#10b981" }}>■ BUYERS</span>
          <span style={{ color: "#ef4444" }}>■ SELLERS</span>
          <span>VOL</span>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {recent.map((b: any, i: number) => {
          const total = (b.buy_volume || 0) + (b.sell_volume || 0);
          const buyPct = total > 0 ? ((b.buy_volume || 0) / total) * 100 : 50;
          const barWidth = (total / maxVol) * 100;
          const isImbalanced = buyPct > 65 || buyPct < 35;
          return (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span
                style={{
                  fontSize: 9,
                  color: "rgba(255,255,255,0.35)",
                  width: 38,
                  fontFamily: "monospace",
                  flexShrink: 0,
                }}
              >
                {new Date(b.bar_open_ts).toLocaleTimeString("en-GB", {
                  hour: "2-digit",
                  minute: "2-digit",
                  timeZone: "Europe/Oslo",
                })}
              </span>
              <div
                style={{
                  flex: 1,
                  height: 12,
                  borderRadius: 2,
                  overflow: "hidden",
                  display: "flex",
                  background: "#1a1f26",
                  opacity: barWidth < 10 ? 0.4 : 1,
                  outline: isImbalanced ? "1px solid rgba(255,255,255,0.1)" : "none",
                }}
              >
                <div style={{ width: `${buyPct}%`, background: "#10b981", height: "100%" }} />
                <div style={{ width: `${100 - buyPct}%`, background: "#ef4444", height: "100%" }} />
              </div>
              <span
                style={{
                  fontSize: 9,
                  color: isImbalanced ? (buyPct > 65 ? "#10b981" : "#ef4444") : "rgba(255,255,255,0.25)",
                  width: 44,
                  textAlign: "right",
                  fontFamily: "monospace",
                  flexShrink: 0,
                  fontWeight: isImbalanced ? 700 : 400,
                }}
              >
                {total >= 1000 ? `${(total / 1000).toFixed(0)}K` : total > 0 ? String(total) : "—"}
              </span>
            </div>
          );
        })}
      </div>
      <div style={{ marginTop: 10, fontSize: 10, color: "rgba(255,255,255,0.35)", lineHeight: 1.5 }}>
        Each bar = 5 minutes. Bars where one side dominates (&gt;65%) are highlighted — these show where buyers or sellers had
        clear control.
      </div>
    </div>
  );
}

// ── Verdict Card ───────────────────────────────────────────────────────────
function VerdictCard({
  verdict,
}: {
  verdict: { verdict: string; detail: string; color: string; icon: string; action: string } | null;
}) {
  if (!verdict) return null;
  return (
    <div
      style={{
        background: `${verdict.color}0d`,
        border: `1px solid ${verdict.color}40`,
        borderRadius: 8,
        padding: "16px 20px",
        marginBottom: 20,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
        <span style={{ fontSize: 20 }}>{verdict.icon}</span>
        <span
          style={{
            fontSize: 16,
            fontWeight: 800,
            color: verdict.color,
            fontFamily: "monospace",
            letterSpacing: "0.04em",
          }}
        >
          {verdict.verdict}
        </span>
      </div>
      <p style={{ margin: "0 0 10px 0", fontSize: 12, color: "rgba(255,255,255,0.7)", lineHeight: 1.6 }}>
        {verdict.detail}
      </p>
      <div
        style={{
          fontSize: 11,
          color: "rgba(255,255,255,0.5)",
          borderTop: "1px solid rgba(255,255,255,0.08)",
          paddingTop: 8,
          lineHeight: 1.5,
        }}
      >
        <span style={{ color: "rgba(255,255,255,0.35)", textTransform: "uppercase" as const, letterSpacing: "0.06em", fontSize: 9, fontWeight: 700 }}>
          What to do:{" "}
        </span>
        {verdict.action}
      </div>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────
export default function FlowPage() {
  const [selectedTicker, setSelectedTicker] = useState("EQNR");
  const [tickerSignal, setTickerSignal] = useState<TickerSignal | null>(null);
  const [bars, setBars] = useState<any[]>([]);
  const [vpinSeries, setVpinSeries] = useState<any[]>([]);
  const [ticks, setTicks] = useState<any[]>([]);
  const [icebergs, setIcebergs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchData = useCallback(async (ticker: string) => {
    try {
      const [sigRes, barsRes, vpinRes, ticksRes, iceRes] = await Promise.all([
        fetch(`/api/flow/signals/${ticker}`),
        fetch(`/api/flow/bars/${ticker}?bar_type=time_5m&limit=200`),
        fetch(`/api/flow/vpin/${ticker}?days=5`),
        fetch(`/api/flow/ticks/${ticker}?minutes=60&limit=200`),
        fetch(`/api/flow/icebergs/${ticker}?days=5`),
      ]);

      if (sigRes.ok) setTickerSignal(await sigRes.json());
      else setTickerSignal(null);
      if (barsRes.ok) {
        const d = await barsRes.json();
        setBars(d.bars || []);
      }
      if (vpinRes.ok) {
        const d = await vpinRes.json();
        setVpinSeries(d.series || []);
      }
      if (ticksRes.ok) {
        const d = await ticksRes.json();
        setTicks(d.ticks || []);
      }
      if (iceRes.ok) {
        const d = await iceRes.json();
        setIcebergs(d.detections || []);
      }
      setLastUpdated(new Date());
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    fetchData(selectedTicker);
    const interval = setInterval(() => fetchData(selectedTicker), 30000);
    return () => clearInterval(interval);
  }, [selectedTicker, fetchData]);

  const verdict = getVerdict(tickerSignal, bars, icebergs);

  const vpinExplain = metricExplain("vpin", tickerSignal?.vpin ?? null);
  const ofiExplain = metricExplain("ofi", tickerSignal?.ofiCumulative ?? null);
  const toxExplain = metricExplain("toxicity", tickerSignal?.toxicity ?? null);

  // Buy/sell dominance for today
  const totalBuy = bars.reduce((s: number, b: any) => s + (b.buy_volume || 0), 0);
  const totalSell = bars.reduce((s: number, b: any) => s + (b.sell_volume || 0), 0);
  const totalVol = totalBuy + totalSell;
  const buyDomPct = totalVol > 0 ? (totalBuy / totalVol) * 100 : 50;

  return (
    <div style={{ minHeight: "100vh", background: "#0a0a0a", color: "#fff", fontFamily: "monospace" }}>
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "24px 24px" }}>

        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 }}>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 800, margin: "0 0 4px 0", letterSpacing: "0.04em" }}>
              <span style={{ color: ACCENT }}>ORDER FLOW</span> ANALYSIS
            </h1>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", lineHeight: 1.5 }}>
              Detects hidden buyers/sellers, institutional algorithms, and informed trading in real OSE tick data.
              <br />
              Run{" "}
              <code style={{ background: "#161b22", padding: "1px 6px", borderRadius: 3, color: ACCENT }}>
                pnpm run flow:fetch -- --ticker {selectedTicker}
              </code>{" "}
              to refresh today&apos;s data.
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            {lastUpdated && (
              <div style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", fontFamily: "monospace" }}>
                Updated {lastUpdated.toLocaleTimeString("en-GB", { timeZone: "Europe/Oslo" })} Oslo
              </div>
            )}
          </div>
        </div>

        {/* Ticker Selector */}
        <div style={{ display: "flex", gap: 6, marginBottom: 24, flexWrap: "wrap" }}>
          {TICKERS.map((t) => (
            <button
              key={t}
              onClick={() => setSelectedTicker(t)}
              style={{
                padding: "8px 20px",
                borderRadius: 6,
                fontSize: 12,
                fontWeight: 700,
                fontFamily: "monospace",
                border: `1px solid ${selectedTicker === t ? ACCENT : "#30363d"}`,
                background: selectedTicker === t ? `${ACCENT}18` : "#161b22",
                color: selectedTicker === t ? ACCENT : "rgba(255,255,255,0.6)",
                cursor: "pointer",
                transition: "all 0.15s",
              }}
            >
              {t}
            </button>
          ))}
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
            {tickerSignal && (
              <FlowRegimeBadge regime={tickerSignal.regime || "neutral"} />
            )}
          </div>
        </div>

        {loading ? (
          <div style={{ textAlign: "center", padding: 80, color: "rgba(255,255,255,0.3)", fontSize: 12 }}>
            Loading flow data for {selectedTicker}...
          </div>
        ) : !tickerSignal && bars.length === 0 ? (
          <div
            style={{
              background: "#161b22",
              border: "1px solid #30363d",
              borderRadius: 8,
              padding: 40,
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: 14, color: "rgba(255,255,255,0.5)", marginBottom: 12 }}>
              No tick data for {selectedTicker}
            </div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", lineHeight: 1.8 }}>
              To load data, run in your terminal:
              <br />
              <code style={{ color: ACCENT, background: "#0d1117", padding: "4px 10px", borderRadius: 4, display: "inline-block", marginTop: 6 }}>
                cd InEqRe_OBX/apps/web && pnpm run flow:fetch -- --ticker {selectedTicker}
              </code>
              <br />
              <span style={{ fontSize: 10 }}>This fetches today&apos;s intraday trades from Euronext Live.</span>
            </div>
          </div>
        ) : (
          <>
            {/* ── VERDICT ─────────────────────────────────────────────── */}
            <VerdictCard verdict={verdict} />

            {/* ── 3 KEY METRICS ───────────────────────────────────────── */}
            <div style={{ display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap" }}>
              <ExplainedMetric
                label="VPIN — Informed Flow"
                tooltip="Volume-Synchronized Probability of Informed Trading (Easley et al). Measures how much of the volume is likely from participants trading on private information. Above 0.5 = elevated; above 0.7 = high risk of a sharp move."
                value={tickerSignal?.vpin != null ? tickerSignal.vpin.toFixed(2) : "—"}
                explain={vpinExplain.short}
                color={vpinExplain.color}
              />
              <ExplainedMetric
                label="Net Buy Pressure (OFI)"
                tooltip="Order Flow Imbalance — cumulative difference between buyer-initiated and seller-initiated volume today. Positive = more buyers than sellers. Large imbalances often precede price moves."
                value={
                  tickerSignal?.ofiCumulative != null
                    ? tickerSignal.ofiCumulative > 0
                      ? `+${(tickerSignal.ofiCumulative / 1000).toFixed(0)}K`
                      : `${(tickerSignal.ofiCumulative / 1000).toFixed(0)}K`
                    : "—"
                }
                explain={ofiExplain.short}
                color={ofiExplain.color}
              />
              <ExplainedMetric
                label="Flow Toxicity"
                tooltip="Composite score (0–100) measuring how 'toxic' the order flow is. High toxicity means uninformed traders (market makers, retail) are consistently losing to the other side — a sign of informed or aggressive institutional flow."
                value={tickerSignal?.toxicity != null ? tickerSignal.toxicity.toFixed(0) : "—"}
                explain={toxExplain.short}
                color={toxExplain.color}
              />
              {/* Today's buy/sell split */}
              <div
                style={{
                  background: "#0d1117",
                  border: "1px solid #21262d",
                  borderRadius: 6,
                  padding: "14px 16px",
                  flex: 1,
                  minWidth: 150,
                }}
              >
                <div
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    color: "rgba(255,255,255,0.5)",
                    letterSpacing: "0.06em",
                    textTransform: "uppercase" as const,
                    marginBottom: 8,
                  }}
                >
                  Today&apos;s Flow Split
                </div>
                <div style={{ fontSize: 24, fontWeight: 800, fontFamily: "monospace", marginBottom: 6, color: buyDomPct > 52 ? "#10b981" : buyDomPct < 48 ? "#ef4444" : "#6b7280" }}>
                  {buyDomPct.toFixed(0)}% BUY
                </div>
                <div style={{ height: 6, borderRadius: 3, overflow: "hidden", display: "flex", background: "#1a1f26", marginBottom: 6 }}>
                  <div style={{ width: `${buyDomPct}%`, background: "#10b981" }} />
                  <div style={{ width: `${100 - buyDomPct}%`, background: "#ef4444" }} />
                </div>
                <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)" }}>
                  {(totalVol / 1000).toFixed(0)}K shares classified today
                </div>
              </div>
            </div>

            {/* ── PRICE + OFI CHART ────────────────────────────────────── */}
            <div style={{ background: "#161b22", border: "1px solid #30363d", borderRadius: 8, padding: 16, marginBottom: 16 }}>
              <div style={{ fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.4)", letterSpacing: "0.07em", marginBottom: 10, textTransform: "uppercase" as const }}>
                Price vs. Cumulative Buy/Sell Imbalance
              </div>
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", marginBottom: 12, lineHeight: 1.5 }}>
                The blue line (OFI) rises when buyers dominate and falls when sellers take control. When the OFI trend diverges from price, it often signals a coming reversal.
              </div>
              <FlowPriceChart bars={bars} signals={vpinSeries} />
            </div>

            {/* ── BUY/SELL BARS ─────────────────────────────────────────── */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
              <div style={{ background: "#161b22", border: "1px solid #30363d", borderRadius: 8, padding: 16 }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.4)", letterSpacing: "0.07em", marginBottom: 4, textTransform: "uppercase" as const }}>
                  Buyer vs. Seller Control — 5-Minute Bars
                </div>
                <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", marginBottom: 12, lineHeight: 1.5 }}>
                  Each bar shows who had control in that 5-minute window. Consecutive green bars = buyers in charge. Red bars = sellers. Look for sustained runs in one direction.
                </div>
                <BuySellBars bars={bars} />
              </div>

              {/* Iceberg Detections */}
              <div style={{ background: "#161b22", border: "1px solid #30363d", borderRadius: 8, padding: 16 }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.4)", letterSpacing: "0.07em", marginBottom: 4, textTransform: "uppercase" as const }}>
                  Iceberg Order Detections
                </div>
                <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", marginBottom: 12, lineHeight: 1.5 }}>
                  Iceberg orders are large institutional orders split into small pieces to hide their size. We detect them by looking for repeated small trades of suspiciously similar size at the same price level.
                </div>
                {icebergs.length === 0 ? (
                  <div style={{ color: "rgba(255,255,255,0.3)", fontSize: 11, padding: "20px 0", textAlign: "center" }}>
                    No iceberg patterns detected in the last 5 days
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {icebergs.slice(0, 4).map((ice: any, i: number) => (
                      <IcebergCard key={i} detection={ice} />
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* ── VPIN HISTORY ────────────────────────────────────────── */}
            {vpinSeries.length > 0 && (
              <div style={{ background: "#161b22", border: "1px solid #30363d", borderRadius: 8, padding: 16, marginBottom: 16 }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.4)", letterSpacing: "0.07em", marginBottom: 4, textTransform: "uppercase" as const }}>
                  Informed Flow History (VPIN)
                </div>
                <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", marginBottom: 12, lineHeight: 1.5 }}>
                  VPIN trend over time. Spikes above 0.5 (yellow) or 0.7 (red) often coincide with large directional moves or news events.
                  The dotted line shows Kyle&apos;s Lambda — how much the price moves per unit of net buying.
                </div>
                <VPINChart data={vpinSeries} />
              </div>
            )}

            {/* ── LIVE TRADE TAPE ──────────────────────────────────────── */}
            <div style={{ background: "#161b22", border: "1px solid #30363d", borderRadius: 8, padding: 16, marginBottom: 16 }}>
              <div style={{ fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.4)", letterSpacing: "0.07em", marginBottom: 4, textTransform: "uppercase" as const }}>
                Recent Trades (Last Hour)
              </div>
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", marginBottom: 12, lineHeight: 1.5 }}>
                Every individual trade with direction classification. Green = buyer-initiated (trade hit the ask). Red = seller-initiated (trade hit the bid). Large trades stand out by size.
              </div>
              <TradeTape ticks={ticks} />
            </div>

            {/* ── METHODOLOGY NOTE ──────────────────────────────────────── */}
            <details style={{ marginTop: 8 }}>
              <summary
                style={{
                  fontSize: 10,
                  color: "rgba(255,255,255,0.3)",
                  cursor: "pointer",
                  padding: "8px 0",
                  letterSpacing: "0.04em",
                }}
              >
                ▸ How does this work? (methodology)
              </summary>
              <div
                style={{
                  background: "#0d1117",
                  border: "1px solid #21262d",
                  borderRadius: 6,
                  padding: 16,
                  marginTop: 8,
                  fontSize: 10,
                  color: "rgba(255,255,255,0.45)",
                  lineHeight: 1.8,
                }}
              >
                <p style={{ margin: "0 0 8px 0" }}>
                  <strong style={{ color: "rgba(255,255,255,0.7)" }}>Data source:</strong> Euronext Live intraday trade feed for Oslo Børs. Every individual trade is captured with timestamp, price, and volume. This is the same raw trade data used by professional market microstructure desks.
                </p>
                <p style={{ margin: "0 0 8px 0" }}>
                  <strong style={{ color: "rgba(255,255,255,0.7)" }}>Trade direction (tick rule):</strong> Since we don&apos;t have real-time order book quotes, each trade is classified as buyer or seller-initiated using the tick rule — if the price went up from the prior trade, it was a buy; if it went down, a sell.
                </p>
                <p style={{ margin: "0 0 8px 0" }}>
                  <strong style={{ color: "rgba(255,255,255,0.7)" }}>VPIN (Easley, López de Prado, O&apos;Hara 2010):</strong> Groups trades into equal-volume buckets. Within each bucket, the imbalance between buys and sells estimates the probability that a counterparty is trading on private information.
                </p>
                <p style={{ margin: "0 0 8px 0" }}>
                  <strong style={{ color: "rgba(255,255,255,0.7)" }}>Iceberg detection:</strong> Looks for time windows with many small trades of similar size at a consistent price — the signature of an algorithmic execution breaking up a large block order.
                </p>
                <p style={{ margin: 0 }}>
                  <strong style={{ color: "rgba(255,255,255,0.7)" }}>Limitations:</strong> Tick-rule classification has ~85% accuracy on liquid stocks. Dark trades and auction prints may distort bar-level analysis. Data is end-of-day batch — not real-time streaming.
                </p>
              </div>
            </details>
          </>
        )}
      </div>

      <style>{`
        @keyframes pulse { 0%,100%{opacity:1}50%{opacity:0.4} }
        details summary::-webkit-details-marker { display: none; }
      `}</style>
    </div>
  );
}
