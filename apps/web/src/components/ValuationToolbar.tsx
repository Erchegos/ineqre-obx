"use client";

import { useState } from "react";
import {
  clearValuationEdits,
  loadValuationEdits,
} from "@/lib/valuationStorage";

type Props = {
  sectors: string[];
  selectedSector: string;
  onSectorChange: (sector: string) => void;
  onRefresh: () => void;
  onReset: () => void;
  stockCount: number;
  editCount: number;
};

export default function ValuationToolbar({
  sectors,
  selectedSector,
  onSectorChange,
  onRefresh,
  onReset,
  stockCount,
  editCount,
}: Props) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "12px",
        padding: "10px 16px",
        background: "#161b22",
        borderBottom: "1px solid #333",
        flexWrap: "wrap",
      }}
    >
      {/* Sector filter */}
      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
        <span style={{ color: "#9E9E9E", fontSize: "12px", fontWeight: 600, letterSpacing: "0.5px" }}>
          SECTOR
        </span>
        <select
          value={selectedSector}
          onChange={(e) => onSectorChange(e.target.value)}
          style={{
            background: "#1a1a2e",
            color: "#e0e0e0",
            border: "1px solid #333",
            borderRadius: "4px",
            padding: "4px 8px",
            fontSize: "13px",
            cursor: "pointer",
          }}
        >
          <option value="All">All Sectors</option>
          {sectors.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      {/* Stats */}
      <div style={{ display: "flex", gap: "16px", fontSize: "12px", color: "#9E9E9E" }}>
        <span>
          <span style={{ color: "#64B5F6", fontWeight: 600 }}>{stockCount}</span> stocks
        </span>
        {editCount > 0 && (
          <span>
            <span style={{ color: "#FFA726", fontWeight: 600 }}>{editCount}</span> edits
          </span>
        )}
      </div>

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Actions */}
      <div style={{ display: "flex", gap: "8px" }}>
        <button
          onClick={onRefresh}
          style={{
            background: "#1a1a2e",
            color: "#64B5F6",
            border: "1px solid #333",
            borderRadius: "4px",
            padding: "4px 12px",
            fontSize: "12px",
            cursor: "pointer",
            fontWeight: 600,
          }}
        >
          REFRESH
        </button>
        {editCount > 0 && (
          <button
            onClick={onReset}
            style={{
              background: "#1a1a2e",
              color: "#F44336",
              border: "1px solid #333",
              borderRadius: "4px",
              padding: "4px 12px",
              fontSize: "12px",
              cursor: "pointer",
              fontWeight: 600,
            }}
          >
            RESET EDITS
          </button>
        )}
      </div>

      <style>{`
        select:focus, button:focus {
          outline: 1px solid #64B5F6;
          outline-offset: 1px;
        }
        button:hover {
          opacity: 0.85;
        }
      `}</style>
    </div>
  );
}
