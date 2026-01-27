#!/usr/bin/env tsx
import { Pool } from 'pg';
import dotenv from 'dotenv';
dotenv.config();
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: false });

async function main() {
  const r = await pool.query(`
    SELECT COUNT(*) as cnt FROM prices_daily WHERE ticker = 'MULTI'
  `);
  console.log('MULTI rows:', r.rows[0].cnt);
  await pool.end();
}

main();
