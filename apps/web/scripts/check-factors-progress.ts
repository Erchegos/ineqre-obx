import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(__dirname, '../.env.local') });

import { pool } from '../src/lib/db';

async function checkProgress() {
  const result = await pool.query(`
    SELECT ticker, COUNT(*) as count
    FROM factor_technical
    GROUP BY ticker
    ORDER BY ticker
  `);

  console.log(`\nFactors inserted for ${result.rows.length} stocks:\n`);
  result.rows.forEach((row: any) => {
    console.log(`  ${row.ticker.padEnd(15)} ${row.count} factors`);
  });

  const total = result.rows.reduce((sum: number, row: any) => sum + parseInt(row.count), 0);
  console.log(`\nTotal: ${total} factors across ${result.rows.length} stocks`);

  // Check missing stocks
  const eligible = await pool.query(`
    SELECT ticker FROM prices_daily
    WHERE adj_close IS NOT NULL AND adj_close > 0
    GROUP BY ticker HAVING COUNT(*) >= 756
    ORDER BY ticker
  `);
  const doneSet = new Set(result.rows.map((row: any) => row.ticker));
  const missing = eligible.rows.filter((r: any) => {
    return doneSet.has(r.ticker) === false;
  });

  if (missing.length > 0) {
    console.log(`\nMissing stocks (${missing.length}):`);
    missing.forEach((r: any) => console.log(`  ${r.ticker}`));
  } else {
    console.log(`\nAll eligible stocks have factors!`);
  }

  await pool.end();
}

checkProgress();
