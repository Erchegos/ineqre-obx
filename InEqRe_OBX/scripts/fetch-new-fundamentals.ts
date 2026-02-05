#!/usr/bin/env tsx
/**
 * Fetch IBKR company fundamentals for new tickers and insert to DB
 */

import { FundamentalsClient, FundamentalsReportType } from "../packages/ibkr/src/fundamentals-client";
import { FundamentalsParser } from "../packages/ibkr/src/fundamentals-parser";
import { SecType } from "@stoqey/ib";
import { Pool } from "pg";
import dotenv from "dotenv";

dotenv.config();
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: false });

const NEW_TICKERS = [
  { ticker: "DNO", exchange: "OSE", currency: "NOK" },
  { ticker: "BNOR", exchange: "OSE", currency: "NOK" },
  { ticker: "ELO", exchange: "OSE", currency: "NOK" },
  { ticker: "EPR", exchange: "OSE", currency: "NOK" },
  { ticker: "GIGA", exchange: "OSE", currency: "NOK" },
  { ticker: "HSHP", exchange: "OSE", currency: "NOK" },
  { ticker: "LINK", exchange: "OSE", currency: "NOK" },
  { ticker: "NORCO", exchange: "SMART", currency: "USD" }, // NYSE-listed NCLH
  { ticker: "PEN", exchange: "OSE", currency: "NOK" },
  { ticker: "PLSV", exchange: "OSE", currency: "NOK" },
];

async function insertCompany(data: any): Promise<void> {
  await pool.query(`
    INSERT INTO company_fundamentals (
      ticker, company_name, isin, ric, perm_id,
      exchange, exchange_country, status, company_type,
      employees, employees_last_updated, shares_outstanding, total_float,
      shares_date, reporting_currency, sector, industry, trbc_code,
      business_summary, financial_summary,
      address_street, address_city, address_state, address_postal_code,
      address_country, phone_main, phone_fax, email, website,
      ir_contact_name, ir_contact_title, ir_contact_phone,
      latest_annual_date, latest_interim_date, last_modified,
      raw_json
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9,
      $10, $11::DATE, $12, $13, $14::DATE, $15, $16, $17, $18,
      $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29,
      $30, $31, $32, $33::DATE, $34::DATE, $35::DATE, $36::JSONB
    )
    ON CONFLICT (ticker) DO UPDATE SET
      company_name = EXCLUDED.company_name,
      employees = EXCLUDED.employees,
      shares_outstanding = EXCLUDED.shares_outstanding,
      total_float = EXCLUDED.total_float,
      sector = EXCLUDED.sector,
      industry = EXCLUDED.industry,
      business_summary = EXCLUDED.business_summary,
      financial_summary = EXCLUDED.financial_summary,
      website = EXCLUDED.website,
      raw_json = EXCLUDED.raw_json,
      updated_at = NOW()
  `, [
    data.ticker, data.companyName, data.isin, data.ric, data.permId,
    data.exchange, data.exchangeCountry, data.status, data.companyType,
    data.employees, data.employeesLastUpdated || null, data.sharesOutstanding, data.totalFloat,
    data.sharesDate || null, data.reportingCurrency, data.sector, data.industry, data.trbc,
    data.businessSummary, data.financialSummary,
    data.address?.street, data.address?.city, data.address?.state, data.address?.postalCode,
    data.address?.country, data.phone?.main, data.phone?.fax, data.email, data.website,
    data.irContact?.name, data.irContact?.title, data.irContact?.phone,
    data.latestAnnualDate || null, data.latestInterimDate || null, data.lastModified || null,
    JSON.stringify(data),
  ]);
}

async function main() {
  console.log("=== Fetch IBKR Company Fundamentals ===\n");

  const client = new FundamentalsClient();
  const parser = new FundamentalsParser();

  try {
    await client.connect();
    console.log("Connected to IB Gateway\n");

    for (let i = 0; i < NEW_TICKERS.length; i++) {
      const { ticker, exchange, currency } = NEW_TICKERS[i];
      console.log(`[${i + 1}/${NEW_TICKERS.length}] ${ticker}...`);

      try {
        const xml = await client.fetchFundamentalReport(
          ticker === "NORCO" ? "NCLH" : ticker,
          exchange,
          FundamentalsReportType.COMPANY_OVERVIEW,
          SecType.STK,
          currency
        );

        const data = parser.parseCompanyOverview(xml);
        data.ticker = ticker; // Use our DB ticker name
        await insertCompany(data);
        console.log(`  OK: ${data.companyName} (${data.industry || "N/A"})`);
      } catch (e: any) {
        console.log(`  FAILED: ${e.message}`);
      }

      await new Promise(r => setTimeout(r, 1500));
    }
  } finally {
    await client.disconnect();
    await pool.end();
  }
}

main().catch(e => { console.error("Fatal:", e); process.exit(1); });
