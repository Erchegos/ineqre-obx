"use client";

import React from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  Brush,
} from "recharts";

export type PriceChartPoint = {
  date: string;          // "YYYY-MM-DD"
  close: number;         // price
  drawdown: number;      // <= 0, e.g. -0.25 for -25%
  normalized?: number;   // optional, indexed series (base 100)
};

function pct(v: number) {
  return `${(v * 100).toFixed(2)}%`;
}

function num(v: number) {
  return Number.isFinite(v) ? v.toFixed(2) : "";
}

export function PriceChart({
  data,
  mode = "indexed",
  height = 360,
}: {
  data: PriceChartPoint[];
  mode?: "price" | "indexed";
  height?: number;
}) {
  if (!data || data.length === 0) {
    return (
      <div
        style={{
          height,
          borderRadius: 12,
          border: "1px solid rgba(255,255,255,0.10)",
          background: "rgba(255,255,255,0.03)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "rgba(255,255,255,0.70)",
          fontSize: 13,
        }}
      >
        No chart data
      </div>
    );
  }

  // Ensure we always have an indexed series if caller did not supply it.
  const base = data[0].close > 0 ? data[0].close : 1;
  const chart = data.map((p) => ({
    ...p,
    normalized: p.normalized ?? (p.close / base) * 100,
  }));

  const leftLabel = mode === "price" ? "Close" : "Indexed (100)";

  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={chart} margin={{ top: 10, right: 24, left: 10, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" opacity={0.15} />

          <XAxis
            dataKey="date"
            minTickGap={28}
            tickMargin={8}
            tick={{ fill: "rgba(255,255,255,0.55)", fontSize: 12 }}
          />

          <YAxis
            yAxisId="left"
            width={70}
            domain={["auto", "auto"]}
            tickMargin={8}
            tick={{ fill: "rgba(255,255,255,0.55)", fontSize: 12 }}
            label={{
              value: leftLabel,
              angle: -90,
              position: "insideLeft",
              fill: "rgba(255,255,255,0.45)",
              fontSize: 12,
            }}
          />

          <YAxis
            yAxisId="right"
            orientation="right"
            width={70}
            domain={[-1, 0]}
            tickMargin={8}
            tickFormatter={(v) => pct(Number(v))}
            tick={{ fill: "rgba(255,255,255,0.55)", fontSize: 12 }}
            label={{
              value: "Drawdown",
              angle: 90,
              position: "insideRight",
              fill: "rgba(255,255,255,0.45)",
              fontSize: 12,
            }}
          />

          <Tooltip
            content={({ active, payload, label }) => {
              if (!active || !payload || payload.length === 0) return null;

              const map = payload.reduce<Record<string, any>>((acc, item) => {
                acc[String(item.dataKey)] = item.value;
                return acc;
              }, {});

              const leftVal =
                mode === "price" ? (map.close as number | undefined) : (map.normalized as number | undefined);
              const ddVal = map.drawdown as number | undefined;

              return (
                <div
                  style={{
                    borderRadius: 10,
                    border: "1px solid rgba(255,255,255,0.18)",
                    background: "rgba(0,0,0,0.82)",
                    padding: "10px 12px",
                    fontSize: 13,
                    lineHeight: 1.55,
                  }}
                >
                  <div style={{ opacity: 0.85, fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" }}>
                    {label}
                  </div>

                  <div style={{ marginTop: 6 }}>
                    <div style={{ display: "flex", gap: 8 }}>
                      <span style={{ opacity: 0.65 }}>{leftLabel}</span>
                      <span style={{ fontWeight: 650 }}>{leftVal == null ? "n/a" : num(Number(leftVal))}</span>
                    </div>

                    <div style={{ display: "flex", gap: 8 }}>
                      <span style={{ opacity: 0.65 }}>Drawdown</span>
                      <span style={{ fontWeight: 650 }}>{ddVal == null ? "n/a" : pct(Number(ddVal))}</span>
                    </div>
                  </div>
                </div>
              );
            }}
          />

          <Legend wrapperStyle={{ color: "rgba(255,255,255,0.65)", fontSize: 12 }} />

          <Line
            yAxisId="left"
            type="monotone"
            dataKey={mode === "price" ? "close" : "normalized"}
            name={mode === "price" ? "Close" : "Asset (indexed)"}
            dot={false}
            strokeWidth={2}
          />

          <Area
            yAxisId="right"
            type="monotone"
            dataKey="drawdown"
            name="Drawdown"
            opacity={0.22}
          />

          <Brush dataKey="date" height={22} stroke="rgba(255,255,255,0.35)" travellerWidth={10} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
