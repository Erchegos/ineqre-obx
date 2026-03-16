/**
 * Parse Pareto Shipping Daily PDF and insert rates into DB
 *
 * Finds "Shipping Daily" reports from research_documents,
 * downloads the PDF from FactSet URL in body_text,
 * extracts rates via pdftotext, and inserts into shipping_market_rates.
 *
 * Usage:
 *   npx tsx scripts/parse-shipping-daily.ts           # Parse latest
 *   npx tsx scripts/parse-shipping-daily.ts --dry-run  # Parse but don't insert
 *   npx tsx scripts/parse-shipping-daily.ts --all      # Parse all unprocessed shipping dailies
 */

import { Pool } from "pg";
import * as dotenv from "dotenv";
import * as path from "path";
import { execSync } from "child_process";
import * as fs from "fs";
import * as os from "os";

dotenv.config({ path: path.resolve(__dirname, "../.env.local") });
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

/* ─── DB ──────────────────────────────────────────────────────── */

let connectionString = (process.env.DATABASE_URL ?? "").trim().replace(/^["']|["']$/g, "");
connectionString = connectionString.replace(/[?&]sslmode=\w+/g, "");

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
});

/* ─── Rate extraction ──────────────────────────────────────────── */

interface ParsedRate {
  index_name: string;
  index_display_name: string;
  rate_value: number;
  rate_unit: string;
}

/**
 * Parse dollar amounts like "$481 100", "$188,300", "$83.1", "$2.97"
 */
function parseDollarAmount(text: string): number | null {
  // Match $481 100 or $83.1 or $2.97 — stop at percent signs or letters
  // Allow digits, spaces, commas, one optional decimal point
  const match = text.match(/\$\s*([\d]+(?:[\s,]\d{3})*(?:\.\d+)?)/);
  if (!match) return null;
  const cleaned = match[1].replace(/[\s,]/g, "");
  const val = parseFloat(cleaned);
  return isNaN(val) ? null : val;
}

function parseNumber(text: string): number | null {
  const cleaned = text.replace(/[\s,]/g, "");
  const val = parseFloat(cleaned);
  return isNaN(val) ? null : val;
}

/**
 * Extract rates from pdftotext output.
 * pdftotext puts labels and values on separate lines, so we scan for
 * known labels and grab dollar values from nearby subsequent lines.
 */
function extractRates(text: string): ParsedRate[] {
  const rates: ParsedRate[] = [];
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);

  /** Find the first dollar amount in lines[start..start+maxLook] */
  function findDollar(start: number, maxLook = 6, minVal = 1000, maxVal = Infinity): number | null {
    for (let i = start; i < Math.min(start + maxLook, lines.length); i++) {
      const val = parseDollarAmount(lines[i]);
      if (val !== null && val >= minVal && val <= maxVal) return val;
    }
    return null;
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // ── TANKER SPOT RATES ──
    // In layout mode, labels may share a line with narrative text.
    // Only match if a $ value is also on the same line (data row, not narrative).
    if (/VLCC\s*\(TD3.C\)/i.test(line) && /\$/.test(line)) {
      const val = parseDollarAmount(line.slice(line.search(/VLCC/i)));
      if (val && val > 10000) rates.push({ index_name: "VLCC_TD3C_TCE", index_display_name: "VLCC MEG-China TCE", rate_value: val, rate_unit: "usd_per_day" });
    }
    if (/Suezmax\s*\(TD20\)/i.test(line) && /\$/.test(line)) {
      const val = parseDollarAmount(line.slice(line.search(/Suezmax/i)));
      if (val && val > 10000) rates.push({ index_name: "SUEZMAX_TD20_TCE", index_display_name: "Suezmax WAF-UKC TCE", rate_value: val, rate_unit: "usd_per_day" });
    }
    if (/\bAframax\b/i.test(line) && /\$\d/.test(line) && !/aframaxes/i.test(line.slice(0, line.search(/Aframax\b.*\$/i) || 999))) {
      // Find the $ value after "Aframax" label (not in narrative)
      const afterLabel = line.slice(line.search(/\bAframax\b/i));
      const val = parseDollarAmount(afterLabel);
      if (val && val > 10000) rates.push({ index_name: "AFRAMAX_TCE", index_display_name: "Aframax TCE", rate_value: val, rate_unit: "usd_per_day" });
    }
    if (/\bLR2\b/.test(line)) {
      const val = parseDollarAmount(line.slice(line.search(/\bLR2\b/))) ?? findDollar(i + 1, 4, 10000);
      if (val && val > 10000) rates.push({ index_name: "LR2_TCE", index_display_name: "LR2 Product Tanker TCE", rate_value: val, rate_unit: "usd_per_day" });
    }
    // MR line: must have "$" and "MR" as a table label (followed by whitespace + " or USD)
    if (/\bMR\b\s{5,}/i.test(line) && /\$/.test(line) && !/MPC|Maersk|MRs/i.test(line)) {
      const afterLabel = line.slice(line.search(/\bMR\b/i));
      const val = parseDollarAmount(afterLabel);
      if (val && val > 5000) rates.push({ index_name: "MR_TC2_TCE", index_display_name: "MR TC2 37kt UKC-USAC", rate_value: val, rate_unit: "usd_per_day" });
    }

    // ── DRYBULK INDICES ──
    // BDI: Baltic Dry Index — all-time high 11,440 (Nov 2008); any value above 12,000 is a parse artifact
    if (/Baltic Dry Index/i.test(line) && !/Capesize|Panamax|Supramax|Handysize/i.test(line)) {
      const afterLabel = line.slice(line.search(/Baltic Dry Index/i) + 17);
      const numMatch = afterLabel.match(/([\d][\d\s,]*)/);
      if (numMatch) {
        const val = parseNumber(numMatch[1]);
        if (val && val > 100 && val < 12000) {
          rates.push({ index_name: "BDI", index_display_name: "Baltic Dry Index", rate_value: val, rate_unit: "index_points" });
        }
      }
    }
    // BCI: Baltic Capesize Index — separate from BDI; can range 500-80,000 in index points
    if (/Baltic Capesize Index/i.test(line)) {
      const afterLabel = line.slice(line.search(/Baltic Capesize Index/i) + 22);
      const numMatch = afterLabel.match(/([\d][\d\s,]*)/);
      if (numMatch) {
        const val = parseNumber(numMatch[1]);
        if (val && val > 200 && val < 80000) {
          rates.push({ index_name: "BCI", index_display_name: "Baltic Capesize Index", rate_value: val, rate_unit: "index_points" });
        }
      }
    }
    // BDTI: Baltic Dirty Tanker Index — typically 500-2,500 range
    if (/Baltic Dirty Tanker Index/i.test(line)) {
      const afterLabel = line.slice(line.search(/Baltic Dirty Tanker Index/i) + 26);
      const numMatch = afterLabel.match(/([\d][\d\s,]*)/);
      if (numMatch) {
        const val = parseNumber(numMatch[1]);
        if (val && val > 50 && val < 5000) {
          rates.push({ index_name: "BDTI", index_display_name: "Baltic Dirty Tanker Index", rate_value: val, rate_unit: "index_points" });
        }
      }
    }
    // BCTI: Baltic Clean Tanker Index — typically 500-3,000 range
    if (/Baltic Clean Tanker Index/i.test(line)) {
      const afterLabel = line.slice(line.search(/Baltic Clean Tanker Index/i) + 26);
      const numMatch = afterLabel.match(/([\d][\d\s,]*)/);
      if (numMatch) {
        const val = parseNumber(numMatch[1]);
        if (val && val > 50 && val < 6000) {
          rates.push({ index_name: "BCTI", index_display_name: "Baltic Clean Tanker Index", rate_value: val, rate_unit: "index_points" });
        }
      }
    }
    if (/\bCapesize\b/i.test(line) && /\$/.test(line)) {
      const val = parseDollarAmount(line.slice(line.search(/\bCapesize\b/i)));
      if (val && val > 1000) rates.push({ index_name: "CAPESIZE_5TC", index_display_name: "Capesize 5TC Average", rate_value: val, rate_unit: "usd_per_day" });
    }
    if (/\bPanamax\b/i.test(line) && !/Supra/i.test(line)) {
      const val = parseDollarAmount(line.slice(line.search(/\bPanamax\b/i))) ?? findDollar(i + 1, 4, 1000);
      if (val && val > 1000) rates.push({ index_name: "PANAMAX_TCE", index_display_name: "Panamax TCE", rate_value: val, rate_unit: "usd_per_day" });
    }
    if (/\bUltramax\b/i.test(line)) {
      const val = parseDollarAmount(line.slice(line.search(/\bUltramax\b/i))) ?? findDollar(i + 1, 4, 1000);
      if (val && val > 1000) rates.push({ index_name: "ULTRAMAX_TCE", index_display_name: "Ultramax TCE", rate_value: val, rate_unit: "usd_per_day" });
    }

    // ── LPG ──
    if (/VLGC.*Middle East/i.test(line) || /VLGC:\s*Middle/i.test(line)) {
      const afterLabel = line.slice(line.search(/VLGC/i));
      const val = parseDollarAmount(afterLabel) ?? findDollar(i + 1, 4, 5000);
      if (val && val > 5000) rates.push({ index_name: "VLGC_ME_ASIA", index_display_name: "VLGC Middle East - Asia", rate_value: val, rate_unit: "usd_per_day" });
    }
    if (/VLGC.*USG(oM|ulf)/i.test(line) || /VLGC:\s*USG/i.test(line)) {
      const afterLabel = line.slice(line.search(/VLGC/i));
      const val = parseDollarAmount(afterLabel) ?? findDollar(i + 1, 4, 5000);
      if (val && val > 5000) rates.push({ index_name: "VLGC_USGOM_ASIA", index_display_name: "VLGC USGoM - Asia", rate_value: val, rate_unit: "usd_per_day" });
    }

    // ── LNG ──
    if (/LNG Carrier spot/i.test(line) || /LNG.*spot rate/i.test(line)) {
      const afterLabel = line.slice(line.search(/LNG/i));
      const val = parseDollarAmount(afterLabel) ?? findDollar(i + 1, 4, 1000);
      if (val && val > 1000) rates.push({ index_name: "LNG_SPOT_TFDE", index_display_name: "LNG Carrier Spot (TFDE)", rate_value: val, rate_unit: "usd_per_day" });
    }

    // ── COMMODITIES ──
    if (/Brent\s*(oil)?\s*price/i.test(line) && /\$/.test(line)) {
      const afterLabel = line.slice(line.search(/Brent/i));
      const val = parseDollarAmount(afterLabel);
      if (val && val > 10 && val < 500) rates.push({ index_name: "BRENT", index_display_name: "Brent Crude Oil", rate_value: val, rate_unit: "usd_per_bbl" });
    }
    if (/WTI\s*(oil)?\s*price/i.test(line) && /\$/.test(line)) {
      const afterLabel = line.slice(line.search(/WTI/i));
      const val = parseDollarAmount(afterLabel);
      if (val && val > 10 && val < 500) rates.push({ index_name: "WTI", index_display_name: "WTI Crude Oil", rate_value: val, rate_unit: "usd_per_bbl" });
    }
    if (/Iron ore import price/i.test(line) && /\$/.test(line)) {
      const afterLabel = line.slice(line.search(/Iron ore/i));
      const val = parseDollarAmount(afterLabel);
      if (val && val > 10 && val < 1000) rates.push({ index_name: "IRON_ORE", index_display_name: "Iron Ore Import Price (China)", rate_value: val, rate_unit: "usd_per_ton" });
    }
    if (/Henry Hub/i.test(line) && /\$/.test(line)) {
      const afterLabel = line.slice(line.search(/Henry Hub/i));
      const val = parseDollarAmount(afterLabel);
      if (val && val > 0.5 && val < 100) rates.push({ index_name: "HENRY_HUB", index_display_name: "Henry Hub Natural Gas", rate_value: val, rate_unit: "usd_per_mmbtu" });
    }
    // ── BUNKER PRICES ──
    if (/VLSFO/i.test(line) && /Singapore|Rotterdam|Fujairah/i.test(line) && /\$/.test(line)) {
      const portMatch = line.match(/Singapore|Rotterdam|Fujairah/i);
      const port = portMatch ? portMatch[0] : "Singapore";
      const val = parseDollarAmount(line.slice(line.search(/VLSFO/i)));
      if (val && val > 200 && val < 1500) {
        rates.push({ index_name: `VLSFO_${port.toUpperCase()}`, index_display_name: `VLSFO Bunker Price ${port}`, rate_value: val, rate_unit: "usd_per_tonne" });
      }
    }

    if (/TTF\b/i.test(line) && /nat.*gas|EU/i.test(line) && /\$/.test(line)) {
      const afterLabel = line.slice(line.search(/TTF/i));
      const val = parseDollarAmount(afterLabel);
      if (val && val > 0.5 && val < 200) rates.push({ index_name: "TTF", index_display_name: "TTF European Natural Gas", rate_value: val, rate_unit: "usd_per_mmbtu" });
    }
  }

  // Deduplicate — keep first occurrence of each index_name
  const seen = new Set<string>();
  return rates.filter(r => {
    if (seen.has(r.index_name)) return false;
    seen.add(r.index_name);
    return true;
  });
}

/**
 * Extract report date from "Shipping Daily\n5 MAR 2026"
 */
function extractReportDate(text: string): string | null {
  const match = text.match(/Shipping Daily\s*\n?\s*(\d{1,2}\s+\w+\s+\d{4})/i);
  if (!match) return null;
  const d = new Date(match[1]);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

/* ─── Main ────────────────────────────────────────────────────── */

async function processReport(docId: string, subject: string, bodyText: string, dryRun: boolean): Promise<number> {
  const urlMatch = bodyText.match(/(https:\/\/parp\.hosting\.factset\.com\S+)/);
  if (!urlMatch) {
    console.log(`  No FactSet URL found in body text, skipping`);
    return 0;
  }

  const pdfUrl = urlMatch[1];
  const tmpPdf = path.join(os.tmpdir(), `shipping-daily-${docId.slice(0, 8)}.pdf`);
  const tmpTxt = tmpPdf.replace(".pdf", ".txt");

  try {
    execSync(`curl -sL -o "${tmpPdf}" "${pdfUrl}"`, { timeout: 30000 });
    const stat = fs.statSync(tmpPdf);
    if (stat.size < 1000) {
      console.log(`  PDF too small (${stat.size} bytes), skipping`);
      return 0;
    }

    execSync(`pdftotext -layout "${tmpPdf}" "${tmpTxt}"`, { timeout: 10000 });
    const text = fs.readFileSync(tmpTxt, "utf-8");

    const reportDate = extractReportDate(text);
    if (!reportDate) {
      console.log(`  Could not extract report date from PDF`);
      return 0;
    }

    const rates = extractRates(text);
    console.log(`  Date: ${reportDate} | Rates found: ${rates.length}`);

    if (rates.length === 0) {
      console.log(`  WARNING: No rates extracted — check PDF format`);
      return 0;
    }

    for (const r of rates) {
      const formatted = r.rate_unit === "usd_per_day"
        ? `$${r.rate_value.toLocaleString("en-US")}/day`
        : r.rate_unit === "index_points"
          ? r.rate_value.toLocaleString("en-US")
          : `$${r.rate_value}`;
      console.log(`    ${r.index_name.padEnd(20)} ${formatted}`);
    }

    if (dryRun) {
      console.log(`  [DRY RUN] Would insert ${rates.length} rates for ${reportDate}`);
      return rates.length;
    }

    let inserted = 0;
    let updated = 0;
    for (const r of rates) {
      const result = await pool.query(`
        INSERT INTO shipping_market_rates (index_name, index_display_name, rate_value, rate_unit, rate_date, source)
        VALUES ($1, $2, $3, $4, $5, 'pareto_daily')
        ON CONFLICT (index_name, rate_date) DO UPDATE SET
          rate_value = EXCLUDED.rate_value,
          index_display_name = EXCLUDED.index_display_name,
          source = EXCLUDED.source
        RETURNING (xmax = 0) AS is_insert
      `, [r.index_name, r.index_display_name, r.rate_value, r.rate_unit, reportDate]);

      if (result.rows[0]?.is_insert) inserted++;
      else updated++;
    }

    console.log(`  Inserted: ${inserted}, Updated: ${updated}`);
    return inserted + updated;
  } finally {
    try { fs.unlinkSync(tmpPdf); } catch {}
    try { fs.unlinkSync(tmpTxt); } catch {}
  }
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const processAll = args.includes("--all");

  try {
    const query = processAll
      ? `SELECT id, subject, body_text, received_date FROM research_documents
         WHERE LOWER(subject) LIKE '%shipping daily%' AND has_attachments = true
         ORDER BY received_date DESC`
      : `SELECT id, subject, body_text, received_date FROM research_documents
         WHERE LOWER(subject) LIKE '%shipping daily%' AND has_attachments = true
         ORDER BY received_date DESC LIMIT 1`;

    const result = await pool.query(query);

    if (result.rows.length === 0) {
      console.log("No Shipping Daily reports found in research_documents");
      return;
    }

    console.log(`Found ${result.rows.length} Shipping Daily report(s)\n`);

    let totalRates = 0;
    for (const row of result.rows) {
      const dateStr = row.received_date ? new Date(row.received_date).toISOString().slice(0, 10) : "unknown";
      console.log(`Processing: ${row.subject} (${dateStr})`);
      const count = await processReport(row.id, row.subject, row.body_text || "", dryRun);
      totalRates += count;
      console.log();
    }

    console.log(`Total rates processed: ${totalRates}`);
  } catch (err) {
    console.error("Error:", err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
