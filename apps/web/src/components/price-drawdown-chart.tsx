"use client";

import * as React from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  Area,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  Brush,
} from "recharts";

export type PriceChartPoint = {
  date: string;
  close: number;
  normalized: number;
  drawdown: number;
  volume: number | null;
};

function pct(x: number) {
  return `${(x * 100).toFixed(2)}%`;
}

function num(x: number) {
  return x.toFixed(2);
}

type Mode = "price" | "normalized";

export default function PriceDrawdownChart({ data }: { data: PriceChartPoint[] }) {
  const [mode, setMode] = React.useState<Mode>("price");
  const [showDrawdown, setShowDrawdown] = React.useState(true);
  const [showVolume, setShowVolume] = React.useState(false);

  const hasVolume = React.useMemo(() => data.some((d) => (d.volume ?? 0) > 0), [data]);

  const yLeftKey = mode === "price" ? "close" : "normalized";
  const yLeftLabel = mode === "price" ? "Price" : "Indexed (100)";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex overflow-hidden rounded-lg border border-white/10">
          <button
            className={`px-3 py-1.5 text-sm ${mode === "price" ? "bg-white/10" : "bg-transparent"}`}
            onClick={() => setMode("price")}
            type="button"
          >
            Price
          </button>
          <button
            className={`px-3 py-1.5 text-sm ${mode === "normalized" ? "bg-white/10" : "bg-transparent"}`}
            onClick={() => setMode("normalized")}
            type="button"
          >
            Indexed
          </button>
        </div>

        <label className="flex items-center gap-2 text-sm text-white/80">
          <input
            type="checkbox"
            className="accent-white"
            checked={showDrawdown}
            onChange={(e) => setShowDrawdown(e.target.checked)}
          />
          Drawdown overlay
        </label>

        <label className={`flex items-center gap-2 text-sm ${hasVolume ? "text-white/80" : "text-white/40"}`}>
          <input
            type="checkbox"
            className="accent-white"
            checked={showVolume}
            onChange={(e) => setShowVolume(e.target.checked)}
            disabled={!hasVolume}
          />
          Volume bars
        </label>

        <div className="text-xs text-white/50">
          Controls are client side only, no data refetch.
        </div>
      </div>

      <div className="h-[360px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 10, right: 22, left: 8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.15} />

            <XAxis
              dataKey="date"
              tick={{ fill: "rgba(255,255,255,0.55)", fontSize: 12 }}
              tickMargin={8}
              minTickGap={24}
            />

            <YAxis
              yAxisId="left"
              tick={{ fill: "rgba(255,255,255,0.55)", fontSize: 12 }}
              tickMargin={8}
              width={52}
              domain={["auto", "auto"]}
              label={{
                value: yLeftLabel,
                angle: -90,
                position: "insideLeft",
                fill: "rgba(255,255,255,0.45)",
                fontSize: 12,
              }}
            />

            <YAxis
              yAxisId="right"
              orientation="right"
              tick={{ fill: "rgba(255,255,255,0.55)", fontSize: 12 }}
              tickFormatter={(v) => pct(Number(v))}
              width={56}
              domain={[-1, 0]}
              hide={!showDrawdown}
              label={{
                value: "Drawdown",
                angle: 90,
                position: "insideRight",
                fill: "rgba(255,255,255,0.45)",
                fontSize: 12,
              }}
            />

            <Tooltip
              content={({ active, payload, label }) => {
                if (!active || !payload || !payload.length) return null;

                const p = payload.reduce<Record<string, any>>((acc, item) => {
                  acc[item.dataKey as string] = item.value;
                  return acc;
                }, {});

                const priceVal = mode === "price" ? p.close : p.normalized;
                const ddVal = typeof p.drawdown === "number" ? p.drawdown : null;
                const volVal = typeof p.volume === "number" ? p.volume : null;

                return (
                  <div className="rounded-lg border border-white/15 bg-black/80 px-3 py-2 text-sm">
                    <div className="mb-1 font-mono text-white/80">{label}</div>
                    <div className="space-y-1">
                      <div className="flex gap-2">
                        <span className="text-white/60">{mode === "price" ? "Close" : "Index"}</span>
                        <span className="font-semibold">{num(Number(priceVal))}</span>
                      </div>

                      {showDrawdown && ddVal != null && (
                        <div className="flex gap-2">
                          <span className="text-white/60">Drawdown</span>
                          <span className="font-semibold">{pct(Number(ddVal))}</span>
                        </div>
                      )}

                      {showVolume && volVal != null && (
                        <div className="flex gap-2">
                          <span className="text-white/60">Volume</span>
                          <span className="font-semibold">{Math.round(volVal).toLocaleString()}</span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              }}
            />

            <Legend wrapperStyle={{ color: "rgba(255,255,255,0.65)", fontSize: 12 }} />

            {showVolume && hasVolume && (
              <Bar yAxisId="left" dataKey="volume" name="Volume" opacity={0.25} maxBarSize={18} />
            )}

            <Line
              yAxisId="left"
              type="monotone"
              dataKey={yLeftKey}
              name={mode === "price" ? "Close" : "Indexed"}
              dot={false}
              strokeWidth={2}
            />

            {showDrawdown && (
              <Area yAxisId="right" type="monotone" dataKey="drawdown" name="Drawdown" opacity={0.25} />
            )}

            <Brush
              dataKey="date"
              height={24}
              stroke="rgba(255,255,255,0.35)"
              travellerWidth={10}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="grid gap-2 text-xs text-white/60 sm:grid-cols-3">
        <div className="rounded-lg border border-white/10 bg-white/5 p-2">
          Indexed mode rebases the first observation to 100 to show relative performance.
        </div>
        <div className="rounded-lg border border-white/10 bg-white/5 p-2">
          Drawdown is peak to current loss, always zero or negative.
        </div>
        <div className="rounded-lg border border-white/10 bg-white/5 p-2">
          Brush lets you isolate a sub period for faster pattern recognition.
        </div>
      </div>
    </div>
  );
}
