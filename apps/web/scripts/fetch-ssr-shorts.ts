/**
 * Finanstilsynet SSR Short Positions Fetcher
 *
 * Fetches short-selling data from the Norwegian FSA Short Sale Register.
 * API: https://ssr.finanstilsynet.no/api/v2/instruments
 *
 * Stores:
 * - Aggregate short positions per ticker per day (short_positions)
 * - Individual holder positions (short_position_holders)
 *
 * Run: pnpm run shorts:fetch
 * Options:
 *   --days=30     Number of days of history to import (default: all)
 *   --dry-run     Print but don't insert
 *   --ticker=EQNR Only process matching ticker
 */

import { Pool } from "pg";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

// ── Config ──
const DAYS_BACK = parseInt(
  process.argv.find((a) => a.startsWith("--days="))?.split("=")[1] ?? "0"
);
const DRY_RUN = process.argv.includes("--dry-run");
const TICKER_FILTER = process.argv
  .find((a) => a.startsWith("--ticker="))
  ?.split("=")[1]?.toUpperCase();

const SSR_API = "https://ssr.finanstilsynet.no/api/v2/instruments";

// ── DB setup ──
const dbUrl = (process.env.DATABASE_URL || "").trim().replace(/^["']|["']$/g, "");
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
const pool = new Pool({ connectionString: dbUrl });

// ── SSR API types ──
interface SSRActivePosition {
  date: string;
  shortPercent: number;
  shares: number;
  positionHolder: string;
}

interface SSREvent {
  date: string;
  shortPercent: number;
  shares: number;
  activePositions: SSRActivePosition[];
}

interface SSRInstrument {
  isin: string;
  issuerName: string;
  events: SSREvent[];
}

// ── Name → Ticker mapping ──
// SSR uses issuerName (uppercase), our DB uses ticker.
// Build mapping from DB stock names, with manual overrides for known mismatches.
const MANUAL_NAME_MAP: Record<string, string> = {
  "2020 BULKERS": "2020",
  "AKER BP": "AKRBP",
  "AKER SOLUTIONS": "AKSO",
  ARCHER: "ARCH",
  "AUTOSTORE HOLDINGS LTD.": "AUTO",
  BAKKAFROST: "BAKKA",
  "BORR DRILLING LIMITED": "BORR.US",
  BORREGAARD: "BRG",
  "BW LPG": "BWLPG",
  "CADELER A/S": "CADLR",
  DNO: "DNO",
  "DOF GROUP ASA": "DOFG",
  ELKEM: "ELK",
  EQUINOR: "EQNR",
  "FLEX LNG": "FLNG.US",
  "GRIEG SEAFOOD": "GSF",
  "HAFNIA LIMITED": "HAFNI",
  "HEXAGON COMPOSITES": "HEX",
  "HOEGH AUTOLINERS ASA": "HAUTO",
  "HUNTER GROUP": "HUNT",
  "IDEX BIOMETRICS": "IDEX",
  KID: "KID",
  KITRON: "KIT",
  "KONGSBERG AUTOMOTIVE": "KOA",
  "LINK MOBILITY GROUP HOLDING": "LINK",
  MOWI: "MOWI",
  "MPC CONTAINER SHIPS": "MPCC",
  NEL: "NEL",
  "NORDIC SEMICONDUCTOR": "NOD",
  "NORSK HYDRO": "NHY",
  "NORWEGIAN AIR SHUTTLE": "NAS",
  OKEA: "OET",
  "OKEANIS ECO TANKERS": "ECO.US",
  PHOTOCURE: "PHO",
  "REC SILICON": "RECSI",
  SALMAR: "SALM",
  "SCATEC ASA": "SCATC",
  "STOLT-NIELSEN": "SNI",
  "SUBSEA 7": "SUBC",
  "TGS ASA": "TGS",
  "TOMRA SYSTEMS": "TOM",
  "VEND MARKETPLACES ASA": "VEND",
  "VÅR ENERGI ASA": "VAR",
  "WALLENIUS WILHELMSEN": "WAWI",
  "YARA INTERNATIONAL": "YAR",
  "SOFTWAREONE HOLDING": "SWON",
  "PANORO ENERGY": "PEN", // Panoro is actually PEN? Let me check
};

async function buildNameToTickerMap(): Promise<Map<string, string>> {
  const nameMap = new Map<string, string>();

  // Load all active stocks from DB
  const { rows: stocks } = await pool.query(
    `SELECT ticker, name FROM stocks WHERE is_active = true`
  );

  // Build fuzzy match map from DB names (uppercase → ticker)
  for (const s of stocks) {
    const name = (s.name as string).toUpperCase();
    nameMap.set(name, s.ticker);
    // Also try without " ASA", " LTD", " SE" suffixes
    const stripped = name
      .replace(/ ASA$/i, "")
      .replace(/ LTD$/i, "")
      .replace(/ SE$/i, "")
      .replace(/ A\/S$/i, "")
      .replace(/ HOLDING$/i, "")
      .replace(/ GROUP$/i, "")
      .trim();
    if (stripped !== name) nameMap.set(stripped, s.ticker);
  }

  // Apply manual overrides (these take precedence)
  for (const [ssrName, ticker] of Object.entries(MANUAL_NAME_MAP)) {
    nameMap.set(ssrName, ticker);
  }

  return nameMap;
}

function resolveTickerForSSR(
  issuerName: string,
  nameMap: Map<string, string>
): string | null {
  const upper = issuerName.toUpperCase();

  // Try exact match first
  if (nameMap.has(upper)) return nameMap.get(upper)!;

  // Try without common suffixes
  const stripped = upper
    .replace(/ ASA$/i, "")
    .replace(/ LTD\.?$/i, "")
    .replace(/ SE$/i, "")
    .replace(/ A\/S$/i, "")
    .replace(/ LIMITED$/i, "")
    .replace(/ HOLDING$/i, "")
    .replace(/ GROUP$/i, "")
    .replace(/ NV$/i, "")
    .replace(/ OYJ$/i, "")
    .trim();
  if (nameMap.has(stripped)) return nameMap.get(stripped)!;

  // Try partial match (SSR name contains DB name or vice versa)
  for (const [key, ticker] of nameMap.entries()) {
    if (upper.includes(key) || key.includes(upper)) return ticker;
  }

  return null;
}

async function main() {
  console.log("═══════════════════════════════════════════════════");
  console.log("  Finanstilsynet SSR Short Positions Fetcher");
  console.log("═══════════════════════════════════════════════════\n");

  // 1. Fetch SSR data
  console.log("Fetching from SSR API...");
  const resp = await fetch(SSR_API);
  if (!resp.ok) {
    console.error(`SSR API error: ${resp.status} ${resp.statusText}`);
    process.exit(1);
  }
  const instruments: SSRInstrument[] = await resp.json();
  console.log(`  ${instruments.length} instruments from SSR\n`);

  // 2. Build name → ticker mapping
  const nameMap = await buildNameToTickerMap();

  // 3. Filter date range
  const cutoffDate = DAYS_BACK
    ? new Date(Date.now() - DAYS_BACK * 86400000).toISOString().slice(0, 10)
    : null;

  // 4. Load existing short_positions for dedup
  const { rows: existingRows } = await pool.query(
    `SELECT DISTINCT ticker || '|' || date::text AS key FROM short_positions`
  );
  const existingKeys = new Set(existingRows.map((r: any) => r.key));
  console.log(`  ${existingKeys.size} existing short_positions rows for dedup\n`);

  // 5. Process each instrument
  let totalPositions = 0;
  let totalHolders = 0;
  let skippedUnmapped = 0;
  let skippedExisting = 0;
  const unmappedNames: string[] = [];

  for (const inst of instruments) {
    const ticker = resolveTickerForSSR(inst.issuerName, nameMap);

    if (!ticker) {
      skippedUnmapped++;
      unmappedNames.push(inst.issuerName);
      continue;
    }

    if (TICKER_FILTER && ticker !== TICKER_FILTER) continue;

    const events = inst.events.filter((e) => {
      if (!cutoffDate) return true;
      return e.date.slice(0, 10) >= cutoffDate;
    });

    if (events.length === 0) continue;

    // Sort events by date (newest first)
    events.sort((a, b) => b.date.localeCompare(a.date));

    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      const dateStr = ev.date.slice(0, 10);
      const key = `${ticker}|${dateStr}`;

      if (existingKeys.has(key)) {
        skippedExisting++;
        continue;
      }

      // Calculate day-over-day change
      const prevEvent = events[i + 1] ?? null;
      const prevPct = prevEvent ? prevEvent.shortPercent : null;
      const changePct =
        prevPct !== null ? ev.shortPercent - prevPct : null;

      if (DRY_RUN) {
        console.log(
          `  [DRY] ${ticker} ${dateStr}: ${ev.shortPercent.toFixed(2)}% (${ev.activePositions.length} holders)`
        );
      } else {
        // Insert aggregate position
        await pool.query(
          `INSERT INTO short_positions (ticker, isin, date, short_pct, total_short_shares, active_positions, prev_short_pct, change_pct)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (ticker, date) DO UPDATE SET
             short_pct = EXCLUDED.short_pct,
             total_short_shares = EXCLUDED.total_short_shares,
             active_positions = EXCLUDED.active_positions,
             prev_short_pct = EXCLUDED.prev_short_pct,
             change_pct = EXCLUDED.change_pct`,
          [
            ticker,
            inst.isin,
            dateStr,
            ev.shortPercent,
            ev.shares || null,
            ev.activePositions.length,
            prevPct,
            changePct,
          ]
        );
        totalPositions++;

        // Insert individual holders
        for (const holder of ev.activePositions) {
          await pool.query(
            `INSERT INTO short_position_holders (ticker, isin, date, position_holder, short_pct, short_shares)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (ticker, date, position_holder) DO UPDATE SET
               short_pct = EXCLUDED.short_pct,
               short_shares = EXCLUDED.short_shares`,
            [
              ticker,
              inst.isin,
              holder.date.slice(0, 10),
              holder.positionHolder,
              holder.shortPercent,
              holder.shares || null,
            ]
          );
          totalHolders++;
        }
      }

      existingKeys.add(key);
    }
  }

  // 6. Summary
  console.log("\n═══════════════════════════════════════════════════");
  console.log("  Summary");
  console.log("═══════════════════════════════════════════════════");
  console.log(`  Instruments from SSR:   ${instruments.length}`);
  console.log(`  Mapped to DB tickers:   ${instruments.length - skippedUnmapped}`);
  console.log(`  Unmapped (no ticker):   ${skippedUnmapped}`);
  console.log(`  Skipped (existing):     ${skippedExisting}`);
  console.log(`  New positions inserted: ${totalPositions}`);
  console.log(`  New holders inserted:   ${totalHolders}`);

  if (unmappedNames.length > 0) {
    console.log(`\n  Unmapped SSR names:`);
    for (const name of unmappedNames.sort()) {
      console.log(`    - ${name}`);
    }
  }

  await pool.end();
  console.log("\nDone.");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
