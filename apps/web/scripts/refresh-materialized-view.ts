import { Client } from "pg";
import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(__dirname, "../.env.local") });

async function main() {
  const db = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await db.connect();
    console.log("Refreshing materialized view...");
    await db.query("REFRESH MATERIALIZED VIEW factor_combined_view");

    const result = await db.query("SELECT COUNT(*) FROM factor_combined_view");
    console.log("✅ Rows in factor_combined_view:", result.rows[0].count);

    // Check a sample
    const sample = await db.query(`
      SELECT ticker, date, mom1m, vol1m, target_return_1m
      FROM factor_combined_view
      WHERE target_return_1m IS NOT NULL
      LIMIT 5
    `);
    console.log("\nSample rows:");
    console.table(sample.rows);
  } catch (error: any) {
    console.error("❌ Error:", error.message);
    process.exit(1);
  } finally {
    await db.end();
  }
}

main();
