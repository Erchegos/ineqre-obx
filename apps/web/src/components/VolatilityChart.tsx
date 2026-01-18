"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

// Default colors for the lines
const COLORS: Record<string, string> = {
  rolling20: "#3b82f6", // Blue
  rolling60: "#10b981", // Green
  rolling120: "#f59e0b", // Amber
  ewma94: "#8b5cf6",    // Purple
  ewma97: "#ec4899",    // Pink
  parkinson: "#ef4444", // Red
  garmanKlass: "#06b6d4", // Cyan
};

export default function VolatilityChart({
  data,
  height = 400,
  selectedMeasures = [],
}: {
  data: any[];
  height?: number;
  selectedMeasures?: string[];
}) {
  if (!data || data.length === 0) {
    return (
      <div style={{ height, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted)" }}>
        No data available for chart
      </div>
    );
  }

  // Safe list of measures to render
  const measuresToRender = selectedMeasures.length > 0 
    ? selectedMeasures 
    : ["rolling20", "rolling60", "ewma94"];

  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
          <XAxis
            dataKey="date"
            stroke="var(--muted)"
            fontSize={12}
            tickFormatter={(val) => val.slice(0, 7)} // Show YYYY-MM
            minTickGap={30}
          />
          <YAxis
            stroke="var(--muted)"
            fontSize={12}
            tickFormatter={(val) => `${(val * 100).toFixed(0)}%`}
            domain={["auto", "auto"]}
            width={40}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "var(--card-bg)",
              borderColor: "var(--card-border)",
              color: "var(--foreground)",
            }}
            itemStyle={{ fontSize: 13 }}
            labelStyle={{ color: "var(--muted)", marginBottom: 5 }}
            formatter={(val: number) => [`${(val * 100).toFixed(2)}%`, ""]}
          />
          <Legend />
          
          {measuresToRender.map((key) => (
            <Line
              key={key}
              type="monotone"
              dataKey={key}
              stroke={COLORS[key] || "#8884d8"}
              strokeWidth={1.5}
              dot={false}
              activeDot={{ r: 4 }}
              // CRITICAL FIX: Connects lines across null/N/A values so the chart isn't blank
              connectNulls={true} 
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}