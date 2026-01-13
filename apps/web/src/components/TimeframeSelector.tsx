"use client";

import { useState } from "react";

export type Timeframe = {
  label: string;
  days: number;
};

export const TIMEFRAMES: Timeframe[] = [
  { label: "1M", days: 21 },
  { label: "3M", days: 63 },
  { label: "6M", days: 126 },
  { label: "1Y", days: 252 },
  { label: "2Y", days: 504 },
  { label: "5Y", days: 1260 },
  { label: "Max", days: 5000 },
];

type Props = {
  selected: number;
  onChange: (days: number) => void;
};

export default function TimeframeSelector({ selected, onChange }: Props) {
  return (
    <div
      style={{
        display: "inline-flex",
        gap: 4,
        padding: 4,
        borderRadius: 6,
        background: "rgba(0, 0, 0, 0.3)",
        border: "1px solid rgba(255, 255, 255, 0.1)",
      }}
    >
      {TIMEFRAMES.map((tf) => {
        const isActive = selected === tf.days;
        return (
          <button
            key={tf.label}
            onClick={() => onChange(tf.days)}
            style={{
              padding: "6px 14px",
              borderRadius: 4,
              border: "none",
              background: isActive
                ? "rgba(255, 255, 255, 0.15)"
                : "transparent",
              color: isActive ? "rgba(255, 255, 255, 0.95)" : "rgba(255, 255, 255, 0.5)",
              fontSize: 13,
              fontWeight: isActive ? 600 : 500,
              cursor: "pointer",
              transition: "all 0.15s ease",
              letterSpacing: "0.02em",
            }}
            onMouseEnter={(e) => {
              if (!isActive) {
                e.currentTarget.style.background = "rgba(255, 255, 255, 0.08)";
                e.currentTarget.style.color = "rgba(255, 255, 255, 0.8)";
              }
            }}
            onMouseLeave={(e) => {
              if (!isActive) {
                e.currentTarget.style.background = "transparent";
                e.currentTarget.style.color = "rgba(255, 255, 255, 0.5)";
              }
            }}
          >
            {tf.label}
          </button>
        );
      })}
    </div>
  );
}