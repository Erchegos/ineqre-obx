"use client";

import { useMemo, useState } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";

interface PortfolioPerformanceChartProps {
  data: {
    dates: string[];
    portfolio: number[];
    benchmark: number[];
    stocks: Record<string, number[]>;
  };
  tickers: string[];
  sectorColors: Record<string, string>;
  sectors: Record<string, string>;
  height?: number;
}

const TIMEFRAMES: { label: string; days: number }[] = [
  { label: "3M", days: 63 },
  { label: "6M", days: 126 },
  { label: "1Y", days: 252 },
  { label: "2Y", days: 504 },
  { label: "ALL", days: 0 },
];

const PORTFOLIO_COLOR = "#3b82f6";
const BENCHMARK_COLOR = "#6b7280";

export default function PortfolioPerformanceChart({
  data,
  tickers,
  sectorColors,
  sectors,
  height = 400,
}: PortfolioPerformanceChartProps) {
  const [timeframe, setTimeframe] = useState("1Y");
  const [hiddenLines, setHiddenLines] = useState<Set<string>>(new Set());

  const chartData = useMemo(() => {
    const tf = TIMEFRAMES.find(t => t.label === timeframe) || TIMEFRAMES[4];
    const len = data.dates.length;
    const start = tf.days > 0 ? Math.max(0, len - tf.days) : 0;

    // Re-base cumulative returns to start from 0 at the selected window
    const basePort = start > 0 ? data.portfolio[start - 1] || 0 : 0;
    const baseBench = start > 0 && data.benchmark.length > 0 ? data.benchmark[start - 1] || 0 : 0;
    const baseStocks: Record<string, number> = {};
    for (const t of tickers) {
      baseStocks[t] = start > 0 && data.stocks[t] ? data.stocks[t][start - 1] || 0 : 0;
    }

    const result = [];
    for (let i = start; i < len; i++) {
      const point: Record<string, string | number> = {
        date: data.dates[i],
        portfolio: data.portfolio[i] - basePort,
      };
      if (data.benchmark.length > i) {
        point.benchmark = data.benchmark[i] - baseBench;
      }
      for (const t of tickers) {
        if (data.stocks[t] && data.stocks[t].length > i) {
          point[t] = data.stocks[t][i] - (baseStocks[t] || 0);
        }
      }
      result.push(point);
    }
    return result;
  }, [data, tickers, timeframe]);

  const toggleLine = (key: string) => {
    setHiddenLines(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const formatDate = (d: string) => {
    if (!d) return "";
    const parts = d.split("-");
    return parts.length >= 3 ? `${parts[1]}/${parts[2].substring(0, 2)}` : d;
  };

  const btnStyle = (active: boolean): React.CSSProperties => ({
    padding: "3px 10px",
    background: active ? "#1f6feb" : "#21262d",
    border: "1px solid " + (active ? "#1f6feb" : "#30363d"),
    borderRadius: 3,
    color: active ? "#fff" : "rgba(255,255,255,0.5)",
    fontSize: 10,
    fontFamily: "monospace",
    fontWeight: 700,
    cursor: "pointer",
    letterSpacing: "0.05em",
  });

  return (
    <div>
      {/* Timeframe buttons */}
      <div style={{ display: "flex", gap: 4, marginBottom: 10 }}>
        {TIMEFRAMES.map(tf => (
          <button
            key={tf.label}
            onClick={() => setTimeframe(tf.label)}
            style={btnStyle(timeframe === tf.label)}
          >
            {tf.label}
          </button>
        ))}
      </div>

      {/* Stock legend (clickable to toggle) */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
        {tickers.map(t => {
          const color = sectorColors[sectors[t] || "Unknown"] || "#6b7280";
          const hidden = hiddenLines.has(t);
          return (
            <button
              key={t}
              onClick={() => toggleLine(t)}
              style={{
                padding: "2px 6px",
                background: hidden ? "transparent" : `${color}20`,
                border: `1px solid ${hidden ? "#30363d" : color}`,
                borderRadius: 3,
                color: hidden ? "rgba(255,255,255,0.3)" : color,
                fontSize: 9,
                fontFamily: "monospace",
                fontWeight: 700,
                cursor: "pointer",
                textDecoration: hidden ? "line-through" : "none",
                opacity: hidden ? 0.4 : 1,
              }}
            >
              {t}
            </button>
          );
        })}
      </div>

      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={chartData} margin={{ top: 5, right: 10, bottom: 5, left: 10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#21262d" />
          <XAxis
            dataKey="date"
            tickFormatter={formatDate}
            stroke="#30363d"
            tick={{ fontSize: 9, fontFamily: "monospace", fill: "rgba(255,255,255,0.4)" }}
            interval="preserveStartEnd"
          />
          <YAxis
            tickFormatter={v => `${v >= 0 ? "+" : ""}${v.toFixed(0)}%`}
            stroke="#30363d"
            tick={{ fontSize: 9, fontFamily: "monospace", fill: "rgba(255,255,255,0.4)" }}
            width={55}
          />
          <Tooltip
            contentStyle={{
              background: "#161b22",
              border: "1px solid #30363d",
              borderRadius: 4,
              fontFamily: "monospace",
              fontSize: 11,
            }}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            formatter={(value: any, name: any) => [
              `${(value ?? 0) >= 0 ? "+" : ""}${(value ?? 0).toFixed(2)}%`,
              name === "portfolio" ? "Portfolio" : name === "benchmark" ? "OBX" : (name ?? ""),
            ]}
            labelFormatter={(label: string) => label}
          />
          <Legend
            verticalAlign="top"
            align="right"
            wrapperStyle={{ fontSize: 10, fontFamily: "monospace" }}
            formatter={(value: string) =>
              value === "portfolio" ? "Portfolio" : value === "benchmark" ? "OBX" : value
            }
          />

          {/* Individual stock lines */}
          {tickers.map(t => {
            if (hiddenLines.has(t)) return null;
            const color = sectorColors[sectors[t] || "Unknown"] || "#6b7280";
            return (
              <Line
                key={t}
                type="monotone"
                dataKey={t}
                stroke={color}
                strokeWidth={0.8}
                strokeOpacity={0.4}
                dot={false}
                isAnimationActive={false}
                legendType="none"
              />
            );
          })}

          {/* OBX benchmark */}
          {data.benchmark.length > 0 && !hiddenLines.has("benchmark") && (
            <Line
              type="monotone"
              dataKey="benchmark"
              stroke={BENCHMARK_COLOR}
              strokeWidth={1}
              strokeDasharray="4 4"
              dot={false}
              isAnimationActive={false}
            />
          )}

          {/* Portfolio total */}
          <Line
            type="monotone"
            dataKey="portfolio"
            stroke={PORTFOLIO_COLOR}
            strokeWidth={2.5}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
