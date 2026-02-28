/**
 * Map seafood company ownership to BarentsWatch localities
 *
 * Uses Fiskeridirektoratet open API to find which companies operate which fish farm sites,
 * then updates seafood_localities table with company_name and ticker.
 *
 * Run: node scripts/map-seafood-localities.mjs
 */

import { createRequire } from "module";
import { readFileSync } from "fs";
const require = createRequire(import.meta.url);
const pg = require("pg");
const { Pool } = pg;

// Load .env.local
const envContent = readFileSync(".env.local", "utf-8");
const dbUrl = envContent.match(/DATABASE_URL="([^"]+)"/)?.[1];
const pool = new Pool({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });

const FDIR_BASE = "https://api.fiskeridir.no/pub-aqua/api/v1";

// Target companies and their search terms + tickers
const TARGET_COMPANIES = [
  { searchNames: ["Mowi"], ticker: "MOWI" },
  { searchNames: ["SalMar", "InnovaMar"], ticker: "SALM" },
  { searchNames: ["Lerøy", "Leroy", "Sjøtroll"], ticker: "LSG" },
  { searchNames: ["Grieg Seafood", "Grieg Aquaculture"], ticker: "GSF" },
  { searchNames: ["Norway Royal Salmon", "NRS", "Bakkafrost"], ticker: "BAKKA" },
  { searchNames: ["Austevoll"], ticker: "AUSS" },
];

async function fdirFetch(url) {
  const resp = await fetch(url, { headers: { Accept: "application/json" } });
  if (!resp.ok) {
    console.error(`  FDIR API error: ${resp.status} ${url}`);
    return null;
  }
  return resp.json();
}

async function findEntityOrgNumbers(searchName) {
  const data = await fdirFetch(`${FDIR_BASE}/entities?name=${encodeURIComponent(searchName)}&range=0-99`);
  if (!data || !Array.isArray(data)) return [];
  return data.map(e => ({
    orgNr: e.openNr,
    name: e.name,
    status: e.status,
  }));
}

async function getSitesForEntity(orgNr) {
  // Paginate with max 100 per page
  const allSites = [];
  let page = 0;
  while (true) {
    const start = page * 100;
    const end = start + 99;
    const data = await fdirFetch(`${FDIR_BASE}/entities/sites-by-entity-nr/${orgNr}?range=${start}-${end}`);
    if (!data || !Array.isArray(data) || data.length === 0) break;
    for (const s of data) {
      allSites.push({
        siteNr: parseInt(s.siteNr),
        name: s.siteName,
        prodArea: s.sitePlacement?.prodAreaCode,
        municipality: s.sitePlacement?.municipalityName,
      });
    }
    if (data.length < 100) break;
    page++;
    await sleep(300);
  }
  return allSites;
}

async function main() {
  console.log("═══════════════════════════════════════════════════");
  console.log("  Fiskeridirektoratet → BarentsWatch Locality Mapper");
  console.log("═══════════════════════════════════════════════════\n");

  const allMappings = []; // { siteNr, ticker, companyName }

  for (const company of TARGET_COMPANIES) {
    console.log(`\n--- ${company.ticker} ---`);

    const allEntities = [];
    for (const searchName of company.searchNames) {
      const entities = await findEntityOrgNumbers(searchName);
      console.log(`  Search "${searchName}": ${entities.length} entities`);
      for (const e of entities) {
        if (e.status === "ACTIVE") {
          console.log(`    ${e.orgNr} | ${e.name}`);
          allEntities.push(e);
        }
      }
      await sleep(300);
    }

    // Deduplicate by orgNr
    const uniqueOrgs = [...new Map(allEntities.map(e => [e.orgNr, e])).values()];

    let totalSites = 0;
    for (const entity of uniqueOrgs) {
      const sites = await getSitesForEntity(entity.orgNr);
      console.log(`  Sites for ${entity.name}: ${sites.length}`);
      for (const site of sites) {
        allMappings.push({
          siteNr: site.siteNr,
          ticker: company.ticker,
          companyName: entity.name,
          lat: site.lat,
          lng: site.lng,
          prodArea: site.prodArea,
        });
      }
      totalSites += sites.length;
      await sleep(300);
    }

    console.log(`  Total active sites for ${company.ticker}: ${totalSites}`);
  }

  console.log(`\n\nTotal mappings found: ${allMappings.length}`);

  // Deduplicate by siteNr (a site could appear under multiple entities)
  const uniqueMappings = [...new Map(allMappings.map(m => [m.siteNr, m])).values()];
  console.log(`Unique site mappings: ${uniqueMappings.length}`);

  // Update seafood_localities table
  console.log("\nUpdating seafood_localities...");
  let updated = 0;
  let notFound = 0;

  for (const mapping of uniqueMappings) {
    const result = await pool.query(
      `UPDATE seafood_localities
       SET ticker = $1, company_name = $2, production_area_number = COALESCE(production_area_number, $3)
       WHERE locality_id = $4`,
      [mapping.ticker, mapping.companyName, mapping.prodArea ? parseInt(mapping.prodArea) : null, mapping.siteNr]
    );
    if (result.rowCount > 0) {
      updated++;
    } else {
      notFound++;
    }
  }

  console.log(`  Updated: ${updated} localities`);
  console.log(`  Not found in BarentsWatch: ${notFound} sites (Fdir sites not in BW)`);

  // Check results
  const checkResult = await pool.query(`
    SELECT ticker, count(*) as cnt
    FROM seafood_localities
    WHERE ticker IS NOT NULL
    GROUP BY ticker
    ORDER BY cnt DESC
  `);
  console.log("\nLocalities per company:");
  for (const row of checkResult.rows) {
    console.log(`  ${row.ticker}: ${row.cnt}`);
  }

  // Also show unmapped with lice data
  const unmappedResult = await pool.query(`
    SELECT count(DISTINCT sl.locality_id) as cnt
    FROM seafood_localities sl
    JOIN seafood_lice_reports slr ON slr.locality_id = sl.locality_id
    WHERE sl.ticker IS NULL AND slr.avg_adult_female_lice IS NOT NULL
  `);
  console.log(`\nUnmapped localities with active lice data: ${unmappedResult.rows[0]?.cnt || 0}`);

  await pool.end();
  console.log("\nDone.");
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

main().catch(e => {
  console.error("Fatal:", e);
  process.exit(1);
});
