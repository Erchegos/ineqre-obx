#!/usr/bin/env tsx

/**
 * Test IBKR Fundamentals Fetch for a Single Stock
 *
 * Connects to IBKR TWS Gateway and fetches all available fundamental data.
 * Dumps raw XML and extracted factor values.
 *
 * Prerequisites: IBKR TWS Gateway running on port 4002
 *
 * Usage:
 *   npx tsx scripts/test-ibkr-fundamentals.ts DNB
 *   npx tsx scripts/test-ibkr-fundamentals.ts EQNR
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../.env.local') });

import {
  FundamentalsClient,
  FundamentalsReportType,
} from '../../../packages/ibkr/src/fundamentals-client';
import { XMLParser } from 'fast-xml-parser';
import { pool } from '../src/lib/db';

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseAttributeValue: true,
  trimValues: true,
});

/**
 * Extract factor-relevant data from ReportRatios XML
 */
function parseReportRatios(xml: string): Record<string, any> {
  const data = xmlParser.parse(xml);
  const result: Record<string, any> = {};

  try {
    const ratios = data?.ReportRatios || data?.FinancialStatements;
    if (!ratios) {
      console.log('  ReportRatios: Unexpected structure, keys:', Object.keys(data));
      return result;
    }

    // Navigate the XML structure to find ratios
    // IBKR uses nested Ratio elements with @_FieldName attributes
    const groups = ratios?.Group || ratios?.Ratios?.Group;
    if (!groups) {
      console.log('  ReportRatios top-level keys:', Object.keys(ratios));
      return result;
    }

    const groupArray = Array.isArray(groups) ? groups : [groups];

    for (const group of groupArray) {
      const ratioItems = group?.Ratio;
      if (!ratioItems) continue;

      const items = Array.isArray(ratioItems) ? ratioItems : [ratioItems];
      for (const item of items) {
        const fieldName = item['@_FieldName'] || item['@_Field'];
        const value = item['#text'] ?? item;
        if (fieldName && value !== undefined) {
          result[fieldName] = typeof value === 'string' ? parseFloat(value) : value;
        }
      }
    }
  } catch (err) {
    console.warn('  Error parsing ReportRatios:', err);
  }

  return result;
}

/**
 * Extract financial statement data from ReportsFinStatements XML
 */
function parseFinancialStatements(xml: string): {
  latestRevenue: number | null;
  previousRevenue: number | null;
  bookValue: number | null;
  eps: number | null;
} {
  const result = {
    latestRevenue: null as number | null,
    previousRevenue: null as number | null,
    bookValue: null as number | null,
    eps: null as number | null,
  };

  try {
    const data = xmlParser.parse(xml);
    const statements = data?.ReportFinancialStatements || data?.FinancialStatements;
    if (!statements) {
      console.log('  FinStatements: Unexpected structure, keys:', Object.keys(data));
      return result;
    }

    // Log top-level structure for debugging
    console.log('  FinStatements top-level keys:', Object.keys(statements));

    // Try to find annual income statements
    const annualReports = statements?.AnnualPeriods?.FiscalPeriod ||
      statements?.FinancialStatements?.AnnualPeriods?.FiscalPeriod;

    if (annualReports) {
      const periods = Array.isArray(annualReports) ? annualReports : [annualReports];
      console.log(`  Found ${periods.length} annual periods`);

      for (let i = 0; i < Math.min(periods.length, 3); i++) {
        const period = periods[i];
        const endDate = period['@_EndDate'] || period['@_FiscalPeriodEndDate'];
        console.log(`  Annual period ${i}: ${endDate}`);

        // Look for revenue/sales in the statement items
        const statements_section = period?.Statement;
        if (statements_section) {
          const stmtArray = Array.isArray(statements_section) ? statements_section : [statements_section];
          for (const stmt of stmtArray) {
            const stmtType = stmt['@_Type'];
            const items = stmt?.lineItem || stmt?.LineItem;
            if (!items) continue;

            const itemArray = Array.isArray(items) ? items : [items];
            for (const item of itemArray) {
              const coaCode = item['@_coaCode'] || item['@_COACode'];
              const value = item['#text'] ?? item;

              if (coaCode === 'RTLR' || coaCode === 'SREV') {
                // Total Revenue or Sales Revenue
                const numVal = typeof value === 'string' ? parseFloat(value) : value;
                if (i === 0) result.latestRevenue = numVal;
                if (i === 1) result.previousRevenue = numVal;
                console.log(`    Revenue (${stmtType}): ${numVal} (period ${i})`);
              }
              if (coaCode === 'QTCO' || coaCode === 'QTLE') {
                // Total Common Equity or Total Equity
                if (i === 0) {
                  result.bookValue = typeof value === 'string' ? parseFloat(value) : value;
                  console.log(`    Book Value: ${result.bookValue}`);
                }
              }
              if (coaCode === 'SEPS' || coaCode === 'EPSD') {
                // EPS
                if (i === 0) {
                  result.eps = typeof value === 'string' ? parseFloat(value) : value;
                  console.log(`    EPS: ${result.eps}`);
                }
              }
            }
          }
        }
      }
    }
  } catch (err) {
    console.warn('  Error parsing FinStatements:', err);
  }

  return result;
}

/**
 * Extract shares outstanding and market cap from ReportSnapshot XML
 */
function parseSnapshot(xml: string): { sharesOutstanding: number | null; companyName: string } {
  const result = { sharesOutstanding: null as number | null, companyName: '' };

  try {
    const data = xmlParser.parse(xml);
    const snapshot = data?.ReportSnapshot;
    if (!snapshot) return result;

    // Company name
    const coIds = snapshot?.CoIDs?.CoID;
    if (coIds) {
      const ids = Array.isArray(coIds) ? coIds : [coIds];
      for (const id of ids) {
        if (id['@_Type'] === 'CompanyName') {
          result.companyName = id['#text'] || String(id);
        }
      }
    }

    // Shares outstanding
    const generalInfo = snapshot?.CoGeneralInfo;
    if (generalInfo?.SharesOut) {
      const shares = generalInfo.SharesOut['#text'] || generalInfo.SharesOut;
      result.sharesOutstanding = typeof shares === 'string' ? parseFloat(shares) : shares;
    }
  } catch (err) {
    console.warn('  Error parsing snapshot:', err);
  }

  return result;
}

async function main() {
  const ticker = process.argv[2]?.toUpperCase() || 'DNB';

  console.log('='.repeat(70));
  console.log(`TEST IBKR FUNDAMENTALS: ${ticker}`);
  console.log('='.repeat(70));

  // Connect to IBKR
  console.log('\n1. Connecting to IBKR TWS Gateway (port 4002)...');
  const client = new FundamentalsClient({ port: 4002 });

  try {
    await client.connect();
    console.log('   Connected!\n');
  } catch (err: any) {
    console.error('   Failed to connect:', err.message);
    console.error('   Make sure IBKR TWS Gateway is running on port 4002');
    process.exit(1);
  }

  try {
    // 1. Fetch ReportSnapshot
    console.log('2. Fetching ReportSnapshot (company overview)...');
    try {
      const snapshotXml = await client.fetchFundamentalReport(
        ticker, 'OSE', FundamentalsReportType.COMPANY_OVERVIEW
      );
      console.log(`   Received ${snapshotXml.length} bytes`);

      const snapshot = parseSnapshot(snapshotXml);
      console.log(`   Company: ${snapshot.companyName}`);
      console.log(`   Shares Outstanding: ${snapshot.sharesOutstanding?.toLocaleString()}`);
    } catch (err: any) {
      console.warn(`   ReportSnapshot failed: ${err.message}`);
    }

    await new Promise(r => setTimeout(r, 1000));

    // 2. Fetch ReportRatios
    console.log('\n3. Fetching ReportRatios (key financial ratios)...');
    let ratios: Record<string, any> = {};
    try {
      const ratiosXml = await client.fetchFundamentalReport(
        ticker, 'OSE', FundamentalsReportType.FINANCIAL_SUMMARY
      );
      console.log(`   Received ${ratiosXml.length} bytes`);
      ratios = parseReportRatios(ratiosXml);

      // Print all available ratio fields
      console.log(`   Found ${Object.keys(ratios).length} ratio fields:`);
      for (const [key, value] of Object.entries(ratios).sort()) {
        console.log(`     ${key.padEnd(30)} = ${value}`);
      }
    } catch (err: any) {
      console.warn(`   ReportRatios failed: ${err.message}`);
    }

    await new Promise(r => setTimeout(r, 1000));

    // 3. Fetch Financial Statements
    console.log('\n4. Fetching ReportsFinStatements (income/balance sheet)...');
    let finData = {
      latestRevenue: null as number | null,
      previousRevenue: null as number | null,
      bookValue: null as number | null,
      eps: null as number | null,
    };
    try {
      const finXml = await client.fetchFundamentalReport(
        ticker, 'OSE', FundamentalsReportType.FINANCIAL_STATEMENTS
      );
      console.log(`   Received ${finXml.length} bytes`);
      finData = parseFinancialStatements(finXml);
    } catch (err: any) {
      console.warn(`   FinStatements failed: ${err.message}`);
    }

    // 4. Get latest price from DB
    console.log('\n5. Getting latest price from database...');
    const priceResult = await pool.query(
      `SELECT close, date::text FROM prices_daily WHERE ticker = $1 ORDER BY date DESC LIMIT 1`,
      [ticker]
    );
    const latestPrice = priceResult.rows[0]?.close ? parseFloat(priceResult.rows[0].close) : null;
    console.log(`   Latest price: ${latestPrice} (${priceResult.rows[0]?.date})`);

    // 5. Calculate derived factors
    console.log('\n' + '='.repeat(70));
    console.log('DERIVED FACTOR VALUES');
    console.log('='.repeat(70));

    const peRatio = ratios['PEEXCLXOR'] || ratios['TTMPR2REV'] || ratios['P/E'];
    const pbRatio = ratios['PRICE2BK'] || ratios['PRICETOBK'];
    const psRatio = ratios['PRICE2SALES'] || ratios['TTMPR2REV'];
    const divYield = ratios['YIELD'] || ratios['DIVYIELD'] || ratios['TTMDIVSHR'];

    const bm = pbRatio ? 1 / pbRatio : null;
    const ep = peRatio ? 1 / peRatio : null;
    const dy = divYield ? divYield / 100 : null; // Convert from percentage
    const sp = psRatio ? 1 / psRatio : null;
    const sg = (finData.latestRevenue && finData.previousRevenue)
      ? (finData.latestRevenue - finData.previousRevenue) / Math.abs(finData.previousRevenue)
      : null;

    const sharesOut = parseSnapshot(
      await client.fetchFundamentalReport(ticker, 'OSE', FundamentalsReportType.COMPANY_OVERVIEW)
    ).sharesOutstanding;
    const mktcap = (sharesOut && latestPrice) ? sharesOut * latestPrice : null;

    console.log(`  bm (Book/Market = 1/PB):   ${bm?.toFixed(4) ?? 'N/A'}  (PB=${pbRatio ?? 'N/A'})`);
    console.log(`  ep (Earnings/Price = 1/PE): ${ep?.toFixed(4) ?? 'N/A'}  (PE=${peRatio ?? 'N/A'})`);
    console.log(`  dy (Dividend Yield):        ${dy?.toFixed(4) ?? 'N/A'}  (raw=${divYield ?? 'N/A'})`);
    console.log(`  sp (Sales/Price = 1/PS):    ${sp?.toFixed(4) ?? 'N/A'}  (PS=${psRatio ?? 'N/A'})`);
    console.log(`  sg (Sales Growth YoY):      ${sg?.toFixed(4) ?? 'N/A'}  (Rev: ${finData.latestRevenue?.toLocaleString()} -> ${finData.previousRevenue?.toLocaleString()})`);
    console.log(`  mktcap (Market Cap):        ${mktcap?.toLocaleString() ?? 'N/A'}  (shares=${sharesOut?.toLocaleString()}, price=${latestPrice})`);

    console.log('\n' + '='.repeat(70));
    console.log('TEST COMPLETE');
    console.log('='.repeat(70));

  } finally {
    await client.disconnect();
    await pool.end();
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
