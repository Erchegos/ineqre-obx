"use client";

type Signal = {
  vpin: number | null;
  vpinPercentile: number | null;
  kyleLambda: number | null;
  ofiCumulative: number | null;
  ofi5m: number | null;
  toxicity: number | null;
};

function vpinColor(v: number): string {
  if (v >= 0.7) return "#ef4444";
  if (v >= 0.5) return "#f59e0b";
  return "#10b981";
}

function toxColor(t: number): string {
  if (t >= 70) return "#ef4444";
  if (t >= 40) return "#f59e0b";
  return "#10b981";
}

function MetricCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div
      style={{
        background: "#0d1117",
        border: "1px solid #21262d",
        borderRadius: 4,
        padding: "8px 12px",
        textAlign: "center",
        minWidth: 90,
      }}
    >
      <div
        style={{
          fontSize: 9,
          fontWeight: 600,
          color: "rgba(255,255,255,0.5)",
          letterSpacing: "0.06em",
          marginBottom: 4,
          textTransform: "uppercase" as const,
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 16, fontWeight: 800, color, fontFamily: "monospace" }}>
        {value}
      </div>
    </div>
  );
}

export default function FlowSignalStrip({ signal }: { signal: Signal }) {
  const vpin = signal.vpin ?? 0;
  const toxicity = signal.toxicity ?? 0;

  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      <MetricCard
        label="VPIN"
        value={vpin.toFixed(3)}
        color={vpinColor(vpin)}
      />
      <MetricCard
        label="VPIN %ile"
        value={signal.vpinPercentile != null ? `${(signal.vpinPercentile * 100).toFixed(0)}%` : "—"}
        color={vpinColor(signal.vpinPercentile ?? 0)}
      />
      <MetricCard
        label="Kyle λ"
        value={signal.kyleLambda != null ? signal.kyleLambda.toFixed(4) : "—"}
        color="#00e5ff"
      />
      <MetricCard
        label="OFI (cum)"
        value={
          signal.ofiCumulative != null
            ? signal.ofiCumulative > 0
              ? `+${(signal.ofiCumulative / 1000).toFixed(1)}K`
              : `${(signal.ofiCumulative / 1000).toFixed(1)}K`
            : "—"
        }
        color={
          signal.ofiCumulative != null
            ? signal.ofiCumulative > 0
              ? "#10b981"
              : "#ef4444"
            : "#6b7280"
        }
      />
      <MetricCard
        label="OFI (5m)"
        value={
          signal.ofi5m != null
            ? signal.ofi5m > 0
              ? `+${signal.ofi5m.toFixed(0)}`
              : signal.ofi5m.toFixed(0)
            : "—"
        }
        color={
          signal.ofi5m != null
            ? signal.ofi5m > 0
              ? "#10b981"
              : "#ef4444"
            : "#6b7280"
        }
      />
      <MetricCard
        label="Toxicity"
        value={toxicity.toFixed(0)}
        color={toxColor(toxicity)}
      />
    </div>
  );
}
