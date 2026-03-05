/**
 * Fix vessel positions — scatter across ocean regions (not along routes)
 *
 * Uses Natural Earth 110m land polygons with ray-casting for land/sea detection.
 * Vessels are randomly scattered within broad ocean regions based on their sector,
 * producing natural-looking distributions (not visible route lines).
 *
 * Run: npx tsx scripts/fix-vessel-positions.ts
 */

import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { readFileSync } from "fs";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

import pg from "pg";
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// ── Natural Earth land polygon detection ──────────────────────────
type Ring = [number, number][];
const landRings: Ring[] = [];

function loadLandPolygons() {
  const geojsonPath = path.resolve(__dirname, "../src/data/ne_50m_land.json");
  const raw = JSON.parse(readFileSync(geojsonPath, "utf-8"));
  for (const feature of raw.features) {
    if (feature.geometry.type === "Polygon") {
      landRings.push(feature.geometry.coordinates[0]);
    } else if (feature.geometry.type === "MultiPolygon") {
      for (const poly of feature.geometry.coordinates) {
        landRings.push(poly[0]);
      }
    }
  }
  console.log(`Loaded ${landRings.length} land polygon rings`);
}

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

function isOnLand(lat: number, lon: number): boolean {
  for (const ring of landRings) {
    if (pointInRing(lon, lat, ring)) return true;
  }
  return false;
}

function isOnWater(lat: number, lon: number): boolean {
  return !isOnLand(lat, lon);
}

// ── Ocean regions: broad areas where vessels of each type operate ──
// Each region is [latMin, latMax, lonMin, lonMax]
type OceanRegion = { name: string; bounds: [number, number, number, number]; weight: number };

const TANKER_REGIONS: OceanRegion[] = [
  { name: "Arabian Sea",        bounds: [8, 25, 55, 75],    weight: 20 },
  { name: "Persian Gulf",       bounds: [24, 30, 48, 56],   weight: 10 },
  { name: "Indian Ocean",       bounds: [-5, 15, 60, 85],   weight: 15 },
  { name: "South China Sea",    bounds: [2, 20, 105, 120],  weight: 10 },
  { name: "Mediterranean",      bounds: [32, 42, -4, 35],   weight: 10 },
  { name: "North Sea",          bounds: [54, 62, -2, 8],    weight: 12 },
  { name: "West Africa",        bounds: [-5, 10, -15, 8],   weight: 8 },
  { name: "Caribbean/USGulf",   bounds: [20, 30, -95, -75], weight: 8 },
  { name: "East China Sea",     bounds: [25, 38, 120, 135], weight: 7 },
];

const DRYBULK_REGIONS: OceanRegion[] = [
  { name: "South Atlantic",     bounds: [-35, -10, -30, 15], weight: 15 },
  { name: "Indian Ocean",       bounds: [-15, 10, 50, 85],   weight: 15 },
  { name: "South China Sea",    bounds: [2, 20, 105, 122],   weight: 12 },
  { name: "Pacific (Aus-China)",bounds: [-25, 5, 125, 155],   weight: 15 },
  { name: "East China Sea",     bounds: [25, 40, 120, 140],   weight: 12 },
  { name: "North Sea/Baltic",   bounds: [53, 62, 0, 25],      weight: 10 },
  { name: "North Atlantic",     bounds: [35, 50, -45, -10],   weight: 8 },
  { name: "Bay of Bengal",      bounds: [5, 18, 80, 95],      weight: 8 },
  { name: "Coral Sea",          bounds: [-25, -10, 145, 165],  weight: 5 },
];

const GAS_REGIONS: OceanRegion[] = [
  { name: "Arabian Sea/MEG",    bounds: [10, 28, 50, 70],    weight: 20 },
  { name: "North Atlantic",     bounds: [35, 55, -50, -10],  weight: 20 },
  { name: "Norwegian Sea",      bounds: [60, 72, 0, 20],     weight: 15 },
  { name: "North Sea",          bounds: [54, 62, -2, 8],     weight: 15 },
  { name: "Mediterranean",      bounds: [32, 42, -4, 30],    weight: 10 },
  { name: "South China Sea",    bounds: [2, 20, 105, 120],   weight: 10 },
  { name: "Pacific",            bounds: [20, 40, 130, 160],  weight: 10 },
];

const CHEMICAL_REGIONS: OceanRegion[] = [
  { name: "North Sea",          bounds: [50, 62, -5, 10],    weight: 25 },
  { name: "Mediterranean",      bounds: [32, 43, -5, 35],    weight: 20 },
  { name: "Arabian Sea",        bounds: [8, 25, 55, 75],     weight: 15 },
  { name: "US East Coast",      bounds: [25, 42, -80, -65],  weight: 12 },
  { name: "South China Sea",    bounds: [0, 15, 100, 120],   weight: 10 },
  { name: "Caribbean",          bounds: [10, 25, -85, -60],  weight: 10 },
  { name: "West Africa",        bounds: [-5, 10, -15, 8],    weight: 8 },
];

const CONTAINER_REGIONS: OceanRegion[] = [
  { name: "South China Sea",    bounds: [0, 22, 100, 125],   weight: 20 },
  { name: "Indian Ocean",       bounds: [-5, 15, 55, 85],    weight: 15 },
  { name: "Mediterranean",      bounds: [32, 42, -5, 35],    weight: 15 },
  { name: "North Atlantic",     bounds: [35, 52, -40, -5],   weight: 15 },
  { name: "North Sea/Baltic",   bounds: [52, 62, -2, 15],    weight: 12 },
  { name: "Red Sea",            bounds: [12, 28, 34, 44],    weight: 8 },
  { name: "Pacific",            bounds: [20, 40, 130, 175],  weight: 10 },
  { name: "US East Coast",      bounds: [25, 42, -80, -65],  weight: 5 },
];

const CAR_CARRIER_REGIONS: OceanRegion[] = [
  { name: "Pacific (Asia)",     bounds: [20, 40, 125, 160],  weight: 20 },
  { name: "Indian Ocean",       bounds: [-5, 15, 55, 85],    weight: 15 },
  { name: "North Atlantic",     bounds: [35, 55, -45, -5],   weight: 20 },
  { name: "North Sea",          bounds: [50, 62, -5, 10],    weight: 15 },
  { name: "Mediterranean",      bounds: [32, 42, -5, 30],    weight: 10 },
  { name: "South China Sea",    bounds: [2, 20, 100, 122],   weight: 10 },
  { name: "US East Coast",      bounds: [25, 42, -80, -65],  weight: 10 },
];

const SECTOR_REGIONS: Record<string, OceanRegion[]> = {
  tanker: TANKER_REGIONS,
  dry_bulk: DRYBULK_REGIONS,
  gas: GAS_REGIONS,
  chemical: CHEMICAL_REGIONS,
  container: CONTAINER_REGIONS,
  car_carrier: CAR_CARRIER_REGIONS,
};

function pickWeightedRegion(regions: OceanRegion[]): OceanRegion {
  const total = regions.reduce((s, r) => s + r.weight, 0);
  let roll = Math.random() * total;
  for (const r of regions) {
    roll -= r.weight;
    if (roll <= 0) return r;
  }
  return regions[regions.length - 1];
}

function randomWaterPosition(region: OceanRegion): { lat: number; lon: number } {
  const [latMin, latMax, lonMin, lonMax] = region.bounds;
  for (let attempt = 0; attempt < 100; attempt++) {
    const lat = parseFloat((latMin + Math.random() * (latMax - latMin)).toFixed(4));
    const lon = parseFloat((lonMin + Math.random() * (lonMax - lonMin)).toFixed(4));
    if (isOnWater(lat, lon)) return { lat, lon };
  }
  // Fallback: center of region (should be ocean)
  return {
    lat: parseFloat(((latMin + latMax) / 2).toFixed(4)),
    lon: parseFloat(((lonMin + lonMax) / 2).toFixed(4)),
  };
}

function pickStatus(): { navStatus: string; opStatus: string; speed: number } {
  const r = Math.random();
  if (r < 0.55) return { navStatus: "under_way", opStatus: "at_sea", speed: parseFloat((10 + Math.random() * 5).toFixed(1)) };
  if (r < 0.70) return { navStatus: "moored", opStatus: "loading", speed: 0 };
  if (r < 0.82) return { navStatus: "moored", opStatus: "discharging", speed: 0 };
  if (r < 0.90) return { navStatus: "at_anchor", opStatus: "waiting", speed: 0 };
  return { navStatus: "moored", opStatus: "in_port", speed: 0 };
}

// Real port anchorage positions (just offshore — validated as water by NE 110m)
const PORTS: Record<string, [number, number][]> = {
  tanker: [
    [25.0, 56.3],   // Fujairah anchorage
    [1.15, 103.9],  // Singapore anchorage
    [29.3, 48.8],   // Kuwait/Mina Ahmad
    [12.0, 45.0],   // Aden
    [51.8, 3.8],    // Rotterdam pilot
    [60.3, 4.8],    // Bergen offshore
    [36.9, -76.0],  // Norfolk anchorage
    [22.1, 114.3],  // Hong Kong anchorage
    [34.8, 129.5],  // Busan approach
    [5.3, 3.2],     // Lagos anchorage
  ],
  dry_bulk: [
    [30.8, 122.4],  // Zhoushan anchorage
    [38.2, 122.3],  // Qingdao anchorage
    [-23.8, -43.5], // Tubarao anchorage
    [-27.2, 153.5], // Brisbane pilot
    [54.2, 8.2],    // Elbe approach
    [60.0, 10.5],   // Oslo fjord
    [57.5, 11.5],   // Gothenburg approach
    [1.1, 104.0],   // Singapore east
    [37.8, -122.6], // SF Bay approach
    [35.2, 129.7],  // Busan anchorage
  ],
  gas: [
    [25.0, 56.3],   // Fujairah
    [61.0, 4.5],    // Mongstad
    [70.8, 25.8],   // Hammerfest/Melkoya
    [28.8, -89.8],  // US Gulf offshore
    [51.8, 3.8],    // Rotterdam
    [35.3, 139.8],  // Tokyo Bay
    [22.1, 114.3],  // HK
    [1.1, 104.0],   // Singapore
    [36.2, -6.0],   // Gibraltar east
    [50.6, -1.3],   // Solent
  ],
  chemical: [
    [51.8, 3.8],    // Rotterdam
    [54.2, 8.2],    // Hamburg approach
    [43.2, 5.2],    // Marseille approach
    [60.0, 10.5],   // Oslo
    [40.5, -73.8],  // NY anchorage
    [28.8, -89.8],  // US Gulf
    [1.1, 104.0],   // Singapore
    [35.3, 139.8],  // Tokyo Bay
    [37.8, -0.8],   // Cartagena
    [60.3, 4.8],    // Bergen
  ],
  container: [
    [22.1, 114.3],  // HK
    [1.1, 104.0],   // Singapore
    [51.8, 3.8],    // Rotterdam
    [54.2, 8.2],    // Hamburg
    [36.2, -6.0],   // Gibraltar
    [40.8, 29.2],   // Marmara
    [43.2, 5.2],    // Marseille
    [37.8, -122.6], // SF Bay
    [40.5, -73.8],  // NY
    [34.5, 135.6],  // Osaka Bay
  ],
  car_carrier: [
    [34.5, 135.6],  // Osaka Bay
    [35.2, 129.7],  // Busan
    [51.8, 3.8],    // Rotterdam
    [54.2, 8.2],    // Hamburg
    [60.0, 10.5],   // Oslo
    [33.5, -118.5], // LA anchorage
    [40.5, -73.8],  // NY
    [22.1, 114.3],  // HK
    [60.3, 4.8],    // Bergen
    [57.5, 11.5],   // Gothenburg
  ],
};

async function main() {
  loadLandPolygons();

  const vessels = await pool.query(`
    SELECT v.imo, v.vessel_name, v.vessel_type, v.vessel_class,
           sc.sector, sc.ticker as company_ticker
    FROM shipping_vessels v
    JOIN shipping_companies sc ON sc.ticker = v.company_ticker
    WHERE v.status = 'active'
    ORDER BY v.vessel_name
  `);

  console.log(`Processing ${vessels.rows.length} vessels`);

  let updated = 0;
  let onLandCount = 0;

  for (const v of vessels.rows) {
    const sector = v.sector || "tanker";
    const regions = SECTOR_REGIONS[sector] || SECTOR_REGIONS.tanker;
    const status = pickStatus();

    let lat: number, lon: number;

    if (status.opStatus === "in_port" || status.opStatus === "loading" || status.opStatus === "discharging") {
      // Place at a real port anchorage
      const sectorPorts = PORTS[sector] || PORTS.tanker;
      const port = sectorPorts[Math.floor(Math.random() * sectorPorts.length)];
      lat = parseFloat((port[0] + (Math.random() - 0.5) * 0.08).toFixed(4));
      lon = parseFloat((port[1] + (Math.random() - 0.5) * 0.08).toFixed(4));
    } else {
      // Scatter randomly across an ocean region
      const region = pickWeightedRegion(regions);
      const pos = randomWaterPosition(region);
      lat = pos.lat;
      lon = pos.lon;

      if (isOnLand(lat, lon)) {
        console.warn(`  LAND: ${v.vessel_name} at [${lat}, ${lon}] in ${region.name}`);
        lat = 0; lon = 65; // Indian Ocean fallback
        onLandCount++;
      }
    }

    const heading = status.speed > 0 ? Math.floor(Math.random() * 360) : null;
    const course = status.speed > 0 ? Math.floor(Math.random() * 360) : null;

    await pool.query("DELETE FROM shipping_positions WHERE imo = $1", [v.imo]);
    await pool.query(
      `INSERT INTO shipping_positions (imo, latitude, longitude, speed_knots, heading, course, nav_status, operational_status, reported_at, source, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), 'region_estimated', NOW())`,
      [v.imo, lat, lon, status.speed, heading, course, status.navStatus, status.opStatus]
    );
    updated++;
  }

  console.log(`\nUpdated ${updated} vessel positions`);
  if (onLandCount > 0) console.warn(`${onLandCount} vessels fell back to open ocean`);

  console.log("\nDistribution:");
  const check = await pool.query(`
    SELECT operational_status, count(*) as cnt
    FROM shipping_positions GROUP BY operational_status ORDER BY cnt DESC
  `);
  for (const r of check.rows) console.log(`  ${r.operational_status}: ${r.cnt}`);

  // Final validation
  const allAtSea = await pool.query(`
    SELECT imo, latitude::float as lat, longitude::float as lon
    FROM shipping_positions WHERE operational_status = 'at_sea'
  `);
  let landVessels = 0;
  for (const r of allAtSea.rows) {
    if (isOnLand(r.lat, r.lon)) { landVessels++; }
  }
  console.log(`\nFinal: ${landVessels} of ${allAtSea.rows.length} at-sea vessels on land`);

  await pool.end();
}

main().catch((err) => { console.error(err); process.exit(1); });
