"use client";

import dynamic from "next/dynamic";

export type VesselMapItem = {
  imo: string;
  vessel_name: string;
  vessel_type: string;
  company_ticker: string;
  dwt: number | null;
  teu: number | null;
  cbm: number | null;
  built_year: number | null;
  status: string;
  latitude: number | null;
  longitude: number | null;
  speed_knots: number | null;
  heading: number | null;
  course: number | null;
  destination: string | null;
  destination_port_name: string | null;
  eta: string | null;
  nav_status: string | null;
  operational_status: string | null;
  current_region: string | null;
  reported_at: string | null;
  source: string | null;
  dataFreshness: string;
  contract_type: string | null;
  rate_usd_per_day: number | null;
  rate_worldscale: number | null;
  charterer: string | null;
  contract_start: string | null;
  contract_end: string | null;
  company_name: string;
  sector: string;
  color_hex: string;
};

export type PortItem = {
  port_name: string;
  country: string;
  latitude: number;
  longitude: number;
  port_type: string | null;
  region: string | null;
};

type FocusVessel = { lat: number; lng: number; name: string } | null;

type Props = {
  positions: VesselMapItem[];
  ports: PortItem[];
  selectedTicker: string | null;
  selectedSector: string | null;
  onTickerSelect: (ticker: string | null) => void;
  onSectorSelect: (sector: string | null) => void;
  focusVessel?: FocusVessel;
  compact?: boolean;
};

export const SECTOR_COLORS: Record<string, string> = {
  tanker: "#ef4444",
  dry_bulk: "#3b82f6",
  container: "#a855f7",
  car_carrier: "#eab308",
  chemical: "#14b8a6",
  gas: "#22c55e",
};

const SECTOR_LABELS: Record<string, string> = {
  tanker: "TANKER",
  dry_bulk: "BULK",
  container: "CONTAINER",
  car_carrier: "CAR",
  chemical: "CHEMICAL",
  gas: "GAS",
};

const MapInner = dynamic(() => import("./ShippingMapInner"), {
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

export default function ShippingMap({ positions, ports, selectedTicker, selectedSector, onTickerSelect, onSectorSelect, focusVessel, compact }: Props) {
  // Count by sector
  const sectorCounts: Record<string, number> = {};
  const tickerCounts: Record<string, number> = {};
  const tickers: string[] = [];
  for (const p of positions) {
    if (p.latitude == null) continue;
    sectorCounts[p.sector] = (sectorCounts[p.sector] || 0) + 1;
    tickerCounts[p.company_ticker] = (tickerCounts[p.company_ticker] || 0) + 1;
    if (!tickers.includes(p.company_ticker)) tickers.push(p.company_ticker);
  }
  tickers.sort();

  const filtered = positions.filter(p => {
    if (p.latitude == null) return false;
    if (selectedSector && p.sector !== selectedSector) return false;
    return true;
  });

  const visibleCount = selectedTicker
    ? filtered.filter(p => p.company_ticker === selectedTicker).length
    : filtered.length;

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      {/* Header bar */}
      {!compact && (
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 10px", background: "#0d0d0d", borderBottom: "1px solid #1a1a1a" }}>
        <div style={{ fontSize: 10, color: "#888", fontFamily: "'Geist Mono','SF Mono','Consolas',monospace" }}>
          {visibleCount} vessels
          {selectedTicker && (
            <span style={{ color: positions.find(p => p.company_ticker === selectedTicker)?.color_hex || "#58a6ff", marginLeft: 8 }}>
              | {selectedTicker}: {tickerCounts[selectedTicker] || 0}
            </span>
          )}
          {selectedSector && !selectedTicker && (
            <span style={{ color: SECTOR_COLORS[selectedSector] || "#888", marginLeft: 8 }}>
              | {SECTOR_LABELS[selectedSector] || selectedSector}
            </span>
          )}
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {Object.entries(SECTOR_LABELS).map(([key, label]) => {
            const count = sectorCounts[key] || 0;
            if (count === 0) return null;
            return (
              <div key={key} style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 9, fontFamily: "'Geist Mono','SF Mono','Consolas',monospace" }}>
                <div style={{ width: 7, height: 7, borderRadius: "50%", background: SECTOR_COLORS[key] }} />
                <span style={{ color: "#666" }}>{count}</span>
              </div>
            );
          })}
        </div>
      </div>
      )}

      {/* Sector filter bar */}
      {!compact && (
      <div style={{
        display: "flex", gap: 4, padding: "3px 10px", background: "#0a0a0a",
        borderBottom: "1px solid #1a1a1a", alignItems: "center", flexWrap: "wrap",
      }}>
        <span style={{ fontSize: 9, color: "#555", fontFamily: "'Geist Mono','SF Mono','Consolas',monospace", marginRight: 2 }}>SECTOR:</span>
        <button
          onClick={() => { onSectorSelect(null); onTickerSelect(null); }}
          style={{
            padding: "1px 6px", borderRadius: 2, border: `1px solid ${!selectedSector ? "#666" : "#333"}`,
            background: !selectedSector ? "#222" : "transparent", color: !selectedSector ? "#ccc" : "#666",
            fontFamily: "'Geist Mono','SF Mono','Consolas',monospace", fontSize: 9, fontWeight: 600,
            cursor: "pointer", letterSpacing: "0.04em",
          }}
        >
          ALL
        </button>
        {Object.entries(SECTOR_LABELS).map(([key, label]) => {
          const active = selectedSector === key;
          const col = SECTOR_COLORS[key];
          return (
            <button
              key={key}
              onClick={() => { onSectorSelect(active ? null : key); onTickerSelect(null); }}
              style={{
                padding: "1px 6px", borderRadius: 2,
                border: `1px solid ${active ? col : "#333"}`,
                background: active ? col : "transparent",
                color: active ? "#fff" : "#888",
                fontFamily: "'Geist Mono','SF Mono','Consolas',monospace",
                fontSize: 9, fontWeight: 600, cursor: "pointer", letterSpacing: "0.04em",
              }}
            >
              {label}
              <span style={{ marginLeft: 3, opacity: 0.7, fontSize: 8 }}>{sectorCounts[key] || 0}</span>
            </button>
          );
        })}
      </div>
      )}

      {/* Company filter bar */}
      {!compact && (
      <div style={{
        display: "flex", gap: 4, padding: "3px 10px", background: "#0a0a0a",
        borderBottom: "1px solid #1a1a1a", alignItems: "center", flexWrap: "wrap",
      }}>
        <span style={{ fontSize: 9, color: "#555", fontFamily: "'Geist Mono','SF Mono','Consolas',monospace", marginRight: 2 }}>COMPANY:</span>
        {tickers
          .filter(t => !selectedSector || positions.find(p => p.company_ticker === t)?.sector === selectedSector)
          .map(t => {
            const active = selectedTicker === t;
            const col = positions.find(p => p.company_ticker === t)?.color_hex || "#58a6ff";
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
              </button>
            );
          })}
      </div>
      )}

      <div style={{ flex: 1, minHeight: 0 }}>
        <MapInner positions={filtered} ports={ports} selectedTicker={selectedTicker} focusVessel={focusVessel} />
      </div>
    </div>
  );
}
