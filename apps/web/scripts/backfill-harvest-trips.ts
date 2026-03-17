/**
 * Harvest Trip Backfill — BarentsWatch Track History + DB Replay
 *
 * 1. Fetches vessel position history from BarentsWatch AIS track API
 *    for each active wellboat (last N days)
 * 2. Inserts new positions into harvest_vessel_positions (deduped by vessel+timestamp)
 * 3. Replays the trip detection state machine over ALL stored positions
 *    sorted by (vessel, timestamp) to detect any missed trips
 *
 * Run: npx tsx scripts/backfill-harvest-trips.ts
 * Options:
 *   --days=7       How many days back to fetch from BarentsWatch (default: 7)
 *   --dry-run      Don't write to DB, just log what would be inserted
 *   --replay-only  Skip BarentsWatch fetch, only replay existing DB positions
 */

import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

import pg from "pg";
const { Pool } = pg;
const pool = new Pool({
  connectionString: (process.env.DATABASE_URL || "").trim().replace(/^["']|["']$/g, "").replace(/[?&]sslmode=\w+/g, ""),
  ssl: { rejectUnauthorized: false },
});

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const REPLAY_ONLY = args.includes("--replay-only");
const daysArg = args.find(a => a.startsWith("--days="));
const DAYS_BACK = daysArg ? parseInt(daysArg.split("=")[1]) : 7;

const FARM_PROXIMITY_NM    = 1.0;
const FARM_LEAVE_NM        = 2.0;
const SLAUGHTER_PROXIMITY_NM = 1.0;
const DEFAULT_LOAD_FACTOR  = 0.80;

function haversineNm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3440.065;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── BarentsWatch OAuth2 ───────────────────────────────────────────────────

async function getBWToken(): Promise<string | null> {
  const clientId = process.env.BARENTSWATCH_CLIENT_ID;
  const clientSecret = process.env.BARENTSWATCH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    console.log("  [BW] No credentials — skipping fetch");
    return null;
  }
  const res = await fetch("https://id.barentswatch.no/connect/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      scope: "api",
      grant_type: "client_credentials",
    }),
  });
  if (!res.ok) {
    console.log(`  [BW] Auth failed: ${res.status}`);
    return null;
  }
  const { access_token } = await res.json();
  return access_token;
}

// ─── Fetch track history from BarentsWatch ────────────────────────────────
// Endpoint: GET /bwapi/v2/geodata/ais/vessels/{mmsi}/trackLine?fromTime=...&toTime=...
// Returns: GeoJSON LineString or FeatureCollection with timestamped coordinates

interface BWTrackPoint {
  lat: number;
  lng: number;
  timestamp: string;
  sog: number;
  cog: number;
}

async function fetchBWTrack(mmsi: string, token: string, fromTime: string, toTime: string): Promise<BWTrackPoint[]> {
  const url = `https://www.barentswatch.no/bwapi/v2/geodata/ais/vessels/${mmsi}/trackLine` +
    `?fromTime=${encodeURIComponent(fromTime)}&toTime=${encodeURIComponent(toTime)}`;

  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      // 404 = vessel not tracked by BW; 429 = rate limited
      if (res.status !== 404) console.log(`  [BW] ${mmsi} → ${res.status}`);
      return [];
    }

    const data = await res.json();
    const points: BWTrackPoint[] = [];

    // Handle GeoJSON FeatureCollection with individual positions
    if (data?.type === "FeatureCollection" && Array.isArray(data.features)) {
      for (const f of data.features) {
        const coords = f.geometry?.coordinates;
        const props = f.properties || {};
        if (!coords || coords.length < 2) continue;
        const [lon, lat] = coords;
        if (Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
        points.push({
          lat, lng: lon,
          timestamp: props.dateTimeUtc || props.timestamp || props.msgtime || new Date().toISOString(),
          sog: props.sog || 0,
          cog: props.cog || 0,
        });
      }
    }
    // Handle GeoJSON LineString (coordinates are [lon, lat, timestamp?] tuples)
    else if (data?.type === "Feature" && data.geometry?.type === "LineString") {
      const coords = data.geometry.coordinates || [];
      const props = data.properties || {};
      const times: string[] = props.times || props.timestamps || [];
      for (let i = 0; i < coords.length; i++) {
        const [lon, lat] = coords[i];
        if (Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
        points.push({
          lat, lng: lon,
          timestamp: times[i] || new Date().toISOString(),
          sog: 0, cog: 0,
        });
      }
    }
    // Handle direct array of position objects
    else if (Array.isArray(data)) {
      for (const p of data) {
        const lat = p.latitude || p.lat;
        const lon = p.longitude || p.lon || p.lng;
        if (!lat || !lon || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
        points.push({
          lat, lng: lon,
          timestamp: p.dateTimeUtc || p.timestamp || p.msgtime || new Date().toISOString(),
          sog: p.sog || 0,
          cog: p.cog || 0,
        });
      }
    }

    return points;
  } catch (e: any) {
    console.log(`  [BW] ${mmsi} error: ${e.message}`);
    return [];
  }
}

// ─── Trip detection replay over sorted DB positions ───────────────────────

type Farm = { id: number; name: string; ticker: string | null; lat: number; lng: number; area: number | null };
type SH   = { id: number; name: string; ticker: string; lat: number; lng: number; area: number | null };
type VState = {
  vesselId: number; vesselName: string; capacity: number;
  state: "idle" | "at_farm" | "in_transit";
  farmId?: number; farmName?: string; farmTicker?: string; farmArea?: number;
  farmArrival?: string; departureTime?: string;
};

async function replayTripDetection(farms: Farm[], slaughterhouses: SH[]) {
  console.log("\n━━━ Replaying trip detection over all stored positions ━━━");

  // Load vessel registry
  const vesRes = await pool.query(
    "SELECT id, vessel_name, capacity_tonnes::float AS capacity FROM harvest_vessels WHERE is_active = true"
  );
  const vesMap = new Map<number, { vesselName: string; capacity: number }>();
  for (const v of vesRes.rows) vesMap.set(v.id, { vesselName: v.vessel_name, capacity: v.capacity || 400 });

  // Load all positions sorted by vessel then timestamp
  const posRes = await pool.query(`
    SELECT vessel_id, latitude::float AS lat, longitude::float AS lng,
           speed_knots::float AS sog, heading, timestamp
    FROM harvest_vessel_positions
    ORDER BY vessel_id, timestamp ASC
  `);
  const positions = posRes.rows;
  console.log(`  Processing ${positions.length} positions across ${vesMap.size} vessels`);

  function nearestFarm(lat: number, lng: number): { farm: Farm; dist: number } | null {
    let best: Farm | null = null, bestDist = Infinity;
    for (const f of farms) {
      const d = haversineNm(lat, lng, f.lat, f.lng);
      if (d < bestDist) { bestDist = d; best = f; }
    }
    return best ? { farm: best, dist: bestDist } : null;
  }

  function nearestSH(lat: number, lng: number): { sh: SH; dist: number } | null {
    let best: SH | null = null, bestDist = Infinity;
    for (const sh of slaughterhouses) {
      const d = haversineNm(lat, lng, sh.lat, sh.lng);
      if (d < bestDist) { bestDist = d; best = sh; }
    }
    return best ? { sh: best, dist: bestDist } : null;
  }

  const states = new Map<number, VState>();
  let tripsInserted = 0;
  let tripsSkipped = 0;

  for (const pos of positions) {
    const vesInfo = vesMap.get(pos.vessel_id);
    if (!vesInfo) continue;

    if (!states.has(pos.vessel_id)) {
      states.set(pos.vessel_id, {
        vesselId: pos.vessel_id,
        vesselName: vesInfo.vesselName,
        capacity: vesInfo.capacity,
        state: "idle",
      });
    }
    const vs = states.get(pos.vessel_id)!;
    const ts = pos.timestamp instanceof Date ? pos.timestamp.toISOString() : String(pos.timestamp);
    const lat = parseFloat(pos.lat);
    const lng = parseFloat(pos.lng);

    const nf = nearestFarm(lat, lng);
    const ns = nearestSH(lat, lng);

    switch (vs.state) {
      case "idle":
        if (nf && nf.dist < FARM_PROXIMITY_NM) {
          vs.state = "at_farm";
          vs.farmId = nf.farm.id;
          vs.farmName = nf.farm.name;
          vs.farmTicker = nf.farm.ticker ?? undefined;
          vs.farmArea = nf.farm.area ?? undefined;
          vs.farmArrival = ts;
        }
        break;

      case "at_farm":
        if (nf && nf.dist > FARM_LEAVE_NM) {
          vs.state = "in_transit";
          vs.departureTime = ts;
          console.log(`  [${vs.vesselName}] DEPARTED ${vs.farmName} at ${ts.slice(0,16)}`);
        }
        break;

      case "in_transit":
        if (ns && ns.dist < SLAUGHTER_PROXIMITY_NM) {
          const departureTime = vs.departureTime || ts;
          const durationHours = (new Date(ts).getTime() - new Date(departureTime).getTime()) / 3600000;
          const volume = (vs.capacity || 400) * DEFAULT_LOAD_FACTOR;

          let spotPrice: number | null = null;
          try {
            const sp = await pool.query(
              `SELECT sisalmon_avg::float FROM salmon_spot_weekly WHERE report_date <= $1::date ORDER BY report_date DESC LIMIT 1`,
              [departureTime]
            );
            if (sp.rows.length > 0) spotPrice = sp.rows[0].sisalmon_avg;
          } catch { /* ignore */ }

          console.log(`  [${vs.vesselName}] TRIP: ${vs.farmName} → ${ns.sh.name} | ${volume.toFixed(0)}t | ${durationHours.toFixed(1)}h`);

          if (!DRY_RUN) {
            try {
              const result = await pool.query(
                `INSERT INTO harvest_trips
                 (vessel_id, vessel_name, origin_locality_id, origin_name, origin_ticker,
                  destination_slaughterhouse_id, destination_name, departure_time, arrival_time,
                  duration_hours, estimated_volume_tonnes, spot_price_at_harvest,
                  production_area_number, status)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'completed')
                 ON CONFLICT (vessel_name, departure_time) DO NOTHING`,
                [vs.vesselId, vs.vesselName, vs.farmId ?? null, vs.farmName ?? null, vs.farmTicker ?? null,
                 ns.sh.id, ns.sh.name, departureTime, ts,
                 durationHours.toFixed(1), volume.toFixed(1), spotPrice, vs.farmArea ?? null]
              );
              if (result.rowCount && result.rowCount > 0) tripsInserted++;
              else tripsSkipped++;
            } catch (e: any) {
              if (!e.message?.includes("duplicate")) console.error("  Trip insert error:", e.message);
              else tripsSkipped++;
            }
          } else {
            tripsInserted++;
          }

          vs.state = "idle";
          vs.farmId = undefined; vs.farmName = undefined; vs.farmTicker = undefined;
          vs.departureTime = undefined;
        }
        break;
    }
  }

  console.log(`\n  Trips inserted: ${tripsInserted} | already in DB: ${tripsSkipped}`);
  return tripsInserted;
}

// ─── Main ─────────────────────────────────────────────────────────────────

async function main() {
  console.log("═══════════════════════════════════════════════════════");
  console.log("  Harvest Trip Backfill");
  console.log("═══════════════════════════════════════════════════════");
  console.log(`  Mode: ${DRY_RUN ? "DRY RUN" : "LIVE"} | Days: ${DAYS_BACK} | Replay only: ${REPLAY_ONLY}`);
  console.log();

  // Load farms + slaughterhouses
  const farmRes = await pool.query(
    `SELECT locality_id AS id, name, ticker, lat::float, lng::float, production_area_number AS area
     FROM seafood_localities WHERE lat IS NOT NULL AND lng IS NOT NULL AND is_active = true`
  );
  const farms: Farm[] = farmRes.rows;

  const shRes = await pool.query(
    "SELECT id, name, ticker, lat::float, lng::float, production_area_number AS area FROM harvest_slaughterhouses WHERE is_active = true"
  );
  const slaughterhouses: SH[] = shRes.rows;
  console.log(`  Loaded ${farms.length} farms, ${slaughterhouses.length} slaughterhouses`);

  // ─── Step 1: Fetch BarentsWatch track history ───────────────────────────
  if (!REPLAY_ONLY) {
    console.log(`\n━━━ Fetching BarentsWatch track history (last ${DAYS_BACK} days) ━━━`);

    const token = await getBWToken();
    if (!token) {
      console.log("  Skipping BW fetch — no credentials");
    } else {
      const vesRes = await pool.query(
        "SELECT id, vessel_name, mmsi FROM harvest_vessels WHERE is_active = true AND mmsi IS NOT NULL"
      );
      const vessels = vesRes.rows;

      const toTime = new Date().toISOString();
      const fromTime = new Date(Date.now() - DAYS_BACK * 86400000).toISOString();
      console.log(`  Time range: ${fromTime.slice(0,10)} → ${toTime.slice(0,10)}`);
      console.log(`  Vessels to query: ${vessels.length}`);

      let totalInserted = 0;
      let totalPoints = 0;

      for (const v of vessels) {
        process.stdout.write(`  [${v.vessel_name.padEnd(24)}] `);
        const points = await fetchBWTrack(v.mmsi, token, fromTime, toTime);

        if (points.length === 0) {
          process.stdout.write("no data\n");
          await new Promise(r => setTimeout(r, 300)); // throttle
          continue;
        }

        totalPoints += points.length;
        let inserted = 0;

        if (!DRY_RUN) {
          for (const p of points) {
            try {
              const res = await pool.query(
                `INSERT INTO harvest_vessel_positions
                 (vessel_id, mmsi, latitude, longitude, speed_knots, heading, course, nav_status, timestamp)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, 'unknown', $8)
                 ON CONFLICT DO NOTHING`,
                [v.id, v.mmsi, p.lat, p.lng, p.sog || null, p.cog || null, p.cog || null, p.timestamp]
              );
              if (res.rowCount && res.rowCount > 0) inserted++;
            } catch { /* duplicate — ignore */ }
          }
        } else {
          inserted = points.length;
        }

        totalInserted += inserted;
        process.stdout.write(`${points.length} points → ${inserted} new\n`);
        await new Promise(r => setTimeout(r, 300)); // throttle BW API
      }

      console.log(`\n  Total: ${totalPoints} track points, ${totalInserted} new positions inserted`);
    }
  }

  // ─── Step 2: Replay trip detection ─────────────────────────────────────
  const tripsFound = await replayTripDetection(farms, slaughterhouses);

  // ─── Step 3: Final trip count ───────────────────────────────────────────
  const countRes = await pool.query(
    "SELECT COUNT(*) FROM harvest_trips WHERE departure_time > NOW() - INTERVAL '7 days'"
  );
  console.log(`\n  Trips in last 7 days: ${countRes.rows[0].count}`);

  const recentRes = await pool.query(`
    SELECT vessel_name, departure_time, arrival_time, destination_name, estimated_volume_tonnes
    FROM harvest_trips ORDER BY departure_time DESC LIMIT 5
  `);
  console.log("\n  5 most recent trips:");
  for (const t of recentRes.rows) {
    const dep = new Date(t.departure_time).toISOString().slice(0,16);
    console.log(`    ${t.vessel_name.padEnd(24)} ${dep}  → ${t.destination_name}  ${t.estimated_volume_tonnes}t`);
  }

  await pool.end();
  console.log(`\n  Done. ${DRY_RUN ? "(dry run — no DB writes)" : ""}`);
}

main().catch(err => { console.error("Fatal:", err.message); process.exit(1); });
