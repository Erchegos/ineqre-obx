"use client";

import { useEffect, useMemo } from "react";
import { MapContainer, TileLayer, CircleMarker, Polyline, Popup, useMap } from "react-leaflet";

export type HarvestVesselPosition = {
  vessel_id: number;
  vessel_name: string;
  owner_company: string | null;
  operator_ticker: string | null;
  capacity_tonnes: number | null;
  lat: number | null;
  lng: number | null;
  speed_knots: number | null;
  heading: number | null;
  status: string;
  hasPosition: boolean;
  reported_at?: string | null;
  mmsi?: string | null;
};

export type SlaughterhouseMarker = {
  id: number;
  name: string;
  company_name: string;
  ticker: string;
  lat: number;
  lng: number;
  capacity_tonnes_day: number | null;
  municipality: string | null;
};

export type FarmMarker = {
  localityId: number;
  name: string;
  ticker: string | null;
  lat: number;
  lng: number;
};

export type RoutePoint = {
  lat: number;
  lng: number;
  timestamp: string;
  speed_knots: number | null;
  nearFarm?: { name: string; ticker: string | null; distNm: number } | null;
  nearSlaughterhouse?: { name: string; ticker: string; distNm: number } | null;
};

type FocusVessel = { lat: number; lng: number; name: string } | null;

export type SelectedTrip = {
  id: number;
  vessel_name: string;
  origin_name: string | null;
  origin_ticker: string | null;
  destination_name: string | null;
  origin_lat: number;
  origin_lng: number;
  dest_lat: number;
  dest_lng: number;
  departure_time: string;
  arrival_time: string | null;
  duration_hours: number | null;
  estimated_volume_tonnes: number | null;
  spot_price_at_harvest: number | null;
};

type Props = {
  farms: FarmMarker[];
  slaughterhouses: SlaughterhouseMarker[];
  vessels: HarvestVesselPosition[];
  selectedTicker: string | null;
  focusVessel?: FocusVessel;
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

const STATUS_COLORS: Record<string, string> = {
  at_farm: "#22c55e",
  in_transit: "#f59e0b",
  at_slaughterhouse: "#ef4444",
  idle: "#666",
  unknown: "#444",
};

const MONO = "'Geist Mono','SF Mono','Consolas',monospace";

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

function FlyToVessel({ focusVessel }: { focusVessel: FocusVessel }) {
  const map = useMap();
  useEffect(() => {
    if (!focusVessel) return;
    const target: [number, number] = [focusVessel.lat, focusVessel.lng];
    const currentZoom = map.getZoom();
    const container = map.getContainer();

    if (11 - currentZoom > 3) {
      container.style.transition = "opacity 0.3s ease-out";
      container.style.opacity = "0";
      setTimeout(() => {
        map.setView(target, 11, { animate: false });
        setTimeout(() => {
          container.style.transition = "opacity 0.5s ease-in";
          container.style.opacity = "1";
        }, 100);
      }, 300);
    } else {
      map.flyTo(target, 11, { duration: 1.0, easeLinearity: 0.15 });
    }
  }, [map, focusVessel]);
  return null;
}

function formatAge(ts: string | null | undefined): string {
  if (!ts) return "—";
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function FlyToTrip({ trip }: { trip: SelectedTrip | null | undefined }) {
  const map = useMap();
  useEffect(() => {
    if (!trip) return;
    const bounds: [[number, number], [number, number]] = [
      [Math.min(trip.origin_lat, trip.dest_lat) - 0.3, Math.min(trip.origin_lng, trip.dest_lng) - 0.5],
      [Math.max(trip.origin_lat, trip.dest_lat) + 0.3, Math.max(trip.origin_lng, trip.dest_lng) + 0.5],
    ];
    map.flyToBounds(bounds, { duration: 1.0, padding: [30, 30] });
  }, [map, trip]);
  return null;
}

export default function HarvestMapInner({ farms, slaughterhouses, vessels, selectedTicker, focusVessel, vesselRoute, selectedVesselId, onVesselClick, selectedTrip }: Props) {
  const filteredFarms = useMemo(() => {
    if (!selectedTicker) return farms;
    return farms.filter(f => f.ticker === selectedTicker);
  }, [farms, selectedTicker]);

  const filteredSH = useMemo(() => {
    if (!selectedTicker) return slaughterhouses;
    return slaughterhouses.filter(s => s.ticker === selectedTicker);
  }, [slaughterhouses, selectedTicker]);

  // Active trip lines: in_transit vessels → nearest slaughterhouse
  const tripLines = useMemo(() => {
    const lines: Array<{ from: [number, number]; to: [number, number]; name: string }> = [];
    for (const v of vessels) {
      if (v.status === "in_transit" && v.lat && v.lng) {
        let nearest: SlaughterhouseMarker | null = null;
        let minDist = Infinity;
        for (const sh of slaughterhouses) {
          const d = Math.sqrt((v.lat - sh.lat) ** 2 + ((v.lng ?? 0) - sh.lng) ** 2);
          if (d < minDist) { minDist = d; nearest = sh; }
        }
        if (nearest) {
          lines.push({ from: [v.lat, v.lng ?? 0], to: [nearest.lat, nearest.lng], name: v.vessel_name });
        }
      }
    }
    return lines;
  }, [vessels, slaughterhouses]);

  // Route polyline from position history
  const routePositions = useMemo(() => {
    if (!vesselRoute || vesselRoute.length < 2) return null;
    return vesselRoute.map(p => [p.lat, p.lng] as [number, number]);
  }, [vesselRoute]);

  return (
    <div style={{ height: "100%", overflow: "hidden" }}>
      <MapContainer
        center={[65, 12]}
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
        <FlyToVessel focusVessel={focusVessel ?? null} />
        <FlyToTrip trip={selectedTrip} />

        {/* Selected trip route (farm → slaughterhouse) */}
        {selectedTrip && (
          <>
            <Polyline
              positions={[[selectedTrip.origin_lat, selectedTrip.origin_lng], [selectedTrip.dest_lat, selectedTrip.dest_lng]]}
              pathOptions={{ color: "#f59e0b", weight: 3, dashArray: "8 6", opacity: 0.9 }}
            />
            {/* Origin farm marker */}
            <CircleMarker
              center={[selectedTrip.origin_lat, selectedTrip.origin_lng]}
              radius={10}
              pathOptions={{ fillColor: "#22c55e", fillOpacity: 0.9, color: "#fff", weight: 2 }}
            >
              <Popup>
                <div style={{ fontSize: 11, minWidth: 220, fontFamily: MONO, color: "#222", lineHeight: 1.6 }}>
                  <div style={{ fontWeight: 700, fontSize: 12, color: "#16a34a", marginBottom: 2 }}>FARM: {selectedTrip.origin_name}</div>
                  {selectedTrip.origin_ticker && <div style={{ color: "#2563eb" }}>[{selectedTrip.origin_ticker}]</div>}
                  <div style={{ borderTop: "1px solid #ddd", marginTop: 4, paddingTop: 4, fontSize: 10 }}>
                    <div>Vessel: {selectedTrip.vessel_name}</div>
                    <div>Departure: {new Date(selectedTrip.departure_time).toLocaleString("no-NO", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</div>
                    {selectedTrip.estimated_volume_tonnes && <div>Est. volume: {selectedTrip.estimated_volume_tonnes.toFixed(0)}t</div>}
                    {selectedTrip.spot_price_at_harvest && <div style={{ color: "#ea580c" }}>Spot: NOK {selectedTrip.spot_price_at_harvest.toFixed(1)}/kg</div>}
                  </div>
                </div>
              </Popup>
            </CircleMarker>
            {/* Destination slaughterhouse marker */}
            <CircleMarker
              center={[selectedTrip.dest_lat, selectedTrip.dest_lng]}
              radius={10}
              pathOptions={{ fillColor: "#f97316", fillOpacity: 0.9, color: "#fff", weight: 2 }}
            >
              <Popup>
                <div style={{ fontSize: 11, minWidth: 200, fontFamily: MONO, color: "#222", lineHeight: 1.6 }}>
                  <div style={{ fontWeight: 700, fontSize: 12, color: "#ea580c", marginBottom: 2 }}>SLAUGHTERHOUSE: {selectedTrip.destination_name}</div>
                  <div style={{ borderTop: "1px solid #ddd", marginTop: 4, paddingTop: 4, fontSize: 10 }}>
                    {selectedTrip.arrival_time && <div>Arrival: {new Date(selectedTrip.arrival_time).toLocaleString("no-NO", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</div>}
                    {selectedTrip.duration_hours && <div>Duration: {selectedTrip.duration_hours.toFixed(1)}h</div>}
                  </div>
                </div>
              </Popup>
            </CircleMarker>
          </>
        )}

        {/* Route trail for selected vessel */}
        {routePositions && (
          <>
            <Polyline
              positions={routePositions}
              pathOptions={{ color: "#60a5fa", weight: 2.5, opacity: 0.8 }}
            />
            {/* Route dots — colored by proximity to farm/slaughterhouse */}
            {vesselRoute!.map((p, i) => {
              const nearFarm = p.nearFarm;
              const nearSH = p.nearSlaughterhouse;
              const dotColor = nearFarm ? "#22c55e" : nearSH ? "#f97316" : "#60a5fa";
              const dotRadius = nearFarm || nearSH ? 5 : 3;
              return (
                <CircleMarker
                  key={`route-${i}`}
                  center={[p.lat, p.lng]}
                  radius={dotRadius}
                  pathOptions={{ fillColor: dotColor, fillOpacity: nearFarm || nearSH ? 0.9 : 0.6, color: dotColor, weight: 1, opacity: 0.5 }}
                >
                  <Popup>
                    <div style={{ fontSize: 10, fontFamily: MONO, color: "#222", lineHeight: 1.5 }}>
                      <div>{new Date(p.timestamp).toLocaleString("no-NO", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</div>
                      {p.speed_knots != null && <div>Speed: {p.speed_knots.toFixed(1)} kn</div>}
                      {nearFarm && (
                        <div style={{ color: "#16a34a", fontWeight: 700, borderTop: "1px solid #ddd", marginTop: 2, paddingTop: 2 }}>
                          Near farm: {nearFarm.name} ({nearFarm.distNm}nm)
                          {nearFarm.ticker && <span> [{nearFarm.ticker}]</span>}
                        </div>
                      )}
                      {nearSH && (
                        <div style={{ color: "#ea580c", fontWeight: 700, borderTop: "1px solid #ddd", marginTop: 2, paddingTop: 2 }}>
                          Near slaughterhouse: {nearSH.name} ({nearSH.distNm}nm)
                          <span> [{nearSH.ticker}]</span>
                        </div>
                      )}
                    </div>
                  </Popup>
                </CircleMarker>
              );
            })}
          </>
        )}

        {/* Farm localities — small dots */}
        {filteredFarms.map(f => (
          <CircleMarker
            key={`farm-${f.localityId}`}
            center={[f.lat, f.lng]}
            radius={2}
            pathOptions={{
              fillColor: TICKER_COLORS[f.ticker || ""] || "#484f58",
              fillOpacity: 0.5,
              color: TICKER_COLORS[f.ticker || ""] || "#484f58",
              weight: 0,
            }}
          >
            <Popup>
              <div style={{ fontSize: 11, minWidth: 160, fontFamily: MONO, color: "#222" }}>
                <div style={{ fontWeight: 700 }}>{f.name}</div>
                {f.ticker && <div style={{ color: "#2563eb" }}>[{f.ticker}]</div>}
                <div style={{ fontSize: 10, color: "#888" }}>Fish Farm</div>
              </div>
            </Popup>
          </CircleMarker>
        ))}

        {/* Slaughterhouses */}
        {filteredSH.map(sh => (
          <CircleMarker
            key={`sh-${sh.id}`}
            center={[sh.lat, sh.lng]}
            radius={7}
            pathOptions={{ fillColor: "#f97316", fillOpacity: 0.9, color: "#fff", weight: 2 }}
          >
            <Popup>
              <div style={{ fontSize: 11, minWidth: 200, fontFamily: MONO, color: "#222", lineHeight: 1.5 }}>
                <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 2 }}>{sh.name}</div>
                <div style={{ color: TICKER_COLORS[sh.ticker] || "#888" }}>[{sh.ticker}] {sh.company_name}</div>
                {sh.municipality && <div style={{ color: "#666" }}>{sh.municipality}</div>}
                {sh.capacity_tonnes_day && (
                  <div style={{ borderTop: "1px solid #ddd", marginTop: 4, paddingTop: 4 }}>
                    Capacity: {sh.capacity_tonnes_day}t/day
                  </div>
                )}
              </div>
            </Popup>
          </CircleMarker>
        ))}

        {/* Active trip lines (dashed) */}
        {tripLines.map((line, i) => (
          <Polyline
            key={`trip-${i}`}
            positions={[line.from, line.to]}
            pathOptions={{ color: "#f59e0b", weight: 2, dashArray: "6 4", opacity: 0.7 }}
          />
        ))}

        {/* Vessel positions */}
        {vessels.filter(v => v.hasPosition && v.lat && v.lng && v.status !== "unknown" && v.status !== "idle").map(v => {
          const isSelected = selectedVesselId === v.vessel_id;
          return (
            <CircleMarker
              key={`vessel-${v.vessel_id}`}
              center={[v.lat!, v.lng!]}
              radius={isSelected ? 11 : 8}
              pathOptions={{
                fillColor: STATUS_COLORS[v.status] || "#666",
                fillOpacity: 0.9,
                color: isSelected ? "#60a5fa" : "#fff",
                weight: isSelected ? 3 : 2,
              }}
              eventHandlers={{
                click: () => onVesselClick?.(v.vessel_id),
              }}
            >
              <Popup>
                <div style={{ fontSize: 11, minWidth: 240, fontFamily: MONO, color: "#222", lineHeight: 1.6 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 2 }}>{v.vessel_name}</div>
                  <div style={{ color: "#666" }}>{v.owner_company}</div>
                  {v.mmsi && <div style={{ fontSize: 10, color: "#999" }}>MMSI: {v.mmsi}</div>}
                  <div style={{ borderTop: "1px solid #ddd", marginTop: 4, paddingTop: 4 }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span>Status</span>
                      <span style={{ color: STATUS_COLORS[v.status], fontWeight: 700 }}>
                        {v.status.toUpperCase().replace(/_/g, " ")}
                      </span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span>Capacity</span>
                      <span>{v.capacity_tonnes ? `${v.capacity_tonnes}t` : "—"}</span>
                    </div>
                    {v.speed_knots != null && (
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span>Speed</span>
                        <span>{v.speed_knots.toFixed(1)} kn</span>
                      </div>
                    )}
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span>Last report</span>
                      <span>{formatAge(v.reported_at)}</span>
                    </div>
                  </div>
                  {onVesselClick && (
                    <div style={{ borderTop: "1px solid #ddd", marginTop: 4, paddingTop: 4, fontSize: 10, color: "#2563eb", cursor: "pointer", textAlign: "center" }}
                      onClick={() => onVesselClick(v.vessel_id)}>
                      View route history &rarr;
                    </div>
                  )}
                </div>
              </Popup>
            </CircleMarker>
          );
        })}
      </MapContainer>
    </div>
  );
}
