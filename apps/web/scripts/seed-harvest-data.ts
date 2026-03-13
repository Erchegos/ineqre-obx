/**
 * Seed Harvest Tracking Data — Wellboats & Slaughterhouses
 *
 * Seeds known Norwegian wellboats (brønnbåter) and salmon slaughterhouses.
 * Wellboat fleets: Sølvtrans (~20 vessels), Rostein (~8), company-owned.
 * Slaughterhouses: Major facilities for MOWI, SALM, LSG, GSF, BAKKA, AUSS.
 *
 * Run: npx tsx scripts/seed-harvest-data.ts
 * Options: --dry-run  (print only, no DB writes)
 */

import { Pool } from "pg";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

const dbUrl = (process.env.DATABASE_URL || "").trim().replace(/^["']|["']$/g, "");
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
const pool = new Pool({ connectionString: dbUrl });

const dryRun = process.argv.includes("--dry-run");

// ============================================================================
// WELLBOATS (Brønnbåter)
// Sources: Sølvtrans fleet list, Rostein fleet, public vessel registries
// ============================================================================
const WELLBOATS = [
  // --- Sølvtrans fleet (largest wellboat operator in the world) ---
  { vesselName: "Ronja Storm", ownerCompany: "Sølvtrans", capacityTonnes: 600, builtYear: 2019, vesselType: "wellboat" },
  { vesselName: "Ronja Polaris", ownerCompany: "Sølvtrans", capacityTonnes: 460, builtYear: 2018, vesselType: "wellboat" },
  { vesselName: "Ronja Commander", ownerCompany: "Sølvtrans", capacityTonnes: 550, builtYear: 2021, vesselType: "wellboat" },
  { vesselName: "Ronja Viking", ownerCompany: "Sølvtrans", capacityTonnes: 450, builtYear: 2016, vesselType: "wellboat" },
  { vesselName: "Ronja Huon", ownerCompany: "Sølvtrans", capacityTonnes: 450, builtYear: 2017, vesselType: "wellboat" },
  { vesselName: "Ronja Explorer", ownerCompany: "Sølvtrans", capacityTonnes: 400, builtYear: 2020, vesselType: "wellboat" },
  { vesselName: "Ronja Carrier", ownerCompany: "Sølvtrans", capacityTonnes: 350, builtYear: 2015, vesselType: "wellboat" },
  { vesselName: "Ronja Harvester", ownerCompany: "Sølvtrans", capacityTonnes: 500, builtYear: 2020, vesselType: "wellboat" },
  { vesselName: "Ronja Ocean", ownerCompany: "Sølvtrans", capacityTonnes: 400, builtYear: 2018, vesselType: "wellboat" },
  { vesselName: "Ronja Star", ownerCompany: "Sølvtrans", capacityTonnes: 350, builtYear: 2014, vesselType: "wellboat" },
  { vesselName: "Ronja Fjord", ownerCompany: "Sølvtrans", capacityTonnes: 320, builtYear: 2012, vesselType: "wellboat" },
  { vesselName: "Ronja Aurora", ownerCompany: "Sølvtrans", capacityTonnes: 450, builtYear: 2019, vesselType: "wellboat" },
  { vesselName: "Ronja Challenger", ownerCompany: "Sølvtrans", capacityTonnes: 400, builtYear: 2017, vesselType: "wellboat" },
  { vesselName: "Ronja Superior", ownerCompany: "Sølvtrans", capacityTonnes: 500, builtYear: 2022, vesselType: "wellboat" },
  { vesselName: "Ronja Voyager", ownerCompany: "Sølvtrans", capacityTonnes: 350, builtYear: 2013, vesselType: "wellboat" },

  // --- Rostein fleet ---
  { vesselName: "Rostein", ownerCompany: "Rostein", capacityTonnes: 350, builtYear: 2010, vesselType: "wellboat" },
  { vesselName: "Bjørøya", ownerCompany: "Rostein", capacityTonnes: 300, builtYear: 2008, vesselType: "wellboat" },
  { vesselName: "Steinsund", ownerCompany: "Rostein", capacityTonnes: 280, builtYear: 2006, vesselType: "wellboat" },
  { vesselName: "Bjørgøy", ownerCompany: "Rostein", capacityTonnes: 320, builtYear: 2012, vesselType: "wellboat" },
  { vesselName: "Seihav", ownerCompany: "Rostein", capacityTonnes: 350, builtYear: 2015, vesselType: "wellboat" },
  { vesselName: "Namsos", ownerCompany: "Rostein", capacityTonnes: 300, builtYear: 2011, vesselType: "wellboat" },

  // --- Frøy fleet ---
  { vesselName: "Frøy Baltic", ownerCompany: "Frøy", capacityTonnes: 400, builtYear: 2019, vesselType: "wellboat" },
  { vesselName: "Frøy Fjord", ownerCompany: "Frøy", capacityTonnes: 350, builtYear: 2016, vesselType: "wellboat" },
  { vesselName: "Frøy Harvest", ownerCompany: "Frøy", capacityTonnes: 380, builtYear: 2020, vesselType: "wellboat" },

  // --- Nordlaks (company-owned) ---
  { vesselName: "Nordlaks Produkter", ownerCompany: "Nordlaks", operatorTicker: null, capacityTonnes: 300, builtYear: 2014, vesselType: "wellboat" },

  // --- Other operators ---
  { vesselName: "Aqua Kvaløy", ownerCompany: "Aqua Transport", capacityTonnes: 280, builtYear: 2010, vesselType: "wellboat" },
  { vesselName: "Aqua Fjell", ownerCompany: "Aqua Transport", capacityTonnes: 300, builtYear: 2012, vesselType: "wellboat" },
  { vesselName: "Inter Caledonia", ownerCompany: "Inter Caledonia", capacityTonnes: 350, builtYear: 2011, vesselType: "wellboat" },
  { vesselName: "Bakkanes", ownerCompany: "Bakkafrost", operatorTicker: "BAKKA", capacityTonnes: 350, builtYear: 2018, vesselType: "wellboat" },
  { vesselName: "Grieg Seafood Carrier", ownerCompany: "Grieg Seafood", operatorTicker: "GSF", capacityTonnes: 300, builtYear: 2015, vesselType: "wellboat" },
];

// ============================================================================
// SLAUGHTERHOUSES
// Major Norwegian salmon processing facilities with approximate coordinates
// ============================================================================
const SLAUGHTERHOUSES = [
  // --- MOWI ---
  { name: "Mowi Eggesbønes", companyName: "Mowi ASA", ticker: "MOWI", lat: 62.4908, lng: 6.1464, municipality: "Ålesund", areaNumber: 5, capacityTonnesDay: 400 },
  { name: "Mowi Hammerfest", companyName: "Mowi ASA", ticker: "MOWI", lat: 70.6634, lng: 23.6821, municipality: "Hammerfest", areaNumber: 12, capacityTonnesDay: 250 },
  { name: "Mowi Bogen", companyName: "Mowi ASA", ticker: "MOWI", lat: 68.4390, lng: 16.5499, municipality: "Sortland", areaNumber: 9, capacityTonnesDay: 200 },
  { name: "Mowi Herøy", companyName: "Mowi ASA", ticker: "MOWI", lat: 62.2581, lng: 5.6271, municipality: "Herøy", areaNumber: 5, capacityTonnesDay: 300 },

  // --- SalMar ---
  { name: "SalMar InnovaMar", companyName: "SalMar ASA", ticker: "SALM", lat: 63.7012, lng: 8.8371, municipality: "Frøya", areaNumber: 6, capacityTonnesDay: 500 },
  { name: "SalMar Vikenco", companyName: "SalMar ASA", ticker: "SALM", lat: 62.3177, lng: 5.7962, municipality: "Aukra", areaNumber: 5, capacityTonnesDay: 300 },
  { name: "SalMar Senja", companyName: "SalMar ASA", ticker: "SALM", lat: 69.2500, lng: 17.0500, municipality: "Senja", areaNumber: 10, capacityTonnesDay: 250 },

  // --- Lerøy Seafood Group ---
  { name: "Lerøy Stamsund", companyName: "Lerøy Seafood Group ASA", ticker: "LSG", lat: 68.1236, lng: 13.8402, municipality: "Vestvågøy", areaNumber: 9, capacityTonnesDay: 200 },
  { name: "Lerøy Bulandet", companyName: "Lerøy Seafood Group ASA", ticker: "LSG", lat: 61.2872, lng: 4.6376, municipality: "Askvoll", areaNumber: 4, capacityTonnesDay: 250 },
  { name: "Lerøy Osterøy", companyName: "Lerøy Seafood Group ASA", ticker: "LSG", lat: 60.5200, lng: 5.5200, municipality: "Osterøy", areaNumber: 3, capacityTonnesDay: 300 },
  { name: "Lerøy Skjervøy", companyName: "Lerøy Seafood Group ASA", ticker: "LSG", lat: 70.0300, lng: 20.9700, municipality: "Skjervøy", areaNumber: 11, capacityTonnesDay: 200 },

  // --- Grieg Seafood ---
  { name: "Grieg Kvingo", companyName: "Grieg Seafood ASA", ticker: "GSF", lat: 60.2500, lng: 5.2500, municipality: "Tysnes", areaNumber: 3, capacityTonnesDay: 200 },
  { name: "Grieg Hammerfest", companyName: "Grieg Seafood ASA", ticker: "GSF", lat: 70.6600, lng: 23.6700, municipality: "Hammerfest", areaNumber: 12, capacityTonnesDay: 180 },

  // --- Bakkafrost (Norway / Scotland) ---
  { name: "Bakkafrost Stord", companyName: "Bakkafrost ASA", ticker: "BAKKA", lat: 59.7800, lng: 5.5000, municipality: "Stord", areaNumber: 3, capacityTonnesDay: 200 },

  // --- Austevoll Seafood ---
  { name: "Austevoll Bømlo", companyName: "Austevoll Seafood ASA", ticker: "AUSS", lat: 59.7900, lng: 5.2400, municipality: "Bømlo", areaNumber: 3, capacityTonnesDay: 200 },
  { name: "Austevoll Herøy", companyName: "Austevoll Seafood ASA", ticker: "AUSS", lat: 62.2500, lng: 5.6000, municipality: "Herøy", areaNumber: 5, capacityTonnesDay: 180 },

  // --- Norway Royal Salmon (NRS, part of SalMar) ---
  { name: "NRS Tromsø", companyName: "SalMar ASA", ticker: "SALM", lat: 69.6500, lng: 18.9600, municipality: "Tromsø", areaNumber: 11, capacityTonnesDay: 200 },
];

async function main() {
  console.log("═══════════════════════════════════════════════════════");
  console.log("  Seeding Harvest Tracker Data (Wellboats & Slaughterhouses)");
  console.log("═══════════════════════════════════════════════════════\n");

  if (dryRun) console.log("(DRY RUN — no database writes)\n");

  // --- Seed wellboats ---
  console.log(`Wellboats (${WELLBOATS.length} vessels):\n`);
  let vInserted = 0, vUpdated = 0;

  for (const v of WELLBOATS) {
    const label = `  ${v.vesselName.padEnd(25)} ${(v.ownerCompany || "").padEnd(15)} ${(v.capacityTonnes + "t").padEnd(6)} ${v.builtYear || ""}`;

    if (dryRun) {
      console.log(label);
      continue;
    }

    const result = await pool.query(
      `INSERT INTO harvest_vessels
        (vessel_name, owner_company, operator_ticker, capacity_tonnes, vessel_type, built_year, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (vessel_name) DO UPDATE SET
         owner_company = EXCLUDED.owner_company,
         operator_ticker = EXCLUDED.operator_ticker,
         capacity_tonnes = EXCLUDED.capacity_tonnes,
         vessel_type = EXCLUDED.vessel_type,
         built_year = EXCLUDED.built_year,
         updated_at = NOW()
       RETURNING (xmax = 0) AS is_insert`,
      [v.vesselName, v.ownerCompany, (v as Record<string, unknown>).operatorTicker ?? null, v.capacityTonnes, v.vesselType, v.builtYear]
    );

    const isInsert = result.rows[0]?.is_insert;
    console.log(`${label} — ${isInsert ? "inserted" : "updated"}`);
    if (isInsert) vInserted++; else vUpdated++;
  }

  console.log(`\n  Vessels: ${vInserted} inserted, ${vUpdated} updated\n`);

  // --- Seed slaughterhouses ---
  console.log(`Slaughterhouses (${SLAUGHTERHOUSES.length} facilities):\n`);
  let sInserted = 0, sUpdated = 0;

  for (const s of SLAUGHTERHOUSES) {
    const label = `  ${s.name.padEnd(30)} ${s.ticker.padEnd(6)} ${s.municipality.padEnd(15)} Area ${s.areaNumber}`;

    if (dryRun) {
      console.log(label);
      continue;
    }

    const result = await pool.query(
      `INSERT INTO harvest_slaughterhouses
        (name, company_name, ticker, lat, lng, municipality, production_area_number, capacity_tonnes_day)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (name) DO UPDATE SET
         company_name = EXCLUDED.company_name,
         ticker = EXCLUDED.ticker,
         lat = EXCLUDED.lat,
         lng = EXCLUDED.lng,
         municipality = EXCLUDED.municipality,
         production_area_number = EXCLUDED.production_area_number,
         capacity_tonnes_day = EXCLUDED.capacity_tonnes_day
       RETURNING (xmax = 0) AS is_insert`,
      [s.name, s.companyName, s.ticker, s.lat, s.lng, s.municipality, s.areaNumber, s.capacityTonnesDay]
    );

    const isInsert = result.rows[0]?.is_insert;
    console.log(`${label} — ${isInsert ? "inserted" : "updated"}`);
    if (isInsert) sInserted++; else sUpdated++;
  }

  console.log(`\n  Slaughterhouses: ${sInserted} inserted, ${sUpdated} updated`);
  console.log("\nDone.");
  await pool.end();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
