#!/usr/bin/env tsx
import { Pool } from 'pg';
import dotenv from 'dotenv';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
dotenv.config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function removeTicker(ticker: string) {
  console.log('='.repeat(70));
  console.log('REMOVING TICKER FROM DATABASE');
  console.log('='.repeat(70));
  console.log(`\nTicker: ${ticker}\n`);

  try {
    // Start transaction
    await pool.query('BEGIN');

    // Delete from prices_daily
    const pricesResult = await pool.query(
      'DELETE FROM prices_daily WHERE ticker = $1',
      [ticker]
    );
    console.log(`✓ Deleted ${pricesResult.rowCount} price records`);

    // Delete from stocks
    const stocksResult = await pool.query(
      'DELETE FROM stocks WHERE ticker = $1',
      [ticker]
    );
    console.log(`✓ Deleted ${stocksResult.rowCount} stock record(s)`);

    // Delete from company_fundamentals if exists
    const fundamentalsResult = await pool.query(
      'DELETE FROM company_fundamentals WHERE ticker = $1',
      [ticker]
    );
    console.log(`✓ Deleted ${fundamentalsResult.rowCount} fundamental record(s)`);

    // Commit transaction
    await pool.query('COMMIT');

    console.log('\n' + '='.repeat(70));
    console.log('✅ COMPLETE');
    console.log('='.repeat(70));
    console.log(`\nTicker "${ticker}" has been removed from the database.\n`);
  } catch (error) {
    await pool.query('ROLLBACK');
    console.error('\n❌ ERROR:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

const ticker = process.argv[2];
if (!ticker) {
  console.error('Usage: tsx remove-ticker.ts <TICKER>');
  console.error('Example: tsx remove-ticker.ts HSHP.US');
  process.exit(1);
}

removeTicker(ticker.toUpperCase());
