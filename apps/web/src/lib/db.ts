// Use require() for pg to avoid Node 24 ESM resolution error
// (pg lacks "exports" field, breaking strict ESM resolve)
import type { Pool as PoolType } from "pg";
const { Pool } = require("pg") as typeof import("pg");
import { drizzle } from "drizzle-orm/node-postgres";

const globalForDb = globalThis as unknown as {
  pool: PoolType | undefined;
  db: ReturnType<typeof drizzle> | undefined;
};

function createPool() {
  try {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL is not defined");
    }

    // Use connection string directly for better compatibility with Vercel
    let connectionString = process.env.DATABASE_URL.trim().replace(/^["']|["']$/g, '');

    // Remove sslmode parameter if present - we'll handle SSL in config
    connectionString = connectionString.replace(/[?&]sslmode=\w+/g, '');

    const newPool = new Pool({
      connectionString,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
      ssl: {
        rejectUnauthorized: false
      },
      query_timeout: 30000, // Increased from 10s to 30s for large queries
      statement_timeout: 30000
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

// Export a getter function instead of calling it at module load time
export function getPool(): PoolType {
  if (!globalForDb.pool) {
    globalForDb.pool = createPool();
  }
  return globalForDb.pool;
}

// Lazy getter for pool - don't initialize until accessed
export const pool = new Proxy({} as PoolType, {
  get(target, prop) {
    const actualPool = getPool();
    const value = (actualPool as any)[prop];
    return typeof value === 'function' ? value.bind(actualPool) : value;
  }
});

// Lazy getter for db
export const db = new Proxy({} as ReturnType<typeof drizzle>, {
  get(target, prop) {
    if (!globalForDb.db) {
      globalForDb.db = drizzle(getPool());
    }
    const value = (globalForDb.db as any)[prop];
    return typeof value === 'function' ? value.bind(globalForDb.db) : value;
  }
});