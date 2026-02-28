"use client";

import { useState } from "react";
import Link from "next/link";

type Company = {
  ticker: string;
  name: string;
  price: number | null;
  change1d: number | null;
  change1w: number | null;
  change1m: number | null;
  activeSites: number | null;
  avgLice4w: number | null;
  pctAboveThreshold: number | null;
  treatmentRate: number | null;
  riskScore: number | null;
  productionAreas: number[];
};

type Props = {
  companies: Company[];
  trafficLights: Record<number, string>;
};

type SortKey = "ticker" | "price" | "change1d" | "change1w" | "change1m" | "avgLice4w" | "pctAboveThreshold" | "riskScore";

function getLiceColor(lice: number | null): string {
  if (lice == null) return "#484f58";
  if (lice < 0.2) return "#22c55e";
  if (lice < 0.5) return "#f59e0b";
  return "#ef4444";
}

function getRiskColor(risk: number | null): string {
  if (risk == null) return "#484f58";
  if (risk < 25) return "#22c55e";
  if (risk < 40) return "#f59e0b";
  return "#ef4444";
}

const TRAFFIC_COLORS: Record<string, string> = {
  green: "#22c55e",
  yellow: "#f59e0b",
  red: "#ef4444",
};

export default function CompanyExposureTable({ companies, trafficLights }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("riskScore");
  const [sortAsc, setSortAsc] = useState(false);

  const sorted = [...companies].sort((a, b) => {
    const av = a[sortKey] ?? -Infinity;
    const bv = b[sortKey] ?? -Infinity;
    return sortAsc ? (av > bv ? 1 : -1) : (av < bv ? 1 : -1);
  });

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(false); }
  };

  const thStyle = (key: SortKey): React.CSSProperties => ({
    padding: "8px 10px",
    textAlign: key === "ticker" ? "left" : "right",
    fontSize: 11,
    fontWeight: 600,
    color: sortKey === key ? "#c9d1d9" : "#8b949e",
    cursor: "pointer",
    borderBottom: "1px solid #30363d",
    whiteSpace: "nowrap",
    userSelect: "none",
  });

  const tdStyle = (align: "left" | "right" = "right"): React.CSSProperties => ({
    padding: "8px 10px",
    textAlign: align,
    fontSize: 12,
    borderBottom: "1px solid #21262d",
    whiteSpace: "nowrap",
  });

  const fmtChange = (v: number | null) => {
    if (v == null) return <span style={{ color: "#484f58" }}>—</span>;
    const color = v >= 0 ? "#22c55e" : "#ef4444";
    return <span style={{ color }}>{v >= 0 ? "+" : ""}{v.toFixed(1)}%</span>;
  };

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ background: "#0d1117" }}>
            <th style={thStyle("ticker")} onClick={() => handleSort("ticker")}>Company</th>
            <th style={thStyle("price")} onClick={() => handleSort("price")}>Price</th>
            <th style={thStyle("change1d")} onClick={() => handleSort("change1d")}>1D</th>
            <th style={thStyle("change1w")} onClick={() => handleSort("change1w")}>1W</th>
            <th style={thStyle("change1m")} onClick={() => handleSort("change1m")}>1M</th>
            <th style={thStyle("avgLice4w")} onClick={() => handleSort("avgLice4w")}>Avg Lice</th>
            <th style={thStyle("pctAboveThreshold")} onClick={() => handleSort("pctAboveThreshold")}>% Above</th>
            <th style={{ ...thStyle("riskScore"), textAlign: "center" }}>Areas</th>
            <th style={thStyle("riskScore")} onClick={() => handleSort("riskScore")}>Risk</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((co) => (
            <tr
              key={co.ticker}
              style={{ background: "#161b22" }}
              onMouseOver={(e) => (e.currentTarget.style.background = "#1c2129")}
              onMouseOut={(e) => (e.currentTarget.style.background = "#161b22")}
            >
              <td style={tdStyle("left")}>
                <Link href={`/stocks/${co.ticker}`} style={{ color: "#58a6ff", textDecoration: "none", fontWeight: 600 }}>
                  {co.ticker}
                </Link>
                <span style={{ color: "#8b949e", fontSize: 11, marginLeft: 6 }}>
                  {co.name.replace(/\s*ASA\s*$/i, "")}
                </span>
              </td>
              <td style={tdStyle()}>
                {co.price != null ? co.price.toFixed(2) : "—"}
              </td>
              <td style={tdStyle()}>{fmtChange(co.change1d)}</td>
              <td style={tdStyle()}>{fmtChange(co.change1w)}</td>
              <td style={tdStyle()}>{fmtChange(co.change1m)}</td>
              <td style={tdStyle()}>
                <span style={{ color: getLiceColor(co.avgLice4w), fontWeight: 600 }}>
                  {co.avgLice4w != null ? co.avgLice4w.toFixed(2) : "—"}
                </span>
              </td>
              <td style={tdStyle()}>
                {co.pctAboveThreshold != null ? (
                  <span style={{ color: co.pctAboveThreshold > 10 ? "#ef4444" : "#8b949e" }}>
                    {co.pctAboveThreshold.toFixed(0)}%
                  </span>
                ) : "—"}
              </td>
              <td style={{ ...tdStyle(), textAlign: "center" }}>
                <div style={{ display: "flex", gap: 3, justifyContent: "center" }}>
                  {co.productionAreas.map((area: number) => (
                    <div
                      key={area}
                      title={`Area ${area}`}
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        background: TRAFFIC_COLORS[trafficLights[area]] || "#484f58",
                      }}
                    />
                  ))}
                </div>
              </td>
              <td style={tdStyle()}>
                <span style={{
                  color: getRiskColor(co.riskScore),
                  fontWeight: 700,
                  fontSize: 13,
                }}>
                  {co.riskScore != null ? co.riskScore.toFixed(0) : "—"}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
