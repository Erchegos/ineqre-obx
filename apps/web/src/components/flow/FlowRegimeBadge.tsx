"use client";

const REGIME_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  informed_buying: { label: "INFORMED BUY", color: "#10b981", bg: "rgba(16,185,129,0.15)" },
  informed_selling: { label: "INFORMED SELL", color: "#ef4444", bg: "rgba(239,68,68,0.15)" },
  market_making: { label: "MARKET MAKING", color: "#3b82f6", bg: "rgba(59,130,246,0.15)" },
  retail: { label: "RETAIL", color: "#f59e0b", bg: "rgba(245,158,11,0.15)" },
  neutral: { label: "NEUTRAL", color: "#6b7280", bg: "rgba(107,114,128,0.15)" },
};

export default function FlowRegimeBadge({ regime }: { regime: string }) {
  const cfg = REGIME_CONFIG[regime] || REGIME_CONFIG.neutral;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "2px 8px",
        borderRadius: 4,
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: "0.06em",
        color: cfg.color,
        background: cfg.bg,
        border: `1px solid ${cfg.color}33`,
        fontFamily: "monospace",
      }}
    >
      <span
        style={{
          width: 5,
          height: 5,
          borderRadius: "50%",
          background: cfg.color,
        }}
      />
      {cfg.label}
    </span>
  );
}
