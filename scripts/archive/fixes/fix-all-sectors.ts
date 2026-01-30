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
  // Comprehensive sector corrections
  const corrections = [
    // Shipping companies misclassified as Investment
    { ticker: 'HAVI', sector: 'Shipping', note: 'Havila Shipping' },
    { ticker: 'SOFF', sector: 'Shipping', note: 'Solstad Offshore' },
    { ticker: 'DOFG', sector: 'Shipping', note: 'DOF Group - Offshore/Shipping' },

    // Technology company misclassified as Investment
    { ticker: 'NOD', sector: 'Technology', note: 'Nordic Semiconductor - Semiconductors' },
  ];

  console.log('Comprehensive sector classification fixes...\n');

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

  // Show all companies by sector for verification
  console.log('\n\nAll Companies by Sector:');
  console.log('='.repeat(50));

  const allStocks = await pool.query(`
    SELECT ticker, name, sector
    FROM stocks
    ORDER BY sector, ticker
  `);

  let currentSector = '';
  allStocks.rows.forEach(row => {
    if (row.sector !== currentSector) {
      currentSector = row.sector;
      console.log(`\n${currentSector || 'NULL'}:`);
    }
    console.log(`  ${row.ticker} - ${row.name}`);
  });

  await pool.end();
}

main();
