"use client";

/**
 * ConstituentHeatmap — Sortable grid of OBX constituent volatility data.
 *
 * Displays: ticker, regime (color-coded), vol, percentile, trend.
 * Clickable rows navigate to per-stock volatility page.
 * Sortable by any column.
 */

import { useState, useMemo } from "react";
import Link from "next/link";

type Constituent = {
  ticker: string;
  regime: string;
  regimeColor: string;
  vol: number | null;
  rolling20: number | null;
  rolling60: number | null;
  percentile: number | null;
  trend: string;
  lastClose: number | null;
  lastDate: string | null;
  dataPoints: number;
};

type SortKey = "ticker" | "vol" | "percentile" | "trend" | "regime";
type SortDir = "asc" | "desc";

type Props = {
  constituents: Constituent[];
};

const REGIME_ORDER: Record<string, number> = {
  Crisis: 0,
  "Extreme High": 1,
  Elevated: 2,
  Normal: 3,
  "Low & Contracting": 4,
  "Low & Stable": 5,
};

export default function ConstituentHeatmap({ constituents }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("vol");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const sorted = useMemo(() => {
    return [...constituents].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "ticker":
          cmp = a.ticker.localeCompare(b.ticker);
          break;
        case "vol":
          cmp = (a.vol ?? 0) - (b.vol ?? 0);
          break;
        case "percentile":
          cmp = (a.percentile ?? 0) - (b.percentile ?? 0);
          break;
        case "trend":
          cmp = a.trend.localeCompare(b.trend);
          break;
        case "regime":
          cmp = (REGIME_ORDER[a.regime] ?? 9) - (REGIME_ORDER[b.regime] ?? 9);
          break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [constituents, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "ticker" ? "asc" : "desc");
    }
  };

  const SortHeader = ({ label, sKey, align }: { label: string; sKey: SortKey; align?: string }) => (
    <th
      onClick={() => toggleSort(sKey)}
      style={{
        ...thStyle,
        cursor: "pointer",
        textAlign: (align as any) || "left",
        userSelect: "none",
      }}
    >
      {label} {sortKey === sKey ? (sortDir === "asc" ? "↑" : "↓") : ""}
    </th>
  );

  const pctBar = (pct: number | null) => {
    if (pct === null) return null;
    const width = Math.max(0, Math.min(100, pct));
    const color =
      pct > 85 ? "#F44336" : pct > 65 ? "#FF9800" : pct > 30 ? "#9E9E9E" : "#4CAF50";
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <div style={{ width: 40, height: 4, borderRadius: 2, background: "var(--border)", overflow: "hidden" }}>
          <div style={{ width: `${width}%`, height: "100%", borderRadius: 2, background: color }} />
        </div>
        <span>{pct.toFixed(0)}</span>
      </div>
    );
  };

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "monospace", fontSize: 12 }}>
        <thead>
          <tr>
            <SortHeader label="Ticker" sKey="ticker" />
            <SortHeader label="Regime" sKey="regime" />
            <SortHeader label="Vol (ann.)" sKey="vol" align="right" />
            <th style={{ ...thStyle, textAlign: "right" }}>20d</th>
            <th style={{ ...thStyle, textAlign: "right" }}>60d</th>
            <SortHeader label="Pctile" sKey="percentile" align="right" />
            <SortHeader label="Trend" sKey="trend" />
            <th style={{ ...thStyle, textAlign: "right" }}>Close</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((c) => (
            <tr
              key={c.ticker}
              style={{ transition: "background 0.1s" }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--hover-bg)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              <td style={{ ...tdStyle }}>
                <Link
                  href={`/volatility/${encodeURIComponent(c.ticker)}`}
                  style={{
                    color: "var(--foreground)",
                    textDecoration: "none",
                    fontWeight: 700,
                  }}
                >
                  {c.ticker}
                </Link>
              </td>
              <td style={{ ...tdStyle }}>
                <span
                  style={{
                    padding: "2px 6px",
                    borderRadius: 3,
                    fontSize: 10,
                    fontWeight: 600,
                    background: `${c.regimeColor}15`,
                    color: c.regimeColor,
                    border: `1px solid ${c.regimeColor}33`,
                    whiteSpace: "nowrap",
                  }}
                >
                  {c.regime}
                </span>
              </td>
              <td style={{ ...tdStyle, textAlign: "right", fontWeight: 700 }}>
                {c.vol !== null ? `${(c.vol * 100).toFixed(1)}%` : "—"}
              </td>
              <td style={{ ...tdStyle, textAlign: "right" }}>
                {c.rolling20 !== null ? `${(c.rolling20 * 100).toFixed(1)}%` : "—"}
              </td>
              <td style={{ ...tdStyle, textAlign: "right" }}>
                {c.rolling60 !== null ? `${(c.rolling60 * 100).toFixed(1)}%` : "—"}
              </td>
              <td style={{ ...tdStyle, textAlign: "right" }}>{pctBar(c.percentile)}</td>
              <td style={{ ...tdStyle }}>
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 600,
                    color:
                      c.trend === "Expanding"
                        ? "#F44336"
                        : c.trend === "Contracting"
                          ? "#4CAF50"
                          : "var(--muted-foreground)",
                  }}
                >
                  {c.trend === "Expanding" ? "▲" : c.trend === "Contracting" ? "▼" : "—"} {c.trend}
                </span>
              </td>
              <td style={{ ...tdStyle, textAlign: "right" }}>
                {c.lastClose !== null ? c.lastClose.toFixed(2) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const thStyle: React.CSSProperties = {
  padding: "6px 8px",
  fontSize: 10,
  fontWeight: 600,
  color: "var(--muted-foreground)",
  textTransform: "uppercase" as const,
  letterSpacing: "0.05em",
  borderBottom: "2px solid var(--border)",
  textAlign: "left" as const,
  whiteSpace: "nowrap",
};

const tdStyle: React.CSSProperties = {
  padding: "5px 8px",
  color: "var(--foreground)",
  borderBottom: "1px solid var(--border)",
};
