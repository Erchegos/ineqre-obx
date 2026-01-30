#!/usr/bin/env tsx
import { FundamentalsClient, FundamentalsReportType } from "../packages/ibkr/src/fundamentals-client";
import { FundamentalsParser } from "../packages/ibkr/src/fundamentals-parser";
import { SecType } from "@stoqey/ib";
import { Pool } from "pg";
import dotenv from "dotenv";

dotenv.config();
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: false });

function toTitleCase(str: string): string {
  const specialCases: Record<string, string> = {
    'asa': 'ASA', 'nv': 'NV', 'cmb': 'CMB',
  };
  return str.toLowerCase().split(' ').map(word => {
    const lower = word.toLowerCase();
    if (specialCases[lower]) return specialCases[lower];
    return word.charAt(0).toUpperCase() + word.slice(1);
  }).join(' ');
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

async function main() {
  const client = new FundamentalsClient();
  const parser = new FundamentalsParser();

  try {
    await client.connect();
    console.log("[OK] Connected to IB Gateway\n");

    const xml = await client.fetchFundamentalReport('CMBTO', "OSE", FundamentalsReportType.COMPANY_OVERVIEW, SecType.STK, "NOK");
    const data = parser.parseCompanyOverview(xml);
    const properName = toTitleCase(data.companyName);

    console.log("Parsed data:", {
      ticker: data.ticker,
      companyName: data.companyName,
      properName,
      exchange: data.exchange,
      officers: data.officers?.length
    });

    // Step 1: Insert into company_fundamentals first
    console.log("\nInserting into company_fundamentals...");
    await pool.query(`
      INSERT INTO company_fundamentals (ticker, company_name, exchange, exchange_country, status, company_type)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (ticker) DO UPDATE SET
        company_name = EXCLUDED.company_name,
        updated_at = NOW()
    `, [data.ticker, properName, data.exchange, data.exchangeCountry || null, data.status, data.companyType]);
    console.log("OK");

    // Step 2: Update stocks table
    console.log("Updating stocks table...");
    await pool.query(`UPDATE stocks SET name = $2, updated_at = NOW() WHERE ticker = $1`, [data.ticker, properName]);
    console.log("OK");

    // Step 3: Now insert officers
    if (data.officers && data.officers.length > 0) {
      console.log(`Inserting ${data.officers.length} officers...`);
      await pool.query('DELETE FROM company_officers WHERE ticker = $1', [data.ticker]);

      for (const officer of data.officers) {
        const sinceDate = parseDate(officer.since);
        await pool.query(`
          INSERT INTO company_officers (ticker, rank, first_name, last_name, age, title, since)
          VALUES ($1, $2, $3, $4, $5, $6, $7::date)
        `, [data.ticker, officer.rank, officer.firstName, officer.lastName, officer.age || null, officer.title, sinceDate]);
      }
      console.log("OK");
    }

    console.log(`\nDone! ${properName}`);

  } catch (error: any) {
    console.error("[ERROR]", error.message);
  } finally {
    await client.disconnect();
    await pool.end();
  }
}

main();
