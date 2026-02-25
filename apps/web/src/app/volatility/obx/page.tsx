"use client";

/**
 * OBX Index-Level Volatility Dashboard
 *
 * Phase 5: Market-wide volatility intelligence for the Oslo Bors.
 * Shows OBX regime, constituent heatmap, vol cone, systemic risk,
 * and links to ML models for OBX index.
 */

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";

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
      <main style={{ padding: 24, fontFamily: "monospace" }}>
        <div style={{ fontSize: 14, color: "var(--muted-foreground)" }}>Loading OBX dashboard...</div>
      </main>
    );
  }
  if (error || !data) {
    return (
      <main style={{ padding: 24, fontFamily: "monospace" }}>
        <div style={{ color: "#F44336" }}>Error: {error}</div>
      </main>
    );
  }

  const idx = data.index;
  const regime = idx.regime as VolatilityRegime;
  const regimeColor = getRegimeColor(regime);

  return (
    <main style={{ padding: "20px 24px", maxWidth: 1400, margin: "0 auto" }}>
      {/* ═══ HEADER ═══ */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Link href="/stocks" style={{ fontSize: 12, fontWeight: 600, color: "var(--muted-foreground)", textDecoration: "none", fontFamily: "monospace" }}>
            ← Asset List
          </Link>
          <span style={{ color: "var(--border)" }}>|</span>
          <span style={{ fontSize: 24, fontWeight: 700, fontFamily: "monospace", color: "var(--foreground)" }}>OBX</span>
          <span style={{ fontSize: 14, color: "var(--muted-foreground)", fontFamily: "monospace" }}>Index Volatility Dashboard</span>
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
                  border: `1px solid ${isActive ? "var(--accent)" : "var(--border)"}`,
                  background: isActive ? "var(--accent)" : "transparent",
                  color: isActive ? "#fff" : "var(--muted-foreground)",
                  cursor: "pointer", fontFamily: "monospace",
                }}
              >
                {tf.l}
              </button>
            );
          })}
        </div>
      </div>

      {/* ═══ 1. REGIME STATUS BAR ═══ */}
      <div
        style={{
          padding: "10px 16px",
          borderRadius: 6,
          marginBottom: 16,
          background: getRegimeBackgroundTint(regime),
          border: `1px solid ${regimeColor}33`,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          fontFamily: "monospace",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: regimeColor }} />
          <span style={{ fontSize: 13, fontWeight: 700, color: regimeColor }}>{regime}</span>
          <span style={{ fontSize: 11, color: "var(--muted-foreground)" }}>
            {idx.regimeDuration}d in regime · {idx.trend}
          </span>
        </div>
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--foreground)" }}>
          {fmtPct(idx.annualizedVol)} ann. · P{idx.percentile?.toFixed(0)}
        </span>
      </div>

      {/* ═══ 2. DASHBOARD: 3-column layout ═══ */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, marginBottom: 24 }}>
        {/* Col 1: Index Vol Metrics */}
        <DashboardCard title="Index Volatility">
          <MetricRow label="Yang-Zhang" value={fmtPct(idx.yangZhang)} />
          <MetricRow label="20d Rolling" value={fmtPct(idx.rolling20)} />
          <MetricRow label="60d Rolling" value={fmtPct(idx.rolling60)} />
          <MetricRow label="120d Rolling" value={fmtPct(idx.rolling120)} />
          <MetricRow label="EWMA (λ=.94)" value={fmtPct(idx.ewma94)} />
          <MetricRow label="Percentile" value={`P${idx.percentile?.toFixed(0) ?? "—"}`} highlight />
        </DashboardCard>

        {/* Col 2: Constituent Distribution */}
        <DashboardCard title="Regime Distribution">
          <RegimeDistribution distribution={data.summary.regimeDistribution} total={data.constituentCount} />
          <div style={{ marginTop: 8, borderTop: "1px solid var(--border)", paddingTop: 8 }}>
            <MetricRow label="Constituents" value={String(data.constituentCount)} />
            <MetricRow label="High Vol" value={String(data.summary.highVolCount)} color="#F44336" />
            <MetricRow label="Low Vol" value={String(data.summary.lowVolCount)} color="#4CAF50" />
          </div>
        </DashboardCard>

        {/* Col 3: Systemic Risk */}
        <DashboardCard title="Systemic Risk">
          <MetricRow label="Avg Correlation" value={data.currentAvgCorrelation != null ? data.currentAvgCorrelation.toFixed(3) : "—"} highlight />
          <MetricRow label="Avg Vol" value={fmtPct(data.summary.avgConstituentVol)} />
          <MetricRow label="Vol Dispersion" value={fmtPct(data.summary.volDispersion)} />
          <div style={{ marginTop: 6, fontSize: 10, color: "var(--muted-foreground)", lineHeight: 1.5 }}>
            {data.currentAvgCorrelation != null && data.currentAvgCorrelation > 0.6
              ? "High correlation — diversification benefit reduced. Systemic risk elevated."
              : data.currentAvgCorrelation != null && data.currentAvgCorrelation < 0.3
                ? "Low correlation — good diversification. Idiosyncratic moves dominate."
                : "Moderate correlation — normal market conditions."}
          </div>
        </DashboardCard>
      </div>

      {/* ═══ 3. REGIME TIMELINE (price + regime overlay) ═══ */}
      {data.regimeHistory && data.regimeHistory.length > 0 && (
        <div style={{ marginBottom: 24 }}>
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

      {/* ═══ 4. TWO-COLUMN: Vol Cone + Avg Correlation ═══ */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 24 }}>
        {/* Vol Cone */}
        <div>
          {data.volCone && <VolConeChart data={data.volCone} />}
        </div>

        {/* Rolling Avg Pairwise Correlation */}
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--muted-foreground)", fontFamily: "monospace", marginBottom: 8 }}>
            Rolling Avg Pairwise Correlation (60d)
          </div>
          <CorrelationChart data={data.avgPairwiseCorrelation} />
        </div>
      </div>

      {/* ═══ 5. CONSTITUENT HEATMAP ═══ */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--muted-foreground)", fontFamily: "monospace" }}>
            Constituent Volatility
          </div>
          <span style={{ fontSize: 11, fontFamily: "monospace", color: "var(--muted-foreground)" }}>
            {data.constituentCount} stocks · Click ticker for detail
          </span>
        </div>
        <div style={{ padding: 16, borderRadius: 6, border: "1px solid var(--border)", background: "var(--card-bg)" }}>
          <ConstituentHeatmap constituents={data.constituents} />
        </div>
      </div>

      {/* ═══ 6. INTERPRETATION ═══ */}
      <div style={{
        padding: "12px 16px",
        borderRadius: 6,
        border: "1px solid var(--border)",
        background: "var(--card-bg)",
        fontFamily: "monospace",
        fontSize: 12,
        color: "var(--muted-foreground)",
        lineHeight: 1.6,
      }}>
        <span style={{ fontWeight: 700, color: "var(--foreground)" }}>Market Assessment:</span>{" "}
        {idx.interpretation}
      </div>
    </main>
  );
}

// ── Helper Components ──

function DashboardCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{
      padding: 16, borderRadius: 6,
      border: "1px solid var(--border)",
      background: "var(--card-bg)",
    }}>
      <div style={{
        fontSize: 10, fontWeight: 700, textTransform: "uppercase",
        letterSpacing: "0.08em", color: "var(--muted-foreground)",
        fontFamily: "monospace", marginBottom: 10,
      }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function MetricRow({ label, value, highlight, color }: { label: string; value: string; highlight?: boolean; color?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "2px 0", fontFamily: "monospace", fontSize: 12 }}>
      <span style={{ color: "var(--muted-foreground)", fontSize: 11 }}>{label}</span>
      <span style={{
        fontWeight: highlight ? 700 : 600,
        fontSize: highlight ? 14 : 12,
        color: color || "var(--foreground)",
      }}>
        {value}
      </span>
    </div>
  );
}

function RegimeDistribution({ distribution, total }: { distribution: Record<string, number>; total: number }) {
  const regimes = [
    { key: "Crisis", color: "#B71C1C" },
    { key: "Extreme High", color: "#F44336" },
    { key: "Elevated", color: "#FF9800" },
    { key: "Normal", color: "#9E9E9E" },
    { key: "Low & Contracting", color: "#4CAF50" },
    { key: "Low & Stable", color: "#1B5E20" },
  ];

  return (
    <div>
      {/* Stacked bar */}
      <div style={{ display: "flex", height: 12, borderRadius: 3, overflow: "hidden", marginBottom: 8 }}>
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
      <div style={{ display: "flex", flexWrap: "wrap", gap: "2px 8px" }}>
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

function CorrelationChart({ data }: { data: Array<{ date: string; avgCorrelation: number }> }) {
  if (!data || data.length === 0) {
    return (
      <div style={{ padding: 16, borderRadius: 6, border: "1px solid var(--border)", background: "var(--background)", height: 260, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "monospace", fontSize: 12, color: "var(--muted-foreground)" }}>
        Insufficient data for correlation
      </div>
    );
  }

  const chartData = data.map((d) => ({
    date: d.date,
    correlation: d.avgCorrelation,
  }));

  const fmtDate = (d: string) => (d.length >= 10 ? d.slice(5) : d);

  return (
    <div style={{ padding: 16, borderRadius: 6, border: "1px solid var(--border)", background: "var(--background)" }}>
      <ResponsiveContainer width="100%" height={228}>
        <AreaChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" strokeOpacity={0.3} />
          <XAxis
            dataKey="date"
            tickFormatter={fmtDate}
            tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
            interval="preserveStartEnd"
            minTickGap={50}
          />
          <YAxis
            domain={[0, 1]}
            tickFormatter={(v: number) => v.toFixed(2)}
            tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
            width={35}
          />
          <Tooltip
            contentStyle={{
              background: "var(--card-bg)",
              border: "1px solid var(--border)",
              borderRadius: 4,
              fontSize: 11,
              fontFamily: "monospace",
            }}
            formatter={(v: unknown) => [`${Number(v).toFixed(3)}`, "Avg Correlation"]}
          />
          <ReferenceLine y={0.5} stroke="var(--muted-foreground)" strokeDasharray="4 4" strokeOpacity={0.4} />
          <ReferenceLine y={0.3} stroke="#4CAF50" strokeDasharray="2 4" strokeOpacity={0.3} />
          <ReferenceLine y={0.6} stroke="#F44336" strokeDasharray="2 4" strokeOpacity={0.3} />
          <Area
            type="monotone"
            dataKey="correlation"
            stroke="#6366f1"
            strokeWidth={1.5}
            fill="rgba(99,102,241,0.1)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
