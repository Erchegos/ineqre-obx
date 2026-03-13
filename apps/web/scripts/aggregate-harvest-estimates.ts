/**
 * Aggregate Harvest Trip Data into Quarterly Estimates
 *
 * Groups harvest_trips by company/quarter, computes:
 * - Trip count, total estimated volume
 * - Volume-weighted average spot price
 * - Comparison with actual quarterly ops (when available)
 *
 * Run: npx tsx scripts/aggregate-harvest-estimates.ts [--dry-run]
 */

import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

import pg from "pg";
const { Pool } = pg;
const connStr = (process.env.DATABASE_URL || "").trim().replace(/^["']|["']$/g, "").replace(/[?&]sslmode=\w+/g, "");
const pool = new Pool({ connectionString: connStr, ssl: { rejectUnauthorized: false } });

const DRY_RUN = process.argv.includes("--dry-run");

const COMPANY_NAMES: Record<string, string> = {
  MOWI: "Mowi ASA",
  SALM: "SalMar ASA",
  LSG: "Lerøy Seafood Group ASA",
  GSF: "Grieg Seafood ASA",
  BAKKA: "Bakkafrost ASA",
  AUSS: "Austevoll Seafood ASA",
};

async function main() {
  console.log("═══════════════════════════════════════════════════");
  console.log("  Aggregate Harvest Quarterly Estimates");
  console.log("═══════════════════════════════════════════════════\n");
  if (DRY_RUN) console.log("(DRY RUN)\n");

  // 1. Aggregate trips by company/quarter
  const { rows: aggregates } = await pool.query(`
    SELECT
      origin_ticker AS ticker,
      EXTRACT(YEAR FROM departure_time)::int AS year,
      EXTRACT(QUARTER FROM departure_time)::int AS quarter,
      COUNT(*)::int AS trip_count,
      SUM(estimated_volume_tonnes)::float AS total_volume,
      CASE
        WHEN SUM(CASE WHEN spot_price_at_harvest IS NOT NULL THEN estimated_volume_tonnes ELSE 0 END) > 0
        THEN SUM(COALESCE(spot_price_at_harvest, 0) * estimated_volume_tonnes) /
             NULLIF(SUM(CASE WHEN spot_price_at_harvest IS NOT NULL THEN estimated_volume_tonnes ELSE 0 END), 0)
        ELSE NULL
      END::float AS vwap_price
    FROM harvest_trips
    WHERE origin_ticker IS NOT NULL
    GROUP BY origin_ticker, EXTRACT(YEAR FROM departure_time), EXTRACT(QUARTER FROM departure_time)
    ORDER BY year DESC, quarter DESC, ticker
  `);

  if (aggregates.length === 0) {
    console.log("No harvest trips found. Run fetch-harvest-positions.ts first.");
    await pool.end();
    return;
  }

  console.log(`Found ${aggregates.length} company/quarter combinations\n`);

  // 2. For each aggregate, get actual data from salmon_quarterly_ops
  for (const agg of aggregates) {
    const companyName = COMPANY_NAMES[agg.ticker] || agg.ticker;

    // Get actuals
    const { rows: actuals } = await pool.query(
      `SELECT harvest_tonnes_gwt::float, price_realization_per_kg::float
       FROM salmon_quarterly_ops
       WHERE ticker = $1 AND year = $2 AND quarter = $3`,
      [agg.ticker, agg.year, agg.quarter]
    );

    const actual = actuals[0];
    const actualVolume = actual?.harvest_tonnes_gwt || null;
    const actualPrice = actual?.price_realization_per_kg || null;

    // Calculate accuracy
    let accuracyPct: number | null = null;
    if (actualVolume && agg.total_volume) {
      accuracyPct = ((agg.total_volume - actualVolume) / actualVolume) * 100;
    }

    const label = `${agg.ticker.padEnd(6)} Q${agg.quarter} ${agg.year}`;
    const estVol = agg.total_volume ? `${Math.round(agg.total_volume)}t` : "N/A";
    const estPrice = agg.vwap_price ? `${agg.vwap_price.toFixed(2)} NOK` : "N/A";
    const actVol = actualVolume ? `${Math.round(actualVolume)}t` : "—";
    const actPrice = actualPrice ? `${actualPrice.toFixed(2)} NOK` : "—";
    const accStr = accuracyPct != null ? `${accuracyPct > 0 ? "+" : ""}${accuracyPct.toFixed(1)}%` : "—";

    console.log(`  ${label}  Est: ${estVol.padEnd(8)} @ ${estPrice.padEnd(10)}  Act: ${actVol.padEnd(8)} @ ${actPrice.padEnd(10)}  Acc: ${accStr}`);

    if (!DRY_RUN) {
      await pool.query(
        `INSERT INTO harvest_quarterly_estimates
          (ticker, company_name, year, quarter, estimated_harvest_tonnes,
           trip_count, estimated_avg_price_nok,
           actual_harvest_tonnes, actual_price_realization, estimation_accuracy_pct, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
         ON CONFLICT (ticker, year, quarter) DO UPDATE SET
           estimated_harvest_tonnes = EXCLUDED.estimated_harvest_tonnes,
           trip_count = EXCLUDED.trip_count,
           estimated_avg_price_nok = EXCLUDED.estimated_avg_price_nok,
           actual_harvest_tonnes = EXCLUDED.actual_harvest_tonnes,
           actual_price_realization = EXCLUDED.actual_price_realization,
           estimation_accuracy_pct = EXCLUDED.estimation_accuracy_pct,
           updated_at = NOW()`,
        [
          agg.ticker, companyName, agg.year, agg.quarter,
          agg.total_volume ? Math.round(agg.total_volume) : null,
          agg.trip_count,
          agg.vwap_price ? agg.vwap_price.toFixed(2) : null,
          actualVolume ? Math.round(actualVolume) : null,
          actualPrice ? actualPrice.toFixed(2) : null,
          accuracyPct ? accuracyPct.toFixed(2) : null,
        ]
      );
    }
  }

  console.log("\nDone.");
  await pool.end();
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
