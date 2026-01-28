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
  // Note: US versions now use .US suffix
  const usStocks = [
    { ticker: 'BORR.US', name: 'Borr Drilling Ltd (Dual Listed US)' },
    { ticker: 'BWLP.US', name: 'BW LPG Ltd (Dual Listed US)' },
    { ticker: 'CDLR', name: 'Cadeler A/S (Dual Listed US)' },
    { ticker: 'ECO.US', name: 'Okeanis Eco Tankers Corp (Dual Listed US)' },
    { ticker: 'HAFN.US', name: 'Hafnia Ltd (Dual Listed US)' },
    { ticker: 'HSHP.US', name: 'Hamilton Shipping Partners (Dual Listed US)' },
    { ticker: 'EQNR.US', name: 'Equinor ASA (Dual Listed US)' },
    { ticker: 'FRO.US', name: 'Frontline Ltd (Dual Listed US)' }
  ];

  console.log('Updating dual-listed stock names...\n');

  for (const stock of usStocks) {
    // Update by ticker (already has .US suffix)
    const result = await pool.query(
      'UPDATE stocks SET name = $1 WHERE ticker = $2',
      [stock.name, stock.ticker]
    );

    if (result.rowCount && result.rowCount > 0) {
      console.log(`✓ Updated ${stock.ticker}: ${stock.name}`);
    } else {
      console.log(`⚠ ${stock.ticker} not found in database`);
    }
  }

  // Verify updates
  console.log('\n' + '='.repeat(70));
  console.log('Dual-listed stocks in database:');
  console.log('='.repeat(70) + '\n');

  const result = await pool.query(`
    SELECT ticker, name, exchange, currency, sector
    FROM stocks
    WHERE ticker IN ('BORR.US', 'BWLP.US', 'CDLR', 'ECO.US', 'HAFN.US', 'HSHP.US', 'EQNR.US', 'FRO.US',
                     'BORR', 'BWLP', 'ECO', 'HAFN', 'EQNR', 'FRO')
    ORDER BY ticker, exchange
  `);

  console.log('US versions (.US suffix):');
  result.rows.filter(r => r.ticker.endsWith('.US')).forEach(row => {
    console.log(`  ${row.ticker.padEnd(10)} (${row.exchange.padEnd(6)}, ${row.currency}): ${row.name}`);
  });

  console.log('\nOSE versions (no suffix):');
  result.rows.filter(r => !r.ticker.endsWith('.US')).forEach(row => {
    console.log(`  ${row.ticker.padEnd(10)} (${row.exchange.padEnd(6)}, ${row.currency}): ${row.name}`);
  });

  await pool.end();
}

main();
