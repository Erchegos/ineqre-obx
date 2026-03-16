/**
 * Seed Central Bank Balance Sheet Data
 *
 * Seeds the cb_balance_sheets table with approximate current values (2025/2026).
 * Update quarterly by checking:
 *   - Fed: federalreserve.gov/releases/h41/
 *   - ECB: ecb.europa.eu/press/pr/wfs/
 *   - BoJ: boj.or.jp/en/statistics/boj/other/acthist/
 *   - BoE: bankofengland.co.uk/weekly-report
 *   - SNB: snb.ch/en/iabout/stat/statpub/weba/
 *   - Norges Bank: norges-bank.no (small balance sheet, mainly FX reserves)
 *
 * GDP denominators from IMF WEO (October 2024 edition).
 *
 * Regime classification (Rime, Schrimpf & Syrstad RFS 2022, Table 4):
 *   CB/GDP > 80%  → HIGHLY EXPANSIVE — funding very cheap, strong swap demand
 *   CB/GDP 40-80% → EXPANSIVE        — funding compressed
 *   CB/GDP 15-40% → NEUTRAL          — normal funding conditions
 *   CB/GDP < 15%  → TIGHT            — funding expensive, less swap demand
 *
 * Usage:
 *   npx tsx scripts/seed-cb-balance-sheets.ts
 *   npx tsx scripts/seed-cb-balance-sheets.ts --dry-run
 */

import { Pool } from "pg";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(__dirname, "../.env.local") });
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

let connectionString = (process.env.DATABASE_URL ?? "").trim().replace(/^["']|["']$/g, "");
connectionString = connectionString.replace(/[?&]sslmode=\w+/g, "");

const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false } });

interface CbEntry {
  currency: string;
  cbName: string;
  balanceSheetPctGdp: number;
  asOfDate: string;
  source: string;
}

// Approximate values as of March 2026
// Sources: central bank weekly balance sheet reports + IMF WEO Oct 2024
const CB_DATA: CbEntry[] = [
  {
    currency: "USD",
    cbName: "Federal Reserve",
    balanceSheetPctGdp: 23.0,
    asOfDate: "2026-03-01",
    source: "Fed H.4.1 (Mar 2026). Balance sheet ~$6.7T (QT ongoing from $9T peak 2022). US GDP ~$29.2T → ~23%",
  },
  {
    currency: "EUR",
    cbName: "European Central Bank",
    balanceSheetPctGdp: 47.0,
    asOfDate: "2026-03-01",
    source: "ECB Weekly Financial Statement (Mar 2026). Balance sheet ~€7.8T (PEPP/TLTRO unwind). Eurozone GDP ~€16.6T → ~47%",
  },
  {
    currency: "JPY",
    cbName: "Bank of Japan",
    balanceSheetPctGdp: 127.0,
    asOfDate: "2026-03-01",
    source: "BoJ Statistics (Mar 2026). Balance sheet ~¥762T (gradual JGB purchase reduction). Japan GDP ~¥600T → ~127%. Still largest globally.",
  },
  {
    currency: "GBP",
    cbName: "Bank of England",
    balanceSheetPctGdp: 30.0,
    asOfDate: "2026-03-01",
    source: "BoE Weekly Report (Mar 2026). Balance sheet ~£840B (active QT at £100B/yr). UK GDP ~£2.8T → ~30%",
  },
  {
    currency: "CHF",
    cbName: "Swiss National Bank",
    balanceSheetPctGdp: 108.0,
    asOfDate: "2026-03-01",
    source: "SNB (Mar 2026). Balance sheet ~CHF860B (FX reserve driven, modest decline). Swiss GDP ~£795B → ~108%",
  },
  {
    currency: "NOK",
    cbName: "Norges Bank",
    balanceSheetPctGdp: 5.0,
    asOfDate: "2026-03-01",
    source: "Norges Bank (Mar 2026). Core balance sheet (ex. GPFG oil fund) ~NOK330B. Norway GDP ~NOK6.6T → ~5%. No QE program.",
  },
];

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  console.log(`Seeding CB balance sheet data${dryRun ? " [DRY RUN]" : ""}...\n`);

  for (const entry of CB_DATA) {
    const regime =
      entry.balanceSheetPctGdp > 80 ? "HIGHLY EXPANSIVE" :
      entry.balanceSheetPctGdp > 40 ? "EXPANSIVE" :
      entry.balanceSheetPctGdp > 15 ? "NEUTRAL" : "TIGHT";
    console.log(`  ${entry.currency} / ${entry.cbName}: ${entry.balanceSheetPctGdp}% → ${regime}`);
  }

  if (dryRun) {
    console.log("\n[DRY RUN] No data written.");
    await pool.end();
    return;
  }

  // Ensure table exists
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cb_balance_sheets (
      id SERIAL PRIMARY KEY,
      currency VARCHAR(3) NOT NULL,
      cb_name VARCHAR(100) NOT NULL,
      balance_sheet_pct_gdp NUMERIC(8,2) NOT NULL,
      as_of_date DATE NOT NULL,
      source VARCHAR(500),
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Upsert: keep most recent per currency
  let inserted = 0;
  let updated = 0;

  for (const entry of CB_DATA) {
    const res = await pool.query(
      `INSERT INTO cb_balance_sheets (currency, cb_name, balance_sheet_pct_gdp, as_of_date, source)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [entry.currency, entry.cbName, entry.balanceSheetPctGdp, entry.asOfDate, entry.source]
    );

    if (res.rows.length > 0) {
      inserted++;
    } else {
      // Update if exists for same currency
      await pool.query(
        `UPDATE cb_balance_sheets
         SET cb_name = $2, balance_sheet_pct_gdp = $3, as_of_date = $4, source = $5
         WHERE currency = $1`,
        [entry.currency, entry.cbName, entry.balanceSheetPctGdp, entry.asOfDate, entry.source]
      );
      updated++;
    }
  }

  console.log(`\nInserted: ${inserted}, Updated: ${updated}`);
  await pool.end();
}

main().catch((err) => { console.error(err); process.exit(1); });
