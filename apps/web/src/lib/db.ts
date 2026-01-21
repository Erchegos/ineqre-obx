import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";

const globalForDb = globalThis as unknown as {
  pool: Pool | undefined;
};

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not defined");
}

function createPool() {
  try {
    // Clean the URL - remove quotes and query params
    let cleanUrl = process.env.DATABASE_URL!.trim();
    // Remove surrounding quotes if present
    cleanUrl = cleanUrl.replace(/^["']|["']$/g, '');
    // Remove query params for manual parsing
    cleanUrl = cleanUrl.split('?')[0];

    // Parse manually to ensure SSL config is applied
    const dbUrl = new URL(cleanUrl);

    return new Pool({
      host: dbUrl.hostname,
      port: parseInt(dbUrl.port),
      database: dbUrl.pathname.slice(1),
      user: dbUrl.username,
      password: dbUrl.password,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 20000,
      ssl: {
        rejectUnauthorized: false
      }
    });
  } catch (error) {
    console.error("Failed to create database pool:", error);
    throw error;
  }
}

export const pool = globalForDb.pool ?? createPool();

pool.on('error', (err) => {
  console.error('[DB POOL ERROR]', err);
});

pool.on('connect', () => {
  console.log('[DB POOL] Client connected');
});

if (process.env.NODE_ENV !== "production") {
  globalForDb.pool = pool;
}

export const db = drizzle(pool);