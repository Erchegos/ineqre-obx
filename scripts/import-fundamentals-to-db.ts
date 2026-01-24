#!/usr/bin/env tsx
/**
 * Import fundamental data to PostgreSQL database
 * Reads JSON file and inserts into company_fundamentals table
 */

import { Pool } from "pg";
import { readFileSync } from "fs";
import dotenv from "dotenv";
import type { ParsedCompanyData } from "../packages/ibkr/src/fundamentals-parser";

dotenv.config();

// Disable SSL cert validation for development
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: false,
});

async function importFundamentals(jsonFile: string) {
  console.log(`Importing fundamental data from: ${jsonFile}\n`);

  // Read JSON file
  const data: ParsedCompanyData[] = JSON.parse(readFileSync(jsonFile, "utf-8"));
  console.log(`Found ${data.length} companies to import\n`);

  let successCount = 0;
  let errorCount = 0;

  for (const company of data) {
    try {
      console.log(`Importing ${company.ticker} (${company.companyName})...`);

      // Insert or update company fundamentals
      await pool.query(
        `
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
        )
        VALUES (
          $1, $2, $3, $4, $5,
          $6, $7, $8, $9,
          $10, $11::DATE, $12, $13,
          $14::DATE, $15, $16, $17, $18,
          $19, $20,
          $21, $22, $23, $24,
          $25, $26, $27, $28, $29,
          $30, $31, $32,
          $33::DATE, $34::DATE, $35::DATE,
          $36::JSONB
        )
        ON CONFLICT (ticker)
        DO UPDATE SET
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
          raw_json = EXCLUDED.raw_json,
          updated_at = NOW()
        `,
        [
          company.ticker,
          company.companyName,
          company.isin,
          company.ric,
          company.permId,
          company.exchange,
          company.exchangeCountry,
          company.status,
          company.companyType,
          company.employees,
          company.employeesLastUpdated,
          company.sharesOutstanding,
          company.totalFloat,
          company.sharesDate,
          company.reportingCurrency,
          company.sector,
          company.industry,
          company.trbc,
          company.businessSummary,
          company.financialSummary,
          company.address?.street.join(", "),
          company.address?.city,
          company.address?.state,
          company.address?.postalCode,
          company.address?.country,
          company.phone?.main,
          company.phone?.fax,
          company.email,
          company.website,
          company.investorRelationsContact?.name,
          company.investorRelationsContact?.title,
          company.investorRelationsContact?.phone,
          company.latestAnnualDate,
          company.latestInterimDate,
          company.lastModified,
          JSON.stringify(company),
        ]
      );

      // Delete existing officers for this company
      await pool.query("DELETE FROM company_officers WHERE ticker = $1", [
        company.ticker,
      ]);

      // Insert officers
      if (company.officers && company.officers.length > 0) {
        for (const officer of company.officers) {
          // Parse since date - handle various formats
          let sinceDate: string | null = null;
          if (officer.since) {
            try {
              // Try to parse date - accept any reasonable format
              const d = new Date(officer.since);
              if (!isNaN(d.getTime())) {
                sinceDate = d.toISOString().split('T')[0];
              }
            } catch {
              // Leave as null if invalid
            }
          }

          await pool.query(
            `
            INSERT INTO company_officers (
              ticker, rank, first_name, last_name, age, title, since
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7::DATE)
            `,
            [
              company.ticker,
              officer.rank,
              officer.firstName,
              officer.lastName,
              officer.age,
              officer.title,
              sinceDate,
            ]
          );
        }
      }

      // Delete existing industry codes
      await pool.query(
        "DELETE FROM company_industry_codes WHERE ticker = $1",
        [company.ticker]
      );

      // Insert NAICS codes
      if (company.naicsCodes) {
        for (const naics of company.naicsCodes) {
          const parts = naics.split(": ");
          await pool.query(
            `
            INSERT INTO company_industry_codes (ticker, code_type, code, description)
            VALUES ($1, 'NAICS', $2, $3)
            `,
            [company.ticker, parts[0], parts[1] || ""]
          );
        }
      }

      // Insert SIC codes
      if (company.sicCodes) {
        for (const sic of company.sicCodes) {
          const parts = sic.split(": ");
          await pool.query(
            `
            INSERT INTO company_industry_codes (ticker, code_type, code, description)
            VALUES ($1, 'SIC', $2, $3)
            `,
            [company.ticker, parts[0], parts[1] || ""]
          );
        }
      }

      console.log(`  [OK] Imported ${company.ticker}`);
      successCount++;
    } catch (error: any) {
      console.error(`  [ERROR] ${company.ticker}: ${error.message}`);
      errorCount++;
    }
  }

  console.log("\nIMPORT SUMMARY");
  console.log("=".repeat(70));
  console.log(`Total: ${data.length}`);
  console.log(`Successful: ${successCount}`);
  console.log(`Failed: ${errorCount}`);
}

async function main() {
  const jsonFile = process.argv[2] || "/tmp/obx_fundamentals_bulk.json";

  try {
    await importFundamentals(jsonFile);
  } catch (error: any) {
    console.error("\n[ERROR]", error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
