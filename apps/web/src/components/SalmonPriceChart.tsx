"use client";

import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";

type Props = {
  data: Array<{ date: string; price: number }>;
  stats?: {
    latest: number;
    high52w: number;
    low52w: number;
    avg: number;
    changePct: number;
  };
};

export default function SalmonPriceChart({ data, stats }: Props) {
  if (!data || data.length === 0) {
    return (
      <div style={{ padding: 24, color: "#8b949e", textAlign: "center" }}>
        No salmon price data available
      </div>
    );
  }

  return (
    <div>
      {stats && (
        <div style={{ display: "flex", gap: 16, marginBottom: 12, flexWrap: "wrap" }}>
          <div style={{ fontSize: 12, color: "#8b949e" }}>
            52W High: <span style={{ color: "#22c55e" }}>NOK {stats.high52w.toFixed(2)}</span>
          </div>
          <div style={{ fontSize: 12, color: "#8b949e" }}>
            52W Low: <span style={{ color: "#ef4444" }}>NOK {stats.low52w.toFixed(2)}</span>
          </div>
          <div style={{ fontSize: 12, color: "#8b949e" }}>
            Average: <span style={{ color: "#c9d1d9" }}>NOK {stats.avg.toFixed(2)}</span>
          </div>
          <div style={{ fontSize: 12, color: "#8b949e" }}>
            YTD: <span style={{ color: stats.changePct >= 0 ? "#22c55e" : "#ef4444" }}>
              {stats.changePct >= 0 ? "+" : ""}{stats.changePct.toFixed(1)}%
            </span>
          </div>
        </div>
      )}
      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={data} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
          <XAxis
            dataKey="date"
            tick={{ fill: "#8b949e", fontSize: 10 }}
            tickFormatter={(d) => {
              const dt = new Date(d);
              return `${dt.getDate()}/${dt.getMonth() + 1}`;
            }}
            interval={Math.floor(data.length / 8)}
            axisLine={{ stroke: "#30363d" }}
            tickLine={false}
          />
          <YAxis
            tick={{ fill: "#8b949e", fontSize: 10 }}
            domain={["auto", "auto"]}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v) => `${v}`}
          />
          {stats && (
            <ReferenceLine
              y={stats.avg}
              stroke="#484f58"
              strokeDasharray="4 4"
              label={{ value: "Avg", fill: "#484f58", fontSize: 10, position: "right" }}
            />
          )}
          <Tooltip
            contentStyle={{
              background: "#161b22",
              border: "1px solid #30363d",
              borderRadius: 6,
              fontSize: 12,
            }}
            labelStyle={{ color: "#8b949e" }}
            formatter={(v) => [`NOK ${(v as number).toFixed(2)}/kg`, "Salmon"]}
            labelFormatter={(d) => new Date(d).toLocaleDateString("en-GB")}
          />
          <Line
            type="monotone"
            dataKey="price"
            stroke="#f97316"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, fill: "#f97316" }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
