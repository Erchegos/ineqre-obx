#!/usr/bin/env tsx
import { Pool } from 'pg';
import dotenv from 'dotenv';
dotenv.config();
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: false });

// Name fixes
const NAME_FIXES: Record<string, string> = {
  'Sparebank 1 Nord-norge': 'SpareBank 1 Nord-Norge',
  'Sparebank 1 Smn': 'SpareBank 1 SMN',
  'Sparebank 1 Sor-norge ASA': 'SpareBank 1 Sør-Norge ASA',
  'Sparebank 1 Ostlandet': 'SpareBank 1 Østlandet',
  'Leroy Seafood Group ASA': 'Lerøy Seafood Group ASA',
  'Hoegh Autoliners ASA': 'Höegh Autoliners ASA',
  'Aker Bp ASA': 'Aker BP ASA',
  'BW Lpg Ltd': 'BW LPG Ltd',
  'Tgs ASA': 'TGS ASA',
  'Rec Silicon ASA': 'REC Silicon ASA',
  'Akva Group ASA': 'AKVA Group ASA',
  'Cmb.tech NV': 'CMB Tech NV',
};

async function main() {
  console.log('Fixing stock names...\n');

  for (const [oldName, newName] of Object.entries(NAME_FIXES)) {
    // Update stocks table
    const r1 = await pool.query(
      `UPDATE stocks SET name = $2, updated_at = NOW() WHERE name = $1`,
      [oldName, newName]
    );

    // Update company_fundamentals table
    const r2 = await pool.query(
      `UPDATE company_fundamentals SET company_name = $2, updated_at = NOW() WHERE company_name = $1`,
      [oldName, newName]
    );

    if (r1.rowCount! > 0 || r2.rowCount! > 0) {
      console.log(`Fixed: "${oldName}" -> "${newName}"`);
    }
  }

  // Show some sample names
  const samples = await pool.query(`
    SELECT ticker, name FROM stocks
    WHERE ticker IN ('NONG', 'MING', 'SB1NO', 'SPOL', 'LSG', 'HAUTO', 'AKRBP', 'BWLPG', 'TGS', 'RECSI', 'AKVA')
    ORDER BY ticker
  `);
  console.log('\nSample names after fix:');
  console.table(samples.rows);

  await pool.end();
}

main();
