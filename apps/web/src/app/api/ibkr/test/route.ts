/**
 * IBKR Gateway Connection Test API
 * POST /api/ibkr/test
 *
 * Tests connection to IB Gateway on port 4002
 */

import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    // Test connection to IB Gateway
    const response = await fetch("https://localhost:5000/v1/api/iserver/auth/status", {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
      // @ts-ignore - Node.js fetch supports this
      agent: new (await import("https")).Agent({
        rejectUnauthorized: false,
      }),
    }).catch((e) => {
      console.error("IBKR connection error:", e.message);
      return null;
    });

    if (!response || !response.ok) {
      return NextResponse.json({
        success: false,
        message: "IB Gateway not responding",
        port: 4002,
      });
    }

    const data = await response.json();

    return NextResponse.json({
      success: data.authenticated || false,
      message: data.authenticated ? "Connected to IB Gateway" : "Not authenticated",
      port: 4002,
      data,
    });
  } catch (error: any) {
    console.error("[IBKR Test] Error:", error);
    return NextResponse.json(
      {
        success: false,
        message: error.message || "Connection failed",
        port: 4002,
      },
      { status: 500 }
    );
  }
}
