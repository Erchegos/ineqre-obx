#!/usr/bin/env tsx
/**
 * Discover additional OSE stocks available on IBKR
 * Tests each ticker for:
 * 1. Historical data availability (5+ years)
 * 2. Fundamental data availability
 */

import { TWSClient } from "../packages/ibkr/src/tws-client";
import { FundamentalsClient, FundamentalsReportType } from "../packages/ibkr/src/fundamentals-client";
import { SecType } from "@stoqey/ib";

// Extended list of potential Oslo Børs tickers to test
// These are stocks that might be available on OSE but not yet in our database
const POTENTIAL_TICKERS = [
  // Banks and financials
  "SBANK", "NONG", "SRBNK", "SBNOR", "HELG", "MORG", "TOTG", "PARB",
  // Energy
  "AKSO", "PGS", "SDRL", "ARCHER", "BWO", "SOFF", "DOF", "SOLV", "BONHR",
  // Shipping/Maritime
  "GOGL", "FLNG", "COOL", "HSHP", "GOLDEN", "ODF", "SSHIP", "AVANCE", "HUNT", "KCC",
  // Consumer/Retail
  "XXL", "KID", "SACSC", "MORG",
  // Industrials
  "AKVA", "MULTI", "SCHA", "PHO", "NPRO", "NEXT", "BELCO",
  // Technology
  "LINK", "CRAYN", "IDEX", "OTEC", "PEXIP", "KAHOT", "THIN",
  // Healthcare
  "PCI", "PCIB", "MEDI", "PHARM",
  // Seafood
  "GSF", "ICE", "SSALM", "AKOBO", "NRS", "NOVA",
  // Real estate
  "SOLON", "SELF", "OBOS", "SBANK",
  // Other
  "FLYR", "REACH", "AGAS", "ENDUR", "CLOUD", "BEWI", "PNOR", "KMCP", "GRONG",
  "BOUV", "AMSC", "ASC", "QFR", "ULTI", "AEGA", "ABG", "NORBT", "NEL", "RECSI",
  "NAPA", "INSR", "KOA", "MHG", "SCHB", "B2H", "2020", "ABL", "AKER", "ARCH",
  "ADE", "AKAST", "AKH", "ALNOR", "AGAS", "AYFIE", "BCS", "BDRILL", "BGS",
];

// Current tickers in database to skip
const EXISTING_TICKERS = new Set([
  "AFG", "AKER", "AKRBP", "ATEA", "AUSS", "AUTO", "BAKKA", "BRG", "BWLPG", "CADLR",
  "CMBTO", "DNB", "DOFG", "ELK", "ENTRA", "EQNR", "FRO", "GJF", "HAFNI", "HAUTO",
  "HAVI", "HEX", "KIT", "KOG", "LSG", "MING", "MOWI", "MPCC", "NAS", "NHY", "NOD",
  "OBX", "ODL", "OLT", "ORK", "PROT", "RECSI", "SALM", "SB1NO", "SCATC", "SNI",
  "SPOL", "STB", "SUBC", "SWON", "TECH", "TEL", "TGS", "TIETO", "TOM", "VAR",
  "VEI", "VEND", "WAWI", "WWI", "YAR"
]);

interface StockResult {
  ticker: string;
  hasHistoricalData: boolean;
  dataYears?: number;
  hasFundamentals: boolean;
  companyName?: string;
  error?: string;
}

async function testTicker(
  twsClient: TWSClient,
  fundClient: FundamentalsClient,
  ticker: string
): Promise<StockResult> {
  const result: StockResult = {
    ticker,
    hasHistoricalData: false,
    hasFundamentals: false,
  };

  try {
    // Test historical data - try to get 5 years
    const historicalData = await twsClient.getHistoricalData(
      ticker,
      "OSE",
      "5 Y",
      "1 day",
      SecType.STK,
      "NOK"
    );

    if (historicalData && historicalData.length > 0) {
      result.hasHistoricalData = true;
      result.dataYears = Math.round(historicalData.length / 252 * 10) / 10;
    }
  } catch (e: any) {
    // Historical data not available
    result.error = e.message;
    return result;
  }

  // Only test fundamentals if historical data is available
  if (result.hasHistoricalData) {
    try {
      const xml = await fundClient.fetchFundamentalReport(
        ticker,
        "OSE",
        FundamentalsReportType.COMPANY_OVERVIEW,
        SecType.STK,
        "NOK"
      );

      if (xml && xml.length > 100) {
        result.hasFundamentals = true;
        // Extract company name from XML
        const nameMatch = xml.match(/<CoID Type="CompanyName">([^<]+)<\/CoID>/);
        if (nameMatch) {
          result.companyName = nameMatch[1];
        }
      }
    } catch (e: any) {
      // Fundamentals not available
    }
  }

  return result;
}

async function main() {
  console.log("Discovering additional OSE stocks on IBKR...\n");

  const twsClient = new TWSClient();
  const fundClient = new FundamentalsClient();

  // Filter out existing tickers
  const tickersToTest = POTENTIAL_TICKERS.filter(t => !EXISTING_TICKERS.has(t));
  console.log(`Testing ${tickersToTest.length} potential tickers...\n`);

  const validStocks: StockResult[] = [];
  const failedStocks: string[] = [];

  try {
    await twsClient.connect();
    await fundClient.connect();
    console.log("[OK] Connected to IB Gateway\n");

    for (let i = 0; i < tickersToTest.length; i++) {
      const ticker = tickersToTest[i];
      process.stdout.write(`[${i + 1}/${tickersToTest.length}] Testing ${ticker}...`);

      const result = await testTicker(twsClient, fundClient, ticker);

      if (result.hasHistoricalData && result.dataYears! >= 5 && result.hasFundamentals) {
        console.log(` OK (${result.dataYears} years, fundamentals: yes) - ${result.companyName || 'N/A'}`);
        validStocks.push(result);
      } else if (result.hasHistoricalData) {
        console.log(` PARTIAL (${result.dataYears} years, fundamentals: ${result.hasFundamentals ? 'yes' : 'no'})`);
        if (result.dataYears! >= 5) {
          validStocks.push(result);
        }
      } else {
        console.log(` FAILED`);
        failedStocks.push(ticker);
      }

      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    console.log("\n" + "=".repeat(70));
    console.log("DISCOVERY RESULTS");
    console.log("=".repeat(70));
    console.log(`\nValid stocks found: ${validStocks.length}`);
    console.log(`Failed/unavailable: ${failedStocks.length}`);

    if (validStocks.length > 0) {
      console.log("\nSTOCKS MEETING REQUIREMENTS (5+ years data, fundamentals available):");
      console.log("-".repeat(70));
      validStocks
        .filter(s => s.dataYears! >= 5 && s.hasFundamentals)
        .forEach(s => {
          console.log(`  ${s.ticker.padEnd(10)} ${(s.dataYears + " yrs").padEnd(10)} ${s.companyName || 'N/A'}`);
        });

      console.log("\nSTOCKS WITH 5+ YEARS DATA (fundamentals may be missing):");
      console.log("-".repeat(70));
      validStocks
        .filter(s => s.dataYears! >= 5 && !s.hasFundamentals)
        .forEach(s => {
          console.log(`  ${s.ticker.padEnd(10)} ${(s.dataYears + " yrs").padEnd(10)} (no fundamentals)`);
        });
    }

    // Output as array for easy copy
    console.log("\n\nTICKERS TO ADD (copy this array):");
    console.log("-".repeat(70));
    const tickersToAdd = validStocks.filter(s => s.dataYears! >= 5).map(s => `"${s.ticker}"`);
    console.log(`[${tickersToAdd.join(", ")}]`);

  } catch (error: any) {
    console.error("[ERROR]", error.message);
  } finally {
    await twsClient.disconnect();
    await fundClient.disconnect();
  }
}

main();
