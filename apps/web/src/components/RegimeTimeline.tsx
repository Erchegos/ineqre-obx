"use client";

/**
 * RegimeTimeline Component
 *
 * Shows price history with volatility regime background shading
 */

import { useMemo } from "react";
import {
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceArea,
} from "recharts";
import { groupRegimePeriods, type RegimePoint } from "@/lib/volatility";
import { getRegimeColor, type VolatilityRegime } from "@/lib/regimeClassification";

type RegimeTimelineProps = {
  data: Array<{
    date: string;
    regime: string;
    volatility: number;
    close: number;
  }>;
  regimeStats: {
    currentDuration: number;
    averageDuration: number;
    lastShift: string | null;
  };
  height?: number;
};

export default function RegimeTimeline({
  data,
  regimeStats,
  height = 400,
}: RegimeTimelineProps) {
  // Group consecutive regime periods for background shading
  const regimePeriods = useMemo(() => {
    return groupRegimePeriods(
      data.map((d) => ({
        date: d.date,
        regime: d.regime,
        volatility: d.volatility,
      }))
    );
  }, [data]);

  // Format date for display
  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString("en-GB", { month: "short", year: "numeric" });
  };

  // Format price with 2 decimals
  const formatPrice = (value: number) => {
    return value.toFixed(2);
  };

  return (
    <div style={{ marginBottom: 40 }}>
      <h2
        style={{
          fontSize: 20,
          fontWeight: 600,
          marginBottom: 16,
          color: "var(--foreground)",
        }}
      >
        Price History with Volatility Regimes
      </h2>

      {/* Regime Stats */}
      <div
        style={{
          display: "flex",
          gap: 24,
          marginBottom: 16,
          fontSize: 13,
          color: "var(--muted-foreground)",
        }}
      >
        <div>
          <span style={{ fontWeight: 600 }}>Current regime duration:</span>{" "}
          {regimeStats.currentDuration} days
        </div>
        <div>
          <span style={{ fontWeight: 600 }}>Average regime duration:</span>{" "}
          {regimeStats.averageDuration} days
        </div>
        {regimeStats.lastShift && (
          <div>
            <span style={{ fontWeight: 600 }}>Last regime shift:</span>{" "}
            {formatDate(regimeStats.lastShift)}
          </div>
        )}
      </div>

      {/* Chart */}
      <div
        style={{
          background: "var(--card-bg)",
          border: "1px solid var(--border)",
          borderRadius: 6,
          padding: 16,
        }}
      >
        <ResponsiveContainer width="100%" height={height}>
          <ComposedChart
            data={data}
            margin={{ top: 10, right: 20, left: 10, bottom: 20 }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="var(--border-subtle)"
              vertical={false}
            />

            {/* Regime Background Shading */}
            {regimePeriods.map((period, index) => {
              const color = getRegimeColor(period.regime as VolatilityRegime);
              return (
                <ReferenceArea
                  key={index}
                  x1={period.start}
                  x2={period.end}
                  fill={color}
                  fillOpacity={0.15}
                  strokeOpacity={0}
                />
              );
            })}

            <XAxis
              dataKey="date"
              tickFormatter={formatDate}
              stroke="var(--muted)"
              fontSize={12}
              tickLine={false}
            />

            <YAxis
              domain={["auto", "auto"]}
              tickFormatter={formatPrice}
              stroke="var(--muted)"
              fontSize={12}
              tickLine={false}
              label={{
                value: "Price (NOK)",
                angle: -90,
                position: "insideLeft",
                style: { fill: "var(--muted)", fontSize: 12 },
              }}
            />

            <Tooltip
              contentStyle={{
                backgroundColor: "var(--card-bg)",
                borderColor: "var(--card-border)",
                color: "var(--foreground)",
                borderRadius: "4px",
                fontSize: "12px",
              }}
              formatter={(value: any, name: string) => {
                if (name === "close") {
                  return [`${formatPrice(value)} NOK`, "Price"];
                }
                return [value, name];
              }}
              labelFormatter={(label) => `Date: ${formatDate(label)}`}
            />

            <Line
              type="monotone"
              dataKey="close"
              stroke="var(--foreground)"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>

        {/* Regime Legend */}
        <div
          style={{
            display: "flex",
            gap: 16,
            marginTop: 16,
            flexWrap: "wrap",
            justifyContent: "center",
          }}
        >
          {[
            "Extreme High",
            "Elevated",
            "Normal",
            "Low & Contracting",
            "Low & Stable",
          ].map((regimeName) => {
            const color = getRegimeColor(regimeName as VolatilityRegime);
            return (
              <div
                key={regimeName}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 12,
                }}
              >
                <div
                  style={{
                    width: 16,
                    height: 16,
                    background: color,
                    opacity: 0.6,
                    borderRadius: 2,
                  }}
                />
                <span style={{ color: "var(--muted-foreground)" }}>
                  {regimeName}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
