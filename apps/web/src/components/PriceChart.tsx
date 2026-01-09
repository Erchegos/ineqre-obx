"use client";

import * as React from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type PriceRow = {
  date: string; // YYYY-MM-DD
  close?: number | string | null;
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

function formatNumber(v: number) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(v);
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

    // Initial measure
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

export default function PriceChart(props: {
  data: PriceRow[];
  height?: number;
  className?: string;
}) {
  const height = props.height ?? 320;
  const { ref, size } = useMeasuredSize<HTMLDivElement>();

  const chartData = React.useMemo(() => {
    return (props.data ?? [])
      .map((p) => {
        const close = toNum(p.close);
        return { date: p.date, close };
      })
      .filter((p) => p.date && p.close !== null) as Array<{ date: string; close: number }>;
  }, [props.data]);

  return (
    <div
      ref={ref}
      className={props.className}
      style={{ width: "100%", height, minHeight: height }}
    >
      {size.w > 20 && size.h > 20 ? (
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 8, right: 12, left: 6, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
            <XAxis
              dataKey="date"
              tickFormatter={formatDateShort}
              minTickGap={28}
              tick={{ fontSize: 12 }}
            />
            <YAxis
              width={56}
              tick={{ fontSize: 12 }}
              tickFormatter={(v) => formatNumber(Number(v))}
            />
            <Tooltip
              labelFormatter={(label: any) => formatDateShort(String(label))}
              formatter={(value: any) => {
                const n = toNum(value);
                return n === null ? "n/a" : formatNumber(n);
              }}
            />
            <Line type="monotone" dataKey="close" dot={false} strokeWidth={2} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      ) : (
        <div style={{ width: "100%", height: "100%" }} />
      )}
    </div>
  );
}
