"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";

type Props = {
  featureImportance: Record<string, number>;
  title?: string;
};

const FACTOR_LABELS: Record<string, string> = {
  mom1m: "1M Mom",
  mom6m: "6M Mom",
  mom11m: "11M Mom",
  mom36m: "36M Mom",
  chgmom: "Mom Δ",
  vol1m: "1M Vol",
  vol3m: "3M Vol",
  vol12m: "12M Vol",
  maxret: "Max Ret",
  beta: "Beta",
  ivol: "Idio Vol",
  bm: "B/M",
  nokvol: "NOK Vol",
  ep: "E/P",
  dy: "Div Yld",
  sp: "S/P",
  sg: "Sales Grw",
  mktcap: "Mkt Cap",
  dum_jan: "Jan Effect",
  log_mktcap: "Log MktCap",
  log_nokvol: "Log NOKVol",
  mom1m_x_illiquid: "Mom×Illiq",
};

const FACTOR_CATEGORIES: Record<string, string> = {
  mom1m: "MOM",
  mom6m: "MOM",
  mom11m: "MOM",
  mom36m: "MOM",
  chgmom: "MOM",
  vol1m: "VOL",
  vol3m: "VOL",
  vol12m: "VOL",
  maxret: "VOL",
  beta: "VOL",
  ivol: "VOL",
  bm: "FUND",
  nokvol: "FUND",
  ep: "FUND",
  dy: "FUND",
  sp: "FUND",
  sg: "FUND",
  mktcap: "FUND",
  dum_jan: "SEAS",
};

export default function FeatureImportance({ featureImportance, title }: Props) {
  if (!featureImportance || Object.keys(featureImportance).length === 0) {
    return (
      <div
        style={{
          padding: 16,
          borderRadius: 2,
          border: "1px solid var(--terminal-border)",
          background: "var(--terminal-bg)",
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: "var(--muted)",
            fontFamily: "monospace",
          }}
        >
          NO FEATURE IMPORTANCE DATA
        </div>
      </div>
    );
  }

  // Convert to array and sort by importance
  const data = Object.entries(featureImportance)
    .map(([key, value]) => ({
      factor: FACTOR_LABELS[key] || key,
      importance: value * 100,
      category: FACTOR_CATEGORIES[key] || "OTHER",
      key,
    }))
    .sort((a, b) => b.importance - a.importance)
    .slice(0, 10);

  const getCategoryColor = (category: string) => {
    switch (category) {
      case "MOM":
        return "#60a5fa";
      case "VOL":
        return "#f59e0b";
      case "FUND":
        return "#10b981";
      case "SEAS":
        return "#a78bfa";
      default:
        return "var(--accent)";
    }
  };

  const maxImportance = Math.max(...data.map((d) => d.importance));

  return (
    <div
      style={{
        borderRadius: 2,
        border: "1px solid var(--terminal-border)",
        background: "var(--terminal-bg)",
        overflow: "hidden",
        height: "100%",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "8px 12px",
          background: "var(--card-bg)",
          borderBottom: "1px solid var(--terminal-border)",
        }}
      >
        <div style={{ fontSize: 11, fontWeight: 700, fontFamily: "monospace", color: "var(--foreground)" }}>
          FEATURE IMPORTANCE (TOP 10)
        </div>
        <div style={{ fontSize: 8, color: "var(--muted)", fontFamily: "monospace", marginTop: 2 }}>
          FACTORS DRIVING THE PREDICTION
        </div>
      </div>

      {/* Chart */}
      <div style={{ padding: 12 }}>
        <ResponsiveContainer width="100%" height={340}>
          <BarChart
            data={data}
            layout="vertical"
            margin={{ top: 5, right: 20, left: 60, bottom: 5 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" horizontal={false} />
            <XAxis
              type="number"
              stroke="var(--border)"
              style={{ fontSize: 9, fontFamily: "monospace" }}
              tickFormatter={(value) => `${value.toFixed(0)}%`}
              tick={{ fill: "var(--foreground)", opacity: 0.8 }}
            />
            <YAxis
              type="category"
              dataKey="factor"
              stroke="var(--border)"
              style={{ fontSize: 9, fontFamily: "monospace" }}
              width={55}
              tick={{ fill: "var(--foreground)", opacity: 0.8 }}
            />
            <Tooltip
              contentStyle={{
                background: "var(--terminal-bg)",
                border: "1px solid var(--accent)",
                borderRadius: 4,
                fontSize: 11,
                fontFamily: "monospace",
                padding: "8px 12px",
                boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
              }}
              formatter={(value: any, name: any, props: any) => [
                <span key="val" style={{ color: "#10b981" }}>{value.toFixed(2)}%</span>,
                <span key="label" style={{ color: "var(--foreground)" }}>{props.payload.category}</span>,
              ]}
              labelFormatter={(label) => <span style={{ color: "var(--foreground)", fontWeight: 600 }}>{label}</span>}
            />
            <Bar dataKey="importance" radius={[0, 2, 2, 0]}>
              {data.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={getCategoryColor(entry.category)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>

        {/* Legend */}
        <div
          style={{
            marginTop: 12,
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: 8,
          }}
        >
          {[
            { label: "MOM", color: "#60a5fa" },
            { label: "VOL", color: "#f59e0b" },
            { label: "FUND", color: "#10b981" },
            { label: "SEAS", color: "#a78bfa" },
          ].map((item) => (
            <div key={item.label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div
                style={{
                  width: 8,
                  height: 8,
                  background: item.color,
                  borderRadius: 1,
                }}
              />
              <span
                style={{
                  fontSize: 8,
                  color: "var(--muted)",
                  fontFamily: "monospace",
                  fontWeight: 600,
                }}
              >
                {item.label}
              </span>
            </div>
          ))}
        </div>

        {/* Info */}
        <div
          style={{
            marginTop: 12,
            padding: 8,
            background: "var(--hover-bg)",
            border: "1px solid var(--border-subtle)",
            borderRadius: 2,
            fontSize: 8,
            color: "var(--muted)",
            fontFamily: "monospace",
            lineHeight: 1.6,
          }}
        >
          HIGHER VALUES = MORE INFLUENTIAL IN PREDICTION
        </div>
      </div>
    </div>
  );
}
