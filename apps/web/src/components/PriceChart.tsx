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
import type { TooltipProps } from "recharts";
import type { NameType, ValueType } from "recharts/types/component/DefaultTooltipContent";

export type PriceChartPoint = {
  date: string; // YYYY-MM-DD
  close: number;
  drawdown: number; // <= 0, e.g. -0.25
  normalized?: number; // base 100
};

function pct(v: number) {
  return `${(v * 100).toFixed(2)}%`;
}

function num(v: number) {
  return Number.isFinite(v) ? v.toFixed(2) : "";
}

type SeriesKey = "close" | "normalized" | "drawdown";
type SeriesMap = Partial<Record<SeriesKey, number>>;

function PriceTooltipContent(
  props: TooltipProps<ValueType, NameType> & {
    mode: "price" | "indexed";
    leftLabel: string;
  }
) {
  const { active, payload, label, mode, leftLabel } = props;

  if (!active || !payload || payload.length === 0) return null;

  const map: SeriesMap = {};
  for (const item of payload) {
    const dk = item.dataKey;
    if (dk === "close" || dk === "normalized" || dk === "drawdown") {
      const v = item.value;
      map[dk] = typeof v === "number" ? v : Number(v);
    }
  }

  const leftVal = mode === "price" ? map.close : map.normalized;
  const ddVal = map.drawdown;

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

      <div style={{ marginTop: 6 }}>
        <div style={{ display: "flex", gap: 8 }}>
          <span style={{ opacity: 0.65 }}>{leftLabel}</span>
          <span style={{ fontWeight: 650 }}>
            {leftVal == null ? "n/a" : num(leftVal)}
          </span>
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <span style={{ opacity: 0.65 }}>Drawdown</span>
          <span style={{ fontWeight: 650 }}>
            {ddVal == null ? "n/a" : pct(ddVal)}
          </span>
        </div>
      </div>
    </div>
  );
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

  const base = data[0]?.close > 0 ? data[0].close : 1;
  const chart: Array<Required<Pick<PriceChartPoint, "date" | "close" | "drawdown">> & { normalized: number }> =
    data.map((p) => ({
      date: p.date,
      close: p.close,
      drawdown: p.drawdown,
      normalized: p.normalized ?? (p.close / base) * 100,
    }));

  const leftLabel = mode === "price" ? "Close" : "Indexed (100)";
  const leftKey: SeriesKey = mode === "price" ? "close" : "normalized";

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
            content={(p) => (
              <PriceTooltipContent {...p} mode={mode} leftLabel={leftLabel} />
            )}
          />

          <Legend
            wrapperStyle={{ color: "rgba(255,255,255,0.65)", fontSize: 12 }}
          />

          <Line
            yAxisId="left"
            type="monotone"
            dataKey={leftKey}
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

export default PriceChart;
