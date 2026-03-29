"use client";

/**
 * OBX Index-Level Volatility Dashboard — plain-language edition
 *
 * Designed for all users, not just professionals. Every number has context.
 */

import Link from "next/link";
import { useEffect, useState } from "react";

import ConstituentHeatmap from "@/components/ConstituentHeatmap";
import VolConeChart from "@/components/VolConeChart";
import RegimeTimeline from "@/components/RegimeTimeline";

import {
  getRegimeColor,
  getRegimeBackgroundTint,
  type VolatilityRegime,
} from "@/lib/regimeClassification";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type OBXData = any;

const fmtPct = (n: number | null | undefined) =>
  n !== null && n !== undefined ? `${(n * 100).toFixed(1)}%` : "—";

/** Map internal regime names to plain English stress levels + investor guidance */
function getRegimeLabel(regime: VolatilityRegime): { label: string; sub: string; guidance: string } {
  switch (regime) {
    case "Crisis":
      return {
        label: "Market Crisis",
        sub: "Extreme stress — very rare conditions",
        guidance: "Preserve capital. Avoid new positions. Consider defensive assets.",
      };
    case "Extreme High":
      return {
        label: "Very High Stress",
        sub: "Prices are swinging much more than usual",
        guidance: "Be defensive. Consider reducing exposure and tightening stop-losses.",
      };
    case "Elevated":
      return {
        label: "Elevated Stress",
        sub: "Above-normal price swings",
        guidance: "Be cautious. Smaller position sizes are advisable.",
      };
    case "Normal":
      return {
        label: "Normal Conditions",
        sub: "Market is behaving as expected",
        guidance: "Standard positioning. No special action needed.",
      };
    case "Low & Contracting":
      return {
        label: "Calm & Improving",
        sub: "Volatility is low and declining",
        guidance: "Good environment to build positions. Favorable for equities.",
      };
    case "Low & Stable":
      return {
        label: "Very Calm",
        sub: "Unusually quiet market conditions",
        guidance: "Optimal conditions. Full allocation is reasonable.",
      };
    default:
      return { label: regime, sub: "", guidance: "" };
  }
}

export default function OBXVolatilityDashboard() {
  const [data, setData] = useState<OBXData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [limit, setLimit] = useState(504);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/volatility/obx?limit=${limit}`, {
          method: "GET",
          headers: { accept: "application/json" },
        });
        if (!res.ok) {
          const text = await res.text();
          if (!cancelled) { setError(`API error: ${text}`); setData(null); }
          return;
        }
        const json = await res.json();
        if (!cancelled) { setData(json); setLoading(false); }
      } catch (e: any) {
        if (!cancelled) { setError(e?.message ?? String(e)); setLoading(false); }
      }
    }
    load();
    return () => { cancelled = true; };
  }, [limit]);

  if (loading && !data) {
    return (
      <main style={{ padding: 24, fontFamily: "monospace", background: "#0a0a0a", minHeight: "100vh" }}>
        <div style={{ fontSize: 14, color: "rgba(255,255,255,0.5)" }}>Loading OBX dashboard...</div>
      </main>
    );
  }
  if (error || !data) {
    return (
      <main style={{ padding: 24, fontFamily: "monospace", background: "#0a0a0a", minHeight: "100vh" }}>
        <div style={{ color: "#ef4444" }}>Error: {error}</div>
      </main>
    );
  }

  const idx = data.index;
  const regime = idx.regime as VolatilityRegime;
  const regimeColor = getRegimeColor(regime);
  const regimeInfo = getRegimeLabel(regime);
  const pct = idx.percentile ?? 0;

  // Plain-language percentile description
  const pctLabel =
    pct >= 90 ? "extremely high" :
    pct >= 70 ? "high" :
    pct >= 40 ? "normal" :
    pct >= 20 ? "low" : "very low";

  // Correlation reading
  const corr = data.currentAvgCorrelation ?? null;
  const corrLabel =
    corr === null ? "—" :
    corr > 0.6 ? "High" :
    corr > 0.3 ? "Moderate" :
    corr > 0 ? "Low" : "Negative";
  const corrMeaning =
    corr === null ? "" :
    corr > 0.6 ? "Stocks are moving together — diversification is less effective. A broad market move (up or down) affects almost everyone." :
    corr > 0.3 ? "Stocks are somewhat linked. Some diversification benefit, but broad moves still matter." :
    corr > 0 ? "Stocks are moving fairly independently. Diversification is working well." :
    "Stocks are moving in opposite directions, which is unusual. Very high diversification benefit.";

  return (
    <main style={{ padding: "20px 24px", maxWidth: 1400, margin: "0 auto", fontFamily: "monospace" }}>

      {/* ── HEADER ── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Link href="/stocks" style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.5)", textDecoration: "none" }}>
            ← Asset List
          </Link>
          <span style={{ color: "#30363d" }}>|</span>
          <div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <span style={{ fontSize: 20, fontWeight: 700, color: "#fff" }}>OBX</span>
              <span style={{ fontSize: 14, color: "rgba(255,255,255,0.5)" }}>Oslo Bors — Market Volatility Dashboard</span>
            </div>
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", marginTop: 2 }}>
              Volatility = how much prices are swinging day to day. Higher = more uncertainty.
            </div>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)" }}>History shown</div>
          <div style={{ display: "flex", gap: 2 }}>
            {[{ l: "6M", v: 126 }, { l: "1Y", v: 252 }, { l: "2Y", v: 504 }, { l: "5Y", v: 1260 }].map((tf) => {
              const isActive = limit === tf.v;
              return (
                <button
                  key={tf.v}
                  onClick={() => setLimit(tf.v)}
                  style={{
                    padding: "4px 10px", borderRadius: 3, fontSize: 11, fontWeight: 600,
                    border: `1px solid ${isActive ? "#3b82f6" : "#30363d"}`,
                    background: isActive ? "#3b82f6" : "transparent",
                    color: isActive ? "#fff" : "rgba(255,255,255,0.5)",
                    cursor: "pointer",
                  }}
                >
                  {tf.l}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── STRESS LEVEL BANNER ── */}
      <div
        style={{
          padding: "14px 20px",
          borderRadius: 8,
          marginBottom: 12,
          background: getRegimeBackgroundTint(regime),
          border: `1px solid ${regimeColor}44`,
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
              <div style={{ width: 10, height: 10, borderRadius: "50%", background: regimeColor, flexShrink: 0 }} />
              <span style={{ fontSize: 16, fontWeight: 700, color: regimeColor }}>{regimeInfo.label}</span>
              <span style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", fontWeight: 400 }}>
                for {idx.regimeDuration} trading {idx.regimeDuration === 1 ? "day" : "days"} · {idx.trend}
              </span>
            </div>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.6)", marginLeft: 20 }}>{regimeInfo.sub}</div>
          </div>
          <div style={{
            padding: "8px 14px",
            borderRadius: 6,
            background: `${regimeColor}18`,
            border: `1px solid ${regimeColor}33`,
            maxWidth: 340,
          }}>
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", color: "rgba(255,255,255,0.4)", textTransform: "uppercase", marginBottom: 4 }}>
              What this means for investors
            </div>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.75)", lineHeight: 1.5 }}>{regimeInfo.guidance}</div>
          </div>
        </div>
      </div>

      {/* ── 3-COLUMN METRICS ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12, marginBottom: 20 }}>

        {/* Card 1: Volatility level */}
        <Panel>
          <CardTitle>How volatile is the market today?</CardTitle>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginBottom: 12 }}>
            Annual volatility = expected price swing over a full year
          </div>

          {/* Big number */}
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 4 }}>
            <span style={{ fontSize: 32, fontWeight: 800, color: regimeColor }}>{fmtPct(idx.yangZhang)}</span>
            <span style={{ fontSize: 12, color: "rgba(255,255,255,0.4)" }}>annualized</span>
          </div>

          {/* Percentile bar */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
              <span style={{ fontSize: 10, color: "rgba(255,255,255,0.4)" }}>Historical context</span>
              <span style={{ fontSize: 10, fontWeight: 700, color: regimeColor }}>
                Higher than {pct.toFixed(0)}% of all days
              </span>
            </div>
            <div style={{ height: 6, borderRadius: 3, background: "#21262d", position: "relative", overflow: "hidden" }}>
              <div style={{ position: "absolute", left: 0, top: 0, height: "100%", width: `${pct}%`, background: regimeColor, borderRadius: 3, transition: "width 0.5s ease" }} />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 3 }}>
              <span style={{ fontSize: 9, color: "rgba(255,255,255,0.25)" }}>Very low</span>
              <span style={{ fontSize: 9, color: "rgba(255,255,255,0.25)" }}>Average</span>
              <span style={{ fontSize: 9, color: "rgba(255,255,255,0.25)" }}>Very high</span>
            </div>
            <div style={{ marginTop: 6, fontSize: 11, color: "rgba(255,255,255,0.5)" }}>
              Today&apos;s volatility is <strong style={{ color: "#fff" }}>{pctLabel}</strong> compared to the last {limit === 126 ? "6 months" : limit === 252 ? "year" : limit === 504 ? "2 years" : "5 years"}.
            </div>
          </div>

          <div style={{ borderTop: "1px solid #30363d", paddingTop: 10, display: "flex", flexDirection: "column", gap: 2 }}>
            <SmallRow label="4-week average" value={fmtPct(idx.rolling20)} hint="Avg daily swings over last 20 trading days" />
            <SmallRow label="3-month average" value={fmtPct(idx.rolling60)} />
            <SmallRow label="6-month average" value={fmtPct(idx.rolling120)} />
            <SmallRow label="Recent trend" value={fmtPct(idx.ewma94)} hint="Weights recent days more heavily" />
          </div>
        </Panel>

        {/* Card 2: How many stocks are stressed */}
        <Panel>
          <CardTitle>Which stocks are stressed?</CardTitle>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginBottom: 12 }}>
            Each of the {data.constituentCount} OBX stocks is assigned a stress level
          </div>

          <RegimeDistribution distribution={data.summary.regimeDistribution} total={data.constituentCount} />

          <div style={{ marginTop: 14, display: "flex", gap: 8 }}>
            <div style={{ flex: 1, padding: "10px 12px", borderRadius: 6, background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", textAlign: "center" }}>
              <div style={{ fontSize: 22, fontWeight: 800, color: "#ef4444" }}>{data.summary.highVolCount}</div>
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginTop: 2 }}>stocks under stress</div>
            </div>
            <div style={{ flex: 1, padding: "10px 12px", borderRadius: 6, background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.2)", textAlign: "center" }}>
              <div style={{ fontSize: 22, fontWeight: 800, color: "#10b981" }}>{data.summary.lowVolCount}</div>
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginTop: 2 }}>stocks are calm</div>
            </div>
          </div>

          <div style={{ marginTop: 10, padding: "8px 10px", borderRadius: 5, background: "rgba(255,255,255,0.03)", border: "1px solid #21262d" }}>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", lineHeight: 1.5 }}>
              Average stock swing: <strong style={{ color: "#fff" }}>{fmtPct(data.summary.avgConstituentVol)}</strong> per year.
              {data.summary.volDispersion > 0.1
                ? " Stocks vary widely — some are calm while others are stressed."
                : " Stocks are behaving similarly to each other."}
            </div>
          </div>
        </Panel>

        {/* Card 3: Are stocks moving together */}
        <Panel>
          <CardTitle>Are stocks moving together?</CardTitle>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginBottom: 12 }}>
            When stocks move together, diversification provides less protection
          </div>

          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 6 }}>
            <span style={{ fontSize: 28, fontWeight: 800, color: "#fff" }}>{corrLabel}</span>
            {corr !== null && (
              <span style={{ fontSize: 11, color: "rgba(255,255,255,0.35)" }}>
                ({corr > 0 ? "+" : ""}{corr.toFixed(2)} correlation)
              </span>
            )}
          </div>

          {/* Correlation bar -1 to +1 */}
          {corr !== null && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ height: 6, borderRadius: 3, background: "#21262d", position: "relative" }}>
                <div style={{
                  position: "absolute",
                  left: `${((corr + 1) / 2) * 100}%`,
                  top: -3,
                  width: 12, height: 12,
                  borderRadius: "50%",
                  background: corr > 0.6 ? "#ef4444" : corr > 0.3 ? "#f59e0b" : "#10b981",
                  transform: "translateX(-50%)",
                  border: "2px solid #0a0a0a",
                }} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
                <span style={{ fontSize: 9, color: "rgba(255,255,255,0.25)" }}>Moving opposite</span>
                <span style={{ fontSize: 9, color: "rgba(255,255,255,0.25)" }}>No link</span>
                <span style={{ fontSize: 9, color: "rgba(255,255,255,0.25)" }}>Moving together</span>
              </div>
            </div>
          )}

          <div style={{ padding: "10px 12px", borderRadius: 6, background: "rgba(255,255,255,0.03)", border: "1px solid #21262d" }}>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.6)", lineHeight: 1.6 }}>{corrMeaning}</div>
          </div>
        </Panel>

      </div>

      {/* ── PRICE HISTORY WITH STRESS LEVELS ── */}
      {data.regimeHistory && data.regimeHistory.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ marginBottom: 8 }}>
            <SectionTitle>Price history — colored by stress level</SectionTitle>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginTop: 3 }}>
              The background color shows how stressed the market was at each point in time. Darker red = more stress.
            </div>
          </div>
          <RegimeTimeline
            data={data.regimeHistory}
            regimeStats={{
              currentDuration: idx.regimeDuration,
              averageDuration: 0,
              lastShift: null,
            }}
          />
        </div>
      )}

      {/* ── VOL CONE ── */}
      {data.volCone && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ marginBottom: 8 }}>
            <SectionTitle>How does today compare to history?</SectionTitle>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginTop: 3 }}>
              The chart below shows the typical range of volatility over different time windows (1 week to 1 year). The dot shows where we are today — if it&apos;s outside the shaded band, conditions are unusual.
            </div>
          </div>
          <VolConeChart data={data.volCone} />
        </div>
      )}

      {/* ── CONSTITUENT HEATMAP ── */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10, gap: 8, flexWrap: "wrap" }}>
          <div>
            <SectionTitle>Individual stock stress levels</SectionTitle>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginTop: 3 }}>
              Each row is one OBX stock. Color shows stress level. Click any ticker to see its full volatility detail.
            </div>
          </div>
          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", whiteSpace: "nowrap" }}>
            {data.constituentCount} stocks total
          </span>
        </div>
        <div style={{ padding: 16, borderRadius: 8, border: "1px solid #30363d", background: "rgba(255,255,255,0.02)" }}>
          <ConstituentHeatmap constituents={data.constituents} />
        </div>
      </div>

      {/* ── MARKET SUMMARY ── */}
      <div style={{
        padding: "16px 20px",
        borderRadius: 8,
        border: "1px solid #30363d",
        background: "rgba(255,255,255,0.02)",
        marginBottom: 16,
      }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", color: "rgba(255,255,255,0.6)", textTransform: "uppercase", marginBottom: 8 }}>
          Summary
        </div>
        <div style={{ fontSize: 13, color: "rgba(255,255,255,0.75)", lineHeight: 1.7 }}>{idx.interpretation}</div>
      </div>

      {/* ── QUICK GLOSSARY ── */}
      <details style={{ marginBottom: 16 }}>
        <summary style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", cursor: "pointer", userSelect: "none", padding: "6px 0" }}>
          Glossary — what do these terms mean?
        </summary>
        <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 8 }}>
          {[
            { term: "Volatility", def: "How much a stock or index moves up and down. High volatility = big swings, more uncertainty." },
            { term: "Annualized volatility", def: "The expected total price swing over a full year if current conditions continued. 15% means the index could move ±15% from today." },
            { term: "Historical percentile", def: "If today's volatility is at the 87th percentile, it's higher than 87% of all days we've tracked. 50th = average." },
            { term: "Stress level (regime)", def: "We group each day into one of 6 stress levels based on how unusual the volatility is. From Very Calm to Market Crisis." },
            { term: "Correlation", def: "How much stocks move together. +1 = perfectly in sync, 0 = no link, −1 = always opposite." },
            { term: "Diversification", def: "Spreading money across different stocks. Works best when stocks don't all move the same way." },
          ].map(({ term, def }) => (
            <div key={term} style={{ padding: "10px 12px", borderRadius: 6, background: "rgba(255,255,255,0.02)", border: "1px solid #21262d" }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.7)", marginBottom: 4 }}>{term}</div>
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", lineHeight: 1.5 }}>{def}</div>
            </div>
          ))}
        </div>
      </details>

      {/* ── DATA SOURCES ── */}
      <div style={{ borderTop: "1px solid #21262d", paddingTop: 12, fontSize: 9, color: "rgba(255,255,255,0.25)", lineHeight: 1.8 }}>
        <span style={{ fontWeight: 700, letterSpacing: "0.06em", color: "rgba(255,255,255,0.35)" }}>DATA SOURCES</span>
        <div style={{ marginTop: 4 }}>
          Prices: Interactive Brokers TWS API, Yahoo Finance &middot;
          Volatility: Yang-Zhang statistical estimator, EWMA &middot;
          Stress levels: 6-regime classification based on historical percentile ranking &middot;
          Correlation: Rolling 60-day pairwise, OBX constituents
        </div>
      </div>

    </main>
  );
}

// ── Helper Components ──

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ padding: 16, borderRadius: 8, border: "1px solid #30363d", background: "rgba(255,255,255,0.02)" }}>
      {children}
    </div>
  );
}

function CardTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 13, fontWeight: 700, color: "#fff", marginBottom: 2 }}>
      {children}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "rgba(255,255,255,0.6)" }}>
      {children}
    </div>
  );
}

function SmallRow({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "2px 0" }}>
      <span style={{ fontSize: 11, color: "rgba(255,255,255,0.45)" }}>
        {label}
        {hint && <span style={{ fontSize: 9, color: "rgba(255,255,255,0.25)", marginLeft: 4 }}>({hint})</span>}
      </span>
      <span style={{ fontSize: 12, fontWeight: 600, color: "#fff" }}>{value}</span>
    </div>
  );
}

function RegimeDistribution({ distribution, total }: { distribution: Record<string, number>; total: number }) {
  const regimes = [
    { key: "Crisis", label: "Crisis", color: "#B71C1C" },
    { key: "Extreme High", label: "Very High", color: "#ef4444" },
    { key: "Elevated", label: "Elevated", color: "#f59e0b" },
    { key: "Normal", label: "Normal", color: "#9E9E9E" },
    { key: "Low & Contracting", label: "Calm", color: "#10b981" },
    { key: "Low & Stable", label: "Very Calm", color: "#1B5E20" },
  ];

  return (
    <div>
      {/* Stacked bar */}
      <div style={{ display: "flex", height: 14, borderRadius: 4, overflow: "hidden", border: "1px solid #21262d" }}>
        {regimes.map(({ key, color }) => {
          const count = distribution[key] || 0;
          if (count === 0) return null;
          const pct = (count / total) * 100;
          return (
            <div
              key={key}
              style={{ width: `${pct}%`, background: color, minWidth: 2, position: "relative" }}
              title={`${key}: ${count} stocks`}
            />
          );
        })}
      </div>
      {/* Legend */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 10px", marginTop: 8 }}>
        {regimes.map(({ key, label, color }) => {
          const count = distribution[key] || 0;
          if (count === 0) return null;
          return (
            <div key={key} style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <div style={{ width: 8, height: 8, borderRadius: 2, background: color, flexShrink: 0 }} />
              <span style={{ fontSize: 10, color: "rgba(255,255,255,0.55)" }}>
                {label}: <strong style={{ color }}>{count}</strong>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
