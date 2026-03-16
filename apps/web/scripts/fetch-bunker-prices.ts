/**
 * Fetch VLSFO/HSFO/MGO bunker prices from Ship & Bunker
 * (shipandbunker.com) — freely accessible, no auth required.
 *
 * Key bunkering hubs:
 *   - Singapore: main Asian hub, benchmark for all Asia/Middle East voyages
 *   - Rotterdam: main NW Europe/Atlantic basin hub
 *   - Fujairah: Middle East hub (UAE)
 *   - Houston: US Gulf Coast
 *
 * Prices stored in shipping_market_rates as usd_per_tonne.
 * Run daily alongside other shipping data scripts.
 *
 * Usage:
 *   npx tsx scripts/fetch-bunker-prices.ts
 *   npx tsx scripts/fetch-bunker-prices.ts --dry-run
 */

import { Pool } from "pg";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(__dirname, "../.env.local") });
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

let connectionString = (process.env.DATABASE_URL ?? "").trim().replace(/^["']|["']$/g, "");
connectionString = connectionString.replace(/[?&]sslmode=\w+/g, "");

const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false } });

interface BunkerReading {
  port: string;
  portCode: string;
  fuelType: string;
  priceUsd: number;
  date: string;
}

const SHIP_BUNKER_ENDPOINTS: { port: string; portCode: string; url: string }[] = [
  {
    port: "Singapore",
    portCode: "SIN",
    url: "https://shipandbunker.com/prices/apac/north-pacific/sg-sin-singapore",
  },
  {
    port: "Rotterdam",
    portCode: "RTM",
    url: "https://shipandbunker.com/prices/emea/north-west-europe/nl-rtm-rotterdam",
  },
  {
    port: "Fujairah",
    portCode: "FUJ",
    url: "https://shipandbunker.com/prices/emea/middle-east/ae-fuj-fujairah",
  },
  {
    port: "Houston",
    portCode: "HOU",
    url: "https://shipandbunker.com/prices/ame/us-gulf/us-hou-houston",
  },
];

async function fetchBunkerPage(url: string, port: string, portCode: string): Promise<BunkerReading[]> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      "Accept": "text/html,application/xhtml+xml",
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    console.warn(`  ${port}: HTTP ${res.status}`);
    return [];
  }

  const html = await res.text();
  const today = new Date().toISOString().slice(0, 10);
  const readings: BunkerReading[] = [];

  // Ship & Bunker price format: appears in table rows with fuel grade and price
  // Pattern: "VLSFO" or "0.5% S" followed by currency amount
  const fuelPatterns: { regex: RegExp; fuelType: string; indexName: string }[] = [
    { regex: /VLSFO[\s\S]{0,100}?\$\s*([\d,]+\.?\d*)/i, fuelType: "VLSFO", indexName: `VLSFO_${portCode}` },
    { regex: /0\.5%?\s*S[\s\S]{0,100}?\$\s*([\d,]+\.?\d*)/i, fuelType: "VLSFO_05", indexName: `VLSFO_${portCode}` },
    { regex: /HSFO[\s\S]{0,100}?\$\s*([\d,]+\.?\d*)/i, fuelType: "HSFO", indexName: `HSFO_${portCode}` },
    { regex: /3\.5%?\s*S[\s\S]{0,100}?\$\s*([\d,]+\.?\d*)/i, fuelType: "HSFO_35", indexName: `HSFO_${portCode}` },
    { regex: /MGO[\s\S]{0,100}?\$\s*([\d,]+\.?\d*)/i, fuelType: "MGO", indexName: `MGO_${portCode}` },
  ];

  for (const fp of fuelPatterns) {
    const match = html.match(fp.regex);
    if (!match) continue;
    const price = parseFloat(match[1].replace(/,/g, ""));
    if (price > 100 && price < 3000) {
      // Avoid duplicates for same indexName
      if (!readings.some(r => r.portCode === portCode && r.fuelType === fp.fuelType)) {
        readings.push({ port, portCode, fuelType: fp.fuelType, priceUsd: price, date: today });
        console.log(`  ${portCode} ${fp.fuelType}: $${price}/MT`);
      }
    }
  }

  // Alternative pattern: table with data-value or JSON-like embedded data
  if (readings.length === 0) {
    // Try structured data or meta tags
    const jsonMatch = html.match(/"price"\s*:\s*([\d.]+)/);
    if (jsonMatch) {
      const price = parseFloat(jsonMatch[1]);
      if (price > 100 && price < 3000) {
        readings.push({ port, portCode, fuelType: "VLSFO", priceUsd: price, date: today });
        console.log(`  ${portCode} VLSFO (structured): $${price}/MT`);
      }
    }
  }

  return readings;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  console.log(`Fetching bunker prices from Ship & Bunker${dryRun ? " [DRY RUN]" : ""}\n`);

  const allReadings: BunkerReading[] = [];

  for (const ep of SHIP_BUNKER_ENDPOINTS) {
    console.log(`Fetching ${ep.port} (${ep.url})`);
    try {
      const readings = await fetchBunkerPage(ep.url, ep.port, ep.portCode);
      if (readings.length === 0) {
        console.log(`  No prices extracted for ${ep.port}`);
      }
      allReadings.push(...readings);
    } catch (err: any) {
      console.warn(`  Error fetching ${ep.port}: ${err.message}`);
    }
    // Polite delay between requests
    await new Promise(r => setTimeout(r, 2000));
  }

  if (allReadings.length === 0) {
    console.log("\nNo prices fetched. Ship & Bunker may have changed their HTML structure.");
    console.log("Try running with --dry-run to debug, or check the URL patterns.");
    await pool.end();
    return;
  }

  console.log(`\nFetched ${allReadings.length} bunker readings`);

  if (dryRun) {
    console.log("[DRY RUN] Would insert the following:");
    for (const r of allReadings) {
      console.log(`  ${r.portCode}_${r.fuelType}: $${r.priceUsd}/MT (${r.date})`);
    }
    await pool.end();
    return;
  }

  // Insert into shipping_market_rates using the same table as other shipping indices
  let inserted = 0;
  let updated = 0;
  const today = new Date().toISOString().slice(0, 10);

  // Map fuelType + portCode to index_name
  const fuelIndexMap: Record<string, { indexName: string; displayName: string; unit: string }> = {
    "VLSFO": { indexName: "", displayName: "", unit: "usd_per_tonne" },
    "VLSFO_05": { indexName: "", displayName: "", unit: "usd_per_tonne" },
    "HSFO": { indexName: "", displayName: "", unit: "usd_per_tonne" },
    "HSFO_35": { indexName: "", displayName: "", unit: "usd_per_tonne" },
    "MGO": { indexName: "", displayName: "", unit: "usd_per_tonne" },
  };

  for (const r of allReadings) {
    const baseType = r.fuelType.replace("_05", "").replace("_35", "");
    const indexName = `${baseType}_${r.portCode}`;
    const displayName = `${baseType} Bunker ${r.port}`;

    const res = await pool.query(`
      INSERT INTO shipping_market_rates (index_name, index_display_name, rate_value, rate_unit, rate_date, source)
      VALUES ($1, $2, $3, $4, $5, 'ship_and_bunker')
      ON CONFLICT (index_name, rate_date) DO UPDATE SET
        rate_value = EXCLUDED.rate_value,
        index_display_name = EXCLUDED.index_display_name
      RETURNING (xmax = 0) AS is_insert
    `, [indexName, displayName, r.priceUsd, "usd_per_tonne", today]);

    if (res.rows[0]?.is_insert) inserted++;
    else updated++;
  }

  console.log(`\nInserted: ${inserted}, Updated: ${updated}`);
  await pool.end();
}

main().catch(err => { console.error(err); process.exit(1); });
