"use client";

import * as React from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type DrawdownRow = {
  date: string; // YYYY-MM-DD
  drawdown?: number | string | null; // negative values
};

function toNum(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function formatDateShort(d: string) {
  return (d ?? "").slice(0, 10);
}

function formatPct(v: number) {
  return new Intl.NumberFormat(undefined, {
    style: "percent",
    maximumFractionDigits: 2,
  }).format(v);
}

function useMeasuredSize<T extends HTMLElement>() {
  const ref = React.useRef<T | null>(null);
  const [size, setSize] = React.useState({ w: 0, h: 0 });

  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    const setFromRect = (rect: DOMRectReadOnly | DOMRect) => {
      const w = Math.floor(rect.width);
      const h = Math.floor(rect.height);
      if (w > 0 && h > 0) setSize({ w, h });
    };

    setFromRect(el.getBoundingClientRect());

    const ro = new ResizeObserver((entries) => {
      const cr = entries[0]?.contentRect;
      if (!cr) return;
      setFromRect(cr);
    });

    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return { ref, size };
}

export default function PriceDrawdownChart(props: {
  data: DrawdownRow[];
  height?: number;
  className?: string;
}) {
  const height = props.height ?? 240;
  const { ref, size } = useMeasuredSize<HTMLDivElement>();

  const chartData = React.useMemo(() => {
    return (props.data ?? [])
      .map((p) => {
        const dd = toNum(p.drawdown);
        return { date: p.date, drawdown: dd };
      })
      .filter((p) => p.date && p.drawdown !== null) as Array<{ date: string; drawdown: number }>;
  }, [props.data]);

  return (
    <div
      ref={ref}
      className={props.className}
      style={{ width: "100%", height, minHeight: height }}
    >
      {size.w > 20 && size.h > 20 ? (
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 8, right: 12, left: 6, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
            <XAxis
              dataKey="date"
              tickFormatter={formatDateShort}
              minTickGap={28}
              tick={{ fontSize: 12 }}
            />
            <YAxis width={64} tick={{ fontSize: 12 }} tickFormatter={(v) => formatPct(Number(v))} />
            <Tooltip
              labelFormatter={(label: any) => formatDateShort(String(label))}
              formatter={(value: any) => {
                const n = toNum(value);
                return n === null ? "n/a" : formatPct(n);
              }}
            />
            <Area type="monotone" dataKey="drawdown" strokeWidth={2} isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      ) : (
        <div style={{ width: "100%", height: "100%" }} />
      )}
    </div>
  );
}
