"use client";

import React, { useMemo } from "react";
import {
  ComposedChart,
  Line,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";

// --- Props Interface ---
interface PriceChartProps {
  data: { date: string; value: number }[]; // Historical price data
  currentVol?: number; // Annualized Volatility (e.g., 0.18 for 18%)
  showCones?: boolean; // Toggle to turn cones on/off
  height?: number;
}

export default function PriceChart({
  data,
  currentVol = 0,
  showCones = false,
  height = 350,
}: PriceChartProps) {
  
  // --- Data Processing: Merge History + Future Cone ---
  const chartData = useMemo(() => {
    if (!data || data.length === 0) return [];

    // 1. Get the last known price point
    const lastPoint = data[data.length - 1];
    const lastPrice = lastPoint.value;
    const lastDate = new Date(lastPoint.date);

    // 2. Format Historical Data for the Chart
    // We explicitly set cone values to null here so they don't draw over history
    const historyData = data.map((d) => ({
      date: d.date,
      price: d.value,
      cone: null as null | [number, number], // Type formatting
      isProjection: false,
    }));

    // 3. Generate Future Cone Data (if enabled)
    const futureData = [];
    if (showCones && currentVol > 0) {
      const PROJECTION_DAYS = 60; // How far to project (approx 2 months)
      const DAILY_VOL = currentVol / Math.sqrt(252); // Convert Annual Vol to Daily

      // Start the cone exactly at the last price point to connect the lines seamlessly
      // We push a "bridge" point that has both price AND the start of the cone
      historyData[historyData.length - 1].cone = [lastPrice, lastPrice];

      for (let i = 1; i <= PROJECTION_DAYS; i++) {
        const nextDate = new Date(lastDate);
        nextDate.setDate(lastDate.getDate() + i);

        // Square Root of Time Rule: Volatility scales with sqrt(time)
        // 1 Standard Deviation (68% probability)
        const sigma = DAILY_VOL * Math.sqrt(i);
        const upper = lastPrice * (1 + sigma);
        const lower = lastPrice * (1 - sigma);

        futureData.push({
          date: nextDate.toISOString().split("T")[0], // YYYY-MM-DD
          price: null, // No price line for future
          cone: [lower, upper] as [number, number], // [Min, Max] for the Area chart
          isProjection: true,
        });
      }
    }

    // Combine arrays
    return [...historyData, ...futureData];
  }, [data, currentVol, showCones]);

  // --- Formatting Helpers ---
  const formatXAxis = (tickItem: string) => {
    const d = new Date(tickItem);
    return d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
  };

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(val);
  };

  // --- Tooltip Component ---
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      const isProj = payload[0].payload.isProjection;
      return (
        <div className="bg-background border border-border p-3 rounded shadow-xl text-sm">
          <p className="font-semibold mb-2">{label}</p>
          {payload.map((entry: any, index: number) => {
            if (entry.dataKey === "price" && entry.value !== null) {
              return (
                <div key={index} className="text-primary font-mono">
                  Price: {formatCurrency(entry.value)}
                </div>
              );
            }
            if (entry.dataKey === "cone" && entry.value) {
              return (
                <div key={index} className="space-y-1 mt-1 pt-1 border-t border-dashed border-border">
                  <div className="text-emerald-400 text-xs">Upper (1σ): {formatCurrency(entry.value[1])}</div>
                  <div className="text-red-400 text-xs">Lower (1σ): {formatCurrency(entry.value[0])}</div>
                </div>
              );
            }
            return null;
          })}
          {isProj && <div className="text-muted-foreground text-xs mt-2 italic">Projected Risk Cone</div>}
        </div>
      );
    }
    return null;
  };

  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer>
        <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <defs>
            {/* Gradient for the Cone Area */}
            <linearGradient id="coneGradient" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.2} />
              <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.05} />
            </linearGradient>
          </defs>

          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.3} vertical={false} />
          
          <XAxis 
            dataKey="date" 
            tickFormatter={formatXAxis} 
            stroke="var(--muted-foreground)" 
            fontSize={12} 
            minTickGap={40}
          />
          
          <YAxis 
            domain={['auto', 'auto']} 
            tickFormatter={(val) => val.toFixed(0)} 
            stroke="var(--muted-foreground)" 
            fontSize={12} 
            width={40}
          />

          <Tooltip content={<CustomTooltip />} />

          {/* The Cone Area
            dataKey="cone" expects an array [min, max] 
          */}
          {showCones && (
            <Area
              type="monotone"
              dataKey="cone"
              stroke="none"
              fill="url(#coneGradient)" // Uses the gradient defined above
              activeDot={false}
              isAnimationActive={false} // Prevents flickering on updates
            />
          )}

          {/* Cone Borders (Optional: to make the edges distinct) 
             We simulate this by drawing two invisible lines if we really wanted, 
             but usually the Area is enough. 
          */}

          {/* The Price Line */}
          <Line
            type="monotone"
            dataKey="price"
            stroke="var(--primary)" // Uses your Tailwind theme primary color
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, strokeWidth: 0 }}
            connectNulls={false} // Don't connect through the projection gap
          />

          {/* Vertical Line marking "Today" */}
          {showCones && chartData.length > 0 && (
            <ReferenceLine 
              x={chartData.find(d => d.isProjection)?.date} 
              stroke="var(--muted-foreground)" 
              strokeDasharray="3 3" 
              opacity={0.5} 
            />
          )}

        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}