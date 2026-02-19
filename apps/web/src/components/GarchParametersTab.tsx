"use client";

/**
 * GarchParametersTab — GARCH(1,1) model output display.
 *
 * Shows: GARCH equation + params, conditional vol chart,
 * multi-step forecast, fit statistics, standardized residuals histogram.
 */

import { useMemo } from "react";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Cell,
} from "recharts";

type GarchData = {
  params: {
    omega: number;
    alpha: number;
    beta: number;
    persistence: number;
    half_life: number | null;
    unconditional_vol: number | null;
  };
  conditional_vol: number[];
  forecast: Record<string, number>;
  residuals: number[];
  fit_stats: {
    log_likelihood: number;
    aic: number;
    bic: number;
    num_obs: number;
  };
  dates?: string[];
};

type Props = {
  data: GarchData;
  ticker: string;
};

export default function GarchParametersTab({ data, ticker }: Props) {
  const { params, conditional_vol, forecast, residuals, fit_stats, dates } = data;

  // Conditional vol chart data
  const volChartData = useMemo(() => {
    return conditional_vol.map((vol, i) => ({
      date: dates?.[i] || `t-${conditional_vol.length - i}`,
      vol: vol * 100,
    }));
  }, [conditional_vol, dates]);

  // Residuals histogram
  const residualBins = useMemo(() => {
    if (residuals.length === 0) return [];
    const bins: { range: string; count: number; center: number }[] = [];
    const min = Math.max(-4, Math.min(...residuals));
    const max = Math.min(4, Math.max(...residuals));
    const nBins = 30;
    const step = (max - min) / nBins;
    for (let i = 0; i < nBins; i++) {
      const lo = min + i * step;
      const hi = lo + step;
      const center = (lo + hi) / 2;
      const count = residuals.filter((r) => r >= lo && r < hi).length;
      bins.push({ range: center.toFixed(1), count, center });
    }
    return bins;
  }, [residuals]);

  const fmtDate = (d: string) => {
    if (d.startsWith("t-")) return d;
    return d.length >= 10 ? d.slice(5) : d; // MM-DD
  };

  return (
    <div>
      {/* ── Row 1: GARCH Equation + Fit Stats ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 24 }}>
        {/* GARCH Equation */}
        <div style={{ padding: 20, borderRadius: 6, background: "var(--background)", border: "1px solid var(--border)" }}>
          <div style={{ ...headerStyle }}>GARCH(1,1) Parameters</div>
          <div style={{
            padding: "12px 16px", borderRadius: 4, background: "rgba(99,102,241,0.06)",
            border: "1px solid rgba(99,102,241,0.15)", marginBottom: 16, fontFamily: "monospace",
            fontSize: 13, lineHeight: 1.8, color: "var(--foreground)",
          }}>
            σ²<sub>t</sub> = {params.omega.toFixed(6)} + {params.alpha.toFixed(4)}·ε²<sub>t-1</sub> + {params.beta.toFixed(4)}·σ²<sub>t-1</sub>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 20px" }}>
            <ParamRow label="ω (omega)" value={params.omega.toFixed(6)} desc="Baseline variance" />
            <ParamRow label="α (ARCH)" value={params.alpha.toFixed(4)} desc="Shock reactivity" />
            <ParamRow label="β (GARCH)" value={params.beta.toFixed(4)} desc="Variance persistence" />
            <ParamRow label="α + β" value={params.persistence.toFixed(4)} desc={params.persistence > 0.99 ? "Near unit root" : params.persistence > 0.95 ? "High persistence" : "Moderate"} highlight={params.persistence > 0.99} />
            <ParamRow label="Half-life" value={params.half_life ? `${params.half_life.toFixed(1)}d` : "∞"} desc="Shock decay time" />
            <ParamRow label="Uncond. Vol" value={params.unconditional_vol ? `${(params.unconditional_vol * 100).toFixed(1)}%` : "—"} desc="Long-run annual." />
          </div>
        </div>

        {/* Fit Stats + Forecast */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ padding: 16, borderRadius: 6, background: "var(--background)", border: "1px solid var(--border)" }}>
            <div style={{ ...headerStyle }}>Fit Statistics</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 16px" }}>
              <StatRow label="Log-Likelihood" value={fit_stats.log_likelihood.toFixed(1)} />
              <StatRow label="Observations" value={fit_stats.num_obs.toString()} />
              <StatRow label="AIC" value={fit_stats.aic.toFixed(1)} />
              <StatRow label="BIC" value={fit_stats.bic.toFixed(1)} />
            </div>
          </div>

          <div style={{ padding: 16, borderRadius: 6, background: "var(--background)", border: "1px solid var(--border)", flex: 1 }}>
            <div style={{ ...headerStyle }}>Volatility Forecast</div>
            <div style={{ display: "flex", gap: 12, alignItems: "flex-end", height: 80 }}>
              {Object.entries(forecast).map(([key, vol]) => {
                const days = key.replace("h", "");
                const pct = vol * 100;
                const maxVol = Math.max(...Object.values(forecast)) * 100;
                const barHeight = maxVol > 0 ? (pct / maxVol) * 60 : 0;
                return (
                  <div key={key} style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: 1 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, fontFamily: "monospace", color: "var(--foreground)", marginBottom: 4 }}>
                      {pct.toFixed(1)}%
                    </span>
                    <div style={{
                      width: "100%", maxWidth: 60, height: barHeight, borderRadius: "3px 3px 0 0",
                      background: "linear-gradient(180deg, #6366f1 0%, #4f46e5 100%)",
                    }} />
                    <span style={{ fontSize: 10, color: "var(--muted-foreground)", fontFamily: "monospace", marginTop: 4 }}>
                      {days}d
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* ── Row 2: Conditional Volatility Chart ── */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <div style={{ ...headerStyle, margin: 0 }}>Conditional Volatility (annualized)</div>
          <span style={{ fontSize: 11, fontFamily: "monospace", color: "var(--muted-foreground)" }}>
            {ticker} · GARCH(1,1) · {conditional_vol.length} observations
          </span>
        </div>
        <div style={{ padding: 16, borderRadius: 6, background: "var(--background)", border: "1px solid var(--border)" }}>
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={volChartData}>
              <defs>
                <linearGradient id="garchGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#6366f1" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="#6366f1" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" strokeOpacity={0.5} />
              <XAxis
                dataKey="date"
                tickFormatter={fmtDate}
                tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                interval="preserveStartEnd"
                minTickGap={60}
              />
              <YAxis
                tickFormatter={(v: number) => `${v.toFixed(0)}%`}
                tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                width={45}
              />
              <Tooltip
                contentStyle={{
                  background: "var(--card-bg)",
                  border: "1px solid var(--border)",
                  borderRadius: 4,
                  fontSize: 12,
                  fontFamily: "monospace",
                }}
                formatter={(v: unknown) => [`${Number(v).toFixed(2)}%`, "σ (ann.)"]}
              />
              {params.unconditional_vol && (
                <ReferenceLine
                  y={params.unconditional_vol * 100}
                  stroke="#9E9E9E"
                  strokeDasharray="4 4"
                  strokeWidth={1}
                />
              )}
              <Area type="monotone" dataKey="vol" stroke="#6366f1" strokeWidth={1.5} fill="url(#garchGrad)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ── Row 3: Standardized Residuals ── */}
      {residualBins.length > 0 && (
        <div>
          <div style={{ ...headerStyle }}>Standardized Residuals Distribution</div>
          <div style={{ padding: 16, borderRadius: 6, background: "var(--background)", border: "1px solid var(--border)" }}>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={residualBins} barCategoryGap={0} barGap={0}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" strokeOpacity={0.3} />
                <XAxis
                  dataKey="range"
                  tick={{ fontSize: 9, fill: "var(--muted-foreground)" }}
                  interval={4}
                />
                <YAxis tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} width={30} />
                <Tooltip
                  contentStyle={{ background: "var(--card-bg)", border: "1px solid var(--border)", borderRadius: 4, fontSize: 11, fontFamily: "monospace" }}
                  formatter={(v: unknown) => [Number(v), "Count"]}
                  labelFormatter={(l) => `z = ${l}`}
                />
                <ReferenceLine x="0.0" stroke="var(--muted-foreground)" strokeDasharray="4 4" />
                <Bar dataKey="count" radius={[2, 2, 0, 0]}>
                  {residualBins.map((entry, i) => (
                    <Cell
                      key={i}
                      fill={Math.abs(entry.center) > 2 ? "#F44336" : Math.abs(entry.center) > 1 ? "#FF9800" : "#6366f1"}
                      fillOpacity={0.7}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <div style={{ display: "flex", justifyContent: "center", gap: 16, marginTop: 8, fontSize: 10, fontFamily: "monospace", color: "var(--muted-foreground)" }}>
              <span><span style={{ color: "#6366f1" }}>■</span> Within 1σ</span>
              <span><span style={{ color: "#FF9800" }}>■</span> 1-2σ (fat tails)</span>
              <span><span style={{ color: "#F44336" }}>■</span> Beyond 2σ (extreme)</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const headerStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  textTransform: "uppercase" as const,
  letterSpacing: "0.08em",
  color: "var(--muted-foreground)",
  fontFamily: "monospace",
  marginBottom: 12,
};

function ParamRow({ label, value, desc, highlight }: {
  label: string; value: string; desc: string; highlight?: boolean;
}) {
  return (
    <div style={{ padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span style={{ fontSize: 11, color: "var(--muted-foreground)", fontFamily: "monospace" }}>{label}</span>
        <span style={{ fontSize: 13, fontWeight: 700, fontFamily: "monospace", color: highlight ? "#F44336" : "var(--foreground)" }}>{value}</span>
      </div>
      <div style={{ fontSize: 10, color: "var(--muted-foreground)", opacity: 0.7 }}>{desc}</div>
    </div>
  );
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, fontFamily: "monospace", padding: "3px 0" }}>
      <span style={{ color: "var(--muted-foreground)" }}>{label}</span>
      <span style={{ fontWeight: 600 }}>{value}</span>
    </div>
  );
}
