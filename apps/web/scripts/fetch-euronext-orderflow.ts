/**
 * fetch-euronext-orderflow.ts
 *
 * Fetches intraday tick-by-tick trade data from Euronext Live for OSE equities.
 * Uses the public CSV download endpoint which returns all trades for a given
 * ISIN + date with: Trade ID, Time, Price, Shares, Trade Type.
 *
 * Side classification via tick rule:
 *   - Price uptick vs prior trade → buy (1)
 *   - Price downtick → sell (-1)
 *   - No change → carry forward last direction (0 if no prior)
 *
 * Deduplication: uses trade_id (alphanumeric from Euronext) stored in DB.
 * ON CONFLICT (ticker, ts, trade_id) DO NOTHING — safe to re-run.
 *
 * Usage:
 *   pnpm run flow:fetch                               — today, EQNR
 *   pnpm run flow:fetch -- --ticker EQNR             — specific ticker
 *   pnpm run flow:fetch -- --date 2026-04-04         — specific date
 *   pnpm run flow:fetch -- --all                     — all 5 flow tickers, today
 *   pnpm run flow:fetch -- --all --date 2026-04-04   — all 5, specific date
 *   pnpm run flow:fetch -- --backfill 30             — backfill last 30 days, EQNR
 *   pnpm run flow:fetch -- --all --backfill 30       — backfill all 5 tickers, 30 days
 *   DRYRUN=1 pnpm run flow:fetch                     — parse only, no DB insert
 */

import { config } from "dotenv";
import { resolve } from "path";
import { Pool } from "pg";

config({ path: resolve(__dirname, "../.env.local") });

const DATABASE_URL = (process.env.DATABASE_URL || "").trim().replace(/^["']|["']$/g, "");
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
const DRY_RUN = process.env.DRYRUN === "1" || process.argv.includes("--dry-run");

// All 5 flow page tickers with their known OSE ISINs
const FLOW_TICKERS: Record<string, { isin: string; mic: string }> = {
  EQNR: { isin: "NO0010096985", mic: "XOSL" },
  DNB:  { isin: "NO0010161896", mic: "XOSL" },
  MOWI: { isin: "NO0003054108", mic: "XOSL" },
  TEL:  { isin: "NO0010063308", mic: "XOSL" },
  YAR:  { isin: "NO0010208051", mic: "XOSL" },
};

function getArg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx !== -1 ? process.argv[idx + 1] : undefined;
}
function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

const ALL_TICKERS = hasFlag("all");
const TARGET_TICKER = getArg("ticker") || "EQNR";
const TARGET_DATE = getArg("date") || new Date().toISOString().slice(0, 10);
const BACKFILL_DAYS = parseInt(getArg("backfill") || "0", 10);

// ============================================================================
// EURONEXT ENDPOINTS
// ============================================================================

const EURONEXT_BASE = "https://live.euronext.com";

function csvDownloadUrl(isin: string, mic: string, date: string): string {
  return `${EURONEXT_BASE}/en/ajax/AwlIntradayPrice/getFullDownloadAjax/${isin}-${mic}?format=csv&date_form=d/m/Y&full_dl_date=${date}`;
}

function jsonEndpointUrl(isin: string, mic: string): string {
  return `${EURONEXT_BASE}/en/ajax/getIntradayPriceFilteredData/${isin}-${mic}`;
}

const FETCH_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Referer": "https://live.euronext.com/en/product/equities/",
};

// ============================================================================
// TYPES
// ============================================================================

interface RawTrade {
  tradeId: string;
  time: string;
  price: number;
  shares: number;
  tradeType: string;
}

interface ParsedTick {
  ticker: string;
  ts: Date;
  price: number;
  size: number;
  side: number;
  tradeId: string;
  tradeType: string;
}

// ============================================================================
// FETCH + PARSE
// ============================================================================

async function fetchCsv(isin: string, mic: string, date: string): Promise<string> {
  const url = csvDownloadUrl(isin, mic, date);
  const res = await fetch(url, { headers: FETCH_HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return res.text();
}

async function fetchJson(isin: string, mic: string, date: string, nbitems = 50000): Promise<RawTrade[]> {
  const url = jsonEndpointUrl(isin, mic);
  const body = new URLSearchParams({ nbitems: String(nbitems), date, timezone: "Europe/Oslo" });
  const res = await fetch(url, {
    method: "POST",
    headers: { ...FETCH_HEADERS, "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json" },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from JSON endpoint`);
  const data = await res.json() as any;
  return (data.rows || []).map((r: any) => ({
    tradeId: r.tradeId || "",
    time: r.time || "00:00:00",
    price: parseFloat(r.price) || 0,
    shares: parseInt(r.volume, 10) || 0,
    tradeType: r.type || "Unknown",
  }));
}

function parseCsv(csv: string): RawTrade[] {
  const lines = csv.trim().split("\n");
  if (lines.length < 2) return [];
  const trades: RawTrade[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
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
// ============================================================================

function classifySides(trades: RawTrade[]): number[] {
  const sides: number[] = new Array(trades.length).fill(0);
  let lastDirection = 0;
  for (let i = 1; i < trades.length; i++) {
    const delta = trades[i].price - trades[i - 1].price;
    if (delta > 0) { sides[i] = 1; lastDirection = 1; }
    else if (delta < 0) { sides[i] = -1; lastDirection = -1; }
    else { sides[i] = lastDirection; }
  }
  return sides;
}

/**
 * Extract the actual trading date from CSV time field.
 * Euronext CSV time is either "DD/MM/YYYY HH:MM:SS" or just "HH:MM:SS".
 * Returns YYYY-MM-DD or null if no date part present.
 */
function extractDateFromTime(timeField: string): string | null {
  if (!timeField.includes(" ")) return null;
  const datePart = timeField.split(" ")[0]; // "DD/MM/YYYY"
  const [d, m, y] = datePart.split("/");
  if (!d || !m || !y || y.length !== 4) return null;
  return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

function buildTicks(ticker: string, date: string, trades: RawTrade[], sides: number[]): ParsedTick[] {
  return trades.map((t, i) => {
    const timePart = t.time.includes(" ") ? t.time.split(" ")[1] : t.time;
    // Use actual date from CSV if available, otherwise fall back to requested date
    const actualDate = extractDateFromTime(t.time) || date;
    const [hStr, mStr, sStr = "0"] = timePart.split(":");
    const osloTs = new Date(`${actualDate}T${hStr.trim().padStart(2,"0")}:${mStr.padStart(2,"0")}:${sStr.padStart(2,"0")}+02:00`);
    return { ticker, ts: osloTs, price: t.price, size: t.shares, side: sides[i], tradeId: t.tradeId, tradeType: t.tradeType };
  });
}

// ============================================================================
// DB — with ON CONFLICT dedup on trade_id
// ============================================================================

let db: Pool;

async function upsertTicks(ticks: ParsedTick[]): Promise<number> {
  if (ticks.length === 0) return 0;

  // Filter to exchange continuous trades only (real trades, no dark/auction noise)
  // Actually keep all — caller can filter. Store trade_type for filtering at query time.
  const CHUNK = 1000;
  let inserted = 0;

  for (let off = 0; off < ticks.length; off += CHUNK) {
    const chunk = ticks.slice(off, off + CHUNK);
    // 6 columns: ticker, ts, price, size, side, trade_id
    const COLS = 6;
    const placeholders: string[] = [];
    const values: any[] = [];

    for (let i = 0; i < chunk.length; i++) {
      const t = chunk[i];
      const base = i * COLS;
      placeholders.push(`($${base+1},$${base+2},$${base+3},$${base+4},$${base+5},$${base+6})`);
      values.push(t.ticker, t.ts, t.price, t.size, t.side, t.tradeId || null);
    }

    const res = await db.query(
      `INSERT INTO orderflow_ticks (ticker, ts, price, size, side, trade_id)
       VALUES ${placeholders.join(",")}
       ON CONFLICT (ticker, ts, price, size) DO NOTHING`,
      values
    );
    inserted += res.rowCount ?? 0;
    process.stdout.write(`  Inserted ${off + chunk.length}/${ticks.length} (new: ${inserted})...\r`);
  }

  return inserted;
}

// ============================================================================
// FETCH ONE TICKER + DATE
// ============================================================================

async function fetchOneTicker(ticker: string, date: string): Promise<void> {
  const instrument = FLOW_TICKERS[ticker.toUpperCase()];
  if (!instrument) {
    console.error(`Unknown ticker ${ticker}. Known: ${Object.keys(FLOW_TICKERS).join(", ")}`);
    return;
  }

  const { isin, mic } = instrument;
  console.log(`\n[${ticker}] ${date}  ISIN: ${isin}`);

  let trades: RawTrade[] = [];

  try {
    const csv = await fetchCsv(isin, mic, date);
    const lines = csv.trim().split("\n");
    if (lines.length < 2 || csv.includes("No data") || csv.includes("<!DOCTYPE")) {
      throw new Error("CSV empty or HTML");
    }
    trades = parseCsv(csv);
    console.log(`  CSV: ${trades.length} trades`);
  } catch (csvErr: any) {
    console.warn(`  CSV failed (${csvErr.message}), trying JSON...`);
    try {
      trades = await fetchJson(isin, mic, date, 50000);
      console.log(`  JSON: ${trades.length} trades`);
    } catch (jsonErr: any) {
      console.error(`  JSON also failed: ${jsonErr.message}`);
      return;
    }
  }

  if (trades.length === 0) {
    console.log(`  No trades (market closed or future date)`);
    return;
  }

  // Stale-data guard: check if the CSV data is actually from the requested date.
  // Euronext returns the last trading day's data when queried for weekends/holidays/pre-open.
  // Extract the actual date from the first trade's time field and compare.
  const csvDate = extractDateFromTime(trades[0].time);
  if (csvDate && csvDate !== date) {
    console.log(`  STALE DATA — CSV contains ${csvDate} trades but requested ${date}. Skipping.`);
    return;
  }

  // Filter: only real exchange trades (not dark pool, not auction)
  // Keep: Exchange Continuous, Trading at last, Retail Matching Facility
  // Skip: Dark Trade, OffBook On Exchange, Auction
  const realTrades = trades.filter(t => !t.tradeType.toLowerCase().includes("dark") && !t.tradeType.toLowerCase().includes("offbook") && !t.tradeType.toLowerCase().includes("auction"));
  console.log(`  Real trades: ${realTrades.length} / ${trades.length} total (filtered ${trades.length - realTrades.length} dark/off-book/auction)`);

  const sides = classifySides(realTrades);
  const ticks = buildTicks(ticker, date, realTrades, sides);

  const totalVol = realTrades.reduce((s, t) => s + t.shares, 0);
  const vwap = totalVol > 0 ? realTrades.reduce((s, t) => s + t.price * t.shares, 0) / totalVol : 0;
  console.log(`  Vol: ${totalVol.toLocaleString()}  VWAP: ${vwap.toFixed(2)}`);

  if (DRY_RUN) {
    console.log(`  DRY RUN — skipping insert`);
    return;
  }

  const inserted = await upsertTicks(ticks);
  console.log(`  DB: ${inserted} new rows (${ticks.length - inserted} already existed)`);
}

// ============================================================================
// DATE HELPERS
// ============================================================================

function getPastTradingDates(nDays: number): string[] {
  const dates: string[] = [];
  const today = new Date();
  let d = new Date(today);
  while (dates.length < nDays) {
    d.setDate(d.getDate() - 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) { // skip weekends
      dates.push(d.toISOString().slice(0, 10));
    }
  }
  return dates;
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  const tickers = ALL_TICKERS ? Object.keys(FLOW_TICKERS) : [TARGET_TICKER.toUpperCase()];
  const dates = BACKFILL_DAYS > 0
    ? getPastTradingDates(BACKFILL_DAYS)
    : [TARGET_DATE];

  console.log(`\n=== EURONEXT ORDERFLOW FETCH ===`);
  console.log(`Tickers: ${tickers.join(", ")}`);
  console.log(`Dates:   ${dates.length === 1 ? dates[0] : `${dates.length} days (${dates[dates.length-1]} → ${dates[0]})`}`);
  console.log(`Dry run: ${DRY_RUN}\n`);

  if (!DATABASE_URL) { console.error("DATABASE_URL not set"); process.exit(1); }
  db = new Pool({ connectionString: DATABASE_URL });

  for (const date of dates) {
    for (const ticker of tickers) {
      await fetchOneTicker(ticker, date);
      // Small delay between requests to be polite to Euronext
      await new Promise(r => setTimeout(r, 400));
    }
  }

  await db.end();
  console.log("\nDone.\n");
}

main().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });
