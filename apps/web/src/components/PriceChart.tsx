"use client";

import { useEffect, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";

type PriceChartProps = {
  data: Array<{ date: string; close: number }>;
  height?: number;
};

export default function PriceChart({ data, height = 320 }: PriceChartProps) {
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
        <span style={{ color: "var(--muted)" }}>No price data available</span>
      </div>
    );
  }

  const lineColor = "#3b82f6";
  const gridColor = isDark ? "rgba(255, 255, 255, 0.1)" : "#e5e7eb";
  const textColor = isDark ? "rgba(255, 255, 255, 0.6)" : "#6b7280";
  const tooltipBg = isDark ? "#1a1a1a" : "#ffffff";
  const tooltipBorder = isDark ? "#333" : "#d1d5db";

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
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
          tickFormatter={(value) => value.toFixed(2)}
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
          itemStyle={{ color: lineColor, fontSize: 13, fontFamily: "monospace" }}
          formatter={(value: number) => [`${value.toFixed(2)} NOK`, ""]}
          cursor={{ stroke: lineColor, strokeWidth: 1, strokeDasharray: "5 5" }}
        />

        <Line
          type="monotone"
          dataKey="close"
          stroke={lineColor}
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}