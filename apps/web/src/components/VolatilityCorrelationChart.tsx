"use client";

import { useMemo } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";

type VolDataPoint = {
  date: string;
  rolling20?: number;
  yangZhang?: number;
};

type Props = {
  stockData: VolDataPoint[];
  marketData: VolDataPoint[];
  height?: number;
  window?: number; // Rolling window size in days
};

/**
 * Calculate rolling correlation between two time series
 */
function calculateRollingCorrelation(
  series1: number[],
  series2: number[],
  window: number
): (number | null)[] {
  const result: (number | null)[] = [];

  for (let i = 0; i < series1.length; i++) {
    if (i < window - 1) {
      result.push(null);
      continue;
    }

    // Get window of data
    const window1 = series1.slice(i - window + 1, i + 1);
    const window2 = series2.slice(i - window + 1, i + 1);

    // Calculate means
    const mean1 = window1.reduce((a, b) => a + b, 0) / window;
    const mean2 = window2.reduce((a, b) => a + b, 0) / window;

    // Calculate correlation
    let numerator = 0;
    let sum1Sq = 0;
    let sum2Sq = 0;

    for (let j = 0; j < window; j++) {
      const diff1 = window1[j] - mean1;
      const diff2 = window2[j] - mean2;
      numerator += diff1 * diff2;
      sum1Sq += diff1 * diff1;
      sum2Sq += diff2 * diff2;
    }

    const denominator = Math.sqrt(sum1Sq * sum2Sq);
    const correlation = denominator !== 0 ? numerator / denominator : 0;

    result.push(correlation);
  }

  return result;
}

export default function VolatilityCorrelationChart({
  stockData,
  marketData,
  height = 280,
  window = 30,
}: Props) {
  const chartData = useMemo(() => {
    if (!stockData.length || !marketData.length) return [];

    // Align dates and extract volatility values
    const aligned: Array<{
      date: string;
      stockVol: number;
      marketVol: number;
    }> = [];

    const marketMap = new Map(
      marketData.map((d) => [d.date, d.yangZhang ?? d.rolling20 ?? 0])
    );

    for (const stockPoint of stockData) {
      const marketVol = marketMap.get(stockPoint.date);
      const stockVol = stockPoint.yangZhang ?? stockPoint.rolling20;

      if (stockVol !== undefined && marketVol !== undefined) {
        aligned.push({
          date: stockPoint.date,
          stockVol,
          marketVol,
        });
      }
    }

    if (aligned.length < window) return [];

    // Calculate rolling correlation
    const stockVols = aligned.map((d) => d.stockVol);
    const marketVols = aligned.map((d) => d.marketVol);
    const correlations = calculateRollingCorrelation(stockVols, marketVols, window);

    // Combine into chart data
    return aligned.map((d, i) => ({
      date: d.date,
      correlation: correlations[i],
    }));
  }, [stockData, marketData, window]);

  // Filter to last 2 years
  const filteredData = useMemo(() => {
    const twoYearsAgo = new Date();
    twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);

    return chartData.filter((d) => {
      const date = new Date(d.date);
      return date >= twoYearsAgo;
    });
  }, [chartData]);

  if (filteredData.length === 0) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height,
          color: "var(--muted)",
          fontSize: 13,
        }}
      >
        Insufficient data for correlation analysis
      </div>
    );
  }

  // Calculate average correlation for display
  const validCorrelations = filteredData
    .map((d) => d.correlation)
    .filter((c): c is number => c !== null);
  const avgCorrelation =
    validCorrelations.length > 0
      ? validCorrelations.reduce((a, b) => a + b, 0) / validCorrelations.length
      : 0;

  return (
    <div>
      {/* Info bar */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 12,
          padding: "8px 12px",
          background: "var(--hover-bg)",
          borderRadius: 4,
          fontSize: 11,
        }}
      >
        <div style={{ color: "var(--muted)" }}>
          Rolling {window}-day correlation between stock and OBX volatility
        </div>
        <div style={{ fontFamily: "monospace", color: "var(--foreground)" }}>
          Avg: {avgCorrelation.toFixed(3)}
        </div>
      </div>

      <ResponsiveContainer width="100%" height={height}>
        <LineChart
          data={filteredData}
          margin={{ top: 10, right: 20, left: 10, bottom: 20 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.3} />

          <XAxis
            dataKey="date"
            stroke="var(--muted)"
            fontSize={10}
            tickFormatter={(date) => {
              const d = new Date(date);
              return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
            }}
          />

          <YAxis
            stroke="var(--muted)"
            fontSize={10}
            domain={[-1, 1]}
            ticks={[-1, -0.5, 0, 0.5, 1]}
            tickFormatter={(val) => val.toFixed(1)}
            label={{
              value: "Correlation",
              angle: -90,
              position: "insideLeft",
              style: { fill: "var(--foreground)", fontSize: 11 },
            }}
          />

          <Tooltip
            contentStyle={{
              backgroundColor: "rgba(0, 0, 0, 0.9)",
              border: "1px solid rgba(255, 255, 255, 0.2)",
              borderRadius: "4px",
              fontSize: "11px",
              color: "#fff",
            }}
            content={({ active, payload }) => {
              if (!active || !payload || !payload.length) return null;
              const data = payload[0].payload;
              return (
                <div style={{ padding: "8px 10px" }}>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>
                    {new Date(data.date).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </div>
                  {data.correlation !== null && (
                    <div style={{ fontSize: 10, color: "#aaa" }}>
                      Correlation: {data.correlation.toFixed(3)}
                    </div>
                  )}
                </div>
              );
            }}
          />

          {/* Reference lines */}
          <ReferenceLine y={0} stroke="#666" strokeWidth={1.5} strokeDasharray="5 5" />
          <ReferenceLine y={0.5} stroke="#22c55e" strokeWidth={0.5} opacity={0.3} />
          <ReferenceLine y={-0.5} stroke="#ef4444" strokeWidth={0.5} opacity={0.3} />

          {/* Correlation line */}
          <Line
            type="monotone"
            dataKey="correlation"
            stroke="#f97316"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>

      {/* Interpretation guide */}
      <div
        style={{
          marginTop: 12,
          padding: "10px 12px",
          background: "var(--hover-bg)",
          borderRadius: 4,
          fontSize: 11,
          color: "var(--muted-foreground)",
          lineHeight: 1.5,
        }}
      >
        <strong style={{ color: "var(--foreground)" }}>Interpretation:</strong> Values near{" "}
        <strong style={{ color: "#22c55e" }}>+1</strong> indicate stock volatility moves in sync
        with market volatility (systematic risk). Values near{" "}
        <strong style={{ color: "#ef4444" }}>-1</strong> indicate inverse relationship. Values near{" "}
        <strong>0</strong> suggest the stock's volatility is driven by idiosyncratic factors
        rather than market-wide movements.
      </div>
    </div>
  );
}
