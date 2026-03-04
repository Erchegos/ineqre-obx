/**
 * DNB Carnegie Access Research Scraper
 *
 * Fetches commissioned equity research from access.dnbcarnegie.com.
 * Uses the sitemap to discover publication UUIDs, then the REST API
 * to extract metadata and download PDFs.
 *
 * Only imports publications for Norwegian companies (country="NO")
 * or companies matched against the stocks table.
 *
 * Data flow:
 *   1. Parse sitemap → collect all publication UUIDs
 *   2. For each UUID, call /carnegie-api/carnegie-access/publication-items/{uuid}
 *   3. Filter for Norwegian publications (country="NO" or OSE-matched company)
 *   4. Download PDF → upload to Supabase Storage → insert into research_documents
 *
 * Usage:
 *   npx tsx scripts/fetch-dnb-carnegie-research.ts              # Scan & import new Norwegian publications
 *   npx tsx scripts/fetch-dnb-carnegie-research.ts --dry-run    # Scan only, no DB writes
 *   npx tsx scripts/fetch-dnb-carnegie-research.ts --all        # Include all Nordic (SE/NO/FI/DK)
 *   npx tsx scripts/fetch-dnb-carnegie-research.ts --stats      # Just show country stats
 */

import { Pool } from "pg";
import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import * as path from "path";
import * as https from "https";
import * as http from "http";

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

/* ─── Config ─────────────────────────────────────────────────── */

const SITEMAP_URL = "https://access.dnbcarnegie.com/sitemap.xml";
const PUB_API_BASE =
  "https://access.dnbcarnegie.com/carnegie-api/carnegie-access/publication-items";
const PDF_DOWNLOAD_BASE =
  "https://access.dnbcarnegie.com/carnegie-api/carnegie-access/publication-items";

/** Delay between API calls (ms) */
const REQUEST_DELAY = 300;

/** Concurrent API calls */
const CONCURRENCY = 3;

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
const INCLUDE_ALL_NORDIC = process.argv.includes("--all");
const STATS_ONLY = process.argv.includes("--stats");

/** Only import publications from 2026-01-01 onwards (unless --all-dates) */
const SINCE_DATE = process.argv.includes("--all-dates")
  ? "2020-01-01"
  : "2026-01-01";

const ALLOWED_COUNTRIES = INCLUDE_ALL_NORDIC
  ? new Set(["NO", "SE", "FI", "DK"])
  : new Set(["NO"]);

/* ─── Types ──────────────────────────────────────────────────── */

interface PubItem {
  publicationId: string;
  publishedAt: string;
  headline: string;
  summary: string;
  country: string;
  language: string;
  productType: string;
  contentTags: string[];
  sector: { id: number; name: string } | null;
  authors: { peopleId: number; name: string }[];
  companies: { companyId: number; companyName: string; lei: string }[];
  content: { type: string; url: string; pages: number } | null;
}

interface PubApiResponse {
  items: PubItem[];
  httpStatus: number;
  totalItems: number;
  error: string;
}

/* ─── HTTP Helpers ───────────────────────────────────────────── */

function fetchUrl(url: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https") ? https : http;
    client
      .get(url, { timeout: 15000 }, (res) => {
        // Follow redirects
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return fetchUrl(res.headers.location).then(resolve, reject);
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} for ${url}`));
          res.resume();
          return;
        }
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks)));
        res.on("error", reject);
      })
      .on("error", reject);
  });
}

async function fetchJson<T>(url: string): Promise<T> {
  const buf = await fetchUrl(url);
  return JSON.parse(buf.toString("utf-8"));
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/* ─── OSE Matcher ────────────────────────────────────────────── */

async function buildOseTickers(): Promise<Set<string>> {
  const { rows } = await pool.query(
    "SELECT LOWER(name) AS name FROM stocks WHERE asset_type = 'equity' OR asset_type IS NULL"
  );
  return new Set(rows.map((r: { name: string }) => r.name));
}

/* ─── Sitemap Parser ─────────────────────────────────────────── */

async function fetchPublicationUuids(): Promise<string[]> {
  console.log("Fetching sitemap...");
  const xml = (await fetchUrl(SITEMAP_URL)).toString("utf-8");
  const uuids: string[] = [];
  const regex = /\/publication\/([a-f0-9-]+)/g;
  let match;
  while ((match = regex.exec(xml)) !== null) {
    uuids.push(match[1]);
  }
  console.log(`  Found ${uuids.length} publication UUIDs in sitemap`);
  return uuids;
}

/* ─── Publication Fetcher ────────────────────────────────────── */

async function fetchPublication(uuid: string): Promise<PubItem | null> {
  try {
    const data = await fetchJson<PubApiResponse>(`${PUB_API_BASE}/${uuid}`);
    if (data.items && data.items.length > 0) {
      return data.items[0];
    }
    return null;
  } catch (e: any) {
    if (!e.message?.includes("404")) {
      console.error(`  Error fetching ${uuid}: ${e.message}`);
    }
    return null;
  }
}

/* ─── PDF Download & Upload ──────────────────────────────────── */

async function downloadAndUploadPdf(
  pub: PubItem
): Promise<{ storagePath: string; fileSize: number } | null> {
  if (!pub.content?.url) return null;

  const pdfUrl = `${PDF_DOWNLOAD_BASE}/${pub.publicationId}/download`;
  try {
    // The API returns JSON with base64-encoded PDF in { item: { file, filename, contentType } }
    const rawBuf = await fetchUrl(pdfUrl);
    let pdfBuf: Buffer;
    try {
      const json = JSON.parse(rawBuf.toString("utf-8"));
      const b64 = json?.item?.file;
      if (!b64) {
        console.log(`  No file field in download response for ${pub.headline}`);
        return null;
      }
      pdfBuf = Buffer.from(b64, "base64");
    } catch {
      // If it's not JSON, maybe it's already a raw PDF
      pdfBuf = rawBuf;
    }
    if (pdfBuf.length < 1000) {
      console.log(`  Skipping tiny PDF (${pdfBuf.length} bytes) for ${pub.headline}`);
      return null;
    }

    const fileName = `dnb-carnegie/${pub.publicationId}.pdf`;
    const { error } = await supabase.storage
      .from("research-pdfs")
      .upload(fileName, pdfBuf, {
        contentType: "application/pdf",
        upsert: true,
      });

    if (error) {
      console.error(`  Supabase upload error: ${error.message}`);
      return null;
    }

    return { storagePath: fileName, fileSize: pdfBuf.length };
  } catch (e: any) {
    console.error(`  PDF download error for ${pub.publicationId}: ${e.message}`);
    return null;
  }
}

/* ─── DB Insert ──────────────────────────────────────────────── */

async function insertPublication(
  pub: PubItem,
  pdfInfo: { storagePath: string; fileSize: number } | null
): Promise<boolean> {
  const sourceUrl = `https://access.dnbcarnegie.com/publication/${pub.publicationId}`;

  // Check for existing by source_url
  const { rows: existing } = await pool.query(
    "SELECT id FROM research_documents WHERE source_url = $1",
    [sourceUrl]
  );
  if (existing.length > 0) {
    return false; // Already imported
  }

  // Strip HTML from summary
  const cleanSummary = pub.summary
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();

  // Extract target price from summary if present
  let targetPrice: number | null = null;
  const tpMatch = cleanSummary.match(
    /(?:fair value|target price|target|TP)\s*(?:range\s*(?:of\s*)?)?(?:NOK|SEK|EUR|USD)?\s*([\d.]+)(?:\s*[-–]\s*([\d.]+))?/i
  );
  if (tpMatch) {
    targetPrice = tpMatch[2]
      ? (parseFloat(tpMatch[1]) + parseFloat(tpMatch[2])) / 2
      : parseFloat(tpMatch[1]);
  }

  // Extract rating from content tags
  let rating: string | null = null;
  for (const tag of pub.contentTags) {
    const lower = tag.toLowerCase().replace(/_/g, " ");
    if (lower.includes("buy") || lower.includes("outperform")) rating = "Buy";
    else if (lower.includes("sell") || lower.includes("underperform")) rating = "Sell";
    else if (lower.includes("hold") || lower.includes("neutral")) rating = "Hold";
  }

  const companyNames = pub.companies.map((c) => c.companyName);
  const authorNames = pub.authors.map((a) => a.name).join(", ");
  const typeTag =
    pub.contentTags.length > 0
      ? pub.contentTags[0].replace(/_/g, " ")
      : "Research Note";

  const { rows } = await pool.query(
    `INSERT INTO research_documents (
      subject, source, sender_email, body_text, received_date,
      source_url, target_price, rating, tickers_mentioned,
      email_message_id
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    RETURNING id`,
    [
      pub.headline,
      "DNB Carnegie",
      authorNames || "DNB Carnegie Access",
      cleanSummary,
      pub.publishedAt,
      sourceUrl,
      targetPrice,
      rating,
      companyNames,
      `carnegie-access-${pub.publicationId}`, // Unique message ID for dedup
    ]
  );

  const docId = rows[0].id;

  // Insert PDF attachment if we have one
  if (pdfInfo) {
    await pool.query(
      `INSERT INTO research_attachments (
        document_id, filename, content_type, file_size, file_path
      ) VALUES ($1, $2, $3, $4, $5)`,
      [
        docId,
        `${pub.publicationId}.pdf`,
        "application/pdf",
        pdfInfo.fileSize,
        pdfInfo.storagePath,
      ]
    );
  }

  return true;
}

/* ─── Batch Processing ───────────────────────────────────────── */

async function processBatch(
  uuids: string[],
  oseNames: Set<string>
): Promise<{
  scanned: number;
  matched: number;
  imported: number;
  skipped: number;
  countries: Record<string, number>;
}> {
  const stats = {
    scanned: 0,
    matched: 0,
    imported: 0,
    skipped: 0,
    countries: {} as Record<string, number>,
  };

  // Process in batches with concurrency
  for (let i = 0; i < uuids.length; i += CONCURRENCY) {
    const batch = uuids.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map((uuid) => fetchPublication(uuid)));

    for (const pub of results) {
      stats.scanned++;

      if (!pub) continue;

      const country = pub.country || "UNKNOWN";
      stats.countries[country] = (stats.countries[country] || 0) + 1;

      if (STATS_ONLY) continue;

      // Date filter
      const pubDate = pub.publishedAt?.substring(0, 10) ?? "";
      if (pubDate < SINCE_DATE) continue;

      // Check if this publication matches our criteria
      const countryMatch = ALLOWED_COUNTRIES.has(country);

      // Also check company names against OSE stocks (for EMPTY country cases)
      const nameMatch = pub.companies.some((c) =>
        oseNames.has(c.companyName.toLowerCase())
      );

      if (!countryMatch && !nameMatch) continue;

      stats.matched++;
      const companies = pub.companies.map((c) => c.companyName).join(", ");
      console.log(
        `  [${country}] ${pub.publishedAt?.substring(0, 10)} | ${pub.headline.substring(0, 60)} | ${companies}`
      );

      if (DRY_RUN) {
        stats.imported++;
        continue;
      }

      // Download PDF and insert
      try {
        const pdfInfo = await downloadAndUploadPdf(pub);
        const inserted = await insertPublication(pub, pdfInfo);
        if (inserted) {
          stats.imported++;
          console.log(
            `    ✓ Imported${pdfInfo ? ` (PDF: ${(pdfInfo.fileSize / 1024).toFixed(0)}KB)` : " (no PDF)"}`
          );
        } else {
          stats.skipped++;
        }
      } catch (e: any) {
        console.error(`    ✗ Error: ${e.message}`);
      }
    }

    // Progress log every 50
    if (stats.scanned % 50 === 0) {
      console.log(
        `  Progress: ${stats.scanned}/${uuids.length} scanned, ${stats.matched} matched, ${stats.imported} imported`
      );
    }

    await sleep(REQUEST_DELAY);
  }

  return stats;
}

/* ─── Main ───────────────────────────────────────────────────── */

async function main() {
  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║   DNB Carnegie Access Research Scraper          ║");
  console.log("╚══════════════════════════════════════════════════╝");
  console.log();

  if (DRY_RUN) console.log("🔍 DRY RUN MODE — no database writes\n");
  if (INCLUDE_ALL_NORDIC)
    console.log("🌐 Including all Nordic countries (NO, SE, FI, DK)\n");
  if (STATS_ONLY) console.log("📊 STATS ONLY — just counting countries\n");

  const oseNames = await buildOseTickers();
  console.log(`Loaded ${oseNames.size} OSE stock names for matching\n`);

  const uuids = await fetchPublicationUuids();

  // Check which ones we already have
  if (!STATS_ONLY) {
    const { rows } = await pool.query(
      "SELECT source_url FROM research_documents WHERE source_url LIKE '%access.dnbcarnegie.com%'"
    );
    const existingUrls = new Set(rows.map((r: { source_url: string }) => r.source_url));
    const newUuids = uuids.filter(
      (uuid) =>
        !existingUrls.has(
          `https://access.dnbcarnegie.com/publication/${uuid}`
        )
    );
    console.log(
      `  Already imported: ${uuids.length - newUuids.length}, new to scan: ${newUuids.length}\n`
    );

    const stats = await processBatch(newUuids, oseNames);
    console.log("\n═══ Results ═══");
    console.log(`  Scanned:  ${stats.scanned}`);
    console.log(`  Matched:  ${stats.matched}`);
    console.log(`  Imported: ${stats.imported}`);
    console.log(`  Skipped:  ${stats.skipped} (already existed)`);
    if (Object.keys(stats.countries).length > 0) {
      console.log("\n  Country distribution:");
      for (const [k, v] of Object.entries(stats.countries).sort(
        (a, b) => b[1] - a[1]
      )) {
        console.log(`    ${k || "EMPTY"}: ${v}`);
      }
    }
  } else {
    const stats = await processBatch(uuids, oseNames);
    console.log("\n═══ Country Statistics ═══");
    for (const [k, v] of Object.entries(stats.countries).sort(
      (a, b) => b[1] - a[1]
    )) {
      const pct = ((v / stats.scanned) * 100).toFixed(1);
      console.log(`  ${k || "EMPTY"}: ${v} (${pct}%)`);
    }
    console.log(`\n  Total: ${stats.scanned}`);
  }

  await pool.end();
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
