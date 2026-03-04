import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const dynamic = "force-dynamic";

type PriceTarget = {
  date: string;
  company: string;
  broker: string | null;
  action: string;
  rating: string | null;
  ratingColor: string | null;
  documentId: string;
};

/**
 * Parse price target lines from Xtrainvestor ai_summary.
 * Format: - **Company**: Broker action target to NOK X (Y), Rating
 */
function parsePriceTargets(
  summary: string,
  date: string,
  documentId: string,
  matchNames: string[]
): PriceTarget[] {
  const results: PriceTarget[] = [];
  const lines = summary.split("\n");

  for (const line of lines) {
    const ptMatch = line.match(/^- \*\*(.+?)\*\*:\s*(.+)/);
    if (
      !ptMatch ||
      !/target|kursmål|reiterat|downgrad|upgrad|initiat|cut|adjust|øker|kutter|maintained|raised|lowered/i.test(
        ptMatch[2]
      )
    )
      continue;

    const [, company, details] = ptMatch;

    // Check if this company matches any of the target names
    const companyLower = company.toLowerCase().trim();
    const matched = matchNames.some((name) => {
      const nameLower = name.toLowerCase();
      return (
        companyLower === nameLower ||
        companyLower.includes(nameLower) ||
        nameLower.includes(companyLower)
      );
    });
    if (!matched) continue;

    // Extract rating
    const ratingEnd = details.match(
      /(Buys?|Holds?|Sells?|Neutral|Kjøp|Nøytral|Selg)\s*$/i
    );
    const ratingMid = !ratingEnd
      ? details.match(
          /(?:downgrad|upgrad|initiat)\w*\s+(?:from\s+\w+\s+)?to\s+(Buy|Hold|Sell|Neutral|Kjøp|Nøytral|Selg)/i
        )
      : null;
    const ratingRaw = ratingEnd
      ? ratingEnd[1]
      : ratingMid
        ? ratingMid[1]
        : null;
    const ratingText = ratingRaw ? ratingRaw.replace(/s$/i, "") : null;
    const ratingColor =
      ratingText && /buy|kjøp/i.test(ratingText)
        ? "#22c55e"
        : ratingText && /sell|selg/i.test(ratingText)
          ? "#ef4444"
          : ratingText
            ? "#f59e0b"
            : null;

    // Extract broker
    const brokerMatch = details.match(
      /^([\w\s]+?)\s+(downgrad|upgrad|increas|cut|adjust|reiterat|initiat|øker|kutter|gjentar|set|raised|lowered|maintained)/i
    );
    const broker = brokerMatch ? brokerMatch[1].trim() : null;
    const action = broker
      ? details
          .substring(broker.length)
          .replace(
            /,\s*(Buys?|Holds?|Sells?|Neutral|Kjøp|Nøytral|Selg)\s*$/i,
            ""
          )
          .trim()
      : details
          .replace(
            /,\s*(Buys?|Holds?|Sells?|Neutral|Kjøp|Nøytral|Selg)\s*$/i,
            ""
          )
          .trim();

    results.push({
      date,
      company: company.trim(),
      broker,
      action,
      rating: ratingText,
      ratingColor,
      documentId,
    });
  }

  return results;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const { ticker } = await params;

  if (!ticker || !/^[A-Za-z0-9._-]+$/.test(ticker)) {
    return NextResponse.json({ error: "Invalid ticker" }, { status: 400 });
  }

  try {
    // Get the company name for this ticker
    const stockResult = await pool.query(
      `SELECT ticker, name FROM stocks WHERE ticker = $1`,
      [ticker]
    );

    if (stockResult.rows.length === 0) {
      return NextResponse.json(
        { error: "Ticker not found" },
        { status: 404 }
      );
    }

    const stock = stockResult.rows[0];
    // Build match names: ticker, full name, and common short forms
    const matchNames: string[] = [stock.name];

    // Add common short names (e.g., "Aker BP" from "Aker BP ASA")
    if (stock.name) {
      const withoutSuffix = stock.name
        .replace(/\s+(ASA|AS|Holding|Group|Ltd|Inc|plc)\.?$/i, "")
        .trim();
      if (withoutSuffix !== stock.name) matchNames.push(withoutSuffix);
    }

    // Get Xtrainvestor articles with summaries from last 90 days
    const docsResult = await pool.query(
      `SELECT id, ai_summary, received_date
       FROM research_documents
       WHERE source = 'Xtrainvestor'
         AND ai_summary IS NOT NULL
         AND ai_summary != ''
         AND received_date > NOW() - INTERVAL '90 days'
       ORDER BY received_date DESC
       LIMIT 100`,
      []
    );

    // Parse price targets from each document
    const allTargets: PriceTarget[] = [];

    for (const doc of docsResult.rows) {
      const date = new Date(doc.received_date).toISOString().split("T")[0];
      const targets = parsePriceTargets(
        doc.ai_summary,
        date,
        doc.id,
        matchNames
      );
      allTargets.push(...targets);
    }

    return NextResponse.json({
      ticker,
      companyName: stock.name,
      targets: allTargets,
    });
  } catch (error) {
    console.error("[PRICE TARGETS API]", error);
    return NextResponse.json(
      { error: "Failed to fetch price targets" },
      { status: 500 }
    );
  }
}
