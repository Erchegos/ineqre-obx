import pg from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const connectionString = process.env.DATABASE_URL;

// Check if Supabase
const isSupabase = connectionString?.toLowerCase().includes('supabase');

const pool = new pg.Pool({ 
  connectionString,
  ssl: isSupabase ? { rejectUnauthorized: false } : false
});

async function checkTables() {
  console.log('Checking database tables...\n');
  
  const result = await pool.query(`
    SELECT tablename 
    FROM pg_tables 
    WHERE schemaname = 'public'
    ORDER BY tablename
  `);
  
  console.log('Tables in public schema:');
  result.rows.forEach(r => console.log(' -', r.tablename));
  
  console.log('\nChecking for price data...');
  
  // Try common table names
  const possibleTables = ['prices_daily', 'obx_equities', 'equities', 'daily_prices'];
  
  for (const table of possibleTables) {
    try {
      const count = await pool.query(`SELECT COUNT(*) FROM public.${table} LIMIT 1`);
      console.log(`✓ Table "${table}" exists with ${count.rows[0].count} rows`);
    } catch (e) {
      // Table doesn't exist, skip
    }
  }
  
  await pool.end();
}

checkTables().catch(console.error);
