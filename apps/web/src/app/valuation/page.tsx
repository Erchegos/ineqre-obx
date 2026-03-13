"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useState, useMemo, useCallback } from "react";
import { fetchBulkValuation, ValuationRow } from "@/lib/valuationData";
import {
  loadValuationEdits,
  clearValuationEdits,
  ValuationEdits,
} from "@/lib/valuationStorage";
import ValuationToolbar from "@/components/ValuationToolbar";

const ValuationSpreadsheet = dynamic(
  () => import("@/components/ValuationSpreadsheet"),
  {
    ssr: false,
    loading: () => (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "400px",
          color: "#9E9E9E",
        }}
      >
        Loading spreadsheet...
      </div>
    ),
  }
);

export default function ValuationPage() {
  const [rows, setRows] = useState<ValuationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSector, setSelectedSector] = useState("All");
  const [edits, setEdits] = useState<ValuationEdits>({});
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const data = await fetchBulkValuation();
        setRows(data);
        setEdits(loadValuationEdits());
      } catch (e) {
        console.error("Failed to load valuation data:", e);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [refreshKey]);

  const sectors = useMemo(() => {
    const s = new Set(rows.map((r) => r.sector).filter(Boolean));
    return Array.from(s).sort();
  }, [rows]);

  const filteredRows = useMemo(() => {
    if (selectedSector === "All") return rows;
    return rows.filter((r) => r.sector === selectedSector);
  }, [rows, selectedSector]);

  const handleRefresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  const handleReset = useCallback(() => {
    clearValuationEdits();
    setEdits({});
    setRefreshKey((k) => k + 1);
  }, []);

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#0d1117",
        color: "#e0e0e0",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "16px 24px 12px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          borderBottom: "1px solid #222",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <Link
            href="/"
            style={{
              color: "#9E9E9E",
              textDecoration: "none",
              fontSize: "13px",
            }}
          >
            InEqRe
          </Link>
          <span style={{ color: "#333" }}>/</span>
          <h1
            style={{
              margin: 0,
              fontSize: "18px",
              fontWeight: 700,
              letterSpacing: "0.5px",
              fontFamily: "monospace",
            }}
          >
            VALUATION COMPS
          </h1>
        </div>
        <div style={{ display: "flex", gap: "8px", fontSize: "12px" }}>
          <Link
            href="/stocks"
            style={{
              color: "#64B5F6",
              textDecoration: "none",
              padding: "4px 10px",
              border: "1px solid #333",
              borderRadius: "4px",
            }}
          >
            STOCKS
          </Link>
          <Link
            href="/portfolio"
            style={{
              color: "#64B5F6",
              textDecoration: "none",
              padding: "4px 10px",
              border: "1px solid #333",
              borderRadius: "4px",
            }}
          >
            PORTFOLIO
          </Link>
        </div>
      </div>

      {/* Toolbar */}
      <ValuationToolbar
        sectors={sectors}
        selectedSector={selectedSector}
        onSectorChange={setSelectedSector}
        onRefresh={handleRefresh}
        onReset={handleReset}
        stockCount={filteredRows.length}
        editCount={Object.keys(edits).length}
      />

      {/* Info bar */}
      <div
        style={{
          padding: "6px 16px",
          fontSize: "11px",
          color: "#666",
          background: "#0d1117",
          borderBottom: "1px solid #222",
          fontFamily: "monospace",
        }}
      >
        Edit Target Price, Custom EPS, and Notes columns directly. Implied
        Upside auto-calculates. Edits persist in browser localStorage.
      </div>

      {/* Spreadsheet */}
      {loading ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            height: "400px",
            color: "#9E9E9E",
          }}
        >
          Loading valuation data...
        </div>
      ) : (
        <ValuationSpreadsheet
          key={refreshKey}
          sectorFilter={selectedSector}
        />
      )}
    </div>
  );
}
