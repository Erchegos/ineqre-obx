/**
 * Fish Pool / Euronext Salmondesk Report Fetcher
 *
 * Connects to Gmail IMAP, finds emails from Euronext Salmondesk,
 * downloads attached PDFs, parses salmon price data, and stores in DB.
 *
 * Two report types:
 *   1. SISALMON Index update — Weekly spot prices by weight class (NOK & EUR)
 *   2. Price Status Information — SISALMON index, export volumes, forward curve
 *
 * Sender: info.salmondesk@euronext.com
 *
 * Run: npx tsx scripts/fetch-fishpool-reports.ts
 * Options:
 *   --dry-run     Parse but don't insert to DB
 *   --weeks=12    Look back N weeks for emails (default: 12)
 *   --backfill    Fetch all available emails (no date limit)
 */

import { ImapFlow } from "imapflow";
import { Pool } from "pg";
import * as dotenv from "dotenv";
import * as path from "path";

// @ts-ignore — pdf-parse doesn't have types
import pdfParse from "pdf-parse";

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

// ── Config ──
const DRY_RUN = process.argv.includes("--dry-run");
const BACKFILL = process.argv.includes("--backfill");
const WEEKS_BACK = parseInt(
  process.argv.find((a) => a.startsWith("--weeks="))?.split("=")[1] ?? "12"
);

const SENDER = "info.salmondesk@euronext.com";

// ── DB setup ──
const dbUrl = (process.env.DATABASE_URL || "").trim().replace(/^["']|["']$/g, "");
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
const pool = new Pool({ connectionString: dbUrl });

// ── IMAP setup ──
function createImapClient(): ImapFlow {
  return new ImapFlow({
    host: process.env.EMAIL_IMAP_HOST || "imap.gmail.com",
    port: parseInt(process.env.EMAIL_IMAP_PORT || "993"),
    secure: true,
    auth: {
      user: process.env.EMAIL_USER || "",
      pass: process.env.EMAIL_PASSWORD || "",
    },
    logger: false,
  });
}

// ── Types ──
interface SpotData {
  year: number;
  week: number;
  reportDate: string; // YYYY-MM-DD
  currency: string; // NOK or EUR
  sisalmonAvg: number | null;
  sisalmonAvg1wChange: number | null;
  sisalmonAvg4wChange: number | null;
  sisalmonAvg12wChange: number | null;
  sisalmon36kg: number | null;
  sisalmon36kg1wChange: number | null;
  sisalmon36kg4wChange: number | null;
  sisalmon36kg12wChange: number | null;
  prices: Record<string, number | null>; // weight class → price
  volumes: Record<string, number | null>; // weight class → volume
  totalVolume: number | null;
  avgWeightKg: number | null;
}

interface ForwardData {
  reportDate: string;
  period: string;
  priceEurTonne: number | null;
  trend: string | null;
}

interface ExportVolumeData {
  year: number;
  week: number;
  exportThisYear: number | null;
  exportLastYear: number | null;
  sisalmoniEur: number | null;
}

// ── PDF Parsing: SISALMON Index Report ──
function parseSisalmonIndex(text: string, filename: string): SpotData | null {
  // Determine currency from filename: sis/nok_w9_... or sis/eur_w9_...
  const currencyMatch = filename.match(/sis[\/\\]?(nok|eur)/i);
  const currency = currencyMatch ? currencyMatch[1].toUpperCase() : "NOK";

  // Extract week number: "Week 9/2026"
  const weekMatch = text.match(/Week\s+(\d+)\/(\d{4})/i);
  if (!weekMatch) {
    console.log("  Could not find week/year in SISALMON PDF");
    return null;
  }
  const week = parseInt(weekMatch[1]);
  const year = parseInt(weekMatch[2]);

  // Extract report date: "03/03/2026" or "dd/mm/yyyy"
  const dateMatch = text.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  let reportDate = "";
  if (dateMatch) {
    reportDate = `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}`;
  } else {
    // Fallback: compute from week number
    const jan4 = new Date(year, 0, 4);
    const dayOfWeek = jan4.getDay() || 7;
    const weekStart = new Date(jan4.getTime() + (1 - dayOfWeek) * 86400000);
    const tuesday = new Date(weekStart.getTime() + ((week - 1) * 7 + 1) * 86400000);
    reportDate = tuesday.toISOString().slice(0, 10);
  }

  // Parse SISALMON AVG
  const sisalmonAvg = parseNumberFromText(text, /SISALMON\s+AVG[^\d]*?([\d]+[.,]\d+)/i);
  const sisalmon36kg = parseNumberFromText(text, /SISALMON\s+3-6kg[^\d]*?([\d]+[.,]\d+)/i);

  // Parse changes — look for patterns like "-4,2%" or "+1,9%"
  const avgChanges = parseChanges(text, "SISALMON AVG", "Salmon av. all sizes Index");
  const s36Changes = parseChanges(text, "SISALMON 3-6kg", "Salmon 3-6kg Index");

  // Parse weight class prices table
  // PDF text format: "1-2kg 64,16320,71%6,82-4,69" — columns concatenated
  // Pattern: {weight} {price},{dec}{volume}{pct}%{stdev}{change}
  const prices: Record<string, number | null> = {};
  const volumes: Record<string, number | null> = {};

  const weightClasses = [
    { regex: /1-2kg\s+([\d]+[.,]\d+)([\d\s]+?)[\d]+[.,]\d+%/i, key: "1_2kg" },
    { regex: /2-3kg\s+([\d]+[.,]\d+)([\d\s]+?)[\d]+[.,]\d+%/i, key: "2_3kg" },
    { regex: /3-4kg\s+([\d]+[.,]\d+)([\d\s]+?)[\d]+[.,]\d+%/i, key: "3_4kg" },
    { regex: /4-5kg\s+([\d]+[.,]\d+)([\d\s]+?)[\d]+[.,]\d+%/i, key: "4_5kg" },
    { regex: /5-6kg\s+([\d]+[.,]\d+)([\d\s]+?)[\d]+[.,]\d+%/i, key: "5_6kg" },
    { regex: /6-7kg\s+([\d]+[.,]\d+)([\d\s]+?)[\d]+[.,]\d+%/i, key: "6_7kg" },
    { regex: /7-8kg\s+([\d]+[.,]\d+)([\d\s]+?)[\d]+[.,]\d+%/i, key: "7_8kg" },
    { regex: /8-9kg\s+([\d]+[.,]\d+)([\d\s]+?)[\d]+[.,]\d+%/i, key: "8_9kg" },
    { regex: /9\+kg\s+([\d]+[.,]\d+)([\d\s]+?)[\d]+[.,]\d+%/i, key: "9plus_kg" },
  ];

  for (const wc of weightClasses) {
    const m = text.match(wc.regex);
    if (m) {
      prices[wc.key] = parseNorwegianNumber(m[1]);
      volumes[wc.key] = parseNorwegianNumber(m[2].replace(/\s/g, ""));
    }
  }

  // Total: "Total: 78,424 444100%" — the price and volume are glued together
  // Total volume is between the price decimal digits and "100%"
  let totalVolume: number | null = null;
  const totalMatch = text.match(/Total:\s+[\d]+[.,]\d\d([\d\s]+?)100%/i);
  if (totalMatch) {
    // Extract just the volume number (remove any leading price digits)
    const volStr = totalMatch[1].trim().replace(/\s/g, "");
    totalVolume = parseInt(volStr) || null;
  }

  // Av. weight: "Av. weight kg    5,06"
  const avgWeight = parseNumberFromText(text, /Av\.\s*weight\s*kg\s+([\d]+[.,]\d+)/i);

  console.log(`  Week ${week}/${year} ${currency}: SISALMON AVG=${sisalmonAvg}, 3-6kg=${sisalmon36kg}, Total Vol=${totalVolume}`);

  return {
    year,
    week,
    reportDate,
    currency,
    sisalmonAvg,
    sisalmonAvg1wChange: avgChanges.w1,
    sisalmonAvg4wChange: avgChanges.w4,
    sisalmonAvg12wChange: avgChanges.w12,
    sisalmon36kg,
    sisalmon36kg1wChange: s36Changes.w1,
    sisalmon36kg4wChange: s36Changes.w4,
    sisalmon36kg12wChange: s36Changes.w12,
    prices,
    volumes,
    totalVolume,
    avgWeightKg: avgWeight,
  };
}

// ── PDF Parsing: Price Status Report ──
function parsePriceStatus(text: string): {
  forwards: ForwardData[];
  exports: ExportVolumeData[];
  reportDate: string;
} | null {
  // Extract report date from header: "PRICE STATUS\n04.03.2026"
  const dateMatch = text.match(/PRICE\s+STATUS\s*[\n\r]+\s*(\d{2})\.(\d{2})\.(\d{4})/i);
  let reportDate = "";
  if (dateMatch) {
    reportDate = `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}`;
  } else {
    // Fallback
    reportDate = new Date().toISOString().slice(0, 10);
  }

  console.log(`  Price Status report date: ${reportDate}`);

  // Parse forward prices table
  // PDF text format: "Apr-268 450" or "Q2-268 183" (period glued to price)
  const forwards: ForwardData[] = [];
  const lines = text.split(/\n/);

  for (const line of lines) {
    // Match: "Apr-268 450", "Q2-268 183", "Q3+Q4-266 585", "Y20277 450"
    const periodMatch = line.match(
      /^((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)-\d{2}|Q[1-4]-\d{2}|Q[1-4]\+Q[1-4]-\d{2}|Y\d{4})([\d\s]+)/i
    );
    if (periodMatch) {
      const period = periodMatch[1];
      const priceStr = periodMatch[2].replace(/\s/g, "");
      const price = parseInt(priceStr);
      if (price > 0 && price < 100000) {
        forwards.push({
          reportDate,
          period,
          priceEurTonne: price,
          trend: null, // Arrow chars often lost in pdf-parse
        });
      }
    }
  }

  // Parse export volume table
  // PDF text format: "97,0217 85318 067" — week+SISALMONI+volumes concatenated
  // Pattern: {week}{sisalmoni_eur},{dec}{export_this_year}{export_last_year}
  const exports: ExportVolumeData[] = [];
  const year = parseInt(reportDate.slice(0, 4));

  // Look for lines matching: single/double digit week, then decimal number, then two 4-5 digit numbers
  const exportRegex = /(\d{1,2})([\d]+[,.][\d]+)([\d][\d\s]*\d{3})([\d][\d\s]*\d{3})/g;
  let em;
  while ((em = exportRegex.exec(text)) !== null) {
    const weekNum = parseInt(em[1]);
    const sisalmoni = parseNorwegianNumber(em[2]);
    const thisYearStr = em[3].replace(/\s/g, "");
    const lastYearStr = em[4].replace(/\s/g, "");
    const thisYear = parseInt(thisYearStr);
    const lastYear = parseInt(lastYearStr);

    if (weekNum > 0 && weekNum <= 53 && thisYear > 1000 && lastYear > 1000) {
      exports.push({
        year,
        week: weekNum,
        exportThisYear: thisYear,
        exportLastYear: lastYear,
        sisalmoniEur: sisalmoni,
      });
    }
  }

  console.log(`  Forward prices: ${forwards.length}, Export volumes: ${exports.length}`);

  if (forwards.length === 0 && exports.length === 0) return null;

  return { forwards, exports, reportDate };
}

// ── Helpers ──
function parseNorwegianNumber(s: string): number | null {
  if (!s) return null;
  // Norwegian format: 78,42 or 1 354
  const cleaned = s.trim().replace(/\s/g, "").replace(",", ".");
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

function parseNumberFromText(text: string, regex: RegExp): number | null {
  const m = text.match(regex);
  if (!m) return null;
  return parseNorwegianNumber(m[1]);
}

function parseChanges(
  text: string,
  _sectionHeader: string,
  _altHeader: string
): { w1: number | null; w4: number | null; w12: number | null } {
  // Look for change patterns near the header
  // "1 week change    -4,2%    -3,46"
  // We want the percentage values
  const changes: number[] = [];

  // Try to find three consecutive change lines
  const changeRegex = /(\d+)\s+week\s+change\s+([+-]?[\d]+[.,]\d+)%/gi;
  let m;
  while ((m = changeRegex.exec(text)) !== null) {
    const weeks = parseInt(m[1]);
    const val = parseNorwegianNumber(m[2]);
    if (weeks === 1 && changes.length === 0) changes.push(val ?? 0);
    else if (weeks === 4 && changes.length <= 1) {
      while (changes.length < 1) changes.push(0);
      changes.push(val ?? 0);
    } else if (weeks === 12 && changes.length <= 2) {
      while (changes.length < 2) changes.push(0);
      changes.push(val ?? 0);
    }
  }

  return {
    w1: changes[0] ?? null,
    w4: changes[1] ?? null,
    w12: changes[2] ?? null,
  };
}

// ── Attachment helpers ──
interface Attachment {
  filename: string;
  part: string;
  contentType: string;
}

function findAttachments(
  structure: any,
  attachments: Attachment[] = []
): Attachment[] {
  if (!structure) return attachments;

  if (
    (structure.disposition === "attachment" || structure.disposition === "inline") &&
    structure.parameters?.name
  ) {
    attachments.push({
      filename: structure.parameters.name,
      contentType: structure.type || "application/octet-stream",
      part: structure.part,
    });
  }

  if (structure.childNodes) {
    for (const child of structure.childNodes) {
      findAttachments(child, attachments);
    }
  }

  return attachments;
}

// ── DB Insert ──
async function upsertSpotData(data: SpotData): Promise<void> {
  if (DRY_RUN) {
    console.log(`  [DRY] Would upsert spot: week ${data.week}/${data.year} ${data.currency}`);
    return;
  }

  await pool.query(
    `INSERT INTO salmon_spot_weekly (
      year, week, report_date, currency,
      sisalmon_avg, sisalmon_avg_1w_change, sisalmon_avg_4w_change, sisalmon_avg_12w_change,
      sisalmon_3_6kg, sisalmon_3_6kg_1w_change, sisalmon_3_6kg_4w_change, sisalmon_3_6kg_12w_change,
      price_1_2kg, price_2_3kg, price_3_4kg, price_4_5kg, price_5_6kg,
      price_6_7kg, price_7_8kg, price_8_9kg, price_9plus_kg,
      vol_1_2kg, vol_2_3kg, vol_3_4kg, vol_4_5kg, vol_5_6kg,
      vol_6_7kg, vol_7_8kg, vol_8_9kg, vol_9plus_kg,
      total_volume, avg_weight_kg
    ) VALUES (
      $1, $2, $3, $4,
      $5, $6, $7, $8,
      $9, $10, $11, $12,
      $13, $14, $15, $16, $17,
      $18, $19, $20, $21,
      $22, $23, $24, $25, $26,
      $27, $28, $29, $30,
      $31, $32
    )
    ON CONFLICT (year, week, currency) DO UPDATE SET
      report_date = EXCLUDED.report_date,
      sisalmon_avg = COALESCE(EXCLUDED.sisalmon_avg, salmon_spot_weekly.sisalmon_avg),
      sisalmon_avg_1w_change = COALESCE(EXCLUDED.sisalmon_avg_1w_change, salmon_spot_weekly.sisalmon_avg_1w_change),
      sisalmon_avg_4w_change = COALESCE(EXCLUDED.sisalmon_avg_4w_change, salmon_spot_weekly.sisalmon_avg_4w_change),
      sisalmon_avg_12w_change = COALESCE(EXCLUDED.sisalmon_avg_12w_change, salmon_spot_weekly.sisalmon_avg_12w_change),
      sisalmon_3_6kg = COALESCE(EXCLUDED.sisalmon_3_6kg, salmon_spot_weekly.sisalmon_3_6kg),
      sisalmon_3_6kg_1w_change = COALESCE(EXCLUDED.sisalmon_3_6kg_1w_change, salmon_spot_weekly.sisalmon_3_6kg_1w_change),
      sisalmon_3_6kg_4w_change = COALESCE(EXCLUDED.sisalmon_3_6kg_4w_change, salmon_spot_weekly.sisalmon_3_6kg_4w_change),
      sisalmon_3_6kg_12w_change = COALESCE(EXCLUDED.sisalmon_3_6kg_12w_change, salmon_spot_weekly.sisalmon_3_6kg_12w_change),
      price_1_2kg = COALESCE(EXCLUDED.price_1_2kg, salmon_spot_weekly.price_1_2kg),
      price_2_3kg = COALESCE(EXCLUDED.price_2_3kg, salmon_spot_weekly.price_2_3kg),
      price_3_4kg = COALESCE(EXCLUDED.price_3_4kg, salmon_spot_weekly.price_3_4kg),
      price_4_5kg = COALESCE(EXCLUDED.price_4_5kg, salmon_spot_weekly.price_4_5kg),
      price_5_6kg = COALESCE(EXCLUDED.price_5_6kg, salmon_spot_weekly.price_5_6kg),
      price_6_7kg = COALESCE(EXCLUDED.price_6_7kg, salmon_spot_weekly.price_6_7kg),
      price_7_8kg = COALESCE(EXCLUDED.price_7_8kg, salmon_spot_weekly.price_7_8kg),
      price_8_9kg = COALESCE(EXCLUDED.price_8_9kg, salmon_spot_weekly.price_8_9kg),
      price_9plus_kg = COALESCE(EXCLUDED.price_9plus_kg, salmon_spot_weekly.price_9plus_kg),
      vol_1_2kg = COALESCE(EXCLUDED.vol_1_2kg, salmon_spot_weekly.vol_1_2kg),
      vol_2_3kg = COALESCE(EXCLUDED.vol_2_3kg, salmon_spot_weekly.vol_2_3kg),
      vol_3_4kg = COALESCE(EXCLUDED.vol_3_4kg, salmon_spot_weekly.vol_3_4kg),
      vol_4_5kg = COALESCE(EXCLUDED.vol_4_5kg, salmon_spot_weekly.vol_4_5kg),
      vol_5_6kg = COALESCE(EXCLUDED.vol_5_6kg, salmon_spot_weekly.vol_5_6kg),
      vol_6_7kg = COALESCE(EXCLUDED.vol_6_7kg, salmon_spot_weekly.vol_6_7kg),
      vol_7_8kg = COALESCE(EXCLUDED.vol_7_8kg, salmon_spot_weekly.vol_7_8kg),
      vol_8_9kg = COALESCE(EXCLUDED.vol_8_9kg, salmon_spot_weekly.vol_8_9kg),
      vol_9plus_kg = COALESCE(EXCLUDED.vol_9plus_kg, salmon_spot_weekly.vol_9plus_kg),
      total_volume = COALESCE(EXCLUDED.total_volume, salmon_spot_weekly.total_volume),
      avg_weight_kg = COALESCE(EXCLUDED.avg_weight_kg, salmon_spot_weekly.avg_weight_kg)`,
    [
      data.year, data.week, data.reportDate, data.currency,
      data.sisalmonAvg, data.sisalmonAvg1wChange, data.sisalmonAvg4wChange, data.sisalmonAvg12wChange,
      data.sisalmon36kg, data.sisalmon36kg1wChange, data.sisalmon36kg4wChange, data.sisalmon36kg12wChange,
      data.prices["1_2kg"], data.prices["2_3kg"], data.prices["3_4kg"],
      data.prices["4_5kg"], data.prices["5_6kg"],
      data.prices["6_7kg"], data.prices["7_8kg"],
      data.prices["8_9kg"], data.prices["9plus_kg"],
      data.volumes["1_2kg"], data.volumes["2_3kg"], data.volumes["3_4kg"],
      data.volumes["4_5kg"], data.volumes["5_6kg"],
      data.volumes["6_7kg"], data.volumes["7_8kg"],
      data.volumes["8_9kg"], data.volumes["9plus_kg"],
      data.totalVolume, data.avgWeightKg,
    ]
  );
}

async function upsertForwardPrices(forwards: ForwardData[]): Promise<number> {
  if (DRY_RUN) {
    console.log(`  [DRY] Would upsert ${forwards.length} forward prices`);
    return forwards.length;
  }

  let inserted = 0;
  for (const f of forwards) {
    const result = await pool.query(
      `INSERT INTO salmon_forward_prices (report_date, period, price_eur_tonne, trend)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (report_date, period) DO UPDATE SET
         price_eur_tonne = EXCLUDED.price_eur_tonne,
         trend = EXCLUDED.trend`,
      [f.reportDate, f.period, f.priceEurTonne, f.trend]
    );
    inserted += result.rowCount || 0;
  }
  return inserted;
}

async function upsertExportVolumes(exports: ExportVolumeData[]): Promise<number> {
  if (DRY_RUN) {
    console.log(`  [DRY] Would upsert ${exports.length} export volume rows`);
    return exports.length;
  }

  let inserted = 0;
  for (const e of exports) {
    const result = await pool.query(
      `INSERT INTO salmon_export_volumes (year, week, export_this_year, export_last_year, sisalmoni_eur)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (year, week) DO UPDATE SET
         export_this_year = EXCLUDED.export_this_year,
         export_last_year = EXCLUDED.export_last_year,
         sisalmoni_eur = EXCLUDED.sisalmoni_eur`,
      [e.year, e.week, e.exportThisYear, e.exportLastYear, e.sisalmoniEur]
    );
    inserted += result.rowCount || 0;
  }
  return inserted;
}

// Also update the commodity_prices SALMON entry with the latest Fish Pool spot
async function updateCommoditySalmonPrice(data: SpotData): Promise<void> {
  if (DRY_RUN || data.currency !== "NOK" || !data.sisalmonAvg) return;

  // Convert report_date to a Friday (commodity_prices uses Friday dates)
  const dt = new Date(data.reportDate);
  const dayOfWeek = dt.getDay();
  const daysToFriday = (5 - dayOfWeek + 7) % 7;
  const friday = new Date(dt.getTime() + daysToFriday * 86400000);
  const dateStr = friday.toISOString().slice(0, 10);

  await pool.query(
    `INSERT INTO commodity_prices (symbol, date, open, high, low, close, volume, currency, source)
     VALUES ($1, $2, $3, $3, $3, $3, NULL, 'NOK', 'fishpool')
     ON CONFLICT (symbol, date) DO UPDATE SET
       close = EXCLUDED.close,
       source = 'fishpool'`,
    ["SALMON", dateStr, data.sisalmonAvg]
  );
  console.log(`  Updated commodity_prices SALMON ${dateStr} = ${data.sisalmonAvg} NOK/kg (Fish Pool)`);
}

// ── Extract attachment from raw MIME ──
function extractAttachmentFromMime(rawEmail: string, filename: string): Buffer | null {
  // Find the MIME boundary
  const boundaryMatch = rawEmail.match(/boundary="?([^"\s\r\n;]+)"?/i);
  if (!boundaryMatch) return null;

  const boundary = boundaryMatch[1];
  const parts = rawEmail.split(new RegExp("--" + boundary.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

  // Look for the part with matching filename
  for (const part of parts) {
    // Check if this part has the target filename
    const hasFilename =
      part.includes(filename) ||
      part.includes(filename.replace(/\//g, "_")) ||
      part.includes(encodeURIComponent(filename));

    if (!hasFilename) continue;

    // Check if it's base64 encoded
    if (!/content-transfer-encoding:\s*base64/i.test(part)) continue;

    // Extract the base64 data after the double newline (header/body separator)
    const headerBodySplit = part.split(/\r?\n\r?\n/);
    if (headerBodySplit.length < 2) continue;

    // The body is everything after the first blank line
    const base64Data = headerBodySplit.slice(1).join("\n").replace(/[\r\n\s]/g, "");
    if (base64Data.length < 50) continue;

    try {
      return Buffer.from(base64Data, "base64");
    } catch {
      continue;
    }
  }

  // Try nested boundaries (multipart within multipart)
  const allBoundaries = rawEmail.match(/boundary="?([^"\s\r\n;]+)"?/gi) || [];
  for (const bMatch of allBoundaries) {
    const b = bMatch.replace(/boundary="?([^"\s\r\n;]+)"?/i, "$1");
    if (b === boundary) continue;

    const subParts = rawEmail.split(new RegExp("--" + b.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    for (const part of subParts) {
      if (!part.includes(filename) && !part.includes(filename.replace(/\//g, "_"))) continue;
      if (!/content-transfer-encoding:\s*base64/i.test(part)) continue;

      const headerBodySplit = part.split(/\r?\n\r?\n/);
      if (headerBodySplit.length < 2) continue;

      const base64Data = headerBodySplit.slice(1).join("\n").replace(/[\r\n\s]/g, "");
      if (base64Data.length < 50) continue;

      try {
        return Buffer.from(base64Data, "base64");
      } catch {
        continue;
      }
    }
  }

  return null;
}

// ── Main ──
async function main() {
  console.log("=== Fish Pool / Euronext Salmondesk Report Fetcher ===\n");

  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASSWORD) {
    console.error("ERROR: EMAIL_USER and EMAIL_PASSWORD env vars required.");
    console.error("Set in .env or apps/web/.env.local");
    process.exit(1);
  }

  const imap = createImapClient();
  console.log(`Connecting to IMAP as ${process.env.EMAIL_USER}...`);
  await imap.connect();
  await imap.mailboxOpen("INBOX");
  console.log("Connected.\n");

  // Calculate since date
  const sinceDate = BACKFILL
    ? new Date("2024-01-01")
    : new Date(Date.now() - WEEKS_BACK * 7 * 86400000);

  console.log(`Searching for emails from ${SENDER} since ${sinceDate.toISOString().slice(0, 10)}...`);

  const messages = imap.fetch(
    {
      since: sinceDate,
      from: SENDER,
    },
    {
      envelope: true,
      bodyStructure: true,
      source: true, // Fetch raw email source for reliable attachment extraction
      uid: true,
    }
  );

  let emailCount = 0;
  let spotCount = 0;
  let forwardCount = 0;
  let exportCount = 0;

  for await (const message of messages) {
    emailCount++;
    const subject = message.envelope?.subject || "(no subject)";
    const date = message.envelope?.date;
    console.log(`\n[${emailCount}] ${subject}`);
    console.log(`  Date: ${date}`);

    // Find PDF attachments from bodyStructure
    const attachments = findAttachments(message.bodyStructure);
    const pdfAttachments = attachments.filter(
      (a) =>
        a.filename.toLowerCase().endsWith(".pdf") ||
        a.contentType === "application/pdf"
    );

    if (pdfAttachments.length === 0) {
      console.log("  No PDF attachments found, skipping.");
      continue;
    }

    console.log(`  Found ${pdfAttachments.length} PDF(s): ${pdfAttachments.map((a) => a.filename).join(", ")}`);

    // Extract attachments from raw MIME source
    const rawSource = message.source?.toString("utf-8") || "";
    if (!rawSource) {
      console.log("  No raw source available, skipping.");
      continue;
    }

    for (const att of pdfAttachments) {
      try {
        // Extract base64 PDF from raw MIME source
        const pdfBuffer = extractAttachmentFromMime(rawSource, att.filename);

        if (!pdfBuffer || pdfBuffer.length < 100) {
          console.log(`  Skipping ${att.filename} — could not extract or too small`);
          continue;
        }
        console.log(`  Extracted ${att.filename} (${pdfBuffer.length} bytes)`);

        // Parse PDF text
        const pdf = await pdfParse(pdfBuffer);
        const text = pdf.text;

        // Determine report type from filename and content
        const fnLower = att.filename.toLowerCase();
        const isSisalmonIndex =
          fnLower.includes("sis") &&
          (fnLower.includes("nok") || fnLower.includes("eur"));
        const isPriceStatus = fnLower.includes("pricestatus") || fnLower.includes("price_status");

        if (isSisalmonIndex) {
          console.log(`  Parsing SISALMON Index: ${att.filename}`);
          const spotData = parseSisalmonIndex(text, att.filename);
          if (spotData) {
            await upsertSpotData(spotData);
            await updateCommoditySalmonPrice(spotData);
            spotCount++;
          }
        } else if (isPriceStatus || text.includes("PRICE STATUS")) {
          console.log(`  Parsing Price Status: ${att.filename}`);
          const result = parsePriceStatus(text);
          if (result) {
            const fwd = await upsertForwardPrices(result.forwards);
            const exp = await upsertExportVolumes(result.exports);
            forwardCount += fwd;
            exportCount += exp;
          }
        } else {
          console.log(`  Unknown report type: ${att.filename}, trying content-based detection...`);
          // Try both parsers
          if (text.includes("SISALMON") && text.includes("Weight")) {
            const spotData = parseSisalmonIndex(text, att.filename);
            if (spotData) {
              await upsertSpotData(spotData);
              await updateCommoditySalmonPrice(spotData);
              spotCount++;
            }
          } else if (text.includes("Forward prices") || text.includes("Fresh HOG export")) {
            const result = parsePriceStatus(text);
            if (result) {
              const fwd = await upsertForwardPrices(result.forwards);
              const exp = await upsertExportVolumes(result.exports);
              forwardCount += fwd;
              exportCount += exp;
            }
          } else {
            console.log(`  Could not identify report type, skipping.`);
          }
        }
      } catch (err: any) {
        console.error(`  Error processing ${att.filename}:`, err.message);
      }
    }
  }

  await imap.logout();

  console.log("\n=== Summary ===");
  console.log(`  Emails processed: ${emailCount}`);
  console.log(`  Spot price reports: ${spotCount}`);
  console.log(`  Forward prices upserted: ${forwardCount}`);
  console.log(`  Export volume rows upserted: ${exportCount}`);

  if (!DRY_RUN) {
    // Print latest data
    const latest = await pool.query(
      `SELECT year, week, currency, sisalmon_avg, sisalmon_3_6kg, total_volume
       FROM salmon_spot_weekly ORDER BY year DESC, week DESC LIMIT 5`
    );
    if (latest.rows.length > 0) {
      console.log("\nLatest spot data in DB:");
      for (const r of latest.rows) {
        console.log(
          `  W${r.week}/${r.year} ${r.currency}: AVG=${r.sisalmon_avg}, 3-6kg=${r.sisalmon_3_6kg}, Vol=${r.total_volume}`
        );
      }
    }

    const fwdLatest = await pool.query(
      `SELECT report_date, period, price_eur_tonne, trend
       FROM salmon_forward_prices ORDER BY report_date DESC, period LIMIT 10`
    );
    if (fwdLatest.rows.length > 0) {
      console.log("\nLatest forward prices:");
      for (const r of fwdLatest.rows) {
        console.log(`  ${r.report_date} | ${r.period}: EUR ${r.price_eur_tonne}/t ${r.trend || ""}`);
      }
    }
  }

  await pool.end();
  console.log("\nDone!");
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
