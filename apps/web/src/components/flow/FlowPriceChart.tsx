"use client";

import {
  ComposedChart,
  Line,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceArea,
} from "recharts";

type Bar = {
  bar_open_ts: string;
  close: number;
  volume: number;
  buy_volume: number;
  sell_volume: number;
  ofi: number;
};

type Signal = {
  ts: string;
  regime: string;
};

const REGIME_COLORS: Record<string, string> = {
  informed_buying: "rgba(16,185,129,0.08)",
  informed_selling: "rgba(239,68,68,0.08)",
  market_making: "rgba(59,130,246,0.06)",
  retail: "rgba(245,158,11,0.06)",
  neutral: "transparent",
};

function formatTime(ts: string): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export default function FlowPriceChart({
  bars,
  signals,
}: {
  bars: Bar[];
  signals: Signal[];
}) {
  if (!bars.length) {
    return (
      <div
        style={{
          height: 300,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "rgba(255,255,255,0.4)",
          fontSize: 12,
          fontFamily: "monospace",
        }}
      >
        No bar data available
      </div>
    );
  }

  // Merge bars with cumulative OFI
  let cumulativeOfi = 0;
  const data = bars.map((b) => {
    cumulativeOfi += b.ofi || 0;
    return {
      time: formatTime(b.bar_open_ts),
      ts: b.bar_open_ts,
      price: b.close,
      ofi: cumulativeOfi,
      volume: b.volume,
      buyVol: b.buy_volume,
      sellVol: b.sell_volume,
    };
  });

  // Build regime bands from signals
  const regimeBands: { x1: string; x2: string; color: string }[] = [];
  if (signals.length > 1) {
    for (let i = 0; i < signals.length - 1; i++) {
      const regime = signals[i].regime;
      if (regime && regime !== "neutral") {
        regimeBands.push({
          x1: formatTime(signals[i].ts),
          x2: formatTime(signals[i + 1].ts),
          color: REGIME_COLORS[regime] || "transparent",
        });
      }
    }
  }

  const prices = data.map((d) => d.price).filter(Boolean);
  const minPrice = prices.length ? Math.min(...prices) * 0.999 : 0;
  const maxPrice = prices.length ? Math.max(...prices) * 1.001 : 100;

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
        PRICE + CUMULATIVE OFI
      </div>
      <ResponsiveContainer width="100%" height={280}>
        <ComposedChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
          {regimeBands.map((band, i) => (
            <ReferenceArea
              key={i}
              x1={band.x1}
              x2={band.x2}
              fill={band.color}
              strokeOpacity={0}
              yAxisId="price"
            />
          ))}
          <XAxis
            dataKey="time"
            tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 9, fontFamily: "monospace" }}
            axisLine={{ stroke: "#21262d" }}
            tickLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            yAxisId="price"
            domain={[minPrice, maxPrice]}
            tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 9, fontFamily: "monospace" }}
            axisLine={false}
            tickLine={false}
            width={60}
            tickFormatter={(v: number) => v.toFixed(1)}
          />
          <YAxis
            yAxisId="ofi"
            orientation="right"
            tick={{ fill: "rgba(0,229,255,0.5)", fontSize: 9, fontFamily: "monospace" }}
            axisLine={false}
            tickLine={false}
            width={55}
            tickFormatter={(v: number) => `${(v / 1000).toFixed(0)}K`}
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
              if (name === "price") return [v.toFixed(2), "Price"];
              if (name === "ofi") return [`${(v / 1000).toFixed(1)}K`, "Cum OFI"];
              return [v, name];
            }}
          />
          <Line
            yAxisId="price"
            type="monotone"
            dataKey="price"
            stroke="#e6edf3"
            strokeWidth={1.5}
            dot={false}
          />
          <Area
            yAxisId="ofi"
            type="monotone"
            dataKey="ofi"
            stroke="#00e5ff"
            fill="rgba(0,229,255,0.08)"
            strokeWidth={1}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
