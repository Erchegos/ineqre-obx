"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

type DataPoint = {
  date: string;
  close: number;
};

type Props = {
  data: DataPoint[];
  height?: number;
};

export default function PriceChart({ data, height = 400 }: Props) {
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

  const formatPrice = (value: number) => {
    return value.toFixed(2);
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
          tickFormatter={formatPrice}
          tick={{
            fill: "rgba(255, 255, 255, 0.6)",
            fontSize: 12,
          }}
          stroke="rgba(255, 255, 255, 0.2)"
          domain={["auto", "auto"]}
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
          formatter={(value: number) => [
            `${value.toFixed(2)}`,
            "Close",
          ]}
          labelFormatter={(label) => {
            // Show full date in tooltip
            return label;
          }}
        />
        <Line
          type="monotone"
          dataKey="close"
          stroke="rgba(59, 130, 246, 1)"
          strokeWidth={2}
          dot={false}
          activeDot={{
            r: 6,
            fill: "rgba(59, 130, 246, 1)",
            stroke: "rgba(255, 255, 255, 0.8)",
            strokeWidth: 2,
          }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}