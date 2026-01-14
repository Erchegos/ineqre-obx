// packages/ibkr/src/obx-tickers.ts

/**
 * OBX index constituents (Oslo Børs Benchmark Index)
 * Updated as of 2025
 */
export const OBX_TICKERS = [
  "EQNR",    // Equinor
  "DNB",     // DNB Bank
  "MOWI",    // Mowi
  "NHY",     // Norsk Hydro
  "TEL",     // Telenor
  "YAR",     // Yara International
  "AKER",    // Aker
  "SALM",    // SalMar
  "ORK",     // Orkla
  "BAKKA",   // Aker BP
  "STB",     // Storebrand
  "NONG",    // Norsk Gjenvinning (removed, keeping for historical)
  "SUBSEA",  // Subsea 7
  "AKRBP",   // Aker BP (alternative ticker)
  "KAHOT",   // Kitron
  "GOGL",    // Golden Ocean Group
  "MPCC",    // MPC Container Ships
  "PGS",     // Petroleum Geo-Services
  "XXL",     // XXL ASA
  "SCATC",   // Scatec
] as const;

/**
 * OBX index ticker
 */
export const OBX_INDEX_TICKER = "OBX";

/**
 * All tickers to fetch (OBX constituents + index)
 */
export const ALL_TICKERS = [OBX_INDEX_TICKER, ...OBX_TICKERS] as const;
