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
  "TGS": "Energy",
  "OET": "Energy",    // Okea ASA - Oil & gas exploration

  // Finance
  "DNB": "Finance",
  "SB1NO": "Finance",
  "SPOL": "Finance",
  "STB": "Finance",
  "PARB": "Finance",
  "MING": "Finance",  // Bank
  "GJF": "Finance",   // Gjensidige Forsikring - Insurance
  "NONG": "Finance",  // SpareBank 1 Nord-Norge - Bank
  "PROT": "Finance",  // Protector Forsikring - Insurance

  // Shipping & Offshore
  "FRO": "Shipping",
  "BWO": "Shipping",
  "HAFNI": "Shipping",
  "HAUTO": "Shipping",
  "HUNT": "Shipping",
  "SNI": "Shipping",
  "BWLPG": "Shipping",
  "MPCC": "Shipping",
  "SUBC": "Shipping",
  "WWI": "Shipping",
  "WAWI": "Shipping",
  "WWIB": "Shipping",
  "2020": "Shipping",   // 2020 Bulkers Ltd
  "HAVI": "Shipping",   // Havila Shipping
  "SOFF": "Shipping",   // Solstad Offshore
  "DOFG": "Shipping",   // DOF Group
  "KCC": "Shipping",    // Klaveness Combination Carriers
  "ODF": "Shipping",    // Odfjell - Chemical tankers
  "ODL": "Shipping",    // Odfjell Drilling
  "HSHP": "Shipping",   // Hamilton Shipping Partners - Product tankers
  "BORR": "Shipping",   // Borr Drilling - Dual listed (US: NYSE)
  "BWLP": "Shipping",   // BW LPG - Dual listed (US: NYSE)
  "CDLR": "Shipping",   // Cadeler - Dual listed (US: NYSE)
  "ECO": "Shipping",    // Okeanis Eco Tankers - Dual listed (US: NYSE)
  "HAFN": "Shipping",   // Hafnia - Dual listed (US: NYSE)

  // Seafood & Aquaculture
  "MOWI": "Seafood",
  "SALM": "Seafood",
  "AKVA": "Seafood",
  "LSG": "Seafood",
  "AUSS": "Seafood",
  "GSF": "Seafood",
  "BAKKA": "Seafood",  // Bakkafrost - Salmon farming

  // Technology & Telecom
  "TEL": "Technology",
  "NEXT": "Technology",
  "ATEA": "Technology",
  "TIETO": "Technology",
  "PEXIP": "Technology",
  "IDEX": "Technology",
  "CADLR": "Technology",
  "NORBT": "Technology",
  "NAPA": "Technology",   // Napatech - Networking equipment
  "CMBTO": "Technology",  // CMB Tech
  "BOUV": "Technology",   // Bouvet - IT consulting
  "OTEC": "Technology",   // Otello - Ad tech
  "TECH": "Technology",   // Techstep - IT services
  "NOD": "Technology",    // Nordic Semiconductor
  "SWON": "Technology",   // SoftwareOne

  // Real Estate
  "ENTRA": "Real Estate",
  "OLT": "Real Estate",

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
  "YAR": "Industrial",   // Yara - Fertilizer/Chemical
  "NHY": "Industrial",   // Norsk Hydro - Aluminum/Metal
  "KOA": "Industrial",   // Kongsberg Automotive
  "VEI": "Industrial",   // Veidekke - Construction
  "AFG": "Industrial",   // AF Gruppen - Construction
  "ABL": "Industrial",   // ABL Group - Marine/offshore engineering
  "MULTI": "Industrial", // Multiconsult - Engineering consulting

  // Consumer
  "NAS": "Consumer",
  "KID": "Consumer",
  "ABG": "Consumer",

  // Healthcare
  "MEDI": "Healthcare",
  "PCIB": "Healthcare",  // PCI Biotech - Biotech
  "PHO": "Healthcare",   // Photocure - Medical devices/pharma

  // Materials
  "ELK": "Materials",
  "RECSI": "Materials",  // REC Silicon - Silicon production

  // Renewable Energy
  "NEL": "Renewable Energy",
  "SCATC": "Renewable Energy",
  "HEX": "Renewable Energy",

  // Investment/Holding Companies
  "ENDUR": "Investment",
  "BONHR": "Investment",  // Bonheur - Diversified holding company

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
