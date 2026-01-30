#!/usr/bin/env tsx
/**
 * Fix fundamentals and names for all stocks
 * - Imports full fundamentals into company_fundamentals table
 * - Inserts officers into company_officers table
 * - Fixes stock names to use Title Case
 */

import { FundamentalsClient, FundamentalsReportType } from "../packages/ibkr/src/fundamentals-client";
import { FundamentalsParser, ParsedCompanyData } from "../packages/ibkr/src/fundamentals-parser";
import { SecType } from "@stoqey/ib";
import { Pool } from "pg";
import dotenv from "dotenv";

dotenv.config();
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: false,
});

// Helper to convert to Title Case
function toTitleCase(str: string): string {
  // Handle special cases
  const specialCases: Record<string, string> = {
    'asa': 'ASA',
    'as': 'AS',
    'dnb': 'DNB',
    'bw': 'BW',
    'kmc': 'KMC',
    'abl': 'ABL',
    'abg': 'ABG',
    'pci': 'PCI',
    'nel': 'Nel',
    'ltd': 'Ltd',
    'se': 'SE',
    'a/s': 'A/S',
  };

  return str
    .toLowerCase()
    .split(' ')
    .map(word => {
      const lower = word.toLowerCase();
      if (specialCases[lower]) {
        return specialCases[lower];
      }
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ');
}

async function insertCompanyFundamentals(data: ParsedCompanyData): Promise<void> {
  // Format the company name properly
  const properName = toTitleCase(data.companyName);

  await pool.query(`
    INSERT INTO company_fundamentals (
      ticker, company_name, isin, ric, perm_id,
      exchange, exchange_country, status, company_type,
      employees, employees_last_updated, shares_outstanding, total_float, shares_date,
      reporting_currency, sector, industry, trbc_code,
      business_summary, financial_summary,
      address_street, address_city, address_state, address_postal_code, address_country,
      phone_main, phone_fax, email, website,
      ir_contact_name, ir_contact_title, ir_contact_phone,
      latest_annual_date, latest_interim_date, last_modified
    ) VALUES (
      $1, $2, $3, $4, $5,
      $6, $7, $8, $9,
      $10, $11::date, $12, $13, $14::date,
      $15, $16, $17, $18,
      $19, $20,
      $21, $22, $23, $24, $25,
      $26, $27, $28, $29,
      $30, $31, $32,
      $33::date, $34::date, $35::date
    )
    ON CONFLICT (ticker) DO UPDATE SET
      company_name = EXCLUDED.company_name,
      isin = EXCLUDED.isin,
      ric = EXCLUDED.ric,
      perm_id = EXCLUDED.perm_id,
      exchange = EXCLUDED.exchange,
      exchange_country = EXCLUDED.exchange_country,
      status = EXCLUDED.status,
      company_type = EXCLUDED.company_type,
      employees = EXCLUDED.employees,
      employees_last_updated = EXCLUDED.employees_last_updated,
      shares_outstanding = EXCLUDED.shares_outstanding,
      total_float = EXCLUDED.total_float,
      shares_date = EXCLUDED.shares_date,
      reporting_currency = EXCLUDED.reporting_currency,
      sector = EXCLUDED.sector,
      industry = EXCLUDED.industry,
      trbc_code = EXCLUDED.trbc_code,
      business_summary = EXCLUDED.business_summary,
      financial_summary = EXCLUDED.financial_summary,
      address_street = EXCLUDED.address_street,
      address_city = EXCLUDED.address_city,
      address_state = EXCLUDED.address_state,
      address_postal_code = EXCLUDED.address_postal_code,
      address_country = EXCLUDED.address_country,
      phone_main = EXCLUDED.phone_main,
      phone_fax = EXCLUDED.phone_fax,
      email = EXCLUDED.email,
      website = EXCLUDED.website,
      ir_contact_name = EXCLUDED.ir_contact_name,
      ir_contact_title = EXCLUDED.ir_contact_title,
      ir_contact_phone = EXCLUDED.ir_contact_phone,
      latest_annual_date = EXCLUDED.latest_annual_date,
      latest_interim_date = EXCLUDED.latest_interim_date,
      last_modified = EXCLUDED.last_modified,
      updated_at = NOW()
  `, [
    data.ticker,
    properName,
    data.isin || null,
    data.ric || null,
    data.permId || null,
    data.exchange,
    data.exchangeCountry || null,
    data.status,
    data.companyType,
    data.employees || null,
    data.employeesLastUpdated || null,
    data.sharesOutstanding ? Math.round(data.sharesOutstanding) : null,
    data.totalFloat ? Math.round(data.totalFloat) : null,
    data.sharesDate || null,
    data.reportingCurrency || null,
    data.sector || null,
    data.industry || null,
    data.trbc || null,
    data.businessSummary || null,
    data.financialSummary || null,
    data.address?.street?.join(', ') || null,
    data.address?.city || null,
    data.address?.state || null,
    data.address?.postalCode || null,
    data.address?.country || null,
    data.phone?.main || null,
    data.phone?.fax || null,
    data.email || null,
    data.website || null,
    data.investorRelationsContact?.name || null,
    data.investorRelationsContact?.title || null,
    data.investorRelationsContact?.phone || null,
    data.latestAnnualDate || null,
    data.latestInterimDate || null,
    data.lastModified || null,
  ]);

  // Also update the stocks table with proper name
  await pool.query(`
    UPDATE stocks SET name = $2, updated_at = NOW() WHERE ticker = $1
  `, [data.ticker, properName]);
}

// Parse various date formats
function parseDate(dateStr: string | undefined): string | null {
  if (!dateStr || dateStr === 'NA' || dateStr === 'N/A') return null;

  // Try to parse different formats
  // Full date: YYYY-MM-DD or MM/DD/YYYY
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;

  // Year only: YYYY -> assume Jan 1
  if (/^\d{4}$/.test(dateStr)) return `${dateStr}-01-01`;

  // MM/YYYY -> assume first of month
  if (/^\d{2}\/\d{4}$/.test(dateStr)) {
    const [month, year] = dateStr.split('/');
    return `${year}-${month}-01`;
  }

  // YYYY/MM -> assume first of month
  if (/^\d{4}\/\d{2}$/.test(dateStr)) {
    const [year, month] = dateStr.split('/');
    return `${year}-${month}-01`;
  }

  return null; // Can't parse
}

async function insertOfficers(ticker: string, officers: ParsedCompanyData['officers']): Promise<void> {
  if (!officers || officers.length === 0) return;

  // Delete existing officers for this ticker
  await pool.query('DELETE FROM company_officers WHERE ticker = $1', [ticker]);

  // Insert new officers
  for (const officer of officers) {
    const sinceDate = parseDate(officer.since);
    await pool.query(`
      INSERT INTO company_officers (ticker, rank, first_name, last_name, age, title, since)
      VALUES ($1, $2, $3, $4, $5, $6, $7::date)
    `, [
      ticker,
      officer.rank,
      officer.firstName,
      officer.lastName,
      officer.age || null,
      officer.title,
      sinceDate,
    ]);
  }
}

async function main() {
  // Get all tickers from database
  const tickerResult = await pool.query('SELECT DISTINCT ticker FROM stocks ORDER BY ticker');
  const tickers = tickerResult.rows.map(r => r.ticker).filter(t => t !== 'OBX');

  console.log(`Importing fundamentals for ${tickers.length} stocks...\n`);

  const client = new FundamentalsClient();
  const parser = new FundamentalsParser();

  const results: { ticker: string; success: boolean; name?: string; error?: string }[] = [];

  try {
    await client.connect();
    console.log("[OK] Connected to IB Gateway\n");

    for (let i = 0; i < tickers.length; i++) {
      const ticker = tickers[i];
      process.stdout.write(`[${i + 1}/${tickers.length}] ${ticker}...`);

      try {
        const xml = await client.fetchFundamentalReport(
          ticker,
          "OSE",
          FundamentalsReportType.COMPANY_OVERVIEW,
          SecType.STK,
          "NOK"
        );

        const data = parser.parseCompanyOverview(xml);
        const properName = toTitleCase(data.companyName);

        // Insert into company_fundamentals
        await insertCompanyFundamentals(data);

        // Insert officers
        await insertOfficers(ticker, data.officers);

        results.push({ ticker, success: true, name: properName });
        console.log(` OK - ${properName}`);

      } catch (e: any) {
        results.push({ ticker, success: false, error: e.message });
        console.log(` FAILED - ${e.message}`);
      }

      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    // Summary
    console.log("\n" + "=".repeat(70));
    console.log("IMPORT SUMMARY");
    console.log("=".repeat(70));

    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);

    console.log(`Total: ${tickers.length}`);
    console.log(`Successful: ${successful.length}`);
    console.log(`Failed: ${failed.length}`);

    if (failed.length > 0) {
      console.log("\nFailed:");
      failed.forEach(r => console.log(`  - ${r.ticker}: ${r.error}`));
    }

  } catch (error: any) {
    console.error("[ERROR]", error.message);
  } finally {
    await client.disconnect();
    await pool.end();
  }
}

main();
