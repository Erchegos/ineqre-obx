/**
 * Harvest Trip Detection via AIS
 *
 * Connects to AISStream.io WebSocket, tracks wellboat positions,
 * and detects farm→slaughterhouse trips using proximity analysis.
 * Stores position history for route visualization.
 *
 * Trip detection state machine (per vessel):
 *   idle → at_farm (< 1nm from farm) → in_transit (> 2nm from farm)
 *   → at_slaughterhouse (< 1nm from slaughterhouse) → trip recorded → idle
 *
 * Prerequisites:
 * 1. Run seed-harvest-data.ts to populate vessels & slaughterhouses
 * 2. Set AISSTREAM_API_KEY in .env.local
 *
 * Run: npx tsx scripts/fetch-harvest-positions.ts
 * Options:
 *   --duration=600   Listen for 600 seconds (default: 600)
 *   --dry-run        Don't write to DB
 */

import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import WebSocket from "ws";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

import pg from "pg";
const { Pool } = pg;
// Strip sslmode from connection string — we handle SSL in config (same as db.ts)
const connStr = (process.env.DATABASE_URL || "").trim().replace(/^["']|["']$/g, "").replace(/[?&]sslmode=\w+/g, "");
const pool = new Pool({ connectionString: connStr, ssl: { rejectUnauthorized: false } });

const AISSTREAM_URL = "wss://stream.aisstream.io/v0/stream";
const API_KEY = process.env.AISSTREAM_API_KEY;
const STATE_FILE = path.resolve(__dirname, "../.harvest-tracker-state.json");

// Proximity thresholds (nautical miles)
const FARM_PROXIMITY_NM = 1.0;
const FARM_LEAVE_NM = 2.0;
const SLAUGHTERHOUSE_PROXIMITY_NM = 1.0;
const DEFAULT_LOAD_FACTOR = 0.80;

// Parse args
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const durationArg = args.find(a => a.startsWith("--duration="));
const DURATION_SEC = durationArg ? parseInt(durationArg.split("=")[1]) : 600;

// Haversine distance in nautical miles
function haversineNm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3440.065; // Earth radius in nautical miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

type VesselState = {
  vesselId: number;
  vesselName: string;
  mmsi: string;
  capacity: number;
  state: "idle" | "at_farm" | "in_transit" | "at_slaughterhouse";
  farmLocalityId?: number;
  farmName?: string;
  farmTicker?: string;
  farmAreaNumber?: number;
  farmArrivalTime?: string;
  departureTime?: string;
  lastLat?: number;
  lastLng?: number;
  lastUpdate?: string;
};

type Farm = { id: number; name: string; ticker: string | null; lat: number; lng: number; area: number | null };
type Slaughterhouse = { id: number; name: string; ticker: string; lat: number; lng: number; area: number | null };

async function main() {
  console.log("═══════════════════════════════════════════════════════");
  console.log("  Harvest Tracker — AIS Position Collection");
  console.log("═══════════════════════════════════════════════════════");
  console.log(`  Duration: ${DURATION_SEC}s | Dry run: ${dryRun}`);
  console.log();

  if (!API_KEY) {
    console.error("ERROR: AISSTREAM_API_KEY not set in .env.local");
    process.exit(1);
  }

  // Load vessels with MMSIs
  const vesselRes = await pool.query(
    "SELECT id, vessel_name, mmsi, capacity_tonnes::int AS capacity FROM harvest_vessels WHERE is_active = true AND mmsi IS NOT NULL"
  );
  const vessels = vesselRes.rows;
  const mmsiToVessel = new Map<string, typeof vessels[0]>();
  for (const v of vessels) mmsiToVessel.set(v.mmsi, v);
  console.log(`  Tracking ${vessels.length} vessels with MMSIs`);

  // Load farms (localities)
  const farmRes = await pool.query(
    `SELECT locality_id AS id, name, ticker, lat::float, lng::float, production_area_number AS area
     FROM seafood_localities WHERE lat IS NOT NULL AND lng IS NOT NULL AND is_active = true`
  );
  const farms: Farm[] = farmRes.rows;
  console.log(`  ${farms.length} farm localities loaded`);

  // Load slaughterhouses
  const shRes = await pool.query(
    "SELECT id, name, ticker, lat::float, lng::float, production_area_number AS area FROM harvest_slaughterhouses WHERE is_active = true"
  );
  const slaughterhouses: Slaughterhouse[] = shRes.rows;
  console.log(`  ${slaughterhouses.length} slaughterhouses loaded`);

  // Load or init state
  let vesselStates: Map<string, VesselState> = new Map();
  try {
    if (fs.existsSync(STATE_FILE)) {
      const saved = JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
      for (const [k, v] of Object.entries(saved)) vesselStates.set(k, v as VesselState);
      console.log(`  Restored state for ${vesselStates.size} vessels`);
    }
  } catch { /* ignore */ }

  // Init state for new vessels
  for (const v of vessels) {
    if (!vesselStates.has(v.mmsi)) {
      vesselStates.set(v.mmsi, {
        vesselId: v.id, vesselName: v.vessel_name, mmsi: v.mmsi,
        capacity: v.capacity || 400, state: "idle",
      });
    }
  }

  let positionCount = 0;
  let tripCount = 0;

  // Find nearest farm/slaughterhouse
  function findNearestFarm(lat: number, lng: number): { farm: Farm; dist: number } | null {
    let best: Farm | null = null;
    let bestDist = Infinity;
    for (const f of farms) {
      const d = haversineNm(lat, lng, f.lat, f.lng);
      if (d < bestDist) { bestDist = d; best = f; }
    }
    return best ? { farm: best, dist: bestDist } : null;
  }

  function findNearestSH(lat: number, lng: number): { sh: Slaughterhouse; dist: number } | null {
    let best: Slaughterhouse | null = null;
    let bestDist = Infinity;
    for (const sh of slaughterhouses) {
      const d = haversineNm(lat, lng, sh.lat, sh.lng);
      if (d < bestDist) { bestDist = d; best = sh; }
    }
    return best ? { sh: best, dist: bestDist } : null;
  }

  async function processPosition(mmsi: string, lat: number, lng: number, speed: number, heading: number, course: number, navStatus: string, ts: string) {
    const vs = vesselStates.get(mmsi);
    if (!vs) return;

    positionCount++;
    vs.lastLat = lat;
    vs.lastLng = lng;
    vs.lastUpdate = ts;

    // Store position in history
    if (!dryRun) {
      try {
        await pool.query(
          `INSERT INTO harvest_vessel_positions (vessel_id, mmsi, latitude, longitude, speed_knots, heading, course, nav_status, timestamp)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [vs.vesselId, mmsi, lat, lng, speed || null, heading || null, course || null, navStatus || null, ts]
        );
      } catch (e: any) {
        console.error(`  DB insert error (positions): ${e.message}`);
      }
    }

    // Also update shipping_positions for live map
    if (!dryRun) {
      try {
        await pool.query(
          `INSERT INTO shipping_positions (imo, vessel_name, latitude, longitude, speed_knots, heading, nav_status, operational_status, reported_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT (imo) DO UPDATE SET
             latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
             speed_knots = EXCLUDED.speed_knots, heading = EXCLUDED.heading,
             nav_status = EXCLUDED.nav_status, operational_status = EXCLUDED.operational_status,
             reported_at = EXCLUDED.reported_at`,
          [`HV-${vs.vesselId}`, vs.vesselName, lat, lng, speed || null, heading || null, navStatus || null, vs.state, ts]
        );
      } catch { /* ignore */ }
    }

    // Trip detection state machine
    const nearFarm = findNearestFarm(lat, lng);
    const nearSH = findNearestSH(lat, lng);

    switch (vs.state) {
      case "idle":
        if (nearFarm && nearFarm.dist < FARM_PROXIMITY_NM) {
          vs.state = "at_farm";
          vs.farmLocalityId = nearFarm.farm.id;
          vs.farmName = nearFarm.farm.name;
          vs.farmTicker = nearFarm.farm.ticker || undefined;
          vs.farmAreaNumber = nearFarm.farm.area || undefined;
          vs.farmArrivalTime = ts;
          console.log(`  [${vs.vesselName}] AT FARM: ${nearFarm.farm.name} (${nearFarm.dist.toFixed(2)}nm)`);
        }
        break;

      case "at_farm":
        if (nearFarm && nearFarm.dist > FARM_LEAVE_NM) {
          vs.state = "in_transit";
          vs.departureTime = ts;
          console.log(`  [${vs.vesselName}] DEPARTED farm ${vs.farmName}`);
        }
        break;

      case "in_transit":
        if (nearSH && nearSH.dist < SLAUGHTERHOUSE_PROXIMITY_NM) {
          vs.state = "at_slaughterhouse";
          console.log(`  [${vs.vesselName}] ARRIVED at ${nearSH.sh.name} (${nearSH.dist.toFixed(2)}nm)`);

          // Record trip
          const departureTime = vs.departureTime || ts;
          const durationMs = new Date(ts).getTime() - new Date(departureTime).getTime();
          const durationHours = durationMs / 3600000;
          const volume = vs.capacity * DEFAULT_LOAD_FACTOR;

          // Get spot price at departure (NOK only — EUR rows have values ~8-10, not ~80-100)
          let spotPrice: number | null = null;
          try {
            const spotRes = await pool.query(
              `SELECT sisalmon_avg::float FROM salmon_spot_weekly
               WHERE report_date <= $1::date AND currency = 'NOK'
               ORDER BY report_date DESC LIMIT 1`,
              [departureTime]
            );
            if (spotRes.rows.length > 0) spotPrice = spotRes.rows[0].sisalmon_avg;
          } catch { /* ignore */ }

          if (!dryRun) {
            try {
              await pool.query(
                `INSERT INTO harvest_trips
                 (vessel_id, vessel_name, origin_locality_id, origin_name, origin_ticker,
                  destination_slaughterhouse_id, destination_name, departure_time, arrival_time,
                  duration_hours, estimated_volume_tonnes, spot_price_at_harvest, production_area_number, status)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'completed')
                 ON CONFLICT (vessel_name, departure_time) DO NOTHING`,
                [vs.vesselId, vs.vesselName, vs.farmLocalityId || null, vs.farmName || null, vs.farmTicker || null,
                 nearSH.sh.id, nearSH.sh.name, departureTime, ts,
                 durationHours.toFixed(1), volume.toFixed(1), spotPrice, vs.farmAreaNumber || null]
              );
              tripCount++;
              console.log(`  [${vs.vesselName}] TRIP RECORDED: ${vs.farmName} → ${nearSH.sh.name} | ${volume.toFixed(0)}t | ${durationHours.toFixed(1)}h | spot: ${spotPrice?.toFixed(1) ?? "?"}`);
            } catch (e: any) {
              if (!e.message?.includes("duplicate")) console.error("  Trip insert error:", e.message);
            }
          } else {
            tripCount++;
            console.log(`  [DRY] Trip: ${vs.farmName} → ${nearSH.sh.name} | ${volume.toFixed(0)}t`);
          }

          // Reset to idle
          vs.state = "idle";
          vs.farmLocalityId = undefined;
          vs.farmName = undefined;
          vs.farmTicker = undefined;
          vs.departureTime = undefined;
        }
        break;

      case "at_slaughterhouse":
        // Reset to idle after some time
        vs.state = "idle";
        break;
    }
  }

  // Connect to AISStream
  console.log(`\n  Connecting to AISStream.io...`);
  const mmsiList = vessels.map(v => String(v.mmsi));

  return new Promise<void>((resolve) => {
    const ws = new WebSocket(AISSTREAM_URL);
    const timeout = setTimeout(() => {
      console.log(`\n  Duration ${DURATION_SEC}s reached. Closing...`);
      ws.close();
    }, DURATION_SEC * 1000);

    ws.on("open", () => {
      console.log(`  Connected! Subscribing to ${mmsiList.length} MMSIs...`);
      ws.send(JSON.stringify({
        APIKey: API_KEY,
        BoundingBoxes: [[[55, 0], [72, 35]]], // Norwegian waters
        FilterMessageTypes: ["PositionReport"],
      }));
    });

    ws.on("message", async (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.MessageType !== "PositionReport") return;

        const mmsi = String(msg.MetaData?.MMSI || "");
        if (!mmsiToVessel.has(mmsi)) return; // Not our vessel

        const pos = msg.Message?.PositionReport;
        if (!pos) return;

        const lat = pos.Latitude;
        const lng = pos.Longitude;
        const speed = pos.Sog || 0;
        const heading = pos.TrueHeading || 0;
        const course = pos.Cog || 0;
        const navStatus = String(pos.NavigationalStatus || "");
        // AISStream sends "2026-03-12 20:44:19.783100368 +0000 UTC" — normalize to ISO
        const rawTs = msg.MetaData?.time_utc || "";
        const ts = rawTs ? new Date(rawTs.replace(/ UTC$/, "Z").replace(/ \+0000/, "+00:00")).toISOString() : new Date().toISOString();

        await processPosition(mmsi, lat, lng, speed, heading, course, navStatus, ts);

        // Log periodically
        if (positionCount % 10 === 0) {
          process.stdout.write(`\r  Positions: ${positionCount} | Trips: ${tripCount} | Active: ${[...vesselStates.values()].filter(v => v.state !== "idle").length}  `);
        }
      } catch { /* ignore parse errors */ }
    });

    ws.on("error", (err) => {
      console.error("  WebSocket error:", err.message);
    });

    ws.on("close", async () => {
      clearTimeout(timeout);
      console.log(`\n\n  Session complete.`);
      console.log(`  Positions stored: ${positionCount}`);
      console.log(`  Trips detected: ${tripCount}`);

      // Save state
      const stateObj: Record<string, VesselState> = {};
      for (const [k, v] of vesselStates) stateObj[k] = v;
      fs.writeFileSync(STATE_FILE, JSON.stringify(stateObj, null, 2));
      console.log(`  State saved to ${STATE_FILE}`);

      await pool.end();
      resolve();
    });
  });
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
