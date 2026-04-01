"use client";

type Tick = {
  ts: string;
  price: number;
  size: number;
  side: number; // 1=buy, -1=sell, 0=unknown
};

function formatTime(ts: string): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
}

export default function TradeTape({ ticks }: { ticks: Tick[] }) {
  if (!ticks.length) {
    return (
      <div
        style={{
          height: 200,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "rgba(255,255,255,0.4)",
          fontSize: 12,
          fontFamily: "monospace",
        }}
      >
        No recent trades
      </div>
    );
  }

  // Show last 100, compute median for highlighting
  const recent = ticks.slice(-100);
  const sizes = recent.map((t) => t.size).sort((a, b) => a - b);
  const medianSize = sizes[Math.floor(sizes.length / 2)] || 0;
  const largeThreshold = medianSize * 3;

  return (
    <div style={{ background: "#0d1117", border: "1px solid #21262d", borderRadius: 6, padding: 12 }}>
      <div
        style={{
          fontSize: 9,
          fontWeight: 600,
          color: "rgba(255,255,255,0.5)",
          letterSpacing: "0.06em",
          marginBottom: 8,
          fontFamily: "monospace",
          textTransform: "uppercase" as const,
        }}
      >
        TRADE TAPE (LAST {recent.length})
      </div>
      <div style={{ maxHeight: 300, overflowY: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "monospace", fontSize: 10 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid #21262d" }}>
              <th style={{ textAlign: "left", padding: "4px 6px", fontSize: 9, fontWeight: 600, color: "rgba(255,255,255,0.4)", letterSpacing: "0.05em" }}>TIME</th>
              <th style={{ textAlign: "right", padding: "4px 6px", fontSize: 9, fontWeight: 600, color: "rgba(255,255,255,0.4)", letterSpacing: "0.05em" }}>PRICE</th>
              <th style={{ textAlign: "right", padding: "4px 6px", fontSize: 9, fontWeight: 600, color: "rgba(255,255,255,0.4)", letterSpacing: "0.05em" }}>SIZE</th>
              <th style={{ textAlign: "center", padding: "4px 6px", fontSize: 9, fontWeight: 600, color: "rgba(255,255,255,0.4)", letterSpacing: "0.05em" }}>SIDE</th>
            </tr>
          </thead>
          <tbody>
            {[...recent].reverse().map((tick, i) => {
              const isLarge = tick.size > largeThreshold;
              const sideColor =
                tick.side === 1
                  ? "#10b981"
                  : tick.side === -1
                  ? "#ef4444"
                  : "#6b7280";

              return (
                <tr
                  key={i}
                  style={{
                    borderBottom: "1px solid #161b22",
                    background: isLarge ? "rgba(245,158,11,0.06)" : "transparent",
                  }}
                >
                  <td style={{ padding: "3px 6px", color: "rgba(255,255,255,0.5)" }}>
                    {formatTime(tick.ts)}
                  </td>
                  <td style={{ padding: "3px 6px", textAlign: "right", color: "#e6edf3" }}>
                    {tick.price.toFixed(2)}
                  </td>
                  <td
                    style={{
                      padding: "3px 6px",
                      textAlign: "right",
                      color: isLarge ? "#f59e0b" : "#e6edf3",
                      fontWeight: isLarge ? 700 : 400,
                    }}
                  >
                    {tick.size.toLocaleString()}
                    {isLarge && " ●"}
                  </td>
                  <td style={{ padding: "3px 6px", textAlign: "center", color: sideColor, fontWeight: 700 }}>
                    {tick.side === 1 ? "BUY" : tick.side === -1 ? "SELL" : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
