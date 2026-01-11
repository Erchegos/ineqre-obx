// apps/web/src/lib/db.ts
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is missing");
}

function shouldRelaxSSL(cs: string) {
  const s = cs.toLowerCase();
  return s.includes("supabase.com") || s.includes("pooler.supabase.com") || process.env.NODE_ENV === "production";
}

export const pool = new Pool({
  connectionString,
  ssl: shouldRelaxSSL(connectionString) ? { rejectUnauthorized: false } : undefined,
  max: 5,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

export const db = drizzle(pool);
