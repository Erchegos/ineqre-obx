#!/usr/bin/env tsx
import { Pool } from "pg";
import dotenv from "dotenv";

dotenv.config();

// Disable SSL cert validation for development
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: false,
});

async function main() {
  try {
    // Check sector distribution
    const result = await pool.query(`
      SELECT sector, COUNT(*) as count
      FROM stocks
      GROUP BY sector
      ORDER BY count DESC
    `);

    console.log("Sector Distribution:");
    console.log("=".repeat(50));
    result.rows.forEach(row => {
      console.log(`${row.sector || 'NULL'}: ${row.count}`);
    });

    // Show some examples with sectors
    const examples = await pool.query(`
      SELECT ticker, name, sector
      FROM stocks
      WHERE sector IS NOT NULL
      LIMIT 10
    `);

    console.log("\nExamples with sectors:");
    console.log("=".repeat(50));
    examples.rows.forEach(row => {
      console.log(`${row.ticker}: ${row.name} (${row.sector})`);
    });

  } catch (error) {
    console.error("Error:", error);
  } finally {
    await pool.end();
  }
}

main();
