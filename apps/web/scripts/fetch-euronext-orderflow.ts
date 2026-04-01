/**
 * fetch-euronext-orderflow.ts
 *
 * Fetches intraday tick-by-tick trade data from Euronext Live for OSE equities.
 * Uses the public (undocumented) CSV download endpoint which returns all trades
 * for a given ISIN + date with: Trade ID, Time, Price, Shares, Trade Type.
 *
 * Side classification via Lee-Ready:
 *   - Compare trade price to rolling mid-price (bid+ask/2 from prior tick context)
 *   - Since we have no order book here: use tick rule (price uptick = buy, downtick = sell)
 *   - 0 = unknown (no price change)
 *
 * Trade types stored as metadata: Exchange Continuous, Dark Trade, Auction,
 * Retail Matching Facility, OffBook On Exchange, Trading at last
 *
 * Usage:
 *   pnpm run flow:fetch                          — today, EQNR
 *   pnpm run flow:fetch -- --ticker EQNR         — specific ticker
 *   pnpm run flow:fetch -- --date 2026-03-31     — specific date
 *   pnpm run flow:fetch -- --ticker EQNR --date 2026-03-31
 *   DRYRUN=1 pnpm run flow:fetch                 — parse only, no DB insert
 */

import { config } from "dotenv";
import { resolve } from "path";
import { Pool } from "pg";

config({ path: resolve(__dirname, "../.env.local") });

const DATABASE_URL = (process.env.DATABASE_URL || "").trim().replace(/^["']|["']$/g, "");
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
const DRY_RUN = process.env.DRYRUN === "1" || process.argv.includes("--dry-run");

// Parse CLI args
function getArg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx !== -1 ? process.argv[idx + 1] : undefined;
}

const TARGET_TICKER = getArg("ticker") || "EQNR";
const TARGET_DATE = getArg("date") || new Date().toISOString().slice(0, 10);

// ============================================================================
// EURONEXT ENDPOINTS
// ============================================================================

const EURONEXT_BASE = "https://live.euronext.com";

// Returns CSV: "Trade id";Time;Price;"Nb of shares";"Trade Type"
function csvDownloadUrl(isin: string, mic: string, date: string): string {
  return `${EURONEXT_BASE}/en/ajax/AwlIntradayPrice/getFullDownloadAjax/${isin}-${mic}?format=csv&date_form=d/m/Y&full_dl_date=${date}`;
}

// Fallback: paginated JSON endpoint (nbitems max ~50000)
function jsonEndpointUrl(isin: string, mic: string): string {
  return `${EURONEXT_BASE}/en/ajax/getIntradayPriceFilteredData/${isin}-${mic}`;
}

const FETCH_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Referer": "https://live.euronext.com/en/product/equities/",
};

// ============================================================================
// TYPES
// ============================================================================

interface RawTrade {
  tradeId: string;
  time: string; // "HH:MM:SS"
  price: number;
  shares: number;
  tradeType: string;
}

interface ParsedTick {
  ticker: string;
  ts: Date;
  price: number;
  size: number;
  side: number; // 1=buy, -1=sell, 0=unknown (tick rule)
  tradeId: string;
  tradeType: string;
}

// ============================================================================
// FETCH + PARSE CSV
// ============================================================================

async function fetchCsv(isin: string, mic: string, date: string): Promise<string> {
  const url = csvDownloadUrl(isin, mic, date);
  console.log(`  Fetching CSV: ${url}`);

  const res = await fetch(url, { headers: FETCH_HEADERS });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} from ${url}`);
  }

  const text = await res.text();
  return text;
}

async function fetchJson(isin: string, mic: string, date: string, nbitems = 50000): Promise<RawTrade[]> {
  const url = jsonEndpointUrl(isin, mic);
  console.log(`  Fetching JSON (nbitems=${nbitems}): POST ${url}`);

  const body = new URLSearchParams({
    nbitems: String(nbitems),
    date,
    timezone: "Europe/Oslo",
  });

  const res = await fetch(url, {
    method: "POST",
    headers: {
      ...FETCH_HEADERS,
      "Content-Type": "application/x-www-form-urlencoded",
      "Accept": "application/json",
    },
    body: body.toString(),
  });

  if (!res.ok) throw new Error(`HTTP ${res.status} from JSON endpoint`);

  const data = await res.json() as any;
  const rows: RawTrade[] = (data.rows || []).map((r: any) => ({
    tradeId: r.tradeId || "",
    time: r.time || "00:00:00",
    price: parseFloat(r.price) || 0,
    shares: parseInt(r.volume, 10) || 0,
    tradeType: r.type || "Unknown",
  }));

  console.log(`    Total trades on server: ${data.count}, fetched: ${rows.length}`);
  return rows;
}

function parseCsv(csv: string, date: string): RawTrade[] {
  const lines = csv.trim().split("\n");
  if (lines.length < 2) return [];

  // Skip header line (first line)
  // Format: "Trade id";Time;Price;"Nb of shares";"Trade Type"
  const trades: RawTrade[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Split on semicolon, strip quotes
    const parts = line.split(";").map((p) => p.replace(/^"|"$/g, "").trim());
    if (parts.length < 5) continue;

    const [tradeId, time, priceStr, sharesStr, tradeType] = parts;
    const price = parseFloat(priceStr.replace(",", "."));
    const shares = parseInt(sharesStr.replace(/\s/g, ""), 10);

    if (isNaN(price) || isNaN(shares) || shares <= 0) continue;

    trades.push({ tradeId, time, price, shares, tradeType });
  }

  return trades;
}

// ============================================================================
// SIDE CLASSIFICATION — Tick Rule
// Price uptick vs prior trade → buy (1)
// Price downtick → sell (-1)
// No change → carry forward last direction (0 if no prior)
// ============================================================================

function classifySides(trades: RawTrade[]): number[] {
  const sides: number[] = new Array(trades.length).fill(0);
  let lastDirection = 0;

  for (let i = 1; i < trades.length; i++) {
    const delta = trades[i].price - trades[i - 1].price;
    if (delta > 0) {
      sides[i] = 1;
      lastDirection = 1;
    } else if (delta < 0) {
      sides[i] = -1;
      lastDirection = -1;
    } else {
      // Reverse tick rule: carry last direction
      sides[i] = lastDirection;
    }
  }

  return sides;
}

// ============================================================================
// BUILD PARSED TICKS
// ============================================================================

function buildTicks(
  ticker: string,
  date: string,
  trades: RawTrade[],
  sides: number[]
): ParsedTick[] {
  const ticks: ParsedTick[] = [];

  for (let i = 0; i < trades.length; i++) {
    const t = trades[i];
    // CSV time field is "DD/MM/YYYY HH:MM:SS" — extract just the time part
    const timePart = t.time.includes(" ") ? t.time.split(" ")[1] : t.time;
    const timeParts = timePart.split(":");
    const hours = parseInt(timeParts[0], 10);
    const minutes = parseInt(timeParts[1], 10);
    const seconds = parseInt(timeParts[2] || "0", 10);

    // Build timestamp in Oslo time (CET/CEST = UTC+2) — stored as UTC
    const osloTs = new Date(`${date}T${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}+02:00`);

    ticks.push({
      ticker,
      ts: osloTs,
      price: t.price,
      size: t.shares,
      side: sides[i],
      tradeId: t.tradeId,
      tradeType: t.tradeType,
    });
  }

  return ticks;
}

// ============================================================================
// DB HELPERS
// ============================================================================

let db: Pool;

async function upsertTicks(ticks: ParsedTick[]): Promise<number> {
  if (ticks.length === 0) return 0;

  // Batch insert in chunks of 1000 to avoid parameter limits
  const CHUNK = 1000;
  let inserted = 0;

  for (let off = 0; off < ticks.length; off += CHUNK) {
    const chunk = ticks.slice(off, off + CHUNK);
    const COLS = 5; // ticker, ts, price, size, side (trade_id stored separately if needed)
    const placeholders: string[] = [];
    const values: any[] = [];

    for (let i = 0; i < chunk.length; i++) {
      const t = chunk[i];
      const base = i * COLS;
      placeholders.push(`($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5})`);
      values.push(t.ticker, t.ts, t.price, t.size, t.side);
    }

    const res = await db.query(
      `INSERT INTO orderflow_ticks (ticker, ts, price, size, side)
       VALUES ${placeholders.join(",")}`,
      values
    );

    inserted += res.rowCount ?? 0;
    process.stdout.write(`  Inserted ${inserted}/${ticks.length} ticks...\r`);
  }

  return inserted;
}

async function getIsin(ticker: string): Promise<{ isin: string; mic: string } | null> {
  const { rows } = await db.query(
    `SELECT isin FROM stocks WHERE ticker = $1 LIMIT 1`,
    [ticker]
  );
  if (rows.length === 0) return null;
  const isin = rows[0].isin;
  if (!isin) return null;
  // All OSE stocks trade on XOSL
  return { isin, mic: "XOSL" };
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  console.log(`\n=== EURONEXT ORDERFLOW FETCH ===`);
  console.log(`Ticker: ${TARGET_TICKER}`);
  console.log(`Date:   ${TARGET_DATE}`);
  console.log(`Dry run: ${DRY_RUN}\n`);

  if (!DATABASE_URL) {
    console.error("DATABASE_URL not set");
    process.exit(1);
  }

  db = new Pool({ connectionString: DATABASE_URL });
  console.log("Connected to DB\n");

  // Look up ISIN from stocks table
  const instrument = await getIsin(TARGET_TICKER);
  if (!instrument) {
    console.error(`No ISIN found for ticker ${TARGET_TICKER} in stocks table`);
    console.error(`Hint: make sure the ticker exists in the stocks table with a valid isin`);
    await db.end();
    process.exit(1);
  }

  const { isin, mic } = instrument;
  console.log(`ISIN: ${isin}, MIC: ${mic}\n`);

  // --- Strategy: try CSV first (all trades in one shot), fallback to JSON ---
  let trades: RawTrade[] = [];

  try {
    const csv = await fetchCsv(isin, mic, TARGET_DATE);
    const lines = csv.trim().split("\n");
    console.log(`  CSV lines received: ${lines.length}`);

    if (lines.length < 2 || csv.includes("No data") || csv.includes("<!DOCTYPE")) {
      throw new Error("CSV response looks like HTML or empty — falling back to JSON");
    }

    trades = parseCsv(csv, TARGET_DATE);
    console.log(`  Parsed ${trades.length} trades from CSV`);
  } catch (csvErr: any) {
    console.warn(`  CSV failed: ${csvErr.message}`);
    console.log(`  Trying JSON endpoint...`);

    // JSON endpoint: request up to 50,000 trades (covers any normal OSE day)
    trades = await fetchJson(isin, mic, TARGET_DATE, 50000);
  }

  if (trades.length === 0) {
    console.log(`\nNo trades found for ${TARGET_TICKER} on ${TARGET_DATE}`);
    console.log("(Market may have been closed, or date may be in the future)");
    await db.end();
    return;
  }

  // Classify sides via tick rule
  const sides = classifySides(trades);

  // Build tick objects
  const ticks = buildTicks(TARGET_TICKER, TARGET_DATE, trades, sides);

  // Stats
  const buys = sides.filter((s) => s === 1).length;
  const sells = sides.filter((s) => s === -1).length;
  const unknowns = sides.filter((s) => s === 0).length;
  const totalVol = trades.reduce((s, t) => s + t.shares, 0);
  const vwap = trades.reduce((s, t) => s + t.price * t.shares, 0) / totalVol;

  // Trade type breakdown
  const typeMap: Record<string, number> = {};
  for (const t of trades) {
    typeMap[t.tradeType] = (typeMap[t.tradeType] || 0) + 1;
  }

  console.log(`\n--- TRADE SUMMARY ---`);
  console.log(`Total trades:  ${trades.length.toLocaleString()}`);
  console.log(`Total volume:  ${totalVol.toLocaleString()} shares`);
  console.log(`VWAP:          ${vwap.toFixed(2)} NOK`);
  console.log(`Price range:   ${Math.min(...trades.map((t) => t.price)).toFixed(2)} – ${Math.max(...trades.map((t) => t.price)).toFixed(2)}`);
  console.log(`\nSide classification (tick rule):`);
  console.log(`  Buy:     ${buys.toLocaleString()} (${((buys / trades.length) * 100).toFixed(1)}%)`);
  console.log(`  Sell:    ${sells.toLocaleString()} (${((sells / trades.length) * 100).toFixed(1)}%)`);
  console.log(`  Unknown: ${unknowns.toLocaleString()} (${((unknowns / trades.length) * 100).toFixed(1)}%)`);
  console.log(`\nTrade types:`);
  for (const [type, count] of Object.entries(typeMap).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${type.padEnd(35)} ${count.toLocaleString()}`);
  }

  if (DRY_RUN) {
    console.log(`\nDRY RUN — skipping DB insert`);
    console.log(`\nSample ticks (first 5):`);
    for (const t of ticks.slice(0, 5)) {
      console.log(`  ${t.ts.toISOString()}  ${t.price}  x${t.size}  side=${t.side}  ${t.tradeType}`);
    }
    console.log(`\nSample ticks (last 5):`);
    for (const t of ticks.slice(-5)) {
      console.log(`  ${t.ts.toISOString()}  ${t.price}  x${t.size}  side=${t.side}  ${t.tradeType}`);
    }
  } else {
    console.log(`\nInserting into orderflow_ticks...`);
    const inserted = await upsertTicks(ticks);
    console.log(`\nInserted ${inserted.toLocaleString()} ticks`);

    // Verify — use UTC range covering the full Oslo trading day
    const dayStart = `${TARGET_DATE}T00:00:00Z`;
    const dayEnd   = `${TARGET_DATE}T23:59:59Z`;
    const { rows } = await db.query(
      `SELECT COUNT(*)::int as cnt, MIN(ts) as first_ts, MAX(ts) as last_ts
       FROM orderflow_ticks WHERE ticker = $1 AND ts BETWEEN $2 AND $3`,
      [TARGET_TICKER, dayStart, dayEnd]
    );
    console.log(`DB verification: ${rows[0].cnt} rows, ${rows[0].first_ts} → ${rows[0].last_ts}`);
  }

  await db.end();
  console.log("\nDone.\n");
}

main().catch((e) => {
  console.error("FATAL:", e.message);
  process.exit(1);
});
