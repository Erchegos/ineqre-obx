"use client";

import { useMemo } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
  CartesianGrid,
} from "recharts";

type SeasonalityChartProps = {
  data: any[];
};

export default function SeasonalityChart({ data }: SeasonalityChartProps) {
  // 1. Process Data
  const seasonalData = useMemo(() => {
    // Handle empty data safely
    if (!data || data.length === 0) {
      return { result: [], maxVol: 0, minVol: 0 };
    }

    const months = Array.from({ length: 12 }, () => ({ sum: 0, count: 0 }));

    data.forEach((day) => {
      // Prioritize Yang-Zhang, fallback to Rolling20
      const val = day.yangZhang ?? day.rolling20;
      
      // Ensure we have a valid number and date
      if (typeof val === "number" && day.date) {
        const date = new Date(day.date);
        if (!isNaN(date.getTime())) {
          const monthIndex = date.getMonth(); // 0-11
          months[monthIndex].sum += val;
          months[monthIndex].count += 1;
        }
      }
    });

    // Create final array for Recharts
    const result = months.map((m, i) => ({
      month: new Date(2000, i, 1).toLocaleString("en-US", { month: "short" }),
      avgVol: m.count > 0 ? m.sum / m.count : 0,
    }));

    // Calculate min/max for color scaling
    const vals = result.map((r) => r.avgVol);
    const maxVol = vals.length ? Math.max(...vals) : 0;
    const minVol = vals.length ? Math.min(...vals) : 0;

    return { result, maxVol, minVol };
  }, [data]);

  // 2. Color Helper (Blue -> Orange -> Red)
  const getColor = (val: number, min: number, max: number) => {
    if (max === min) return "#3b82f6";
    const ratio = (val - min) / (max - min);
    if (ratio > 0.8) return "#ef4444"; // Red (High)
    if (ratio > 0.5) return "#f59e0b"; // Orange (Med)
    return "#3b82f6"; // Blue (Low)
  };

  if (!data || data.length === 0) {
    return (
      <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted)", fontSize: 13 }}>
        No Data Available
      </div>
    );
  }

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
        
        <Tooltip
          cursor={{ fill: "#3b82f6", opacity: 0.2 }}
          contentStyle={{
            backgroundColor: "var(--card-bg)",
            borderColor: "var(--card-border)",
            color: "var(--foreground)",
            borderRadius: "4px",
            fontSize: "12px",
            border: "1px solid var(--card-border)",
          }}
          labelStyle={{ color: "var(--foreground)", marginBottom: 4, fontWeight: 500 }}
          itemStyle={{ color: "var(--foreground)" }}
          // FIX: Use 'any' to satisfy Recharts Types
          formatter={(value: any) => [
            `${(Number(value) * 100).toFixed(2)}%`,
            "Avg Volatility"
          ]}
        />
        
        <Bar dataKey="avgVol" radius={[2, 2, 0, 0]}>
          {seasonalData.result.map((entry, index) => (
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