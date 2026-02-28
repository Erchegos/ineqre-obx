"use client";

import { useEffect } from "react";
import { MapContainer, TileLayer, CircleMarker, Popup, useMap } from "react-leaflet";

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

function getLiceColor(lice: number | null): string {
  if (lice == null) return "#484f58";
  if (lice < 0.2) return "#22c55e";
  if (lice < 0.5) return "#f59e0b";
  return "#ef4444";
}

// Custom dark map style override
function MapStyler() {
  const map = useMap();
  useEffect(() => {
    // Apply dark filter to tile layer
    const container = map.getContainer();
    const tilePane = container.querySelector(".leaflet-tile-pane") as HTMLElement;
    if (tilePane) {
      tilePane.style.filter = "invert(1) hue-rotate(180deg) brightness(0.8) contrast(1.2) saturate(0.3)";
    }
  }, [map]);
  return null;
}

export default function ProductionAreaMapInner({ areas, localities }: Props) {
  return (
    <div style={{ height: "100%", overflow: "hidden", border: "none" }}>
      <MapContainer
        center={[65, 14]}
        zoom={5}
        style={{ height: "100%", width: "100%", background: "#0a0a0a" }}
        scrollWheelZoom={true}
        zoomControl={true}
      >
        <TileLayer
          attribution='&copy; <a href="https://osm.org/copyright">OSM</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <MapStyler />

        {/* Production area center markers */}
        {areas.map((area) => (
          <CircleMarker
            key={`area-${area.areaNumber}`}
            center={[area.centerLat, area.centerLng]}
            radius={18}
            pathOptions={{
              fillColor: TRAFFIC_COLORS[area.trafficLight] || "#484f58",
              fillOpacity: 0.25,
              color: TRAFFIC_COLORS[area.trafficLight] || "#484f58",
              weight: 2,
            }}
          >
            <Popup>
              <div style={{ fontSize: 13, minWidth: 180 }}>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>
                  Area {area.areaNumber}: {area.name}
                </div>
                <div>
                  Status:{" "}
                  <span style={{ color: TRAFFIC_COLORS[area.trafficLight], fontWeight: 600 }}>
                    {area.trafficLight.toUpperCase()}
                  </span>
                </div>
                {area.capacityChangePct != null && (
                  <div>Capacity: {area.capacityChangePct > 0 ? "+" : ""}{area.capacityChangePct}%</div>
                )}
                <div>Localities: {area.localityCount}</div>
                {area.avgLice != null && (
                  <div>Avg lice: {area.avgLice.toFixed(3)}</div>
                )}
                {area.notes && (
                  <div style={{ fontSize: 11, color: "#666", marginTop: 4 }}>{area.notes}</div>
                )}
              </div>
            </Popup>
          </CircleMarker>
        ))}

        {/* Locality markers (smaller) */}
        {localities.map((loc) => (
          <CircleMarker
            key={`loc-${loc.localityId}`}
            center={[loc.lat, loc.lng]}
            radius={4}
            pathOptions={{
              fillColor: getLiceColor(loc.latestLice),
              fillOpacity: 0.8,
              color: getLiceColor(loc.latestLice),
              weight: 1,
            }}
          >
            <Popup>
              <div style={{ fontSize: 12, minWidth: 160 }}>
                <div style={{ fontWeight: 600 }}>{loc.name}</div>
                {loc.companyName && <div>{loc.companyName}</div>}
                {loc.ticker && <div>Ticker: {loc.ticker}</div>}
                {loc.latestLice != null && (
                  <div>
                    Lice:{" "}
                    <span style={{ color: getLiceColor(loc.latestLice), fontWeight: 600 }}>
                      {loc.latestLice.toFixed(3)}
                    </span>
                  </div>
                )}
                <div>Area: {loc.productionArea}</div>
              </div>
            </Popup>
          </CircleMarker>
        ))}
      </MapContainer>
    </div>
  );
}
