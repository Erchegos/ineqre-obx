/**
 * Fetch real vessel positions from Digitraffic (Finnish Transport Agency) free AIS API
 *
 * 1. Downloads full vessel list from Digitraffic to get IMO→MMSI mapping
 * 2. Fetches latest AIS positions for matched vessels
 * 3. Updates shipping_positions and shipping_vessels tables
 *
 * Digitraffic AIS API is completely free, no auth required.
 * Coverage: Global AIS data received by Finnish coastal stations.
 *
 * Run: npx tsx scripts/fetch-vessel-positions.ts
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

interface DTVessel {
  mmsi: number;
  imo: number;
  name: string;
  destination?: string;
  draught?: number;
  shipType?: number;
}

interface DTFeature {
  mmsi: number;
  type: string;
  geometry: {
    type: string;
    coordinates: [number, number]; // [lon, lat]
  };
  properties: {
    mmsi: number;
    sog: number; // speed over ground (knots * 10)
    cog: number; // course over ground (degrees * 10)
    heading: number;
    navStat: number;
    timestamp: number;
  };
}

function navStatusString(code: number): string {
  const map: Record<number, string> = {
    0: "under_way",
    1: "at_anchor",
    2: "not_under_command",
    3: "restricted_manoeuvrability",
    4: "constrained_by_draught",
    5: "moored",
    6: "aground",
    7: "engaged_in_fishing",
    8: "under_way_sailing",
    11: "power_driven_towing",
    12: "pushing_ahead",
    14: "ais_sart",
    15: "undefined",
  };
  return map[code] || "undefined";
}

function operationalStatus(navCode: number, speedKnots: number): string {
  if (navCode === 5) return "in_port";
  if (navCode === 1) return "anchored";
  if (speedKnots > 1) return "at_sea";
  if (navCode === 0 || navCode === 8) return "at_sea";
  return "waiting";
}

async function main() {
  // 1. Get our vessel IMOs from DB
  const vessels = await pool.query(
    "SELECT imo, vessel_name FROM shipping_vessels WHERE status = 'active' ORDER BY vessel_name"
  );
  const ourImos = new Map<number, string>();
  for (const v of vessels.rows) {
    const imo = parseInt(v.imo);
    if (!isNaN(imo)) ourImos.set(imo, v.vessel_name);
  }
  console.log(`Found ${ourImos.size} active vessels in DB`);

  // 2. Download Digitraffic vessel metadata (IMO→MMSI mapping)
  console.log("Fetching Digitraffic vessel list...");
  const vesselResp = await fetch("https://meri.digitraffic.fi/api/ais/v1/vessels", {
    headers: { "Accept-Encoding": "gzip" },
  });
  if (!vesselResp.ok) {
    throw new Error(`Digitraffic vessel list failed: ${vesselResp.status}`);
  }
  const dtVessels: DTVessel[] = await vesselResp.json();
  console.log(`Digitraffic has ${dtVessels.length} vessels`);

  // 3. Match our vessels
  const matched: { imo: number; mmsi: number; name: string; dbName: string }[] = [];
  for (const dtv of dtVessels) {
    if (ourImos.has(dtv.imo)) {
      matched.push({ imo: dtv.imo, mmsi: dtv.mmsi, name: dtv.name, dbName: ourImos.get(dtv.imo)! });
    }
  }
  console.log(`Matched ${matched.length} of ${ourImos.size} vessels`);

  if (matched.length === 0) {
    console.log("No matches found. Digitraffic may have limited coverage for our fleet.");
    await pool.end();
    return;
  }

  // 4. Update MMSIs in vessels table
  console.log("\nUpdating MMSI numbers...");
  let mmsiUpdated = 0;
  for (const m of matched) {
    const r = await pool.query(
      "UPDATE shipping_vessels SET mmsi = $1 WHERE imo = $2 AND (mmsi IS NULL OR mmsi != $1)",
      [String(m.mmsi), String(m.imo)]
    );
    if (r.rowCount && r.rowCount > 0) mmsiUpdated++;
  }
  console.log(`Updated ${mmsiUpdated} MMSI numbers`);

  // 5. Fetch positions for matched vessels (by MMSI)
  console.log("\nFetching AIS positions...");
  let posUpdated = 0;
  let posFailed = 0;

  // Digitraffic allows fetching single vessel positions by MMSI
  for (let i = 0; i < matched.length; i++) {
    const m = matched[i];
    if (i > 0 && i % 20 === 0) {
      console.log(`  Progress: ${i}/${matched.length} (${posUpdated} updated)`);
      await new Promise((r) => setTimeout(r, 200)); // small delay every 20 requests
    }

    try {
      const posResp = await fetch(
        `https://meri.digitraffic.fi/api/ais/v1/locations?mmsi=${m.mmsi}`,
        { headers: { "Accept-Encoding": "gzip" } }
      );

      if (!posResp.ok) {
        posFailed++;
        continue;
      }

      const posData = await posResp.json();
      const features: DTFeature[] = posData?.features || [];

      if (features.length === 0) {
        continue;
      }

      const f = features[0];
      const [lon, lat] = f.geometry.coordinates;
      const speedKnots = (f.properties.sog ?? 0) / 10;
      const cog = (f.properties.cog ?? 0) / 10;
      const heading = f.properties.heading !== 511 ? f.properties.heading : null;
      const navCode = f.properties.navStat ?? 15;
      const reportedAt = new Date(f.properties.timestamp);

      // Skip positions older than 7 days (stale data)
      const ageMs = Date.now() - reportedAt.getTime();
      if (ageMs > 7 * 86400000) continue;

      const navStr = navStatusString(navCode);
      const opStr = operationalStatus(navCode, speedKnots);

      // Delete old seed position and insert real AIS position
      await pool.query("DELETE FROM shipping_positions WHERE imo = $1", [String(m.imo)]);
      await pool.query(
        `INSERT INTO shipping_positions (imo, latitude, longitude, speed_knots, heading, course, nav_status, operational_status, reported_at, source, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'digitraffic_ais', NOW())`,
        [String(m.imo), lat, lon, speedKnots, heading, cog, navStr, opStr, reportedAt]
      );
      posUpdated++;
    } catch (err) {
      posFailed++;
    }
  }

  console.log(`\n--- Summary ---`);
  console.log(`Total vessels in DB: ${ourImos.size}`);
  console.log(`Matched in Digitraffic: ${matched.length}`);
  console.log(`Positions updated: ${posUpdated}`);
  console.log(`Failed/stale: ${posFailed}`);
  console.log(`Coverage: ${((posUpdated / ourImos.size) * 100).toFixed(1)}%`);

  if (posUpdated < ourImos.size) {
    const missing = ourImos.size - posUpdated;
    console.log(`\n${missing} vessels without AIS position.`);
    console.log("These may be outside Digitraffic's AIS receiver range.");
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
