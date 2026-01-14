"use client";

import { useEffect, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";

type VolatilityChartProps = {
  data: Array<{
    date: string;
    rolling20?: number;
    rolling60?: number;
    rolling120?: number;
    ewma94?: number;
    ewma97?: number;
    parkinson?: number;
    garmanKlass?: number;
  }>;
  selectedMeasures: string[];
  height?: number;
};

const MEASURE_COLORS: Record<string, string> = {
  rolling20: "#3b82f6",
  rolling60: "#10b981",
  rolling120: "#f59e0b",
  ewma94: "#8b5cf6",
  ewma97: "#ec4899",
  parkinson: "#ef4444",
  garmanKlass: "#06b6d4",
};

const MEASURE_NAMES: Record<string, string> = {
  rolling20: "20-Day Rolling",
  rolling60: "60-Day Rolling",
  rolling120: "120-Day Rolling",
  ewma94: "EWMA (λ=0.94)",
  ewma97: "EWMA (λ=0.97)",
  parkinson: "Parkinson",
  garmanKlass: "Garman-Klass",
};

export default function VolatilityChart({ 
  data, 
  selectedMeasures, 
  height = 400 
}: VolatilityChartProps) {
  const [isDark, setIsDark] = useState(true);

  useEffect(() => {
    const checkTheme = () => {
      const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      setIsDark(dark);
    };

    checkTheme();
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    mediaQuery.addEventListener('change', checkTheme);

    return () => mediaQuery.removeEventListener('change', checkTheme);
  }, []);

  if (!data || data.length === 0) {
    return (
      <div style={{ height, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ color: "var(--muted)" }}>No volatility data available</span>
      </div>
    );
  }

  const gridColor = isDark ? "rgba(255, 255, 255, 0.1)" : "#e5e7eb";
  const textColor = isDark ? "rgba(255, 255, 255, 0.6)" : "#6b7280";
  const tooltipBg = isDark ? "#1a1a1a" : "#ffffff";
  const tooltipBorder = isDark ? "#333" : "#d1d5db";

  // Format data - convert to percentage
  const formattedData = data.map(d => ({
    ...d,
    rolling20: d.rolling20 ? d.rolling20 * 100 : undefined,
    rolling60: d.rolling60 ? d.rolling60 * 100 : undefined,
    rolling120: d.rolling120 ? d.rolling120 * 100 : undefined,
    ewma94: d.ewma94 ? d.ewma94 * 100 : undefined,
    ewma97: d.ewma97 ? d.ewma97 * 100 : undefined,
    parkinson: d.parkinson ? d.parkinson * 100 : undefined,
    garmanKlass: d.garmanKlass ? d.garmanKlass * 100 : undefined,
  }));

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={formattedData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
        
        <XAxis
          dataKey="date"
          stroke={textColor}
          tick={{ fill: textColor, fontSize: 12 }}
          tickLine={{ stroke: gridColor }}
          minTickGap={50}
        />
        
        <YAxis
          stroke={textColor}
          tick={{ fill: textColor, fontSize: 12 }}
          tickLine={{ stroke: gridColor }}
          tickFormatter={(value) => `${value.toFixed(0)}%`}
          width={60}
        />
        
        <Tooltip
          contentStyle={{
            backgroundColor: tooltipBg,
            border: `1px solid ${tooltipBorder}`,
            borderRadius: 4,
            padding: 8,
            boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
          }}
          labelStyle={{ color: textColor, fontSize: 12 }}
          formatter={(value: number | undefined, name: string | undefined) => {
            const measureName = name ? (MEASURE_NAMES[name] || name) : "Unknown";
            if (value === undefined) return ["N/A", measureName];
            return [
              `${value.toFixed(2)}%`,
              measureName,
            ];
          }}
          cursor={{ stroke: gridColor, strokeWidth: 1, strokeDasharray: "5 5" }}
        />
        
        <Legend
          wrapperStyle={{ paddingTop: 10 }}
          iconType="line"
          formatter={(value) => (
            <span style={{ color: textColor, fontSize: 13 }}>
              {MEASURE_NAMES[value] || value}
            </span>
          )}
        />
        
        {selectedMeasures.map((measure) => (
          <Line
            key={measure}
            type="monotone"
            dataKey={measure}
            stroke={MEASURE_COLORS[measure]}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}