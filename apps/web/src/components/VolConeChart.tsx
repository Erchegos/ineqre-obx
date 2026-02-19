"use client";

/**
 * VolConeChart — Volatility cone showing percentile bands at multiple lookback windows.
 *
 * Displays: 5th/25th/50th/75th/95th percentile bands as stacked areas,
 * with current realized vol plotted as a line.
 * Classic risk-management visualization for term structure of vol.
 */

import {
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

type ConePoint = {
  window: number;
  p5: number;
  p25: number;
  p50: number;
  p75: number;
  p95: number;
  current: number;
};

type Props = {
  data: ConePoint[];
};

const WINDOW_LABELS: Record<number, string> = {
  5: "1W",
  10: "2W",
  20: "1M",
  60: "3M",
  120: "6M",
  252: "1Y",
};

export default function VolConeChart({ data }: Props) {
  if (!data || data.length === 0) return null;

  const chartData = data.map((d) => ({
    label: WINDOW_LABELS[d.window] || `${d.window}d`,
    window: d.window,
    p5: d.p5 * 100,
    p25: d.p25 * 100,
    p50: d.p50 * 100,
    p75: d.p75 * 100,
    p95: d.p95 * 100,
    current: d.current * 100,
    // For stacked area: we need band heights
    band_5_25: (d.p25 - d.p5) * 100,
    band_25_50: (d.p50 - d.p25) * 100,
    band_50_75: (d.p75 - d.p50) * 100,
    band_75_95: (d.p95 - d.p75) * 100,
  }));

  // Determine if current vol is above or below median
  const lastPoint = chartData[chartData.length - 1];
  const isAboveMedian = lastPoint && lastPoint.current > lastPoint.p50;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--muted-foreground)", fontFamily: "monospace" }}>
          Volatility Cone
        </div>
        <div style={{ display: "flex", gap: 12, fontSize: 10, fontFamily: "monospace" }}>
          <span style={{ color: "rgba(99,102,241,0.3)" }}>■ 5th-95th</span>
          <span style={{ color: "rgba(99,102,241,0.5)" }}>■ 25th-75th</span>
          <span style={{ color: isAboveMedian ? "#F44336" : "#4CAF50", fontWeight: 700 }}>
            ● Current {isAboveMedian ? "(above median)" : "(below median)"}
          </span>
        </div>
      </div>

      <div style={{ padding: 16, borderRadius: 6, border: "1px solid var(--border)", background: "var(--background)" }}>
        <ResponsiveContainer width="100%" height={260}>
          <ComposedChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" strokeOpacity={0.3} />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 11, fill: "var(--muted-foreground)", fontFamily: "monospace" }}
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
                fontSize: 11,
                fontFamily: "monospace",
                color: "var(--foreground)",
              }}
              labelStyle={{ color: "var(--foreground)" }}
              itemStyle={{ color: "var(--foreground)" }}
              formatter={(v: unknown, name: unknown) => {
                const val = Number(v);
                const n = String(name);
                if (n === "current") return [`${val.toFixed(1)}%`, "Current Vol"];
                return [`${val.toFixed(1)}%`, n];
              }}
              labelFormatter={(label) => `Window: ${label}`}
            />

            {/* Background band: 5th to 95th */}
            <Area
              type="monotone"
              dataKey="p95"
              stroke="none"
              fill="rgba(99,102,241,0.08)"
              fillOpacity={1}
              name="95th"
            />
            <Area
              type="monotone"
              dataKey="p5"
              stroke="none"
              fill="var(--background)"
              fillOpacity={1}
              name="5th"
            />

            {/* Inner band: 25th to 75th */}
            <Area
              type="monotone"
              dataKey="p75"
              stroke="none"
              fill="rgba(99,102,241,0.15)"
              fillOpacity={1}
              name="75th"
            />
            <Area
              type="monotone"
              dataKey="p25"
              stroke="none"
              fill="var(--background)"
              fillOpacity={1}
              name="25th"
            />

            {/* Median line */}
            <Line
              type="monotone"
              dataKey="p50"
              stroke="var(--muted-foreground)"
              strokeWidth={1}
              strokeDasharray="4 4"
              dot={false}
              name="Median"
            />

            {/* Current vol */}
            <Line
              type="monotone"
              dataKey="current"
              stroke={isAboveMedian ? "#F44336" : "#4CAF50"}
              strokeWidth={2.5}
              dot={{ r: 4, fill: isAboveMedian ? "#F44336" : "#4CAF50", strokeWidth: 0 }}
              name="current"
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
