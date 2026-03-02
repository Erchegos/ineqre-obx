/**
 * Ocean Conditions Aggregator
 *
 * Aggregates sea temperature data from existing seafood_lice_reports
 * into per-production-area weekly summaries.
 *
 * No external API calls — pure SQL aggregation of existing data.
 *
 * Run: npx tsx scripts/fetch-ocean-conditions.ts
 * Options:
 *   --dry-run   Print but don't insert
 *   --weeks=52  Limit to last N weeks (default: all)
 */

import { Pool } from "pg";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

const dbUrl = (process.env.DATABASE_URL || "").trim().replace(/^["']|["']$/g, "");
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
const pool = new Pool({ connectionString: dbUrl });

const DRY_RUN = process.argv.includes("--dry-run");
const WEEKS_LIMIT = parseInt(
  process.argv.find((a) => a.startsWith("--weeks="))?.split("=")[1] ?? "0"
);

async function main() {
  console.log("=== Ocean Conditions Aggregator ===\n");

  // 1) Check source data
  const sourceCount = await pool.query(`
    SELECT COUNT(*) as total,
           COUNT(sea_temperature) as with_temp,
           MIN(year) as min_year, MAX(year) as max_year
    FROM seafood_lice_reports
  `);
  const src = sourceCount.rows[0];
  console.log(
    `Source: ${src.total} lice reports, ${src.with_temp} with temperature data (${src.min_year}-${src.max_year})`
  );

  if (parseInt(src.with_temp) === 0) {
    console.log("No temperature data available. Run fetch-barentswatch-seafood.ts first.");
    await pool.end();
    return;
  }

  // 2) Aggregate: join lice reports with localities to get production area
  const weekFilter =
    WEEKS_LIMIT > 0
      ? `AND (lr.year * 100 + lr.week) >= (
           EXTRACT(YEAR FROM NOW())::int * 100 +
           EXTRACT(WEEK FROM NOW())::int - ${WEEKS_LIMIT}
         )`
      : "";

  const aggQuery = `
    SELECT
      sl.production_area_number as area_number,
      lr.year,
      lr.week,
      ROUND(AVG(lr.sea_temperature::numeric), 2) as avg_sea_temp,
      ROUND(MIN(lr.sea_temperature::numeric), 2) as min_sea_temp,
      ROUND(MAX(lr.sea_temperature::numeric), 2) as max_sea_temp,
      COUNT(DISTINCT lr.locality_id) as reporting_sites
    FROM seafood_lice_reports lr
    JOIN seafood_localities sl ON sl.locality_id = lr.locality_id
    WHERE lr.sea_temperature IS NOT NULL
      AND lr.sea_temperature::numeric > 0
      AND sl.production_area_number IS NOT NULL
      ${weekFilter}
    GROUP BY sl.production_area_number, lr.year, lr.week
    ORDER BY lr.year, lr.week, sl.production_area_number
  `;

  console.log("Aggregating sea temperature by production area + week ...");
  const aggResult = await pool.query(aggQuery);
  const rows = aggResult.rows;
  console.log(`  Aggregated ${rows.length} area-week rows\n`);

  if (rows.length === 0) {
    console.log("No aggregated data. Check if localities have production_area_number set.");
    await pool.end();
    return;
  }

  if (DRY_RUN) {
    console.log("DRY RUN — last 10 rows:");
    for (const r of rows.slice(-10)) {
      console.log(
        `  Area ${r.area_number} | ${r.year}-W${String(r.week).padStart(2, "0")} | ` +
          `avg=${r.avg_sea_temp}°C | min=${r.min_sea_temp} | max=${r.max_sea_temp} | sites=${r.reporting_sites}`
      );
    }
    await pool.end();
    return;
  }

  // 3) Upsert into seafood_ocean_conditions
  console.log("Upserting into seafood_ocean_conditions ...");

  const BATCH_SIZE = 100;
  let totalUpserted = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const valuesArr: string[] = [];
    const params: (string | number | null)[] = [];
    let pIdx = 1;

    for (const r of batch) {
      valuesArr.push(
        `($${pIdx}, $${pIdx + 1}, $${pIdx + 2}, $${pIdx + 3}, $${pIdx + 4}, $${pIdx + 5}, $${pIdx + 6})`
      );
      params.push(
        r.area_number,
        r.year,
        r.week,
        r.avg_sea_temp,
        r.min_sea_temp,
        r.max_sea_temp,
        r.reporting_sites
      );
      pIdx += 7;
    }

    const sql = `
      INSERT INTO seafood_ocean_conditions
        (area_number, year, week, avg_sea_temp, min_sea_temp, max_sea_temp, reporting_sites)
      VALUES ${valuesArr.join(",\n")}
      ON CONFLICT (area_number, year, week) DO UPDATE SET
        avg_sea_temp = EXCLUDED.avg_sea_temp,
        min_sea_temp = EXCLUDED.min_sea_temp,
        max_sea_temp = EXCLUDED.max_sea_temp,
        reporting_sites = EXCLUDED.reporting_sites
    `;

    const result = await pool.query(sql, params);
    totalUpserted += result.rowCount || 0;
  }

  console.log(`  Upserted ${totalUpserted} rows`);

  // 4) Summary
  const summary = await pool.query(`
    SELECT area_number,
           COUNT(*) as weeks,
           MIN(year || '-W' || LPAD(week::text, 2, '0')) as from_week,
           MAX(year || '-W' || LPAD(week::text, 2, '0')) as to_week,
           ROUND(AVG(avg_sea_temp::numeric), 1) as mean_temp
    FROM seafood_ocean_conditions
    GROUP BY area_number
    ORDER BY area_number
  `);
  console.log("\nSummary by area:");
  for (const r of summary.rows) {
    console.log(
      `  Area ${String(r.area_number).padStart(2)}: ${r.weeks} weeks, ${r.from_week} → ${r.to_week}, mean=${r.mean_temp}°C`
    );
  }

  await pool.end();
  console.log("\nDone!");
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
