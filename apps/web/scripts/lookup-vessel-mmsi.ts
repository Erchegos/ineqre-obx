/**
 * Lookup and populate MMSI numbers for shipping vessels
 *
 * Strategy:
 * 1. Try Digitraffic vessel registry (free, global IMO→MMSI)
 * 2. Try vessel name search in Digitraffic
 * 3. Fall back to manually verified MMSI table
 * 4. Update shipping_vessels with correct IMO + MMSI
 *
 * Run: npx tsx scripts/lookup-vessel-mmsi.ts
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

// Manually verified IMO→MMSI from MarineTraffic/VesselFinder (web research)
// These override any Digitraffic results and fix incorrect seed IMOs
const VERIFIED_VESSELS: Record<
  string,
  { correctImo: string; mmsi: string; notes?: string }
> = {
  // FRO (Frontline)
  "Front Alta": {
    correctImo: "9920772",
    mmsi: "538009638",
    notes: "Seed had 9806089",
  },
  "Front Njord": {
    correctImo: "9408205",
    mmsi: "538009041",
    notes: "Seed had 9348906",
  },
  "Front Eminence": { correctImo: "9806091", mmsi: "538007380" },

  // HAFNI (Hafnia)
  "Hafnia Lotte": {
    correctImo: "9732694",
    mmsi: "249329000",
    notes: "Seed had 9858272",
  },
  "Hafnia Phoenix": {
    correctImo: "9461702",
    mmsi: "219487000",
    notes: "Seed had 9828143",
  },
  "Hafnia Courage": { correctImo: "9723965", mmsi: "538006281" },

  // GOGL (Golden Ocean)
  "Golden Monterey": { correctImo: "9840746", mmsi: "538008682" },
  "Golden Hawk": { correctImo: "9304831", mmsi: "538005888" },
  "Golden Opus": { correctImo: "9840758", mmsi: "538008683" },

  // BELCO (Belships)
  Belfriend: { correctImo: "9901764", mmsi: "257086900" },
  Belforest: { correctImo: "9901776", mmsi: "257087000" },
  Belvista: { correctImo: "9847382", mmsi: "538007999" },

  // 2020 (2020 Bulkers)
  "Bulk Shenzhen": { correctImo: "9855072", mmsi: "538007567" },
  "Bulk Shanghai": { correctImo: "9855084", mmsi: "538007568" },
  "Bulk Sandefjord": { correctImo: "9855096", mmsi: "538007569" },

  // MPCC (MPC Container Ships)
  "AS Carelia": { correctImo: "9354845", mmsi: "636092756" },
  "AS Clarita": { correctImo: "9354857", mmsi: "636092757" },
  "MPCC Bilbao": { correctImo: "9297591", mmsi: "305564000" },

  // HAVI (Höegh Autoliners)
  "Höegh Aurora": { correctImo: "9919217", mmsi: "257523000" },
  "Höegh Jacksonville": { correctImo: "9684993", mmsi: "258366000" },
  "Höegh Trapper": { correctImo: "9684981", mmsi: "258367000" },

  // ODFJELL-B (Odfjell)
  "Bow Trident": { correctImo: "9796218", mmsi: "259474000" },
  "Bow Fortune": { correctImo: "9370803", mmsi: "538005123" },
  "Bow Architect": { correctImo: "9370815", mmsi: "538005124" },

  // FLNG (Flex LNG)
  "Flex Endeavour": { correctImo: "9787198", mmsi: "538006697" },
  "Flex Ranger": { correctImo: "9750489", mmsi: "538006523" },
  "Flex Constellation": { correctImo: "9787203", mmsi: "538006698" },

  // BWLPG (BW LPG)
  "BW Magellan": { correctImo: "9728648", mmsi: "563095800" },
  "BW Gemini": { correctImo: "9728650", mmsi: "563095900" },
  "BW Balder": { correctImo: "9234984", mmsi: "563043500" },
};

interface DTVessel {
  mmsi: number;
  imo: number;
  name: string;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  // 1. Get all vessels from DB
  const vessels = await pool.query(
    "SELECT imo, vessel_name, mmsi FROM shipping_vessels WHERE status = 'active' ORDER BY vessel_name"
  );
  console.log(`Found ${vessels.rows.length} active vessels in DB\n`);

  // 2. Try Digitraffic vessel registry for automatic IMO→MMSI
  let dtVessels: DTVessel[] = [];
  try {
    console.log("Fetching Digitraffic vessel registry...");
    const resp = await fetch("https://meri.digitraffic.fi/api/ais/v1/vessels", {
      headers: { "Accept-Encoding": "gzip" },
      signal: AbortSignal.timeout(30000),
    });
    if (resp.ok) {
      dtVessels = await resp.json();
      console.log(`Digitraffic registry: ${dtVessels.length} vessels\n`);
    }
  } catch (err) {
    console.log("Digitraffic unavailable, using verified table only\n");
  }

  // Build Digitraffic lookup maps
  const dtByImo = new Map<number, DTVessel>();
  const dtByName = new Map<string, DTVessel>();
  for (const v of dtVessels) {
    if (v.imo) dtByImo.set(v.imo, v);
    if (v.name) dtByName.set(v.name.toUpperCase().trim(), v);
  }

  // 3. Process each vessel
  let updated = 0;
  let imoFixed = 0;
  const results: {
    name: string;
    oldImo: string;
    newImo: string;
    mmsi: string;
    source: string;
  }[] = [];

  for (const row of vessels.rows) {
    const name = row.vessel_name;
    const seedImo = row.imo;
    const currentMmsi = row.mmsi;

    let resolvedImo = seedImo;
    let resolvedMmsi = currentMmsi;
    let source = "existing";

    // Priority 1: Verified manual table
    const verified = VERIFIED_VESSELS[name];
    if (verified) {
      resolvedImo = verified.correctImo;
      resolvedMmsi = verified.mmsi;
      source = "verified";
    }
    // Priority 2: Digitraffic by IMO
    else if (dtByImo.has(parseInt(seedImo))) {
      const dt = dtByImo.get(parseInt(seedImo))!;
      resolvedMmsi = String(dt.mmsi);
      source = "digitraffic_imo";
    }
    // Priority 3: Digitraffic by name
    else if (dtByName.has(name.toUpperCase())) {
      const dt = dtByName.get(name.toUpperCase())!;
      if (dt.imo) resolvedImo = String(dt.imo);
      resolvedMmsi = String(dt.mmsi);
      source = "digitraffic_name";
    }

    results.push({
      name,
      oldImo: seedImo,
      newImo: resolvedImo,
      mmsi: resolvedMmsi || "UNKNOWN",
      source,
    });

    if (dryRun) continue;

    // Update DB if anything changed
    const imoChanged = resolvedImo !== seedImo;
    const mmsiChanged =
      resolvedMmsi && resolvedMmsi !== currentMmsi && resolvedMmsi !== "UNKNOWN";

    if (imoChanged || mmsiChanged) {
      // Update IMO if changed (also need to update positions FK)
      if (imoChanged) {
        await pool.query(
          "UPDATE shipping_positions SET imo = $1 WHERE imo = $2",
          [resolvedImo, seedImo]
        );
        await pool.query(
          "UPDATE shipping_vessel_contracts SET imo = $1 WHERE imo = $2",
          [resolvedImo, seedImo]
        );
        await pool.query(
          "UPDATE shipping_vessels SET imo = $1, mmsi = $2 WHERE imo = $3",
          [resolvedImo, resolvedMmsi, seedImo]
        );
        imoFixed++;
      } else if (mmsiChanged) {
        await pool.query(
          "UPDATE shipping_vessels SET mmsi = $1 WHERE imo = $2",
          [resolvedMmsi, resolvedImo]
        );
      }
      updated++;
    }
  }

  // Print results table
  console.log("--- Vessel Resolution Results ---\n");
  console.log(
    `${"Vessel".padEnd(25)} ${"Old IMO".padEnd(10)} ${"New IMO".padEnd(10)} ${"MMSI".padEnd(12)} Source`
  );
  console.log("-".repeat(75));
  for (const r of results) {
    const imoFlag = r.oldImo !== r.newImo ? " *" : "";
    console.log(
      `${r.name.padEnd(25)} ${r.oldImo.padEnd(10)} ${(r.newImo + imoFlag).padEnd(10)} ${r.mmsi.padEnd(12)} ${r.source}`
    );
  }

  console.log(`\n--- Summary ---`);
  console.log(`Total vessels: ${vessels.rows.length}`);
  console.log(`Updated: ${updated}`);
  console.log(`IMOs corrected: ${imoFixed}`);
  console.log(
    `MMSI resolved: ${results.filter((r) => r.mmsi !== "UNKNOWN").length}/${results.length}`
  );
  if (dryRun) console.log("\n(DRY RUN - no DB changes made)");

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
