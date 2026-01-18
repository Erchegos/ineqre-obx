"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import VolatilityChart from "@/components/VolatilityChart";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  Cell,
  CartesianGrid
} from "recharts";

// --- Types ---
type VolatilityData = {
  ticker: string;
  count: number;
  current: {
    date: string;
    historical: number | null;
    rolling20: number | null;
    rolling60: number | null;
    rolling120: number | null;
    ewma94: number | null;
    ewma97: number | null;
    parkinson: number | null;
    garmanKlass: number | null;
    rogersSatchell: number | null;
    yangZhang: number | null;
  };
  percentiles: {
    rolling20: number | null;
    rolling60: number | null;
    rolling120: number | null;
    ewma94: number | null;
    ewma97: number | null;
    parkinson: number | null;
    garmanKlass: number | null;
    rogersSatchell: number | null;
    yangZhang: number | null;
  };
  series: Array<{
    date: string;
    historical?: number;
    rolling20?: number;
    rolling60?: number;
    rolling120?: number;
    ewma94?: number;
    ewma97?: number;
    parkinson?: number;
    garmanKlass?: number;
    rogersSatchell?: number;
    yangZhang?: number;
    close?: number; 
  }>;
  dateRange: {
    start: string;
    end: string;
  };
};

// --- Configuration ---
const MEASURE_CONFIG = [
  { key: "yangZhang", label: "Yang-Zhang", color: "#f59e0b", desc: "Gap-Adjusted (Best)" },
  { key: "rogersSatchell", label: "Rogers-Satchell", color: "#22c55e", desc: "Trend-Robust" },
  { key: "rolling20", label: "20-Day Rolling", color: "#3b82f6", desc: "Standard Dev" },
  { key: "rolling60", label: "60-Day Rolling", color: "#10b981", desc: "Medium-term" },
  { key: "rolling120", label: "120-Day Rolling", color: "#8b5cf6", desc: "Long-term" },
  { key: "ewma94", label: "EWMA (λ=0.94)", color: "#6366f1", desc: "Reacts fast" },
  { key: "parkinson", label: "Parkinson", color: "#ef4444", desc: "High-Low Range" },
  { key: "garmanKlass", label: "Garman-Klass", color: "#06b6d4", desc: "OHLC Based" },
];

function clampInt(v: string | null, def: number, min: number, max: number) {
  const n = v ? Number(v) : Number.NaN;
  if (!Number.isFinite(n)) return def;
  return Math.min(Math.max(Math.trunc(n), min), max);
}

// Helper: Formatting numbers
const fmtPct = (n: number | null | undefined) => (n !== null && n !== undefined ? `${(n * 100).toFixed(2)}%` : "—");

export default function VolatilityPage() {
  const params = useParams<{ ticker?: string }>();
  const searchParams = useSearchParams();

  const ticker = useMemo(() => {
    const t = params?.ticker;
    return typeof t === "string" && t.length ? decodeURIComponent(t).toUpperCase() : "";
  }, [params]);

  const initialLimit = useMemo(() => {
    return clampInt(searchParams.get("limit"), 1500, 100, 2000);
  }, [searchParams]);

  const [limit, setLimit] = useState<number>(initialLimit);
  const [isAdjusted, setIsAdjusted] = useState<boolean>(true);
  
  const [loading, setLoading] = useState<boolean>(true);
  const [data, setData] = useState<VolatilityData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [selectedMeasures, setSelectedMeasures] = useState<string[]>([
    "yangZhang",
    "rogersSatchell",
    "rolling20"
  ]);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (!ticker) return;
      setLoading(true);
      setError(null);
      try {
        const url = `/api/volatility/${encodeURIComponent(ticker)}?limit=${limit}&adjusted=${isAdjusted}`;
        const res = await fetch(url, {
          method: "GET",
          headers: { accept: "application/json" },
          cache: "no-store",
        });

        if (!res.ok) {
          const text = await res.text();
          if (!cancelled) {
            setError(`Volatility API failed: ${text}`);
            setData(null);
          }
          return;
        }

        const json = (await res.json()) as VolatilityData;
        if (!cancelled) {
          setData(json);
          setLoading(false);
        }
      } catch (e: any) {
        if (!cancelled) {
          setError(e?.message ?? String(e));
          setData(null);
          setLoading(false);
        }
      }
    }

    run();
    return () => { cancelled = true; };
  }, [ticker, limit, isAdjusted]);

  const toggleMeasure = (measure: string) => {
    setSelectedMeasures((prev) =>
      prev.includes(measure) ? prev.filter((m) => m !== measure) : [...prev, measure]
    );
  };

  // --- Derived Metrics ---
  const stats = useMemo(() => {
    if (!data) return null;

    const primaryVol = data.current.yangZhang ?? data.current.rogersSatchell ?? data.current.rolling20 ?? 0;
    const percentile = data.percentiles.yangZhang ?? data.percentiles.rogersSatchell ?? 0;
    
    let regime = "Normal";
    let regimeColor = "var(--foreground)";
    if (percentile > 90) { regime = "Extreme High"; regimeColor = "#ef4444"; }
    else if (percentile > 75) { regime = "Elevated"; regimeColor = "#f59e0b"; }
    else if (percentile < 20) { regime = "Compressed"; regimeColor = "#22c55e"; }

    const shortTerm = data.current.rolling20 ?? 0;
    const longTerm = data.current.rolling60 ?? 0;
    const trend = shortTerm > longTerm ? "Expanding" : "Contracting";
    
    const seriesVals = data.series
        .map(s => s.yangZhang ?? s.rogersSatchell)
        .filter((n): n is number => typeof n === 'number');
    const maxVol = seriesVals.length ? Math.max(...seriesVals) : 0;
    const minVol = seriesVals.length ? Math.min(...seriesVals) : 0;

    const impliedDay = primaryVol / 16;
    const impliedWeek = primaryVol / 7.2;

    return { primaryVol, percentile, regime, regimeColor, trend, maxVol, minVol, impliedDay, impliedWeek };
  }, [data]);

  if (loading && !data) return <main style={{ padding: 24 }}>Loading...</main>;
  if (error || !data || !stats) return <main style={{ padding: 24 }}>Error: {error}</main>;

  return (
    <main style={{ padding: 24, maxWidth: 1400, margin: "0 auto" }}>
      {/* Header with Price Toggle */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24, flexWrap: "wrap", gap: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <h1 style={{ fontSize: 32, fontWeight: 600, margin: 0, color: "var(--foreground)" }}>
            {data.ticker}
          </h1>
          <span style={{ fontSize: 14, color: "var(--muted)", fontWeight: 500, padding: "4px 8px", background: "var(--card-bg)", borderRadius: 4, border: "1px solid var(--border-subtle)" }}>
            Volatility Lab
          </span>
        </div>
        
        <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
            {/* Raw vs Adjusted Toggle */}
            <div style={{ display: "flex", background: "var(--card-bg)", borderRadius: 6, border: "1px solid var(--border-subtle)", padding: 2 }}>
                <button
                    onClick={() => setIsAdjusted(false)}
                    style={{
                        padding: "6px 12px",
                        fontSize: 12,
                        fontWeight: 500,
                        borderRadius: 4,
                        border: "none",
                        background: !isAdjusted ? "var(--muted-foreground)" : "transparent",
                        color: !isAdjusted ? "#fff" : "var(--muted)",
                        cursor: "pointer"
                    }}
                >
                    Price (Raw)
                </button>
                <button
                    onClick={() => setIsAdjusted(true)}
                    style={{
                        padding: "6px 12px",
                        fontSize: 12,
                        fontWeight: 500,
                        borderRadius: 4,
                        border: "none",
                        background: isAdjusted ? "var(--accent)" : "transparent",
                        color: isAdjusted ? "#fff" : "var(--muted)",
                        cursor: "pointer"
                    }}
                >
                    Total Return
                </button>
            </div>

            {/* Timeframe Selector */}
            <div style={{ display: "flex", gap: 4 }}>
            {[ { l: "6M", v: 126 }, { l: "1Y", v: 252 }, { l: "2Y", v: 504 }, { l: "Max", v: 2000 } ].map((tf) => (
                <button
                key={tf.v}
                onClick={() => setLimit(tf.v)}
                style={{
                    padding: "6px 10px",
                    borderRadius: 3,
                    border: limit === tf.v ? "1px solid var(--accent)" : "1px solid var(--border-subtle)",
                    background: limit === tf.v ? "var(--accent)" : "transparent",
                    color: limit === tf.v ? "#fff" : "var(--muted)",
                    fontSize: 11,
                    cursor: "pointer",
                }}
                >
                {tf.l}
                </button>
            ))}
            </div>
        </div>
      </div>

      {/* --- 8 QUANT STATS DASHBOARD --- */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginBottom: 32 }}>
        <StatBox label="Current Vol (YZ)" value={fmtPct(stats.primaryVol)} sub="Gap-Adjusted" highlight />
        <StatBox label="Vol Percentile" value={`${stats.percentile.toFixed(0)}th`} sub="vs. History" />
        <StatBox label="Vol Regime" value={stats.regime} sub="Condition" color={stats.regimeColor} />
        <StatBox label="Vol Trend" value={stats.trend} sub="Short vs Long" color={stats.trend === "Expanding" ? "#ef4444" : "#22c55e"} />
        <StatBox label="Implied Move (1D)" value={`±${(stats.impliedDay * 100).toFixed(2)}%`} sub="Expected Daily" />
        <StatBox label="Implied Move (1W)" value={`±${(stats.impliedWeek * 100).toFixed(2)}%`} sub="Expected Weekly" />
        <StatBox label={`High Vol (${limit}d)`} value={fmtPct(stats.maxVol)} sub="Period Max" />
        <StatBox label={`Low Vol (${limit}d)`} value={fmtPct(stats.minVol)} sub="Period Min" />
      </div>

      {/* --- CHART SECTION --- */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
           <h2 style={{ fontSize: 18, fontWeight: 600, color: "var(--foreground)" }}>Volatility Time Series</h2>
        </div>

        <div style={{ marginBottom: 16, display: "flex", flexWrap: "wrap", gap: 10 }}>
          {MEASURE_CONFIG.map((config) => {
            const isSelected = selectedMeasures.includes(config.key);
            return (
              <button
                key={config.key}
                onClick={() => toggleMeasure(config.key)}
                style={{
                  padding: "6px 12px",
                  borderRadius: 20,
                  border: `1px solid ${isSelected ? config.color : "var(--border-subtle)"}`,
                  background: isSelected ? `${config.color}15` : "transparent",
                  color: isSelected ? config.color : "var(--muted)",
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  transition: "all 0.2s"
                }}
              >
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: config.color, opacity: isSelected ? 1 : 0.4 }} />
                {config.label}
              </button>
            );
          })}
        </div>

        <div style={{ padding: 20, borderRadius: 4, border: "1px solid var(--card-border)", background: "var(--card-bg)" }}>
          <VolatilityChart data={data.series} selectedMeasures={selectedMeasures} height={400} />
        </div>
      </div>

      {/* --- RISK CONES & SEASONALITY GRID --- */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
        {/* Left: Cones */}
        <div>
          <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16, color: "var(--foreground)" }}>Implied Risk Cones (1σ)</h3>
          <div style={{ padding: 20, borderRadius: 4, border: "1px solid var(--card-border)", background: "var(--card-bg)" }}>
            <p style={{ color: "var(--muted)", fontSize: 13, marginBottom: 16 }}>
              Probability (68%) range based on current <strong>{stats.primaryVol > 0 ? "Yang-Zhang" : "Standard"}</strong> volatility.
            </p>
            <div style={{ display: "grid", gap: 8 }}>
              {[ { l: "1 Week", d: 5 }, { l: "1 Month", d: 21 }, { l: "1 Quarter", d: 63 } ].map((p) => {
                const rangeVal = stats.primaryVol ? (stats.primaryVol / Math.sqrt(252) * Math.sqrt(p.d) * 100).toFixed(2) : "—";
                return (
                  <div key={p.l} style={{ display: "flex", justifyContent: "space-between", padding: "10px 14px", background: "var(--hover-bg)", borderRadius: 4, border: "1px solid var(--border-subtle)" }}>
                    <span style={{ fontSize: 13, fontWeight: 500 }}>{p.l}</span>
                    <div style={{ fontFamily: "monospace", fontSize: 13 }}>
                      <span style={{ color: "var(--success)" }}>+{rangeVal}%</span> / <span style={{ color: "var(--danger)" }}>-{rangeVal}%</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right: Seasonality (Replaced dummy input with this) */}
        <div>
          <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16, color: "var(--foreground)" }}>Volatility Seasonality</h3>
           <div style={{ padding: 20, borderRadius: 4, border: "1px solid var(--card-border)", background: "var(--card-bg)", height: 260 }}>
             <SeasonalityChart data={data.series} />
          </div>
        </div>
      </div>
    </main>
  );
}

// --- SUB-COMPONENTS ---

function StatBox({ label, value, sub, highlight, color }: { label: string; value: string; sub: string; highlight?: boolean; color?: string }) {
  return (
    <div style={{
      padding: 16,
      borderRadius: 4,
      background: highlight ? "rgba(245, 158, 11, 0.08)" : "var(--card-bg)",
      border: highlight ? "1px solid #f59e0b" : "1px solid var(--card-border)",
      display: "flex",
      flexDirection: "column",
      justifyContent: "space-between"
    }}>
      <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", fontWeight: 700, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 600, color: color || "var(--foreground)", fontFamily: "monospace" }}>{value}</div>
      <div style={{ fontSize: 11, color: "var(--muted-foreground)", marginTop: 4 }}>{sub}</div>
    </div>
  );
}

// --- NEW SEASONALITY CHART (Fixed) ---
function SeasonalityChart({ data }: { data: any[] }) {
  const seasonalData = useMemo(() => {
    // FIX: Always return valid structure, even if empty
    if (!data || data.length === 0) {
        return { result: [], maxVol: 0, minVol: 0 };
    }

    const months = Array.from({ length: 12 }, () => ({ sum: 0, count: 0 }));
    
    data.forEach((day) => {
      // Use YangZhang, fallback to Rolling20
      const val = day.yangZhang ?? day.rolling20;
      if (val) {
        const date = new Date(day.date);
        const monthIndex = date.getMonth(); 
        months[monthIndex].sum += val;
        months[monthIndex].count += 1;
      }
    });

    const result = months.map((m, i) => ({
      month: new Date(2000, i, 1).toLocaleString("en-US", { month: "short" }),
      avgVol: m.count > 0 ? m.sum / m.count : 0,
    }));

    const maxVol = Math.max(...result.map((r) => r.avgVol));
    const minVol = Math.min(...result.map((r) => r.avgVol));
    return { result, maxVol, minVol };
  }, [data]);

  const getColor = (val: number, min: number, max: number) => {
    // Simple heatmap logic: Blue -> Orange -> Red
    const ratio = (val - min) / (max - min || 1);
    if (ratio > 0.8) return "#ef4444"; 
    if (ratio > 0.5) return "#f59e0b"; 
    return "#3b82f6"; 
  };

  if (!data || !data.length) return <div style={{color: "var(--muted)", fontSize: 13}}>No Data Available</div>;

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart 
        data={seasonalData.result} 
        margin={{ top: 10, right: 0, left: -25, bottom: 0 }}
      >
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border-subtle)" opacity={0.3} />
        <XAxis 
          dataKey="month" 
          axisLine={false} 
          tickLine={false} 
          tick={{ fill: "var(--muted)", fontSize: 11 }} 
          dy={10}
        />
        <YAxis 
          axisLine={false} 
          tickLine={false} 
          tickFormatter={(val) => `${(val * 100).toFixed(0)}%`} 
          tick={{ fill: "var(--muted)", fontSize: 11 }} 
        />
        <RechartsTooltip
          cursor={{ fill: "var(--muted)", opacity: 0.1 }}
          content={({ active, payload }) => {
            if (active && payload && payload.length) {
              return (
                <div style={{ background: "var(--card-bg)", border: "1px solid var(--border-subtle)", padding: "8px", borderRadius: "4px", fontSize: "12px" }}>
                  <span style={{ fontWeight: 600 }}>{payload[0].payload.month}: </span>
                  <span style={{ fontFamily: "monospace" }}>
                    {(Number(payload[0].value) * 100).toFixed(2)}% Avg
                  </span>
                </div>
              );
            }
            return null;
          }}
        />
        <Bar dataKey="avgVol" radius={[2, 2, 0, 0]}>
          {seasonalData.result.map((entry: any, index: number) => (
            <Cell 
              key={`cell-${index}`} 
              fill={getColor(entry.avgVol, seasonalData.minVol, seasonalData.maxVol)} 
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}