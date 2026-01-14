"use client";

type TimeframeSelectorProps = {
  selected: number;
  onChange: (limit: number) => void;
};

const TIMEFRAMES = [
  { label: "1M", value: 21 },
  { label: "3M", value: 63 },
  { label: "6M", value: 126 },
  { label: "1Y", value: 252 },
  { label: "2Y", value: 504 },
  { label: "5Y", value: 1260 },
  { label: "Max", value: 5000 },
];

export default function TimeframeSelector({ selected, onChange }: TimeframeSelectorProps) {
  return (
    <div style={{ display: "flex", gap: 8 }}>
      {TIMEFRAMES.map((tf) => (
        <button
          key={tf.value}
          onClick={() => onChange(tf.value)}
          style={{
            padding: "6px 12px",
            borderRadius: 3,
            border: `1px solid ${selected === tf.value ? "var(--accent)" : "var(--input-border)"}`,
            background: selected === tf.value ? "var(--accent)" : "var(--input-bg)",
            color: selected === tf.value ? "#ffffff" : "var(--foreground)",
            fontSize: 12,
            fontWeight: 500,
            cursor: "pointer",
            transition: "all 0.15s",
          }}
        >
          {tf.label}
        </button>
      ))}
    </div>
  );
}