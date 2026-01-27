#!/usr/bin/env tsx
import { Pool } from "pg";
import dotenv from "dotenv";

dotenv.config();

// Disable SSL cert validation for development
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: false,
});

// Oslo Børs sector classifications
const SECTOR_MAPPING: Record<string, string> = {
  // Energy
  "EQNR": "Energy",
  "AKER": "Energy",
  "AKRBP": "Energy",
  "VAR": "Energy",
  "AKSO": "Energy",
  "BOUV": "Energy",
  "OTEC": "Energy",
  "TECH": "Energy",

  // Finance
  "DNB": "Finance",
  "SB1NO": "Finance",
  "SPOL": "Finance",
  "STB": "Finance",
  "PARB": "Finance",
  "SWON": "Finance",
  "MING": "Finance",  // Bank
  "GJF": "Finance",   // Gjensidige Forsikring - Insurance
  "NONG": "Finance",  // SpareBank 1 Nord-Norge - Bank

  // Shipping & Offshore
  "FRO": "Shipping",
  "BRG": "Shipping",
  "BWO": "Shipping",
  "HAFNI": "Shipping",
  "HAUTO": "Shipping",
  "HUNT": "Shipping",
  "SNI": "Shipping",
  "SALM": "Shipping",
  "BWLPG": "Shipping",
  "MPCC": "Shipping",
  "GSF": "Shipping",
  "SUBC": "Shipping",
  "WWI": "Shipping",
  "WAWI": "Shipping",
  "2020": "Shipping",  // 2020 Bulkers Ltd

  // Seafood & Aquaculture
  "MOWI": "Seafood",
  "SALM": "Seafood",
  "AKVA": "Seafood",
  "LSG": "Seafood",
  "AUSS": "Seafood",
  "GSF": "Seafood",
  "NRS": "Seafood",

  // Technology & Telecom
  "TEL": "Technology",
  "NEXT": "Technology",
  "ATEA": "Technology",
  "TIETO": "Technology",
  "PEXIP": "Technology",
  "IDEX": "Technology",
  "CADLR": "Technology",
  "NORBT": "Technology",

  // Real Estate
  "ENTRA": "Real Estate",
  "MULTI": "Real Estate",
  "KOA": "Real Estate",
  "OLT": "Real Estate",
  "NAPA": "Real Estate",

  // Industrial
  "KOG": "Industrial",
  "AKAST": "Industrial",
  "TOM": "Industrial",
  "VEND": "Industrial",
  "AUTO": "Industrial",
  "ORK": "Industrial",
  "KMCP": "Industrial",
  "ARCH": "Industrial",
  "BRG": "Industrial",
  "SCATC": "Industrial",
  "KIT": "Industrial",
  "YAR": "Industrial",  // Yara - Fertilizer/Chemical
  "NHY": "Industrial",  // Norsk Hydro - Aluminum/Metal

  // Consumer
  "NAS": "Consumer",
  "KID": "Consumer",
  "ABG": "Consumer",
  "BAKKA": "Consumer",
  "BONHR": "Consumer",

  // Healthcare
  "MEDI": "Healthcare",

  // Materials
  "ELK": "Materials",
  "RECSI": "Materials",  // REC Silicon - Silicon production

  // Renewable Energy
  "NEL": "Renewable Energy",
  "SCATC": "Renewable Energy",
  "HEX": "Renewable Energy",

  // Investment/Holding Companies
  "AFG": "Investment",
  "KCC": "Investment",
  "100B": "Investment",
  "ENDUR": "Investment",
  "PCIB": "Investment",
  "PHO": "Investment",
  "PROT": "Investment",
  "SOFF": "Investment",
  "VEI": "Investment",
  "ODF": "Investment",
  "ODL": "Investment",
  "ABL": "Investment",
  "DOFG": "Investment",
  "HAVI": "Investment",
  "NOD": "Investment",

  // ETFs/Indices (mark as Index for filtering)
  "OBX": "Index",
  "OSEBX": "Index",
  "OSEAX": "Index",
  "SPY": "Index",
  "QQQ": "Index",
  "IWM": "Index",
  "VGK": "Index",
  "EFA": "Index",
  "EWN": "Index",
  "EWD": "Index",
  "DAX": "Index",
  "NDX": "Index",
  "SPX": "Index",
  "VIX": "Index",
  "ESTX50": "Index",
  "NORW": "Index",

  // Commodity ETFs
  "GLD": "Commodities",
  "SLV": "Commodities",
  "USO": "Commodities",
  "DBC": "Commodities",
  "DBB": "Commodities",
  "COPX": "Commodities",
  "XLE": "Commodities",
  "XOP": "Commodities",
};

async function main() {
  try {
    let updated = 0;
    let notFound = 0;
    const notFoundTickers: string[] = [];

    // Get all tickers
    const result = await pool.query("SELECT ticker FROM stocks ORDER BY ticker");

    for (const row of result.rows) {
      const ticker = row.ticker;
      const sector = SECTOR_MAPPING[ticker];

      if (sector) {
        await pool.query(
          "UPDATE stocks SET sector = $1 WHERE ticker = $2",
          [sector, ticker]
        );
        console.log(`✓ ${ticker} → ${sector}`);
        updated++;
      } else {
        notFoundTickers.push(ticker);
        notFound++;
      }
    }

    console.log("\n" + "=".repeat(50));
    console.log("UPDATE SUMMARY");
    console.log("=".repeat(50));
    console.log(`Total tickers: ${result.rows.length}`);
    console.log(`Updated: ${updated}`);
    console.log(`Not found: ${notFound}`);

    if (notFoundTickers.length > 0) {
      console.log("\nTickers without sector mapping:");
      notFoundTickers.forEach(t => console.log(`  - ${t}`));
    }

  } catch (error) {
    console.error("Error:", error);
  } finally {
    await pool.end();
  }
}

main();
