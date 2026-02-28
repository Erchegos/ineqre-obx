"use client";

import { useEffect, useMemo } from "react";
import { MapContainer, TileLayer, CircleMarker, Popup, useMap } from "react-leaflet";

export type ProductionArea = {
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

export type Locality = {
  localityId: number;
  name: string;
  companyName: string | null;
  ticker: string | null;
  municipality: string | null;
  productionArea: number;
  areaName: string | null;
  areaTrafficLight: string | null;
  lat: number;
  lng: number;
  hasBiomass: boolean;
  isActive: boolean;
  latestLice: number | null;
  latestMobile: number | null;
  latestStationary: number | null;
  latestTemp: number | null;
  hasCleaning: boolean;
  hasMechanicalRemoval: boolean;
  hasMedicinalTreatment: boolean;
  liceWeek: string | null;
};

type Props = {
  areas: ProductionArea[];
  localities: Locality[];
  selectedTicker: string | null;
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

function MapStyler() {
  const map = useMap();
  useEffect(() => {
    const container = map.getContainer();
    const tilePane = container.querySelector(".leaflet-tile-pane") as HTMLElement;
    if (tilePane) {
      tilePane.style.filter = "invert(1) hue-rotate(180deg) brightness(0.8) contrast(1.2) saturate(0.3)";
    }
  }, [map]);
  return null;
}

const MONO = "'Geist Mono','SF Mono','Consolas',monospace";

export default function ProductionAreaMapInner({ areas, localities, selectedTicker }: Props) {
  // Separate highlighted vs dimmed localities
  const { highlighted, dimmed } = useMemo(() => {
    if (!selectedTicker) return { highlighted: localities, dimmed: [] as Locality[] };
    const h: Locality[] = [];
    const d: Locality[] = [];
    for (const loc of localities) {
      if (loc.ticker === selectedTicker) h.push(loc);
      else d.push(loc);
    }
    return { highlighted: h, dimmed: d };
  }, [localities, selectedTicker]);

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
              <div style={{ fontSize: 12, minWidth: 200, fontFamily: MONO, color: "#222" }}>
                <div style={{ fontWeight: 700, marginBottom: 4, fontSize: 13 }}>
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

        {/* Dimmed locality markers (non-selected company) */}
        {dimmed.map((loc) => (
          <CircleMarker
            key={`loc-${loc.localityId}`}
            center={[loc.lat, loc.lng]}
            radius={3}
            pathOptions={{
              fillColor: "#333",
              fillOpacity: 0.3,
              color: "#333",
              weight: 0,
            }}
          >
            <Popup>{renderPopup(loc)}</Popup>
          </CircleMarker>
        ))}

        {/* Highlighted locality markers */}
        {highlighted.map((loc) => {
          const isSelected = !!selectedTicker;
          const liceColor = getLiceColor(loc.latestLice);
          return (
            <CircleMarker
              key={`loc-${loc.localityId}`}
              center={[loc.lat, loc.lng]}
              radius={isSelected ? 6 : 4}
              pathOptions={{
                fillColor: liceColor,
                fillOpacity: isSelected ? 0.95 : 0.8,
                color: isSelected ? "#fff" : liceColor,
                weight: isSelected ? 1.5 : 1,
              }}
            >
              <Popup>{renderPopup(loc)}</Popup>
            </CircleMarker>
          );
        })}
      </MapContainer>
    </div>
  );
}

function renderPopup(loc: Locality) {
  const liceColor = getLiceColor(loc.latestLice);
  const treatments: string[] = [];
  if (loc.hasCleaning) treatments.push("Cleaner fish");
  if (loc.hasMechanicalRemoval) treatments.push("Mechanical");
  if (loc.hasMedicinalTreatment) treatments.push("Medicinal");

  return (
    <div style={{ fontSize: 11, minWidth: 220, fontFamily: MONO, color: "#222", lineHeight: 1.5 }}>
      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 2 }}>{loc.name}</div>
      <div style={{ fontSize: 10, color: "#888", marginBottom: 6 }}>ID: {loc.localityId}</div>

      {loc.companyName && (
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span style={{ color: "#666" }}>Company</span>
          <span style={{ fontWeight: 600 }}>
            {loc.companyName}
            {loc.ticker && <span style={{ color: "#2563eb", marginLeft: 4 }}>[{loc.ticker}]</span>}
          </span>
        </div>
      )}

      {loc.municipality && (
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span style={{ color: "#666" }}>Municipality</span>
          <span>{loc.municipality}</span>
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <span style={{ color: "#666" }}>Production Area</span>
        <span>{loc.areaName ? `${loc.productionArea} — ${loc.areaName}` : `Area ${loc.productionArea}`}</span>
      </div>

      <div style={{ borderTop: "1px solid #ddd", marginTop: 6, paddingTop: 6 }}>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span style={{ color: "#666" }}>Adult Female Lice</span>
          <span style={{ color: liceColor, fontWeight: 700, fontSize: 13 }}>
            {loc.latestLice != null ? loc.latestLice.toFixed(2) : "—"}
          </span>
        </div>
        {loc.latestMobile != null && (
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: "#666" }}>Mobile Lice</span>
            <span>{loc.latestMobile.toFixed(2)}</span>
          </div>
        )}
        {loc.latestStationary != null && (
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: "#666" }}>Stationary Lice</span>
            <span>{loc.latestStationary.toFixed(2)}</span>
          </div>
        )}
        {loc.latestTemp != null && (
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: "#666" }}>Sea Temp</span>
            <span>{loc.latestTemp.toFixed(1)} °C</span>
          </div>
        )}
      </div>

      {treatments.length > 0 && (
        <div style={{ borderTop: "1px solid #ddd", marginTop: 4, paddingTop: 4 }}>
          <span style={{ color: "#666" }}>Treatment: </span>
          <span style={{ color: "#c2410c", fontWeight: 600 }}>{treatments.join(", ")}</span>
        </div>
      )}

      {loc.liceWeek && (
        <div style={{ fontSize: 10, color: "#999", marginTop: 4 }}>Report: {loc.liceWeek}</div>
      )}
    </div>
  );
}
