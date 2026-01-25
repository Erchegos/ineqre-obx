#!/usr/bin/env tsx
/**
 * Add asset_type column to stocks table and categorize existing assets
 */

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import { Pool } from "pg";
import dotenv from "dotenv";

dotenv.config({ path: "apps/web/.env.local" });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// Define asset categories
const INDEXES = ['OBX', 'OSEBX', 'OSEAX', 'DAX', 'ESTX50', 'SPX', 'NDX', 'VIX'];
const COMMODITY_ETFS = ['USO', 'GLD', 'SLV', 'COPX', 'DBB', 'DBC', 'XLE', 'XOP'];
const INDEX_ETFS = ['SPY', 'QQQ', 'IWM', 'EFA', 'VGK', 'EWN', 'EWD', 'NORW'];

async function main() {
  console.log("Adding asset_type column to stocks table...\n");

  try {
    // Add asset_type column if it doesn't exist
    await pool.query(`
      ALTER TABLE stocks 
      ADD COLUMN IF NOT EXISTS asset_type VARCHAR(20) DEFAULT 'equity'
    `);
    console.log("✓ Added asset_type column");

    // Update indexes
    if (INDEXES.length > 0) {
      await pool.query(`
        UPDATE stocks SET asset_type = 'index' WHERE ticker = ANY($1)
      `, [INDEXES]);
      console.log(`✓ Marked ${INDEXES.length} assets as 'index'`);
    }

    // Update commodity ETFs
    if (COMMODITY_ETFS.length > 0) {
      await pool.query(`
        UPDATE stocks SET asset_type = 'commodity_etf' WHERE ticker = ANY($1)
      `, [COMMODITY_ETFS]);
      console.log(`✓ Marked ${COMMODITY_ETFS.length} assets as 'commodity_etf'`);
    }

    // Update index ETFs
    if (INDEX_ETFS.length > 0) {
      await pool.query(`
        UPDATE stocks SET asset_type = 'index_etf' WHERE ticker = ANY($1)
      `, [INDEX_ETFS]);
      console.log(`✓ Marked ${INDEX_ETFS.length} assets as 'index_etf'`);
    }

    // Verify the results
    const result = await pool.query(`
      SELECT asset_type, COUNT(*) as count 
      FROM stocks 
      GROUP BY asset_type 
      ORDER BY count DESC
    `);

    console.log("\n--- Asset Type Summary ---");
    for (const row of result.rows) {
      console.log(`  ${row.asset_type}: ${row.count}`);
    }

    // Show sample of each type
    console.log("\n--- Sample Assets by Type ---");
    const samples = await pool.query(`
      SELECT ticker, name, asset_type 
      FROM stocks 
      ORDER BY asset_type, ticker 
      LIMIT 30
    `);
    
    let currentType = '';
    for (const row of samples.rows) {
      if (row.asset_type !== currentType) {
        currentType = row.asset_type;
        console.log(`\n[${currentType.toUpperCase()}]`);
      }
      console.log(`  ${row.ticker}: ${row.name}`);
    }

    console.log("\n✓ Asset types configured successfully!");

  } catch (error) {
    console.error("Error:", error);
  } finally {
    await pool.end();
  }
}

main();
