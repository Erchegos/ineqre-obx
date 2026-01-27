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
  // Update US-listed stocks to mark them as "Dual Listed (US)"
  const usStocks = [
    { ticker: 'BORR', name: 'Borr Drilling Ltd (Dual Listed US)' },
    { ticker: 'BWLP', name: 'BW LPG Ltd (Dual Listed US)' },
    { ticker: 'CDLR', name: 'Cadeler A/S (Dual Listed US)' },
    { ticker: 'ECO', name: 'Okeanis Eco Tankers (Dual Listed US)' },
    { ticker: 'HAFN', name: 'Hafnia Ltd (Dual Listed US)' },
    { ticker: 'HSHP', name: 'Hamilton Shipping Partners (Dual Listed US)' },
    { ticker: 'EQNR', name: 'Equinor ASA (Dual Listed US)' },
    { ticker: 'FRO', name: 'Frontline Ltd (Dual Listed US)' }
  ];

  console.log('Updating dual-listed stock names...\n');

  for (const stock of usStocks) {
    // Only update US-listed versions (USD currency)
    const result = await pool.query(
      'UPDATE stocks SET name = $1 WHERE ticker = $2 AND currency = $3',
      [stock.name, stock.ticker, 'USD']
    );

    if (result.rowCount && result.rowCount > 0) {
      console.log(`✓ Updated ${stock.ticker} (US): ${stock.name}`);
    }
  }

  // Verify updates
  console.log('\n' + '='.repeat(70));
  console.log('Dual-listed stocks in database:');
  console.log('='.repeat(70) + '\n');

  const result = await pool.query(`
    SELECT ticker, name, exchange, currency, sector
    FROM stocks
    WHERE ticker IN ('BORR', 'BWLP', 'CDLR', 'ECO', 'HAFN', 'HSHP', 'EQNR', 'FRO', 'OET')
    ORDER BY ticker, exchange
  `);

  result.rows.forEach(row => {
    console.log(`${row.ticker.padEnd(6)} (${row.exchange.padEnd(6)}, ${row.currency}): ${row.name}`);
  });

  await pool.end();
}

main();
