/**
 * API endpoint to trigger AI summary generation
 * POST /api/research/generate-summaries
 *
 * Generates summaries for documents without them using Claude API.
 *
 * SECURITY: This endpoint is protected because it:
 * - Uses the Anthropic API (costs money)
 * - Modifies database records
 * - Is a resource-intensive operation
 */

import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import Anthropic from "@anthropic-ai/sdk";
import { rateLimit } from "@/lib/rate-limit";
import { requireAuth, secureJsonResponse, safeErrorResponse } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 minutes

// Initialize Anthropic client with validated API key
function getAnthropicClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not configured');
  }
  return new Anthropic({ apiKey });
}

function cleanBodyText(text: string): string {
  if (!text) return "";

  // Remove disclaimers and footers
  let cleaned = text
    .split(/This message is confidential/i)[0]
    .split(/Source:\s*Pareto Securities/i)[0]
    .split(/Analyst\(s\):/i)[0]
    .split(/Please refer to the specific research discla/i)[0]
    .split(/\n*Full Report:/i)[0];

  // Remove email addresses and phone numbers
  cleaned = cleaned
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, "")
    .replace(/\+\d{2}\s*\d{2}\s*\d{2}\s*\d{2}\s*\d{2}/g, "");

  // Remove "CLICK HERE" buttons
  cleaned = cleaned.replace(/CLICK HERE FOR THE FULL REPORT/gi, "");
  cleaned = cleaned.replace(/Click to open report/gi, "");

  return cleaned.trim();
}

async function generateSummary(
  anthropic: Anthropic,
  bodyText: string,
  subject: string
): Promise<string | null> {
  const cleanedText = cleanBodyText(bodyText);
  if (!cleanedText || cleanedText.length < 100) return null;

  const isBorsXtra = /børsxtra|borsxtra/i.test(subject);
  const isSectorUpdate = !isBorsXtra && /seafood|energy daily|fig weekly|morning comment|high yield|shipping daily|price update|weekly market|market analysis|oil\s*&\s*gas\s*-/i.test(subject);

  let prompt: string;
  if (isBorsXtra) {
    prompt = `Extract key information from this Norwegian market newsletter. Output ONLY the structured sections below — no commentary, disclaimers, or boilerplate.

**Market Overview:**
[2-3 sentences: US/Asia overnight performance, oil price (Brent), expected Oslo Børs opening, key sector moves]

**Earnings/Results Summary:**
[If Q4/quarterly results mentioned, list companies with "better/weaker than expected" verdicts. If none, skip this section]
- [Company]: [better/weaker] than expected

**Price Target Changes:**
- **[COMPANY]**: [Broker] [action] target to NOK [new] ([old]), [Buy/Hold/Sell]
[...continue for ALL companies mentioned with target/rating changes...]

**Key Observations:**
[1-2 bullet points from "DAGENS OBS" or notable analyst commentary — focus on actionable insights]
- [Key insight about a specific stock or situation]

Rules:
- List EVERY company with a price target or rating change — do not skip any
- Keep original NOK/USD amounts and old values in parentheses
- Note upgrades/downgrades explicitly (e.g. "upgraded from Hold to Buy")
- Use Norwegian broker short names: Pareto, DNB Carnegie, Arctic, SB1M, Clarksons, Fearnley, Nordea, SEB, Danske Bank, ABG
- Company names in Norwegian style (e.g. Aker BP, Kongsberg Gruppen, Nordic Semiconductor)
- Include overnight US-listed Norwegian stock moves if mentioned (BORR, EQNR, FRO, etc.)
- No disclaimers or legal text

Newsletter: ${subject}

Content:
${cleanedText.substring(0, 15000)}`;
  } else if (isSectorUpdate) {
    prompt = `Summarize this market/sector update. Output ONLY the summary — no disclaimers, legal text, or boilerplate.

Format:
**Key Takeaway:** [1-2 sentences on the most important insight]

**Key Points:**
- [Most important data point or development]
- [Second key point]
- [Additional points if material — max 5 bullets total]

Rules:
- Focus on market data, prices, trends, and sector dynamics
- Keep all numbers, percentages, and financial metrics
- Do NOT include Rating, Target Price, or Share Price headers
- No legal disclaimers or boilerplate
- Be concise — entire output under 200 words

Report: ${subject}

Content:
${cleanedText.substring(0, 15000)}`;
  } else {
    prompt = `Summarize this equity research report. Output ONLY the summary — no disclaimers, legal text, confidentiality notices, or boilerplate.

Format:
**Rating:** [Buy/Hold/Sell] | **Target Price:** [price in currency] | **Share Price:** [current price]

**Thesis:** [1-2 sentences on the core investment case]

**Key Points:**
- [Most important takeaway with specific numbers]
- [Second key point — earnings, margins, guidance, etc.]
- [Third key point — catalysts, risks, or sector dynamics]
- [Additional points if material — max 6 bullets total]

**Estimates:** [Key estimate changes if any — EPS, revenue, EBITDA revisions]

Rules:
- Include company name and ticker prominently
- Keep all numbers, percentages, and financial metrics
- Mention peer companies or sector names when relevant (helps search)
- No legal disclaimers, confidentiality notices, or analyst disclosures
- No "this report does not provide" or "please refer to" language
- Be concise — entire output under 250 words

Report: ${subject}

Content:
${cleanedText.substring(0, 15000)}`;
  }

  try {
    const message = await anthropic.messages.create({
      model: "claude-3-haiku-20240307",
      max_tokens: isBorsXtra ? 2048 : 1024,
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
    });

    const firstBlock = message.content[0];
    if (firstBlock.type !== 'text') {
      return null;
    }
    let summary = firstBlock.text;

    // Remove any preamble the model might add
    summary = summary.replace(/^(Here is|Below is|Summary of)[^:]*:\s*\n*/i, "");

    // Strip any disclaimers/legal text that slipped through
    summary = summary.split(/\n*(This (message|report|document) is confidential|Please refer to|Disclaimer|Legal Notice|Important (Notice|Disclosure))/i)[0];

    summary = summary.replace(/\n{3,}/g, "\n\n");

    return summary.trim();
  } catch (error: any) {
    console.error(`Claude API error: ${error.message}`);
    return null;
  }
}

export async function POST(req: NextRequest) {
  // Rate limiting - expensive operation
  const rateLimitResult = rateLimit(req, 'expensive');
  if (rateLimitResult) return rateLimitResult;

  // CRITICAL: Require authentication - this endpoint costs money
  const authError = requireAuth(req);
  if (authError) return authError;

  try {
    // Get Anthropic client (validates API key is configured)
    const anthropic = getAnthropicClient();

    // Get documents without summaries (limit to 5 per request)
    const result = await pool.query(
      `SELECT id, subject, body_text, source
       FROM research_documents
       WHERE ai_summary IS NULL
       AND body_text IS NOT NULL
       AND body_text != ''
       ORDER BY received_date DESC
       LIMIT 5`
    );

    const docs = result.rows;

    if (docs.length === 0) {
      return secureJsonResponse({
        success: true,
        message: "All documents already have summaries",
        processed: 0,
      });
    }

    let successCount = 0;
    let failCount = 0;
    const results = [];

    for (const doc of docs) {
      const summary = await generateSummary(anthropic, doc.body_text, doc.subject);

      if (summary) {
        await pool.query(
          "UPDATE research_documents SET ai_summary = $1 WHERE id = $2",
          [summary, doc.id]
        );
        successCount++;
        results.push({
          id: doc.id,
          subject: doc.subject.substring(0, 60),
          success: true,
        });
      } else {
        failCount++;
        results.push({
          id: doc.id,
          subject: doc.subject.substring(0, 60),
          success: false,
        });
      }

      // Rate limiting
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    return secureJsonResponse({
      success: true,
      message: `Generated ${successCount} summaries, ${failCount} failed`,
      processed: successCount,
      failed: failCount,
      results,
    });
  } catch (error: unknown) {
    return safeErrorResponse(error, 'Failed to generate summaries');
  }
}
