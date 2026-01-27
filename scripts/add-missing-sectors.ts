#!/usr/bin/env tsx
import { Pool } from "pg";
import dotenv from "dotenv";

dotenv.config();
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: false,
});

async function main() {
  const updates = [
    ['CMBTO', 'Technology'],  // Crayon Group - IT services
    ['TGS', 'Energy'],        // TGS ASA - Seismic data
    ['WWIB', 'Shipping'],     // Wilh. Wilhelmsen
  ];

  for (const [ticker, sector] of updates) {
    await pool.query('UPDATE stocks SET sector = $1 WHERE ticker = $2', [sector, ticker]);
    console.log(`✓ ${ticker} → ${sector}`);
  }

  const result = await pool.query('SELECT sector, COUNT(*) as count FROM stocks GROUP BY sector ORDER BY count DESC');
  console.log('\nSector Distribution:');
  console.log('='.repeat(50));
  result.rows.forEach(row => console.log(`${row.sector || 'NULL'}: ${row.count}`));

  await pool.end();
}

main();
