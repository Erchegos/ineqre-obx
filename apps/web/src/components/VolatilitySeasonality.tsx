"use client";

import React, { useMemo } from "react";
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
import { format } from "date-fns";

interface SeasonalityProps {
  data: Array<{
    date: string;
    yangZhang: number;
  }>;
}

export default function VolatilitySeasonality({ data }: SeasonalityProps) {
  
  // --- Data Processing: Aggregate Volatility by Month ---
  const seasonalData = useMemo(() => {
    if (!data || data.length === 0) {
      return { result: [], maxVol: 0, minVol: 0 };
    }

    // 1. Buckets for each month (0 = Jan, 11 = Dec)
    const months = Array.from({ length: 12 }, () => ({ sum: 0, count: 0 }));

    // 2. Iterate history and sum up volatility
    data.forEach((day) => {
      if (day.yangZhang) {
        const date = new Date(day.date);
        const monthIndex = date.getMonth(); // 0-11
        months[monthIndex].sum += day.yangZhang;
        months[monthIndex].count += 1;
      }
    });

    // 3. Calculate Averages & Find Max/Min for Coloring
    const result = months.map((m, i) => ({
      month: new Date(2000, i, 1).toLocaleString("en-US", { month: "short" }), // "Jan", "Feb"...
      avgVol: m.count > 0 ? m.sum / m.count : 0,
    }));

    const maxVol = Math.max(...result.map((r) => r.avgVol));
    const minVol = Math.min(...result.map((r) => r.avgVol));

    return { result, maxVol, minVol };
  }, [data]);

  // --- Helper: Dynamic Color Scale ---
  const getColor = (val: number, min: number, max: number) => {
    const ratio = (val - min) / (max - min || 1);
    if (ratio > 0.8) return "#ef4444"; // Red (High Vol)
    if (ratio > 0.5) return "#f97316"; // Orange
    return "#3b82f6"; // Blue (Calm)
  };

  if (!data || data.length === 0) return null;

  return (
    // Standard Tailwind Card Container (No import needed)
    <div className="rounded-xl border bg-card text-card-foreground shadow-sm">
      <div className="flex flex-col space-y-1.5 p-6 pb-2">
        <h3 className="font-semibold leading-none tracking-tight">Volatility Seasonality (Monthly Avg)</h3>
      </div>
      <div className="p-6 pt-0 h-[300px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={seasonalData.result} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" opacity={0.3} />
            
            <XAxis 
              dataKey="month" 
              axisLine={false} 
              tickLine={false} 
              tick={{ fill: "var(--muted-foreground)", fontSize: 12 }} 
              dy={10}
            />
            
            <YAxis 
              axisLine={false} 
              tickLine={false} 
              tickFormatter={(val) => `${(val * 100).toFixed(0)}%`} 
              tick={{ fill: "var(--muted-foreground)", fontSize: 12 }} 
            />
            
            <Tooltip
              cursor={{ fill: "var(--muted)", opacity: 0.2 }}
              content={({ active, payload }) => {
                if (active && payload && payload.length) {
                  return (
                    <div className="bg-popover border border-border p-2 rounded shadow-sm text-sm">
                      <span className="font-semibold">{payload[0].payload.month}: </span>
                      <span className="font-mono">
                        {(Number(payload[0].value) * 100).toFixed(2)}% Avg Vol
                      </span>
                    </div>
                  );
                }
                return null;
              }}
            />

            <Bar dataKey="avgVol" radius={[4, 4, 0, 0]}>
              {seasonalData.result.map((entry: { month: string; avgVol: number }, index: number) => (
                <Cell 
                  key={`cell-${index}`} 
                  fill={getColor(entry.avgVol, seasonalData.minVol, seasonalData.maxVol)} 
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}