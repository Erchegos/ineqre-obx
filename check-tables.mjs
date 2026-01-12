import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function checkTables() {
  const result = await pool.query(`
    SELECT tablename 
    FROM pg_tables 
    WHERE schemaname = 'public'
    ORDER BY tablename
  `);
  
  console.log('Tables in public schema:');
  result.rows.forEach(r => console.log(' -', r.tablename));
  
  await pool.end();
}

checkTables().catch(console.error);
