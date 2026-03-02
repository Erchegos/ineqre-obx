/**
 * Fiskeridirektoratet Biomass Fetcher
 *
 * Downloads monthly biomass, harvest, mortality, and feed data per production area
 * from Fiskeridirektoratet's open data portal. No authentication required.
 *
 * Source: register.fiskeridir.no/biomassestatistikk/
 * Data: Monthly, per production area (1-13), salmon + trout
 * Updated: ~20th of each month
 *
 * Run: npx tsx scripts/fetch-biomass-fiskeridir.ts
 * Options:
 *   --dry-run   Print but don't insert
 *   --years=3   Limit to last N years (default: all)
 */

import { Pool } from "pg";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

const dbUrl = (process.env.DATABASE_URL || "").trim().replace(/^["']|["']$/g, "");
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
const pool = new Pool({ connectionString: dbUrl });

const DRY_RUN = process.argv.includes("--dry-run");
const YEARS_BACK = parseInt(
  process.argv.find((a) => a.startsWith("--years="))?.split("=")[1] ?? "0"
);

const DATA_URL =
  "https://register.fiskeridir.no/biomassestatistikk/BIOSTAT-LAKS-OMR/biostat-total-omr.json";

// Fiskeridirektoratet JSON row shape
interface FiskeridirRow {
  "\u00c5R": number;          // ÅR = year
  "M\u00c5NED_KODE": string;  // MÅNED_KODE = month code "01"-"12"
  "PO_KODE": string;          // Production area code "1"-"13" or "(null)"
  "PO_NAVN": string;          // Production area name
  "ARTSID": string;           // Species: "LAKS" or "REGNBUEØRRET"
  "UTSETTS\u00c5R": string;   // UTSETTSÅR = stocking year
  "BEHFISK_STK": number;      // Stock count (fish)
  "BIOMASSE_KG": number;      // Biomass in kg
  "UTSETT_SMOLT_STK": number; // Smolt releases
  "FORFORBRUK_KG": number;    // Feed consumption in kg
  "UTTAK_STK": number;        // Harvest count (fish)
  "UTTAK_KG": number;         // Harvest weight in kg
  "UTTAK_SL\u00d8YD_KG": number; // Gutted harvest weight in kg
  "D\u00d8DFISK_STK": number; // Dead fish count (mortality)
  "R\u00d8MMING_STK": number; // Escapes count
  "ANDRE_STK": number;        // Other losses count
}

// Aggregated row keyed by area+month+species
interface AggregatedRow {
  areaNumber: number;
  month: string;       // "YYYY-MM-01"
  species: string;     // "salmon" or "trout"
  biomassKg: number;
  harvestKg: number;
  mortalityCount: number;
  feedKg: number;
  stockCount: number;
  pensInUse: number;   // not available in this dataset — set 0
  sitesInUse: number;  // not available in this dataset — set 0
}

function mapSpecies(artsid: string): string {
  if (artsid === "LAKS") return "salmon";
  if (artsid === "REGNBUE\u00d8RRET") return "trout";
  return artsid.toLowerCase();
}

async function main() {
  console.log("=== Fiskeridirektoratet Biomass Fetcher ===\n");

  // 1) Fetch JSON
  console.log(`Fetching data from ${DATA_URL} ...`);
  const resp = await fetch(DATA_URL);
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
  }
  const json = await resp.json();
  // JSON is wrapped: { Metadata, Forklaring, Data: [...] }
  const rows: FiskeridirRow[] = json.Data || json;
  console.log(`  Received ${rows.length} raw rows`);
  if (json.Metadata) {
    console.log(`  Source: ${json.Metadata.Tittel} (updated ${json.Metadata.Oppdatert})`);
  }

  // 2) Filter: only rows with valid production area
  const cutoffYear = YEARS_BACK > 0 ? new Date().getFullYear() - YEARS_BACK : 0;
  const validRows = rows.filter((r) => {
    const poCode = r["PO_KODE"];
    if (!poCode || poCode === "(null)" || poCode === "null") return false;
    const area = parseInt(poCode);
    if (isNaN(area) || area < 1 || area > 13) return false;
    if (YEARS_BACK > 0 && r["\u00c5R"] < cutoffYear) return false;
    return true;
  });
  console.log(`  Valid rows (with production area): ${validRows.length}`);

  // 3) Aggregate by area + month + species (sum across stocking years)
  const aggMap = new Map<string, AggregatedRow>();

  for (const r of validRows) {
    const areaNumber = parseInt(r["PO_KODE"]);
    const year = r["\u00c5R"];
    const monthCode = String(r["M\u00c5NED_KODE"]).padStart(2, "0");
    const month = `${year}-${monthCode}-01`;
    const species = mapSpecies(r["ARTSID"]);
    const key = `${areaNumber}-${month}-${species}`;

    let agg = aggMap.get(key);
    if (!agg) {
      agg = {
        areaNumber,
        month,
        species,
        biomassKg: 0,
        harvestKg: 0,
        mortalityCount: 0,
        feedKg: 0,
        stockCount: 0,
        pensInUse: 0,
        sitesInUse: 0,
      };
      aggMap.set(key, agg);
    }

    agg.biomassKg += r["BIOMASSE_KG"] || 0;
    agg.harvestKg += r["UTTAK_KG"] || 0;
    agg.mortalityCount += r["D\u00d8DFISK_STK"] || 0;
    agg.feedKg += r["FORFORBRUK_KG"] || 0;
    agg.stockCount += r["BEHFISK_STK"] || 0;
  }

  const aggregated = Array.from(aggMap.values());
  console.log(`  Aggregated to ${aggregated.length} area-month-species rows\n`);

  if (DRY_RUN) {
    console.log("DRY RUN — showing first 5 rows:");
    for (const row of aggregated.slice(0, 5)) {
      console.log(
        `  Area ${row.areaNumber} | ${row.month} | ${row.species} | ` +
          `biomass=${(row.biomassKg / 1000).toFixed(0)}t | harvest=${(row.harvestKg / 1000).toFixed(0)}t | ` +
          `feed=${(row.feedKg / 1000).toFixed(0)}t | mortality=${row.mortalityCount}`
      );
    }
    await pool.end();
    return;
  }

  // 4) Upsert into seafood_biomass_monthly
  console.log("Upserting into seafood_biomass_monthly ...");
  let inserted = 0;
  let updated = 0;

  // Batch in chunks of 100
  const BATCH_SIZE = 100;
  for (let i = 0; i < aggregated.length; i += BATCH_SIZE) {
    const batch = aggregated.slice(i, i + BATCH_SIZE);

    const values: string[] = [];
    const params: (string | number | null)[] = [];
    let paramIdx = 1;

    for (const row of batch) {
      const biomassTonnes = row.biomassKg / 1000;
      const harvestTonnes = row.harvestKg / 1000;
      // Mortality: we have count (DØDFISK_STK), store as tonnes estimate
      // Fiskeridir doesn't give mortality in kg directly; store count in stock_count-adjacent field
      // For mortality_tonnes we estimate: mortality_count * avg_fish_weight (~5kg for salmon)
      const mortalityTonnes = (row.mortalityCount * 5) / 1000;
      const feedTonnes = row.feedKg / 1000;

      values.push(
        `($${paramIdx}, $${paramIdx + 1}, $${paramIdx + 2}, $${paramIdx + 3}, ` +
          `$${paramIdx + 4}, $${paramIdx + 5}, $${paramIdx + 6}, $${paramIdx + 7})`
      );
      params.push(
        row.areaNumber,
        row.month,
        row.species,
        biomassTonnes,
        harvestTonnes,
        mortalityTonnes,
        feedTonnes,
        row.stockCount
      );
      paramIdx += 8;
    }

    const sql = `
      INSERT INTO seafood_biomass_monthly
        (area_number, month, species, biomass_tonnes, harvest_tonnes, mortality_tonnes, feed_tonnes, stock_count)
      VALUES ${values.join(",\n")}
      ON CONFLICT (area_number, month, species) DO UPDATE SET
        biomass_tonnes = EXCLUDED.biomass_tonnes,
        harvest_tonnes = EXCLUDED.harvest_tonnes,
        mortality_tonnes = EXCLUDED.mortality_tonnes,
        feed_tonnes = EXCLUDED.feed_tonnes,
        stock_count = EXCLUDED.stock_count
    `;

    const result = await pool.query(sql, params);
    inserted += result.rowCount || 0;

    if ((i / BATCH_SIZE) % 10 === 0) {
      process.stdout.write(
        `  ${i + batch.length}/${aggregated.length} rows processed\r`
      );
    }
  }

  console.log(`\n  Done: ${inserted} rows upserted`);

  // 5) Print summary
  const summary = await pool.query(`
    SELECT species, COUNT(DISTINCT area_number) as areas,
           MIN(month) as from_month, MAX(month) as to_month,
           COUNT(*) as total_rows
    FROM seafood_biomass_monthly
    GROUP BY species
    ORDER BY species
  `);
  console.log("\nSummary:");
  for (const r of summary.rows) {
    console.log(
      `  ${r.species}: ${r.total_rows} rows, areas=${r.areas}, ${r.from_month} → ${r.to_month}`
    );
  }

  await pool.end();
  console.log("\nDone!");
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
