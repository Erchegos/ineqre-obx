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
  const corrections = [
    { ticker: 'NAPA', sector: 'Technology', note: 'Napatech - Technology/Networking equipment' },
    { ticker: 'KOA', sector: 'Industrial', note: 'Komplett ASA - E-commerce/Retail' },
  ];

  console.log('Fixing sector classifications (round 4)...\n');

  for (const { ticker, sector, note } of corrections) {
    // Get current sector
    const current = await pool.query('SELECT sector FROM stocks WHERE ticker = $1', [ticker]);
    const oldSector = current.rows[0]?.sector || 'NULL';

    // Update
    await pool.query('UPDATE stocks SET sector = $1 WHERE ticker = $2', [sector, ticker]);
    console.log(`✓ ${ticker}: ${oldSector} → ${sector} (${note})`);
  }

  // Show updated sector distribution
  const result = await pool.query(`
    SELECT sector, COUNT(*) as count
    FROM stocks
    GROUP BY sector
    ORDER BY count DESC
  `);

  console.log('\nUpdated Sector Distribution:');
  console.log('='.repeat(50));
  result.rows.forEach(row => console.log(`${row.sector || 'NULL'}: ${row.count}`));

  await pool.end();
}

main();
