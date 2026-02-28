"use client";

type Alert = {
  type: "lice" | "disease" | "traffic" | "price";
  severity: "high" | "medium" | "low";
  message: string;
  detail?: string;
  timestamp?: string;
};

type Props = {
  alerts: Alert[];
};

const SEVERITY_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  high: { bg: "#ef444415", text: "#ef4444", border: "#ef444440" },
  medium: { bg: "#f59e0b15", text: "#f59e0b", border: "#f59e0b40" },
  low: { bg: "#3b82f615", text: "#3b82f6", border: "#3b82f640" },
};

const TYPE_ICONS: Record<string, string> = {
  lice: "🦠",
  disease: "⚠️",
  traffic: "🚦",
  price: "📈",
};

export default function SeafoodAlerts({ alerts }: Props) {
  if (!alerts || alerts.length === 0) {
    return (
      <div style={{ padding: 16, color: "#484f58", fontSize: 12, textAlign: "center" }}>
        No active alerts
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {alerts.map((alert, i) => {
        const colors = SEVERITY_COLORS[alert.severity] || SEVERITY_COLORS.low;
        return (
          <div
            key={i}
            style={{
              padding: "10px 12px",
              background: colors.bg,
              border: `1px solid ${colors.border}`,
              borderRadius: 6,
              fontSize: 12,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span>{TYPE_ICONS[alert.type] || "📋"}</span>
              <span style={{ color: colors.text, fontWeight: 600, flex: 1 }}>
                {alert.message}
              </span>
              {alert.timestamp && (
                <span style={{ color: "#484f58", fontSize: 10 }}>
                  {new Date(alert.timestamp).toLocaleDateString("en-GB")}
                </span>
              )}
            </div>
            {alert.detail && (
              <div style={{ color: "#8b949e", marginTop: 4, marginLeft: 24, fontSize: 11 }}>
                {alert.detail}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
