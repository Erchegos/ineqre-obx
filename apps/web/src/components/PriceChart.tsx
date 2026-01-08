"use client"

import React from "react"
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts"

export type SeriesKey = "close" | "open" | "high" | "low"

export type PriceChartDatum = {
  date: string
} & Partial<Record<SeriesKey, number | null>>

function CustomTooltip(props: any) {
  const { active, payload, label } = props || {}
  if (!active || !payload?.length) return null

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
        {payload.map((p: any) => {
          const name = String(p?.name ?? p?.dataKey ?? "")
          const v = p?.value
          return (
            <div key={name}>
              {name}: {typeof v === "number" ? v.toFixed(2) : "n/a"}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function PriceChart(props: {
  data: PriceChartDatum[]
  height?: number
  series?: SeriesKey[]
}) {
  const height = typeof props.height === "number" ? props.height : 320
  const series = props.series?.length ? props.series : (["close"] as SeriesKey[])

  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={props.data} margin={{ top: 8, right: 12, left: 0, bottom: 8 }}>
          <CartesianGrid stroke="rgba(255,255,255,0.08)" />
          <XAxis dataKey="date" tick={{ fontSize: 12, fill: "rgba(255,255,255,0.65)" }} />
          <YAxis tick={{ fontSize: 12, fill: "rgba(255,255,255,0.65)" }} domain={["auto", "auto"]} />
          <Tooltip content={<CustomTooltip />} />

          {series.map((key) => (
            <Line
              key={key}
              type="monotone"
              dataKey={key}
              dot={false}
              strokeWidth={2}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
