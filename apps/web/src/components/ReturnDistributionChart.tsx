"use client";

import { useMemo, useState, useRef, useEffect } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Legend,
  Line,
} from "recharts";

type ReturnDistributionChartProps = {
  returns: Array<{ date: string; return: number }>;
  height?: number;
};

// Calculate distribution statistics
function calculateDistributionStats(returns: number[]) {
  if (returns.length === 0) return null;

  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / returns.length;
  const stdDev = Math.sqrt(variance);

  // Skewness and Kurtosis
  const skewness = returns.reduce((a, b) => a + Math.pow((b - mean) / stdDev, 3), 0) / returns.length;
  const kurtosis = returns.reduce((a, b) => a + Math.pow((b - mean) / stdDev, 4), 0) / returns.length - 3;

  return { mean, stdDev, skewness, kurtosis };
}

// Create probability density bins using kernel density estimation
function createDensityData(returns: number[], bandwidth: number = 0.002) {
  if (returns.length === 0) return [];

  const min = Math.min(...returns);
  const max = Math.max(...returns);
  const range = max - min;
  const numBins = 100;
  const binWidth = range / numBins;

  const densityData: Array<{ return: number; density: number }> = [];

  for (let i = 0; i <= numBins; i++) {
    const x = min + i * binWidth;
    let density = 0;

    // Gaussian kernel density estimation
    for (const r of returns) {
      const u = (x - r) / bandwidth;
      density += Math.exp(-0.5 * u * u) / Math.sqrt(2 * Math.PI);
    }

    density = density / (returns.length * bandwidth);
    densityData.push({ return: x, density });
  }

  return densityData;
}

// Generate distributions for multiple timeframes
function generateTimeframeDistributions(allReturns: Array<{ date: string; return: number }>) {
  const timeframes = [
    { label: "4 days", days: 4, color: "#ef4444" },
    { label: "7 days", days: 7, color: "#f59e0b" },
    { label: "14 days", days: 14, color: "#3b82f6" },
    { label: "21 days", days: 21, color: "#10b981" },
    { label: "28 days", days: 28, color: "#8b5cf6" },
    { label: "42 days", days: 42, color: "#ec4899" },
  ];

  const result: Record<string, any> = {};

  timeframes.forEach(({ label, days, color }) => {
    const returns: number[] = [];

    // Calculate rolling N-day returns
    for (let i = days; i < allReturns.length; i++) {
      let cumulativeReturn = 1;
      for (let j = 0; j < days; j++) {
        cumulativeReturn *= 1 + allReturns[i - j].return;
      }
      returns.push(cumulativeReturn - 1);
    }

    if (returns.length > 0) {
      const stats = calculateDistributionStats(returns);
      const densityData = createDensityData(returns);

      result[label] = {
        densityData,
        stats,
        color,
        days,
      };
    }
  });

  return result;
}

export default function ReturnDistributionChart({
  returns,
  height = 400,
}: ReturnDistributionChartProps) {
  const distributionData = useMemo(() => {
    if (!returns || returns.length === 0) return null;
    return generateTimeframeDistributions(returns);
  }, [returns]);

  // State to track which timeframes are visible
  const [visibleTimeframes, setVisibleTimeframes] = useState<Set<string>>(
    new Set(["4 days", "7 days", "14 days", "21 days", "28 days", "42 days"])
  );

  // Ref to get the chart container dimensions
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  useEffect(() => {
    if (containerRef.current) {
      setContainerWidth(containerRef.current.offsetWidth);
    }
  }, []);

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

  // Combine all density data into one chart data structure
  const chartData = useMemo(() => {
    if (!distributionData) return [];

    const allPoints = new Set<number>();
    Object.entries(distributionData).forEach(([label, dist]: [string, any]) => {
      if (visibleTimeframes.has(label)) {
        dist.densityData.forEach((d: any) => allPoints.add(d.return));
      }
    });

    const sortedPoints = Array.from(allPoints).sort((a, b) => a - b);

    return sortedPoints.map((returnValue) => {
      const point: any = { return: returnValue };

      Object.entries(distributionData).forEach(([label, dist]: [string, any]) => {
        if (visibleTimeframes.has(label)) {
          const closest = dist.densityData.reduce((prev: any, curr: any) =>
            Math.abs(curr.return - returnValue) < Math.abs(prev.return - returnValue) ? curr : prev
          );
          point[label] = closest.density;
        }
      });

      return point;
    });
  }, [distributionData, visibleTimeframes]);

  const timeframeKeys = distributionData ? Object.keys(distributionData).filter(label => visibleTimeframes.has(label)) : [];

  if (!distributionData || chartData.length === 0 || timeframeKeys.length === 0) {
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
        {timeframeKeys.length === 0 && distributionData ? "Select at least one timeframe" : "No data available"}
      </div>
    );
  }

  const currentSpot = 0; // Current price (0% return)

  // Calculate average sigma (standard deviation) and mean across visible timeframes
  const avgSigma = useMemo(() => {
    if (!distributionData || timeframeKeys.length === 0) return 0;
    const sigmas = timeframeKeys.map(label => distributionData[label].stats.stdDev);
    return sigmas.reduce((a, b) => a + b, 0) / sigmas.length;
  }, [distributionData, timeframeKeys]);

  const avgMean = useMemo(() => {
    if (!distributionData || timeframeKeys.length === 0) return 0;
    const means = timeframeKeys.map(label => distributionData[label].stats.mean);
    return means.reduce((a, b) => a + b, 0) / means.length;
  }, [distributionData, timeframeKeys]);

  // Generate sigma levels (1σ, 2σ, 3σ, 4σ)
  const sigmaLevels = [
    { sigma: 1, opacity: 0.15 },
    { sigma: 2, opacity: 0.25 },
    { sigma: 3, opacity: 0.35 },
    { sigma: 4, opacity: 0.45 },
  ];

  return (
    <div style={{ width: "100%" }}>
      {/* Control Bar */}
      <div style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: 16,
        padding: "8px 12px",
        background: "var(--card-bg)",
        border: "1px solid var(--border-subtle)",
        borderRadius: 6,
      }}>
        <div style={{ fontSize: 13, color: "var(--muted-foreground)" }}>
          Click boxes below to toggle timeframes
        </div>
        <div style={{ fontSize: 12, color: "var(--muted)", fontFamily: "monospace" }}>
          σ = {(avgSigma * 100).toFixed(2)}%
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
        {Object.entries(distributionData).map(([label, dist]: [string, any]) => {
          const isVisible = visibleTimeframes.has(label);
          return (
            <button
              key={label}
              onClick={() => toggleTimeframe(label)}
              style={{
                padding: 12,
                background: isVisible ? "var(--input-bg)" : "transparent",
                border: `1px solid ${isVisible ? dist.color : "var(--border-subtle)"}`,
                borderRadius: 6,
                cursor: "pointer",
                textAlign: "left",
                opacity: isVisible ? 1 : 0.5,
                transition: "all 0.2s",
              }}
              onMouseEnter={(e) => {
                if (!isVisible) {
                  e.currentTarget.style.opacity = "0.7";
                  e.currentTarget.style.borderColor = dist.color;
                }
              }}
              onMouseLeave={(e) => {
                if (!isVisible) {
                  e.currentTarget.style.opacity = "0.5";
                  e.currentTarget.style.borderColor = "var(--border-subtle)";
                }
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: isVisible ? dist.color : "var(--muted)",
                  marginBottom: 6,
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <div
                  style={{
                    width: 8,
                    height: 8,
                    background: isVisible ? dist.color : "var(--muted)",
                    borderRadius: "50%",
                  }}
                />
                {label}
              </div>
              <div style={{ fontSize: 9, color: "var(--muted-foreground)", display: "grid", gap: 2 }}>
                <div>
                  <strong>Skew:</strong> {dist.stats.skewness.toFixed(2)}
                </div>
                <div>
                  <strong>Kurt:</strong> {dist.stats.kurtosis.toFixed(2)}
                </div>
                <div>
                  <strong>σ:</strong> {(dist.stats.stdDev * 100).toFixed(2)}%
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Chart */}
      <div ref={containerRef} style={{ position: "relative", width: "100%", height }}>
        <ResponsiveContainer width="100%" height={height}>
          <AreaChart
            data={chartData}
            margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
          >
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" opacity={0.3} />

          <XAxis
            dataKey="return"
            domain={["auto", "auto"]}
            tickFormatter={(val) => `${(val * 100).toFixed(0)}%`}
            stroke="var(--muted)"
            fontSize={11}
            tick={{ fill: "var(--muted)" }}
          />

          <YAxis
            stroke="var(--muted)"
            fontSize={11}
            tick={{ fill: "var(--muted)" }}
            label={{
              value: "Probability Density",
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
              fontSize: "11px",
            }}
            labelFormatter={(val) => `Return: ${(Number(val) * 100).toFixed(2)}%`}
            formatter={(value: any, name: any) => [
              Number(value).toFixed(4),
              name,
            ]}
          />

          <Legend
            wrapperStyle={{ paddingTop: "10px", fontSize: "11px" }}
            iconType="circle"
          />

          {/* Render areas in reverse order so shortest timeframe is on top */}
          {[...timeframeKeys].reverse().map((label) => {
            const dist = distributionData[label];
            return (
              <Area
                key={label}
                type="monotone"
                dataKey={label}
                stroke={dist.color}
                fill={dist.color}
                fillOpacity={0.3}
                strokeWidth={1.5}
                isAnimationActive={false}
              />
            );
          })}
          </AreaChart>
        </ResponsiveContainer>

        {/* SVG Overlay for sigma lines */}
        <svg
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            pointerEvents: "none",
          }}
        >
          {(() => {
            if (containerWidth === 0) return null;

            // Calculate x position as percentage of data range
            const minReturn = Math.min(...chartData.map(d => d.return));
            const maxReturn = Math.max(...chartData.map(d => d.return));
            const range = maxReturn - minReturn;

            // Calculate mean position in the data range (where most data is concentrated)
            // 0σ should be at the mean (peak of distribution), not at 0% return
            const meanPosition = (avgMean - minReturn) / range;

            // Recharts margins from AreaChart component
            // The Y-axis takes up space on the left side
            const yAxisWidth = 60; // Approximate width of Y-axis
            const marginRight = 10; // From margin prop

            // Calculate the actual plotting area width
            const plottingAreaWidth = containerWidth - yAxisWidth - marginRight;

            // Calculate mean position in pixels, then convert to percentage of container
            const meanXPixels = yAxisWidth + (meanPosition * plottingAreaWidth);
            const meanXPercent = (meanXPixels / containerWidth) * 100;

            return (
              <>
                {/* 0σ line at mean (where most data is concentrated) */}
                <g key="zero">
                  <line
                    x1={`${meanXPercent}%`}
                    y1="10"
                    x2={`${meanXPercent}%`}
                    y2={`calc(100% - 40px)`}
                    stroke="var(--foreground)"
                    strokeWidth="2"
                    strokeDasharray="5 5"
                    opacity="0.6"
                  />
                  <text x={`${meanXPercent}%`} y="20" fill="var(--foreground)" fontSize="10" opacity="0.8" textAnchor="middle" fontWeight="600">
                    0σ
                  </text>
                </g>

                {/* Sigma lines - relative to mean */}
                {sigmaLevels.map(({ sigma, opacity }) => {
                  const negPosition = (avgMean - sigma * avgSigma - minReturn) / range;
                  const posPosition = (avgMean + sigma * avgSigma - minReturn) / range;

                  const negXPixels = yAxisWidth + (negPosition * plottingAreaWidth);
                  const posXPixels = yAxisWidth + (posPosition * plottingAreaWidth);

                  const negXPercent = (negXPixels / containerWidth) * 100;
                  const posXPercent = (posXPixels / containerWidth) * 100;

                  return (
                    <g key={sigma}>
                      {/* Negative sigma line */}
                      <line
                        x1={`${negXPercent}%`}
                        y1="10"
                        x2={`${negXPercent}%`}
                        y2={`calc(100% - 40px)`}
                        stroke="#ef4444"
                        strokeWidth="1"
                        strokeDasharray="3 6"
                        opacity={opacity * 2}
                      />
                      {/* Positive sigma line */}
                      <line
                        x1={`${posXPercent}%`}
                        y1="10"
                        x2={`${posXPercent}%`}
                        y2={`calc(100% - 40px)`}
                        stroke="#22c55e"
                        strokeWidth="1"
                        strokeDasharray="3 6"
                        opacity={opacity * 2}
                      />
                      {/* Labels */}
                      <text x={`${negXPercent}%`} y="20" fill="#ef4444" fontSize="9" opacity="0.6" textAnchor="middle">
                        -{sigma}σ
                      </text>
                      <text x={`${posXPercent}%`} y="20" fill="#22c55e" fontSize="9" opacity="0.6" textAnchor="middle">
                        +{sigma}σ
                      </text>
                    </g>
                  );
                })}
              </>
            );
          })()}
        </svg>
      </div>

      {/* Interpretation Guide */}
      <div
        style={{
          marginTop: 16,
          padding: 12,
          background: "rgba(59, 130, 246, 0.05)",
          border: "1px solid rgba(59, 130, 246, 0.2)",
          borderRadius: 6,
          fontSize: 11,
          color: "var(--muted-foreground)",
          lineHeight: 1.5,
        }}
      >
        <div style={{ fontWeight: 600, marginBottom: 6, color: "var(--foreground)" }}>
          How to Read This Chart
        </div>
        <div style={{ display: "grid", gap: 4 }}>
          <div>
            <strong>Click boxes above</strong> to show/hide timeframes
          </div>
          <div>
            <strong>Wider curves</strong> = Higher uncertainty (longer timeframes)
          </div>
          <div>
            <strong>σ lines</strong> = Standard deviation bands (±1σ, ±2σ, ±3σ, ±4σ)
          </div>
          <div>
            <strong>Negative skew</strong> = Fat tail on left (big losses more likely)
          </div>
          <div>
            <strong>High kurtosis</strong> = Fat tails (extreme events more common)
          </div>
        </div>
      </div>
    </div>
  );
}
