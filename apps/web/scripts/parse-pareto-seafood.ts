/**
 * Pareto Seafood Weekly Price Estimate Parser
 *
 * Reads Pareto "Seafood Weekly" PDFs from the research portal (Supabase storage),
 * extracts the quarterly salmon price estimate table, spot prices, and supply growth.
 *
 * Data extracted per report:
 *   - Quarterly FCA Oslo price estimates (NOK/kg & EUR/kg) — Q1'24 through 2027e
 *   - Global supply growth Y/Y estimates
 *   - Current spot price estimate and QTD price
 *   - Consensus price (PAS)
 *
 * Run: npx tsx scripts/parse-pareto-seafood.ts
 * Options:
 *   --dry-run    Parse but don't insert
 *   --all        Process all Seafood Weekly reports (not just latest)
 *   --limit=5    Process only N most recent reports
 */

import { Pool } from "pg";
import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import * as path from "path";

// @ts-ignore
import pdfParse from "pdf-parse";

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

const DRY_RUN = process.argv.includes("--dry-run");
const PROCESS_ALL = process.argv.includes("--all");
const LIMIT = parseInt(
  process.argv.find((a) => a.startsWith("--limit="))?.split("=")[1] ?? (PROCESS_ALL ? "100" : "3")
);

const dbUrl = (process.env.DATABASE_URL || "").trim().replace(/^["']|["']$/g, "");
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
const pool = new Pool({ connectionString: dbUrl });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const supabase = createClient(supabaseUrl, supabaseKey);

interface PriceEstimate {
  period: string;
  priceNokKg: number | null;
  priceEurKg: number | null;
  supplyGrowthYoy: number | null;
  isEstimate: boolean;
}

interface ParsedReport {
  reportDate: string;
  spotPriceNok: number | null;
  spotPriceEur: number | null;
  qtdPriceNok: number | null;
  consensusNok: number | null;
  estimates: PriceEstimate[];
}

function parseNorwegianNumber(s: string): number | null {
  if (!s) return null;
  const cleaned = s.trim().replace(/\s/g, "").replace(",", ".");
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

function parseReport(text: string, reportDate: string): ParsedReport | null {
  const result: ParsedReport = {
    reportDate,
    spotPriceNok: null,
    spotPriceEur: null,
    qtdPriceNok: null,
    consensusNok: null,
    estimates: [],
  };

  // Extract spot price: "~NOK 93/kg" or "at ~NOK 93/kg"
  const spotNokMatch = text.match(/(?:at\s+)?~?\s*NOK\s+([\d]+(?:[.,]\d+)?)\s*\/kg/i);
  if (spotNokMatch) {
    result.spotPriceNok = parseNorwegianNumber(spotNokMatch[1]);
  }

  // Extract spot EUR: "~EUR 8.4" or "(~EUR 8.4)"
  const spotEurMatch = text.match(/~?\s*EUR\s+([\d]+(?:[.,]\d+)?)/i);
  if (spotEurMatch) {
    result.spotPriceEur = parseNorwegianNumber(spotEurMatch[1]);
  }

  // Extract QTD price: "QTD salmon prices are now ~NOK 85/kg"
  const qtdMatch = text.match(/QTD[^~]*~?\s*NOK\s+([\d]+(?:[.,]\d+)?)\s*\/kg/i);
  if (qtdMatch) {
    result.qtdPriceNok = parseNorwegianNumber(qtdMatch[1]);
  }

  // Extract consensus: "consensus at ~NOK 90/kg" or "PAS 86.7/kg"
  const consensusMatch = text.match(/(?:consensus|PAS)[^~\d]*~?\s*(?:NOK\s+)?([\d]+(?:[.,]\d+)?)\s*(?:\/kg)?/i);
  if (consensusMatch) {
    result.consensusNok = parseNorwegianNumber(consensusMatch[1]);
  }

  // Parse the quarterly price estimates table
  // PDF text often concatenates columns without spaces:
  //   "Q1'24107.99.5-4.3 %"  → Q1'24, 107.9 NOK, 9.5 EUR, -4.3%
  //   "Q4'25e79.16.79.2 %estimate" → Q4'25e, 79.1 NOK, 6.7 EUR, 9.2%
  //   "202488.27.61.4 %" → 2024, 88.2 NOK, 7.6 EUR, 1.4%
  // But some PDFs/body text may have spaces, so we try both patterns.

  // Pattern 1: Concatenated format (no spaces between numbers)
  // NOK = 2-3 digits + decimal (e.g. 107.9, 79.1, 69.9)
  // EUR = 1-2 digits + decimal (e.g. 9.5, 6.7, 5.9)
  // Growth = optional sign + 1-2 digits + decimal (e.g. -4.3, 8.2, 3.5)
  const qConcatRegex = /Q([1-4])[''''](\d{2})(e?)(\d{2,3}[.,]\d)(\d{1,2}[.,]\d)([+-]?\d{1,2}[.,]\d)\s*%/g;
  let qm;
  while ((qm = qConcatRegex.exec(text)) !== null) {
    result.estimates.push({
      period: `Q${qm[1]}'${qm[2]}`,
      priceNokKg: parseNorwegianNumber(qm[4]),
      priceEurKg: parseNorwegianNumber(qm[5]),
      supplyGrowthYoy: parseNorwegianNumber(qm[6]),
      isEstimate: qm[3] === "e",
    });
  }

  // Pattern 2: Spaced format (for body text or different PDF layouts)
  if (result.estimates.length === 0) {
    const qSpacedRegex = /Q([1-4])[''''](\d{2})(e?)\s+([\d]+[.,]?\d*)\s+([\d]+[.,]?\d*)\s+([+-]?[\d]+[.,]?\d*)\s*%/g;
    let qs;
    while ((qs = qSpacedRegex.exec(text)) !== null) {
      result.estimates.push({
        period: `Q${qs[1]}'${qs[2]}`,
        priceNokKg: parseNorwegianNumber(qs[4]),
        priceEurKg: parseNorwegianNumber(qs[5]),
        supplyGrowthYoy: parseNorwegianNumber(qs[6]),
        isEstimate: qs[3] === "e",
      });
    }
  }

  // Annual rows: concatenated format "202488.27.61.4 %" or "2027e86.47.41.0 %"
  const aConcatRegex = /\b(20\d{2})(e?)(\d{2,3}[.,]\d)(\d{1,2}[.,]\d)([+-]?\d{1,2}[.,]\d)\s*%/g;
  let am;
  while ((am = aConcatRegex.exec(text)) !== null) {
    const year = am[1];
    const isEstimate = am[2] === "e";
    if (result.estimates.some((e) => e.period === year)) continue;
    result.estimates.push({
      period: year,
      priceNokKg: parseNorwegianNumber(am[3]),
      priceEurKg: parseNorwegianNumber(am[4]),
      supplyGrowthYoy: parseNorwegianNumber(am[5]),
      isEstimate,
    });
  }

  // Annual rows: spaced format "2024  88.2  7.6  1.4 %"
  if (!result.estimates.some((e) => /^20\d{2}$/.test(e.period))) {
    const aSpacedRegex = /\b(20\d{2})(e?)\s+([\d]+[.,]?\d*)\s+([\d]+[.,]?\d*)\s+([+-]?[\d]+[.,]?\d*)\s*%/g;
    let as2;
    while ((as2 = aSpacedRegex.exec(text)) !== null) {
      const year = as2[1];
      const isEstimate = as2[2] === "e";
      if (result.estimates.some((e) => e.period === year)) continue;
      result.estimates.push({
        period: year,
        priceNokKg: parseNorwegianNumber(as2[3]),
        priceEurKg: parseNorwegianNumber(as2[4]),
        supplyGrowthYoy: parseNorwegianNumber(as2[5]),
        isEstimate,
      });
    }
  }

  if (result.estimates.length === 0 && !result.spotPriceNok) {
    return null;
  }

  return result;
}

async function main() {
  console.log("=== Pareto Seafood Weekly Price Estimate Parser ===\n");

  // Find Seafood Weekly documents with PDF attachments
  const docs = await pool.query(
    `SELECT d.id, d.subject, d.received_date, d.body_text,
            a.id as att_id, a.filename, a.file_path, a.file_size
     FROM research_documents d
     JOIN research_attachments a ON a.document_id = d.id
     WHERE d.subject ILIKE '%Seafood Weekly%'
       AND d.sender_email ILIKE '%pareto%'
       AND a.filename ILIKE '%.pdf'
     ORDER BY d.received_date DESC
     LIMIT $1`,
    [LIMIT]
  );

  console.log(`Found ${docs.rows.length} Seafood Weekly reports with PDFs.\n`);

  let parsedCount = 0;
  let estimateCount = 0;

  for (const doc of docs.rows) {
    const reportDate = new Date(doc.received_date).toISOString().slice(0, 10);
    console.log(`[${reportDate}] ${doc.subject}`);
    console.log(`  PDF: ${doc.filename} (${doc.file_size} bytes)`);

    // Download PDF from Supabase
    const { data, error } = await supabase.storage
      .from("research-pdfs")
      .download(doc.file_path);

    if (error || !data) {
      console.log(`  Error downloading PDF: ${error?.message || "no data"}`);
      // Try parsing from body text instead
      if (doc.body_text) {
        console.log("  Trying body text fallback...");
        const result = parseReport(doc.body_text, reportDate);
        if (result) {
          console.log(`  From body: spot=${result.spotPriceNok}, QTD=${result.qtdPriceNok}, estimates=${result.estimates.length}`);
          if (!DRY_RUN) {
            await upsertEstimates(result);
            estimateCount += result.estimates.length;
          }
          parsedCount++;
        }
      }
      continue;
    }

    // Parse PDF
    const buffer = Buffer.from(await data.arrayBuffer());
    const pdf = await pdfParse(buffer);
    const text = pdf.text;

    const result = parseReport(text, reportDate);
    if (!result) {
      // Fallback to body text
      if (doc.body_text) {
        const bodyResult = parseReport(doc.body_text, reportDate);
        if (bodyResult) {
          console.log(`  From body: spot=${bodyResult.spotPriceNok}, QTD=${bodyResult.qtdPriceNok}`);
          if (!DRY_RUN) await upsertEstimates(bodyResult);
          parsedCount++;
        }
      }
      continue;
    }

    console.log(
      `  Spot: ${result.spotPriceNok} NOK/kg, QTD: ${result.qtdPriceNok}, Consensus: ${result.consensusNok}`
    );
    console.log(`  Price estimates: ${result.estimates.length}`);
    for (const e of result.estimates) {
      console.log(
        `    ${e.period}${e.isEstimate ? "e" : ""}: ${e.priceNokKg} NOK/kg, ${e.priceEurKg} EUR/kg, supply ${e.supplyGrowthYoy}%`
      );
    }

    if (!DRY_RUN) {
      await upsertEstimates(result);
      estimateCount += result.estimates.length;
    }
    parsedCount++;
  }

  console.log(`\n=== Summary ===`);
  console.log(`  Reports parsed: ${parsedCount}`);
  console.log(`  Estimates upserted: ${estimateCount}`);

  if (!DRY_RUN) {
    const latest = await pool.query(
      `SELECT report_date, period, price_nok_kg, price_eur_kg, supply_growth_yoy, is_estimate
       FROM salmon_price_estimates
       WHERE source = 'pareto'
       ORDER BY report_date DESC, period
       LIMIT 20`
    );
    if (latest.rows.length > 0) {
      console.log("\nLatest price estimates in DB:");
      for (const r of latest.rows) {
        console.log(
          `  ${r.report_date} | ${r.period}${r.is_estimate ? "e" : ""}: ${r.price_nok_kg} NOK, ${r.price_eur_kg} EUR, supply ${r.supply_growth_yoy}%`
        );
      }
    }
  }

  await pool.end();
  console.log("\nDone!");
}

async function upsertEstimates(report: ParsedReport): Promise<void> {
  // Upsert spot/QTD as a special "spot" row
  if (report.spotPriceNok) {
    await pool.query(
      `INSERT INTO salmon_price_estimates
         (report_date, source, period, price_nok_kg, price_eur_kg, spot_price_nok, spot_price_eur, qtd_price_nok, consensus_nok)
       VALUES ($1, 'pareto', 'spot', $2, $3, $2, $3, $4, $5)
       ON CONFLICT (report_date, source, period) DO UPDATE SET
         price_nok_kg = EXCLUDED.price_nok_kg,
         price_eur_kg = EXCLUDED.price_eur_kg,
         spot_price_nok = EXCLUDED.spot_price_nok,
         spot_price_eur = EXCLUDED.spot_price_eur,
         qtd_price_nok = EXCLUDED.qtd_price_nok,
         consensus_nok = EXCLUDED.consensus_nok`,
      [report.reportDate, report.spotPriceNok, report.spotPriceEur, report.qtdPriceNok, report.consensusNok]
    );
  }

  // Upsert quarterly/annual estimates
  for (const e of report.estimates) {
    await pool.query(
      `INSERT INTO salmon_price_estimates
         (report_date, source, period, price_nok_kg, price_eur_kg, supply_growth_yoy, is_estimate)
       VALUES ($1, 'pareto', $2, $3, $4, $5, $6)
       ON CONFLICT (report_date, source, period) DO UPDATE SET
         price_nok_kg = EXCLUDED.price_nok_kg,
         price_eur_kg = EXCLUDED.price_eur_kg,
         supply_growth_yoy = EXCLUDED.supply_growth_yoy,
         is_estimate = EXCLUDED.is_estimate`,
      [report.reportDate, e.period, e.priceNokKg, e.priceEurKg, e.supplyGrowthYoy, e.isEstimate]
    );
  }

  // Also update commodity_prices SALMON with Pareto's spot estimate
  if (report.spotPriceNok) {
    const dt = new Date(report.reportDate);
    const dayOfWeek = dt.getDay();
    const daysToFriday = (5 - dayOfWeek + 7) % 7;
    const friday = new Date(dt.getTime() + daysToFriday * 86400000);
    const dateStr = friday.toISOString().slice(0, 10);

    await pool.query(
      `INSERT INTO commodity_prices (symbol, date, open, high, low, close, volume, currency, source)
       VALUES ($1, $2, $3, $3, $3, $3, NULL, 'NOK', 'pareto')
       ON CONFLICT (symbol, date) DO UPDATE SET
         close = GREATEST(EXCLUDED.close, commodity_prices.close),
         source = CASE WHEN EXCLUDED.close >= commodity_prices.close THEN 'pareto' ELSE commodity_prices.source END`,
      ["SALMON", dateStr, report.spotPriceNok]
    );
    console.log(`  Updated commodity_prices SALMON ${dateStr} = ${report.spotPriceNok} NOK/kg (Pareto)`);
  }
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
