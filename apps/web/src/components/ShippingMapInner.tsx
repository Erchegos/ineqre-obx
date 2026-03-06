"use client";

import { useEffect, useMemo } from "react";
import { MapContainer, TileLayer, CircleMarker, Popup, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import type { VesselMapItem, PortItem } from "./ShippingMap";
import { SECTOR_COLORS } from "./ShippingMap";

type FocusVessel = { lat: number; lng: number; name: string } | null;

type Props = {
  positions: VesselMapItem[];
  ports: PortItem[];
  selectedTicker: string | null;
  focusVessel?: FocusVessel;
};

const MONO = "'Geist Mono','SF Mono','Consolas',monospace";

const VESSEL_TYPE_LABELS: Record<string, string> = {
  vlcc: "VLCC",
  suezmax: "Suezmax",
  aframax_lr2: "Aframax/LR2",
  mr_tanker: "MR Tanker",
  handy_tanker: "Handy Tanker",
  lr2_tanker: "LR2 Tanker",
  capesize: "Capesize",
  panamax_bulk: "Panamax",
  supramax: "Supramax",
  ultramax: "Ultramax",
  newcastlemax: "Newcastlemax",
  container_feeder: "Feeder",
  container_subpanamax: "Sub-Panamax",
  container_panamax: "Panamax",
  pctc: "PCTC",
  chemical_tanker: "Chemical",
  lng_carrier: "LNG Carrier",
  vlgc: "VLGC",
};


function FlyToVessel({ focusVessel }: { focusVessel: FocusVessel }) {
  const map = useMap();
  useEffect(() => {
    if (!focusVessel) return;
    const target: [number, number] = [focusVessel.lat, focusVessel.lng];
    const currentZoom = map.getZoom();
    const zoomDiff = 8 - currentZoom;
    const container = map.getContainer();

    if (zoomDiff > 3) {
      container.style.transition = "opacity 0.3s ease-out";
      container.style.opacity = "0";
      setTimeout(() => {
        map.setView(target, 8, { animate: false });
        setTimeout(() => {
          container.style.transition = "opacity 0.5s ease-in";
          container.style.opacity = "1";
        }, 100);
      }, 300);
    } else {
      map.flyTo(target, 8, { duration: 1.0, easeLinearity: 0.15 });
    }
  }, [map, focusVessel]);
  return null;
}

function fmtRate(v: number | null | undefined): string {
  if (v == null) return "—";
  return "$" + v.toLocaleString("en-US", { maximumFractionDigits: 0 }) + "/day";
}

function fmtSize(v: VesselMapItem): string {
  if (v.teu) return `${v.teu.toLocaleString()} TEU`;
  if (v.cbm) return `${v.cbm.toLocaleString()} CBM`;
  if (v.dwt) return `${v.dwt.toLocaleString()} DWT`;
  return "—";
}

function fmtContractType(v: string | null): string {
  if (!v) return "—";
  const labels: Record<string, string> = {
    time_charter: "TC",
    voyage_charter: "Voyage",
    spot: "Spot",
    coa: "CoA",
    pool: "Pool",
    bareboat: "Bareboat",
    idle: "Idle",
  };
  return labels[v] || v;
}

function statusColor(s: string | null): string {
  if (!s) return "#555";
  if (s === "at_sea" || s === "under_way") return "#22c55e";
  if (s === "in_port" || s === "moored" || s === "loading" || s === "discharging") return "#3b82f6";
  if (s === "anchored" || s === "at_anchor" || s === "waiting") return "#f59e0b";
  if (s === "idle" || s === "laid_up") return "#ef4444";
  return "#555";
}

function getMarkerRadius(v: VesselMapItem): number {
  // Larger vessels get bigger markers
  const dwt = v.dwt || 0;
  if (dwt >= 200000) return 7;
  if (dwt >= 100000) return 6;
  if (dwt >= 50000) return 5;
  if (v.cbm && v.cbm >= 80000) return 6;
  if (v.teu && v.teu >= 5000) return 6;
  return 4;
}

export default function ShippingMapInner({ positions, ports, selectedTicker, focusVessel }: Props) {
  const { highlighted, dimmed } = useMemo(() => {
    if (!selectedTicker) return { highlighted: positions, dimmed: [] as VesselMapItem[] };
    const h: VesselMapItem[] = [];
    const d: VesselMapItem[] = [];
    for (const p of positions) {
      if (p.company_ticker === selectedTicker) h.push(p);
      else d.push(p);
    }
    return { highlighted: h, dimmed: d };
  }, [positions, selectedTicker]);

  return (
    <div style={{ height: "100%", overflow: "hidden", border: "none" }}>
      <MapContainer
        center={[25, 20]}
        zoom={2}
        style={{ height: "100%", width: "100%", background: "#0a0a0a" }}
        scrollWheelZoom={true}
        zoomControl={true}
        minZoom={2}
      >
        <TileLayer
          attribution='&copy; <a href="https://carto.com/">CARTO</a> &copy; <a href="https://osm.org/copyright">OSM</a>'
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          subdomains="abcd"
        />
        <FlyToVessel focusVessel={focusVessel ?? null} />

        {/* Port markers — small gray dots */}
        {ports.map((port) => (
          port.latitude && port.longitude ? (
            <CircleMarker
              key={`port-${port.port_name}`}
              center={[port.latitude, port.longitude]}
              radius={2}
              pathOptions={{ fillColor: "#555", fillOpacity: 0.5, color: "#555", weight: 0 }}
            >
              <Popup>
                <div style={{ fontSize: 11, minWidth: 140, fontFamily: MONO, color: "#222" }}>
                  <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 2 }}>{port.port_name}</div>
                  <div style={{ color: "#666" }}>{port.country}</div>
                  {port.port_type && <div style={{ color: "#888", fontSize: 10 }}>{port.port_type.replace(/_/g, " ")}</div>}
                  {port.region && <div style={{ color: "#888", fontSize: 10 }}>{port.region}</div>}
                </div>
              </Popup>
            </CircleMarker>
          ) : null
        ))}

        {/* Dimmed vessel markers */}
        {dimmed.map((v) => (
          v.latitude && v.longitude ? (
            <CircleMarker
              key={`v-dim-${v.imo}`}
              center={[Number(v.latitude), Number(v.longitude)]}
              radius={3}
              pathOptions={{ fillColor: "#333", fillOpacity: 0.25, color: "#333", weight: 0 }}
            >
              <Popup>{renderVesselPopup(v)}</Popup>
            </CircleMarker>
          ) : null
        ))}

        {/* Highlighted vessel markers */}
        {highlighted.map((v) => {
          if (!v.latitude || !v.longitude) return null;
          const color = v.color_hex || SECTOR_COLORS[v.sector] || "#58a6ff";
          const isSelected = !!selectedTicker;
          const radius = getMarkerRadius(v);
          const isMoving = v.speed_knots != null && Number(v.speed_knots) > 0.5;

          return (
            <CircleMarker
              key={`v-${v.imo}`}
              center={[Number(v.latitude), Number(v.longitude)]}
              radius={isSelected ? radius + 2 : radius}
              pathOptions={{
                fillColor: color,
                fillOpacity: isMoving ? 0.95 : 0.7,
                color: isSelected ? "#fff" : color,
                weight: isSelected ? 1.5 : 1,
              }}
            >
              <Popup>{renderVesselPopup(v)}</Popup>
            </CircleMarker>
          );
        })}
      </MapContainer>
    </div>
  );
}

function renderVesselPopup(v: VesselMapItem) {
  const color = v.color_hex || SECTOR_COLORS[v.sector] || "#58a6ff";
  const daysRemaining = v.contract_end
    ? Math.max(0, Math.ceil((new Date(v.contract_end).getTime() - Date.now()) / 86400000))
    : null;
  const expiryColor = daysRemaining != null && daysRemaining < 90 ? "#ef4444" : daysRemaining != null && daysRemaining < 180 ? "#f59e0b" : "#666";

  return (
    <div style={{ fontSize: 11, minWidth: 250, fontFamily: MONO, color: "#222", lineHeight: 1.6 }}>
      {/* Vessel name + type */}
      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 2, color }}>
        {v.vessel_name}
      </div>
      <div style={{ fontSize: 10, color: "#888", marginBottom: 6 }}>
        {VESSEL_TYPE_LABELS[v.vessel_type] || v.vessel_type} · {v.company_ticker} · {fmtSize(v)}
      </div>

      {/* Position info */}
      <div style={{ borderTop: "1px solid #ddd", paddingTop: 4, marginTop: 2 }}>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span style={{ color: "#666" }}>Status</span>
          <span style={{ color: statusColor(v.operational_status || v.nav_status), fontWeight: 600 }}>
            {(v.operational_status || v.nav_status || "unknown").replace(/_/g, " ")}
          </span>
        </div>
        {v.speed_knots != null && (
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: "#666" }}>Speed</span>
            <span>{Number(v.speed_knots).toFixed(1)} kts{v.heading != null ? ` · ${v.heading}°` : ""}</span>
          </div>
        )}
        {v.destination && (
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: "#666" }}>Destination</span>
            <span>{v.destination_port_name || v.destination}</span>
          </div>
        )}
        {v.eta && (
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: "#666" }}>ETA</span>
            <span>{new Date(v.eta).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>
          </div>
        )}
        {v.current_region && (
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: "#666" }}>Region</span>
            <span>{v.current_region}</span>
          </div>
        )}
      </div>

      {/* Contract / Rate info — THE KEY DATA */}
      <div style={{ borderTop: "1px solid #ddd", paddingTop: 4, marginTop: 4 }}>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span style={{ color: "#666" }}>Rate</span>
          <span style={{ fontWeight: 700, fontSize: 13, color: v.rate_usd_per_day ? "#16a34a" : "#888" }}>
            {fmtRate(v.rate_usd_per_day)}
          </span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span style={{ color: "#666" }}>Type</span>
          <span>{fmtContractType(v.contract_type)}</span>
        </div>
        {v.charterer && (
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: "#666" }}>Charterer</span>
            <span>{v.charterer}</span>
          </div>
        )}
        {v.contract_end && (
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: "#666" }}>Expires</span>
            <span style={{ color: expiryColor, fontWeight: 600 }}>
              {new Date(v.contract_end).toLocaleDateString("en-GB", { month: "short", year: "numeric" })}
              {daysRemaining != null && ` (${daysRemaining}d)`}
            </span>
          </div>
        )}
      </div>

      {/* AIS data + Company footer */}
      <div style={{ borderTop: "1px solid #ddd", paddingTop: 4, marginTop: 4, fontSize: 10, color: "#888" }}>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span>{v.company_ticker} · {v.company_name}</span>
        </div>
        {v.reported_at && (
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 2 }}>
            <span style={{ color: "#999" }}>AIS</span>
            <span style={{ color: v.dataFreshness === "live" ? "#22c55e" : v.dataFreshness === "delayed" ? "#f59e0b" : "#ef4444" }}>
              {new Date(v.reported_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
              {v.source ? ` · ${v.source}` : ""}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
