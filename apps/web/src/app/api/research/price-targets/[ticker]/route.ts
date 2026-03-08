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
  targetPrice: number | null;
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

    // Check if this company matches — strict word-boundary matching to avoid
    // "Aker" matching "Aker BP", "Aker Solutions" etc.
    const companyLower = company.toLowerCase().trim();
    const matched = matchNames.some((name) => {
      const nameLower = name.toLowerCase();
      // Exact match
      if (companyLower === nameLower) return true;
      // Word-boundary match: the name must appear as a complete word/phrase
      // e.g. "Aker" matches "Aker" but NOT "Aker BP" or "Aker Solutions"
      const escName = nameLower.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const escComp = companyLower.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      // Company name in summary equals or is contained as whole-word in match name
      if (new RegExp(`^${escComp}$`, "i").test(nameLower)) return true;
      // Match name equals or is contained as whole-word in company (but only if match is multi-word)
      if (nameLower.includes(" ") && new RegExp(`\\b${escName}\\b`, "i").test(companyLower)) return true;
      // Company is multi-word and fully contained as whole words in match name
      if (companyLower.includes(" ") && new RegExp(`\\b${escComp}\\b`, "i").test(nameLower)) return true;
      return false;
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

    // Extract numeric target price (e.g. "NOK 195" or "NOK 195 (190)")
    const tpMatch = details.match(/(?:NOK|SEK|USD|EUR)\s+([\d,.]+)/i);
    const targetPrice = tpMatch ? parseFloat(tpMatch[1].replace(",", "")) : null;

    results.push({
      date,
      company: company.trim(),
      broker,
      action,
      rating: ratingText,
      ratingColor,
      documentId,
      targetPrice,
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

    // Get latest close price for sanity filtering
    const priceResult = await pool.query(
      `SELECT close FROM prices_daily WHERE ticker = $1 ORDER BY date DESC LIMIT 1`,
      [ticker]
    );
    const currentPrice = priceResult.rows.length > 0 ? parseFloat(priceResult.rows[0].close) : null;

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

    // Sanity filter: reject targets where the price is implausible vs current price
    // This catches AI hallucinations (e.g. "Storebrand: NOK 90 Buy" when stock is at 173)
    const saneTargets = currentPrice
      ? allTargets.filter((t) => {
          if (t.targetPrice == null) return true; // can't verify, keep it
          const ratio = t.targetPrice / currentPrice;
          // Basic range: target must be within [40%, 250%] of current price
          if (ratio < 0.4 || ratio > 2.5) return false;
          // Rating-aware: Buy/Kjøp target must be above 70% of current price
          // (a Buy at 50% of current price is almost certainly wrong)
          if (t.rating && /buy|kjøp/i.test(t.rating) && ratio < 0.7) return false;
          // Sell target must be below 200% (a Sell at 3x current price is wrong)
          if (t.rating && /sell|selg/i.test(t.rating) && ratio > 2.0) return false;
          return true;
        })
      : allTargets;

    return NextResponse.json({
      ticker,
      companyName: stock.name,
      targets: saneTargets,
    });
  } catch (error) {
    console.error("[PRICE TARGETS API]", error);
    return NextResponse.json(
      { error: "Failed to fetch price targets" },
      { status: 500 }
    );
  }
}
