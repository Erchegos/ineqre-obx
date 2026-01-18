import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const checks: Record<string, any> = {
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
    databaseUrl: process.env.DATABASE_URL ? "✓ Set" : "✗ Missing",
  };

  try {
    // Test 1: Basic connection
    const connResult = await pool.query("SELECT NOW() as current_time");
    checks.connection = "✓ Connected";
    checks.serverTime = connResult.rows[0].current_time;

    // Test 2: Check tables exist
    const tablesResult = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
        AND table_name IN ('stocks', 'prices_daily', 'obx_equities')
      ORDER BY table_name
    `);
    checks.tables = tablesResult.rows.map((r) => r.table_name);

    // Test 3: Check stocks count
    const stocksResult = await pool.query("SELECT COUNT(*) as count FROM stocks");
    checks.stocksCount = Number(stocksResult.rows[0].count);

    // Test 4: Check prices count
    let pricesCount = 0;
    try {
      const pricesResult = await pool.query("SELECT COUNT(*) as count FROM prices_daily WHERE source = 'ibkr'");
      pricesCount = Number(pricesResult.rows[0].count);
    } catch (e) {
      // Try obx_equities if prices_daily doesn't exist
      try {
        const obxResult = await pool.query("SELECT COUNT(*) as count FROM obx_equities WHERE source = 'ibkr'");
        pricesCount = Number(obxResult.rows[0].count);
      } catch (e2) {
        pricesCount = 0;
      }
    }
    checks.pricesCount = pricesCount;

    // Test 5: Check recent data
    try {
      const recentResult = await pool.query(`
        SELECT MAX(date) as latest_date 
        FROM prices_daily 
        WHERE source = 'ibkr'
      `);
      checks.latestPriceDate = recentResult.rows[0].latest_date;
    } catch (e) {
      try {
        const recentResult = await pool.query(`
          SELECT MAX(date) as latest_date 
          FROM obx_equities 
          WHERE source = 'ibkr'
        `);
        checks.latestPriceDate = recentResult.rows[0].latest_date;
      } catch (e2) {
        checks.latestPriceDate = null;
      }
    }

    checks.status = "✓ All checks passed";
    return NextResponse.json(checks, { status: 200 });

  } catch (error: any) {
    checks.status = "✗ Error";
    checks.error = error.message;
    checks.errorStack = error.stack;
    return NextResponse.json(checks, { status: 500 });
  }
}