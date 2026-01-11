import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is missing");
}

const isProd = process.env.NODE_ENV === "production";

export const pool = new Pool({
  connectionString,
  ssl: isProd ? { rejectUnauthorized: false } : undefined,
});

export const db = drizzle(pool);
