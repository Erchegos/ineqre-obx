"use client";

import { useState } from "react";

type Tick = { ts: string; price: number; size: number; side: number };

export type TraderType = "dark_pool" | "institutional" | "algo_hft" | "momentum" | "retail";

interface TraderProfile {
  type: TraderType;
  label: string;
  shortLabel: string;
  color: string;
  description: string;
  bullishMeaning: string;
  bearishMeaning: string;
  neutralMeaning: string;
}

const PROFILES: Record<TraderType, TraderProfile> = {
  dark_pool: {
    type: "dark_pool",
    label: "Dark Pool / Block",
    shortLabel: "DARK POOL",
    color: "#a78bfa",
    description: "Large single prints with low price impact. Hedge funds and pension funds moving big positions outside the public order book.",
    bullishMeaning: "A large buyer took a block position at once — paid up to get filled. Strong conviction buying, often precedes a price move.",
    bearishMeaning: "A large seller offloaded a block quickly, prioritising speed over price. They want out.",
    neutralMeaning: "Large blocks trading both ways — institutions repositioning without a clear directional bias.",
  },
  institutional: {
    type: "institutional",
    label: "Institutional Stealth",
    shortLabel: "INSTITUTIONAL",
    color: "#00e5ff",
    description: "Uniform-sized trades repeated over time. An institution working a large order through an algo, trying not to move the price.",
    bullishMeaning: "Patient accumulation — building a position slowly. They believe upside justifies hiding their hand.",
    bearishMeaning: "Quiet distribution — methodical selling without panic. Often precedes a sustained decline.",
    neutralMeaning: "Institution rebalancing — equal buying and selling, not building a directional position.",
  },
  algo_hft: {
    type: "algo_hft",
    label: "Algo / Market Maker",
    shortLabel: "ALGO / HFT",
    color: "#f59e0b",
    description: "Round-lot sizes with regular timing intervals. TWAP/VWAP execution algos or HFT market makers providing liquidity.",
    bullishMeaning: "Algo executing a client buy order on schedule. Steady mechanical demand.",
    bearishMeaning: "Algo executing a client sell order. Steady mechanical supply.",
    neutralMeaning: "Market maker activity — quoting both sides, no net directional pressure.",
  },
  momentum: {
    type: "momentum",
    label: "Momentum / News",
    shortLabel: "MOMENTUM",
    color: "#ef4444",
    description: "Large trades chasing price moves. Prop desks, news-driven funds or short-term traders acting with urgency.",
    bullishMeaning: "Buyers chasing an upward move aggressively. Can accelerate a breakout but signals the move may be overextended.",
    bearishMeaning: "Panic selling after news or a breakdown. Often marks the peak of a selloff.",
    neutralMeaning: "Mixed momentum signals — no sustained directional chase.",
  },
  retail: {
    type: "retail",
    label: "Retail / Mixed",
    shortLabel: "RETAIL",
    color: "#6b7280",
    description: "Small random-sized trades with no pattern. Individual investors trading independently. Low price impact, high noise.",
    bullishMeaning: "More small buyers than sellers — retail sentiment leans positive. Weak signal on its own.",
    bearishMeaning: "Small sellers dominate — retail is nervous or taking profits. Weak signal.",
    neutralMeaning: "Random retail noise. No actionable signal from this group.",
  },
};

// ── Classification ──────────────────────────────────────────────────────────

interface TypeSummary {
  type: TraderType;
  count: number;
  volume: number;
  buyVolume: number;
  sellVolume: number;
  pct: number;
  buyPct: number;
  avgSize: number;
  maxSize: number;
}

function classifyAndSummarize(ticks: Tick[]): TypeSummary[] {
  if (ticks.length < 20) return [];

  const sizes = ticks.map(t => t.size).sort((a, b) => a - b);
  const n = sizes.length;
  const p50 = sizes[Math.floor(n * 0.50)];
  const p60 = sizes[Math.floor(n * 0.60)];
  const p75 = sizes[Math.floor(n * 0.75)];
  const p95 = sizes[Math.floor(n * 0.95)];

  const ROUND_LOTS = new Set([50, 100, 200, 250, 500, 750, 1000, 1500, 2000, 2500, 5000, 10000]);
  const WINDOW_MS = 30_000;

  const impacts: number[] = ticks.map((t, i) => {
    if (i === 0) return 0;
    const priceDelta = Math.abs(t.price - ticks[i - 1].price);
    return t.size > 0 ? (priceDelta / t.price) * 10000 / (t.size / 1000) : 0;
  });
  const impactsSorted = [...impacts].sort((a, b) => a - b);
  const medianImpact = impactsSorted[Math.floor(impactsSorted.length * 0.5)];

  const priorMoves: number[] = ticks.map((t, i) => {
    if (i < 5) return 0;
    return Math.abs((t.price - ticks[i - 5].price) / ticks[i - 5].price) * 10000;
  });
  const medianMove = [...priorMoves].sort((a, b) => a - b)[Math.floor(priorMoves.length * 0.5)];

  const windowUniformity = new Map<number, number>();
  {
    const byWindow = new Map<number, number[]>();
    for (const t of ticks) {
      const key = Math.floor(new Date(t.ts).getTime() / WINDOW_MS);
      if (!byWindow.has(key)) byWindow.set(key, []);
      byWindow.get(key)!.push(t.size);
    }
    for (const [key, szs] of byWindow) {
      if (szs.length < 4) { windowUniformity.set(key, 1); continue; }
      const avg = szs.reduce((a, b) => a + b, 0) / szs.length;
      const std = Math.sqrt(szs.reduce((a, b) => a + (b - avg) ** 2, 0) / szs.length);
      windowUniformity.set(key, avg > 0 ? std / avg : 1);
    }
  }

  const acc = new Map<TraderType, { count: number; volume: number; buyVol: number; sellVol: number; sizes: number[] }>();
  const order: TraderType[] = ["dark_pool", "institutional", "algo_hft", "momentum", "retail"];
  for (const t of order) acc.set(t, { count: 0, volume: 0, buyVol: 0, sellVol: 0, sizes: [] });

  for (let i = 0; i < ticks.length; i++) {
    const t = ticks[i];
    const size = t.size;
    const impact = impacts[i];
    const priorMove = priorMoves[i];
    const windowKey = Math.floor(new Date(t.ts).getTime() / WINDOW_MS);
    const cv = windowUniformity.get(windowKey) ?? 1;
    const isRoundLot = ROUND_LOTS.has(size);

    let type: TraderType;
    if (size >= p95 && impact <= medianImpact) type = "dark_pool";
    else if (size >= p60 && size < p95 && cv < 0.30) type = "institutional";
    else if (size >= p75 && priorMove > medianMove * 2.5) type = "momentum";
    else if (isRoundLot && cv < 0.50 && size >= p50) type = "algo_hft";
    else type = "retail";

    const m = acc.get(type)!;
    m.count++;
    m.volume += size;
    if (t.side === 1) m.buyVol += size;
    else if (t.side === -1) m.sellVol += size;
    m.sizes.push(size);
  }

  const totalVol = ticks.reduce((s, t) => s + t.size, 0);
  return order.map(type => {
    const m = acc.get(type)!;
    const dirVol = m.buyVol + m.sellVol;
    return {
      type,
      count: m.count,
      volume: m.volume,
      buyVolume: m.buyVol,
      sellVolume: m.sellVol,
      pct: totalVol > 0 ? (m.volume / totalVol) * 100 : 0,
      buyPct: dirVol > 0 ? (m.buyVol / dirVol) * 100 : 50,
      avgSize: m.count > 0 ? Math.round(m.volume / m.count) : 0,
      maxSize: m.sizes.length > 0 ? Math.max(...m.sizes) : 0,
    };
  });
}

function fmtVol(v: number) {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1000) return `${(v / 1000).toFixed(0)}K`;
  return String(v);
}

// ── Component ────────────────────────────────────────────────────────────────

export default function TradeTypeBreakdown({ ticks }: { ticks: Tick[] }) {
  const [detail, setDetail] = useState<TraderType | null>(null);

  const summaries = classifyAndSummarize(ticks);
  if (summaries.length === 0) return (
    <div style={{ color: "rgba(255,255,255,0.25)", fontSize: 11, padding: "16px 0", textAlign: "center" }}>
      Not enough trades to classify
    </div>
  );

  const totalVol = ticks.reduce((s, t) => s + t.size, 0);

  // Smart money signal
  const smartTypes: TraderType[] = ["dark_pool", "institutional"];
  const smartBuy = summaries.filter(s => smartTypes.includes(s.type)).reduce((a, s) => a + s.buyVolume, 0);
  const smartSell = summaries.filter(s => smartTypes.includes(s.type)).reduce((a, s) => a + s.sellVolume, 0);
  const smartDir = smartBuy + smartSell;
  const smartBuyPct = smartDir > 0 ? (smartBuy / smartDir) * 100 : 50;
  const smartVol = summaries.filter(s => smartTypes.includes(s.type)).reduce((a, s) => a + s.volume, 0);
  const smartPct = totalVol > 0 ? (smartVol / totalVol) * 100 : 0;
  const hasSmartSignal = smartDir > 5000;

  const smartColor = smartBuyPct >= 60 ? "#10b981" : smartBuyPct <= 40 ? "#ef4444" : "#6b7280";
  const smartLabel = smartBuyPct >= 60 ? "BUYING" : smartBuyPct <= 40 ? "SELLING" : "NEUTRAL";

  const detailSummary = detail ? summaries.find(s => s.type === detail) : null;
  const detailProfile = detail ? PROFILES[detail] : null;

  return (
    <div>
      {/* ── Top bar: smart money signal ──────────────────────────────── */}
      {hasSmartSignal && (
        <div style={{
          display: "flex", alignItems: "center", gap: 16,
          padding: "8px 12px", marginBottom: 12,
          background: `${smartColor}0a`, border: `1px solid ${smartColor}25`, borderRadius: 6,
        }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
            <span style={{ fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.4)", letterSpacing: "0.08em" }}>SMART MONEY</span>
            <span style={{ fontSize: 13, fontWeight: 800, color: smartColor, fontFamily: "monospace", letterSpacing: "0.04em" }}>{smartLabel}</span>
          </div>
          <div style={{ width: 1, height: 16, background: "rgba(255,255,255,0.1)" }} />
          <span style={{ fontSize: 11, fontWeight: 700, color: smartColor, fontFamily: "monospace" }}>{smartBuyPct.toFixed(0)}% BUY</span>
          <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>|</span>
          <span style={{ fontSize: 10, color: "rgba(255,255,255,0.35)" }}>{smartPct.toFixed(0)}% of session volume</span>
          <div style={{ flex: 1 }} />
          <span style={{ fontSize: 9, color: "rgba(255,255,255,0.25)", letterSpacing: "0.05em" }}>DARK + INST COMBINED</span>
        </div>
      )}

      {/* ── 5-column header ──────────────────────────────────────────── */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(5, 1fr)",
        gap: 6,
        marginBottom: 8,
      }}>
        {summaries.map(s => {
          const p = PROFILES[s.type];
          const isActive = detail === s.type;
          const isBullish = s.buyPct >= 55;
          const isBearish = s.buyPct <= 45;
          const dirColor = isBullish ? "#10b981" : isBearish ? "#ef4444" : "#6b7280";
          const hasData = s.count > 0;

          return (
            <div
              key={s.type}
              onClick={() => hasData && setDetail(isActive ? null : s.type)}
              style={{
                background: isActive ? `${p.color}12` : "#0d1117",
                border: `1px solid ${isActive ? p.color + "60" : hasData ? "rgba(255,255,255,0.1)" : "rgba(255,255,255,0.05)"}`,
                borderRadius: 6,
                padding: "12px 12px 10px",
                cursor: hasData ? "pointer" : "default",
                opacity: hasData ? 1 : 0.35,
                transition: "all 0.15s",
                position: "relative" as const,
              }}
              onMouseEnter={e => hasData && !isActive && ((e.currentTarget as HTMLDivElement).style.borderColor = p.color + "50")}
              onMouseLeave={e => !isActive && ((e.currentTarget as HTMLDivElement).style.borderColor = hasData ? "rgba(255,255,255,0.1)" : "rgba(255,255,255,0.05)")}
            >
              {/* Type label */}
              <div style={{ fontSize: 8, fontWeight: 800, color: p.color, letterSpacing: "0.1em", marginBottom: 8, fontFamily: "monospace" }}>
                {p.shortLabel}
              </div>

              {/* Volume % — the headline number */}
              <div style={{ fontSize: 26, fontWeight: 800, color: hasData ? "#e6edf3" : "rgba(255,255,255,0.2)", fontFamily: "monospace", lineHeight: 1, marginBottom: 6 }}>
                {hasData ? `${s.pct.toFixed(0)}%` : "—"}
              </div>

              {/* Buy/sell bar */}
              {hasData && (
                <div style={{ height: 3, borderRadius: 1, overflow: "hidden", display: "flex", marginBottom: 6 }}>
                  <div style={{ width: `${s.buyPct}%`, background: "#10b981" }} />
                  <div style={{ width: `${100 - s.buyPct}%`, background: "#ef4444" }} />
                </div>
              )}

              {/* Buy pct + trade count */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: hasData ? dirColor : "rgba(255,255,255,0.2)", fontFamily: "monospace" }}>
                  {hasData ? `${s.buyPct.toFixed(0)}% B` : "—"}
                </span>
                <span style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", fontFamily: "monospace" }}>
                  {hasData ? `${s.count.toLocaleString()} trades` : "no data"}
                </span>
              </div>

              {/* Volume absolute */}
              {hasData && (
                <div style={{ marginTop: 4, fontSize: 10, color: "rgba(255,255,255,0.4)", fontFamily: "monospace" }}>
                  {fmtVol(s.volume)} shares &middot; avg {s.avgSize.toLocaleString()}
                </div>
              )}

              {/* Active indicator */}
              {isActive && (
                <div style={{
                  position: "absolute", bottom: 0, left: "50%", transform: "translateX(-50%)",
                  width: 20, height: 2, background: p.color, borderRadius: "2px 2px 0 0",
                }} />
              )}
            </div>
          );
        })}
      </div>

      {/* ── Volume composition bar ───────────────────────────────────── */}
      <div style={{ marginBottom: 10 }}>
        <div style={{ display: "flex", height: 6, borderRadius: 3, overflow: "hidden", gap: 1 }}>
          {summaries.filter(s => s.pct > 0).map(s => (
            <div
              key={s.type}
              style={{ width: `${s.pct}%`, background: PROFILES[s.type].color, opacity: 0.75, transition: "width 0.3s" }}
              title={`${PROFILES[s.type].shortLabel}: ${s.pct.toFixed(1)}%`}
            />
          ))}
        </div>
        <div style={{ display: "flex", gap: 12, marginTop: 5, flexWrap: "wrap" }}>
          {summaries.filter(s => s.pct > 0).map(s => (
            <span key={s.type} style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", fontFamily: "monospace", display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ width: 6, height: 6, borderRadius: 1, background: PROFILES[s.type].color, display: "inline-block", opacity: 0.8 }} />
              {PROFILES[s.type].shortLabel}
            </span>
          ))}
          <span style={{ fontSize: 9, color: "rgba(255,255,255,0.2)", marginLeft: "auto", fontFamily: "monospace" }}>click column for detail</span>
        </div>
      </div>

      {/* ── Detail panel (shown below when a column is clicked) ───────── */}
      {detailSummary && detailProfile && (
        <div style={{
          background: "#0d1117",
          border: `1px solid ${detailProfile.color}35`,
          borderRadius: 6,
          padding: "14px 16px",
          marginTop: 4,
        }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 16 }}>
            {/* Left: metrics grid */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 6, minWidth: 200 }}>
              {[
                { label: "VOLUME", value: fmtVol(detailSummary.volume) },
                { label: "TRADES", value: detailSummary.count.toLocaleString() },
                { label: "AVG SIZE", value: detailSummary.avgSize.toLocaleString() },
                { label: "MAX SIZE", value: fmtVol(detailSummary.maxSize) },
                { label: "BUY VOL", value: fmtVol(detailSummary.buyVolume) },
                { label: "SELL VOL", value: fmtVol(detailSummary.sellVolume) },
              ].map(m => (
                <div key={m.label} style={{ background: "#161b22", borderRadius: 4, padding: "6px 8px" }}>
                  <div style={{ fontSize: 8, color: "rgba(255,255,255,0.35)", letterSpacing: "0.07em", fontFamily: "monospace" }}>{m.label}</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "#e6edf3", fontFamily: "monospace" }}>{m.value}</div>
                </div>
              ))}
            </div>

            {/* Divider */}
            <div style={{ width: 1, alignSelf: "stretch", background: "rgba(255,255,255,0.07)", flexShrink: 0 }} />

            {/* Right: explanation */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", lineHeight: 1.7, marginBottom: 10 }}>
                {detailProfile.description}
              </div>
              {(() => {
                const isBullish = detailSummary.buyPct >= 55;
                const isBearish = detailSummary.buyPct <= 45;
                const dirColor = isBullish ? "#10b981" : isBearish ? "#ef4444" : "#6b7280";
                const dirLabel = isBullish ? "BULLISH" : isBearish ? "BEARISH" : "NEUTRAL";
                const dirText = isBullish ? detailProfile.bullishMeaning : isBearish ? detailProfile.bearishMeaning : detailProfile.neutralMeaning;
                return (
                  <div style={{ background: `${dirColor}08`, border: `1px solid ${dirColor}25`, borderRadius: 4, padding: "8px 10px" }}>
                    <div style={{ fontSize: 9, fontWeight: 700, color: dirColor, letterSpacing: "0.08em", marginBottom: 3, fontFamily: "monospace" }}>
                      {dirLabel} — {detailSummary.buyPct.toFixed(0)}% BUY TODAY
                    </div>
                    <div style={{ fontSize: 11, color: "rgba(255,255,255,0.55)", lineHeight: 1.6 }}>
                      {dirText}
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
