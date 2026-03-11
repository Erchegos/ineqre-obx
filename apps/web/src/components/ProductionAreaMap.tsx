"use client";

import { useState, useMemo } from "react";
import dynamic from "next/dynamic";
import type { Locality } from "./ProductionAreaMapInner";

type ProductionArea = {
  areaNumber: number;
  name: string;
  trafficLight: string;
  capacityChangePct: number | null;
  centerLat: number;
  centerLng: number;
  localityCount: number;
  avgLice: number | null;
  notes: string | null;
};

type FocusLocation = { lat: number; lng: number; name: string } | null;

type BiomassAreaData = {
  area_number: number;
  biomass_tonnes: number;
  harvest_tonnes: number;
  stock_count: number;
};

type Props = {
  areas: ProductionArea[];
  localities: Locality[];
  selectedTicker: string | null;
  onTickerSelect: (ticker: string | null) => void;
  focusLocation?: FocusLocation;
  biomassData?: BiomassAreaData[];
};

const TRAFFIC_COLORS: Record<string, string> = {
  green: "#22c55e",
  yellow: "#f59e0b",
  red: "#ef4444",
};

const TICKER_COLORS: Record<string, string> = {
  MOWI: "#2563eb",
  SALM: "#16a34a",
  LSG: "#9333ea",
  GSF: "#ea580c",
  BAKKA: "#0891b2",
  AUSS: "#dc2626",
};

const MapInner = dynamic(() => import("./ProductionAreaMapInner"), {
  ssr: false,
  loading: () => (
    <div style={{
      height: "100%",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "#0a0a0a",
      color: "#555",
      fontSize: 11,
      fontFamily: "'Geist Mono','SF Mono','Consolas',monospace",
    }}>
      Loading map...
    </div>
  ),
});

export default function ProductionAreaMap({ areas, localities, selectedTicker, onTickerSelect, focusLocation, biomassData }: Props) {
  const [hideNoData, setHideNoData] = useState(false);
  const [tempOnly, setTempOnly] = useState(false);

  // Collect unique tickers from localities
  const tickers: string[] = [];
  const tickerCounts: Record<string, number> = {};
  for (const loc of localities) {
    if (loc.ticker) {
      tickerCounts[loc.ticker] = (tickerCounts[loc.ticker] || 0) + 1;
      if (!tickers.includes(loc.ticker)) tickers.push(loc.ticker);
    }
  }
  tickers.sort();

  // Apply visibility filters
  const filteredLocalities = useMemo(() => {
    let result = localities;
    if (hideNoData) result = result.filter(l => l.latestLice != null);
    if (tempOnly) result = result.filter(l => l.latestTemp != null);
    return result;
  }, [localities, hideNoData, tempOnly]);

  const hiddenCount = localities.length - filteredLocalities.length;

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      {/* Header bar */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 10px", background: "#0d0d0d", borderBottom: "1px solid #1a1a1a" }}>
        <div style={{ fontSize: 10, color: "#888", fontFamily: "'Geist Mono','SF Mono','Consolas',monospace" }}>
          {areas.length} production areas | {filteredLocalities.length} active localities
          {hiddenCount > 0 && <span style={{ color: "#555" }}> ({hiddenCount} hidden)</span>}
          {selectedTicker && (
            <span style={{ color: TICKER_COLORS[selectedTicker] || "#58a6ff", marginLeft: 8 }}>
              | {selectedTicker}: {tickerCounts[selectedTicker] || 0} sites
            </span>
          )}
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {["green", "yellow", "red"].map(color => {
            const count = areas.filter(a => a.trafficLight === color).length;
            return (
              <div key={color} style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 10, fontFamily: "'Geist Mono','SF Mono','Consolas',monospace" }}>
                <div style={{
                  width: 8, height: 8, borderRadius: "50%",
                  background: TRAFFIC_COLORS[color],
                }} />
                <span style={{ color: "#888" }}>{count}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Company filter bar */}
      <div style={{
        display: "flex", gap: 4, padding: "3px 10px", background: "#0a0a0a",
        borderBottom: "1px solid #1a1a1a", alignItems: "center", flexWrap: "wrap",
      }}>
        <span style={{ fontSize: 9, color: "#555", fontFamily: "'Geist Mono','SF Mono','Consolas',monospace", marginRight: 2 }}>FILTER:</span>
        <button
          onClick={() => onTickerSelect(null)}
          style={{
            padding: "1px 6px", borderRadius: 2, border: `1px solid ${!selectedTicker ? "#666" : "#333"}`,
            background: !selectedTicker ? "#222" : "transparent", color: !selectedTicker ? "#ccc" : "#666",
            fontFamily: "'Geist Mono','SF Mono','Consolas',monospace", fontSize: 9, fontWeight: 600,
            cursor: "pointer", letterSpacing: "0.04em",
          }}
        >
          ALL
        </button>
        {tickers.map(t => {
          const active = selectedTicker === t;
          const col = TICKER_COLORS[t] || "#58a6ff";
          return (
            <button
              key={t}
              onClick={() => onTickerSelect(active ? null : t)}
              style={{
                padding: "1px 6px", borderRadius: 2,
                border: `1px solid ${active ? col : "#333"}`,
                background: active ? col : "transparent",
                color: active ? "#fff" : "#888",
                fontFamily: "'Geist Mono','SF Mono','Consolas',monospace",
                fontSize: 9, fontWeight: 600, cursor: "pointer", letterSpacing: "0.04em",
              }}
            >
              {t}
              <span style={{ marginLeft: 3, opacity: 0.7, fontSize: 8 }}>{tickerCounts[t]}</span>
            </button>
          );
        })}

        {/* Separator + visibility filters */}
        {localities.length > 0 && <>
          <span style={{ color: "#333", margin: "0 4px" }}>|</span>
          <button
            onClick={() => setHideNoData(v => !v)}
            style={{
              padding: "1px 6px", borderRadius: 2,
              border: `1px solid ${hideNoData ? "#f59e0b" : "#333"}`,
              background: hideNoData ? "rgba(245,158,11,0.15)" : "transparent",
              color: hideNoData ? "#f59e0b" : "#666",
              fontFamily: "'Geist Mono','SF Mono','Consolas',monospace",
              fontSize: 9, fontWeight: 600, cursor: "pointer", letterSpacing: "0.04em",
            }}
          >
            HIDE NO-DATA
          </button>
          <button
            onClick={() => setTempOnly(v => !v)}
            style={{
              padding: "1px 6px", borderRadius: 2,
              border: `1px solid ${tempOnly ? "#2563eb" : "#333"}`,
              background: tempOnly ? "rgba(37,99,235,0.15)" : "transparent",
              color: tempOnly ? "#58a6ff" : "#666",
              fontFamily: "'Geist Mono','SF Mono','Consolas',monospace",
              fontSize: 9, fontWeight: 600, cursor: "pointer", letterSpacing: "0.04em",
            }}
          >
            HAS TEMP
          </button>
        </>}
      </div>

      <div style={{ flex: 1, minHeight: 0 }}>
        <MapInner areas={areas} localities={filteredLocalities} selectedTicker={selectedTicker} focusLocation={focusLocation} biomassData={biomassData} />
      </div>
    </div>
  );
}
