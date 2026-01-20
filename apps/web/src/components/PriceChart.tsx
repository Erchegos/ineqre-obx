"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Legend,
} from "recharts";

type PriceData = {
  date: string;
  value?: number | null; 
  price?: number | null; 
  raw?: number | null;   
  total?: number | null; 
  [key: string]: any;
};

export default function PriceChart({
  data,
  height = 400,
  showComparison = false,
}: {
  data: PriceData[];
  height?: number;
  mode?: "currency" | "percentage";
  showComparison?: boolean;
}) {
  if (!data || data.length === 0) {
    return (
      <div style={{ height, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted)" }}>
        No data available
      </div>
    );
  }

  // Determine the primary key to render if not in explicit comparison mode
  const hasRaw = data.some(d => d.raw !== undefined && d.raw !== null);
  const primaryKey = hasRaw ? "raw" : (data[0].value !== undefined ? "value" : "price");

  // Check if we actually have comparison data
  const hasTotal = data.some(d => d.total !== undefined && d.total !== null);
  const isComparisonActive = showComparison || (hasRaw && hasTotal);

  // Detect if data is in percentage format (comparison mode typically uses percentages)
  const isPercentageMode = isComparisonActive;

  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 5, right: 5, bottom: 5, left: -20 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
          
          <XAxis
            dataKey="date"
            stroke="var(--muted)"
            fontSize={12}
            tickFormatter={(val) => {
                if (!val) return "";
                return val.length > 7 ? val.slice(5) : val; 
            }}
            minTickGap={40}
            tickMargin={10}
          />
          
          <YAxis
            stroke="var(--muted)"
            fontSize={12}
            domain={["auto", "auto"]}
            tickFormatter={(val) => isPercentageMode ? `${val.toFixed(0)}%` : val.toFixed(2)}
          />
          
          <Tooltip
            contentStyle={{
              backgroundColor: "var(--card-bg)",
              borderColor: "var(--card-border)",
              color: "var(--foreground)",
              borderRadius: "4px",
              fontSize: "13px",
              padding: "10px 12px",
            }}
            labelStyle={{ color: "var(--muted)", marginBottom: "8px", fontWeight: 600 }}
            formatter={(value: any, name: any) => {
              if (value === null || value === undefined) return ["-", name];
              const formattedValue = typeof value === "number"
                ? (isPercentageMode ? `${value.toFixed(2)}%` : value.toFixed(2))
                : value;
              const label = name === "raw" ? "Price Return" : name === "total" ? "Total Return" : "Value";
              return [formattedValue, label];
            }}
            content={(props: any) => {
              const { active, payload, label } = props;
              if (!active || !payload || !payload.length) return null;

              const priceReturn = payload.find((p: any) => p.dataKey === "raw")?.value;
              const totalReturn = payload.find((p: any) => p.dataKey === "total")?.value;
              const difference = priceReturn !== undefined && totalReturn !== undefined
                ? totalReturn - priceReturn
                : null;

              return (
                <div style={{
                  backgroundColor: "var(--card-bg)",
                  border: "1px solid var(--card-border)",
                  borderRadius: "4px",
                  padding: "10px 12px",
                  fontSize: "13px",
                }}>
                  <div style={{ color: "var(--muted)", marginBottom: "8px", fontWeight: 600 }}>
                    {label}
                  </div>
                  {payload.map((entry: any, index: number) => (
                    <div key={index} style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: "16px",
                      marginBottom: "4px",
                      color: entry.color
                    }}>
                      <span>{entry.name}:</span>
                      <span style={{ fontWeight: 600, fontFamily: "monospace" }}>
                        {isPercentageMode ? `${entry.value.toFixed(2)}%` : entry.value.toFixed(2)}
                      </span>
                    </div>
                  ))}
                  {difference !== null && isPercentageMode && (
                    <>
                      <div style={{
                        borderTop: "1px solid var(--border-subtle)",
                        marginTop: "8px",
                        paddingTop: "6px"
                      }} />
                      <div style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: "16px",
                        color: "var(--muted-foreground)",
                        fontSize: "12px"
                      }}>
                        <span>Dividend Impact:</span>
                        <span style={{
                          fontWeight: 600,
                          fontFamily: "monospace",
                          color: difference >= 0 ? "#22c55e" : "#ef4444"
                        }}>
                          {difference >= 0 ? "+" : ""}{difference.toFixed(2)}%
                        </span>
                      </div>
                    </>
                  )}
                </div>
              );
            }}
          />
          
          {isComparisonActive && <Legend verticalAlign="top" height={36} />}

          {/* PRIMARY LINE */}
          <Line
            type="monotone"
            dataKey={primaryKey}
            name={isComparisonActive ? "Price Return" : "Value"}
            stroke={isComparisonActive ? "#22c55e" : "#3b82f6"} 
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
            connectNulls={true}
            isAnimationActive={false} 
          />

          {/* SECONDARY LINE */}
          {isComparisonActive && (
            <Line
              type="monotone"
              dataKey="total"
              name="Total Return"
              stroke="#3b82f6" 
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
              connectNulls={true}
              isAnimationActive={false}
            />
          )}

          {isComparisonActive && <ReferenceLine y={0} stroke="var(--border)" strokeDasharray="3 3" />}

        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}