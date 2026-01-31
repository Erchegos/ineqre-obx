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

  const prompt = `Analyze this financial research report and write a professional summary (2-3 paragraphs) covering:

- Investment thesis and recommendation
- Key financial metrics, estimates, or valuation
- Significant events, catalysts, or changes
- Target price or rating if mentioned

Write directly in a professional tone without meta-commentary.

Report: ${subject}

Content:
${cleanedText.substring(0, 15000)}`;

  try {
    const message = await anthropic.messages.create({
      model: "claude-3-haiku-20240307",
      max_tokens: 1024,
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

    // Remove prompt language
    summary = summary.replace(/^Summary:\s*\n+/i, "");
    summary = summary.replace(
      /^Here is (a|the) (concise,?\s*)?(professional\s*)?summary[^:]*:\s*/i,
      ""
    );
    summary = summary.replace(/^Based on the (content|report)[^:]*:\s*/i, "");

    // Remove section headers
    summary = summary.replace(
      /^(Investment Thesis and Recommendation|Main Investment Thesis\/Recommendation|Main Investment Thesis or Key Recommendation|Main Thesis and Recommendation|Main Thesis and Recommendations|Key Financial(s| Metrics)( and Estimates)?|Significant Events(, Catalysts,? or Changes)?|Target Price or Rating|Target Price\/Rating|Catalysts and Key Events|Key Points?|Important Financial (Metrics|Information)):\s*/gim,
      ""
    );

    summary = summary.replace(
      /\n\s*(Investment Thesis and Recommendation|Main Investment Thesis\/Recommendation|Main Investment Thesis or Key Recommendation|Main Thesis and Recommendation|Main Thesis and Recommendations|Key Financial(s| Metrics)(,? and Estimates|, Estimates,? and Valuation)?|Significant Events(, Catalysts,? (or|and) Changes)?|Target Price or Rating|Target Price\/Rating|Catalysts and Key Events|Key Points?|Important Financial (Metrics|Information)):\s*/gim,
      "\n"
    );

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
