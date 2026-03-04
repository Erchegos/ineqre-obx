/**
 * Fetch Shipping Market Rates
 * ============================
 * Fetches Baltic Dry Index (BDI) from Yahoo Finance and stores in shipping_market_rates.
 *
 * Usage:
 *   pnpm run shipping:rates              # Fetch last 365 days
 *   pnpm run shipping:rates -- --days=30 # Fetch last 30 days
 *   pnpm run shipping:rates -- --dry-run # Preview without writing
 *
 * Data source: Yahoo Finance (free, no auth)
 *   ^BDI = Baltic Dry Index
 *
 * Note: BDTI, BCTI, and vessel-class TCE rates are not available on Yahoo Finance.
 * Those are manually seeded from Baltic Exchange data / broker reports (Pareto daily shipping report).
 * See 015_seed_shipping.sql for initial seed data.
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

// Yahoo Finance tickers for shipping indices
const INDICES = [
  {
    yahooTicker: "^BDI",
    indexName: "BDI",
    displayName: "Baltic Dry Index",
    unit: "index_points",
  },
  // Other indices not available on Yahoo — manually updated from Pareto/Clarksons reports
  // {
  //   yahooTicker: "???",
  //   indexName: "BDTI",
  //   displayName: "Baltic Dirty Tanker Index",
  //   unit: "index_points",
  // },
];

async function fetchYahooChart(
  symbol: string,
  days: number
): Promise<Array<{ date: string; value: number }> | null> {
  const period2 = Math.floor(Date.now() / 1000);
  const period1 = period2 - days * 86400;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${period1}&period2=${period2}&interval=1d`;

  console.log(`  Fetching ${symbol} from Yahoo Finance...`);

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      },
    });

    if (!res.ok) {
      console.error(`  Yahoo returned ${res.status} for ${symbol}`);
      return null;
    }

    const data = await res.json();
    const result = data?.chart?.result?.[0];
    if (!result) {
      console.error(`  No chart data for ${symbol}`);
      return null;
    }

    const timestamps: number[] = result.timestamp || [];
    const closes: (number | null)[] =
      result.indicators?.quote?.[0]?.close || [];

    const points: Array<{ date: string; value: number }> = [];
    for (let i = 0; i < timestamps.length; i++) {
      const close = closes[i];
      if (close == null) continue;
      const d = new Date(timestamps[i] * 1000);
      const dateStr = d.toISOString().split("T")[0];
      points.push({ date: dateStr, value: close });
    }

    console.log(`  Got ${points.length} data points for ${symbol}`);
    return points;
  } catch (err) {
    console.error(`  Error fetching ${symbol}:`, err);
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

  for (const idx of INDICES) {
    console.log(`\n--- ${idx.displayName} (${idx.indexName}) ---`);

    const points = await fetchYahooChart(idx.yahooTicker, days);
    if (!points || points.length === 0) {
      console.log(`  No data, skipping`);
      continue;
    }

    // Filter to new points only
    const newPoints = points.filter(
      (p) => !existingKeys.has(`${idx.indexName}|${p.date}`)
    );
    console.log(
      `  New points: ${newPoints.length} (skipping ${points.length - newPoints.length} existing)`
    );

    if (dryRun) {
      console.log(`  [DRY RUN] Would insert ${newPoints.length} rows`);
      continue;
    }

    // Batch insert
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
        params.push(
          idx.indexName,
          idx.displayName,
          p.value,
          idx.unit,
          p.date,
          "yahoo"
        );
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

    // Rate limit between API calls
    await new Promise((r) => setTimeout(r, 500));
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
