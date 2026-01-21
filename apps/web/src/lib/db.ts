import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";

const globalForDb = globalThis as unknown as {
  pool: Pool | undefined;
};

function createPool() {
  try {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL is not defined");
    }

    // Use connection string directly for better compatibility with Vercel
    const connectionString = process.env.DATABASE_URL.trim().replace(/^["']|["']$/g, '');

    const newPool = new Pool({
      connectionString,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
      ssl: {
        rejectUnauthorized: false
      },
      query_timeout: 10000
    });

    newPool.on('error', (err) => {
      console.error('[DB POOL ERROR]', err);
    });

    newPool.on('connect', () => {
      console.log('[DB POOL] Client connected');
    });

    return newPool;
  } catch (error) {
    console.error("Failed to create database pool:", error);
    throw error;
  }
}

function getPool(): Pool {
  if (!globalForDb.pool) {
    globalForDb.pool = createPool();
    if (process.env.NODE_ENV !== "production") {
      // Cache in development only
    }
  }
  return globalForDb.pool;
}

export const pool = getPool();

export const db = drizzle(pool);