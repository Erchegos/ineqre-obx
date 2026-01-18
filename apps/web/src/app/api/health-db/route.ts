import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const result: any = {
    status: "starting",
    timestamp: new Date().toISOString(),
  };

  try {
    // Import pool inside try block to catch import errors
    const { pool } = await import("@/lib/db");
    result.poolCreated = "✓";

    // Test basic connection
    const timeResult = await pool.query("SELECT NOW() as time");
    result.connection = "✓ Connected";
    result.dbTime = timeResult.rows[0].time;

    // Check tables
    const tablesResult = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name
    `);
    result.tables = tablesResult.rows.map(r => r.table_name);

    result.status = "✓ Success";
    return NextResponse.json(result, { status: 200 });

  } catch (error: any) {
    result.status = "✗ Failed";
    result.error = error.message;
    result.errorName = error.name;
    result.errorCode = error.code;
    result.errorDetail = error.detail;
    result.errorHint = error.hint;
    
    // Include stack trace for debugging
    if (process.env.NODE_ENV === "production") {
      result.stack = error.stack?.split('\n').slice(0, 5);
    }
    
    return NextResponse.json(result, { status: 500 });
  }
}