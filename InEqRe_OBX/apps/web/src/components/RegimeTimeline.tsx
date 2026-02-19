"use client";

/**
 * RegimeTimeline Component
 *
 * Shows price history with volatility regime background shading.
 * Legend above chart, "NOW" marker at latest date.
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
  ReferenceLine,
} from "recharts";
import { groupRegimePeriods } from "@/lib/volatility";
import { getRegimeColor, ALL_REGIMES, type VolatilityRegime } from "@/lib/regimeClassification";

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
  height = 360,
}: RegimeTimelineProps) {
  const regimePeriods = useMemo(() => {
    return groupRegimePeriods(
      data.map((d) => ({
        date: d.date,
        regime: d.regime,
        volatility: d.volatility,
      }))
    );
  }, [data]);

  const lastDate = data.length > 0 ? data[data.length - 1].date : null;
  const lastPrice = data.length > 0 ? data[data.length - 1].close : null;

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString("en-GB", { month: "short", year: "numeric" });
  };

  const formatPrice = (value: number) => value.toFixed(2);

  return (
    <div style={{ marginBottom: 32 }}>
      <h2
        style={{
          fontSize: 16,
          fontWeight: 700,
          marginBottom: 12,
          color: "var(--foreground)",
          fontFamily: "monospace",
          letterSpacing: "0.02em",
        }}
      >
        Price History with Volatility Regimes
      </h2>

      {/* Regime Stats */}
      <div
        style={{
          display: "flex",
          gap: 20,
          marginBottom: 12,
          fontSize: 12,
          color: "var(--muted-foreground)",
          fontFamily: "monospace",
        }}
      >
        <span><strong>In regime:</strong> {regimeStats.currentDuration}d</span>
        <span><strong>Avg duration:</strong> {regimeStats.averageDuration}d</span>
        {regimeStats.lastShift && (
          <span><strong>Last shift:</strong> {formatDate(regimeStats.lastShift)}</span>
        )}
      </div>

      <div
        style={{
          background: "var(--card-bg)",
          border: "1px solid var(--border)",
          borderRadius: 6,
          padding: 16,
        }}
      >
        {/* Legend ABOVE chart */}
        <div
          style={{
            display: "flex",
            gap: 14,
            marginBottom: 12,
            flexWrap: "wrap",
            justifyContent: "center",
          }}
        >
          {ALL_REGIMES.map((regimeName) => {
            const color = getRegimeColor(regimeName);
            return (
              <div
                key={regimeName}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                  fontSize: 11,
                }}
              >
                <div
                  style={{
                    width: 14,
                    height: 14,
                    background: color,
                    opacity: 0.6,
                    borderRadius: 2,
                  }}
                />
                <span style={{ color: "var(--muted-foreground)", fontFamily: "monospace" }}>
                  {regimeName}
                </span>
              </div>
            );
          })}
        </div>

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
                  fillOpacity={0.18}
                  strokeOpacity={0}
                />
              );
            })}

            {/* NOW marker */}
            {lastDate && (
              <ReferenceLine
                x={lastDate}
                stroke="var(--foreground)"
                strokeDasharray="4 4"
                strokeWidth={1}
                label={{
                  value: lastPrice ? `NOW ${formatPrice(lastPrice)}` : "NOW",
                  position: "top",
                  fill: "var(--foreground)",
                  fontSize: 10,
                  fontFamily: "monospace",
                }}
              />
            )}

            <XAxis
              dataKey="date"
              tickFormatter={formatDate}
              stroke="var(--muted)"
              fontSize={11}
              tickLine={false}
            />

            <YAxis
              domain={["auto", "auto"]}
              tickFormatter={formatPrice}
              stroke="var(--muted)"
              fontSize={11}
              tickLine={false}
              label={{
                value: "Price (NOK)",
                angle: -90,
                position: "insideLeft",
                style: { fill: "var(--muted)", fontSize: 11 },
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
              formatter={(value: any, name?: string) => {
                if (name === "close") return [`${formatPrice(value)} NOK`, "Price"];
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
      </div>
    </div>
  );
}
