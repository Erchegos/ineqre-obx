import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export const dynamic = "force-dynamic";

/**
 * Returns list of tickers that have optimizer configs available
 */
export async function GET() {
  try {
    const configDir = path.join(process.cwd(), "src/data/optimizer-configs");

    // Check if directory exists
    if (!fs.existsSync(configDir)) {
      return NextResponse.json({
        success: true,
        count: 0,
        tickers: [],
      });
    }

    // Read all JSON files in the directory
    const files = fs.readdirSync(configDir);
    const tickers = files
      .filter(file => file.endsWith(".json"))
      .map(file => file.replace(".json", ""))
      .sort();

    return NextResponse.json({
      success: true,
      count: tickers.length,
      tickers,
    });
  } catch (error: any) {
    console.error("Error fetching optimizer tickers:", error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
