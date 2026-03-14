/**
 * Seed FX Interest Rates
 *
 * Populates the interest_rates table with current policy/market rates.
 * Static values — re-run after central bank rate decisions.
 *
 * Usage:
 *   npx tsx scripts/seed-fx-interest-rates.ts [--dry-run]
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

interface RateEntry {
  currency: string;
  tenor: string;
  rate: number; // decimal (0.045 = 4.5%)
  rateType: string;
  source: string;
}

// Current rates as of March 2026 (approximate)
const RATES: RateEntry[] = [
  // NOK — Norges Bank
  { currency: "NOK", tenor: "OVERNIGHT", rate: 0.0450, rateType: "POLICY_RATE", source: "norges_bank" },
  { currency: "NOK", tenor: "1M", rate: 0.0455, rateType: "IBOR", source: "nibor" },
  { currency: "NOK", tenor: "3M", rate: 0.0460, rateType: "IBOR", source: "nibor" },
  { currency: "NOK", tenor: "6M", rate: 0.0455, rateType: "IBOR", source: "nibor" },
  { currency: "NOK", tenor: "12M", rate: 0.0440, rateType: "IBOR", source: "nibor" },

  // USD — Federal Reserve
  { currency: "USD", tenor: "OVERNIGHT", rate: 0.0425, rateType: "POLICY_RATE", source: "fed" },
  { currency: "USD", tenor: "1M", rate: 0.0430, rateType: "IBOR", source: "sofr" },
  { currency: "USD", tenor: "3M", rate: 0.0425, rateType: "IBOR", source: "sofr" },
  { currency: "USD", tenor: "6M", rate: 0.0415, rateType: "IBOR", source: "sofr" },
  { currency: "USD", tenor: "12M", rate: 0.0400, rateType: "IBOR", source: "sofr" },

  // EUR — ECB
  { currency: "EUR", tenor: "OVERNIGHT", rate: 0.0250, rateType: "POLICY_RATE", source: "ecb" },
  { currency: "EUR", tenor: "1M", rate: 0.0255, rateType: "IBOR", source: "euribor" },
  { currency: "EUR", tenor: "3M", rate: 0.0260, rateType: "IBOR", source: "euribor" },
  { currency: "EUR", tenor: "6M", rate: 0.0270, rateType: "IBOR", source: "euribor" },
  { currency: "EUR", tenor: "12M", rate: 0.0280, rateType: "IBOR", source: "euribor" },

  // GBP — Bank of England
  { currency: "GBP", tenor: "OVERNIGHT", rate: 0.0450, rateType: "POLICY_RATE", source: "boe" },
  { currency: "GBP", tenor: "1M", rate: 0.0452, rateType: "IBOR", source: "sonia" },
  { currency: "GBP", tenor: "3M", rate: 0.0448, rateType: "IBOR", source: "sonia" },
  { currency: "GBP", tenor: "6M", rate: 0.0440, rateType: "IBOR", source: "sonia" },
  { currency: "GBP", tenor: "12M", rate: 0.0430, rateType: "IBOR", source: "sonia" },

  // SEK — Riksbanken
  { currency: "SEK", tenor: "OVERNIGHT", rate: 0.0225, rateType: "POLICY_RATE", source: "riksbanken" },
  { currency: "SEK", tenor: "1M", rate: 0.0230, rateType: "IBOR", source: "stibor" },
  { currency: "SEK", tenor: "3M", rate: 0.0235, rateType: "IBOR", source: "stibor" },
  { currency: "SEK", tenor: "6M", rate: 0.0240, rateType: "IBOR", source: "stibor" },
  { currency: "SEK", tenor: "12M", rate: 0.0245, rateType: "IBOR", source: "stibor" },

  // DKK — Danmarks Nationalbank (peg to EUR)
  { currency: "DKK", tenor: "OVERNIGHT", rate: 0.0260, rateType: "POLICY_RATE", source: "dnb_dk" },
  { currency: "DKK", tenor: "3M", rate: 0.0265, rateType: "IBOR", source: "cibor" },
  { currency: "DKK", tenor: "6M", rate: 0.0270, rateType: "IBOR", source: "cibor" },
  { currency: "DKK", tenor: "12M", rate: 0.0275, rateType: "IBOR", source: "cibor" },
];

async function main() {
  console.log("═══════════════════════════════════════════════════════");
  console.log("  Seeding FX Interest Rates");
  console.log("═══════════════════════════════════════════════════════\n");

  if (dryRun) console.log("(DRY RUN — no database writes)\n");

  const today = new Date().toISOString().slice(0, 10);
  let inserted = 0;
  let updated = 0;

  for (const entry of RATES) {
    const label = `  ${entry.currency.padEnd(4)} ${entry.tenor.padEnd(10)} ${(entry.rate * 100).toFixed(2)}%`;

    if (dryRun) {
      console.log(`${label} (${entry.source})`);
      continue;
    }

    try {
      const result = await pool.query(
        `INSERT INTO interest_rates (currency, date, tenor, rate, rate_type, source)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (currency, date, tenor, rate_type, source) DO UPDATE SET
           rate = EXCLUDED.rate
         RETURNING (xmax = 0) AS is_insert`,
        [entry.currency, today, entry.tenor, entry.rate, entry.rateType, entry.source]
      );

      const isInsert = result.rows[0]?.is_insert;
      console.log(`${label} — ${isInsert ? "inserted" : "updated"}`);
      if (isInsert) inserted++;
      else updated++;
    } catch (err: any) {
      console.error(`${label} — ERROR: ${err.message}`);
    }
  }

  console.log(`\n  Done: ${inserted} inserted, ${updated} updated (${RATES.length} total)`);
  await pool.end();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
