/**
 * DNB Markets Research Scraper
 *
 * Fetches macro, FI & currencies research reports from DNB Markets.
 * Reports are publicly accessible at:
 *   https://www.dnb.no/seg-fundamental/fundamentalweb/getreport.aspx?file=MRP_XXXXXX.pdf
 *
 * No authentication required for individual PDFs.
 * IDs are sequential (MRP_XXXXXX) with gaps — we scan a range and download valid hits.
 *
 * Filters:
 *   - Only 2026 reports (CreationDate >= 2026-01-01) unless --all-dates
 *   - Only Norway/Nordic-relevant reports (keyword filter on PDF text)
 *   - Dedup by source_url
 *
 * Usage:
 *   npx tsx scripts/fetch-dnb-markets-research.ts              # Scan & import new reports
 *   npx tsx scripts/fetch-dnb-markets-research.ts --dry-run    # Scan only, no DB writes
 *   npx tsx scripts/fetch-dnb-markets-research.ts --all-macro  # Include all macro (no keyword filter)
 *   npx tsx scripts/fetch-dnb-markets-research.ts --scan-back  # Scan further back (older IDs)
 */

import { Pool } from "pg";
import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import * as path from "path";
import { execSync } from "child_process";
import * as fs from "fs";
import * as os from "os";

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

/* ─── Config ─────────────────────────────────────────────────── */

const BASE_URL =
  "https://www.dnb.no/seg-fundamental/fundamentalweb/getreport.aspx";

/** Known valid ID range for 2026 reports */
const DEFAULT_START_ID = 260800;
const DEFAULT_END_ID = 261700;

/** Extra scan range when --scan-back is used */
const SCAN_BACK_START = 260000;

/** Delay between HTTP request batches (ms) */
const REQUEST_DELAY = 500;

/** Concurrent requests per batch (keep low to avoid Akamai rate limiting) */
const SCAN_CONCURRENCY = 3;

/** Norway/Nordic relevance keywords (case-insensitive) */
const RELEVANCE_KEYWORDS = [
  // Norwegian specific
  "norway",
  "norwegian",
  "norges bank",
  "oslo",
  "oslo børs",
  "nok ",
  "morgenrapport",
  "norsk",
  "norge",
  "boligpriser",
  "nordea",
  // Nordic
  "nordic",
  "scandinav",
  "sweden",
  "denmark",
  "finland",
  // Oil & energy (very relevant to OSE)
  "brent",
  "crude oil",
  "oil price",
  "oljepr",
  "statoil",
  "equinor",
  // Week ahead / general
  "week ahead",
  "carnegie week",
  // OSE-relevant macro
  "salmon",
  "seafood",
  "shipping",
  "offshore",
];

/* ─── DB & Storage ──────────────────────────────────────────── */

let connectionString = (process.env.DATABASE_URL ?? "")
  .trim()
  .replace(/^["']|["']$/g, "");
connectionString = connectionString.replace(/[?&]sslmode=\w+/g, "");

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
});

const supabase = createClient(
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""
);

/* ─── CLI Flags ──────────────────────────────────────────────── */

const DRY_RUN = process.argv.includes("--dry-run");
const ALL_MACRO = process.argv.includes("--all-macro");
const SCAN_BACK = process.argv.includes("--scan-back");

const SINCE_DATE = process.argv.includes("--all-dates")
  ? "20200101"
  : "20260101";

/* ─── HTTP Helpers ───────────────────────────────────────────── */

/** Cookie jar file for Akamai session management */
const COOKIE_JAR = path.join(os.tmpdir(), "dnb-markets-cookies.txt");

/**
 * Download PDF using curl.
 * Akamai blocks Node.js https module but allows curl with proper headers.
 * Uses a cookie jar for session persistence across requests.
 * Returns the PDF buffer or null if invalid/missing.
 */
function downloadPdfSync(url: string): Buffer | null {
  try {
    const result = execSync(
      `curl -s -L ` +
        `-H "Referer: https://www.dnb.no/sparing/aksjehandel/analysis" ` +
        `-H "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" ` +
        `-b "${COOKIE_JAR}" -c "${COOKIE_JAR}" ` +
        `"${url}"`,
      { timeout: 20000, maxBuffer: 10 * 1024 * 1024 }
    );
    if (result.length > 1000 && result.slice(0, 5).toString() === "%PDF-") {
      return result;
    }
    return null;
  } catch {
    return null;
  }
}

/** Initialize cookie jar by visiting the analysis page */
function initCookieJar(): void {
  try {
    execSync(
      `curl -s -o /dev/null ` +
        `-H "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" ` +
        `-c "${COOKIE_JAR}" ` +
        `"https://www.dnb.no/sparing/aksjehandel/analysis"`,
      { timeout: 15000 }
    );
    console.log("  Cookie jar initialized");
  } catch {
    console.log("  Warning: Could not initialize cookie jar");
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/* ─── PDF Text Extraction ────────────────────────────────────── */

interface PdfMeta {
  creationDate: string; // YYYYMMDD
  author: string;
  title: string;
  reportType: string;
  summary: string;
  fullText: string;
  pages: number;
}

function extractPdfMeta(pdfBuf: Buffer): PdfMeta | null {
  // Write to temp file, extract text with pdftotext
  const tmpFile = path.join(os.tmpdir(), `dnb_tmp_${Date.now()}.pdf`);
  try {
    fs.writeFileSync(tmpFile, pdfBuf);

    // Extract text with pdftotext
    let fullText = "";
    try {
      fullText = execSync(`pdftotext "${tmpFile}" - 2>/dev/null`, {
        encoding: "utf-8",
        timeout: 10000,
      });
    } catch {
      // pdftotext might not be available or fails
      fullText = "";
    }

    // Get page count from pdftotext
    let pages = 0;
    try {
      const pdfinfo = execSync(`pdfinfo "${tmpFile}" 2>/dev/null`, {
        encoding: "utf-8",
        timeout: 5000,
      });
      const pageMatch = pdfinfo.match(/Pages:\s+(\d+)/);
      if (pageMatch) pages = parseInt(pageMatch[1]);
    } catch {
      pages = 0;
    }

    // Extract metadata from raw PDF binary
    const rawText = pdfBuf.toString("latin1");
    const metaDateMatch = rawText.match(/\/CreationDate\s*\(D:(\d{8})/);
    const authorMatch = rawText.match(/\/Author\s*\(([^)]+)\)/);

    const author = authorMatch ? authorMatch[1] : "";

    // Parse date from PDF text content (more reliable than metadata)
    // Matches: "27 January 2026", "04 February 2026", "February 2026"
    const MONTHS: Record<string, string> = {
      january: "01", february: "02", march: "03", april: "04",
      may: "05", june: "06", july: "07", august: "08",
      september: "09", october: "10", november: "11", december: "12",
    };
    let creationDate = "";
    // Try "DD Month YYYY" in first 15 lines
    for (const line of lines.slice(0, 15)) {
      const m = line.match(/(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})/i);
      if (m) {
        const day = m[1].padStart(2, "0");
        const month = MONTHS[m[2].toLowerCase()];
        creationDate = `${m[3]}${month}${day}`;
        break;
      }
      // Try "Month YYYY" (no day)
      const m2 = line.match(/^(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})$/i);
      if (m2) {
        const month = MONTHS[m2[1].toLowerCase()];
        creationDate = `${m2[2]}${month}01`;
        break;
      }
    }
    // Fallback to PDF metadata CreationDate
    if (!creationDate && metaDateMatch) {
      creationDate = metaDateMatch[1];
    }

    // Parse title and report type from text content
    const lines = fullText
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    let reportType = "DNB Markets Research";
    let title = "";

    // Typical format:
    // "MACRO, FIXED INCOME & CURRENCIES RESEARCH"
    // "28 January 2026"
    // "MARKETING MATERIAL"
    // "SHORT COMMENT US" or "MORGENRAPPORT" or "DNB CARNEGIE WEEK AHEAD"
    // "Title text here"

    for (let i = 0; i < Math.min(lines.length, 15); i++) {
      const line = lines[i];
      if (line.includes("MACRO, FIXED INCOME")) {
        reportType = "Macro, FI & Currencies";
      } else if (line.includes("EQUITY RESEARCH")) {
        reportType = "Equity Research";
      } else if (line.includes("SECTOR")) {
        reportType = "Sector Research";
      } else if (line.includes("TECHNICAL ANALYSIS")) {
        reportType = "Technical Analysis";
      } else if (line.includes("STRATEGY")) {
        reportType = "Strategy";
      }
    }

    // Find the title: skip header lines, date lines, "MARKETING MATERIAL"
    const headerPatterns = [
      /^MACRO,?\s+FIXED/i,
      /^CURRENCIES\s+RESEARCH/i,
      /^\d{1,2}\s+\w+\s+\d{4}$/,
      /^MARKETING\s+MATERIAL$/i,
      /^EQUITY\s+RESEARCH$/i,
      /^SECTOR\s+RESEARCH$/i,
      /^Kelly\s+K\./i,
      /^Stuart\s+Swift/i,
    ];

    let titleFound = false;
    for (let i = 0; i < Math.min(lines.length, 15); i++) {
      const line = lines[i];
      if (headerPatterns.some((p) => p.test(line))) continue;
      if (line.length < 3) continue;
      if (!titleFound) {
        title = line;
        titleFound = true;
        // Check if next line is a subtitle
        if (i + 1 < lines.length) {
          const next = lines[i + 1];
          if (
            next.length > 3 &&
            !headerPatterns.some((p) => p.test(next)) &&
            !next.startsWith("◼") &&
            !next.startsWith("Highlights")
          ) {
            title += ": " + next;
          }
        }
        break;
      }
    }

    // Build summary from first few meaningful paragraphs
    let summary = "";
    let summaryStart = false;
    for (const line of lines.slice(0, 40)) {
      if (
        line.startsWith("◼") ||
        line.startsWith("•") ||
        line.startsWith("Highlight")
      ) {
        summaryStart = true;
      }
      if (summaryStart || (line.length > 50 && !headerPatterns.some((p) => p.test(line)))) {
        summary += line + " ";
        if (summary.length > 500) break;
      }
    }

    // Fallback title
    if (!title) {
      title = lines.find((l) => l.length > 10 && l.length < 100) || "DNB Markets Report";
    }

    return {
      creationDate,
      author,
      title: title.substring(0, 200),
      reportType,
      summary: summary.trim().substring(0, 1000) || title,
      fullText,
      pages,
    };
  } finally {
    try {
      fs.unlinkSync(tmpFile);
    } catch {}
  }
}

/* ─── Norway/Nordic Relevance Filter ─────────────────────────── */

function isNorwayRelevant(meta: PdfMeta): boolean {
  if (ALL_MACRO) return true;

  const textLower = meta.fullText.toLowerCase();
  const titleLower = meta.title.toLowerCase();

  // Norwegian-language reports are always relevant
  if (
    titleLower.includes("morgenrapport") ||
    titleLower.includes("norges bank") ||
    /\b(norwegian|norway|nordic|nok|norsk|norge|oslo)\b/i.test(titleLower)
  ) {
    return true;
  }

  // Check if text mentions Norwegian/Nordic topics
  let keywordHits = 0;
  for (const kw of RELEVANCE_KEYWORDS) {
    if (textLower.includes(kw.toLowerCase())) {
      keywordHits++;
    }
  }

  // Require at least 2 keyword hits for relevance
  return keywordHits >= 2;
}

/* ─── OSE Ticker Matcher ─────────────────────────────────────── */

async function loadOseCompanies(): Promise<
  Map<string, string>
> {
  const { rows } = await pool.query(
    "SELECT ticker, name FROM stocks WHERE asset_type = 'equity' OR asset_type IS NULL"
  );
  const map = new Map<string, string>();
  for (const r of rows as { ticker: string; name: string }[]) {
    map.set(r.name.toLowerCase(), r.ticker);
    // Also add variations
    const baseTicker = r.ticker.replace(/\.OL$/, "");
    map.set(baseTicker.toLowerCase(), r.ticker);
  }
  return map;
}

function findMentionedTickers(
  text: string,
  oseCompanies: Map<string, string>
): string[] {
  const textLower = text.toLowerCase();
  const found = new Set<string>();
  for (const [name, ticker] of oseCompanies) {
    if (name.length >= 3 && textLower.includes(name)) {
      found.add(ticker);
    }
  }
  return Array.from(found);
}

/* ─── ID Scanner ─────────────────────────────────────────────── */

async function scanAndDownload(
  startId: number,
  endId: number
): Promise<{ id: number; buf: Buffer }[]> {
  console.log(`Scanning IDs ${startId}-${endId} for valid reports...`);
  const results: { id: number; buf: Buffer }[] = [];

  // Check existing IDs in DB to skip them
  const { rows } = await pool.query(
    "SELECT source_url FROM research_documents WHERE source_url LIKE '%getreport.aspx%'"
  );
  const existingUrls = new Set(
    rows.map((r: { source_url: string }) => r.source_url)
  );
  const existingCount = existingUrls.size;

  let skippedExisting = 0;
  let consecutiveFails = 0;
  const total = endId - startId + 1;

  for (let id = startId; id <= endId; id++) {
    const url = `${BASE_URL}?file=MRP_${id}.pdf`;
    if (existingUrls.has(url)) {
      skippedExisting++;
      continue;
    }

    const buf = downloadPdfSync(url);
    if (buf) {
      results.push({ id, buf });
      consecutiveFails = 0;
    } else {
      consecutiveFails++;
      // If we get 50+ consecutive failures, we might be rate-limited — pause
      if (consecutiveFails > 0 && consecutiveFails % 50 === 0) {
        console.log(
          `\n  ${consecutiveFails} consecutive misses — pausing 5s (may be rate-limited)...`
        );
        await sleep(5000);
      }
    }

    // Progress every 100 IDs
    if ((id - startId) % 100 === 0) {
      const progress = Math.round(((id - startId) / total) * 100);
      process.stdout.write(
        `\r  Progress: ${progress}% (ID ${id}, ${results.length} found, ${skippedExisting} already in DB)`
      );
    }

    // Rate limit between requests
    if ((id - startId) % SCAN_CONCURRENCY === 0) {
      await sleep(REQUEST_DELAY);
    }
  }

  console.log(
    `\n  Found ${results.length} new reports (${existingCount} already in DB)`
  );
  return results;
}

/* ─── Import Report ──────────────────────────────────────────── */

async function importReport(
  id: number,
  pdfBuf: Buffer,
  oseCompanies: Map<string, string>
): Promise<{ status: string; title?: string }> {
  const url = `${BASE_URL}?file=MRP_${id}.pdf`;

  // Extract metadata
  const meta = extractPdfMeta(pdfBuf);
  if (!meta) {
    return { status: "skip_no_meta" };
  }

  // Date filter
  if (meta.creationDate && meta.creationDate < SINCE_DATE) {
    return { status: "skip_old" };
  }

  // Relevance filter
  if (!isNorwayRelevant(meta)) {
    return { status: "skip_irrelevant", title: meta.title };
  }

  // Find mentioned OSE tickers
  const tickers = findMentionedTickers(meta.fullText, oseCompanies);

  if (DRY_RUN) {
    return { status: "would_import", title: meta.title };
  }

  // Upload PDF to Supabase
  const storagePath = `dnb-markets/${id}.pdf`;
  const { error: uploadErr } = await supabase.storage
    .from("research-pdfs")
    .upload(storagePath, pdfBuf, {
      contentType: "application/pdf",
      upsert: true,
    });

  if (uploadErr) {
    console.error(`  Upload error for MRP_${id}: ${uploadErr.message}`);
    return { status: "error_upload" };
  }

  // Format creation date as ISO
  const isoDate = meta.creationDate
    ? `${meta.creationDate.slice(0, 4)}-${meta.creationDate.slice(4, 6)}-${meta.creationDate.slice(6, 8)}`
    : new Date().toISOString().slice(0, 10);

  // Build subject line
  const subject = meta.reportType !== "DNB Markets Research"
    ? `[${meta.reportType}] ${meta.title}`
    : meta.title;

  // Insert into research_documents
  const { rows } = await pool.query(
    `INSERT INTO research_documents (
      subject, source, sender_email, body_text, received_date,
      source_url, tickers_mentioned, email_message_id
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    ON CONFLICT (email_message_id) DO NOTHING
    RETURNING id`,
    [
      subject,
      "DNB Carnegie",
      meta.author || "DNB Markets Research",
      meta.summary,
      isoDate,
      url,
      tickers.length > 0 ? tickers : null,
      `dnb-markets-MRP_${id}`,
    ]
  );

  if (rows.length === 0) {
    return { status: "skip_exists" };
  }

  const docId = rows[0].id;

  // Insert PDF attachment
  await pool.query(
    `INSERT INTO research_attachments (
      document_id, filename, content_type, file_size, file_path
    ) VALUES ($1, $2, $3, $4, $5)`,
    [docId, `MRP_${id}.pdf`, "application/pdf", pdfBuf.length, storagePath]
  );

  return { status: "imported", title: meta.title };
}

/* ─── Main ───────────────────────────────────────────────────── */

async function main() {
  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║   DNB Markets Research Scraper                  ║");
  console.log("╚══════════════════════════════════════════════════╝");
  console.log();

  if (DRY_RUN) console.log("DRY RUN MODE — no database writes\n");
  if (ALL_MACRO) console.log("Including ALL macro reports (no keyword filter)\n");

  // Load OSE companies for ticker matching
  const oseCompanies = await loadOseCompanies();
  console.log(`Loaded ${oseCompanies.size} OSE company names for matching\n`);

  // Initialize cookie jar for Akamai session
  initCookieJar();

  // Determine scan range
  const startId = SCAN_BACK ? SCAN_BACK_START : DEFAULT_START_ID;
  const endId = DEFAULT_END_ID;

  // Phase 1: Scan and download all valid PDFs
  const downloads = await scanAndDownload(startId, endId);

  if (downloads.length === 0) {
    console.log("No new reports to import.");
    await pool.end();
    return;
  }

  // Phase 2: Extract metadata and import
  console.log(`\nProcessing ${downloads.length} reports...\n`);

  const stats = {
    imported: 0,
    skipped_old: 0,
    skipped_irrelevant: 0,
    skipped_exists: 0,
    errors: 0,
    would_import: 0,
  };

  for (let i = 0; i < downloads.length; i++) {
    const { id, buf } = downloads[i];
    try {
      const result = await importReport(id, buf, oseCompanies);

      switch (result.status) {
        case "imported":
          stats.imported++;
          console.log(
            `  [${i + 1}/${downloads.length}] MRP_${id}: IMPORTED — ${result.title}`
          );
          break;
        case "would_import":
          stats.would_import++;
          console.log(
            `  [${i + 1}/${downloads.length}] MRP_${id}: would import — ${result.title}`
          );
          break;
        case "skip_old":
          stats.skipped_old++;
          break;
        case "skip_irrelevant":
          stats.skipped_irrelevant++;
          if (DRY_RUN || process.argv.includes("--verbose")) {
            console.log(
              `  [${i + 1}/${downloads.length}] MRP_${id}: SKIP (not Norway-relevant) — ${result.title}`
            );
          }
          break;
        case "skip_exists":
          stats.skipped_exists++;
          break;
        default:
          stats.errors++;
          break;
      }
    } catch (e: any) {
      stats.errors++;
      console.error(`  [${i + 1}/${downloads.length}] MRP_${id}: ERROR — ${e.message}`);
    }
  }

  // Summary
  console.log("\n═══ Results ═══");
  console.log(`  Scanned:           ${downloads.length} valid reports`);
  if (DRY_RUN) {
    console.log(`  Would import:      ${stats.would_import}`);
  } else {
    console.log(`  Imported:          ${stats.imported}`);
  }
  console.log(`  Skipped (old):     ${stats.skipped_old}`);
  console.log(`  Skipped (no match): ${stats.skipped_irrelevant}`);
  console.log(`  Skipped (exists):  ${stats.skipped_exists}`);
  console.log(`  Errors:            ${stats.errors}`);

  await pool.end();
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
