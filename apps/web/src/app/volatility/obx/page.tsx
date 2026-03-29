"use client";

/**
 * OBX Index-Level Volatility Dashboard
 *
 * Market-wide volatility intelligence for the Oslo Bors.
 * Shows OBX regime, constituent heatmap, vol cone, systemic risk.
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
          if (!cancelled) {
            setError(`API error: ${text}`);
            setData(null);
          }
          return;
        }
        const json = await res.json();
        if (!cancelled) {
          setData(json);
          setLoading(false);
        }
      } catch (e: any) {
        if (!cancelled) {
          setError(e?.message ?? String(e));
          setLoading(false);
        }
      }
    }
    load();
    return () => {
      cancelled = true;
    };
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

  return (
    <main style={{ padding: "20px 24px", maxWidth: 1400, margin: "0 auto", fontFamily: "monospace" }}>

      {/* ── HEADER ── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Link href="/stocks" style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.5)", textDecoration: "none" }}>
            ← Asset List
          </Link>
          <span style={{ color: "#30363d" }}>|</span>
          <span style={{ fontSize: 20, fontWeight: 700, color: "#fff" }}>OBX</span>
          <span style={{ fontSize: 14, color: "rgba(255,255,255,0.5)" }}>Index Volatility Dashboard</span>
        </div>
        <div style={{ display: "flex", gap: 2 }}>
          {[
            { l: "6M", v: 126 },
            { l: "1Y", v: 252 },
            { l: "2Y", v: 504 },
            { l: "5Y", v: 1260 },
          ].map((tf) => {
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

      {/* ── REGIME STATUS BAR ── */}
      <div
        style={{
          padding: "12px 16px",
          borderRadius: 8,
          marginBottom: 16,
          background: getRegimeBackgroundTint(regime),
          border: `1px solid ${regimeColor}33`,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 8,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: regimeColor }} />
          <span style={{ fontSize: 13, fontWeight: 700, color: regimeColor }}>{regime}</span>
          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.5)" }}>
            {idx.regimeDuration}d in regime · {idx.trend}
          </span>
        </div>
        <span style={{ fontSize: 12, fontWeight: 600, color: "#fff" }}>
          {fmtPct(idx.annualizedVol)} ann. · P{idx.percentile?.toFixed(0)}
        </span>
      </div>

      {/* ── 3-COLUMN METRICS ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12, marginBottom: 20 }}>
        {/* Col 1: Index Vol Metrics */}
        <MetricCard title="Index Volatility">
          <MetricRow label="Yang-Zhang" value={fmtPct(idx.yangZhang)} />
          <MetricRow label="20d Rolling" value={fmtPct(idx.rolling20)} />
          <MetricRow label="60d Rolling" value={fmtPct(idx.rolling60)} />
          <MetricRow label="120d Rolling" value={fmtPct(idx.rolling120)} />
          <MetricRow label="EWMA (λ=.94)" value={fmtPct(idx.ewma94)} />
          <div style={{ borderTop: "1px solid #30363d", marginTop: 6, paddingTop: 6 }}>
            <MetricRow label="Percentile" value={`P${idx.percentile?.toFixed(0) ?? "—"}`} highlight />
          </div>
        </MetricCard>

        {/* Col 2: Regime Distribution */}
        <MetricCard title="Regime Distribution">
          <RegimeDistribution distribution={data.summary.regimeDistribution} total={data.constituentCount} />
          <div style={{ marginTop: 10, borderTop: "1px solid #30363d", paddingTop: 8 }}>
            <MetricRow label="Constituents" value={String(data.constituentCount)} />
            <MetricRow label="High Vol" value={String(data.summary.highVolCount)} color="#ef4444" />
            <MetricRow label="Low Vol" value={String(data.summary.lowVolCount)} color="#10b981" />
          </div>
        </MetricCard>

        {/* Col 3: Systemic Risk */}
        <MetricCard title="Systemic Risk">
          <MetricRow label="Avg Correlation" value={data.currentAvgCorrelation != null ? data.currentAvgCorrelation.toFixed(3) : "—"} highlight />
          <MetricRow label="Avg Vol" value={fmtPct(data.summary.avgConstituentVol)} />
          <MetricRow label="Vol Dispersion" value={fmtPct(data.summary.volDispersion)} />
          <div style={{ marginTop: 8, padding: "6px 8px", borderRadius: 4, background: "rgba(255,255,255,0.03)", border: "1px solid #21262d" }}>
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", lineHeight: 1.5 }}>
              {data.currentAvgCorrelation != null && data.currentAvgCorrelation > 0.6
                ? "High correlation — diversification benefit reduced. Systemic risk elevated."
                : data.currentAvgCorrelation != null && data.currentAvgCorrelation < 0.3
                  ? "Low correlation — good diversification. Idiosyncratic moves dominate."
                  : "Moderate correlation — normal market conditions."}
            </div>
          </div>
        </MetricCard>
      </div>

      {/* ── REGIME TIMELINE ── */}
      {data.regimeHistory && data.regimeHistory.length > 0 && (
        <div style={{ marginBottom: 20 }}>
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
          <VolConeChart data={data.volCone} />
        </div>
      )}

      {/* ── CONSTITUENT HEATMAP ── */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <SectionTitle>Constituent Volatility</SectionTitle>
          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>
            {data.constituentCount} stocks · Click ticker for detail
          </span>
        </div>
        <div style={{ padding: 16, borderRadius: 8, border: "1px solid #30363d", background: "rgba(255,255,255,0.02)" }}>
          <ConstituentHeatmap constituents={data.constituents} />
        </div>
      </div>

      {/* ── MARKET ASSESSMENT ── */}
      <div style={{
        padding: "14px 16px",
        borderRadius: 8,
        border: "1px solid #30363d",
        background: "rgba(255,255,255,0.02)",
        fontSize: 12,
        color: "rgba(255,255,255,0.5)",
        lineHeight: 1.7,
        marginBottom: 16,
      }}>
        <span style={{ fontWeight: 700, color: "rgba(255,255,255,0.8)", fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase" }}>
          Market Assessment
        </span>
        <div style={{ marginTop: 6 }}>{idx.interpretation}</div>
      </div>

      {/* ── DATA SOURCES ── */}
      <div style={{ borderTop: "1px solid #21262d", paddingTop: 12, fontSize: 9, color: "rgba(255,255,255,0.3)", lineHeight: 1.8 }}>
        <span style={{ fontWeight: 700, letterSpacing: "0.06em", color: "rgba(255,255,255,0.4)" }}>DATA SOURCES</span>
        <div style={{ marginTop: 4 }}>
          Prices: Interactive Brokers TWS API, Yahoo Finance &middot;{" "}
          Volatility: Yang-Zhang estimator, EWMA &middot;{" "}
          Regime: 6-regime classification (percentile-based) &middot;{" "}
          Correlation: Rolling 60-day window, OBX constituent data
        </div>
      </div>

    </main>
  );
}

// ── Helper Components ──

function MetricCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{
      padding: 16,
      borderRadius: 8,
      border: "1px solid #30363d",
      background: "rgba(255,255,255,0.02)",
    }}>
      <SectionTitle>{title}</SectionTitle>
      <div style={{ marginTop: 10 }}>{children}</div>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 11,
      fontWeight: 700,
      textTransform: "uppercase",
      letterSpacing: "0.08em",
      color: "rgba(255,255,255,0.6)",
      fontFamily: "monospace",
    }}>
      {children}
    </div>
  );
}

function MetricRow({ label, value, highlight, color }: { label: string; value: string; highlight?: boolean; color?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", fontFamily: "monospace", fontSize: 12 }}>
      <span style={{ color: "rgba(255,255,255,0.5)", fontSize: 11 }}>{label}</span>
      <span style={{
        fontWeight: highlight ? 700 : 600,
        fontSize: highlight ? 14 : 12,
        color: color ?? "#fff",
      }}>
        {value}
      </span>
    </div>
  );
}

function RegimeDistribution({ distribution, total }: { distribution: Record<string, number>; total: number }) {
  const regimes = [
    { key: "Crisis", color: "#B71C1C" },
    { key: "Extreme High", color: "#ef4444" },
    { key: "Elevated", color: "#f59e0b" },
    { key: "Normal", color: "#9E9E9E" },
    { key: "Low & Contracting", color: "#10b981" },
    { key: "Low & Stable", color: "#1B5E20" },
  ];

  return (
    <div>
      {/* Stacked bar */}
      <div style={{ display: "flex", height: 12, borderRadius: 4, overflow: "hidden", marginBottom: 8, border: "1px solid #21262d" }}>
        {regimes.map(({ key, color }) => {
          const count = distribution[key] || 0;
          if (count === 0) return null;
          const pct = (count / total) * 100;
          return (
            <div
              key={key}
              style={{ width: `${pct}%`, background: color, minWidth: count > 0 ? 2 : 0 }}
              title={`${key}: ${count}`}
            />
          );
        })}
      </div>
      {/* Labels */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "3px 8px" }}>
        {regimes.map(({ key, color }) => {
          const count = distribution[key] || 0;
          if (count === 0) return null;
          return (
            <span key={key} style={{ fontSize: 10, fontFamily: "monospace", color, fontWeight: 600 }}>
              {key}: {count}
            </span>
          );
        })}
      </div>
    </div>
  );
}
