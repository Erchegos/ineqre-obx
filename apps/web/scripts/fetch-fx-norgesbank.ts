/**
 * Fetch FX Rates from Norges Bank (no IBKR required)
 *
 * Uses the Norges Bank SDMX-JSON API (free, no auth) to fetch daily
 * FX spot rates for USD/NOK, EUR/NOK, GBP/NOK, SEK/NOK, DKK/NOK.
 *
 * Stores in fx_spot_rates table with source='norgesbank'.
 *
 * Usage:
 *   tsx scripts/fetch-fx-norgesbank.ts [--days=90] [--dry-run]
 */

import { Pool } from "pg";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

const DAYS = parseInt(
  process.argv.find((a) => a.startsWith("--days="))?.split("=")[1] ?? "90"
);
const DRY_RUN = process.argv.includes("--dry-run");

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
const dbUrl = (process.env.DATABASE_URL || "").trim().replace(/^["']|["']$/g, "");
const pool = new Pool({ connectionString: dbUrl });

// Norges Bank API pairs: currency code → our pair name
const PAIRS: { currency: string; pairName: string }[] = [
  { currency: "USD", pairName: "NOKUSD" },
  { currency: "EUR", pairName: "NOKEUR" },
  { currency: "GBP", pairName: "NOKGBP" },
  { currency: "SEK", pairName: "NOKSEK" },
  { currency: "DKK", pairName: "NOKDKK" },
];

interface NorgesBankRate {
  date: string;
  rate: number;
}

async function fetchNorgesBank(
  currency: string,
  days: number
): Promise<NorgesBankRate[]> {
  // SDMX-JSON API: returns daily exchange rates
  // B = Business day frequency, SP = Spot
  const url = `https://data.norges-bank.no/api/data/EXR/B.${currency}.NOK.SP?format=sdmx-json&lastNObservations=${days}`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Norges Bank API error ${res.status} for ${currency}`);
  }

  const data = await res.json();

  // Navigate SDMX-JSON structure
  const dataSet = data?.data?.dataSets?.[0];
  const structure = data?.data?.structure;

  if (!dataSet || !structure) {
    throw new Error(`Unexpected Norges Bank response structure for ${currency}`);
  }

  // Get observation dates from structure dimensions
  const timeDim = structure.dimensions?.observation?.[0];
  const dates = timeDim?.values?.map((v: { id: string }) => v.id) || [];

  // Get observations (keyed by series "0:0:0:0" for our single query)
  const series = dataSet.series?.["0:0:0:0"];
  if (!series) {
    throw new Error(`No series data for ${currency}`);
  }

  const observations = series.observations || {};
  const rates: NorgesBankRate[] = [];

  for (const [obsIdx, obsValues] of Object.entries(observations)) {
    const idx = parseInt(obsIdx);
    const date = dates[idx];
    const rate = (obsValues as number[])?.[0];

    if (date && rate && !isNaN(rate)) {
      rates.push({ date, rate });
    }
  }

  return rates.sort((a, b) => a.date.localeCompare(b.date));
}

async function main() {
  console.log("═══════════════════════════════════════════════════");
  console.log("  Norges Bank FX Rate Fetcher");
  console.log("═══════════════════════════════════════════════════");
  console.log(`  Days:     ${DAYS}`);
  console.log(`  Dry run:  ${DRY_RUN}`);
  console.log("═══════════════════════════════════════════════════\n");

  let totalInserted = 0;
  let totalSkipped = 0;

  for (const { currency, pairName } of PAIRS) {
    console.log(`Fetching ${currency}/NOK from Norges Bank...`);

    try {
      const rates = await fetchNorgesBank(currency, DAYS);
      console.log(`  ${rates.length} data points received`);

      if (DRY_RUN) {
        console.log(`  [DRY RUN] Would insert up to ${rates.length} rows\n`);
        continue;
      }

      let inserted = 0;
      let skipped = 0;

      for (const { date, rate } of rates) {
        try {
          const result = await pool.query(
            `INSERT INTO fx_spot_rates (currency_pair, date, spot_rate, mid, source)
             VALUES ($1, $2, $3, $3, 'norgesbank')
             ON CONFLICT (currency_pair, date, source) DO UPDATE SET
               spot_rate = EXCLUDED.spot_rate,
               mid = EXCLUDED.mid
             RETURNING (xmax = 0) AS is_insert`,
            [pairName, date, rate]
          );
          if (result.rows[0]?.is_insert) {
            inserted++;
          } else {
            skipped++;
          }
        } catch (err: any) {
          // Skip individual row errors
          console.error(`  Error inserting ${pairName} ${date}: ${err.message}`);
        }
      }

      totalInserted += inserted;
      totalSkipped += skipped;
      console.log(`  ${inserted} new, ${skipped} updated\n`);
    } catch (err: any) {
      console.error(`  Failed to fetch ${currency}/NOK: ${err.message}\n`);
    }
  }

  console.log("═══════════════════════════════════════════════════");
  console.log(`  Total inserted: ${totalInserted}`);
  console.log(`  Total updated:  ${totalSkipped}`);
  console.log("═══════════════════════════════════════════════════");

  await pool.end();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
