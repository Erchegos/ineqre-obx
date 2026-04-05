"use client";

import { useState } from "react";

type Iceberg = {
  detected_at: string;
  start_ts?: string;
  end_ts?: string;
  direction: number;
  total_volume: number;
  trade_count: number;
  avg_trade_size: number;
  median_trade_size?: number;
  price_range_bps?: number;
  vwap: number;
  est_block_pct: number;
  detection_method: string;
  confidence: number;
};

function formatTime(ts: string): string {
  const d = new Date(ts);
  // Display in Oslo time (UTC+2 CEST)
  const oslo = new Date(d.getTime() + 2 * 3600 * 1000);
  return `${oslo.toLocaleDateString("en-GB", { day: "2-digit", month: "short" })} ${String(oslo.getUTCHours()).padStart(2, "0")}:${String(oslo.getUTCMinutes()).padStart(2, "0")}`;
}

function fmtVol(v: number) {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1000) return `${(v / 1000).toFixed(0)}K`;
  return String(v);
}

// est_block_pct is stored as a fraction of ADV (e.g. 1.15 = 1.15% of ADV)
// Cap display at 100% since values > 100 indicate ADV estimate was unreliable
function fmtBlockPct(v: number): string {
  if (v > 100) return ">100% ADV";
  return `${v.toFixed(1)}% ADV`;
}

export default function IcebergCard({ detection }: { detection: Iceberg }) {
  const [expanded, setExpanded] = useState(false);
  const dirLabel = detection.direction === 1 ? "BUY" : detection.direction === -1 ? "SELL" : "UNK";
  const dirColor = detection.direction === 1 ? "#10b981" : detection.direction === -1 ? "#ef4444" : "#6b7280";

  const conf = detection.confidence;
  const confLabel = conf >= 0.7 ? "HIGH CONF" : conf >= 0.5 ? "MED CONF" : "LOW CONF";
  const confColor = conf >= 0.7 ? "#10b981" : conf >= 0.5 ? "#f59e0b" : "rgba(255,255,255,0.3)";

  // What makes this an iceberg — plain English
  const uniformity = detection.avg_trade_size > 0 && detection.median_trade_size != null
    ? Math.abs(detection.avg_trade_size - detection.median_trade_size) / detection.avg_trade_size
    : null;
  const isUniform = uniformity != null && uniformity < 0.15;
  const isTightRange = detection.price_range_bps != null && detection.price_range_bps < 5;

  const signal = isUniform
    ? `${detection.trade_count} trades all ~${detection.avg_trade_size.toFixed(0)} shares — suspiciously uniform`
    : isTightRange
    ? `${detection.trade_count} trades in a ${detection.price_range_bps!.toFixed(1)}bps price range — algo footprint`
    : `${detection.trade_count} trades clustered in time — coordinated execution`;

  return (
    <div
      style={{
        background: "#0d1117",
        border: `1px solid ${expanded ? dirColor + "40" : "#21262d"}`,
        borderLeft: `3px solid ${dirColor}`,
        borderRadius: 6,
        padding: "10px 12px",
        cursor: "pointer",
        transition: "border-color 0.15s",
      }}
      onClick={() => setExpanded(!expanded)}
      onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.borderColor = dirColor + "60"}
      onMouseLeave={e => !expanded && ((e.currentTarget as HTMLDivElement).style.borderColor = "#21262d")}
    >
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {/* Direction badge */}
        <span style={{
          fontSize: 9, fontWeight: 800, color: dirColor, letterSpacing: "0.08em",
          background: `${dirColor}15`, border: `1px solid ${dirColor}30`,
          borderRadius: 3, padding: "2px 6px", fontFamily: "monospace", flexShrink: 0,
        }}>{dirLabel}</span>

        {/* Time */}
        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", fontFamily: "monospace" }}>
          {formatTime(detection.start_ts || detection.detected_at)}
        </span>

        <div style={{ flex: 1 }} />

        {/* Volume */}
        <span style={{ fontSize: 11, fontWeight: 700, color: "#e6edf3", fontFamily: "monospace" }}>
          {fmtVol(detection.total_volume)} shs
        </span>

        {/* Confidence */}
        <span style={{
          fontSize: 8, fontWeight: 700, color: confColor,
          letterSpacing: "0.06em", fontFamily: "monospace", flexShrink: 0,
        }}>{confLabel}</span>

        <span style={{
          fontSize: 9, color: "rgba(255,255,255,0.25)",
          transform: expanded ? "rotate(180deg)" : "rotate(0)", transition: "transform 0.2s",
        }}>▼</span>
      </div>

      {/* Signal line — always visible */}
      <div style={{ marginTop: 5, fontSize: 10, color: "rgba(255,255,255,0.38)", fontFamily: "monospace", lineHeight: 1.4 }}>
        {signal}
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid #21262d" }}>
          {/* Stats grid */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6, marginBottom: 10 }}>
            {[
              { label: "TRADES", value: String(detection.trade_count) },
              { label: "AVG SIZE", value: detection.avg_trade_size.toFixed(0) },
              { label: "VWAP", value: detection.vwap > 0 ? detection.vwap.toFixed(2) : "—" },
              { label: "PRICE RNG", value: detection.price_range_bps != null ? `${detection.price_range_bps.toFixed(1)}bps` : "—" },
            ].map(m => (
              <div key={m.label} style={{ textAlign: "center", background: "#161b22", borderRadius: 4, padding: "5px 4px" }}>
                <div style={{ fontSize: 7, color: "rgba(255,255,255,0.35)", letterSpacing: "0.07em", fontFamily: "monospace", marginBottom: 2 }}>{m.label}</div>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#e6edf3", fontFamily: "monospace" }}>{m.value}</div>
              </div>
            ))}
          </div>

          {/* Why we trust this */}
          <div style={{
            background: "#161b22", borderRadius: 4, padding: "8px 10px",
            fontSize: 10, color: "rgba(255,255,255,0.45)", lineHeight: 1.7,
          }}>
            <span style={{ color: "rgba(255,255,255,0.6)", fontWeight: 700 }}>Why detected: </span>
            {detection.detection_method === "clustering"
              ? "Trades grouped within a 60-second window showed statistically uniform sizing — consistent with an algorithm splitting a large order to minimise market impact."
              : "Unusual trade size concentration at a single price level, consistent with an iceberg order refilling as it gets hit."}
            {" "}<span style={{ color: confColor }}>Confidence {(conf * 100).toFixed(0)}%</span>
            {conf < 0.6 && " — treat as a weak signal, not confirmation."}
            {conf >= 0.7 && " — strong pattern match."}
          </div>
        </div>
      )}
    </div>
  );
}
