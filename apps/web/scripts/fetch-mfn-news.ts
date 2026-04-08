/**
 * MFN.se News Fetcher
 *
 * Fetches Norwegian corporate press releases from MFN.se JSON API.
 * Only stores items matching tickers in our `stocks` table (OSE universe).
 * Stores into `newsweb_filings` table with `mfn-{news_id}` as dedup key.
 *
 * MFN API: https://mfn.se/all/s.json?lang=no&type=all
 * Items have author.tickers like ["XOSL:EQNR"], content.title, content.text, etc.
 *
 * Usage:
 *   npx tsx scripts/fetch-mfn-news.ts              # Fetch latest page (~25 items)
 *   npx tsx scripts/fetch-mfn-news.ts --pages=3    # Fetch 3 pages
 *   npx tsx scripts/fetch-mfn-news.ts --dry-run    # Log only, no DB insert
 */

import { Pool } from "pg";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

/* ─── Config ─────────────────────────────────────────────────── */

const MFN_BASE = "https://mfn.se/all/s.json";

/** Map MFN type/tags to our category schema */
function classifyMfnItem(properties: MfnProperties): { category: string; severity: number } {
  const tags = properties.tags || [];
  const type = properties.type || "";

  // Regulatory filings
  if (tags.includes(":regulatory")) {
    return { category: "regulatory", severity: 3 };
  }
  // Insider trades
  if (tags.some(t => t.includes("insider") || t.includes("mandatory-notification"))) {
    return { category: "insider_trade", severity: 4 };
  }
  // Earnings / financial reports
  if (tags.some(t => t.includes("annual-report") || t.includes("interim") || t.includes("quarterly"))) {
    return { category: "earnings", severity: 4 };
  }
  // Dividends
  if (tags.some(t => t.includes("dividend"))) {
    return { category: "dividend", severity: 3 };
  }
  // Investor relations
  if (type === "ir") {
    return { category: "mandatory_notification", severity: 2 };
  }
  // Press releases
  if (type === "pr") {
    return { category: "other", severity: 2 };
  }
  return { category: "other", severity: 2 };
}

/** Extract OSE ticker from MFN author.tickers array (e.g. ["XOSL:EQNR"] → "EQNR") */
function extractOseTicker(tickers: string[]): string | null {
  for (const t of tickers) {
    if (t.startsWith("XOSL:")) {
      return t.slice(5).toUpperCase();
    }
  }
  return null;
}

/* ─── Types ──────────────────────────────────────────────────── */

interface MfnProperties {
  lang?: string;
  tags?: string[];
  type?: string;
  scopes?: string[];
}

interface MfnContent {
  title?: string;
  slug?: string;
  publish_date?: string;
  html?: string;
  text?: string;
  attachments?: { url: string; file_name: string; content_type: string }[];
}

interface MfnAuthor {
  entity_id?: string;
  name?: string;
  tickers?: string[];
  isins?: string[];
}

interface MfnItem {
  news_id: string;
  group_id?: string;
  url?: string;
  author?: MfnAuthor;
  properties?: MfnProperties;
  content?: MfnContent;
  source?: string;
}

interface MfnFeedResponse {
  items: MfnItem[];
  next_url?: string;
}

/* ─── CLI Args ───────────────────────────────────────────────── */

const args = process.argv.slice(2);
const pagesArg = args.find((a) => a.startsWith("--pages="));
const dryRun = args.includes("--dry-run");
const maxPages = pagesArg ? parseInt(pagesArg.split("=")[1]) : 1;

/* ─── API Functions ──────────────────────────────────────────── */

async function fetchMfnPage(url: string): Promise<MfnFeedResponse> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; InEqRe-mfn/1.0)",
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    throw new Error(`MFN API returned ${res.status}: ${res.statusText}`);
  }
  return res.json();
}

/* ─── Main ───────────────────────────────────────────────────── */

async function main() {
  console.log("═══════════════════════════════════════════════");
  console.log("  MFN.se News Fetcher");
  console.log("═══════════════════════════════════════════════");
  console.log(`  Pages:    ${maxPages}`);
  console.log(`  Dry run:  ${dryRun}`);
  console.log("═══════════════════════════════════════════════\n");

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  try {
    // Get known tickers from DB
    const tickerRes = await pool.query(
      "SELECT ticker FROM stocks WHERE is_active = true"
    );
    const knownTickers = new Set(
      tickerRes.rows.map((r: { ticker: string }) => r.ticker.toUpperCase())
    );
    console.log(`Known active tickers: ${knownTickers.size}`);

    // Fetch pages from MFN
    let url = `${MFN_BASE}?lang=no&type=all`;
    let allItems: MfnItem[] = [];

    for (let page = 0; page < maxPages; page++) {
      console.log(`\nFetching page ${page + 1}/${maxPages}...`);
      const feed = await fetchMfnPage(url);
      const items = feed.items || [];
      console.log(`  Got ${items.length} items`);
      allItems.push(...items);

      if (!feed.next_url || items.length === 0) break;
      url = feed.next_url;

      // Small delay between pages
      if (page < maxPages - 1) {
        await new Promise((r) => setTimeout(r, 200));
      }
    }

    console.log(`\nTotal MFN items fetched: ${allItems.length}`);

    // Filter to our OSE tickers
    const relevant: { item: MfnItem; ticker: string }[] = [];
    for (const item of allItems) {
      const authorTickers = item.author?.tickers || [];
      const ticker = extractOseTicker(authorTickers);
      if (ticker && knownTickers.has(ticker)) {
        relevant.push({ item, ticker });
      }
    }

    console.log(`Relevant items for OSE tickers: ${relevant.length}\n`);

    if (relevant.length === 0) {
      console.log("No relevant items. Done.");
      await pool.end();
      return;
    }

    // Insert into newsweb_filings
    let inserted = 0;
    let skippedDup = 0;
    let errorCount = 0;
    const catCounts: Record<string, number> = {};

    for (const { item, ticker } of relevant) {
      const content = item.content || {};
      const properties = item.properties || {};
      const { category, severity } = classifyMfnItem(properties);
      const mfnId = `mfn-${item.news_id}`;
      const headline = (content.title || "").trim();
      const body = (content.text || "").trim() || null;
      const publishedAt = content.publish_date || new Date().toISOString();
      const itemUrl = item.url || "";
      const issuerName = item.author?.name || "";

      catCounts[category] = (catCounts[category] || 0) + 1;

      if (dryRun) {
        console.log(
          `  [DRY] ${ticker.padEnd(8)} ${category.padEnd(24)} ${headline.substring(0, 70)}`
        );
        inserted++;
        continue;
      }

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
            issuerName,
            category,
            publishedAt,
            headline,
            body,
            itemUrl,
            mfnId,
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
    }

    // Summary
    console.log("═══════════════════════════════════════════════");
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
