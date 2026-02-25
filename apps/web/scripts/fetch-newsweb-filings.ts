/**
 * NewsWeb Filing Scraper
 *
 * Fetches regulatory filings from Oslo Børs NewsWeb via their internal JSON API.
 * Inserts into `newsweb_filings` table with dedup on `newsweb_id`.
 *
 * API endpoints discovered:
 *   POST https://api3.oslo.oslobors.no/v1/newsreader/list?fromDate=...&toDate=...
 *   GET  https://api3.oslo.oslobors.no/v1/newsreader/message?messageId=...
 *
 * The list API caps at ~600 results per call, so for large date ranges we
 * chunk into 7-day windows to ensure full coverage.
 *
 * Usage:
 *   npx tsx scripts/fetch-newsweb-filings.ts                  # Last 3 days
 *   npx tsx scripts/fetch-newsweb-filings.ts --days=56        # Backfill ~2 months
 *   npx tsx scripts/fetch-newsweb-filings.ts --ticker=EQNR    # Single ticker only
 *   npx tsx scripts/fetch-newsweb-filings.ts --dry-run        # Log, don't insert
 *   npx tsx scripts/fetch-newsweb-filings.ts --skip-body      # Skip body fetch (faster)
 */

import { Pool } from "pg";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

/* ─── Config ─────────────────────────────────────────────────── */

const API_BASE = "https://api3.oslo.oslobors.no/v1/newsreader";

/** Max days per API call to avoid hitting the ~600 result cap */
const CHUNK_DAYS = 7;

/** Category ID → our schema category mapping */
const CATEGORY_MAP: Record<number, string> = {
  1102: "insider_trade",          // MANDATORY NOTIFICATION OF TRADE PRIMARY INSIDERS
  1005: "insider_trade",          // INSIDE INFORMATION
  1001: "earnings",               // ANNUAL FINANCIAL AND AUDIT REPORTS
  1002: "earnings",               // HALF YEARLY FINANCIAL REPORTS
  1007: "buyback",                // ACQUISITION OR DISPOSAL OF ISSUER'S OWN SHARES
  1101: "dividend",               // EX DATE
  1006: "mandatory_notification", // MAJOR SHAREHOLDING NOTIFICATIONS
  1008: "mandatory_notification", // TOTAL NUMBER OF VOTING RIGHTS AND CAPITAL
  1009: "mandatory_notification", // CHANGES IN RIGHTS ATTACHING TO SHARES
  1103: "mandatory_notification", // PROSPECTUS / ADMISSION DOCUMENT
  1104: "other",                  // NON-REGULATORY PRESS RELEASES
  1010: "other",                  // ADDITIONAL REGULATED INFORMATION
  1003: "other",                  // PAYMENTS TO GOVERNMENTS
  1004: "other",                  // HOME MEMBER STATE
  1201: "other",                  // LISTING / ADMISSION
  1202: "other",                  // TRADING HALTS
  1301: "regulatory",             // ANNOUNCEMENT FROM FSA
  1105: "other",                  // ADJUSTMENT OF INTEREST RATE
};

/**
 * Categories we store. Only skip exchange-level noise (trading halts,
 * closing prices, matching halts, announcements from other participants).
 */
const SKIP_CATEGORY_IDS = new Set([
  1202, // TRADING HALTS
  1203, // MATCHING HALT
  1204, // SPECIAL OBSERVATION
  1205, // CLOSING PRICES DERIVATIVES
  1206, // DERIVATIVE NOTICES
  1207, // ANNOUNCEMENT FROM OSLO BØRS
  1208, // ANNOUNCEMENT FROM OTHER PARTICIPANTS
  1302, // ANNOUNCEMENT FROM NORGES BANK
  1003, // PAYMENTS TO GOVERNMENTS
  1004, // HOME MEMBER STATE
  1105, // ADJUSTMENT OF INTEREST RATE (bond coupon resets — noise)
]);

/** Severity by category */
const CATEGORY_SEVERITY: Record<string, number> = {
  insider_trade: 4,
  earnings: 4,
  dividend: 3,
  buyback: 3,
  mandatory_notification: 2,
  regulatory: 3,
  other: 2,
};

/* ─── CLI Args ───────────────────────────────────────────────── */

const args = process.argv.slice(2);
const daysArg = args.find((a) => a.startsWith("--days="));
const tickerArg = args.find((a) => a.startsWith("--ticker="));
const dryRun = args.includes("--dry-run");
const skipBody = args.includes("--skip-body");
const days = daysArg ? parseInt(daysArg.split("=")[1]) : 3;
const filterTicker = tickerArg ? tickerArg.split("=")[1].toUpperCase() : null;

/* ─── Helpers ────────────────────────────────────────────────── */

function formatDate(d: Date): string {
  return d.toISOString().split("T")[0];
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

interface NewsWebMessage {
  id: number;
  messageId: number;
  newsId: number;
  title: string;
  category: { id: number; category_no: string; category_en: string }[];
  markets: string[];
  issuerId: number;
  issuerSign: string;
  issuerName: string;
  publishedTime: string;
  numbAttachments: number;
  correctionForMessageId: number;
  correctedByMessageId: number;
  body?: string;
}

/* ─── API Functions ──────────────────────────────────────────── */

async function fetchFilingList(
  fromDate: string,
  toDate: string,
  issuerSign?: string
): Promise<NewsWebMessage[]> {
  const params = new URLSearchParams({ fromDate, toDate });
  if (issuerSign) params.set("issuer", issuerSign);

  const res = await fetch(`${API_BASE}/list?${params}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });

  if (!res.ok) {
    throw new Error(`NewsWeb list API returned ${res.status}`);
  }

  const json = await res.json();
  return json?.data?.messages || [];
}

/**
 * Fetch filings in chunked windows to avoid hitting the API's ~600 result cap.
 * For <=7 days we do a single call; for longer ranges we chunk into 7-day windows.
 */
async function fetchFilingListChunked(
  from: Date,
  to: Date,
  issuerSign?: string
): Promise<NewsWebMessage[]> {
  const totalDays = Math.ceil(
    (to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24)
  );

  if (totalDays <= CHUNK_DAYS) {
    return fetchFilingList(formatDate(from), formatDate(to), issuerSign);
  }

  // Chunk into CHUNK_DAYS windows
  const allMessages: NewsWebMessage[] = [];
  const seen = new Set<number>();
  let chunkStart = new Date(from);

  while (chunkStart < to) {
    const chunkEnd = new Date(chunkStart);
    chunkEnd.setDate(chunkEnd.getDate() + CHUNK_DAYS);
    if (chunkEnd > to) chunkEnd.setTime(to.getTime());

    const fromStr = formatDate(chunkStart);
    const toStr = formatDate(chunkEnd);
    console.log(`  Fetching chunk ${fromStr} → ${toStr}...`);

    const msgs = await fetchFilingList(fromStr, toStr, issuerSign);
    let newCount = 0;
    for (const m of msgs) {
      if (!seen.has(m.messageId)) {
        seen.add(m.messageId);
        allMessages.push(m);
        newCount++;
      }
    }
    console.log(`    ${msgs.length} messages (${newCount} new)`);

    // Move to next chunk
    chunkStart = new Date(chunkEnd);
    // Small delay between API calls
    if (chunkStart < to) await sleep(200);
  }

  return allMessages;
}

async function fetchMessageBody(messageId: number): Promise<string | null> {
  try {
    const res = await fetch(
      `${API_BASE}/message?messageId=${messageId}`,
      { headers: { "Content-Type": "application/json" } }
    );
    if (!res.ok) return null;
    const json = await res.json();
    return json?.data?.message?.body || null;
  } catch {
    return null;
  }
}

/* ─── Main ───────────────────────────────────────────────────── */

async function main() {
  console.log("═══════════════════════════════════════════════");
  console.log("  NewsWeb Filing Scraper");
  console.log("═══════════════════════════════════════════════");
  console.log(`  Days:       ${days}`);
  console.log(`  Ticker:     ${filterTicker || "ALL"}`);
  console.log(`  Dry run:    ${dryRun}`);
  console.log(`  Skip body:  ${skipBody}`);
  console.log("═══════════════════════════════════════════════\n");

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  try {
    // Build date range
    const toDate = new Date();
    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - days);

    console.log(`Fetching filings from ${formatDate(fromDate)} to ${formatDate(toDate)}...`);

    // Get known tickers from DB
    const tickerRes = await pool.query(
      "SELECT ticker FROM stocks WHERE is_active = true"
    );
    const knownTickers = new Set(
      tickerRes.rows.map((r) => r.ticker.toUpperCase())
    );
    console.log(`Known active tickers: ${knownTickers.size}\n`);

    // Fetch all filings in date range (chunked for large ranges)
    const messages = await fetchFilingListChunked(
      fromDate,
      toDate,
      filterTicker || undefined
    );
    console.log(`\nTotal messages from API: ${messages.length}`);

    // Filter: skip exchange-level noise, keep only our tracked tickers
    const relevant = messages.filter((m) => {
      const catId = m.category[0]?.id;
      if (!catId || SKIP_CATEGORY_IDS.has(catId)) return false;
      // Filter to our tracked tickers
      const ticker = m.issuerSign?.toUpperCase();
      if (!ticker || !knownTickers.has(ticker)) return false;
      // Skip corrections (we'll have the original)
      if (m.correctedByMessageId > 0) return false;
      return true;
    });
    console.log(`Relevant filings for tracked tickers: ${relevant.length}\n`);

    if (relevant.length === 0) {
      console.log("No relevant filings found. Done.");
      await pool.end();
      return;
    }

    // Stats tracking
    let inserted = 0;
    let skippedDup = 0;
    let errorCount = 0;
    const catCounts: Record<string, number> = {};

    // Process filings
    for (let i = 0; i < relevant.length; i++) {
      const msg = relevant[i];
      const ticker = msg.issuerSign.toUpperCase();
      const catId = msg.category[0]?.id || 0;
      const category = CATEGORY_MAP[catId] || "other";
      const severity = CATEGORY_SEVERITY[category] || 2;
      const newswebId = String(msg.messageId);
      const headline = msg.title.trim();
      const url = `https://newsweb.oslobors.no/message/${msg.messageId}`;
      const publishedAt = msg.publishedTime;

      catCounts[category] = (catCounts[category] || 0) + 1;

      // Fetch body text (with rate limiting)
      let body: string | null = null;
      if (!skipBody) {
        body = await fetchMessageBody(msg.messageId);
        // Rate limit: 50ms between detail requests
        if (i < relevant.length - 1) await sleep(50);
      }

      if (dryRun) {
        console.log(
          `  [DRY] ${ticker.padEnd(8)} ${category.padEnd(24)} ${headline.substring(0, 70)}`
        );
        inserted++;
        continue;
      }

      // UPSERT into newsweb_filings
      try {
        const result = await pool.query(
          `INSERT INTO newsweb_filings (
            ticker, issuer_name, category, published_at,
            headline, body, url, newsweb_id, severity
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          ON CONFLICT (newsweb_id) DO UPDATE SET
            headline = EXCLUDED.headline,
            body = COALESCE(EXCLUDED.body, newsweb_filings.body),
            category = EXCLUDED.category,
            severity = EXCLUDED.severity
          RETURNING id`,
          [
            ticker,
            msg.issuerName,
            category,
            publishedAt,
            headline,
            body,
            url,
            newswebId,
            severity,
          ]
        );

        if (result.rowCount && result.rowCount > 0) {
          inserted++;
        }
      } catch (err: any) {
        errorCount++;
        if (err.code === "23505") {
          skippedDup++;
        } else {
          console.error(`  [ERR] ${ticker}: ${err.message}`);
        }
      }

      // Progress log every 50 items
      if ((i + 1) % 50 === 0) {
        console.log(`  Progress: ${i + 1}/${relevant.length} processed`);
      }
    }

    // Summary
    console.log("\n═══════════════════════════════════════════════");
    console.log("  RESULTS");
    console.log("═══════════════════════════════════════════════");
    console.log(`  Inserted/Updated: ${inserted}`);
    console.log(`  Skipped (dup):    ${skippedDup}`);
    console.log(`  Errors:           ${errorCount}`);
    console.log("\n  Categories:");
    Object.entries(catCounts)
      .sort((a, b) => b[1] - a[1])
      .forEach(([cat, count]) => {
        console.log(`    ${cat.padEnd(26)} ${count}`);
      });
    console.log("═══════════════════════════════════════════════\n");

    await pool.end();
  } catch (err) {
    console.error("Fatal error:", err);
    await pool.end();
    process.exit(1);
  }
}

main();
