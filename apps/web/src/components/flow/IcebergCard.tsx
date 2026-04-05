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
  size_cv: number;
  vwap: number;
  est_block_pct: number;
  detection_method: string;
  confidence: number;
};

function formatTime(ts: string): string {
  const d = new Date(ts);
  return `${d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" })} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function confColor(c: number): string {
  if (c >= 0.8) return "#10b981";
  if (c >= 0.6) return "#f59e0b";
  return "#ef4444";
}

export default function IcebergCard({ detection }: { detection: Iceberg }) {
  const [expanded, setExpanded] = useState(false);
  const dirLabel = detection.direction === 1 ? "BUY" : detection.direction === -1 ? "SELL" : "UNKNOWN";
  const dirColor = detection.direction === 1 ? "#10b981" : detection.direction === -1 ? "#ef4444" : "#6b7280";

  return (
    <div
      style={{
        background: "#0d1117",
        border: "1px solid #21262d",
        borderRadius: 6,
        padding: 12,
        cursor: "pointer",
        transition: "border-color 0.2s",
      }}
      onClick={() => setExpanded(!expanded)}
      onMouseEnter={(e) => ((e.currentTarget as HTMLDivElement).style.borderColor = "#00e5ff")}
      onMouseLeave={(e) => ((e.currentTarget as HTMLDivElement).style.borderColor = "#21262d")}
    >
      {/* Header row */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.4)", letterSpacing: "0.06em" }}>ICE</span>
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: dirColor,
              fontFamily: "monospace",
              padding: "1px 6px",
              borderRadius: 3,
              background: `${dirColor}15`,
              border: `1px solid ${dirColor}33`,
            }}
          >
            {dirLabel}
          </span>
          <span style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", fontFamily: "monospace" }}>
            {formatTime(detection.start_ts || detection.detected_at)}
          </span>
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <span style={{ fontSize: 10, fontFamily: "monospace", color: "#e6edf3" }}>
            {detection.total_volume.toLocaleString()} shares
          </span>
          <span
            style={{
              fontSize: 9,
              fontWeight: 700,
              fontFamily: "monospace",
              color: confColor(detection.confidence),
            }}
          >
            {(detection.confidence * 100).toFixed(0)}%
          </span>
          <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", transform: expanded ? "rotate(180deg)" : "rotate(0)", transition: "transform 0.2s" }}>
            ▼
          </span>
        </div>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div
          style={{
            marginTop: 10,
            paddingTop: 10,
            borderTop: "1px solid #21262d",
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            gap: 8,
          }}
        >
          {[
            { label: "Trades", value: String(detection.trade_count) },
            { label: "Avg Size", value: detection.avg_trade_size.toFixed(0) },
            { label: "Size CV", value: detection.size_cv.toFixed(3) },
            { label: "VWAP", value: detection.vwap.toFixed(2) },
            { label: "Block Est", value: `${(detection.est_block_pct * 100).toFixed(1)}%` },
            { label: "Method", value: detection.detection_method || "time_cluster" },
          ].map((m) => (
            <div key={m.label} style={{ textAlign: "center" }}>
              <div style={{ fontSize: 8, color: "rgba(255,255,255,0.4)", fontFamily: "monospace", letterSpacing: "0.06em", textTransform: "uppercase" as const }}>
                {m.label}
              </div>
              <div style={{ fontSize: 11, color: "#e6edf3", fontWeight: 600, fontFamily: "monospace" }}>
                {m.value}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
