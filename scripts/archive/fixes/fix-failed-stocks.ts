#!/usr/bin/env tsx
/**
 * Fix the failed stocks only
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

// Only fix these specific stocks
const FAILED_TICKERS = ['CMBTO', 'KMCP', 'VEND'];

function toTitleCase(str: string): string {
  const specialCases: Record<string, string> = {
    'asa': 'ASA', 'as': 'AS', 'dnb': 'DNB', 'bw': 'BW', 'kmc': 'KMC',
    'abl': 'ABL', 'abg': 'ABG', 'pci': 'PCI', 'nel': 'Nel', 'ltd': 'Ltd',
    'se': 'SE', 'a/s': 'A/S',
  };

  return str
    .toLowerCase()
    .split(' ')
    .map(word => {
      const lower = word.toLowerCase();
      if (specialCases[lower]) return specialCases[lower];
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ');
}

function parseDate(dateStr: string | undefined): string | null {
  if (!dateStr || dateStr === 'NA' || dateStr === 'N/A') return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
  if (/^\d{4}$/.test(dateStr)) return `${dateStr}-01-01`;
  if (/^\d{2}\/\d{4}$/.test(dateStr)) {
    const [month, year] = dateStr.split('/');
    return `${year}-${month}-01`;
  }
  return null;
}

async function insertCompanyFundamentals(data: ParsedCompanyData): Promise<void> {
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
      employees = EXCLUDED.employees,
      shares_outstanding = EXCLUDED.shares_outstanding,
      total_float = EXCLUDED.total_float,
      business_summary = EXCLUDED.business_summary,
      financial_summary = EXCLUDED.financial_summary,
      updated_at = NOW()
  `, [
    data.ticker, properName, data.isin || null, data.ric || null, data.permId || null,
    data.exchange, data.exchangeCountry || null, data.status, data.companyType,
    data.employees || null, null,
    data.sharesOutstanding ? Math.round(data.sharesOutstanding) : null,
    data.totalFloat ? Math.round(data.totalFloat) : null,
    data.sharesDate || null,
    data.reportingCurrency || null, data.sector || null, data.industry || null, data.trbc || null,
    data.businessSummary || null, data.financialSummary || null,
    data.address?.street?.join(', ') || null, data.address?.city || null, data.address?.state || null,
    data.address?.postalCode || null, data.address?.country || null,
    data.phone?.main || null, data.phone?.fax || null, data.email || null, data.website || null,
    data.investorRelationsContact?.name || null, data.investorRelationsContact?.title || null,
    data.investorRelationsContact?.phone || null,
    data.latestAnnualDate || null, data.latestInterimDate || null, data.lastModified || null,
  ]);

  await pool.query(`UPDATE stocks SET name = $2, updated_at = NOW() WHERE ticker = $1`, [data.ticker, properName]);
}

async function insertOfficers(ticker: string, officers: ParsedCompanyData['officers']): Promise<void> {
  if (!officers || officers.length === 0) return;
  await pool.query('DELETE FROM company_officers WHERE ticker = $1', [ticker]);

  for (const officer of officers) {
    const sinceDate = parseDate(officer.since);
    await pool.query(`
      INSERT INTO company_officers (ticker, rank, first_name, last_name, age, title, since)
      VALUES ($1, $2, $3, $4, $5, $6, $7::date)
    `, [ticker, officer.rank, officer.firstName, officer.lastName, officer.age || null, officer.title, sinceDate]);
  }
}

async function main() {
  console.log(`Fixing ${FAILED_TICKERS.length} failed stocks...\n`);

  const client = new FundamentalsClient();
  const parser = new FundamentalsParser();

  try {
    await client.connect();
    console.log("[OK] Connected to IB Gateway\n");

    for (const ticker of FAILED_TICKERS) {
      process.stdout.write(`${ticker}...`);

      try {
        const xml = await client.fetchFundamentalReport(ticker, "OSE", FundamentalsReportType.COMPANY_OVERVIEW, SecType.STK, "NOK");
        const data = parser.parseCompanyOverview(xml);
        const properName = toTitleCase(data.companyName);

        await insertCompanyFundamentals(data);
        await insertOfficers(ticker, data.officers);

        console.log(` OK - ${properName}`);
      } catch (e: any) {
        console.log(` FAILED - ${e.message}`);
      }

      await new Promise(resolve => setTimeout(resolve, 500));
    }

  } catch (error: any) {
    console.error("[ERROR]", error.message);
  } finally {
    await client.disconnect();
    await pool.end();
  }
}

main();
