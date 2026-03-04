/**
 * Pareto Shipping Market Rates Updater
 *
 * Inserts daily shipping market rates from Pareto Securities data
 * into shipping_market_rates table.
 *
 * Data source: Pareto Securities daily shipping report
 * (tanker spot rates, drybulk, LPG, LNG, commodities)
 *
 * Usage:
 *   npx tsx scripts/fetch-shipping-rates-pareto.ts                    # Insert today's rates interactively
 *   npx tsx scripts/fetch-shipping-rates-pareto.ts --date 2026-03-04  # Insert for specific date
 *   npx tsx scripts/fetch-shipping-rates-pareto.ts --json rates.json  # Import from JSON file
 *   npx tsx scripts/fetch-shipping-rates-pareto.ts --show             # Show current DB rates
 */

import { Pool } from "pg";
import * as dotenv from "dotenv";
import * as path from "path";
import * as fs from "fs";
import * as readline from "readline";

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

/* ─── DB ──────────────────────────────────────────────────────── */

let connectionString = (process.env.DATABASE_URL ?? "").trim().replace(/^["']|["']$/g, "");
connectionString = connectionString.replace(/[?&]sslmode=\w+/g, "");

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
});

/* ─── Rate definitions ────────────────────────────────────────── */

interface RateEntry {
  index_name: string;
  index_display_name: string;
  rate_unit: string;
  prompt: string;
}

const RATE_DEFINITIONS: RateEntry[] = [
  // Tanker spot rates (ECO, no scrubber)
  { index_name: "VLCC_TD3C_TCE", index_display_name: "VLCC MEG-China TCE", rate_unit: "usd_per_day", prompt: "VLCC (TD3_C) $/day" },
  { index_name: "SUEZMAX_TD20_TCE", index_display_name: "Suezmax WAF-UKC TCE", rate_unit: "usd_per_day", prompt: "Suezmax (TD20) $/day" },
  { index_name: "AFRAMAX_TCE", index_display_name: "Aframax TCE", rate_unit: "usd_per_day", prompt: "Aframax $/day" },
  { index_name: "LR2_TCE", index_display_name: "LR2 Product Tanker TCE", rate_unit: "usd_per_day", prompt: "LR2 $/day" },
  { index_name: "MR_TC2_TCE", index_display_name: "MR TC2 37kt UKC-USAC", rate_unit: "usd_per_day", prompt: "MR $/day" },
  // Drybulk
  { index_name: "BDI", index_display_name: "Baltic Dry Index", rate_unit: "index_points", prompt: "Baltic Dry Index" },
  { index_name: "CAPESIZE_5TC", index_display_name: "Capesize 5TC Average", rate_unit: "usd_per_day", prompt: "Capesize $/day" },
  { index_name: "PANAMAX_TCE", index_display_name: "Panamax TCE", rate_unit: "usd_per_day", prompt: "Panamax $/day" },
  { index_name: "ULTRAMAX_TCE", index_display_name: "Ultramax TCE", rate_unit: "usd_per_day", prompt: "Ultramax $/day" },
  // LPG
  { index_name: "VLGC_ME_ASIA", index_display_name: "VLGC Middle East - Asia", rate_unit: "usd_per_day", prompt: "VLGC ME-Asia $/day" },
  { index_name: "VLGC_USGOM_ASIA", index_display_name: "VLGC USGoM - Asia", rate_unit: "usd_per_day", prompt: "VLGC USGoM-Asia $/day" },
  // LNG
  { index_name: "LNG_SPOT_TFDE", index_display_name: "LNG Carrier Spot (TFDE)", rate_unit: "usd_per_day", prompt: "LNG Carrier spot (TFDE) $/day" },
  // Commodities
  { index_name: "BRENT", index_display_name: "Brent Crude Oil", rate_unit: "usd_per_bbl", prompt: "Brent $/bbl" },
  { index_name: "WTI", index_display_name: "WTI Crude Oil", rate_unit: "usd_per_bbl", prompt: "WTI $/bbl" },
  { index_name: "IRON_ORE", index_display_name: "Iron Ore Import Price (China)", rate_unit: "usd_per_ton", prompt: "Iron Ore $/ton" },
  { index_name: "HENRY_HUB", index_display_name: "Henry Hub Natural Gas", rate_unit: "usd_per_mmbtu", prompt: "Henry Hub $/mmbtu" },
  { index_name: "TTF", index_display_name: "TTF European Natural Gas", rate_unit: "usd_per_mmbtu", prompt: "TTF (EU gas) $/mmbtu" },
  // Baltic tanker indices
  { index_name: "BDTI", index_display_name: "Baltic Dirty Tanker Index", rate_unit: "index_points", prompt: "BDTI index" },
  { index_name: "BCTI", index_display_name: "Baltic Clean Tanker Index", rate_unit: "index_points", prompt: "BCTI index" },
];

/* ─── CLI ─────────────────────────────────────────────────────── */

const args = process.argv.slice(2);
const SHOW_ONLY = args.includes("--show");
const dateIdx = args.indexOf("--date");
const jsonIdx = args.indexOf("--json");
const RATE_DATE = dateIdx >= 0 ? args[dateIdx + 1] : new Date().toISOString().slice(0, 10);
const JSON_FILE = jsonIdx >= 0 ? args[jsonIdx + 1] : null;

/* ─── Main ────────────────────────────────────────────────────── */

async function showCurrentRates() {
  const result = await pool.query(`
    SELECT DISTINCT ON (index_name)
      index_name, index_display_name, rate_value, rate_unit, rate_date, source
    FROM shipping_market_rates
    ORDER BY index_name, rate_date DESC
  `);

  console.log("\n=== Current Market Rates (latest per index) ===\n");
  console.log("%-20s %-35s %12s %-15s %-12s %s", "INDEX", "DISPLAY NAME", "VALUE", "UNIT", "DATE", "SOURCE");
  console.log("-".repeat(110));
  for (const row of result.rows) {
    console.log(
      "%-20s %-35s %12s %-15s %-12s %s",
      row.index_name,
      row.index_display_name,
      Number(row.rate_value).toLocaleString("en-US"),
      row.rate_unit,
      row.rate_date.toISOString().slice(0, 10),
      row.source
    );
  }
  console.log(`\nTotal: ${result.rows.length} indices\n`);
}

async function insertRates(rates: Record<string, number>, date: string) {
  let inserted = 0;
  let updated = 0;

  for (const def of RATE_DEFINITIONS) {
    const value = rates[def.index_name];
    if (value == null) continue;

    const result = await pool.query(`
      INSERT INTO shipping_market_rates (index_name, index_display_name, rate_value, rate_unit, rate_date, source)
      VALUES ($1, $2, $3, $4, $5, 'pareto')
      ON CONFLICT (index_name, rate_date) DO UPDATE SET
        rate_value = EXCLUDED.rate_value,
        source = EXCLUDED.source
      RETURNING (xmax = 0) AS is_insert
    `, [def.index_name, def.index_display_name, value, def.rate_unit, date]);

    if (result.rows[0]?.is_insert) {
      inserted++;
    } else {
      updated++;
    }
  }

  console.log(`\n✓ Date: ${date} — Inserted: ${inserted}, Updated: ${updated}`);
}

async function interactiveInput(): Promise<Record<string, number>> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string): Promise<string> => new Promise(res => rl.question(q, res));

  console.log(`\n=== Pareto Shipping Rates Input — ${RATE_DATE} ===`);
  console.log("Enter values from Pareto daily report. Press Enter to skip.\n");

  const rates: Record<string, number> = {};

  const sections = [
    { title: "TANKER SPOT RATES", indices: ["VLCC_TD3C_TCE", "SUEZMAX_TD20_TCE", "AFRAMAX_TCE", "LR2_TCE", "MR_TC2_TCE"] },
    { title: "DRYBULK", indices: ["BDI", "CAPESIZE_5TC", "PANAMAX_TCE", "ULTRAMAX_TCE"] },
    { title: "LPG", indices: ["VLGC_ME_ASIA", "VLGC_USGOM_ASIA"] },
    { title: "LNG", indices: ["LNG_SPOT_TFDE"] },
    { title: "COMMODITIES", indices: ["BRENT", "WTI", "IRON_ORE", "HENRY_HUB", "TTF"] },
    { title: "BALTIC INDICES", indices: ["BDTI", "BCTI"] },
  ];

  for (const section of sections) {
    console.log(`\n--- ${section.title} ---`);
    for (const indexName of section.indices) {
      const def = RATE_DEFINITIONS.find(d => d.index_name === indexName);
      if (!def) continue;
      const answer = await ask(`  ${def.prompt}: `);
      if (answer.trim()) {
        const val = parseFloat(answer.replace(/[$,\s]/g, ""));
        if (!isNaN(val)) {
          rates[indexName] = val;
        }
      }
    }
  }

  rl.close();
  return rates;
}

async function main() {
  try {
    if (SHOW_ONLY) {
      await showCurrentRates();
      return;
    }

    if (JSON_FILE) {
      // Import from JSON file
      const data = JSON.parse(fs.readFileSync(JSON_FILE, "utf-8"));
      const date = data.date || RATE_DATE;
      const rates = data.rates as Record<string, number>;
      console.log(`Importing ${Object.keys(rates).length} rates from ${JSON_FILE} for ${date}`);
      await insertRates(rates, date);
    } else {
      // Interactive input
      const rates = await interactiveInput();
      const count = Object.keys(rates).length;
      if (count === 0) {
        console.log("\nNo rates entered. Exiting.");
        return;
      }
      console.log(`\nInserting ${count} rates for ${RATE_DATE}...`);
      await insertRates(rates, RATE_DATE);
    }

    await showCurrentRates();
  } catch (err) {
    console.error("Error:", err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
