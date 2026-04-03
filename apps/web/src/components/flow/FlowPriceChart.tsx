"use client";

import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";

type Tick = {
  ts: string;
  price: number;
  size: number;
  side: number; // 1=buy, -1=sell, 0=unknown
};

// Build 5-minute OHLCV bars + running buy/sell imbalance from raw ticks
function buildBars(ticks: Tick[]) {
  if (ticks.length === 0) return [];

  const BAR_MS = 5 * 60 * 1000;
  const barMap = new Map<number, {
    time: string; tsMs: number;
    open: number; high: number; low: number; close: number;
    buyVol: number; sellVol: number; totalVol: number;
    ofiBar: number; // buy - sell for this bar
  }>();

  for (const tick of ticks) {
    const tsMs = new Date(tick.ts).getTime();
    const barKey = Math.floor(tsMs / BAR_MS) * BAR_MS;
    const barD = new Date(barKey);
    const time = `${String(barD.getUTCHours() + 2).padStart(2, "0")}:${String(barD.getUTCMinutes()).padStart(2, "0")}`; // Oslo = UTC+2 (CEST)

    if (!barMap.has(barKey)) {
      barMap.set(barKey, {
        time, tsMs: barKey,
        open: tick.price, high: tick.price, low: tick.price, close: tick.price,
        buyVol: 0, sellVol: 0, totalVol: 0, ofiBar: 0,
      });
    }
    const b = barMap.get(barKey)!;
    b.high = Math.max(b.high, tick.price);
    b.low = Math.min(b.low, tick.price);
    b.close = tick.price;
    b.totalVol += tick.size;
    if (tick.side === 1) { b.buyVol += tick.size; b.ofiBar += tick.size; }
    else if (tick.side === -1) { b.sellVol += tick.size; b.ofiBar -= tick.size; }
  }

  const sorted = [...barMap.values()].sort((a, b) => a.tsMs - b.tsMs);

  // Cumulative OFI
  let cumOfi = 0;
  return sorted.map(b => {
    cumOfi += b.ofiBar;
    const buyPct = b.totalVol > 0 ? (b.buyVol / b.totalVol) * 100 : 50;
    return { ...b, cumOfi, buyPct };
  });
}

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;

  const buyPct = d.buyPct ?? 50;
  const isGreen = buyPct >= 55;
  const isRed = buyPct <= 45;

  return (
    <div style={{
      background: "#161b22", border: "1px solid #30363d", borderRadius: 6,
      padding: "10px 14px", fontFamily: "monospace", fontSize: 10, lineHeight: 1.8,
    }}>
      <div style={{ fontWeight: 700, color: "#fff", marginBottom: 6 }}>{label}</div>
      <div style={{ color: "rgba(255,255,255,0.7)" }}>
        Price: <strong style={{ color: "#e6edf3" }}>{d.close?.toFixed(2)}</strong>
      </div>
      <div style={{ color: "rgba(255,255,255,0.7)" }}>
        Volume: <strong style={{ color: "#e6edf3" }}>{(d.totalVol || 0).toLocaleString()} shares</strong>
      </div>
      <div style={{ color: isGreen ? "#10b981" : isRed ? "#ef4444" : "rgba(255,255,255,0.7)" }}>
        Buyers: <strong>{buyPct.toFixed(0)}%</strong>
        {isGreen ? " — buyers in control" : isRed ? " — sellers in control" : " — balanced"}
      </div>
      <div style={{ color: "rgba(255,255,255,0.7)" }}>
        Net flow: <strong style={{ color: d.cumOfi > 0 ? "#10b981" : "#ef4444" }}>
          {d.cumOfi > 0 ? "+" : ""}{(d.cumOfi / 1000).toFixed(0)}K shares net buying
        </strong>
      </div>
      <div style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", marginTop: 4 }}>
        Cumulative OFI rises when buyers outweigh sellers
      </div>
    </div>
  );
}

export default function FlowPriceChart({ ticks }: { ticks: Tick[] }) {
  const bars = buildBars(ticks);

  if (bars.length === 0) {
    return (
      <div style={{
        height: 300, display: "flex", alignItems: "center", justifyContent: "center",
        color: "rgba(255,255,255,0.3)", fontSize: 12, fontFamily: "monospace",
      }}>
        No tick data — run flow:fetch to load today&apos;s data
      </div>
    );
  }

  const prices = bars.map(b => b.close);
  const minPrice = Math.min(...prices) * 0.9985;
  const maxPrice = Math.max(...prices) * 1.0015;

  const ofiVals = bars.map(b => b.cumOfi);
  const maxAbsOfi = Math.max(...ofiVals.map(Math.abs), 1);
  const ofiDomain = [-maxAbsOfi * 1.1, maxAbsOfi * 1.1];

  const maxVol = Math.max(...bars.map(b => b.totalVol), 1);

  return (
    <div>
      {/* Legend */}
      <div style={{ display: "flex", gap: 16, marginBottom: 10, fontSize: 10, color: "rgba(255,255,255,0.45)", fontFamily: "monospace", flexWrap: "wrap" }}>
        <span><span style={{ color: "#e6edf3" }}>—</span> Price</span>
        <span><span style={{ color: "#00e5ff" }}>—</span> Net buy pressure (rises when buyers outweigh sellers)</span>
        <span><span style={{ color: "#10b981", opacity: 0.7 }}>█</span> Buyer volume</span>
        <span><span style={{ color: "#ef4444", opacity: 0.7 }}>█</span> Seller volume</span>
      </div>

      <ResponsiveContainer width="100%" height={320}>
        <ComposedChart data={bars} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}
          barCategoryGap="5%">
          <XAxis
            dataKey="time"
            tick={{ fill: "rgba(255,255,255,0.35)", fontSize: 9, fontFamily: "monospace" }}
            axisLine={{ stroke: "#21262d" }}
            tickLine={false}
            interval={Math.floor(bars.length / 8)}
          />
          {/* Price axis (left) */}
          <YAxis
            yAxisId="price"
            domain={[minPrice, maxPrice]}
            tick={{ fill: "rgba(255,255,255,0.35)", fontSize: 9, fontFamily: "monospace" }}
            axisLine={false}
            tickLine={false}
            width={52}
            tickFormatter={(v: number) => v.toFixed(1)}
          />
          {/* OFI axis (right) */}
          <YAxis
            yAxisId="ofi"
            orientation="right"
            domain={ofiDomain}
            tick={{ fill: "rgba(0,229,255,0.4)", fontSize: 9, fontFamily: "monospace" }}
            axisLine={false}
            tickLine={false}
            width={50}
            tickFormatter={(v: number) => `${(v / 1000).toFixed(0)}K`}
          />
          {/* Volume axis (hidden — just for stacked bars) */}
          <YAxis yAxisId="vol" hide domain={[0, maxVol * 4]} />

          <ReferenceLine yAxisId="ofi" y={0} stroke="rgba(255,255,255,0.1)" strokeDasharray="3 3" />

          <Tooltip content={<CustomTooltip />} />

          {/* Buy volume bars (green, bottom of chart) */}
          <Bar yAxisId="vol" dataKey="buyVol" fill="#10b981" opacity={0.5} stackId="vol" radius={[0,0,0,0]} />
          {/* Sell volume bars (red, stacked on top) */}
          <Bar yAxisId="vol" dataKey="sellVol" fill="#ef4444" opacity={0.5} stackId="vol" radius={[0,0,0,0]} />

          {/* Net buy pressure line (cyan, right axis) */}
          <Line
            yAxisId="ofi"
            type="monotone"
            dataKey="cumOfi"
            stroke="#00e5ff"
            strokeWidth={2}
            dot={false}
            strokeDasharray="none"
          />
          {/* Price line (white, left axis) */}
          <Line
            yAxisId="price"
            type="monotone"
            dataKey="close"
            stroke="#e6edf3"
            strokeWidth={2}
            dot={false}
          />
        </ComposedChart>
      </ResponsiveContainer>

      <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", marginTop: 6, lineHeight: 1.6 }}>
        <strong style={{ color: "rgba(255,255,255,0.5)" }}>How to read this:</strong>{" "}
        The white line is the stock price. Green/red bars at the bottom show how much buying vs selling happened each 5 minutes — taller green = more buyers. The cyan line is cumulative net buying: when it rises, there have been more buyers than sellers overall. When price falls but the cyan line stays up, buyers are quietly absorbing the dip.
      </div>
    </div>
  );
}
