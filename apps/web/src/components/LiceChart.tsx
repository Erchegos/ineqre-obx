"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Area,
  ComposedChart,
} from "recharts";

type LiceWeekly = {
  year: number;
  week: number;
  avgLice: number | null;
  avgTemp: number | null;
  reportCount: number;
  aboveThreshold: number;
};

type Props = {
  data: LiceWeekly[];
  threshold?: number;
};

export default function LiceChart({ data, threshold = 0.5 }: Props) {
  if (!data || data.length === 0) {
    return (
      <div style={{ padding: 24, color: "#8b949e", textAlign: "center", fontSize: 13 }}>
        No lice data yet. Connect BarentsWatch API to populate.
        <br />
        <span style={{ fontSize: 11, color: "#484f58" }}>
          Treatment threshold: 0.5 adult female lice per fish
        </span>
      </div>
    );
  }

  const chartData = data.map((d) => ({
    label: `W${d.week}`,
    avgLice: d.avgLice,
    threshold,
    temp: d.avgTemp,
    aboveThreshold: d.aboveThreshold,
  }));

  return (
    <div>
      <div style={{ fontSize: 11, color: "#8b949e", marginBottom: 8 }}>
        Adult female lice per fish (industry average) | Threshold: {threshold}
      </div>
      <ResponsiveContainer width="100%" height={280}>
        <ComposedChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
          <XAxis
            dataKey="label"
            tick={{ fill: "#8b949e", fontSize: 10 }}
            axisLine={{ stroke: "#30363d" }}
            tickLine={false}
          />
          <YAxis
            tick={{ fill: "#8b949e", fontSize: 10 }}
            domain={[0, "auto"]}
            axisLine={false}
            tickLine={false}
          />
          <ReferenceLine
            y={threshold}
            stroke="#ef4444"
            strokeDasharray="4 4"
            label={{ value: "Threshold", fill: "#ef4444", fontSize: 10, position: "right" }}
          />
          <Tooltip
            contentStyle={{
              background: "#161b22",
              border: "1px solid #30363d",
              borderRadius: 6,
              fontSize: 12,
            }}
            formatter={(v, name) => {
              if (v == null) return ["—", String(name ?? "")];
              if (name === "avgLice") return [(v as number).toFixed(3), "Avg Lice"];
              if (name === "threshold") return [(v as number).toFixed(1), "Threshold"];
              return [String(v), String(name ?? "")];
            }}
          />
          <Area
            type="monotone"
            dataKey="avgLice"
            stroke="#3b82f6"
            fill="#3b82f620"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, fill: "#3b82f6" }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
