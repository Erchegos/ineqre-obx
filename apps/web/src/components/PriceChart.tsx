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

// FIX: Explicitly allow 'null' for all numeric fields
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
  // We prioritize 'raw' (from new logic) -> 'value' -> 'price'
  const hasRaw = data.some(d => d.raw !== undefined && d.raw !== null);
  const primaryKey = hasRaw ? "raw" : (data[0].value !== undefined ? "value" : "price");
  
  // Check if we actually have comparison data
  const hasTotal = data.some(d => d.total !== undefined && d.total !== null);
  const isComparisonActive = showComparison || (hasRaw && hasTotal);

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
            tickFormatter={(val) => val.toFixed(0)}
          />
          
          <Tooltip
            contentStyle={{
              backgroundColor: "var(--card-bg)",
              borderColor: "var(--card-border)",
              color: "var(--foreground)",
              borderRadius: "4px",
              fontSize: "13px",
            }}
            labelStyle={{ color: "var(--muted)", marginBottom: "5px" }}
            // FIX: Changed 'number | null' to 'any' to satisfy Recharts strict typing
            formatter={(value: any, name: string) => {
              if (value === null || value === undefined) return ["-", name];
              return [
                typeof value === "number" ? value.toFixed(2) : value,
                name === "raw" ? "Price Return" : name === "total" ? "Total Return" : "Value"
              ];
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