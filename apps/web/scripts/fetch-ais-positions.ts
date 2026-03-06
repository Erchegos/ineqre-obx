/**
 * Fetch real vessel positions from AISStream.io WebSocket API
 *
 * Connects to AISStream.io, subscribes to our fleet's MMSIs,
 * collects position reports for a configurable duration, then updates DB.
 *
 * Prerequisites:
 * 1. Register at aisstream.io (via GitHub) and get API key
 * 2. Set AISSTREAM_API_KEY in .env.local
 * 3. Run lookup-vessel-mmsi.ts first to populate MMSI column
 *
 * Run: npx tsx scripts/fetch-ais-positions.ts
 * Options:
 *   --duration=300   Listen for 300 seconds (default: 300 = 5 min)
 *   --dry-run        Don't write to DB, just print positions
 *
 * AISStream limits: max 50 MMSI per connection (we have 30 vessels)
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

// AIS Navigation Status codes
const NAV_STATUS: Record<number, string> = {
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

function operationalStatus(navCode: number, speedKnots: number): string {
  if (navCode === 5) return "in_port";
  if (navCode === 1) return "anchored";
  if (speedKnots > 1) return "at_sea";
  if (navCode === 0 || navCode === 8) return "at_sea";
  return "waiting";
}

interface PositionUpdate {
  mmsi: string;
  imo: string;
  vesselName: string;
  lat: number;
  lon: number;
  speed: number;
  course: number;
  heading: number | null;
  navStatus: string;
  opStatus: string;
  timestamp: Date;
}

async function main() {
  if (!API_KEY) {
    console.error("ERROR: AISSTREAM_API_KEY not set in .env.local");
    console.error("Register at https://aisstream.io and add your key.");
    process.exit(1);
  }

  const dryRun = process.argv.includes("--dry-run");
  const durationArg = process.argv.find((a) => a.startsWith("--duration="));
  const durationSec = durationArg ? parseInt(durationArg.split("=")[1]) : 300;

  // 1. Get all vessels with MMSI from DB
  const vessels = await pool.query(
    "SELECT imo, vessel_name, mmsi FROM shipping_vessels WHERE status = 'active' AND mmsi IS NOT NULL ORDER BY vessel_name"
  );

  if (vessels.rows.length === 0) {
    console.error(
      "No vessels with MMSI found. Run lookup-vessel-mmsi.ts first."
    );
    process.exit(1);
  }

  const mmsiToVessel = new Map<
    string,
    { imo: string; name: string; mmsi: string }
  >();
  const mmsiList: string[] = [];
  for (const v of vessels.rows) {
    mmsiToVessel.set(v.mmsi, {
      imo: v.imo,
      name: v.vessel_name,
      mmsi: v.mmsi,
    });
    mmsiList.push(v.mmsi);
  }

  console.log(`Tracking ${mmsiList.length} vessels (max 50 per connection)`);
  if (mmsiList.length > 50) {
    console.warn(
      `WARNING: ${mmsiList.length} MMSIs exceeds 50 limit. Truncating to first 50.`
    );
    mmsiList.length = 50;
  }

  // 2. Connect to AISStream WebSocket
  console.log(`\nConnecting to AISStream.io...`);
  console.log(`Duration: ${durationSec}s`);
  if (dryRun) console.log("(DRY RUN mode)\n");

  const positions = new Map<string, PositionUpdate>();
  let messageCount = 0;
  let positionCount = 0;

  return new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(AISSTREAM_URL);
    let timeoutHandle: NodeJS.Timeout;

    ws.on("open", () => {
      console.log("Connected. Sending subscription...");

      // Subscribe with our MMSI list
      const subscription = {
        APIKey: API_KEY,
        BoundingBoxes: [[[-90, -180], [90, 180]]], // Global (MMSI filter does the work)
        FiltersShipMMSI: mmsiList,
        FilterMessageTypes: ["PositionReport", "StandardClassBPositionReport"],
      };

      ws.send(JSON.stringify(subscription));
      console.log(
        `Subscribed. Listening for ${durationSec} seconds...\n`
      );

      // Auto-close after duration
      timeoutHandle = setTimeout(() => {
        console.log("\nDuration reached. Closing connection...");
        ws.close();
      }, durationSec * 1000);
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

        // Extract position from the message body
        const posReport =
          msg.Message?.PositionReport ||
          msg.Message?.StandardClassBPositionReport;
        if (!posReport) return;

        const lat = meta.latitude ?? posReport.Latitude;
        const lon = meta.longitude ?? posReport.Longitude;
        const sog = posReport.Sog ?? posReport.SpeedOverGround ?? 0;
        const cog = posReport.Cog ?? posReport.CourseOverGround ?? 0;
        const heading =
          posReport.TrueHeading != null && posReport.TrueHeading !== 511
            ? posReport.TrueHeading
            : null;
        const navCode = posReport.NavigationalStatus ?? 15;

        // Validate coordinates
        if (
          lat == null ||
          lon == null ||
          lat === 0 ||
          lon === 0 ||
          Math.abs(lat) > 90 ||
          Math.abs(lon) > 180
        ) {
          return;
        }

        const update: PositionUpdate = {
          mmsi,
          imo: vessel.imo,
          vesselName: vessel.name,
          lat,
          lon,
          speed: sog,
          course: cog,
          heading,
          navStatus: NAV_STATUS[navCode] || "undefined",
          opStatus: operationalStatus(navCode, sog),
          timestamp: new Date(meta.time_utc || Date.now()),
        };

        positions.set(mmsi, update);
        positionCount++;

        // Log each new vessel position
        const existing = positions.size;
        process.stdout.write(
          `\r  Positions: ${existing}/${mmsiList.length} vessels | Messages: ${messageCount} | Updates: ${positionCount}`
        );
      } catch {
        // Skip malformed messages
      }
    });

    ws.on("error", (err: Error) => {
      console.error("\nWebSocket error:", err.message);
    });

    ws.on("close", async () => {
      clearTimeout(timeoutHandle);
      console.log(`\n\n--- Results ---`);
      console.log(`Messages received: ${messageCount}`);
      console.log(
        `Vessels with positions: ${positions.size}/${mmsiList.length}`
      );
      console.log(`Total position updates: ${positionCount}`);

      if (positions.size === 0) {
        console.log(
          "\nNo positions received. Vessels may not be transmitting or MMSI mismatch."
        );
        await pool.end();
        resolve();
        return;
      }

      // Print all received positions
      console.log(
        `\n${"Vessel".padEnd(25)} ${"Lat".padEnd(10)} ${"Lon".padEnd(10)} ${"Speed".padEnd(8)} Status`
      );
      console.log("-".repeat(70));
      for (const [, pos] of positions) {
        console.log(
          `${pos.vesselName.padEnd(25)} ${pos.lat.toFixed(4).padEnd(10)} ${pos.lon.toFixed(4).padEnd(10)} ${(pos.speed.toFixed(1) + "kn").padEnd(8)} ${pos.opStatus}`
        );
      }

      // Update DB
      if (!dryRun) {
        console.log("\nUpdating database...");
        let dbUpdated = 0;
        for (const [, pos] of positions) {
          try {
            // Delete old position(s) for this vessel
            await pool.query("DELETE FROM shipping_positions WHERE imo = $1", [
              pos.imo,
            ]);

            // Insert new real AIS position
            await pool.query(
              `INSERT INTO shipping_positions
                (imo, latitude, longitude, speed_knots, heading, course,
                 nav_status, operational_status, reported_at, source, created_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'aisstream', NOW())`,
              [
                pos.imo,
                pos.lat,
                pos.lon,
                pos.speed,
                pos.heading,
                pos.course,
                pos.navStatus,
                pos.opStatus,
                pos.timestamp,
              ]
            );
            dbUpdated++;
          } catch (err) {
            console.error(`  Failed to update ${pos.vesselName}:`, err);
          }
        }
        console.log(
          `Database updated: ${dbUpdated}/${positions.size} vessels`
        );
      }

      // Report missing vessels
      const missing = mmsiList.filter((m) => !positions.has(m));
      if (missing.length > 0) {
        console.log(`\nVessels without position (${missing.length}):`);
        for (const m of missing) {
          const v = mmsiToVessel.get(m);
          console.log(`  - ${v?.name || m} (MMSI: ${m})`);
        }
        console.log(
          "These vessels may not have transmitted during the listen window."
        );
        console.log("Try increasing --duration or running again later.");
      }

      await pool.end();
      resolve();
    });
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
