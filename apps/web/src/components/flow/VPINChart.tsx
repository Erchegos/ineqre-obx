"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";

type VPINPoint = {
  ts: string;
  vpin: number;
  kyle_lambda: number;
};

function formatTime(ts: string): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export default function VPINChart({ data }: { data: VPINPoint[] }) {
  if (!data.length) {
    return (
      <div
        style={{
          height: 220,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "rgba(255,255,255,0.4)",
          fontSize: 12,
          fontFamily: "monospace",
        }}
      >
        No VPIN data available
      </div>
    );
  }

  const chartData = data.map((d) => ({
    time: formatTime(d.ts),
    vpin: d.vpin,
    lambda: d.kyle_lambda,
  }));

  return (
    <div style={{ background: "#0d1117", border: "1px solid #21262d", borderRadius: 6, padding: 12 }}>
      <div
        style={{
          fontSize: 9,
          fontWeight: 600,
          color: "rgba(255,255,255,0.5)",
          letterSpacing: "0.06em",
          marginBottom: 8,
          fontFamily: "monospace",
          textTransform: "uppercase" as const,
        }}
      >
        VPIN + KYLE LAMBDA
      </div>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
          <XAxis
            dataKey="time"
            tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 9, fontFamily: "monospace" }}
            axisLine={{ stroke: "#21262d" }}
            tickLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            yAxisId="vpin"
            domain={[0, 1]}
            tick={{ fill: "#00e5ff", fontSize: 9, fontFamily: "monospace" }}
            axisLine={false}
            tickLine={false}
            width={35}
          />
          <YAxis
            yAxisId="lambda"
            orientation="right"
            tick={{ fill: "#f59e0b", fontSize: 9, fontFamily: "monospace" }}
            axisLine={false}
            tickLine={false}
            width={50}
            tickFormatter={(v: number) => v.toFixed(4)}
          />
          <Tooltip
            contentStyle={{
              background: "#161b22",
              border: "1px solid #30363d",
              borderRadius: 4,
              fontFamily: "monospace",
              fontSize: 10,
            }}
            labelStyle={{ color: "rgba(255,255,255,0.6)" }}
            formatter={(value: any, name: any) => {
              const v = Number(value) || 0;
              if (name === "vpin") return [v.toFixed(3), "VPIN"];
              if (name === "lambda") return [v.toFixed(5), "Kyle λ"];
              return [v, name];
            }}
          />
          <ReferenceLine
            yAxisId="vpin"
            y={0.7}
            stroke="#ef4444"
            strokeDasharray="3 3"
            strokeOpacity={0.5}
          />
          <ReferenceLine
            yAxisId="vpin"
            y={0.5}
            stroke="#f59e0b"
            strokeDasharray="3 3"
            strokeOpacity={0.3}
          />
          <Line
            yAxisId="vpin"
            type="monotone"
            dataKey="vpin"
            stroke="#00e5ff"
            strokeWidth={1.5}
            dot={false}
          />
          <Line
            yAxisId="lambda"
            type="monotone"
            dataKey="lambda"
            stroke="#f59e0b"
            strokeWidth={1}
            dot={false}
            strokeDasharray="4 2"
          />
        </LineChart>
      </ResponsiveContainer>
      <div
        style={{
          display: "flex",
          gap: 16,
          justifyContent: "center",
          marginTop: 6,
          fontSize: 9,
          fontFamily: "monospace",
        }}
      >
        <span style={{ color: "#00e5ff" }}>━ VPIN</span>
        <span style={{ color: "#f59e0b" }}>╌ Kyle λ</span>
        <span style={{ color: "#ef4444" }}>┈ Alert (0.7)</span>
      </div>
    </div>
  );
}
