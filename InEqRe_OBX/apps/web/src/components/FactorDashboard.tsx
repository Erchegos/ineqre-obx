"use client";

import { useEffect, useState } from "react";

type FactorData = {
  date: string;
  mom1m: string | null;
  mom6m: string | null;
  mom11m: string | null;
  mom36m: string | null;
  chgmom: string | null;
  vol1m: string | null;
  vol3m: string | null;
  vol12m: string | null;
  maxret: string | null;
  beta: string | null;
  ivol: string | null;
  bm: string | null;
  nokvol: string | null;
  ep: string | null;
  dy: string | null;
  sp: string | null;
  sg: string | null;
  mktcap: string | null;
  dum_jan: number | null;
};

type Props = {
  ticker: string;
};

const FACTORS = [
  { key: "mom1m", label: "1M Momentum", category: "MOM", unit: "%" },
  { key: "mom6m", label: "6M Momentum", category: "MOM", unit: "%" },
  { key: "mom11m", label: "11M Momentum", category: "MOM", unit: "%" },
  { key: "mom36m", label: "36M Momentum", category: "MOM", unit: "%" },
  { key: "chgmom", label: "Momentum Change", category: "MOM", unit: "%" },
  { key: "vol1m", label: "1M Volatility", category: "VOL", unit: "%" },
  { key: "vol3m", label: "3M Volatility", category: "VOL", unit: "%" },
  { key: "vol12m", label: "12M Volatility", category: "VOL", unit: "%" },
  { key: "maxret", label: "Max Return", category: "VOL", unit: "%" },
  { key: "beta", label: "Beta", category: "VOL", unit: "" },
  { key: "ivol", label: "Idio Volatility", category: "VOL", unit: "%" },
  { key: "bm", label: "Book/Market", category: "FUND", unit: "" },
  { key: "ep", label: "Earnings/Price", category: "FUND", unit: "" },
  { key: "dy", label: "Div Yield", category: "FUND", unit: "%" },
  { key: "sp", label: "Sales/Price", category: "FUND", unit: "" },
  { key: "sg", label: "Sales Growth", category: "FUND", unit: "%" },
  { key: "mktcap", label: "Market Cap", category: "FUND", unit: "M" },
  { key: "nokvol", label: "NOK Volume", category: "FUND", unit: "M" },
  { key: "dum_jan", label: "January", category: "SEAS", unit: "" },
];

function formatValue(value: string | number | null, unit: string): string {
  if (value === null || value === undefined) return "N/A";

  const numValue = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(numValue)) return "N/A";

  if (unit === "%") {
    return `${(numValue * 100).toFixed(2)}`;
  } else if (unit === "M") {
    if (numValue > 1e9) return (numValue / 1e9).toFixed(2) + "B";
    if (numValue > 1e6) return (numValue / 1e6).toFixed(2);
    return numValue.toFixed(2);
  } else if (unit === "") {
    // Special case for January dummy
    if (typeof value === "number" && (value === 0 || value === 1)) {
      return value === 1 ? "Yes" : "No";
    }
    return numValue.toFixed(3);
  }

  return numValue.toFixed(4);
}

function getColor(value: string | number | null, category: string): string {
  if (value === null || value === undefined) return "var(--muted)";

  const numValue = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(numValue)) return "var(--muted)";

  if (category === "MOM") {
    if (numValue > 0.05) return "var(--success)";
    if (numValue > 0) return "#60a5fa";
    if (numValue < -0.05) return "var(--danger)";
    if (numValue < 0) return "#fbbf24";
    return "var(--foreground)";
  }

  if (category === "VOL") {
    if (numValue > 0.25) return "var(--danger)";
    if (numValue > 0.15) return "var(--warning)";
    return "var(--foreground)";
  }

  return "var(--foreground)";
}

export default function FactorDashboard({ ticker }: Props) {
  const [data, setData] = useState<FactorData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ticker) return;

    async function fetchData() {
      setLoading(true);
      setError(null);

      try {
        const end = new Date().toISOString().split("T")[0];
        const start = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

        const url = `/api/factors/${ticker}?startDate=${start}&endDate=${end}&type=all&limit=1`;
        const response = await fetch(url);

        if (!response.ok) {
          throw new Error(`Failed to fetch factors`);
        }

        const result = await response.json();
        if (result.success && result.data && result.data.length > 0) {
          setData(result.data[0]);
        }
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [ticker]);

  if (loading) {
    return (
      <div
        style={{
          padding: 20,
          textAlign: "center",
          color: "var(--muted)",
          borderRadius: 2,
          border: "1px solid var(--terminal-border)",
          background: "var(--terminal-bg)",
          fontSize: 10,
          fontFamily: "monospace",
        }}
      >
        LOADING FACTOR DATA...
      </div>
    );
  }

  if (error || !data) {
    return (
      <div
        style={{
          padding: 16,
          borderRadius: 2,
          border: "1px solid var(--danger)",
          background: "var(--danger-bg)",
          fontSize: 10,
          fontFamily: "monospace",
        }}
      >
        <span style={{ color: "var(--danger)", fontWeight: 600 }}>ERROR: </span>
        <span style={{ color: "var(--foreground)" }}>{error || "No data available"}</span>
      </div>
    );
  }

  const factorDate = new Date(data.date).toISOString().split("T")[0];

  // Group factors by category
  const categories = [
    { key: "MOM", label: "Momentum", factors: FACTORS.filter((f) => f.category === "MOM") },
    { key: "VOL", label: "Volatility & Risk", factors: FACTORS.filter((f) => f.category === "VOL") },
    { key: "FUND", label: "Fundamentals", factors: FACTORS.filter((f) => f.category === "FUND") },
    { key: "SEAS", label: "Seasonality", factors: FACTORS.filter((f) => f.category === "SEAS") },
  ];

  return (
    <div
      style={{
        borderRadius: 2,
        border: "1px solid var(--terminal-border)",
        background: "var(--terminal-bg)",
        overflow: "hidden",
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
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 11, fontWeight: 700, fontFamily: "monospace", color: "var(--foreground)" }}>
            PREDICTIVE FACTORS (19)
          </span>
          <span style={{ fontSize: 9, color: "var(--muted)", fontFamily: "monospace" }}>
            AS OF {factorDate}
          </span>
        </div>
      </div>

      {/* Factor Tables */}
      <div style={{ padding: 12 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {categories.map((cat) => (
            <div
              key={cat.key}
              style={{
                background: "var(--card-bg)",
                border: "1px solid var(--border)",
                borderRadius: 2,
                overflow: "hidden",
              }}
            >
              {/* Category Header */}
              <div
                style={{
                  padding: "6px 10px",
                  background: "var(--input-bg)",
                  borderBottom: "1px solid var(--border)",
                  fontSize: 9,
                  fontWeight: 700,
                  color: "var(--foreground)",
                  fontFamily: "monospace",
                }}
              >
                {cat.label.toUpperCase()}
              </div>

              {/* Factors Table */}
              <div style={{ fontSize: 10, fontFamily: "monospace" }}>
                {cat.factors.map((factor, idx) => {
                  const value = data[factor.key as keyof FactorData];
                  const formattedValue = formatValue(value, factor.unit);
                  const color = getColor(value, factor.category);
                  const isNA = formattedValue === "N/A";

                  return (
                    <div
                      key={factor.key}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1fr auto",
                        padding: "6px 10px",
                        borderBottom: idx < cat.factors.length - 1 ? "1px solid var(--border-subtle)" : "none",
                        background: idx % 2 === 0 ? "transparent" : "var(--hover-bg)",
                      }}
                    >
                      <span style={{ color: "var(--muted)", fontSize: 9 }}>
                        {factor.label}
                      </span>
                      <span
                        style={{
                          fontWeight: 600,
                          color: isNA ? "var(--muted)" : color,
                          textAlign: "right",
                          fontVariantNumeric: "tabular-nums",
                        }}
                      >
                        {formattedValue}
                        {!isNA && factor.unit === "%" && "%"}
                        {!isNA && factor.unit === "M" && "M"}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Info Note */}
        <div
          style={{
            marginTop: 8,
            padding: 8,
            background: "var(--hover-bg)",
            border: "1px solid var(--border-subtle)",
            borderRadius: 2,
            fontSize: 8,
            color: "var(--muted)",
            fontFamily: "monospace",
          }}
        >
          <strong>NOTE:</strong> N/A = DATA NOT AVAILABLE • BETA/IVOL REQUIRE INDEX DATA • FUNDAMENTALS REQUIRE
          FINANCIAL STATEMENTS
        </div>
      </div>
    </div>
  );
}
