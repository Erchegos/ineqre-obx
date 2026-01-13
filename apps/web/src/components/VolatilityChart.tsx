"use client";

import { useState } from "react";
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

type VolatilityPoint = {
  date: string;
  historical?: number;
  rolling20?: number;
  rolling60?: number;
  rolling120?: number;
  ewma94?: number;
  ewma97?: number;
  parkinson?: number;
  garmanKlass?: number;
};

type EventMarker = {
  date: string;
  label: string;
};

type Props = {
  data: VolatilityPoint[];
  events?: EventMarker[];
  height?: number;
};

const COLORS = {
  rolling20: "#3b82f6",
  rolling60: "#8b5cf6",
  rolling120: "#ec4899",
  ewma94: "#10b981",
  ewma97: "#f59e0b",
  parkinson: "#ef4444",
  garmanKlass: "#06b6d4",
};

export default function VolatilityChart({ data, events = [], height = 400 }: Props) {
  const [visibleLines, setVisibleLines] = useState<Record<string, boolean>>({
    rolling20: true,
    rolling60: true,
    ewma94: true,
    rolling120: false,
    ewma97: false,
    parkinson: false,
    garmanKlass: false,
  });

  const toggleLine = (key: string) => {
    setVisibleLines(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const formatPercent = (value: number | undefined): string => {
    if (value === undefined || !isFinite(value)) return "";
    return `${(value * 100).toFixed(1)}%`;
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-3">
        {Object.entries({
          rolling20: "20-Day Rolling",
          rolling60: "60-Day Rolling",
          rolling120: "120-Day Rolling",
          ewma94: "EWMA (λ=0.94)",
          ewma97: "EWMA (λ=0.97)",
          parkinson: "Parkinson",
          garmanKlass: "Garman-Klass",
        }).map(([key, label]) => (
          <button
            key={key}
            onClick={() => toggleLine(key)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-all"
            style={{
              backgroundColor: visibleLines[key] ? `${COLORS[key as keyof typeof COLORS]}20` : "rgba(255,255,255,0.05)",
              border: `2px solid ${visibleLines[key] ? COLORS[key as keyof typeof COLORS] : "rgba(255,255,255,0.1)"}`,
              opacity: visibleLines[key] ? 1 : 0.5,
            }}
          >
            <div
              className="w-3 h-3 rounded"
              style={{ backgroundColor: COLORS[key as keyof typeof COLORS] }}
            />
            <span style={{ color: visibleLines[key] ? "white" : "rgba(255,255,255,0.6)" }}>
              {label}
            </span>
          </button>
        ))}
      </div>

      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" opacity={0.1} />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 12 }}
            tickFormatter={(date) => {
              const parts = date.split("-");
              return parts.length >= 2 ? `${parts[1]}/${parts[0].slice(2)}` : date;
            }}
          />
          <YAxis
            tick={{ fontSize: 12 }}
            tickFormatter={formatPercent}
            domain={["auto", "auto"]}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "rgba(0, 0, 0, 0.9)",
              border: "1px solid rgba(255, 255, 255, 0.2)",
              borderRadius: "8px",
            }}
            formatter={formatPercent}
            labelStyle={{ color: "rgba(255, 255, 255, 0.7)" }}
          />

          {events.map((event) => (
            <ReferenceLine
              key={event.date}
              x={event.date}
              stroke="rgba(255, 255, 255, 0.3)"
              strokeDasharray="5 5"
              label={{
                value: event.label,
                position: "top",
                fill: "rgba(255, 255, 255, 0.7)",
                fontSize: 11,
              }}
            />
          ))}

          {visibleLines.rolling20 && (
            <Line
              type="monotone"
              dataKey="rolling20"
              stroke={COLORS.rolling20}
              strokeWidth={2}
              dot={false}
              name="20-Day"
            />
          )}
          {visibleLines.rolling60 && (
            <Line
              type="monotone"
              dataKey="rolling60"
              stroke={COLORS.rolling60}
              strokeWidth={2}
              dot={false}
              name="60-Day"
            />
          )}
          {visibleLines.rolling120 && (
            <Line
              type="monotone"
              dataKey="rolling120"
              stroke={COLORS.rolling120}
              strokeWidth={2}
              dot={false}
              name="120-Day"
            />
          )}
          {visibleLines.ewma94 && (
            <Line
              type="monotone"
              dataKey="ewma94"
              stroke={COLORS.ewma94}
              strokeWidth={2}
              dot={false}
              name="EWMA 0.94"
            />
          )}
          {visibleLines.ewma97 && (
            <Line
              type="monotone"
              dataKey="ewma97"
              stroke={COLORS.ewma97}
              strokeWidth={2}
              dot={false}
              name="EWMA 0.97"
            />
          )}
          {visibleLines.parkinson && (
            <Line
              type="monotone"
              dataKey="parkinson"
              stroke={COLORS.parkinson}
              strokeWidth={2}
              dot={false}
              name="Parkinson"
            />
          )}
          {visibleLines.garmanKlass && (
            <Line
              type="monotone"
              dataKey="garmanKlass"
              stroke={COLORS.garmanKlass}
              strokeWidth={2}
              dot={false}
              name="Garman-Klass"
            />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}