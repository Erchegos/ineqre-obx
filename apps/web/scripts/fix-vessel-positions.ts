/**
 * Fix vessel positions — replace seed data with realistic ocean positions
 *
 * Since free global AIS APIs are unavailable (BarentsWatch AIS deprecated,
 * Digitraffic limited to Finland, MarineTraffic/VesselFinder require paid keys),
 * this script assigns realistic positions along known trade routes based on
 * vessel type and company focus.
 *
 * Positions are distributed along real shipping lanes:
 * - Tankers: MEG→China, WAF→Europe, North Sea
 * - Dry bulk: Brazil→China, Australia→China, Baltic
 * - Gas (LPG/LNG): MEG→Asia, US→Europe
 * - Chemical: Europe→Global
 * - Container: Asia→Europe, Intra-Asia
 * - Car carriers: Asia→Europe, Asia→Americas
 *
 * Each position includes slight randomization for natural distribution.
 * Status (at_sea/in_port/anchored) distributed realistically.
 *
 * Run: npx tsx scripts/fix-vessel-positions.ts
 */

import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

import pg from "pg";
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// Known shipping waypoints along major routes (lat, lon)
const ROUTES: Record<string, [number, number][]> = {
  // MEG (Middle East Gulf) → Far East (VLCC route)
  meg_fareast: [
    [26.0, 56.5],   // Fujairah
    [24.0, 58.0],   // Oman coast
    [22.5, 60.0],   // Arabian Sea
    [18.0, 62.0],   // Indian Ocean
    [12.0, 65.0],   // Indian Ocean
    [8.0, 72.0],    // Indian Ocean
    [5.0, 78.0],    // Sri Lanka
    [4.0, 85.0],    // Bay of Bengal
    [2.0, 95.0],    // Malacca approach
    [1.3, 103.8],   // Singapore Strait
    [5.0, 108.0],   // South China Sea
    [10.0, 112.0],  // South China Sea
    [18.0, 115.0],  // South China Sea
    [22.0, 118.0],  // Taiwan Strait
    [30.0, 122.0],  // East China Sea
    [35.0, 130.0],  // Korea/Japan
  ],
  // WAF (West Africa) → UKC (UK Continent) — Suezmax route
  waf_europe: [
    [4.0, 3.5],     // Lagos
    [6.0, -1.0],    // Ghana
    [10.0, -15.0],  // Senegal
    [20.0, -18.0],  // Mauritania
    [28.0, -15.0],  // Canary Islands
    [36.0, -8.0],   // Gibraltar approach
    [43.0, -9.0],   // Cape Finisterre
    [48.0, -6.0],   // Brest
    [50.0, -2.0],   // English Channel
    [51.5, 1.5],    // Dover
    [53.0, 3.0],    // North Sea
    [56.0, 6.0],    // Denmark
    [58.0, 5.0],    // Stavanger
    [60.5, 5.0],    // Bergen
  ],
  // North Sea / Norwegian coast
  north_sea: [
    [56.0, 3.0],    // Central North Sea
    [57.5, 1.5],    // Ekofisk area
    [58.5, 2.0],    // Johan Sverdrup
    [59.0, 3.0],    // Utsira
    [60.0, 4.5],    // Bergen approach
    [60.5, 5.0],    // Bergen
    [62.0, 5.5],    // Alesund
    [63.5, 7.0],    // Trondheim
    [66.0, 13.0],   // Lofoten
    [69.5, 19.0],   // Tromso
    [71.0, 25.0],   // Hammerfest
  ],
  // Brazil → China (Capesize iron ore)
  brazil_china: [
    [-23.0, -43.0], // Tubarao/Brazil
    [-25.0, -35.0], // South Atlantic
    [-30.0, -20.0], // Mid Atlantic
    [-35.0, 0.0],   // Cape approach
    [-35.0, 18.0],  // South Africa
    [-30.0, 35.0],  // Durban
    [-20.0, 45.0],  // Mozambique Channel
    [-10.0, 55.0],  // Indian Ocean
    [0.0, 65.0],    // Central Indian Ocean
    [5.0, 80.0],    // Sri Lanka
    [2.0, 95.0],    // Malacca approach
    [1.3, 103.8],   // Singapore
    [10.0, 112.0],  // South China Sea
    [22.0, 118.0],  // South China
    [30.0, 122.0],  // Zhoushan
    [38.0, 122.0],  // Qingdao
  ],
  // Australia → China (Capesize coal/iron ore)
  australia_china: [
    [-27.5, 153.0], // Brisbane
    [-23.5, 151.0], // Gladstone
    [-20.0, 148.5], // Mackay
    [-15.0, 140.0], // Torres Strait
    [-10.0, 130.0], // Darwin
    [-5.0, 120.0],  // Timor Sea
    [0.0, 115.0],   // Borneo
    [5.0, 112.0],   // South China Sea
    [15.0, 115.0],  // South China Sea
    [22.0, 118.0],  // South China
    [30.0, 122.0],  // Zhoushan
    [35.0, 129.0],  // Korea
  ],
  // Baltic Sea routes
  baltic: [
    [54.5, 10.0],   // Kiel
    [55.5, 13.0],   // Malmo/Copenhagen
    [56.5, 16.0],   // Baltic
    [57.5, 18.0],   // Gotland
    [59.0, 19.0],   // Stockholm
    [59.5, 24.5],   // Tallinn
    [60.0, 25.0],   // Helsinki
    [60.5, 28.0],   // St Petersburg
  ],
  // Asia → Europe container (Suez route)
  asia_europe_container: [
    [22.3, 114.0],  // Hong Kong
    [15.0, 110.0],  // South China Sea
    [5.0, 103.0],   // Singapore approach
    [1.3, 103.8],   // Singapore
    [5.0, 80.0],    // Sri Lanka
    [12.0, 45.0],   // Gulf of Aden
    [13.0, 43.0],   // Bab el-Mandeb
    [27.5, 34.0],   // Suez approach
    [30.0, 32.5],   // Suez Canal
    [32.0, 32.0],   // Port Said
    [35.0, 24.0],   // Crete
    [37.0, 15.0],   // Sicily
    [36.0, -5.5],   // Gibraltar
    [43.0, -9.0],   // Finisterre
    [50.0, -1.0],   // English Channel
    [51.5, 3.5],    // Rotterdam
    [53.5, 10.0],   // Hamburg
  ],
  // US Gulf → Europe (LNG/LPG)
  usgulf_europe: [
    [29.0, -89.0],  // US Gulf
    [27.0, -85.0],  // Florida Strait
    [25.0, -80.0],  // Miami
    [30.0, -70.0],  // Atlantic
    [35.0, -55.0],  // Mid Atlantic
    [40.0, -40.0],  // Mid Atlantic
    [43.0, -25.0],  // Azores
    [43.0, -9.0],   // Finisterre
    [48.0, -5.0],   // Brest
    [51.0, 1.0],    // Dover
    [58.0, 5.0],    // Stavanger
  ],
  // Caribbean / Americas
  americas: [
    [10.0, -62.0],  // Trinidad
    [12.0, -68.0],  // Curacao
    [18.0, -66.0],  // Puerto Rico
    [25.0, -77.0],  // Bahamas
    [29.0, -89.0],  // US Gulf
    [32.0, -81.0],  // Savannah
    [37.0, -76.0],  // Chesapeake
    [40.5, -74.0],  // New York
    [42.0, -70.0],  // Boston
  ],
  // Mediterranean
  med: [
    [36.0, -5.5],   // Gibraltar
    [37.0, -1.0],   // Cartagena
    [39.5, 2.5],    // Balearic
    [41.0, 9.0],    // Sardinia
    [43.3, 5.4],    // Marseille
    [44.5, 12.5],   // Ravenna
    [37.0, 15.5],   // Sicily
    [37.5, 24.0],   // Piraeus
    [40.5, 29.0],   // Marmara
    [36.5, 32.0],   // Cyprus
  ],
  // MEG → India (crude tankers)
  meg_india: [
    [26.0, 56.5],   // Fujairah
    [24.0, 60.0],   // Oman
    [22.0, 63.0],   // Arabian Sea
    [20.0, 67.0],   // Arabian Sea
    [18.5, 72.8],   // Mumbai
    [15.0, 73.5],   // Goa
    [13.0, 80.0],   // Chennai
    [9.0, 76.0],    // Kochi
  ],
};

// Route assignments by sector and company
const SECTOR_ROUTES: Record<string, { routes: string[]; weights: number[] }> = {
  tanker: {
    routes: ["meg_fareast", "waf_europe", "north_sea", "meg_india", "med", "americas"],
    weights: [30, 20, 15, 15, 10, 10],
  },
  dry_bulk: {
    routes: ["brazil_china", "australia_china", "baltic", "north_sea", "americas", "meg_fareast"],
    weights: [25, 25, 15, 15, 10, 10],
  },
  gas: {
    routes: ["meg_fareast", "usgulf_europe", "north_sea", "med", "americas"],
    weights: [30, 25, 20, 15, 10],
  },
  chemical: {
    routes: ["north_sea", "med", "waf_europe", "americas", "meg_fareast"],
    weights: [25, 25, 20, 15, 15],
  },
  container: {
    routes: ["asia_europe_container", "med", "north_sea", "americas", "baltic"],
    weights: [30, 25, 15, 15, 15],
  },
  car_carrier: {
    routes: ["asia_europe_container", "americas", "north_sea", "med"],
    weights: [35, 25, 20, 20],
  },
};

function pickWeighted(items: string[], weights: number[]): string {
  const total = weights.reduce((s, w) => s + w, 0);
  let r = Math.random() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

function randomPositionOnRoute(route: [number, number][]): { lat: number; lon: number } {
  // Pick a random segment along the route
  const segIdx = Math.floor(Math.random() * (route.length - 1));
  const t = Math.random(); // interpolation factor
  const [lat1, lon1] = route[segIdx];
  const [lat2, lon2] = route[segIdx + 1];

  // Interpolate + add small random offset (simulating real vessel spread)
  const spread = 1.5; // degrees of random spread from route center
  return {
    lat: parseFloat((lat1 + t * (lat2 - lat1) + (Math.random() - 0.5) * spread).toFixed(4)),
    lon: parseFloat((lon1 + t * (lon2 - lon1) + (Math.random() - 0.5) * spread).toFixed(4)),
  };
}

function pickStatus(): { navStatus: string; opStatus: string; speed: number } {
  const r = Math.random();
  if (r < 0.55) {
    return { navStatus: "under_way", opStatus: "at_sea", speed: parseFloat((10 + Math.random() * 5).toFixed(1)) };
  } else if (r < 0.70) {
    return { navStatus: "moored", opStatus: "loading", speed: 0 };
  } else if (r < 0.82) {
    return { navStatus: "moored", opStatus: "discharging", speed: 0 };
  } else if (r < 0.90) {
    return { navStatus: "at_anchor", opStatus: "waiting", speed: 0 };
  } else {
    return { navStatus: "moored", opStatus: "in_port", speed: 0 };
  }
}

// Major port positions for vessels that are in_port/loading/discharging
const PORTS: Record<string, [number, number][]> = {
  tanker: [
    [26.2, 56.4], [1.26, 103.85], [29.5, 48.0], [12.1, 45.0], [51.9, 4.5],
    [60.4, 5.3], [36.8, -76.3], [22.3, 114.2], [35.0, 129.0], [5.0, 3.4],
  ],
  dry_bulk: [
    [30.6, 122.1], [38.0, 122.0], [-23.0, -44.0], [-27.5, 153.0], [53.5, 10.0],
    [59.9, 10.7], [57.7, 12.0], [1.3, 103.8], [37.5, -122.3], [35.5, 129.4],
  ],
  gas: [
    [26.2, 56.4], [60.8, 5.0], [71.0, 25.5], [29.0, -89.5], [51.9, 4.5],
    [35.5, 140.0], [22.3, 114.2], [1.3, 103.8], [36.5, -6.3], [50.8, -1.1],
  ],
  chemical: [
    [51.9, 4.5], [53.5, 10.0], [43.3, 5.4], [59.9, 10.7], [40.7, -74.0],
    [29.5, -89.5], [1.3, 103.8], [35.5, 140.0], [37.5, -0.5], [60.4, 5.3],
  ],
  container: [
    [22.3, 114.2], [1.3, 103.8], [51.9, 4.5], [53.5, 10.0], [36.0, -5.5],
    [41.0, 29.0], [43.3, 5.4], [37.9, -122.3], [40.7, -74.0], [34.7, 135.4],
  ],
  car_carrier: [
    [34.7, 135.4], [35.1, 129.1], [51.9, 4.5], [53.5, 10.0], [59.9, 10.7],
    [33.7, -118.3], [40.7, -74.0], [22.3, 114.2], [60.4, 5.3], [57.7, 12.0],
  ],
};

async function main() {
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
  for (const v of vessels.rows) {
    const sector = v.sector || "tanker";
    const sectorConfig = SECTOR_ROUTES[sector] || SECTOR_ROUTES.tanker;
    const status = pickStatus();

    let lat: number, lon: number;

    if (status.opStatus === "in_port" || status.opStatus === "loading" || status.opStatus === "discharging") {
      // Place at a real port
      const sectorPorts = PORTS[sector] || PORTS.tanker;
      const port = sectorPorts[Math.floor(Math.random() * sectorPorts.length)];
      lat = parseFloat((port[0] + (Math.random() - 0.5) * 0.05).toFixed(4));
      lon = parseFloat((port[1] + (Math.random() - 0.5) * 0.05).toFixed(4));
    } else {
      // Place along a trade route
      const routeName = pickWeighted(sectorConfig.routes, sectorConfig.weights);
      const route = ROUTES[routeName];
      const pos = randomPositionOnRoute(route);
      lat = pos.lat;
      lon = pos.lon;
    }

    const heading = status.speed > 0 ? Math.floor(Math.random() * 360) : null;
    const course = status.speed > 0 ? Math.floor(Math.random() * 360) : null;

    // Delete old position and insert new
    await pool.query("DELETE FROM shipping_positions WHERE imo = $1", [v.imo]);
    await pool.query(
      `INSERT INTO shipping_positions (imo, latitude, longitude, speed_knots, heading, course, nav_status, operational_status, reported_at, source, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), 'route_estimated', NOW())`,
      [v.imo, lat, lon, status.speed, heading, course, status.navStatus, status.opStatus]
    );
    updated++;
  }

  console.log(`Updated ${updated} vessel positions`);
  console.log("\nDistribution check:");

  const check = await pool.query(`
    SELECT operational_status, count(*) as cnt
    FROM shipping_positions
    GROUP BY operational_status
    ORDER BY cnt DESC
  `);
  for (const r of check.rows) {
    console.log(`  ${r.operational_status}: ${r.cnt}`);
  }

  // Verify no vessels on land by checking some known inland coordinates
  const landCheck = await pool.query(`
    SELECT count(*) as cnt FROM shipping_positions
    WHERE latitude BETWEEN 42 AND 52 AND longitude BETWEEN -5 AND 12
    AND operational_status = 'at_sea'
  `);
  console.log(`\nVessels potentially over European land: ${landCheck.rows[0].cnt}`);

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
