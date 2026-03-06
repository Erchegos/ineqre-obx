/**
 * Daily AIS Position Update — Multi-Source
 *
 * Three-phase approach for maximum vessel coverage:
 *
 * Phase 1: MMSI Resolution
 *   - VesselFinder: scrape vessel pages by IMO to get MMSI (rate-limited, 2s delay)
 *   - Digitraffic: vessel registry exact name match (bulk download)
 *
 * Phase 2: BarentsWatch Open Positions (Norwegian/Nordic waters)
 *   - Free REST API, OAuth2 auth (same creds as seafood)
 *   - Returns ~4000 vessels in Nordic waters — match against our fleet by MMSI or name
 *   - Instant, no waiting
 *
 * Phase 3: AISStream.io WebSocket (global coverage)
 *   - Catches vessels outside Nordic waters
 *   - Runs for --duration seconds (default 600s = 10 min)
 *
 * Run: pnpm run ais:daily
 * Options:
 *   --duration=600     AISStream listen time in seconds (default 600)
 *   --dry-run          Don't write to DB
 *   --skip-resolve     Skip MMSI resolution
 *   --skip-barentswatch Skip BarentsWatch phase
 *   --skip-aisstream   Skip AISStream phase
 */

import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import WebSocket from "ws";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

import pg from "pg";
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const AISSTREAM_URL = "wss://stream.aisstream.io/v0/stream";
const API_KEY = process.env.AISSTREAM_API_KEY;

const BW_TOKEN_URL = "https://id.barentswatch.no/connect/token";
const BW_POSITIONS_URL = "https://www.barentswatch.no/bwapi/v2/geodata/ais/openpositions";
const BW_CLIENT_ID = process.env.BARENTSWATCH_CLIENT_ID || "";
const BW_CLIENT_SECRET = process.env.BARENTSWATCH_CLIENT_SECRET || "";

const NAV_STATUS: Record<number, string> = {
  0: "under_way", 1: "at_anchor", 2: "not_under_command",
  3: "restricted_manoeuvrability", 4: "constrained_by_draught",
  5: "moored", 6: "aground", 7: "engaged_in_fishing",
  8: "under_way_sailing", 11: "power_driven_towing",
  12: "pushing_ahead", 14: "ais_sart", 15: "undefined",
};

// BarentsWatch navstat mapping
const BW_NAV_STATUS: Record<number, string> = {
  0: "under_way", 1: "at_anchor", 2: "not_under_command",
  3: "restricted_manoeuvrability", 4: "constrained_by_draught",
  5: "moored", 6: "aground", 7: "engaged_in_fishing",
  8: "under_way_sailing", 15: "undefined",
};

function operationalStatus(navCode: number, speedKnots: number): string {
  if (navCode === 5) return "in_port";
  if (navCode === 1) return "anchored";
  if (speedKnots > 1) return "at_sea";
  if (navCode === 0 || navCode === 8) return "at_sea";
  return "waiting";
}

interface PositionUpdate {
  imo: string;
  vesselName: string;
  lat: number;
  lon: number;
  speed: number;
  course: number;
  heading: number | null;
  navStatus: string;
  opStatus: string;
  destination: string | null;
  timestamp: Date;
  source: string;
}

// ─── Phase 1: MMSI Resolution ───────────────────────────────────────

async function resolveMMSIs(dryRun: boolean): Promise<number> {
  console.log("\n=== Phase 1: MMSI Resolution ===\n");

  const vessels = await pool.query(
    "SELECT imo, vessel_name FROM shipping_vessels WHERE status = 'active' AND mmsi IS NULL ORDER BY vessel_name"
  );

  if (vessels.rows.length === 0) {
    console.log("All vessels already have MMSIs.");
    return 0;
  }

  console.log(`${vessels.rows.length} vessels without MMSI.`);

  // --- Method A: VesselFinder by IMO ---
  console.log("\n[VesselFinder] Looking up by IMO...");
  let vfResolved = 0;
  const remaining: Array<{ imo: string; vessel_name: string }> = [];

  for (const v of vessels.rows) {
    try {
      const url = `https://www.vesselfinder.com/vessels/details/${v.imo}`;
      const r = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
          Accept: "text/html",
        },
        redirect: "follow",
      });

      if (r.status === 200) {
        const html = await r.text();
        const mmsiMatch = html.match(/mmsi['":\s]+(\d{9})/i);
        if (mmsiMatch) {
          const mmsi = mmsiMatch[1];
          vfResolved++;
          console.log(`  OK: ${v.vessel_name} (IMO ${v.imo}) → MMSI ${mmsi}`);
          if (!dryRun) {
            await pool.query("UPDATE shipping_vessels SET mmsi = $1 WHERE imo = $2", [mmsi, v.imo]);
          }
        } else {
          remaining.push(v);
        }
      } else if (r.status === 429) {
        console.log("  Rate limited by VesselFinder. Stopping VF lookups.");
        remaining.push(v);
        // Push all remaining
        const idx = vessels.rows.indexOf(v);
        remaining.push(...vessels.rows.slice(idx + 1));
        break;
      } else {
        remaining.push(v);
      }

      // Rate limit: 2 second delay between requests
      await new Promise((resolve) => setTimeout(resolve, 2000));
    } catch {
      remaining.push(v);
    }
  }

  console.log(`  VesselFinder by IMO: ${vfResolved}`);

  // --- Method B: VesselFinder by vessel name (for vessels where IMO failed) ---
  if (remaining.length > 0) {
    console.log(`\n[VesselFinder] Looking up ${remaining.length} remaining by name...`);
    let nameResolved = 0;
    const stillRemaining: typeof remaining = [];

    for (const v of remaining) {
      try {
        const searchUrl = `https://www.vesselfinder.com/vessels?name=${encodeURIComponent(v.vessel_name)}&type=400`;
        const r = await fetch(searchUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
            Accept: "text/html",
          },
        });

        if (r.status === 200) {
          const html = await r.text();
          // VesselFinder embeds vessel links as /vessels/VESSELNAME-IMO-XXXXXXX-MMSI-XXXXXXXXX
          const linkPattern = new RegExp(
            `\\/vessels\\/[\\w-]+-IMO-(\\d{7})-MMSI-(\\d{9})`,
            "g",
          );
          const matches = [...html.matchAll(linkPattern)];

          // Find exact name match in links
          const nameUpper = v.vessel_name.toUpperCase().replace(/\s+/g, "-");
          const exactMatch = matches.find((m) => {
            const linkName = m[0].split("/")[2].split("-IMO-")[0].toUpperCase();
            return linkName === nameUpper;
          });

          if (exactMatch) {
            const realIMO = exactMatch[1];
            const mmsi = exactMatch[2];
            nameResolved++;
            console.log(`  OK: ${v.vessel_name} → IMO ${realIMO}, MMSI ${mmsi}`);
            if (!dryRun) {
              await pool.query("UPDATE shipping_vessels SET mmsi = $1, imo = $2 WHERE imo = $3", [mmsi, realIMO, v.imo]);
            }
          } else if (matches.length === 1) {
            // Only one result — likely correct
            const realIMO = matches[0][1];
            const mmsi = matches[0][2];
            nameResolved++;
            console.log(`  OK (single): ${v.vessel_name} → IMO ${realIMO}, MMSI ${mmsi}`);
            if (!dryRun) {
              await pool.query("UPDATE shipping_vessels SET mmsi = $1, imo = $2 WHERE imo = $3", [mmsi, realIMO, v.imo]);
            }
          } else {
            stillRemaining.push(v);
          }
        } else if (r.status === 429 || r.status === 403) {
          console.log("  Rate limited. Stopping name lookups.");
          const idx = remaining.indexOf(v);
          stillRemaining.push(...remaining.slice(idx));
          break;
        } else {
          stillRemaining.push(v);
        }

        await new Promise((resolve) => setTimeout(resolve, 2500));
      } catch {
        // fetch failed = likely blocked
        console.log("  Connection blocked. Stopping name lookups.");
        const idx = remaining.indexOf(v);
        stillRemaining.push(...remaining.slice(idx));
        break;
      }
    }
    console.log(`  VesselFinder by name: ${nameResolved}`);
    vfResolved += nameResolved;
  }

  // --- Method C: Digitraffic registry by exact name ---
  console.log(`\n[Digitraffic] Registry lookup...`);
  try {
    const allWithoutMMSI = await pool.query(
      "SELECT imo, vessel_name FROM shipping_vessels WHERE status = 'active' AND mmsi IS NULL ORDER BY vessel_name"
    );
    if (allWithoutMMSI.rows.length > 0) {
      const res = await fetch("https://meri.digitraffic.fi/api/ais/v1/vessels", {
        headers: { "Accept-Encoding": "gzip" },
      });
      if (res.ok) {
        const registry: Array<{ name: string; mmsi: number; imo: number }> = await res.json();
        const nameMap = new Map<string, number>();
        for (const r of registry) {
          if (r.name && r.mmsi) nameMap.set(r.name.toUpperCase().trim(), r.mmsi);
        }

        let dtResolved = 0;
        for (const v of allWithoutMMSI.rows) {
          const match = nameMap.get(v.vessel_name.toUpperCase().trim());
          if (match) {
            dtResolved++;
            console.log(`  OK: ${v.vessel_name} → MMSI ${match}`);
            if (!dryRun) {
              await pool.query("UPDATE shipping_vessels SET mmsi = $1 WHERE imo = $2", [String(match), v.imo]);
            }
          }
        }
        console.log(`  Digitraffic resolved: ${dtResolved}`);
        vfResolved += dtResolved;
      }
    } else {
      console.log("  No vessels remaining.");
    }
  } catch (e) {
    console.log(`  Digitraffic error: ${(e as Error).message}`);
  }

  console.log(`\nTotal new MMSIs: ${vfResolved}${dryRun ? " (dry run)" : ""}`);
  return vfResolved;
}

// ─── Phase 2: BarentsWatch Open Positions ───────────────────────────

async function fetchBarentsWatch(dryRun: boolean): Promise<Map<string, PositionUpdate>> {
  console.log("\n=== Phase 2: BarentsWatch (Norwegian Waters) ===\n");
  const positions = new Map<string, PositionUpdate>();

  if (!BW_CLIENT_ID || !BW_CLIENT_SECRET) {
    console.log("BarentsWatch credentials not configured. Skipping.");
    return positions;
  }

  // Get OAuth2 token
  const tokenRes = await fetch(BW_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: BW_CLIENT_ID,
      client_secret: BW_CLIENT_SECRET,
    }),
  });

  if (tokenRes.status !== 200) {
    console.log("BarentsWatch token failed:", tokenRes.status);
    return positions;
  }

  const token = (await tokenRes.json()).access_token;

  // Get our fleet data for matching
  const fleet = await pool.query(
    "SELECT imo, vessel_name, mmsi FROM shipping_vessels WHERE status = 'active'"
  );
  const mmsiToVessel = new Map<number, { imo: string; name: string }>();
  const nameToVessel = new Map<string, { imo: string; name: string }>();
  for (const v of fleet.rows) {
    if (v.mmsi) mmsiToVessel.set(Number(v.mmsi), { imo: v.imo, name: v.vessel_name });
    nameToVessel.set(v.vessel_name.toUpperCase().trim(), { imo: v.imo, name: v.vessel_name });
  }

  // Fetch open positions in wide Nordic area (Lat 50-80, Lon -30 to 40)
  // This covers Norwegian Sea, North Sea, Baltic, and transit routes
  // BarentsWatch only has AIS receivers covering Norwegian/Nordic waters
  const regions = [
    { label: "Norwegian Coast & North Sea", xmin: -10, ymin: 55, xmax: 35, ymax: 72 },
    { label: "Barents Sea & Svalbard", xmin: 10, ymin: 70, xmax: 45, ymax: 82 },
  ];

  let totalBW = 0;
  let matchedMMSI = 0;
  let matchedName = 0;

  for (const region of regions) {
    try {
      const url = `${BW_POSITIONS_URL}?Xmin=${region.xmin}&Ymin=${region.ymin}&Xmax=${region.xmax}&Ymax=${region.ymax}`;
      const res = await fetch(url, {
        headers: { Authorization: "Bearer " + token },
      });

      if (res.status !== 200) {
        console.log(`  ${region.label}: HTTP ${res.status}`);
        continue;
      }

      const data: Array<{
        mmsi: number;
        name: string;
        sog: number;
        cog: number;
        navstat: number;
        heading: number;
        destination: string | null;
        timeStamp: string;
        geometry: { coordinates: [number, number] };
      }> = await res.json();

      totalBW += data.length;

      for (const v of data) {
        // Match by MMSI first
        let vessel = mmsiToVessel.get(v.mmsi);
        let matchType = "mmsi";

        // Then by exact name
        if (!vessel && v.name) {
          vessel = nameToVessel.get(v.name.toUpperCase().trim());
          matchType = "name";
        }

        if (!vessel) continue;

        // Already got this vessel from a previous region?
        if (positions.has(vessel.imo)) continue;

        const [lon, lat] = v.geometry.coordinates;
        if (Math.abs(lat) > 90 || Math.abs(lon) > 180 || (lat === 0 && lon === 0)) continue;

        const navCode = v.navstat ?? 15;
        const sog = v.sog ?? 0;

        positions.set(vessel.imo, {
          imo: vessel.imo,
          vesselName: vessel.name,
          lat, lon, speed: sog,
          course: v.cog ?? 0,
          heading: v.heading != null && v.heading !== 511 ? v.heading : null,
          navStatus: BW_NAV_STATUS[navCode] || "undefined",
          opStatus: operationalStatus(navCode, sog),
          destination: v.destination || null,
          timestamp: new Date(v.timeStamp),
          source: "barentswatch",
        });

        if (matchType === "mmsi") matchedMMSI++;
        else matchedName++;

        // Also resolve MMSI if we matched by name but don't have MMSI stored
        const fleetRow = fleet.rows.find((f) => f.imo === vessel!.imo);
        if (fleetRow && !fleetRow.mmsi && v.mmsi) {
          console.log(`  MMSI bonus: ${vessel.name} → ${v.mmsi}`);
          if (!dryRun) {
            await pool.query("UPDATE shipping_vessels SET mmsi = $1 WHERE imo = $2", [String(v.mmsi), vessel.imo]);
          }
        }
      }

      const regionMatches = matchedMMSI + matchedName - (positions.size - data.length); // approximate
      console.log(`  ${region.label}: ${data.length} vessels, ${positions.size} fleet matches total`);
    } catch (e) {
      console.log(`  ${region.label} error: ${(e as Error).message}`);
    }

    // Small delay between region requests
    await new Promise((r) => setTimeout(r, 500));
  }

  console.log(`\nBarentsWatch: scanned ${totalBW} vessels across ${regions.length} regions`);
  console.log(`Fleet matches: ${positions.size} (${matchedMMSI} by MMSI, ${matchedName} by name)`);

  return positions;
}

// ─── Phase 3: AISStream WebSocket ───────────────────────────────────

async function fetchAISStream(
  durationSec: number,
  existingPositions: Map<string, PositionUpdate>,
  dryRun: boolean,
): Promise<Map<string, PositionUpdate>> {
  console.log("\n=== Phase 3: AISStream.io (Global) ===\n");
  const positions = new Map<string, PositionUpdate>();

  if (!API_KEY) {
    console.log("AISSTREAM_API_KEY not set. Skipping.");
    return positions;
  }

  // Get vessels with MMSI that don't already have a position from BarentsWatch
  const vessels = await pool.query(
    "SELECT imo, vessel_name, mmsi FROM shipping_vessels WHERE status = 'active' AND mmsi IS NOT NULL ORDER BY vessel_name"
  );

  const mmsiToVessel = new Map<string, { imo: string; name: string }>();
  const mmsiList: string[] = [];
  for (const v of vessels.rows) {
    // Skip vessels already found by BarentsWatch
    if (existingPositions.has(v.imo)) continue;
    mmsiToVessel.set(v.mmsi, { imo: v.imo, name: v.vessel_name });
    mmsiList.push(v.mmsi);
  }

  if (mmsiList.length === 0) {
    console.log("All vessels with MMSI already have positions from BarentsWatch.");
    return positions;
  }

  const BATCH_SIZE = 50;
  const batches: string[][] = [];
  for (let i = 0; i < mmsiList.length; i += BATCH_SIZE) {
    batches.push(mmsiList.slice(i, i + BATCH_SIZE));
  }

  const perBatchSec = Math.max(60, Math.floor(durationSec / batches.length));
  console.log(`Tracking ${mmsiList.length} remaining vessels in ${batches.length} batch(es), ${perBatchSec}s each`);

  for (let b = 0; b < batches.length; b++) {
    const batch = batches[b];
    console.log(`\n--- Batch ${b + 1}/${batches.length} (${batch.length} MMSIs) ---`);

    await new Promise<void>((resolve) => {
      let messageCount = 0;
      const ws = new WebSocket(AISSTREAM_URL);
      let timeoutHandle: NodeJS.Timeout;

      ws.on("open", () => {
        ws.send(JSON.stringify({
          APIKey: API_KEY,
          BoundingBoxes: [[[-90, -180], [90, 180]]],
          FiltersShipMMSI: batch,
          FilterMessageTypes: ["PositionReport", "StandardClassBPositionReport"],
        }));
        console.log(`Listening for ${perBatchSec}s...`);
        timeoutHandle = setTimeout(() => ws.close(), perBatchSec * 1000);
      });

      ws.on("message", (data: Buffer) => {
        messageCount++;
        try {
          const msg = JSON.parse(data.toString());
          const meta = msg.MetaData;
          if (!meta) return;
          const mmsi = String(meta.MMSI);
          const vessel = mmsiToVessel.get(mmsi);
          if (!vessel) return;

          const posReport = msg.Message?.PositionReport || msg.Message?.StandardClassBPositionReport;
          if (!posReport) return;

          const lat = meta.latitude ?? posReport.Latitude;
          const lon = meta.longitude ?? posReport.Longitude;
          if (lat == null || lon == null || (lat === 0 && lon === 0) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return;

          const sog = posReport.Sog ?? posReport.SpeedOverGround ?? 0;
          const cog = posReport.Cog ?? posReport.CourseOverGround ?? 0;
          const heading = posReport.TrueHeading != null && posReport.TrueHeading !== 511 ? posReport.TrueHeading : null;
          const navCode = posReport.NavigationalStatus ?? 15;

          positions.set(vessel.imo, {
            imo: vessel.imo, vesselName: vessel.name,
            lat, lon, speed: sog, course: cog, heading,
            navStatus: NAV_STATUS[navCode] || "undefined",
            opStatus: operationalStatus(navCode, sog),
            destination: null,
            timestamp: new Date(meta.time_utc || Date.now()),
            source: "aisstream",
          });

          process.stdout.write(`\r  ${positions.size} new vessels | ${messageCount} msgs`);
        } catch { /* skip */ }
      });

      ws.on("error", (err: Error) => console.error("\nWS error:", err.message));
      ws.on("close", () => {
        clearTimeout(timeoutHandle);
        console.log(`\n  Batch done: ${messageCount} msgs, ${positions.size} new vessels`);
        resolve();
      });
    });
  }

  return positions;
}

// ─── DB Update ──────────────────────────────────────────────────────

async function updateDB(positions: Map<string, PositionUpdate>, dryRun: boolean): Promise<number> {
  if (positions.size === 0) return 0;
  if (dryRun) return 0;

  let updated = 0;
  for (const [, pos] of positions) {
    try {
      await pool.query("DELETE FROM shipping_positions WHERE imo = $1", [pos.imo]);
      await pool.query(
        `INSERT INTO shipping_positions
          (imo, latitude, longitude, speed_knots, heading, course,
           nav_status, operational_status, destination, reported_at, source, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())`,
        [
          pos.imo, pos.lat, pos.lon, pos.speed,
          pos.heading != null ? Math.round(pos.heading) : null,
          Math.round(pos.course), pos.navStatus, pos.opStatus,
          pos.destination, pos.timestamp, pos.source,
        ],
      );
      updated++;
    } catch (err) {
      console.error(`  DB error for ${pos.vesselName}:`, err);
    }
  }
  return updated;
}

// ─── Main ───────────────────────────────────────────────────────────

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const skipResolve = process.argv.includes("--skip-resolve");
  const skipBW = process.argv.includes("--skip-barentswatch");
  const skipAIS = process.argv.includes("--skip-aisstream");
  const durationArg = process.argv.find((a) => a.startsWith("--duration="));
  const durationSec = durationArg ? parseInt(durationArg.split("=")[1]) : 600;

  console.log("╔══════════════════════════════════════════╗");
  console.log("║   AIS Daily Update (Multi-Source)        ║");
  console.log("╚══════════════════════════════════════════╝");
  console.log(`AISStream duration: ${durationSec}s | Dry run: ${dryRun}`);

  // Phase 1: Resolve MMSIs
  let newMMSIs = 0;
  if (!skipResolve) {
    newMMSIs = await resolveMMSIs(dryRun);
  }

  // Phase 2: BarentsWatch
  let bwPositions = new Map<string, PositionUpdate>();
  if (!skipBW) {
    bwPositions = await fetchBarentsWatch(dryRun);
  }

  // Phase 3: AISStream (only for vessels not found by BarentsWatch)
  let aisPositions = new Map<string, PositionUpdate>();
  if (!skipAIS) {
    aisPositions = await fetchAISStream(durationSec, bwPositions, dryRun);
  }

  // Merge all positions
  const allPositions = new Map<string, PositionUpdate>([...bwPositions, ...aisPositions]);

  // Print summary table
  console.log(`\n\n=== Position Summary (${allPositions.size} vessels) ===\n`);
  console.log(`${"Vessel".padEnd(25)} ${"Source".padEnd(14)} ${"Lat".padEnd(10)} ${"Lon".padEnd(10)} ${"Speed".padEnd(8)} Status`);
  console.log("-".repeat(80));
  const sorted = [...allPositions.values()].sort((a, b) => a.vesselName.localeCompare(b.vesselName));
  for (const pos of sorted) {
    console.log(
      `${pos.vesselName.padEnd(25)} ${pos.source.padEnd(14)} ${pos.lat.toFixed(4).padEnd(10)} ${pos.lon.toFixed(4).padEnd(10)} ${(pos.speed.toFixed(1) + "kn").padEnd(8)} ${pos.opStatus}`
    );
  }

  // Update DB
  if (!dryRun && allPositions.size > 0) {
    console.log("\nUpdating database...");
    const updated = await updateDB(allPositions, dryRun);
    console.log(`Database updated: ${updated}/${allPositions.size} vessels`);
  }

  // Stats
  const totalFleet = (await pool.query("SELECT COUNT(*) FROM shipping_vessels WHERE status = 'active'")).rows[0].count;
  console.log(`\n╔══════════════════════════════════════════╗`);
  console.log(`║  +${String(newMMSIs).padEnd(3)} MMSIs resolved                   ║`);
  console.log(`║  ${String(bwPositions.size).padEnd(3)} from BarentsWatch                ║`);
  console.log(`║  ${String(aisPositions.size).padEnd(3)} from AISStream                  ║`);
  console.log(`║  ${String(allPositions.size).padEnd(3)} / ${String(totalFleet).padEnd(3)} total fleet coverage      ║`);
  console.log(`╚══════════════════════════════════════════╝`);

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
