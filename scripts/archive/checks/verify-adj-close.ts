#!/usr/bin/env tsx
import { Pool } from 'pg';
import dotenv from 'dotenv';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
dotenv.config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  console.log('='.repeat(70));
  console.log('VERIFYING DIVIDEND ADJUSTMENT - EQNR');
  console.log('='.repeat(70));

  console.log('\n=== EQNR (OSE) - Recent Prices ===\n');
  const recent = await pool.query(`
    SELECT date::text, close::numeric(10,2), adj_close::numeric(10,2),
           ROUND((close::numeric - adj_close::numeric), 2) as diff
    FROM prices_daily
    WHERE ticker = 'EQNR'
    ORDER BY date DESC LIMIT 3
  `);
  console.table(recent.rows);

  console.log('\n=== EQNR (OSE) - Old Prices (pre-2020) ===');
  console.log('Should show significant difference due to cumulative dividends\n');
  const old = await pool.query(`
    SELECT date::text, close::numeric(10,2), adj_close::numeric(10,2),
           ROUND((close::numeric - adj_close::numeric), 2) as diff,
           ROUND(((close::numeric - adj_close::numeric) / close::numeric * 100), 2) as diff_pct
    FROM prices_daily
    WHERE ticker = 'EQNR' AND date < '20200101'
    ORDER BY date DESC LIMIT 5
  `);
  console.table(old.rows);

  console.log('\n=== EQNR.US (NYSE) - Old Prices (pre-2020) ===\n');
  const usOld = await pool.query(`
    SELECT date::text, close::numeric(10,2), adj_close::numeric(10,2),
           ROUND((close::numeric - adj_close::numeric), 2) as diff,
           ROUND(((close::numeric - adj_close::numeric) / close::numeric * 100), 2) as diff_pct
    FROM prices_daily
    WHERE ticker = 'EQNR.US' AND date < '20200101'
    ORDER BY date DESC LIMIT 5
  `);
  console.table(usOld.rows);

  console.log('\n='.repeat(70));
  if (old.rows[0]?.diff_pct && parseFloat(old.rows[0].diff_pct) > 5) {
    console.log('✅ DIVIDEND ADJUSTMENT WORKING!');
    console.log(`   Old prices show ${old.rows[0].diff_pct}% difference between close and adj_close`);
  } else {
    console.log('⚠️  WARNING: Dividend adjustment may not be working');
    console.log('   Expected to see >5% difference in old prices');
  }
  console.log('='.repeat(70));

  await pool.end();
}

main();
