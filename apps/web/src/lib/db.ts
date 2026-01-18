import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";

const globalForDb = globalThis as unknown as {
  pool: Pool | undefined;
};

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not defined");
}

// Parse the connection URL manually
const dbUrl = new URL(process.env.DATABASE_URL.split('?')[0]);

export const pool =
  globalForDb.pool ??
  new Pool({
    host: dbUrl.hostname,
    port: parseInt(dbUrl.port),
    database: dbUrl.pathname.slice(1), // remove leading /
    user: dbUrl.username,
    password: dbUrl.password,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 20000,
    ssl: {
      rejectUnauthorized: false
    }
  });

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