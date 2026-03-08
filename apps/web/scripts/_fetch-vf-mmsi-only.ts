/**
 * Vessel position fetcher using MyShipTracking.com
 * Scrapes detail pages by MMSI — URL format: /vessels/mmsi-XXXXXXXXX
 * Also uses BarentsWatch for Norwegian waters bulk fetch.
 *
 * Run: npx tsx scripts/_fetch-vf-mmsi-only.ts [--dry-run]
 */
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });
import pg from "pg";
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const DRY_RUN = process.argv.includes("--dry-run");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

interface VesselRow {
  imo: string;
  mmsi: string | null;
  vessel_name: string;
  company_ticker: string;
}

interface PosResult {
  imo: string;
  mmsi: string;
  lat: number;
  lon: number;
  speed: number;
  heading: number;
  source: string;
}

// ─── MyShipTracking scraper ─────────────────────────────────────────────

async function scrapeMST(mmsi: string): Promise<{ lat: number; lon: number; speed: number; heading: number } | null> {
  try {
    const res = await fetch(`https://www.myshiptracking.com/vessels/mmsi-${mmsi}`, {
      headers: HEADERS,
      redirect: "follow",
    });
    if (!res.ok) return null;
    const html = await res.text();

    // Extract coords from: canvas_map_generate("map_locator", 4, LAT, LNG, HEADING, ...)
    const mapMatch = html.match(/canvas_map_generate\("map_locator",\s*\d+,\s*([-0-9.]+),\s*([-0-9.]+),\s*(\d+)/);
    if (!mapMatch) return null;

    const lat = parseFloat(mapMatch[1]);
    const lon = parseFloat(mapMatch[2]);
    const heading = parseInt(mapMatch[3]);
    if (isNaN(lat) || isNaN(lon) || lat === 0 && lon === 0) return null;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;

    // Extract speed from: speed is <strong>X Knots</strong>
    const speedMatch = html.match(/speed is <strong>([0-9.]+)\s*Knots/i);
    const speed = speedMatch ? parseFloat(speedMatch[1]) : 0;

    return { lat, lon, speed, heading };
  } catch {
    return null;
  }
}

// ─── BarentsWatch bulk fetch ────────────────────────────────────────────

async function fetchBarentsWatch(vessels: VesselRow[]): Promise<PosResult[]> {
  const results: PosResult[] = [];
  const bwClientId = process.env.BARENTSWATCH_CLIENT_ID;
  const bwSecret = process.env.BARENTSWATCH_CLIENT_SECRET;
  if (!bwClientId || !bwSecret) {
    console.log("  [BW] No credentials, skipping");
    return results;
  }

  try {
    const tokenRes = await fetch("https://id.barentswatch.no/connect/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: bwClientId, client_secret: bwSecret, scope: "api", grant_type: "client_credentials" }),
    });
    if (!tokenRes.ok) { console.log("  [BW] Auth failed"); return results; }
    const { access_token } = await tokenRes.json();

    console.log("  [BW] Fetching open positions...");
    const aisRes = await fetch("https://www.barentswatch.no/bwapi/v2/geodata/ais/openpositions", {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    if (!aisRes.ok) { console.log("  [BW] Fetch failed"); return results; }
    const aisData: any[] = await aisRes.json();
    console.log(`  [BW] Got ${aisData.length} vessels in Norwegian waters`);

    const imoSet = new Set(vessels.map(v => v.imo));
    const mmsiToVessel = new Map<string, VesselRow>();
    for (const v of vessels) {
      if (v.mmsi) mmsiToVessel.set(v.mmsi, v);
    }

    for (const ais of aisData) {
      const imoStr = ais.imo ? String(ais.imo) : null;
      const mmsiStr = ais.mmsi ? String(ais.mmsi) : null;
      const coords = ais.geometry?.coordinates;
      if (!coords || coords.length < 2) continue;

      let matchedVessel: VesselRow | undefined;
      if (imoStr && imoSet.has(imoStr)) {
        matchedVessel = vessels.find(v => v.imo === imoStr);
      } else if (mmsiStr && mmsiToVessel.has(mmsiStr)) {
        matchedVessel = mmsiToVessel.get(mmsiStr);
      }
      if (!matchedVessel) continue;

      const lat = coords[1], lon = coords[0];
      if (Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;

      results.push({
        imo: matchedVessel.imo,
        mmsi: mmsiStr || matchedVessel.mmsi || "",
        lat, lon,
        speed: ais.sog || 0,
        heading: ais.heading || ais.cog || 0,
        source: "barentswatch",
      });

      // Backfill MMSI if discovered
      if (!matchedVessel.mmsi && mmsiStr) {
        matchedVessel.mmsi = mmsiStr;
      }
    }

    console.log(`  [BW] Matched ${results.length} fleet vessels`);
  } catch (err: any) {
    console.error(`  [BW] Error: ${err.message}`);
  }
  return results;
}

// ─── Main ───────────────────────────────────────────────────────────────

function opStatus(speed: number): string {
  return speed > 1 ? "at_sea" : "in_port";
}

async function main() {
  console.log(`=== Vessel Position Fetcher (BW + MyShipTracking) ===`);
  console.log(`Mode: ${DRY_RUN ? "DRY RUN" : "LIVE"}\n`);

  const { rows: vessels } = await pool.query<VesselRow>(`
    SELECT imo, mmsi, vessel_name, company_ticker
    FROM shipping_vessels WHERE status = 'active'
    ORDER BY company_ticker, vessel_name
  `);
  console.log(`Fleet: ${vessels.length} active vessels`);
  console.log(`With MMSI: ${vessels.filter(v => v.mmsi).length}\n`);

  const allPositions = new Map<string, PosResult>();
  const newMmsis: { imo: string; mmsi: string }[] = [];

  // ── Source 1: BarentsWatch ──
  console.log("━━━ BarentsWatch (Norwegian waters) ━━━");
  const bwResults = await fetchBarentsWatch(vessels);
  for (const p of bwResults) {
    allPositions.set(p.imo, p);
    const v = vessels.find(v => v.imo === p.imo);
    if (v && !v.mmsi && p.mmsi) {
      newMmsis.push({ imo: p.imo, mmsi: p.mmsi });
      v.mmsi = p.mmsi;
    }
  }
  console.log("");

  // ── Source 2: MyShipTracking (global, MMSI-based) ──
  console.log("━━━ MyShipTracking (global, MMSI-based) ━━━");
  const withMmsi = vessels.filter(v => v.mmsi && !allPositions.has(v.imo));
  console.log(`  Fetching ${withMmsi.length} vessels with MMSI...\n`);

  let found = 0, missed = 0, consecutiveMisses = 0;

  for (let i = 0; i < withMmsi.length; i++) {
    const v = withMmsi[i];
    const pos = await scrapeMST(v.mmsi!);

    if (pos) {
      found++;
      consecutiveMisses = 0;
      allPositions.set(v.imo, {
        imo: v.imo, mmsi: v.mmsi!, lat: pos.lat, lon: pos.lon,
        speed: pos.speed, heading: pos.heading, source: "myshiptracking",
      });
      const icon = pos.speed > 1 ? ">" : ".";
      console.log(`${icon} ${v.company_ticker.padEnd(10)} ${v.vessel_name.padEnd(24)} ${pos.lat.toFixed(1).padStart(7)}, ${pos.lon.toFixed(1).padStart(7)}  ${pos.speed.toFixed(1)}kn`);
    } else {
      missed++;
      consecutiveMisses++;
      if (consecutiveMisses >= 10 && found === 0) {
        console.log("\n  Too many consecutive misses, MST may be blocking. Aborting.");
        break;
      }
    }

    if ((i + 1) % 20 === 0) {
      console.log(`  --- Progress: ${i + 1}/${withMmsi.length} (${found} found, ${missed} missed) ---`);
    }

    // Rate limit: 2.5s + 12s pause every 25
    if (i < withMmsi.length - 1) {
      if ((i + 1) % 25 === 0) {
        await sleep(12000);
      } else {
        await sleep(2500);
      }
    }
  }
  console.log(`\n  MST: ${found} positions found, ${missed} missed\n`);

  // ── Write to DB ──
  if (!DRY_RUN && allPositions.size > 0) {
    console.log("━━━ Writing to Database ━━━");

    // Update new MMSIs
    for (const { imo, mmsi } of newMmsis) {
      await pool.query("UPDATE shipping_vessels SET mmsi = $1 WHERE imo = $2 AND mmsi IS NULL", [mmsi, imo]);
    }
    if (newMmsis.length > 0) console.log(`  Updated ${newMmsis.length} vessel MMSIs`);

    // Upsert positions
    let written = 0;
    for (const [, p] of allPositions) {
      try {
        await pool.query("DELETE FROM shipping_positions WHERE imo = $1", [p.imo]);
        await pool.query(
          `INSERT INTO shipping_positions (imo, latitude, longitude, speed_knots, heading, course, nav_status, operational_status, reported_at, source)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), $9)`,
          [p.imo, p.lat, p.lon, p.speed, Math.round(p.heading), Math.round(p.heading),
           p.speed > 1 ? "under_way" : "moored", opStatus(p.speed), p.source]
        );
        written++;
      } catch (err: any) {
        console.error(`  Failed ${p.imo}: ${err.message}`);
      }
    }
    console.log(`  Wrote ${written} positions to DB`);
  } else if (DRY_RUN) {
    console.log(`(DRY RUN — would write ${allPositions.size} positions)`);
  }

  // ── Summary ──
  const bySource = new Map<string, number>();
  const byCompany = new Map<string, number>();
  for (const [imo, p] of allPositions) {
    bySource.set(p.source, (bySource.get(p.source) || 0) + 1);
    const v = vessels.find(v => v.imo === imo);
    if (v) byCompany.set(v.company_ticker, (byCompany.get(v.company_ticker) || 0) + 1);
  }

  console.log(`\n=== Summary ===`);
  console.log(`Fleet: ${vessels.length} vessels`);
  console.log(`Positions: ${allPositions.size} (${((allPositions.size / vessels.length) * 100).toFixed(0)}%)`);
  console.log(`\nBy source:`);
  for (const [s, n] of bySource) console.log(`  ${s}: ${n}`);
  console.log(`\nBy company:`);
  for (const [c, n] of [...byCompany.entries()].sort((a, b) => b[1] - a[1])) {
    const total = vessels.filter(v => v.company_ticker === c).length;
    console.log(`  ${c.padEnd(10)} ${n}/${total}`);
  }

  await pool.end();
}

main().catch((err) => { console.error("Fatal:", err); process.exit(1); });
