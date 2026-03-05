/**
 * Land/sea detection using Natural Earth 110m land polygons + ray-casting.
 * Accurate to ~100km coastline resolution — more than enough for vessel positioning.
 */

import landGeoJSON from "@/data/ne_110m_land.json";

type Ring = [number, number][]; // [lon, lat] pairs (GeoJSON format)

// Extract all outer rings from the GeoJSON at module load time
const landRings: Ring[] = [];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
for (const feature of (landGeoJSON as any).features) {
  const geom = feature.geometry;
  if (geom.type === "Polygon") {
    landRings.push(geom.coordinates[0]);
  } else if (geom.type === "MultiPolygon") {
    for (const poly of geom.coordinates) {
      landRings.push(poly[0]);
    }
  }
}

/** Ray-casting point-in-polygon */
function pointInRing(x: number, y: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** Returns true if the coordinate is on land */
export function isOnLand(lat: number, lon: number): boolean {
  for (const ring of landRings) {
    if (pointInRing(lon, lat, ring)) return true;
  }
  return false;
}

/** Returns true if the coordinate is on water */
export function isOnWater(lat: number, lon: number): boolean {
  return !isOnLand(lat, lon);
}
