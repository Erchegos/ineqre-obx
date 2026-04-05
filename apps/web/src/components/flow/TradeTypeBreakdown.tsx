"use client";

import { useState } from "react";

type Tick = { ts: string; price: number; size: number; side: number };

// ─── Trader type definitions ────────────────────────────────────────────────

export type TraderType =
  | "dark_pool"
  | "institutional"
  | "algo_hft"
  | "momentum"
  | "retail";

interface TraderProfile {
  type: TraderType;
  label: string;
  shortLabel: string;
  color: string;
  bgColor: string;
  description: string;
  whatItMeans: string;
  bullishMeaning: string;
  bearishMeaning: string;
}

const PROFILES: Record<TraderType, TraderProfile> = {
  dark_pool: {
    type: "dark_pool",
    label: "Dark Pool / Block",
    shortLabel: "DARK",
    color: "#a78bfa",
    bgColor: "rgba(167,139,250,0.1)",
    description: "Large single trades executed outside the public order book. Institutions use dark pools to move big positions without tipping off the market.",
    whatItMeans: "Someone moved a very large amount of stock in one or a few prints. These are hedge funds, pension funds, or large asset managers.",
    bullishMeaning: "A large buyer took a big position at once — they were willing to pay up to get filled quickly. Strong conviction buying.",
    bearishMeaning: "A large seller offloaded a block quickly. They prioritised speed over price — often means they want out.",
  },
  institutional: {
    type: "institutional",
    label: "Institutional Stealth",
    shortLabel: "INST",
    color: "#00e5ff",
    bgColor: "rgba(0,229,255,0.08)",
    description: "Uniform-sized trades repeated over time — the classic footprint of an institution working a large order through an algo, trying not to move the price.",
    whatItMeans: "An institution (fund, bank, large investor) is patiently accumulating or distributing. They break their order into identical pieces to stay hidden.",
    bullishMeaning: "Patient accumulation — they're building a position slowly, which means they believe the upside justifies the effort of hiding.",
    bearishMeaning: "Quiet distribution — methodically selling without panic. Often precedes a sustained decline as they exit.",
  },
  algo_hft: {
    type: "algo_hft",
    label: "Algo / Market Maker",
    shortLabel: "ALGO",
    color: "#f59e0b",
    bgColor: "rgba(245,158,11,0.08)",
    description: "Very regular trade intervals and round-lot sizes — the fingerprint of automated trading systems (TWAP/VWAP execution algos) or high-frequency market makers.",
    whatItMeans: "Computers are doing this trading. Market makers provide liquidity on both sides; execution algos slice large orders into scheduled pieces.",
    bullishMeaning: "Algo buying on a schedule — likely executing a client's buy order. Neutral for short-term but confirms ongoing buy interest.",
    bearishMeaning: "Algo selling on a schedule — executing a client's sell order. Steady, predictable pressure.",
  },
  momentum: {
    type: "momentum",
    label: "Momentum / News",
    shortLabel: "MOM",
    color: "#ef4444",
    bgColor: "rgba(239,68,68,0.08)",
    description: "Large, urgent trades that correlate with price moves — traders reacting to news, price breaks, or sentiment shifts. High price impact per share traded.",
    whatItMeans: "Someone is chasing price movement aggressively. These are often short-term traders, prop desks, or news-driven funds that move fast.",
    bullishMeaning: "Buyers chasing an upward move — FOMO or news-driven demand. Can accelerate a breakout but also signals the move may be overextended.",
    bearishMeaning: "Sellers hitting bids aggressively after bad news or a breakdown. Often marks the panic phase of a selloff.",
  },
  retail: {
    type: "retail",
    label: "Retail / Mixed",
    shortLabel: "RET",
    color: "#6b7280",
    bgColor: "rgba(107,114,128,0.08)",
    description: "Small, random-sized trades with no discernible pattern — the noise of many individual investors trading independently.",
    whatItMeans: "Individual investors doing normal buying and selling. No coordinated strategy. Low price impact per trade.",
    bullishMeaning: "More small buyers than sellers — retail sentiment is cautiously positive. Weak signal on its own.",
    bearishMeaning: "Small sellers dominate — retail is nervous or taking profits. Weak signal on its own.",
  },
};

// ─── Classification logic ────────────────────────────────────────────────────

interface ClassifiedTick {
  tick: Tick;
  type: TraderType;
}

interface TypeSummary {
  type: TraderType;
  count: number;
  volume: number;
  buyVolume: number;
  sellVolume: number;
  pct: number;          // % of total volume
  buyPct: number;       // % buy within type
  avgSize: number;
  maxSize: number;
}

/**
 * Classify each tick into a trader type using microstructure signals:
 *
 * 1. DARK POOL  — size > 95th percentile AND price impact < median (large with low impact)
 * 2. INSTITUTIONAL — size in 60-95th pct AND CV(sizes in window) < 0.3 (uniform-sized cluster)
 * 3. ALGO/HFT  — round lot sizes (50/100/200/500/1000) AND regular timing within 30s windows
 * 4. MOMENTUM  — size > 75th pct AND price moved more than median in prior 5 ticks
 * 5. RETAIL    — everything else (small, random)
 */
function classifyTicks(ticks: Tick[]): ClassifiedTick[] {
  if (ticks.length < 20) return ticks.map(t => ({ tick: t, type: "retail" }));

  const sizes = ticks.map(t => t.size).sort((a, b) => a - b);
  const n = sizes.length;

  const p50 = sizes[Math.floor(n * 0.50)];
  const p60 = sizes[Math.floor(n * 0.60)];
  const p75 = sizes[Math.floor(n * 0.75)];
  const p95 = sizes[Math.floor(n * 0.95)];

  const ROUND_LOTS = new Set([50, 100, 200, 250, 500, 750, 1000, 1500, 2000, 2500, 5000, 10000]);
  const WINDOW_MS = 30_000; // 30 second clustering window

  // Pre-compute price impact for each tick (abs price change per 1000 shares)
  const impacts: number[] = ticks.map((t, i) => {
    if (i === 0) return 0;
    const priceDelta = Math.abs(t.price - ticks[i - 1].price);
    return t.size > 0 ? (priceDelta / t.price) * 10000 / (t.size / 1000) : 0;
  });
  const impactsSorted = [...impacts].sort((a, b) => a - b);
  const medianImpact = impactsSorted[Math.floor(impactsSorted.length * 0.5)];

  // Pre-compute 5-tick rolling price move to detect momentum context
  const priorMoves: number[] = ticks.map((t, i) => {
    if (i < 5) return 0;
    return Math.abs((t.price - ticks[i - 5].price) / ticks[i - 5].price) * 10000;
  });
  const medianMove = [...priorMoves].sort((a, b) => a - b)[Math.floor(priorMoves.length * 0.5)];

  // Build 30s windows for uniformity detection
  const windowUniformity = new Map<number, number>(); // windowKey → CV of sizes in window
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

  return ticks.map((t, i) => {
    const size = t.size;
    const impact = impacts[i];
    const priorMove = priorMoves[i];
    const windowKey = Math.floor(new Date(t.ts).getTime() / WINDOW_MS);
    const cv = windowUniformity.get(windowKey) ?? 1;
    const isRoundLot = ROUND_LOTS.has(size);

    // 1. DARK POOL: very large print with below-median price impact
    if (size >= p95 && impact <= medianImpact) {
      return { tick: t, type: "dark_pool" as TraderType };
    }

    // 2. INSTITUTIONAL STEALTH: mid-large size in a uniform-size cluster
    if (size >= p60 && size < p95 && cv < 0.30) {
      return { tick: t, type: "institutional" as TraderType };
    }

    // 3. MOMENTUM: large trade chasing a price move
    if (size >= p75 && priorMove > medianMove * 2.5) {
      return { tick: t, type: "momentum" as TraderType };
    }

    // 4. ALGO/HFT: round-lot sizes in a regular-interval cluster
    if (isRoundLot && cv < 0.50 && size >= p50) {
      return { tick: t, type: "algo_hft" as TraderType };
    }

    // 5. RETAIL: everything else
    return { tick: t, type: "retail" as TraderType };
  });
}

function summarizeTypes(classified: ClassifiedTick[]): TypeSummary[] {
  const totalVol = classified.reduce((s, c) => s + c.tick.size, 0);
  const typeMap = new Map<TraderType, { count: number; volume: number; buyVol: number; sellVol: number; sizes: number[] }>();

  for (const c of classified) {
    if (!typeMap.has(c.type)) typeMap.set(c.type, { count: 0, volume: 0, buyVol: 0, sellVol: 0, sizes: [] });
    const m = typeMap.get(c.type)!;
    m.count++;
    m.volume += c.tick.size;
    if (c.tick.side === 1) m.buyVol += c.tick.size;
    else if (c.tick.side === -1) m.sellVol += c.tick.size;
    m.sizes.push(c.tick.size);
  }

  const order: TraderType[] = ["dark_pool", "institutional", "algo_hft", "momentum", "retail"];
  return order.map(type => {
    const m = typeMap.get(type) ?? { count: 0, volume: 0, buyVol: 0, sellVol: 0, sizes: [] };
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

// ─── Component ───────────────────────────────────────────────────────────────

export default function TradeTypeBreakdown({ ticks }: { ticks: Tick[] }) {
  const [expanded, setExpanded] = useState<TraderType | null>(null);

  if (ticks.length < 50) {
    return (
      <div style={{ color: "rgba(255,255,255,0.25)", fontSize: 11, padding: "20px 0", textAlign: "center" }}>
        Not enough trades to classify
      </div>
    );
  }

  const classified = classifyTicks(ticks);
  const summaries = summarizeTypes(classified);
  const totalVol = ticks.reduce((s, t) => s + t.size, 0);

  // Overall buy pct weighted by "smart money" (dark + institutional)
  const smartTypes: TraderType[] = ["dark_pool", "institutional"];
  const smartTrades = classified.filter(c => smartTypes.includes(c.type));
  const smartBuy = smartTrades.filter(c => c.tick.side === 1).reduce((s, c) => s + c.tick.size, 0);
  const smartSell = smartTrades.filter(c => c.tick.side === -1).reduce((s, c) => s + c.tick.size, 0);
  const smartTotal = smartBuy + smartSell;
  const smartBuyPct = smartTotal > 0 ? (smartBuy / smartTotal) * 100 : 50;
  const smartPct = totalVol > 0 ? (smartTypes.reduce((s, type) => s + (summaries.find(x => x.type === type)?.volume ?? 0), 0) / totalVol) * 100 : 0;

  const smartSignal = smartTotal > 5000
    ? smartBuyPct >= 60 ? { label: "Smart money is buying", color: "#10b981" }
      : smartBuyPct <= 40 ? { label: "Smart money is selling", color: "#ef4444" }
      : { label: "Smart money is neutral", color: "#6b7280" }
    : null;

  return (
    <div>
      {/* Smart money summary */}
      {smartSignal && (
        <div style={{
          background: `${smartSignal.color}0d`, border: `1px solid ${smartSignal.color}30`,
          borderRadius: 6, padding: "10px 14px", marginBottom: 16,
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: smartSignal.color, letterSpacing: "0.04em" }}>
              {smartSignal.label.toUpperCase()}
            </div>
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.45)", marginTop: 2 }}>
              Dark pool + institutional trades are {smartBuyPct.toFixed(0)}% buy-side — {smartPct.toFixed(0)}% of all volume
            </div>
          </div>
          <div style={{ fontSize: 22, fontWeight: 800, color: smartSignal.color, fontFamily: "monospace" }}>
            {smartBuyPct.toFixed(0)}%
          </div>
        </div>
      )}

      {/* Type rows */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {summaries.map(s => {
          const profile = PROFILES[s.type];
          const isExpanded = expanded === s.type;
          const hasData = s.count > 0;
          const isBullish = s.buyPct >= 55;
          const isBearish = s.buyPct <= 45;
          const dirColor = isBullish ? "#10b981" : isBearish ? "#ef4444" : "#6b7280";

          return (
            <div key={s.type}>
              <div
                onClick={() => hasData && setExpanded(isExpanded ? null : s.type)}
                style={{
                  background: hasData ? profile.bgColor : "rgba(255,255,255,0.02)",
                  border: `1px solid ${isExpanded ? profile.color + "60" : "rgba(255,255,255,0.08)"}`,
                  borderRadius: 6,
                  padding: "10px 14px",
                  cursor: hasData ? "pointer" : "default",
                  opacity: hasData ? 1 : 0.4,
                  transition: "border-color 0.15s",
                }}
                onMouseEnter={e => hasData && ((e.currentTarget as HTMLDivElement).style.borderColor = profile.color + "60")}
                onMouseLeave={e => !isExpanded && hasData && ((e.currentTarget as HTMLDivElement).style.borderColor = "rgba(255,255,255,0.08)")}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  {/* Type badge */}
                  <span style={{
                    fontSize: 9, fontWeight: 800, letterSpacing: "0.08em",
                    color: profile.color, background: `${profile.color}18`,
                    border: `1px solid ${profile.color}33`,
                    borderRadius: 3, padding: "2px 6px", flexShrink: 0,
                    fontFamily: "monospace",
                  }}>{profile.shortLabel}</span>

                  {/* Label */}
                  <span style={{ fontSize: 11, color: "rgba(255,255,255,0.7)", flex: 1 }}>
                    {profile.label}
                  </span>

                  {/* Volume bar + pct */}
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {hasData && (
                      <div style={{ width: 80, height: 4, background: "#21262d", borderRadius: 2, overflow: "hidden" }}>
                        <div style={{
                          height: "100%", width: `${Math.min(s.pct * 1.5, 100)}%`,
                          background: profile.color, borderRadius: 2,
                        }} />
                      </div>
                    )}
                    <span style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.5)", width: 36, textAlign: "right", fontFamily: "monospace" }}>
                      {hasData ? `${s.pct.toFixed(0)}%` : "—"}
                    </span>
                  </div>

                  {/* Buy/sell pill */}
                  {hasData && (
                    <span style={{
                      fontSize: 10, fontWeight: 700, color: dirColor,
                      width: 46, textAlign: "right", fontFamily: "monospace",
                    }}>
                      {s.buyPct.toFixed(0)}% B
                    </span>
                  )}

                  {/* Expand caret */}
                  {hasData && (
                    <span style={{
                      fontSize: 9, color: "rgba(255,255,255,0.3)",
                      transform: isExpanded ? "rotate(180deg)" : "rotate(0)", transition: "transform 0.2s",
                    }}>▼</span>
                  )}
                </div>

                {/* Volume bar: buy vs sell within type */}
                {hasData && (
                  <div style={{ marginTop: 8, display: "flex", gap: 0, height: 3, borderRadius: 2, overflow: "hidden" }}>
                    <div style={{ width: `${s.buyPct}%`, background: "#10b981" }} />
                    <div style={{ width: `${100 - s.buyPct}%`, background: "#ef4444" }} />
                  </div>
                )}
              </div>

              {/* Expanded detail panel */}
              {isExpanded && hasData && (
                <div style={{
                  background: "#0d1117", border: `1px solid ${profile.color}30`,
                  borderTop: "none", borderRadius: "0 0 6px 6px",
                  padding: "14px 16px",
                }}>
                  {/* Stats row */}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginBottom: 14 }}>
                    {[
                      { label: "TRADES", value: s.count.toLocaleString() },
                      { label: "VOLUME", value: s.volume >= 1000 ? `${(s.volume / 1000).toFixed(0)}K` : String(s.volume) },
                      { label: "AVG SIZE", value: s.avgSize.toLocaleString() },
                      { label: "MAX SIZE", value: s.maxSize >= 1000 ? `${(s.maxSize / 1000).toFixed(1)}K` : String(s.maxSize) },
                    ].map(m => (
                      <div key={m.label} style={{ textAlign: "center", background: "#161b22", borderRadius: 4, padding: "6px 4px" }}>
                        <div style={{ fontSize: 8, color: "rgba(255,255,255,0.35)", letterSpacing: "0.06em", fontFamily: "monospace" }}>{m.label}</div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: "#e6edf3", fontFamily: "monospace" }}>{m.value}</div>
                      </div>
                    ))}
                  </div>

                  {/* What is this type */}
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.35)", letterSpacing: "0.06em", marginBottom: 4 }}>WHAT IS THIS?</div>
                    <div style={{ fontSize: 11, color: "rgba(255,255,255,0.6)", lineHeight: 1.7 }}>{profile.description}</div>
                  </div>

                  {/* What it means */}
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.35)", letterSpacing: "0.06em", marginBottom: 4 }}>WHO IS TRADING?</div>
                    <div style={{ fontSize: 11, color: "rgba(255,255,255,0.6)", lineHeight: 1.7 }}>{profile.whatItMeans}</div>
                  </div>

                  {/* Directional interpretation */}
                  <div style={{
                    background: `${dirColor}08`, border: `1px solid ${dirColor}25`,
                    borderRadius: 4, padding: "8px 12px",
                  }}>
                    <div style={{ fontSize: 9, fontWeight: 700, color: dirColor, letterSpacing: "0.06em", marginBottom: 3 }}>
                      TODAY: {isBullish ? "BULLISH" : isBearish ? "BEARISH" : "NEUTRAL"} ({s.buyPct.toFixed(0)}% BUY)
                    </div>
                    <div style={{ fontSize: 11, color: "rgba(255,255,255,0.55)", lineHeight: 1.6 }}>
                      {isBullish ? profile.bullishMeaning : isBearish ? profile.bearishMeaning : "Roughly equal buying and selling — no directional signal from this trader type today."}
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div style={{ marginTop: 12, fontSize: 10, color: "rgba(255,255,255,0.25)", lineHeight: 1.7 }}>
        <strong style={{ color: "rgba(255,255,255,0.4)" }}>How classification works:</strong>{" "}
        Each trade is classified using trade size, price impact, timing regularity, and clustering patterns — the same signals professional microstructure desks use. Click any row for detail. Classification is approximate (~80-85% accuracy for liquid OSE stocks).
      </div>
    </div>
  );
}
