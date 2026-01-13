"use client";

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

type DataPoint = {
  date: string;
  drawdown: number;
};

type Props = {
  data: DataPoint[];
  height?: number;
};

export default function PriceDrawdownChart({ data, height = 280 }: Props) {
  const formatDate = (dateStr: string) => {
    // Parse date string (YYYY-MM-DD)
    const parts = dateStr.split("-");
    if (parts.length === 3) {
      const month = parts[1];
      const year = parts[0].slice(2); // Last 2 digits of year
      return `${month}/${year}`;
    }
    return dateStr;
  };

  const formatPercent = (value: number) => {
    return `${(value * 100).toFixed(1)}%`;
  };

  // Calculate tick interval to show ~6-8 dates
  const tickInterval = Math.floor(data.length / 7);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart
        data={data}
        margin={{ top: 10, right: 30, left: 10, bottom: 20 }}
      >
        <CartesianGrid
          strokeDasharray="3 3"
          stroke="rgba(255, 255, 255, 0.1)"
          strokeOpacity={0.5}
        />
        <XAxis
          dataKey="date"
          tickFormatter={formatDate}
          interval={tickInterval}
          angle={-45}
          textAnchor="end"
          height={60}
          tick={{
            fill: "rgba(255, 255, 255, 0.6)",
            fontSize: 12,
          }}
          stroke="rgba(255, 255, 255, 0.2)"
        />
        <YAxis
          tickFormatter={formatPercent}
          tick={{
            fill: "rgba(255, 255, 255, 0.6)",
            fontSize: 12,
          }}
          stroke="rgba(255, 255, 255, 0.2)"
          domain={["auto", 0]}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: "rgba(0, 0, 0, 0.92)",
            border: "1px solid rgba(255, 255, 255, 0.2)",
            borderRadius: "6px",
            padding: "8px 12px",
            boxShadow: "0 4px 12px rgba(0, 0, 0, 0.5)",
          }}
          labelStyle={{
            color: "rgba(255, 255, 255, 0.7)",
            fontSize: 12,
            marginBottom: 4,
          }}
          itemStyle={{
            color: "rgba(255, 255, 255, 0.95)",
            fontSize: 13,
            fontWeight: 500,
          }}
          formatter={(value: number | undefined) => {
            if (value === undefined) return ["", "Drawdown"];
            return [formatPercent(value), "Drawdown"];
          }}
        />
        <ReferenceLine
          y={0}
          stroke="rgba(255, 255, 255, 0.3)"
          strokeDasharray="3 3"
        />
        <Line
          type="monotone"
          dataKey="drawdown"
          stroke="rgba(239, 68, 68, 1)"
          strokeWidth={2}
          dot={false}
          activeDot={{
            r: 6,
            fill: "rgba(239, 68, 68, 1)",
            stroke: "rgba(255, 255, 255, 0.8)",
            strokeWidth: 2,
          }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}