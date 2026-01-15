"use client";

interface CorrelationMatrix {
  tickers: string[];
  values: number[][];
}

interface Props {
  data: CorrelationMatrix;
}

export default function CorrelationHeatmap({ data }: Props) {
  // Safety checks
  if (!data || !data.tickers || !data.values) {
    return (
      <div style={{ padding: 32, textAlign: "center", color: "var(--muted)" }}>
        No correlation data available
      </div>
    );
  }

  const { tickers, values } = data;

  if (tickers.length === 0 || values.length === 0) {
    return (
      <div style={{ padding: 32, textAlign: "center", color: "var(--muted)" }}>
        Insufficient data to display correlation matrix
      </div>
    );
  }

  const cellSize = Math.min(60, Math.max(30, 600 / tickers.length));

  return (
    <div style={{ overflowX: "auto" }}>
      <div style={{ display: "inline-block", minWidth: "100%" }}>
        {/* Legend */}
        <div style={{ marginBottom: 24, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 20, height: 20, background: "rgb(239, 68, 68)", borderRadius: 2 }}></div>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>-1.0 (Negative)</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 20, height: 20, background: "rgb(100, 100, 100)", borderRadius: 2 }}></div>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>0.0 (No Correlation)</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 20, height: 20, background: "rgb(59, 130, 246)", borderRadius: 2 }}></div>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>+1.0 (Positive)</span>
          </div>
        </div>

        {/* Heatmap */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
          <table style={{ borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th></th>
                {tickers.map((ticker) => (
                  <th
                    key={ticker}
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      padding: 4,
                      textAlign: "center",
                      transform: "rotate(-45deg)",
                      transformOrigin: "center",
                      height: 60,
                      width: cellSize,
                    }}
                  >
                    {ticker}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tickers.map((rowTicker, i) => (
                <tr key={rowTicker}>
                  <td
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      padding: 4,
                      textAlign: "right",
                      paddingRight: 8,
                    }}
                  >
                    {rowTicker}
                  </td>
                  {tickers.map((colTicker, j) => {
                    const value = values[i]?.[j] ?? 0;
                    const isIdentity = i === j;

                    // Color mapping
                    let bgColor: string;
                    if (isIdentity) {
                      bgColor = "rgb(100, 100, 100)";
                    } else if (value > 0) {
                      const intensity = Math.abs(value);
                      const r = Math.round(59 + (255 - 59) * (1 - intensity));
                      const g = Math.round(130 + (255 - 130) * (1 - intensity));
                      const b = 246;
                      bgColor = `rgb(${r}, ${g}, ${b})`;
                    } else {
                      const intensity = Math.abs(value);
                      const r = 239;
                      const g = Math.round(68 + (255 - 68) * (1 - intensity));
                      const b = Math.round(68 + (255 - 68) * (1 - intensity));
                      bgColor = `rgb(${r}, ${g}, ${b})`;
                    }

                    return (
                      <td
                        key={`${rowTicker}-${colTicker}`}
                        style={{
                          width: cellSize,
                          height: cellSize,
                          background: bgColor,
                          textAlign: "center",
                          fontSize: 12,
                          color: Math.abs(value) > 0.5 ? "white" : "var(--foreground)",
                          fontWeight: 600,
                          border: "1px solid var(--border)",
                        }}
                      >
                        {isIdentity ? "–" : value.toFixed(2)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}