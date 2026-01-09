"use client";

import * as React from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";

export type PriceChartPoint = {
  date: string;
  close: number;
};

type Props = {
  data: PriceChartPoint[];
  height?: number;
};

function formatDateLabel(v: string) {
  // expects YYYY-MM-DD
  if (!v) return "";
  const parts = v.split("-");
  if (parts.length !== 3) return v;
  return `${parts[2]}.${parts[1]}`;
}

export default function PriceChart({ data, height = 320 }: Props) {
  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 12, bottom: 8, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis
            dataKey="date"
            tickFormatter={formatDateLabel}
            minTickGap={24}
          />
          <YAxis
            domain={["auto", "auto"]}
            tickFormatter={(v) => (Number.isFinite(v) ? Number(v).toFixed(0) : "")}
          />
          <Tooltip
            formatter={(value) => {
              const n = typeof value === "number" ? value : Number(value);
              return Number.isFinite(n) ? n.toFixed(2) : String(value);
            }}
            labelFormatter={(label) => String(label)}
          />
          <Line type="monotone" dataKey="close" dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
