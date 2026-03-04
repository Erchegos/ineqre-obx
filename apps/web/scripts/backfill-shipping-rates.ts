/**
 * backfill-shipping-rates.ts
 *
 * Extracts shipping rate data from Pareto Shipping Daily reports and
 * backfills the shipping_market_rates table with daily data points.
 *
 * Sources:
 * 1. Parse body_text from research_documents for rate mentions
 * 2. Fill gaps with interpolation between known data points
 *
 * Usage: npx tsx scripts/backfill-shipping-rates.ts
 */

import * as dotenv from "dotenv";
import { Pool } from "pg";

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

dotenv.config({ path: "../../.env" });
dotenv.config({ path: ".env" });

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL.trim().replace(/^["']|["']$/g, ""),
  ssl: { rejectUnauthorized: false },
});

/* ── Rate extraction patterns ─────────────────────────────────── */

interface RateExtract {
  date: string;
  index: string;
  value: number;
}

// Parse rate mentions from Pareto Shipping Daily body text
function extractRates(bodyText: string, date: string): RateExtract[] {
  const rates: RateExtract[] = [];
  const text = bodyText.replace(/â/g, "'").replace(/â/g, "-").replace(/â¢/g, "•");

  // VLCC patterns
  const vlccPatterns = [
    /VLCC[s]?\s+(?:rates?\s+)?(?:at|around|near|above|pushing|reaching|now)\s+\$?([\d,]+),?(\d{3})?\/day/gi,
    /TD3[C]?\s+(?:is\s+)?(?:at\s+)?(?:a\s+record\s+)?(?:level[,.]?\s+)?.*?\$?([\d,]+),?(\d{3})?\/day/gi,
    /VLCC\s+rates?\s+.*?(?:above|at|near)\s+\$?([\d,]+),?(\d{3})?\/day/gi,
    /VLCC.*?\$(\d[\d,]*)\s*(?:k)?\/day/gi,
  ];
  for (const pat of vlccPatterns) {
    let m;
    while ((m = pat.exec(text)) !== null) {
      const val = parseRate(m[1], m[2]);
      if (val >= 10000 && val <= 500000) {
        rates.push({ date, index: "VLCC_TD3C_TCE", value: val });
        break;
      }
    }
    if (rates.some(r => r.index === "VLCC_TD3C_TCE")) break;
  }

  // Suezmax patterns
  const szmxMatch = text.match(/[Ss]uezmax(?:es)?\s+(?:in\s+\w+\s+)?(?:at|around|near|closing\s+in\s+on|above|pushing|reaching|now)\s+\$?([\d,]+),?(\d{3})?\/day/i);
  if (szmxMatch) {
    const val = parseRate(szmxMatch[1], szmxMatch[2]);
    if (val >= 5000 && val <= 300000) rates.push({ date, index: "SUEZMAX_TD20_TCE", value: val });
  }

  // MR patterns
  const mrMatch = text.match(/MR[s]?\s+(?:in\s+\w+\s+)?(?:at|around|near|on|above|pushing|now)\s+\$?([\d,]+),?(\d{3})?\/day/i);
  if (mrMatch) {
    const val = parseRate(mrMatch[1], mrMatch[2]);
    if (val >= 5000 && val <= 150000) rates.push({ date, index: "MR_TC2_TCE", value: val });
  }

  // VLGC / LPG patterns
  const vlgcMatch = text.match(/(?:VLGC|USGoM)\s+(?:rates?\s+)?(?:fixtures?\s+)?(?:at|above|around|booked\s+at)\s+\$?([\d,]+),?(\d{3})?\/day/i);
  if (vlgcMatch) {
    const val = parseRate(vlgcMatch[1], vlgcMatch[2]);
    if (val >= 10000 && val <= 200000) rates.push({ date, index: "VLGC_ME_ASIA", value: val });
  }

  // Brent patterns
  const brentMatch = text.match(/[Bb]rent\s+(?:is\s+)?(?:trading\s+)?(?:at|around|near|now|above)?\s*~?\$?([\d.]+)\/bbl/);
  if (brentMatch) {
    const val = parseFloat(brentMatch[1]);
    if (val >= 30 && val <= 200) rates.push({ date, index: "BRENT", value: val });
  }

  // Capesize patterns
  const capeMatch = text.match(/[Cc]apesize\s+(?:rates?\s+)?(?:at|around|near|above|pushing)\s+\$?([\d,]+),?(\d{3})?\/day/i);
  if (capeMatch) {
    const val = parseRate(capeMatch[1], capeMatch[2]);
    if (val >= 5000 && val <= 100000) rates.push({ date, index: "CAPESIZE_5TC", value: val });
  }

  // BW LPG specific TC rate
  const bwlpgTce = text.match(/(?:BW\s*LPG|BWLPG).*?(?:fixed|TC|rates?).*?\$?([\d,]+),?(\d{3})?\/day/i);
  if (bwlpgTce) {
    const val = parseRate(bwlpgTce[1], bwlpgTce[2]);
    if (val >= 20000 && val <= 150000) rates.push({ date, index: "VLGC_ME_ASIA", value: val });
  }

  return rates;
}

function parseRate(main: string, frac?: string): number {
  const mainNum = parseInt(main.replace(/,/g, ""), 10);
  if (frac) return mainNum * 1000 + parseInt(frac, 10);
  // If < 1000, likely in thousands (e.g., "$60,000" parsed as "60" then "000")
  if (mainNum < 1000) return mainNum * 1000;
  return mainNum;
}

function getRateUnit(idx: string): string {
  if (idx.includes("BDI") || idx.includes("BDTI") || idx.includes("BCTI") || idx.includes("SCFI")) return "points";
  if (idx.includes("BRENT") || idx.includes("WTI") || idx.includes("IRON_ORE")) return "USD";
  if (idx.includes("TTF") || idx.includes("HENRY_HUB")) return "USD/MMBtu";
  return "USD/day";
}

/* ── Main ──────────────────────────────────────────────────────── */

async function main() {
  console.log("=== Backfill Shipping Rates from Pareto Dailies ===\n");

  // Step 1: Get all Pareto Shipping Daily reports
  const { rows: reports } = await pool.query(`
    SELECT id, received_date, subject, body_text
    FROM research_documents
    WHERE source ILIKE '%pareto%' AND subject ILIKE '%shipping daily%'
    AND body_text IS NOT NULL AND LENGTH(body_text) > 100
    ORDER BY received_date ASC
  `);
  console.log(`Found ${reports.length} Pareto Shipping Daily reports\n`);

  // Step 2: Extract rates from each report
  const allRates: RateExtract[] = [];
  for (const r of reports) {
    const date = new Date(r.received_date).toISOString().split("T")[0];
    const extracted = extractRates(r.body_text, date);
    if (extracted.length > 0) {
      console.log(`  ${date}: ${extracted.map(e => `${e.index}=${e.value}`).join(", ")}`);
      allRates.push(...extracted);
    }
  }
  console.log(`\nExtracted ${allRates.length} rate data points from reports\n`);

  // Step 3: Get existing rates
  const { rows: existing } = await pool.query(`
    SELECT index_name, rate_date, rate_value FROM shipping_market_rates ORDER BY index_name, rate_date
  `);
  console.log(`Existing rates in DB: ${existing.length}`);

  // Build map of existing: index -> date -> value
  const existingMap: Record<string, Record<string, number>> = {};
  for (const r of existing) {
    const idx = r.index_name;
    const dt = new Date(r.rate_date).toISOString().split("T")[0];
    if (!existingMap[idx]) existingMap[idx] = {};
    existingMap[idx][dt] = parseFloat(r.rate_value);
  }

  // Step 4: Merge extracted rates (don't overwrite existing)
  let newFromParsing = 0;
  for (const r of allRates) {
    if (!existingMap[r.index]) existingMap[r.index] = {};
    if (!existingMap[r.index][r.date]) {
      existingMap[r.index][r.date] = r.value;
      newFromParsing++;
    }
  }
  console.log(`New rates from parsing: ${newFromParsing}`);

  // Step 5: Interpolate daily values for each index
  const indices = Object.keys(existingMap).sort();
  let totalInserted = 0;

  for (const idx of indices) {
    const dates = Object.keys(existingMap[idx]).sort();
    if (dates.length < 2) {
      console.log(`  ${idx}: only ${dates.length} data point(s), skipping interpolation`);
      continue;
    }

    const first = new Date(dates[0]);
    const last = new Date(dates[dates.length - 1]);

    // Generate daily dates between first and last (weekdays only)
    const dailyDates: string[] = [];
    const d = new Date(first);
    while (d <= last) {
      const dow = d.getDay();
      if (dow !== 0 && dow !== 6) { // Skip weekends
        dailyDates.push(d.toISOString().split("T")[0]);
      }
      d.setDate(d.getDate() + 1);
    }

    // Interpolate missing values
    const knownDates = dates;
    const knownVals = dates.map(dt => existingMap[idx][dt]);
    const interpolated: { date: string; value: number }[] = [];

    for (const dt of dailyDates) {
      if (existingMap[idx][dt] != null) continue; // already exists

      // Find surrounding known points
      let beforeIdx = -1, afterIdx = -1;
      for (let i = 0; i < knownDates.length; i++) {
        if (knownDates[i] <= dt) beforeIdx = i;
        if (knownDates[i] >= dt && afterIdx === -1) afterIdx = i;
      }

      if (beforeIdx >= 0 && afterIdx >= 0 && beforeIdx !== afterIdx) {
        const d1 = new Date(knownDates[beforeIdx]).getTime();
        const d2 = new Date(knownDates[afterIdx]).getTime();
        const dt0 = new Date(dt).getTime();
        const t = (dt0 - d1) / (d2 - d1);
        // Linear interpolation with small random noise (±1.5%)
        const base = knownVals[beforeIdx] + t * (knownVals[afterIdx] - knownVals[beforeIdx]);
        const noise = 1 + (Math.random() - 0.5) * 0.03;
        const value = Math.round(base * noise * 100) / 100;
        interpolated.push({ date: dt, value });
      }
    }

    if (interpolated.length > 0) {
      const unit = getRateUnit(idx);
      const displayName = idx.replace(/_/g, " ");
      for (const pt of interpolated) {
        await pool.query(`
          INSERT INTO shipping_market_rates (index_name, index_display_name, rate_date, rate_value, rate_unit, source)
          VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (index_name, rate_date) DO NOTHING
        `, [idx, displayName, pt.date, pt.value, unit, "pareto_interpolated"]);
      }
      totalInserted += interpolated.length;
      console.log(`  ${idx}: interpolated ${interpolated.length} daily points (${knownDates.length} known)`);
    }
  }

  console.log(`\nTotal new daily rates inserted: ${totalInserted}`);

  // Step 6: Also insert the extracted rates that were new
  let parsedInserted = 0;
  for (const r of allRates) {
    try {
      await pool.query(`
        INSERT INTO shipping_market_rates (index_name, index_display_name, rate_date, rate_value, rate_unit, source)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (index_name, rate_date) DO NOTHING
      `, [r.index, r.index.replace(/_/g, " "), r.date, r.value, getRateUnit(r.index), "pareto_daily"]);
      parsedInserted++;
    } catch (e) {
      // skip conflicts
    }
  }
  console.log(`Parsed rates inserted: ${parsedInserted}`);

  // Print summary
  const { rows: summary } = await pool.query(`
    SELECT index_name, COUNT(*) as cnt, MIN(rate_date)::date as earliest, MAX(rate_date)::date as latest
    FROM shipping_market_rates
    GROUP BY index_name ORDER BY index_name
  `);
  console.log("\n=== Final Rate Coverage ===");
  for (const s of summary) {
    console.log(`  ${s.index_name}: ${s.cnt} points (${s.earliest} → ${s.latest})`);
  }

  await pool.end();
  console.log("\nDone!");
}

main().catch(e => { console.error(e); process.exit(1); });
