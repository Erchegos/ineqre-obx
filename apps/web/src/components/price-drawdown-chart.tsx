"use client";

import React from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  Brush,
} from "recharts";
import type { TooltipProps } from "recharts";
import type { NameType, ValueType } from "recharts/types/component/DefaultTooltipContent";

export type PriceDrawdownPoint = {
  date: string; // YYYY-MM-DD
  drawdown: number; // <= 0, e.g. -0.25
};

function pct(v: number) {
  return `${(v * 100).toFixed(2)}%`;
}

function DrawdownTooltipContent(props: TooltipProps<ValueType, NameType>) {
  const { active, payload, label } = props;

  if (!active || !payload || payload.length === 0) return null;

  const item = payload[0];
  const raw = item?.value;
  const value = typeof raw === "number" ? raw : Number(raw);

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
      <div
        style={{
          opacity: 0.85,
          fontFamily:
            "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        }}
      >
        {String(label)}
      </div>

      <div style={{ marginTop: 6, display: "flex", gap: 8 }}>
        <span style={{ opacity: 0.65 }}>Drawdown</span>
        <span style={{ fontWeight: 650 }}>
          {Number.isFinite(value) ? pct(value) : "n/a"}
        </span>
      </div>
    </div>
  );
}

export function PriceDrawdownChart({
  data,
  height = 260,
}: {
  data: PriceDrawdownPoint[];
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

  const chart = data.map((p) => ({
    date: p.date,
    drawdown: p.drawdown,
  }));

  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart
          data={chart}
          margin={{ top: 10, right: 24, left: 10, bottom: 0 }}
        >
          <CartesianGrid strokeDasharray="3 3" opacity={0.15} />

          <XAxis
            dataKey="date"
            minTickGap={28}
            tickMargin={8}
            tick={{ fill: "rgba(255,255,255,0.55)", fontSize: 12 }}
          />

          <YAxis
            width={70}
            domain={[-1, 0]}
            tickMargin={8}
            tickFormatter={(v) => pct(Number(v))}
            tick={{ fill: "rgba(255,255,255,0.55)", fontSize: 12 }}
            label={{
              value: "Drawdown",
              angle: -90,
              position: "insideLeft",
              fill: "rgba(255,255,255,0.45)",
              fontSize: 12,
            }}
          />

          <Tooltip content={(p) => <DrawdownTooltipContent {...p} />} />

          <Legend
            wrapperStyle={{ color: "rgba(255,255,255,0.65)", fontSize: 12 }}
          />

          <Area
            type="monotone"
            dataKey="drawdown"
            name="Drawdown"
            opacity={0.22}
          />

          <Brush
            dataKey="date"
            height={22}
            stroke="rgba(255,255,255,0.35)"
            travellerWidth={10}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export default PriceDrawdownChart;
