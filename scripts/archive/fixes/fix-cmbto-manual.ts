#!/usr/bin/env tsx
import { Pool } from 'pg';
import dotenv from 'dotenv';
dotenv.config();
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: false });

async function main() {
  // Insert CMBTO into company_fundamentals manually
  await pool.query(`
    INSERT INTO company_fundamentals (ticker, company_name, exchange, status, company_type)
    VALUES ('CMBTO', 'CMB Tech NV', 'Euronext Brussels', 'Active', 'Corporation')
    ON CONFLICT (ticker) DO UPDATE SET company_name = 'CMB Tech NV', updated_at = NOW()
  `);
  console.log('Inserted CMBTO into company_fundamentals');

  // Update stocks table with proper name
  await pool.query(`UPDATE stocks SET name = 'CMB Tech NV' WHERE ticker = 'CMBTO'`);
  console.log('Updated stocks table');

  // Verify
  const r = await pool.query("SELECT ticker, company_name FROM company_fundamentals WHERE ticker = 'CMBTO'");
  console.log('Verified:', r.rows);

  await pool.end();
}

main();
