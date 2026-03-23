/**
 * Fetch Shipping Market Rates
 * ============================
 * Fetches Baltic Dry Index (BDI) from Investing.com (Yahoo Finance dropped ^BDI in 2026)
 * and stores in shipping_market_rates.
 *
 * Usage:
 *   pnpm run shipping:rates              # Fetch last 365 days
 *   pnpm run shipping:rates -- --days=30 # Fetch last 30 days
 *   pnpm run shipping:rates -- --dry-run # Preview without writing
 *
 * Data source: Investing.com historical data page (free, no auth)
 *   BDI = Baltic Dry Index (https://www.investing.com/indices/baltic-dry-historical-data)
 *   Data is embedded in server-side rendered Next.js __NEXT_DATA__ JSON.
 *
 * Note: BDTI, BCTI, and vessel-class TCE rates come from Pareto Shipping Daily PDFs.
 * See parse-shipping-daily.ts and 015_seed_shipping.sql.
 */

import * as dotenv from "dotenv";
import { Pool } from "pg";

dotenv.config({ path: "../../.env" });
dotenv.config({ path: ".env" });

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL.trim().replace(/^["']|["']$/g, ""),
  ssl: { rejectUnauthorized: false },
});

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const daysArg = args.find((a) => a.startsWith("--days="));
const days = daysArg ? parseInt(daysArg.split("=")[1], 10) : 365;

// Investing.com page for BDI historical data
const BDI_URL = "https://www.investing.com/indices/baltic-dry-historical-data";

/**
 * Deep-search an object for a `historicalData.data` array.
 * Used as fallback when Investing.com changes their Next.js data shape.
 */
function findHistoricalData(obj: any, depth = 0): any[] | null {
  if (depth > 8 || obj === null || typeof obj !== "object") return null;
  if (Array.isArray(obj)) return null;
  if (
    obj.historicalData &&
    Array.isArray(obj.historicalData?.data) &&
    obj.historicalData.data.length > 0 &&
    obj.historicalData.data[0]?.rowDateTimestamp
  ) {
    return obj.historicalData.data;
  }
  for (const key of Object.keys(obj)) {
    const found = findHistoricalData(obj[key], depth + 1);
    if (found) return found;
  }
  return null;
}

/**
 * Fetch BDI historical data from Investing.com.
 * Data is embedded in the server-rendered __NEXT_DATA__ JSON blob under
 * pageProps.state.historyReducer.historicalData.data[].
 * Each row: { rowDate: "Mar 20, 2026", rowDateTimestamp: "2026-03-20T00:00:00Z", last_close: "2,056.00" }
 */
async function fetchBDIFromInvesting(
  days: number
): Promise<Array<{ date: string; value: number }> | null> {
  console.log(`  Fetching BDI from Investing.com...`);

  try {
    const res = await fetch(BDI_URL, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
      },
      signal: AbortSignal.timeout(20000),
    });

    if (!res.ok) {
      console.error(`  Investing.com returned ${res.status}`);
      return null;
    }

    const html = await res.text();

    // Extract __NEXT_DATA__ JSON
    const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]+?)<\/script>/);
    if (!nextDataMatch) {
      console.error("  Could not find __NEXT_DATA__ in response");
      return null;
    }

    const nextData = JSON.parse(nextDataMatch[1]);

    // Navigate to historical data — try known paths, then fall back to deep search
    // Investing.com uses Next.js SSR; path changed to dataStore in 2025+
    const pp = nextData?.props?.pageProps;
    const historicalData =
      pp?.dataStore?.historicalData?.data ??
      pp?.state?.historyReducer?.historicalData?.data ??
      pp?.historicalData?.data ??
      findHistoricalData(nextData) ??
      null;

    if (!historicalData || !Array.isArray(historicalData)) {
      console.error("  Could not locate historicalData in __NEXT_DATA__");
      // Dump top-level keys to help diagnose future path changes
      console.error("  pageProps keys:", Object.keys(pp ?? {}).join(", "));
      return null;
    }

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffStr = cutoff.toISOString().slice(0, 10);

    const points: Array<{ date: string; value: number }> = [];
    for (const row of historicalData) {
      const dateStr = row.rowDateTimestamp?.slice(0, 10) ?? "";
      if (!dateStr || dateStr < cutoffStr) continue;
      const price = parseFloat((row.last_close ?? "").replace(/,/g, ""));
      if (!isNaN(price) && price > 0) {
        points.push({ date: dateStr, value: price });
      }
    }

    // Sort ascending by date
    points.sort((a, b) => a.date.localeCompare(b.date));
    console.log(`  Got ${points.length} BDI data points`);
    return points;
  } catch (err: any) {
    console.error(`  Error fetching BDI:`, err.message);
    return null;
  }
}

async function main() {
  console.log(
    `\nFetch Shipping Rates (days=${days}, dryRun=${dryRun})\n${"=".repeat(50)}`
  );

  // Load existing keys for dedup
  const existingResult = await pool.query(`
    SELECT index_name || '|' || rate_date::text AS key
    FROM shipping_market_rates
  `);
  const existingKeys = new Set(existingResult.rows.map((r) => r.key));
  console.log(`Existing records: ${existingKeys.size}`);

  let totalInserted = 0;

  // Fetch BDI from Investing.com
  console.log(`\n--- Baltic Dry Index (BDI) ---`);
  const points = await fetchBDIFromInvesting(days);
  if (points && points.length > 0) {
    const newPoints = points.filter(
      (p) => !existingKeys.has(`BDI|${p.date}`)
    );
    console.log(
      `  New points: ${newPoints.length} (skipping ${points.length - newPoints.length} existing)`
    );

    if (dryRun) {
      for (const p of newPoints.slice(0, 5)) {
        console.log(`  [DRY RUN] BDI ${p.date}: ${p.value}`);
      }
    } else if (newPoints.length > 0) {
      const batchSize = 100;
      for (let i = 0; i < newPoints.length; i += batchSize) {
        const batch = newPoints.slice(i, i + batchSize);
        const values: string[] = [];
        const params: (string | number)[] = [];
        let paramIdx = 1;
        for (const p of batch) {
          values.push(
            `($${paramIdx}, $${paramIdx + 1}, $${paramIdx + 2}, $${paramIdx + 3}, $${paramIdx + 4}, $${paramIdx + 5})`
          );
          params.push("BDI", "Baltic Dry Index", p.value, "index_points", p.date, "investing.com");
          paramIdx += 6;
        }
        await pool.query(
          `INSERT INTO shipping_market_rates (index_name, index_display_name, rate_value, rate_unit, rate_date, source)
           VALUES ${values.join(", ")}
           ON CONFLICT (index_name, rate_date) DO UPDATE SET
             rate_value = EXCLUDED.rate_value,
             index_display_name = EXCLUDED.index_display_name`,
          params
        );
        totalInserted += batch.length;
      }
      console.log(`  Inserted/updated ${newPoints.length} rows`);
    }
  } else {
    console.log(`  No data returned`);
  }

  console.log(`\n${"=".repeat(50)}`);
  console.log(`Total inserted/updated: ${totalInserted}`);
  console.log(`Done.`);

  await pool.end();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
