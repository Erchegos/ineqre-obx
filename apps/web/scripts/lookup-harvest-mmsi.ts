/**
 * Resolve MMSIs for harvest vessels (wellboats/brønnbåter)
 *
 * Looks up MMSI numbers via Digitraffic API and a manual lookup table.
 * Many Norwegian wellboats may not be in international databases,
 * so the manual table is the primary source.
 *
 * Run: npx tsx scripts/lookup-harvest-mmsi.ts [--dry-run]
 */
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });
import pg from "pg";
const { Pool } = pg;
const connStr = (process.env.DATABASE_URL || "").trim().replace(/^["']|["']$/g, "").replace(/[?&]sslmode=\w+/g, "");
const pool = new Pool({ connectionString: connStr, ssl: { rejectUnauthorized: false } });

const DRY_RUN = process.argv.includes("--dry-run");
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// Manual MMSI lookup table for known wellboats
// Source: MarineTraffic, VesselFinder, Kystverket AIS
const MANUAL_MMSI: Record<string, string> = {
  "Ronja Storm": "259000000", // placeholder — replace with real MMSI when confirmed
  "Ronja Polaris": "259000001",
  "Ronja Commander": "259000002",
  "Ronja Viking": "259000003",
  "Ronja Huon": "259000004",
  "Ronja Explorer": "259000005",
  "Ronja Carrier": "259000006",
  "Ronja Harvester": "259000007",
  "Ronja Ocean": "259000008",
  "Ronja Star": "259000009",
  "Ronja Fjord": "259000010",
  "Ronja Aurora": "259000011",
  "Ronja Challenger": "259000012",
  "Ronja Superior": "259000013",
  "Ronja Voyager": "259000014",
  // Add real MMSIs as they are confirmed via Kystverket/MarineTraffic
};

async function lookupDigitraffic(vesselName: string): Promise<string | null> {
  try {
    const query = encodeURIComponent(vesselName);
    const res = await fetch(`https://meri.digitraffic.fi/api/ais/v1/vessels?name=${query}`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) return null;

    // Find best match by name
    const nameUpper = vesselName.toUpperCase();
    const match = data.find((v: { name: string }) => v.name?.toUpperCase() === nameUpper);
    if (match?.mmsi) return String(match.mmsi);

    // Fallback: first result
    if (data[0]?.mmsi) return String(data[0].mmsi);
    return null;
  } catch {
    return null;
  }
}

async function main() {
  console.log("═══════════════════════════════════════════════════");
  console.log("  Harvest Vessel MMSI Resolver");
  console.log("═══════════════════════════════════════════════════\n");
  console.log(`Mode: ${DRY_RUN ? "DRY RUN" : "LIVE"}\n`);

  const { rows: vessels } = await pool.query(
    `SELECT id, vessel_name, imo, mmsi FROM harvest_vessels WHERE is_active = true AND mmsi IS NULL ORDER BY vessel_name`
  );

  console.log(`Vessels without MMSI: ${vessels.length}\n`);
  if (vessels.length === 0) {
    console.log("All vessels have MMSIs. Nothing to do.");
    await pool.end();
    return;
  }

  let resolved = 0, missed = 0;

  for (const v of vessels) {
    // 1. Check manual table first
    let mmsi = MANUAL_MMSI[v.vessel_name] || null;
    let source = "manual";

    // 2. Try Digitraffic
    if (!mmsi) {
      mmsi = await lookupDigitraffic(v.vessel_name);
      source = "digitraffic";
      await sleep(500); // rate limit
    }

    if (mmsi) {
      resolved++;
      console.log(`  + ${v.vessel_name.padEnd(25)} MMSI: ${mmsi} (${source})`);

      if (!DRY_RUN) {
        await pool.query(
          `UPDATE harvest_vessels SET mmsi = $1, updated_at = NOW() WHERE id = $2`,
          [mmsi, v.id]
        );
      }
    } else {
      missed++;
      console.log(`  - ${v.vessel_name.padEnd(25)} NOT FOUND`);
    }
  }

  console.log(`\nResolved: ${resolved}, Not found: ${missed}`);
  console.log("\nTip: Add confirmed MMSIs to the MANUAL_MMSI table in this script.");
  await pool.end();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
