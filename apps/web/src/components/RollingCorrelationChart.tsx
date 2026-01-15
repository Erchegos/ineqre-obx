"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Area,
  ComposedChart,
} from "recharts";

interface RollingCorrelationPoint {
  date: string;
  correlation: number;
  volatility: number;
}

interface Props {
  data: RollingCorrelationPoint[];
}

export default function RollingCorrelationChart({ data }: Props) {
  // Safety checks
  if (!data || data.length === 0) {
    return (
      <div style={{ padding: 32, textAlign: "center", color: "var(--muted)" }}>
        No rolling correlation data available
      </div>
    );
  }

  return (
    <div style={{ width: "100%", height: 400 }}>
      <ResponsiveContainer>
        <ComposedChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis
            dataKey="date"
            stroke="var(--muted)"
            style={{ fontSize: 12 }}
          />
          <YAxis
            yAxisId="left"
            stroke="var(--muted)"
            style={{ fontSize: 12 }}
            domain={[-1, 1]}
            label={{
              value: "Correlation",
              angle: -90,
              position: "insideLeft",
              style: { fill: "var(--muted)", fontSize: 12 },
            }}
          />
          <YAxis
            yAxisId="right"
            orientation="right"
            stroke="var(--muted)"
            style={{ fontSize: 12 }}
            label={{
              value: "Volatility (%)",
              angle: 90,
              position: "insideRight",
              style: { fill: "var(--muted)", fontSize: 12 },
            }}
          />
          <Tooltip
            contentStyle={{
              background: "var(--card-bg)",
              border: "1px solid var(--border)",
              borderRadius: 4,
              fontSize: 12,
            }}
            formatter={(value: any, name: string | undefined) => {
              if (name === "correlation") {
                return [value.toFixed(3), "Correlation"];
              }
              if (name === "volatility") {
                return [(value * 100).toFixed(2) + "%", "Volatility"];
              }
              return [value, name || ""];
            }}
          />
          <Legend
            wrapperStyle={{ fontSize: 12 }}
            iconType="line"
          />
          
          {/* Volatility as background area */}
          <Area
            yAxisId="right"
            type="monotone"
            dataKey="volatility"
            fill="rgba(251, 191, 36, 0.2)"
            stroke="none"
            name="Volatility"
          />
          
          {/* Correlation line */}
          <Line
            yAxisId="left"
            type="monotone"
            dataKey="correlation"
            stroke="rgb(59, 130, 246)"
            strokeWidth={2}
            dot={false}
            name="Correlation"
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}