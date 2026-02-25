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

/** Category ID → our schema category mapping */
const CATEGORY_MAP: Record<number, string> = {
  1102: "insider_trade",        // MANDATORY NOTIFICATION OF TRADE PRIMARY INSIDERS
  1005: "insider_trade",        // INSIDE INFORMATION (often insider-related)
  1001: "earnings",             // ANNUAL FINANCIAL AND AUDIT REPORTS
  1002: "earnings",             // HALF YEARLY FINANCIAL REPORTS
  1007: "buyback",              // ACQUISITION OR DISPOSAL OF ISSUER'S OWN SHARES
  1101: "dividend",             // EX DATE
  1006: "mandatory_notification", // MAJOR SHAREHOLDING NOTIFICATIONS
  1008: "mandatory_notification", // TOTAL NUMBER OF VOTING RIGHTS AND CAPITAL
  1009: "mandatory_notification", // CHANGES IN RIGHTS ATTACHING TO SHARES
  1103: "mandatory_notification", // PROSPECTUS / ADMISSION DOCUMENT
  1104: "other",                // NON-REGULATORY PRESS RELEASES
  1105: "other",                // ADJUSTMENT OF INTEREST RATE
  1010: "other",                // ADDITIONAL REGULATED INFORMATION
  1003: "other",                // PAYMENTS TO GOVERNMENTS
  1004: "other",                // HOME MEMBER STATE
  1201: "other",                // LISTING / ADMISSION
  1202: "other",                // TRADING HALTS
  1301: "regulatory",           // ANNOUNCEMENT FROM FSA
};

/** Categories we actually want to store (skip noise like interest rate adjustments) */
const RELEVANT_CATEGORY_IDS = new Set([
  1102, // Insider trades
  1005, // Inside information
  1001, // Annual reports
  1002, // Half yearly reports
  1007, // Buybacks
  1101, // Ex dates / dividends
  1006, // Major shareholdings
  1104, // Non-regulatory press releases
  1008, // Voting rights changes
  1009, // Rights changes
  1301, // FSA announcements
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

    const fromStr = formatDate(fromDate);
    const toStr = formatDate(toDate);

    console.log(`Fetching filings from ${fromStr} to ${toStr}...`);

    // Get known tickers from DB
    const tickerRes = await pool.query(
      "SELECT ticker FROM stocks WHERE is_active = true"
    );
    const knownTickers = new Set(
      tickerRes.rows.map((r) => r.ticker.toUpperCase())
    );
    console.log(`Known active tickers: ${knownTickers.size}\n`);

    // Fetch all filings in date range
    const messages = await fetchFilingList(
      fromStr,
      toStr,
      filterTicker || undefined
    );
    console.log(`Total messages from API: ${messages.length}`);

    // Filter to relevant categories and known tickers
    const relevant = messages.filter((m) => {
      const catId = m.category[0]?.id;
      if (!catId || !RELEVANT_CATEGORY_IDS.has(catId)) return false;
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
        // Rate limit: 100ms between detail requests
        if (i < relevant.length - 1) await sleep(100);
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
