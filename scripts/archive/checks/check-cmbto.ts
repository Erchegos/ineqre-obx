#!/usr/bin/env tsx
import { Pool } from 'pg';
import dotenv from 'dotenv';
dotenv.config();
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: false });

async function main() {
  const cf = await pool.query("SELECT ticker, company_name FROM company_fundamentals WHERE ticker = 'CMBTO'");
  console.log('company_fundamentals:', cf.rows);

  const st = await pool.query("SELECT ticker, name FROM stocks WHERE ticker = 'CMBTO'");
  console.log('stocks:', st.rows);

  await pool.end();
}

main();
