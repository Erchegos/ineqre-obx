/**
 * Multi-source vessel position fetcher — free, no paid API keys
 *
 * Strategy (in order):
 * 1. BarentsWatch Open AIS — bulk fetch all ~4000 vessels in Norwegian waters,
 *    match against our fleet by MMSI and IMO. Free, OAuth2, great coverage for OSE fleet.
 * 2. VesselFinder detail pages — scrape MMSI from vessel detail page by IMO,
 *    then use MMSI to resolve positions. Free, no auth.
 * 3. Digitraffic — Finnish coastal AIS for vessels in NE Atlantic/Baltic range.
 *
 * Run: npx tsx scripts/fetch-vesselfinder-positions.ts
 * Options:
 *   --dry-run        Don't write to DB, just print positions
 *   --company=FRO    Only update specific company
 *   --skip-bw        Skip BarentsWatch (if credentials unavailable)
 *   --skip-vf        Skip VesselFinder scraping
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

const DRY_RUN = process.argv.includes("--dry-run");
const SKIP_BW = process.argv.includes("--skip-bw");
const SKIP_VF = process.argv.includes("--skip-vf");
const COMPANY_FILTER = process.argv
  .find((a) => a.startsWith("--company="))
  ?.split("=")[1];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

interface VesselRow {
  imo: string;  // varchar in DB
  mmsi: string | null;  // varchar in DB
  vessel_name: string;
  company_ticker: string;
  vessel_type: string;
}

interface Position {
  imo: string;
  mmsi: number | null;
  latitude: number;
  longitude: number;
  speed: number;
  heading: number;
  course: number;
  destination: string | null;
  navStatus: string;
  operationalStatus: string;
  reportedAt: string;
  source: string;
}

// ─── Source 1: BarentsWatch Open AIS ─────────────────────────────────────

async function fetchBarentsWatchPositions(
  vessels: VesselRow[]
): Promise<Map<string, Position>> {
  const positions = new Map<string, Position>();
  const bwClientId = process.env.BARENTSWATCH_CLIENT_ID;
  const bwSecret = process.env.BARENTSWATCH_CLIENT_SECRET;

  if (!bwClientId || !bwSecret) {
    console.log("  [BW] No BarentsWatch credentials, skipping");
    return positions;
  }

  try {
    // Get OAuth2 token
    const tokenRes = await fetch(
      "https://id.barentswatch.no/connect/token",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: bwClientId,
          client_secret: bwSecret,
          scope: "api",
          grant_type: "client_credentials",
        }),
      }
    );
    if (!tokenRes.ok) {
      console.log(`  [BW] Auth failed: ${tokenRes.status}`);
      return positions;
    }
    const { access_token } = await tokenRes.json();

    // Fetch all open positions (Norwegian waters, ~4000 vessels)
    console.log("  [BW] Fetching open AIS positions...");
    const aisRes = await fetch(
      "https://www.barentswatch.no/bwapi/v2/geodata/ais/openpositions",
      { headers: { Authorization: `Bearer ${access_token}` } }
    );
    if (!aisRes.ok) {
      console.log(`  [BW] AIS fetch failed: ${aisRes.status}`);
      return positions;
    }

    const aisData: any[] = await aisRes.json();
    console.log(`  [BW] Got ${aisData.length} vessels in Norwegian waters`);

    // Build lookup sets for matching (convert to strings since DB uses varchar)
    const mmsiSet = new Set(vessels.filter((v) => v.mmsi).map((v) => v.mmsi!));
    const imoSet = new Set(vessels.map((v) => v.imo));
    const imoToVessel = new Map(vessels.map((v) => [v.imo, v]));

    let matched = 0;
    for (const ais of aisData) {
      const mmsiStr = ais.mmsi ? String(ais.mmsi) : null;
      const imoStr = ais.imo ? String(ais.imo) : null;
      const coords = ais.geometry?.coordinates;
      if (!coords || coords.length < 2) continue;

      // Match by IMO or MMSI (comparing as strings)
      let matchedImo: string | null = null;
      if (imoStr && imoSet.has(imoStr)) {
        matchedImo = imoStr;
      } else if (mmsiStr && mmsiSet.has(mmsiStr)) {
        const v = vessels.find((v) => v.mmsi === mmsiStr);
        if (v) matchedImo = v.imo;
      }

      if (!matchedImo) continue;
      matched++;

      const lat = coords[1];
      const lon = coords[0];
      if (lat < -90 || lat > 90 || lon < -180 || lon > 180) continue;

      positions.set(matchedImo, {
        imo: matchedImo,
        mmsi: ais.mmsi || null,
        latitude: lat,
        longitude: lon,
        speed: ais.sog || 0,
        heading: ais.heading || ais.cog || 0,
        course: ais.cog || 0,
        destination: ais.destination || null,
        navStatus: deriveNavStatus(ais.sog || 0, ais.navstat ?? -1),
        operationalStatus: deriveOpsStatus(
          ais.sog || 0,
          ais.navstat ?? -1
        ),
        reportedAt: ais.timeStamp || new Date().toISOString(),
        source: "barentswatch",
      });

      // Also resolve MMSI if we didn't have it
      const v = imoToVessel.get(matchedImo);
      if (v && !v.mmsi && mmsiStr) {
        v.mmsi = mmsiStr; // Update in memory for later sources
      }
    }

    console.log(`  [BW] Matched ${matched} of our fleet vessels`);
    return positions;
  } catch (err: any) {
    console.error(`  [BW] Error: ${err.message}`);
    return positions;
  }
}

// ─── Source 2: VesselFinder detail page scraping ─────────────────────────
// VesselFinder embeds position data in a data-json attribute on the detail page:
// data-json='{ "ship_lat":61,"ship_lon":4,"ship_cog":21.7,"ship_sog":0.7,...}'
// Also contains MMSI in a script tag: var MMSI=538007133

interface VfDetailResult {
  mmsi: string | null;
  position: Position | null;
}

async function scrapeVesselFinderDetail(
  imo: string,
  mmsi: string | null,
  vesselName: string,
  companyTicker: string
): Promise<VfDetailResult> {
  try {
    // Prefer MMSI-based URL (301 redirect, more reliable) over IMO-based
    const id = mmsi || imo;
    const url = `https://www.vesselfinder.com/vessels/details/${id}`;

    // Retry logic for transient failures
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await fetch(url, { headers: HEADERS, redirect: "follow" });
      if (res.status === 429 || res.status === 503) {
        // Rate limited — wait and retry once
        if (attempt === 0) {
          await sleep(15000);
          continue;
        }
        return { mmsi: null, position: null };
      }
      if (!res.ok) {
        // If MMSI failed with 404, try IMO as fallback
        if (mmsi && res.status === 404) {
          const imoRes = await fetch(
            `https://www.vesselfinder.com/vessels/details/${imo}`,
            { headers: HEADERS, redirect: "follow" }
          );
          if (!imoRes.ok) return { mmsi: null, position: null };
          const html = await imoRes.text();
          return parseVfHtml(html, imo);
        }
        return { mmsi: null, position: null };
      }

      const html = await res.text();
      // Check if we got a valid page (not a captcha/block page)
      if (html.includes("data-json") || html.includes("MMSI")) {
        return parseVfHtml(html, imo);
      }
      // Got blocked — wait and retry
      if (attempt === 0) {
        await sleep(15000);
        continue;
      }
      return { mmsi: null, position: null };
    }
    return { mmsi: null, position: null };
  } catch {
    return { mmsi: null, position: null };
  }
}

function parseVfHtml(html: string, imo: string): VfDetailResult {
  // Extract MMSI
  const mmsiMatch = html.match(/MMSI[\s=]+(\d{9})/);
  const foundMmsi = mmsiMatch ? mmsiMatch[1] : null;

  // Extract position from data-json attribute
  const djsonMatch = html.match(/data-json='([^']+)'/);
  if (!djsonMatch) return { mmsi: foundMmsi, position: null };

  const djson = JSON.parse(djsonMatch[1]);
  const lat = djson.ship_lat;
  const lon = djson.ship_lon;

  if (lat == null || lon == null || (lat === 0 && lon === 0)) {
    return { mmsi: foundMmsi, position: null };
  }
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return { mmsi: foundMmsi, position: null };
  }

  const sog = djson.ship_sog || 0;
  const cog = djson.ship_cog || 0;

  return {
    mmsi: foundMmsi,
    position: {
      imo,
      mmsi: foundMmsi ? parseInt(foundMmsi) : null,
      latitude: lat,
      longitude: lon,
      speed: sog,
      heading: cog,
      course: cog,
      destination: null,
      navStatus: deriveNavStatus(sog, -1),
      operationalStatus: deriveOpsStatus(sog, -1),
      reportedAt: new Date().toISOString(),
      source: "vesselfinder",
    },
  };
}

async function fetchVesselFinderPositions(
  vessels: VesselRow[],
  alreadyFound: Set<string>
): Promise<Map<string, Position>> {
  const positions = new Map<string, Position>();
  const remaining = vessels.filter((v) => !alreadyFound.has(v.imo));

  if (remaining.length === 0) {
    console.log("  [VF] All vessels already have positions, skipping");
    return positions;
  }

  console.log(
    `  [VF] Scraping positions for ${remaining.length} remaining vessels...`
  );

  let positionsFound = 0;
  let mmsiResolved = 0;
  let errors = 0;

  for (let i = 0; i < remaining.length; i++) {
    const v = remaining[i];

    const result = await scrapeVesselFinderDetail(
      v.imo,
      v.mmsi,
      v.vessel_name,
      v.company_ticker
    );

    // Track MMSI discoveries
    if (result.mmsi && !v.mmsi) {
      mmsiResolved++;
      v.mmsi = result.mmsi;
    }

    if (result.position) {
      positions.set(v.imo, result.position);
      positionsFound++;
      const icon = result.position.speed > 1 ? ">" : ".";
      console.log(
        `  [VF] ${icon} ${v.company_ticker.padEnd(10)} ${v.vessel_name.padEnd(22)} ${result.position.latitude.toFixed(2)}, ${result.position.longitude.toFixed(2)}  ${result.position.speed.toFixed(1)}kn`
      );
    } else {
      errors++;
    }

    // Progress indicator every 20 vessels
    if ((i + 1) % 20 === 0) {
      console.log(
        `  [VF] Progress: ${i + 1}/${remaining.length} (${positionsFound} positions, ${errors} misses)`
      );
    }

    // Rate limit: ~2s between requests + longer pause every 30 to avoid blocks
    if (i < remaining.length - 1) {
      if ((i + 1) % 30 === 0) {
        console.log(`  [VF] Pausing 10s to avoid rate limit...`);
        await sleep(10000);
      } else {
        await sleep(2000);
      }
    }
  }

  console.log(
    `  [VF] Done: ${positionsFound} positions, ${mmsiResolved} new MMSIs, ${errors} misses`
  );
  return positions;
}

// ─── Source 3: Digitraffic (Finnish AIS) ─────────────────────────────────

async function fetchDigitrafficPositions(
  vessels: VesselRow[],
  alreadyFound: Set<string>
): Promise<Map<string, Position>> {
  const positions = new Map<string, Position>();
  const remaining = vessels.filter(
    (v) => !alreadyFound.has(v.imo) && v.mmsi
  );

  if (remaining.length === 0) return positions;

  console.log(
    `  [DT] Checking ${remaining.length} vessels on Digitraffic...`
  );

  let found = 0;
  for (let i = 0; i < remaining.length; i++) {
    const v = remaining[i];
    try {
      const res = await fetch(
        `https://meri.digitraffic.fi/api/ais/v1/locations?mmsi=${v.mmsi}`
      );
      if (!res.ok) continue;

      const data = await res.json();
      const feature = data.features?.[0];
      if (!feature?.geometry?.coordinates) continue;

      const [lon, lat] = feature.geometry.coordinates;
      const props = feature.properties || {};
      const ts = props.timestampExternal;

      // Skip stale positions (> 7 days)
      if (ts && Date.now() - new Date(ts).getTime() > 7 * 86400000) continue;

      if (lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
        found++;
        positions.set(v.imo, {
          imo: v.imo,
          mmsi: v.mmsi ? parseInt(v.mmsi) : null,
          latitude: lat,
          longitude: lon,
          speed: (props.sog || 0) / 10,
          heading: props.heading || props.cog || 0,
          course: (props.cog || 0) / 10,
          destination: null,
          navStatus: deriveNavStatus(
            (props.sog || 0) / 10,
            props.navStat ?? -1
          ),
          operationalStatus: deriveOpsStatus(
            (props.sog || 0) / 10,
            props.navStat ?? -1
          ),
          reportedAt: ts || new Date().toISOString(),
          source: "digitraffic_ais",
        });

        console.log(
          `  [DT] > ${v.company_ticker.padEnd(10)} ${v.vessel_name.padEnd(22)} ${lat.toFixed(2)}, ${lon.toFixed(2)}`
        );
      }
    } catch {
      /* skip */
    }

    if (i < remaining.length - 1 && i % 20 === 19) {
      await sleep(200);
    }
  }

  console.log(`  [DT] Found ${found} positions`);
  return positions;
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function deriveNavStatus(speed: number, navCode: number): string {
  if (navCode === 1) return "at_anchor";
  if (navCode === 5) return "moored";
  if (navCode === 0 || navCode === 8) return "under_way";
  if (speed > 1) return "under_way";
  if (speed > 0) return "at_anchor";
  return "moored";
}

function deriveOpsStatus(speed: number, navCode: number): string {
  if (speed > 2 || navCode === 0 || navCode === 8) return "at_sea";
  if (navCode === 1) return "anchored";
  if (navCode === 5) return "in_port";
  return speed > 0.5 ? "at_sea" : "in_port";
}

// ─── Main ────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== Multi-Source Vessel Position Fetcher ===");
  console.log(`Mode: ${DRY_RUN ? "DRY RUN" : "LIVE"}`);
  if (COMPANY_FILTER) console.log(`Company: ${COMPANY_FILTER}`);
  console.log("");

  // Load all active vessels
  let query = `
    SELECT v.imo, v.mmsi, v.vessel_name, v.company_ticker, v.vessel_type
    FROM shipping_vessels v
    WHERE v.status = 'active'
  `;
  const params: any[] = [];
  if (COMPANY_FILTER) {
    query += ` AND v.company_ticker = $1`;
    params.push(COMPANY_FILTER);
  }
  query += ` ORDER BY v.company_ticker, v.vessel_name`;

  const { rows: vessels } = await pool.query(query, params);
  console.log(`Fleet: ${vessels.length} active vessels\n`);

  const allPositions = new Map<string, Position>();
  const mmsiUpdates: { imo: string; mmsi: string }[] = [];

  // ── Source 1: BarentsWatch ──
  if (!SKIP_BW) {
    console.log("━━━ Source 1: BarentsWatch Open AIS (Norwegian waters) ━━━");
    const bwPositions = await fetchBarentsWatchPositions(vessels);
    for (const [imo, pos] of bwPositions) {
      allPositions.set(imo, pos);
      // Track MMSI discoveries
      const v = vessels.find((v) => v.imo === imo);
      if (v && !v.mmsi && pos.mmsi) {
        const mmsiStr = String(pos.mmsi);
        mmsiUpdates.push({ imo, mmsi: mmsiStr });
        v.mmsi = mmsiStr;
      }
    }
    console.log("");
  }

  // ── Source 2: VesselFinder (global position scraping) ──
  if (!SKIP_VF) {
    console.log("━━━ Source 2: VesselFinder (global vessel positions) ━━━");
    const vfPositions = await fetchVesselFinderPositions(
      vessels,
      new Set(allPositions.keys())
    );
    for (const [imo, pos] of vfPositions) {
      allPositions.set(imo, pos);
      // Track MMSI discoveries
      const v = vessels.find((v) => v.imo === imo);
      if (v && !v.mmsi && pos.mmsi) {
        const mmsiStr = String(pos.mmsi);
        mmsiUpdates.push({ imo, mmsi: mmsiStr });
        v.mmsi = mmsiStr;
      }
    }
    console.log("");
  }

  // ── Source 3: Digitraffic (Finnish range) ──
  console.log("━━━ Source 3: Digitraffic AIS (Baltic/Atlantic) ━━━");
  const dtPositions = await fetchDigitrafficPositions(
    vessels,
    new Set(allPositions.keys())
  );
  for (const [imo, pos] of dtPositions) {
    allPositions.set(imo, pos);
  }
  console.log("");

  // ── Write to DB ──
  console.log("━━━ Writing to Database ━━━");

  if (!DRY_RUN) {
    // Update MMSIs
    for (const { imo, mmsi } of mmsiUpdates) {
      await pool.query(
        `UPDATE shipping_vessels SET mmsi = $1 WHERE imo = $2 AND mmsi IS NULL`,
        [mmsi, imo]
      );
    }
    if (mmsiUpdates.length > 0) {
      console.log(`  Updated ${mmsiUpdates.length} vessel MMSIs`);
    }

    // Upsert positions
    let written = 0;
    for (const [, pos] of allPositions) {
      await pool.query(`DELETE FROM shipping_positions WHERE imo = $1`, [
        pos.imo,
      ]);
      await pool.query(
        `INSERT INTO shipping_positions
         (imo, latitude, longitude, speed_knots, heading, course, destination,
          nav_status, operational_status, reported_at, source)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          pos.imo,
          pos.latitude,
          pos.longitude,
          pos.speed,
          Math.round(Number(pos.heading) || 0),
          Math.round(Number(pos.course) || 0),
          pos.destination,
          pos.navStatus,
          pos.operationalStatus,
          pos.reportedAt,
          pos.source,
        ]
      );
      written++;
    }
    console.log(`  Wrote ${written} positions to DB`);
  } else {
    console.log(`  (DRY RUN — would write ${allPositions.size} positions)`);
  }

  // ── Summary ──
  const bySource = new Map<string, number>();
  for (const [, pos] of allPositions) {
    bySource.set(pos.source, (bySource.get(pos.source) || 0) + 1);
  }

  const byCompany = new Map<string, number>();
  for (const [imo] of allPositions) {
    const v = vessels.find((v) => v.imo === imo);
    if (v) {
      byCompany.set(
        v.company_ticker,
        (byCompany.get(v.company_ticker) || 0) + 1
      );
    }
  }

  console.log("\n=== Summary ===");
  console.log(`Fleet: ${vessels.length} vessels`);
  console.log(
    `Positions: ${allPositions.size} (${((allPositions.size / vessels.length) * 100).toFixed(0)}%)`
  );
  console.log(`MMSIs resolved: ${mmsiUpdates.length}`);
  console.log(`Vessels with MMSI: ${vessels.filter((v) => v.mmsi).length}`);
  console.log("\nBy source:");
  for (const [source, count] of bySource) {
    console.log(`  ${source}: ${count}`);
  }
  console.log("\nBy company:");
  for (const [company, count] of [...byCompany.entries()].sort(
    (a, b) => b[1] - a[1]
  )) {
    const total = vessels.filter(
      (v) => v.company_ticker === company
    ).length;
    console.log(`  ${company.padEnd(10)} ${count}/${total}`);
  }

  await pool.end();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
