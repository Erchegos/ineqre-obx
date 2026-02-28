"use client";

import dynamic from "next/dynamic";

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

type Locality = {
  localityId: number;
  name: string;
  companyName: string | null;
  ticker: string | null;
  lat: number;
  lng: number;
  latestLice: number | null;
  productionArea: number;
};

type Props = {
  areas: ProductionArea[];
  localities: Locality[];
};

const TRAFFIC_COLORS: Record<string, string> = {
  green: "#22c55e",
  yellow: "#f59e0b",
  red: "#ef4444",
};

// Dynamically import the map to avoid SSR issues with Leaflet
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

export default function ProductionAreaMap({ areas, localities }: Props) {
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 10px", background: "#0d0d0d", borderBottom: "1px solid #1a1a1a" }}>
        <div style={{ fontSize: 10, color: "#888", fontFamily: "'Geist Mono','SF Mono','Consolas',monospace" }}>
          {areas.length} production areas | {localities.length} active localities
        </div>
        <div style={{ display: "flex", gap: 10 }}>
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
      <div style={{ flex: 1, minHeight: 0 }}>
        <MapInner areas={areas} localities={localities} />
      </div>
    </div>
  );
}
