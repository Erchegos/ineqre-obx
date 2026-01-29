"use client";

import { useMemo, useState, useEffect } from "react";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";

type MonteCarloChartProps = {
  paths: Array<Array<{ time: number; price: number }>>;
  distribution: Array<{ price: number; count: number; density: number }>;
  theoreticalDistribution: Array<{ price: number; density: number }>;
  startPrice: number;
  finalTime: number;
  percentiles: {
    p5: number;
    p25: number;
    p50: number;
    p75: number;
    p95: number;
    mean: number;
  };
  height?: number;
  ticker?: string;
};

export default function MonteCarloChart({
  paths,
  distribution,
  theoreticalDistribution,
  startPrice,
  finalTime,
  percentiles,
  height = 400,
  ticker = "Stock",
}: MonteCarloChartProps) {
  // Detect currency based on ticker suffix
  const currency = ticker.endsWith(".US") ? "USD" : "kr";

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentStep, setCurrentStep] = useState(paths[0]?.length || 0);
  const [playbackSpeed, setPlaybackSpeed] = useState(50); // ms per step

  // Reset to end when paths change
  useEffect(() => {
    setCurrentStep(paths[0]?.length || 0);
    setIsPlaying(false);
  }, [paths]);

  // Animation loop
  useEffect(() => {
    if (!isPlaying) return;

    const maxSteps = paths[0]?.length || 0;
    if (currentStep >= maxSteps) {
      setIsPlaying(false);
      return;
    }

    const timer = setTimeout(() => {
      setCurrentStep(prev => Math.min(prev + 1, maxSteps));
    }, playbackSpeed);

    return () => clearTimeout(timer);
  }, [isPlaying, currentStep, playbackSpeed, paths]);

  const handlePlay = () => {
    if (currentStep >= (paths[0]?.length || 0)) {
      setCurrentStep(0);
    }
    setIsPlaying(true);
  };

  const handlePause = () => {
    setIsPlaying(false);
  };

  const handleReset = () => {
    setCurrentStep(0);
    setIsPlaying(false);
  };

  const handleSeek = (step: number) => {
    setCurrentStep(step);
  };

  // Prepare chart data for animated paths (only show up to currentStep)
  const animatedPathsData = useMemo(() => {
    if (paths.length === 0) return [];

    const maxTime = Math.max(...paths[0].map(p => p.time));
    const allTimes = Array.from({ length: currentStep + 1 }, (_, i) => i);

    return allTimes.map(time => {
      const dataPoint: any = { time };

      // Add each path's price at this time
      paths.forEach((path, pathIdx) => {
        if (time < path.length) {
          dataPoint[`path${pathIdx}`] = path[time].price;
        }
      });

      return dataPoint;
    });
  }, [paths, currentStep]);

  // Get current distribution (final prices at currentStep)
  const currentDistribution = useMemo(() => {
    if (currentStep === 0 || paths.length === 0) return [];

    const currentPrices = paths.map(path =>
      currentStep < path.length ? path[currentStep].price : path[path.length - 1].price
    ).sort((a, b) => a - b);

    const minPrice = Math.min(...currentPrices);
    const maxPrice = Math.max(...currentPrices);

    // Use percentile-based range
    const p5 = currentPrices[Math.floor(currentPrices.length * 0.02)];
    const p95 = currentPrices[Math.floor(currentPrices.length * 0.98)];
    const range = p95 - p5;

    const extendedMin = p5 - range * 0.1;
    const extendedMax = p95 + range * 0.1;
    const extendedRange = extendedMax - extendedMin;

    const numBins = 50;
    const binWidth = extendedRange / numBins;

    const bins: Array<{ price: number; count: number; density: number }> = [];

    for (let i = 0; i < numBins; i++) {
      const binMin = extendedMin + i * binWidth;
      const binMax = binMin + binWidth;
      const binCenter = (binMin + binMax) / 2;

      const count = currentPrices.filter(p => p >= binMin && p < binMax).length;
      const density = binWidth > 0 ? count / (paths.length * binWidth) : 0;

      bins.push({
        price: binCenter,
        count,
        density: density * 100, // Scale for visibility
      });
    }

    return bins;
  }, [paths, currentStep]);

  // Combine empirical and theoretical for overlay
  const combinedDistribution = useMemo(() => {
    if (currentStep < (paths[0]?.length || 0)) {
      // Still animating - only show current distribution
      return currentDistribution.map(d => ({
        price: d.price,
        empirical: d.density,
        theoretical: null,
      }));
    }

    // Animation complete - show both
    return distribution.map((d, idx) => ({
      price: d.price,
      empirical: d.density * 100,
      theoretical: theoreticalDistribution[idx]?.density * 100 || 0,
    }));
  }, [currentDistribution, distribution, theoreticalDistribution, currentStep, paths]);

  if (paths.length === 0) {
    return (
      <div style={{
        height,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "var(--muted)"
      }}>
        No simulation data available
      </div>
    );
  }

  const maxSteps = paths[0]?.length || 0;
  const progress = maxSteps > 0 ? (currentStep / maxSteps) * 100 : 0;

  return (
    <div style={{ width: "100%" }}>
      {/* Title */}
      <h3 style={{
        fontSize: 18,
        fontWeight: 600,
        marginBottom: 16,
        color: "var(--foreground)",
        textAlign: "center"
      }}>
        Convergence of Sample Paths to Theoretical Distribution at Final Time T ({paths.length} paths shown)
      </h3>

      {/* Main chart area - side by side */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "2fr 1fr",
        gap: 16,
        marginBottom: 16
      }}>
        {/* Left: Simulated Brownian Paths */}
        <div>
          <h4 style={{
            fontSize: 14,
            fontWeight: 600,
            marginBottom: 8,
            color: "var(--foreground)",
            textAlign: "center"
          }}>
            Simulated Brownian Paths
          </h4>
          <div style={{
            background: "var(--card-bg)",
            borderRadius: 8,
            padding: 12,
            border: "1px solid var(--border)"
          }}>
            <ResponsiveContainer width="100%" height={height}>
              <LineChart
                data={animatedPathsData}
                margin={{ top: 10, right: 10, left: 10, bottom: 30 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" opacity={0.3} />

                <XAxis
                  dataKey="time"
                  stroke="var(--muted)"
                  fontSize={11}
                  label={{
                    value: "Time (t)",
                    position: "insideBottom",
                    offset: -10,
                    style: { fill: "var(--foreground)", fontSize: 12 },
                  }}
                />

                <YAxis
                  stroke="var(--muted)"
                  fontSize={11}
                  label={{
                    value: `${ticker} Price`,
                    angle: -90,
                    position: "insideLeft",
                    style: { fill: "var(--foreground)", fontSize: 12 },
                  }}
                  domain={['auto', 'auto']}
                />

                <Tooltip
                  contentStyle={{
                    backgroundColor: "var(--card-bg)",
                    borderColor: "var(--card-border)",
                    borderRadius: "4px",
                    fontSize: "11px",
                  }}
                  content={({ active, payload }) => {
                    if (!active || !payload || !payload.length) return null;
                    const time = payload[0]?.payload?.time;
                    return (
                      <div style={{
                        backgroundColor: "rgba(0, 0, 0, 0.9)",
                        border: "1px solid rgba(255, 255, 255, 0.2)",
                        borderRadius: "4px",
                        padding: "8px 10px",
                        fontSize: "11px",
                        color: "#fff",
                      }}>
                        <div style={{ fontWeight: 600, marginBottom: 4 }}>
                          Time: {time}
                        </div>
                        <div style={{ fontSize: 10, color: "#aaa" }}>
                          {paths.length} paths simulated
                        </div>
                      </div>
                    );
                  }}
                />

                {/* Reference line at starting price */}
                <ReferenceLine
                  y={startPrice}
                  stroke="#666"
                  strokeDasharray="3 3"
                  strokeWidth={1}
                />

                {/* Highlight one path in magenta */}
                {paths.length > 0 && (
                  <Line
                    dataKey="path0"
                    stroke="#d946ef"
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                  />
                )}

                {/* All other paths in teal */}
                {paths.slice(1).map((_, idx) => (
                  <Line
                    key={idx}
                    dataKey={`path${idx + 1}`}
                    stroke="rgba(20, 184, 166, 0.4)"
                    strokeWidth={0.8}
                    dot={false}
                    isAnimationActive={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Right: Distribution */}
        <div>
          <h4 style={{
            fontSize: 14,
            fontWeight: 600,
            marginBottom: 8,
            color: "var(--foreground)",
            textAlign: "center"
          }}>
            Distribution of {ticker} (T={finalTime})
          </h4>
          <div style={{
            background: "var(--card-bg)",
            borderRadius: 8,
            padding: 12,
            border: "1px solid var(--border)"
          }}>
            <ResponsiveContainer width="100%" height={height}>
              <BarChart
                data={combinedDistribution}
                margin={{ top: 10, right: 10, left: 10, bottom: 30 }}
                layout="vertical"
              >
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" opacity={0.3} />

                <XAxis
                  type="number"
                  stroke="var(--muted)"
                  fontSize={11}
                  label={{
                    value: "Density",
                    position: "insideBottom",
                    offset: -10,
                    style: { fill: "var(--foreground)", fontSize: 12 },
                  }}
                  domain={[0, 'auto']}
                />

                <YAxis
                  type="number"
                  dataKey="price"
                  stroke="var(--muted)"
                  fontSize={11}
                  label={{
                    value: `${ticker} Price`,
                    angle: -90,
                    position: "insideLeft",
                    style: { fill: "var(--foreground)", fontSize: 12 },
                  }}
                  domain={['auto', 'auto']}
                  reversed={true}
                  tickFormatter={(val) => `${val.toFixed(0)} ${currency}`}
                />

                <Tooltip
                  contentStyle={{
                    backgroundColor: "var(--card-bg)",
                    borderColor: "var(--card-border)",
                    borderRadius: "4px",
                    fontSize: "11px",
                  }}
                />

                {/* Empirical distribution (green bars) */}
                <Bar
                  dataKey="empirical"
                  fill="#86efac"
                  opacity={0.8}
                  isAnimationActive={false}
                />

                {/* Theoretical distribution (magenta line overlay) */}
                {currentStep >= maxSteps && (
                  <Line
                    dataKey="theoretical"
                    stroke="#d946ef"
                    strokeWidth={2.5}
                    dot={false}
                    isAnimationActive={false}
                    type="monotone"
                  />
                )}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Playback Controls */}
      <div style={{
        background: "var(--card-bg)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        padding: 16,
      }}>
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: 12
        }}>
          {/* Play/Pause Button */}
          <button
            onClick={isPlaying ? handlePause : handlePlay}
            style={{
              padding: "8px 20px",
              borderRadius: 6,
              border: "none",
              background: "var(--accent)",
              color: "#fff",
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 8,
              transition: "all 0.15s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.opacity = "0.9";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.opacity = "1";
            }}
          >
            {isPlaying ? "⏸ Pause" : "▶ Play"}
          </button>

          {/* Reset Button */}
          <button
            onClick={handleReset}
            style={{
              padding: "8px 16px",
              borderRadius: 6,
              border: "1px solid var(--border)",
              background: "var(--card-bg)",
              color: "var(--foreground)",
              fontSize: 13,
              fontWeight: 500,
              cursor: "pointer",
              transition: "all 0.15s",
            }}
          >
            ↺ Reset
          </button>

          {/* Speed Control */}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>Speed:</span>
            <select
              value={playbackSpeed}
              onChange={(e) => setPlaybackSpeed(Number(e.target.value))}
              style={{
                padding: "6px 10px",
                borderRadius: 4,
                border: "1px solid var(--border)",
                background: "var(--input-bg)",
                color: "var(--foreground)",
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              <option value={10}>10x</option>
              <option value={25}>5x</option>
              <option value={50}>2x</option>
              <option value={100}>1x</option>
              <option value={200}>0.5x</option>
            </select>
          </div>

          <div style={{ flex: 1 }} />

          {/* Progress indicator */}
          <div style={{ fontSize: 13, color: "var(--muted)", fontFamily: "monospace" }}>
            Step: {currentStep} / {maxSteps} ({progress.toFixed(0)}%)
          </div>
        </div>

        {/* Progress bar / Seeker */}
        <div style={{ position: "relative", width: "100%", height: 8, background: "var(--input-bg)", borderRadius: 4, cursor: "pointer" }}
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const percent = x / rect.width;
            const newStep = Math.floor(percent * maxSteps);
            handleSeek(newStep);
          }}
        >
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              height: "100%",
              width: `${progress}%`,
              background: "var(--accent)",
              borderRadius: 4,
              transition: isPlaying ? "none" : "width 0.1s",
            }}
          />
        </div>
      </div>

      {/* Statistics */}
      <div style={{
        marginTop: 16,
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
        gap: 12,
      }}>
        <StatCard label="Start Price" value={`${startPrice.toFixed(2)} ${currency}`} />
        <StatCard label="Mean (Final)" value={`${percentiles.mean.toFixed(2)} ${currency}`} />
        <StatCard label="Median (p50)" value={`${percentiles.p50.toFixed(2)} ${currency}`} />
        <StatCard label="5th Percentile" value={`${percentiles.p5.toFixed(2)} ${currency}`} colorType="danger" />
        <StatCard label="95th Percentile" value={`${percentiles.p95.toFixed(2)} ${currency}`} colorType="success" />
      </div>

      {/* Results Explanation - Show when animation completes */}
      {currentStep >= maxSteps && (
        <div style={{
          marginTop: 20,
          padding: 16,
          background: "var(--hover-bg)",
          border: "1px solid var(--border)",
          borderRadius: 8,
          fontSize: 13,
          color: "var(--muted-foreground)",
          lineHeight: 1.6,
          animation: "fadeIn 0.3s ease-in",
        }}>
          <h4 style={{
            fontSize: 14,
            fontWeight: 600,
            marginBottom: 12,
            color: "var(--foreground)"
          }}>
            Simulation Results Explained
          </h4>
          <div style={{ display: "grid", gap: 10 }}>
            <div>
              <strong style={{ color: "var(--foreground)" }}>Mean Final Price ({percentiles.mean.toFixed(2)} {currency}):</strong>{" "}
              The average price across all {paths.length} simulated paths at time T={finalTime}.
              {percentiles.mean > startPrice ? (
                <span style={{ color: "var(--success)" }}> This suggests an expected upward trend of {((percentiles.mean / startPrice - 1) * 100).toFixed(1)}%.</span>
              ) : (
                <span style={{ color: "var(--danger)" }}> This suggests an expected downward trend of {((percentiles.mean / startPrice - 1) * 100).toFixed(1)}%.</span>
              )}
            </div>
            <div>
              <strong style={{ color: "var(--foreground)" }}>Median (p50) ({percentiles.p50.toFixed(2)} {currency}):</strong>{" "}
              Half of the simulated paths ended above this price, half below. Often more representative than the mean for skewed distributions.
            </div>
            <div>
              <strong style={{ color: "var(--foreground)" }}>90% Confidence Interval ({percentiles.p5.toFixed(2)} {currency} - {percentiles.p95.toFixed(2)} {currency}):</strong>{" "}
              Based on this simulation, there's a 90% probability the price will fall within this range.
              The range of {(percentiles.p95 - percentiles.p5).toFixed(2)} {currency} indicates the level of uncertainty.
            </div>
            <div>
              <strong style={{ color: "var(--foreground)" }}>Distribution Shape:</strong>{" "}
              The green bars show the actual distribution from the simulation, while the magenta line shows the theoretical normal distribution.
              Differences between them reveal non-normal characteristics in the stock's price behavior.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, colorType }: { label: string; value: string; colorType?: "success" | "danger" }) {
  const getColor = () => {
    if (colorType === "success") return "var(--success)";
    if (colorType === "danger") return "var(--danger)";
    return "var(--foreground)";
  };

  return (
    <div style={{
      padding: 12,
      borderRadius: 6,
      border: "1px solid var(--border)",
      background: "var(--card-bg)"
    }}>
      <div style={{ fontSize: 10, color: "var(--muted)", marginBottom: 4, textTransform: "uppercase" }}>
        {label}
      </div>
      <div style={{ fontSize: 16, fontWeight: 600, color: getColor(), fontFamily: "monospace" }}>
        {value}
      </div>
    </div>
  );
}
