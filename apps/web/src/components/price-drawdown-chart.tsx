"use client"

import React from "react"
import {
  ResponsiveContainer,
  LineChart,
  Line,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts"

type Point = {
  date: string
  close: number | null
  drawdown: number | null
}

function pct(x: number) {
  return `${(x * 100).toFixed(2)}%`
}

function CustomTooltip(props: any) {
  const { active, payload, label } = props || {}
  if (!active || !payload?.length) return null

  const close = payload.find((p: any) => p?.dataKey === "close")?.value as number | null
  const dd = payload.find((p: any) => p?.dataKey === "drawdown")?.value as number | null

  return (
    <div
      style={{
        background: "rgba(0,0,0,0.85)",
        border: "1px solid rgba(255,255,255,0.12)",
        borderRadius: 10,
        padding: "10px 12px",
        fontSize: 12,
        maxWidth: 260,
      }}
    >
      <div style={{ opacity: 0.8, marginBottom: 6 }}>{label}</div>
      <div style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" }}>
        <div>close: {typeof close === "number" ? close.toFixed(2) : "n/a"}</div>
        <div>drawdown: {typeof dd === "number" ? pct(dd) : "n/a"}</div>
      </div>
    </div>
  )
}

export default function PriceDrawdownChart(props: { data: Point[]; height?: number }) {
  const height = typeof props.height === "number" ? props.height : 320

  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={props.data} margin={{ top: 8, right: 12, left: 0, bottom: 8 }}>
          <CartesianGrid stroke="rgba(255,255,255,0.08)" />
          <XAxis dataKey="date" tick={{ fontSize: 12, fill: "rgba(255,255,255,0.65)" }} />
          <YAxis
            yAxisId="price"
            tick={{ fontSize: 12, fill: "rgba(255,255,255,0.65)" }}
            domain={["auto", "auto"]}
          />
          <YAxis
            yAxisId="dd"
            orientation="right"
            tick={{ fontSize: 12, fill: "rgba(255,255,255,0.65)" }}
            tickFormatter={(v: any) => (typeof v === "number" ? pct(v) : "")}
            domain={[-1, 0]}
          />

          <Tooltip content={<CustomTooltip />} />

          <Area
            type="monotone"
            dataKey="drawdown"
            yAxisId="dd"
            stroke="rgba(255,255,255,0.15)"
            fill="rgba(255,255,255,0.08)"
            isAnimationActive={false}
          />

          <Line
            type="monotone"
            dataKey="close"
            yAxisId="price"
            stroke="rgba(120,180,255,0.95)"
            dot={false}
            strokeWidth={2}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
