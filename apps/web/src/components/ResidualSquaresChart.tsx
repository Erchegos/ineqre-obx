"use client";

import { useMemo, useState } from "react";
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";

type ResidualSquaresChartProps = {
  data: Array<{ date: string; residualSquare: number; residual: number }>;
  height?: number;
};

export default function ResidualSquaresChart({
  data,
  height = 400,
}: ResidualSquaresChartProps) {
  const [period, setPeriod] = useState<string>("1Y");

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

  // Filter data based on selected period
  const filteredData = useMemo(() => {
    const periodDays: Record<string, number> = {
      "1M": 21,
      "3M": 63,
      "6M": 126,
      "1Y": 252,
      "3Y": 756,
      "All": data.length,
    };

    const days = periodDays[period] || 252;
    const startIdx = Math.max(0, data.length - days);

    return data.slice(startIdx).map((d, idx) => ({
      x: startIdx + idx, // Use index for x-axis
      y: d.residualSquare * 10000, // Convert to basis points squared
      date: d.date,
      residual: d.residual,
    }));
  }, [data, period]);

  // Calculate mean residual square
  const meanResidualSquare = useMemo(() => {
    if (filteredData.length === 0) return 0;
    return (
      filteredData.reduce((sum, d) => sum + d.y, 0) / filteredData.length
    );
  }, [filteredData]);

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
        <div style={{ display: "flex", gap: 8 }}>
          {["1M", "3M", "6M", "1Y", "3Y", "All"].map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              style={{
                padding: "6px 12px",
                borderRadius: 4,
                border: "1px solid var(--border)",
                background:
                  period === p ? "var(--accent)" : "var(--card-bg)",
                color: period === p ? "#fff" : "var(--foreground)",
                fontSize: 12,
                fontWeight: 500,
                cursor: "pointer",
                transition: "all 0.15s",
              }}
            >
              {p}
            </button>
          ))}
        </div>
        <div
          style={{
            fontSize: 12,
            color: "var(--muted)",
            fontFamily: "monospace",
          }}
        >
          Mean ε² = {meanResidualSquare.toFixed(4)} bps²
        </div>
      </div>

      {/* Chart */}
      <div style={{ position: "relative", width: "100%", height }}>
        <ResponsiveContainer width="100%" height={height}>
          <ScatterChart margin={{ top: 10, right: 20, left: 10, bottom: 20 }}>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="var(--border-subtle)"
              opacity={0.3}
            />

            <XAxis
              dataKey="x"
              type="number"
              stroke="var(--muted)"
              fontSize={11}
              tickFormatter={(val) => {
                const idx = Math.floor(val);
                if (idx >= 0 && idx < data.length) {
                  const date = data[idx].date;
                  return date.length > 7 ? date.slice(5) : date;
                }
                return "";
              }}
              domain={["dataMin", "dataMax"]}
            />

            <YAxis
              dataKey="y"
              stroke="var(--muted)"
              fontSize={11}
              tickFormatter={(val) => val.toFixed(1)}
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
              content={(props: any) => {
                const { active, payload } = props;
                if (!active || !payload || !payload.length) return null;

                const point = payload[0].payload;
                return (
                  <div
                    style={{
                      backgroundColor: "var(--card-bg)",
                      border: "1px solid var(--card-border)",
                      borderRadius: "4px",
                      padding: "8px 10px",
                      fontSize: "12px",
                    }}
                  >
                    <div
                      style={{
                        color: "var(--muted)",
                        marginBottom: "4px",
                        fontWeight: 600,
                      }}
                    >
                      {point.date}
                    </div>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: "12px",
                        marginBottom: "2px",
                      }}
                    >
                      <span>Residual²:</span>
                      <span
                        style={{ fontWeight: 600, fontFamily: "monospace" }}
                      >
                        {point.y.toFixed(4)} bps²
                      </span>
                    </div>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: "12px",
                      }}
                    >
                      <span>Residual:</span>
                      <span
                        style={{
                          fontWeight: 600,
                          fontFamily: "monospace",
                          color:
                            point.residual >= 0 ? "#22c55e" : "#ef4444",
                        }}
                      >
                        {(point.residual * 100).toFixed(3)}%
                      </span>
                    </div>
                  </div>
                );
              }}
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

            {/* Scatter dots */}
            <Scatter
              data={filteredData}
              fill="#3b82f6"
              fillOpacity={0.6}
              strokeWidth={0}
            />
          </ScatterChart>
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
            <strong>Each dot</strong> = Daily residual² from OBX beta model
          </div>
          <div>
            <strong>Residual (ε)</strong> = Return not explained by market beta
          </div>
          <div>
            <strong>Lower values</strong> = Stock moves with market (high R²)
          </div>
          <div>
            <strong>Higher values</strong> = Idiosyncratic risk (low R²)
          </div>
          <div>
            <strong>Mean line</strong> = Average unexplained variance for period
          </div>
        </div>
      </div>
    </div>
  );
}
