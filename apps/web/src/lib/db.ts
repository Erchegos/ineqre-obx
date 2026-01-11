// apps/web/src/lib/db.ts
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";

const raw = process.env.DATABASE_URL;

if (!raw) {
  throw new Error("DATABASE_URL is missing");
}

function stripSslMode(cs: string) {
  try {
    const u = new URL(cs);
    u.searchParams.delete("sslmode");
    return u.toString();
  } catch {
    return cs;
  }
}

function isSupabase(cs: string) {
  const s = cs.toLowerCase();
  return s.includes("supabase.com") || s.includes("pooler.supabase.com");
}

const connectionString = stripSslMode(raw);

export const pool = new Pool({
  connectionString,
  ssl: isSupabase(connectionString) ? { rejectUnauthorized: false } : undefined,
  max: 5,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

export const db = drizzle(pool);
