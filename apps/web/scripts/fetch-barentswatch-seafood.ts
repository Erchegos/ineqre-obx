/**
 * BarentsWatch Seafood Data Fetcher
 *
 * Fetches lice reports, disease outbreaks, and locality data from BarentsWatch API.
 * Stores in seafood_* tables.
 *
 * Auth: OAuth2 client_credentials flow
 * Env: BARENTSWATCH_CLIENT_ID, BARENTSWATCH_CLIENT_SECRET
 *
 * Run: npx tsx scripts/fetch-barentswatch-seafood.ts
 * Options:
 *   --weeks=4      Weeks of lice data to fetch (default 4)
 *   --dry-run      Print but don't insert
 *   --locality=ID  Fetch single locality (for testing)
 *   --skip-lice    Skip lice data
 *   --skip-diseases Skip disease data
 */

import { Pool } from "pg";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

const dbUrl = (process.env.DATABASE_URL || "").trim().replace(/^["']|["']$/g, "");
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
const pool = new Pool({ connectionString: dbUrl });

const CLIENT_ID = process.env.BARENTSWATCH_CLIENT_ID || "";
const CLIENT_SECRET = process.env.BARENTSWATCH_CLIENT_SECRET || "";

const WEEKS_BACK = parseInt(
  process.argv.find((a) => a.startsWith("--weeks="))?.split("=")[1] ?? "4"
);
const DRY_RUN = process.argv.includes("--dry-run");
const SKIP_LICE = process.argv.includes("--skip-lice");
const SKIP_DISEASES = process.argv.includes("--skip-diseases");
const SINGLE_LOCALITY = process.argv
  .find((a) => a.startsWith("--locality="))
  ?.split("=")[1];

// Company name → ticker mapping
const COMPANY_TICKER_MAP: Record<string, string> = {
  "mowi": "MOWI",
  "marine harvest": "MOWI",
  "salmar": "SALM",
  "lerøy": "LSG",
  "leroy": "LSG",
  "lerøy seafood": "LSG",
  "grieg seafood": "GSF",
  "grieg": "GSF",
  "bakkafrost": "BAKKA",
  "austevoll": "AUSS",
  "austevoll seafood": "AUSS",
  "nova sea": "SALM", // SalMar subsidiary
  "arctic fish": "SALM",
};

function mapCompanyToTicker(companyName: string): string | null {
  const lower = companyName.toLowerCase().trim();
  for (const [key, ticker] of Object.entries(COMPANY_TICKER_MAP)) {
    if (lower.includes(key)) return ticker;
  }
  return null;
}

// ─── OAuth2 Token ─────────────────────────────────────────────────

let accessToken: string | null = null;
let tokenExpiry = 0;

async function getToken(): Promise<string> {
  if (accessToken && Date.now() < tokenExpiry) return accessToken;

  if (!CLIENT_ID || !CLIENT_SECRET) {
    throw new Error(
      "BARENTSWATCH_CLIENT_ID and BARENTSWATCH_CLIENT_SECRET must be set in .env"
    );
  }

  console.log("  Fetching BarentsWatch OAuth2 token...");
  const resp = await fetch("https://id.barentswatch.no/connect/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      scope: "api",
    }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`OAuth2 token request failed: ${resp.status} ${body}`);
  }

  const data = await resp.json();
  accessToken = data.access_token;
  tokenExpiry = Date.now() + (data.expires_in - 60) * 1000; // refresh 1 min early
  console.log(`  Token acquired (expires in ${data.expires_in}s)\n`);
  return accessToken!;
}

async function bwFetch(url: string): Promise<any> {
  const token = await getToken();
  const resp = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    console.error(`  BW API error: ${resp.status} ${url}`);
    if (body) console.error(`  ${body.slice(0, 300)}`);
    return null;
  }

  return resp.json();
}

// ─── Localities ───────────────────────────────────────────────────

async function fetchLocalities(): Promise<number> {
  console.log("Fetching localities from BarentsWatch...");

  const data = await bwFetch(
    "https://www.barentswatch.no/bwapi/v1/geodata/fishhealth/localities"
  );

  if (!data || !Array.isArray(data)) {
    console.error("  No locality data received");
    return 0;
  }

  console.log(`  ${data.length} localities from API`);

  let inserted = 0;
  for (const loc of data) {
    const ticker = loc.name
      ? mapCompanyToTicker(loc.aquaCultureRegister?.ownerOrganizationName || "")
      : null;

    if (DRY_RUN) {
      console.log(
        `  [DRY] Locality ${loc.localityNo}: ${loc.name} (${loc.aquaCultureRegister?.ownerOrganizationName || "?"})`
      );
      inserted++;
      continue;
    }

    await pool.query(
      `INSERT INTO seafood_localities
        (locality_id, name, company_name, ticker, municipality_name, municipality_number,
         production_area_number, lat, lng, has_biomass, is_active, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
       ON CONFLICT (locality_id) DO UPDATE SET
         name = EXCLUDED.name,
         company_name = EXCLUDED.company_name,
         ticker = COALESCE(EXCLUDED.ticker, seafood_localities.ticker),
         municipality_name = EXCLUDED.municipality_name,
         production_area_number = EXCLUDED.production_area_number,
         lat = EXCLUDED.lat,
         lng = EXCLUDED.lng,
         has_biomass = EXCLUDED.has_biomass,
         is_active = EXCLUDED.is_active,
         updated_at = NOW()`,
      [
        loc.localityNo,
        loc.name || `Locality ${loc.localityNo}`,
        loc.aquaCultureRegister?.ownerOrganizationName || null,
        ticker,
        loc.municipality?.name || null,
        loc.municipality?.municipalityNumber || null,
        loc.productionAreaId || null,
        loc.latitude || null,
        loc.longitude || null,
        loc.hasBiomass || false,
        loc.isActive !== false,
      ]
    );
    inserted++;
  }

  console.log(`  ${inserted} localities upserted\n`);
  return inserted;
}

// ─── Lice Data ────────────────────────────────────────────────────

async function fetchLiceData(weeksBack: number): Promise<number> {
  console.log(`Fetching lice data (last ${weeksBack} weeks)...\n`);

  const now = new Date();
  let totalInserted = 0;

  for (let w = 0; w < weeksBack; w++) {
    const targetDate = new Date(now.getTime() - w * 7 * 86400000);
    const year = targetDate.getFullYear();
    // ISO week calculation
    const jan4 = new Date(year, 0, 4);
    const dayOfYear = Math.ceil(
      (targetDate.getTime() - new Date(year, 0, 1).getTime()) / 86400000
    );
    const week = Math.ceil((dayOfYear + new Date(year, 0, 1).getDay()) / 7);

    const url = `https://www.barentswatch.no/bwapi/v1/geodata/fishhealth/locality/${year}/${week}`;
    console.log(`  Week ${year}-W${String(week).padStart(2, "0")}...`);

    const rawData = await bwFetch(url);

    // Response is { year, week, localities: [...] }
    const data: any[] = rawData?.localities || (Array.isArray(rawData) ? rawData : []);

    if (!data || data.length === 0) {
      console.log(`    No data for week ${week}`);
      continue;
    }

    let weekInserted = 0;
    for (const report of data) {
      if (!report.localityNo) continue;
      if (SINGLE_LOCALITY && String(report.localityNo) !== SINGLE_LOCALITY) continue;
      // Skip fallow / non-reporting sites
      if (report.isFallow && report.avgAdultFemaleLice == null) continue;

      if (DRY_RUN) {
        weekInserted++;
        continue;
      }

      await pool.query(
        `INSERT INTO seafood_lice_reports
          (locality_id, year, week, avg_adult_female_lice, avg_mobile_lice,
           avg_stationary_lice, sea_temperature, has_cleaning,
           has_mechanical_removal, has_medicinal_treatment)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (locality_id, year, week) DO UPDATE SET
           avg_adult_female_lice = EXCLUDED.avg_adult_female_lice,
           avg_mobile_lice = EXCLUDED.avg_mobile_lice,
           avg_stationary_lice = EXCLUDED.avg_stationary_lice,
           sea_temperature = EXCLUDED.sea_temperature,
           has_cleaning = EXCLUDED.has_cleaning,
           has_mechanical_removal = EXCLUDED.has_mechanical_removal,
           has_medicinal_treatment = EXCLUDED.has_medicinal_treatment`,
        [
          report.localityNo,
          year,
          week,
          report.avgAdultFemaleLice ?? null,
          null, // mobile lice not in this endpoint
          null, // stationary lice not in this endpoint
          null, // sea temp not in this endpoint
          report.hasCleanerfishDeployed || false,
          report.hasMechanicalRemoval || false,
          report.hasSubstanceTreatments || false,
        ]
      );

      // Also update locality with lat/lng/disease from lice data
      if (report.lat && report.lon) {
        await pool.query(
          `UPDATE seafood_localities
           SET lat = COALESCE(lat, $1), lng = COALESCE(lng, $2),
               has_biomass = COALESCE($3, has_biomass),
               is_active = true,
               updated_at = NOW()
           WHERE locality_id = $4`,
          [report.lat, report.lon, report.hasSalmonoids || false, report.localityNo]
        );
      }

      weekInserted++;
    }

    console.log(`    ${weekInserted} reports (${data.length} total from API)`);
    totalInserted += weekInserted;

    // Rate limit
    await new Promise((r) => setTimeout(r, 500));
  }

  console.log(`\n  Total lice reports upserted: ${totalInserted}\n`);
  return totalInserted;
}

// ─── Company Metrics Aggregation ──────────────────────────────────

async function aggregateCompanyMetrics(): Promise<void> {
  console.log("Aggregating company metrics...\n");

  const today = new Date().toISOString().slice(0, 10);
  const tickers = ["MOWI", "SALM", "LSG", "GSF", "BAKKA", "AUSS"];

  for (const ticker of tickers) {
    // Get localities for this ticker
    const locResult = await pool.query(
      `SELECT locality_id FROM seafood_localities WHERE ticker = $1 AND is_active = true`,
      [ticker]
    );

    if (locResult.rows.length === 0) continue;

    const localityIds = locResult.rows.map((r: any) => r.locality_id);

    // Get latest 4 weeks of lice data
    const liceResult = await pool.query(
      `WITH latest_weeks AS (
        SELECT DISTINCT year, week FROM seafood_lice_reports
        ORDER BY year DESC, week DESC LIMIT 4
       )
       SELECT
        avg(avg_adult_female_lice::float) AS avg_lice,
        count(*) FILTER (WHERE avg_adult_female_lice::float > 0.5)::float / NULLIF(count(*), 0) * 100 AS pct_above,
        count(*) FILTER (WHERE has_mechanical_removal OR has_medicinal_treatment)::float / NULLIF(count(*), 0) * 100 AS treat_rate,
        avg(sea_temperature::float) AS avg_temp
       FROM seafood_lice_reports lr
       JOIN latest_weeks lw ON lr.year = lw.year AND lr.week = lw.week
       WHERE lr.locality_id = ANY($1::int[])`,
      [localityIds]
    );

    const metrics = liceResult.rows[0];
    const avgLice = metrics?.avg_lice || 0;
    const pctAbove = metrics?.pct_above || 0;
    const treatRate = metrics?.treat_rate || 0;
    const avgTemp = metrics?.avg_temp || null;

    // Risk score: weighted composite
    const riskScore = Math.min(100, Math.round(
      (avgLice / 0.5) * 40 + // lice level vs threshold
      (pctAbove / 100) * 30 + // % sites above
      (treatRate / 100) * 20 + // treatment frequency
      (avgLice > 0.5 ? 10 : 0) // penalty for being above threshold
    ));

    // Production areas
    const areasResult = await pool.query(
      `SELECT DISTINCT production_area_number FROM seafood_localities
       WHERE ticker = $1 AND production_area_number IS NOT NULL`,
      [ticker]
    );
    const areas = areasResult.rows.map((r: any) => r.production_area_number);

    // Company name
    const nameResult = await pool.query(
      `SELECT name FROM stocks WHERE upper(ticker) = $1`,
      [ticker]
    );
    const companyName = nameResult.rows[0]?.name || ticker;

    if (DRY_RUN) {
      console.log(
        `  [DRY] ${ticker}: avgLice=${avgLice.toFixed(3)}, pctAbove=${pctAbove.toFixed(1)}%, risk=${riskScore}`
      );
      continue;
    }

    await pool.query(
      `INSERT INTO seafood_company_metrics
        (ticker, company_name, as_of_date, active_sites, avg_lice_4w,
         pct_above_threshold, treatment_rate, avg_sea_temp, risk_score, production_areas)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (ticker, as_of_date) DO UPDATE SET
         company_name = EXCLUDED.company_name,
         active_sites = EXCLUDED.active_sites,
         avg_lice_4w = EXCLUDED.avg_lice_4w,
         pct_above_threshold = EXCLUDED.pct_above_threshold,
         treatment_rate = EXCLUDED.treatment_rate,
         avg_sea_temp = EXCLUDED.avg_sea_temp,
         risk_score = EXCLUDED.risk_score,
         production_areas = EXCLUDED.production_areas`,
      [ticker, companyName, today, localityIds.length, avgLice, pctAbove, treatRate, avgTemp, riskScore, JSON.stringify(areas)]
    );

    console.log(
      `  ${ticker}: ${localityIds.length} sites, avgLice=${avgLice.toFixed(3)}, risk=${riskScore}`
    );
  }

  console.log("");
}

// ─── Main ─────────────────────────────────────────────────────────

async function main() {
  console.log("═══════════════════════════════════════════════════");
  console.log("  BarentsWatch Seafood Data Fetcher");
  console.log("═══════════════════════════════════════════════════\n");

  if (!CLIENT_ID || !CLIENT_SECRET) {
    console.error("ERROR: BARENTSWATCH_CLIENT_ID and BARENTSWATCH_CLIENT_SECRET must be set.");
    console.error("Register at: https://www.barentswatch.no/minside/");
    console.error("Then add to .env.local:");
    console.error("  BARENTSWATCH_CLIENT_ID=your_client_id");
    console.error("  BARENTSWATCH_CLIENT_SECRET=your_client_secret\n");
    process.exit(1);
  }

  // 1. Fetch localities
  await fetchLocalities();

  // 2. Fetch lice data
  if (!SKIP_LICE) {
    await fetchLiceData(WEEKS_BACK);
  }

  // 3. Aggregate company metrics
  await aggregateCompanyMetrics();

  console.log("Done.");
  await pool.end();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
