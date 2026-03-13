"use client";

import dynamic from "next/dynamic";
import type { HarvestVesselPosition, SlaughterhouseMarker, FarmMarker, RoutePoint, SelectedTrip } from "./HarvestMapInner";

type Props = {
  farms: FarmMarker[];
  slaughterhouses: SlaughterhouseMarker[];
  vessels: HarvestVesselPosition[];
  selectedTicker: string | null;
  onTickerSelect: (ticker: string | null) => void;
  focusVessel?: { lat: number; lng: number; name: string } | null;
  vesselRoute?: RoutePoint[];
  selectedVesselId?: number | null;
  onVesselClick?: (vesselId: number) => void;
  selectedTrip?: SelectedTrip | null;
};

const TICKER_COLORS: Record<string, string> = {
  MOWI: "#2563eb",
  SALM: "#16a34a",
  LSG: "#9333ea",
  GSF: "#ea580c",
  BAKKA: "#0891b2",
  AUSS: "#dc2626",
};

const TICKERS = ["MOWI", "SALM", "LSG", "GSF", "BAKKA", "AUSS"];

const MapInner = dynamic(() => import("./HarvestMapInner"), {
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
      Loading harvest map...
    </div>
  ),
});

export default function HarvestMap({ farms, slaughterhouses, vessels, selectedTicker, onTickerSelect, focusVessel, vesselRoute, selectedVesselId, onVesselClick, selectedTrip }: Props) {
  const activeVessels = vessels.filter(v => v.hasPosition);
  const inTransit = vessels.filter(v => v.status === "in_transit");
  const atFarm = vessels.filter(v => v.status === "at_farm");
  const atSH = vessels.filter(v => v.status === "at_slaughterhouse");

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      {/* Header bar */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 10px", background: "#0d0d0d", borderBottom: "1px solid #1a1a1a" }}>
        <div style={{ fontSize: 10, color: "#888", fontFamily: "'Geist Mono','SF Mono','Consolas',monospace" }}>
          {slaughterhouses.length} slaughterhouses | {farms.length} farms | {activeVessels.length} vessels tracked
        </div>
        <div style={{ display: "flex", gap: 6, fontSize: 9, fontFamily: "'Geist Mono','SF Mono','Consolas',monospace" }}>
          {atFarm.length > 0 && <span style={{ color: "#22c55e" }}>AT FARM: {atFarm.length}</span>}
          {inTransit.length > 0 && <span style={{ color: "#f59e0b" }}>TRANSIT: {inTransit.length}</span>}
          {atSH.length > 0 && <span style={{ color: "#ef4444" }}>AT SH: {atSH.length}</span>}
        </div>
      </div>

      {/* Company filter bar */}
      <div style={{
        display: "flex", gap: 4, padding: "3px 10px", background: "#0a0a0a",
        borderBottom: "1px solid #1a1a1a", alignItems: "center",
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
        {TICKERS.map(t => {
          const active = selectedTicker === t;
          const col = TICKER_COLORS[t];
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

      <div style={{ flex: 1, minHeight: 0 }}>
        <MapInner
          farms={farms}
          slaughterhouses={slaughterhouses}
          vessels={vessels}
          selectedTicker={selectedTicker}
          focusVessel={focusVessel}
          vesselRoute={vesselRoute}
          selectedVesselId={selectedVesselId}
          onVesselClick={onVesselClick}
          selectedTrip={selectedTrip}
        />
      </div>
    </div>
  );
}
