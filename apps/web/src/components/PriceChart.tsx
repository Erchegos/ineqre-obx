"use client";

import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";

type Point = {
  date: string;
  close: number;
  drawdown: number;
};

function pct(x: number) {
  return `${(x * 100).toFixed(2)}%`;
}

export function PriceChart({ data }: { data: Point[] }) {
  return (
    <div
      style={{
        borderRadius: 12,
        border: "1px solid rgba(255,255,255,0.08)",
        background: "rgba(255,255,255,0.03)",
        padding: 12,
        marginBottom: 16,
      }}
    >
      <div style={{ opacity: 0.75, fontSize: 12, marginBottom: 8 }}>
        Price and drawdown
      </div>

      <div style={{ width: "100%", height: 320 }}>
        <ResponsiveContainer>
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
            <XAxis dataKey="date" hide />
            <YAxis yAxisId="price" />
            <YAxis
              yAxisId="dd"
              orientation="right"
              domain={[-1, 0]}
              tickFormatter={pct}
            />
            <Tooltip
              formatter={(v: number, n: string) =>
                n === "drawdown" ? [pct(v), "drawdown"] : [v.toFixed(2), "price"]
              }
            />
            <Line yAxisId="price" dataKey="close" dot={false} strokeWidth={2} />
            <Line yAxisId="dd" dataKey="drawdown" dot={false} strokeWidth={2} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
