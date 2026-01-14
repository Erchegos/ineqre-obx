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
  ReferenceLine,
} from "recharts";

type PriceDrawdownChartProps = {
  data: Array<{ date: string; drawdown: number }>;
  height?: number;
};

export default function PriceDrawdownChart({ data, height = 280 }: PriceDrawdownChartProps) {
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
        <span style={{ color: "var(--muted)" }}>No drawdown data available</span>
      </div>
    );
  }

  const lineColor = isDark ? "rgba(200, 80, 80, 0.9)" : "#ef4444";
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
          tickFormatter={(value) => `${(value * 100).toFixed(0)}%`}
          width={60}
        />

        <ReferenceLine y={0} stroke={gridColor} strokeWidth={1} />
        
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
          formatter={(value: number) => [`${(value * 100).toFixed(2)}%`, "Drawdown"]}
          cursor={{ stroke: lineColor, strokeWidth: 1, strokeDasharray: "5 5" }}
        />

        <Line
          type="monotone"
          dataKey="drawdown"
          stroke={lineColor}
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}