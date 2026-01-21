"use client";

import { useMemo, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Legend,
} from "recharts";

type ResidualSquaresChartProps = {
  data: Array<{ date: string; residualSquare: number; residual: number }>;
  height?: number;
};

// Generate residual square series for multiple rolling windows
function generateTimeframeData(
  allData: Array<{ date: string; residualSquare: number; residual: number }>
) {
  const timeframes = [
    { label: "20 days", days: 20, color: "#ef4444" },
    { label: "60 days", days: 60, color: "#f59e0b" },
    { label: "120 days", days: 120, color: "#3b82f6" },
    { label: "252 days", days: 252, color: "#10b981" },
  ];

  const result: Record<string, any> = {};

  timeframes.forEach(({ label, days, color }) => {
    // Calculate rolling mean of residual squares
    const rollingMeans: Array<{ date: string; value: number }> = [];

    for (let i = days - 1; i < allData.length; i++) {
      const window = allData.slice(i - days + 1, i + 1);
      const meanRsq =
        window.reduce((sum, d) => sum + d.residualSquare, 0) / window.length;

      rollingMeans.push({
        date: allData[i].date,
        value: meanRsq,
      });
    }

    // Calculate statistics for this timeframe
    const values = rollingMeans.map((d) => d.value);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const stdDev = Math.sqrt(
      values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) /
        values.length
    );

    result[label] = {
      data: rollingMeans,
      stats: { mean, min, max, stdDev },
      color,
    };
  });

  return result;
}

export default function ResidualSquaresChart({
  data,
  height = 400,
}: ResidualSquaresChartProps) {
  if (!data || data.length === 0) {
    return (
      <div
        style={{
          height,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--muted)",
        }}
      >
        No data available
      </div>
    );
  }

  // Generate timeframe data
  const timeframeData = useMemo(
    () => generateTimeframeData(data),
    [data]
  );

  // State to track which timeframes are visible
  const [visibleTimeframes, setVisibleTimeframes] = useState<Set<string>>(
    new Set(["20 days", "60 days", "120 days", "252 days"])
  );

  const toggleTimeframe = (label: string) => {
    setVisibleTimeframes((prev) => {
      const next = new Set(prev);
      if (next.has(label)) {
        next.delete(label);
      } else {
        next.add(label);
      }
      return next;
    });
  };

  // Merge all visible timeframe data into a single chart dataset
  const chartData = useMemo(() => {
    // Get all unique dates from visible timeframes
    const allDates = new Set<string>();
    Object.keys(timeframeData)
      .filter((label) => visibleTimeframes.has(label))
      .forEach((label) => {
        timeframeData[label].data.forEach((d: any) => allDates.add(d.date));
      });

    const sortedDates = Array.from(allDates).sort();

    // Create chart data with all timeframe values
    return sortedDates.map((date) => {
      const point: any = { date };

      Object.keys(timeframeData)
        .filter((label) => visibleTimeframes.has(label))
        .forEach((label) => {
          const dataPoint = timeframeData[label].data.find(
            (d: any) => d.date === date
          );
          point[label] = dataPoint ? dataPoint.value : null;
        });

      return point;
    });
  }, [timeframeData, visibleTimeframes]);

  const timeframeKeys = Object.keys(timeframeData).filter((label) =>
    visibleTimeframes.has(label)
  );

  // Calculate mean residual square across all visible timeframes
  const meanResidualSquare = useMemo(() => {
    if (timeframeKeys.length === 0) return 0;
    const means = timeframeKeys.map(
      (label) => timeframeData[label].stats.mean
    );
    return means.reduce((a, b) => a + b, 0) / means.length;
  }, [timeframeData, timeframeKeys]);

  return (
    <div style={{ width: "100%" }}>
      {/* Control Bar */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 16,
          padding: "8px 12px",
          background: "var(--card-bg)",
          border: "1px solid var(--border-subtle)",
          borderRadius: 6,
        }}
      >
        <div style={{ fontSize: 13, color: "var(--muted-foreground)" }}>
          Click boxes below to toggle timeframes
        </div>
        <div
          style={{
            fontSize: 12,
            color: "var(--muted)",
            fontFamily: "monospace",
          }}
        >
          Mean ε² = {(meanResidualSquare * 10000).toFixed(4)} bps²
        </div>
      </div>

      {/* Stats Grid - Clickable */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
          gap: 12,
          marginBottom: 20,
        }}
      >
        {Object.entries(timeframeData).map(([label, dist]: [string, any]) => {
          const isActive = visibleTimeframes.has(label);
          return (
            <button
              key={label}
              onClick={() => toggleTimeframe(label)}
              style={{
                padding: 12,
                background: isActive ? "var(--card-bg)" : "var(--muted-bg)",
                border: `2px solid ${isActive ? dist.color : "var(--border)"}`,
                borderRadius: 6,
                cursor: "pointer",
                textAlign: "left",
                transition: "all 0.2s",
                opacity: isActive ? 1 : 0.5,
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  color: "var(--muted-foreground)",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  marginBottom: 4,
                  fontWeight: 600,
                }}
              >
                {label}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <div
                  style={{
                    fontSize: 14,
                    fontWeight: 600,
                    color: dist.color,
                    fontFamily: "monospace",
                  }}
                >
                  {(dist.stats.mean * 10000).toFixed(2)} bps²
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Chart */}
      <div style={{ position: "relative", width: "100%", height }}>
        <ResponsiveContainer width="100%" height={height}>
          <LineChart
            data={chartData}
            margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="var(--border-subtle)"
              opacity={0.3}
            />

            <XAxis
              dataKey="date"
              stroke="var(--muted)"
              fontSize={11}
              tickFormatter={(val) => {
                if (!val) return "";
                return val.length > 7 ? val.slice(5) : val;
              }}
              minTickGap={40}
            />

            <YAxis
              stroke="var(--muted)"
              fontSize={11}
              tickFormatter={(val) => `${(val * 10000).toFixed(1)}`}
              label={{
                value: "Residual² (bps²)",
                angle: -90,
                position: "insideLeft",
                style: { fontSize: 11, fill: "var(--muted)" },
              }}
            />

            <Tooltip
              contentStyle={{
                backgroundColor: "var(--card-bg)",
                borderColor: "var(--card-border)",
                color: "var(--foreground)",
                borderRadius: "4px",
                fontSize: "12px",
                padding: "8px 10px",
              }}
              labelStyle={{
                color: "var(--muted)",
                marginBottom: "6px",
                fontWeight: 600,
              }}
              formatter={(value: any, name: any) => {
                if (value === null || value === undefined) return ["-", name];
                const bps2 = (value * 10000).toFixed(4);
                return [`${bps2} bps²`, name];
              }}
            />

            <Legend
              wrapperStyle={{ paddingTop: "10px", fontSize: "11px" }}
              iconType="line"
            />

            {/* Mean line */}
            <ReferenceLine
              y={meanResidualSquare}
              stroke="var(--foreground)"
              strokeDasharray="5 5"
              strokeWidth={1.5}
              opacity={0.4}
              label={{
                value: "Mean",
                position: "insideTopRight",
                style: {
                  fontSize: 10,
                  fill: "var(--muted-foreground)",
                  fontWeight: 600,
                },
              }}
            />

            {/* Render lines in order so shortest timeframe is on top */}
            {timeframeKeys.map((label) => {
              const tf = timeframeData[label];
              return (
                <Line
                  key={label}
                  type="monotone"
                  dataKey={label}
                  stroke={tf.color}
                  strokeWidth={2}
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

      {/* Interpretation Guide */}
      <div
        style={{
          marginTop: 16,
          padding: 12,
          background: "rgba(59, 130, 246, 0.05)",
          border: "1px solid rgba(59, 130, 246, 0.2)",
          borderRadius: 6,
          fontSize: 13,
          color: "var(--muted-foreground)",
        }}
      >
        <div style={{ display: "grid", gap: 4 }}>
          <div>
            <strong>Click boxes above</strong> to show/hide timeframes
          </div>
          <div>
            <strong>Residual squares (ε²)</strong> = Unexplained variance from
            OBX beta model
          </div>
          <div>
            <strong>Lower values</strong> = Stock moves closely with market
            (high R²)
          </div>
          <div>
            <strong>Higher values</strong> = Stock has idiosyncratic risk
            (low R²)
          </div>
          <div>
            <strong>Mean line</strong> = Average residual² across visible
            timeframes
          </div>
        </div>
      </div>
    </div>
  );
}
