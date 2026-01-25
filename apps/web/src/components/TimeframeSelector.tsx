"use client";

import { useState } from "react";

type TimeframeSelectorProps = {
  selected: number;
  onChange: (limit: number) => void;
  onDateRangeChange?: (startDate: string, endDate: string) => void;
  customDateRange?: { start: string; end: string } | null;
};

const TIMEFRAMES = [
  { label: "1M", value: 21 },
  { label: "3M", value: 63 },
  { label: "6M", value: 126 },
  { label: "1Y", value: 252 },
  { label: "2Y", value: 504 },
  { label: "5Y", value: 1260 },
  { label: "Max", value: 10000 },
];

export default function TimeframeSelector({
  selected,
  onChange,
  onDateRangeChange,
  customDateRange,
}: TimeframeSelectorProps) {
  const [showCustom, setShowCustom] = useState(false);
  const [customStart, setCustomStart] = useState(customDateRange?.start || "");
  const [customEnd, setCustomEnd] = useState(customDateRange?.end || "");

  const isCustomActive = customDateRange !== null && customDateRange !== undefined && customDateRange.start !== "";

  const handleApplyCustom = () => {
    if (customStart && customEnd && onDateRangeChange) {
      onDateRangeChange(customStart, customEnd);
      setShowCustom(false);
    }
  };

  const handlePresetClick = (value: number) => {
    onChange(value);
    // Clear custom date range when selecting a preset
    if (onDateRangeChange) {
      onDateRangeChange("", "");
    }
  };

  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      {TIMEFRAMES.map((tf) => (
        <button
          key={tf.value}
          onClick={() => handlePresetClick(tf.value)}
          style={{
            padding: "6px 12px",
            borderRadius: 3,
            border: `1px solid ${
              !isCustomActive && selected === tf.value
                ? "var(--accent)"
                : "var(--input-border)"
            }`,
            background:
              !isCustomActive && selected === tf.value
                ? "var(--accent)"
                : "var(--input-bg)",
            color:
              !isCustomActive && selected === tf.value
                ? "#ffffff"
                : "var(--foreground)",
            fontSize: 12,
            fontWeight: 500,
            cursor: "pointer",
            transition: "all 0.15s",
          }}
        >
          {tf.label}
        </button>
      ))}

      {/* Custom Date Range Button */}
      <div style={{ position: "relative" }}>
        <button
          onClick={() => setShowCustom(!showCustom)}
          style={{
            padding: "6px 12px",
            borderRadius: 3,
            border: `1px solid ${isCustomActive ? "var(--accent)" : "var(--input-border)"}`,
            background: isCustomActive ? "var(--accent)" : "var(--input-bg)",
            color: isCustomActive ? "#ffffff" : "var(--foreground)",
            fontSize: 12,
            fontWeight: 500,
            cursor: "pointer",
            transition: "all 0.15s",
            display: "flex",
            alignItems: "center",
            gap: 4,
          }}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
          {isCustomActive
            ? `${customDateRange.start} → ${customDateRange.end}`
            : "Custom"}
        </button>

        {/* Dropdown for custom date range */}
        {showCustom && (
          <div
            style={{
              position: "absolute",
              top: "calc(100% + 8px)",
              left: 0,
              background: "#1a1a1a",
              border: "1px solid rgba(255, 255, 255, 0.2)",
              borderRadius: 6,
              padding: 16,
              zIndex: 100,
              boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
              minWidth: 280,
            }}
          >
            <div style={{ marginBottom: 12 }}>
              <label
                style={{
                  display: "block",
                  fontSize: 11,
                  color: "rgba(255, 255, 255, 0.6)",
                  marginBottom: 4,
                  textTransform: "uppercase",
                }}
              >
                Start Date
              </label>
              <input
                type="date"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                style={{
                  width: "100%",
                  padding: "8px 10px",
                  borderRadius: 4,
                  border: "1px solid rgba(255, 255, 255, 0.2)",
                  background: "#252525",
                  color: "#ffffff",
                  fontSize: 13,
                }}
              />
            </div>
            <div style={{ marginBottom: 16 }}>
              <label
                style={{
                  display: "block",
                  fontSize: 11,
                  color: "rgba(255, 255, 255, 0.6)",
                  marginBottom: 4,
                  textTransform: "uppercase",
                }}
              >
                End Date
              </label>
              <input
                type="date"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                style={{
                  width: "100%",
                  padding: "8px 10px",
                  borderRadius: 4,
                  border: "1px solid rgba(255, 255, 255, 0.2)",
                  background: "#252525",
                  color: "#ffffff",
                  fontSize: 13,
                }}
              />
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={() => setShowCustom(false)}
                style={{
                  flex: 1,
                  padding: "8px 12px",
                  borderRadius: 4,
                  border: "1px solid rgba(255, 255, 255, 0.2)",
                  background: "#252525",
                  color: "#ffffff",
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleApplyCustom}
                disabled={!customStart || !customEnd}
                style={{
                  flex: 1,
                  padding: "8px 12px",
                  borderRadius: 4,
                  border: "none",
                  background:
                    customStart && customEnd ? "var(--accent)" : "#444",
                  color: "#ffffff",
                  fontSize: 12,
                  fontWeight: 500,
                  cursor: customStart && customEnd ? "pointer" : "not-allowed",
                }}
              >
                Apply
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
