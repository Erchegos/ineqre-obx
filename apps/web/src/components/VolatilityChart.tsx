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

// Configuration for colors and labels
const MEASURE_CONFIG: Record<string, { label: string; color: string }> = {
  yangZhang: { label: "Yang-Zhang", color: "#f59e0b" },
  rogersSatchell: { label: "Rogers-Satchell", color: "#22c55e" },
  rolling20: { label: "20-Day Rolling", color: "#3b82f6" },
  rolling60: { label: "60-Day Rolling", color: "#10b981" },
  rolling120: { label: "120-Day Rolling", color: "#8b5cf6" },
  ewma94: { label: "EWMA (0.94)", color: "#6366f1" },
  parkinson: { label: "Parkinson", color: "#ef4444" },
  garmanKlass: { label: "Garman-Klass", color: "#06b6d4" },
};

type VolatilityChartProps = {
  data: any[];
  selectedMeasures: string[];
  height?: number;
};

export default function VolatilityChart({
  data,
  selectedMeasures,
  height = 400,
}: VolatilityChartProps) {
  if (!data || data.length === 0) {
    return (
      <div style={{ height, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted)" }}>
        No data available
      </div>
    );
  }

  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} opacity={0.5} />
          
          <XAxis
            dataKey="date"
            stroke="var(--muted)"
            fontSize={12}
            tickFormatter={(val) => {
              if (!val) return "";
              // Show Year for Jan 1st, otherwise Month/Day? 
              // Simple version: just return valid string
              return val.length > 7 ? val.slice(0, 4) : val;
            }}
            minTickGap={50}
          />
          
          <YAxis
            stroke="var(--muted)"
            fontSize={12}
            tickFormatter={(val) => `${(val * 100).toFixed(0)}%`}
            domain={["auto", "auto"]}
          />
          
          <Tooltip
            contentStyle={{
              backgroundColor: "var(--card-bg)",
              borderColor: "var(--card-border)",
              color: "var(--foreground)",
              borderRadius: "4px",
              fontSize: "12px",
            }}
            itemStyle={{ paddingBottom: 2 }}
            labelStyle={{ color: "var(--muted)", marginBottom: 8 }}
            // FIX: Use 'any' to avoid strict type errors with Recharts
            formatter={(value: any, name: any) => {
              if (value === null || value === undefined) return ["-", name];
              return [`${(Number(value) * 100).toFixed(2)}%`, MEASURE_CONFIG[name]?.label || name];
            }}
            labelFormatter={(label) => new Date(label).toLocaleDateString("en-US", { 
              weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' 
            })}
          />
          
          <Legend wrapperStyle={{ paddingTop: "10px" }} />

          {selectedMeasures.map((measureKey) => {
            const config = MEASURE_CONFIG[measureKey];
            if (!config) return null;
            
            return (
              <Line
                key={measureKey}
                type="monotone"
                dataKey={measureKey}
                name={config.label}
                stroke={config.color}
                strokeWidth={1.5}
                dot={false}
                activeDot={{ r: 4 }}
                connectNulls={true}
                isAnimationActive={false}
              />
            );
          })}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}