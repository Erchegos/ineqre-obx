/**
 * OBX and Oslo Børs tickers - FULL LIST FOR TESTING
 * Updated as of 2026-01-20
 * 
 * This list combines:
 * - 36 tickers verified working with IB Gateway
 * - 22 additional tickers to be tested
 * 
 * Total: 58 tickers
 * 
 * After testing, remove tickers that fail to resolve.
 */

export const OBX_INDEX_TICKER = "OBX";

export const OBX_TICKERS = [
  // Core verified tickers (36)
  "AFG",      // AF Gruppen ASA
  "AKER",     // Aker ASA-A Shares
  "AKRBP",    // Aker BP ASA
  "ATEA",     // Atea ASA
  "AUSS",     // Austevoll Seafood ASA
  "AUTO",     // Autostore Holdings Ltd
  "BAKKA",    // Bakkafrost P/F
  "BRG",      // Borregaard ASA
  "BWLPG",    // BW LPG Ltd
  "CADLR",    // Cadeler A/S
  "DNB",      // DNB Bank ASA
  "ELK",      // Elkem ASA
  "ENTRA",    // Entra ASA
  "EQNR",     // Equinor ASA
  "FRO",      // Frontline PLC
  "GJF",      // Gjensidige Forsikring ASA
  "HAVI",     // Havila Shipping ASA
  "HEX",      // Hexagon Composites ASA
  "KIT",      // Kitron ASA
  "KOG",      // Kongsberg Gruppen ASA
  "MPCC",     // MPC Container Ships ASA
  "MOWI",     // Mowi ASA
  "NAS",      // Norwegian Air Shuttle ASA
  "NHY",      // Norsk Hydro ASA
  "NOD",      // Nordic Semiconductor ASA
  "ORK",      // Orkla ASA
  "RECSI",    // REC Silicon ASA
  "SALM",     // SalMar ASA
  "SCATC",    // Scatec ASA
  "SUBC",     // Subsea 7 SA
  "TECH",     // Technip Energies NV
  "TGS",      // TGS ASA
  "TIETO",    // TietoEVRY Oyj
  "VAR",      // Vår Energi ASA
  "VEI",      // Veidekke ASA
  "YAR",      // Yara International ASA
  
  // Additional tickers to test (22)
  "CMBTO",    // Cambi Group ASA
  "DOFG",     // DOF Group ASA
  "HAFNI",    // Hafnia Limited
  "HAUTO",    // Hurtigruten ASA
  "LSG",      // Lerøy Seafood Group ASA
  "MING",     // Multiconsult ASA
  "ODL",      // Odfjell Drilling Ltd
  "OLT",      // Oceanteam ASA
  "PROT",     // Protector Forsikring ASA
  "SB1NO",    // SpareBank 1 Nord-Norge
  "SBNOR",    // SpareBank 1 Nordvest
  "SNI",      // Schibsted ASA
  "SPOL",     // Sparebank 1 Østlandet
  "STB",      // Storebrand ASA
  "SWON",     // Sbanken ASA
  "TEL",      // Telenor ASA
  "TOM",      // Tomra Systems ASA
  "VENDA",    // Veidekke (alternative ticker?)
  "VENDB",    // Veidekke B-shares
  "WAWI",     // Wallenius Wilhelmsen ASA
  "WWI",      // Wilh. Wilhelmsen Holding ASA
  "WWIB",     // Wilh. Wilhelmsen Holding B
] as const;

export const ALL_TICKERS = [OBX_INDEX_TICKER, ...OBX_TICKERS] as const;

export type OBXTicker = (typeof OBX_TICKERS)[number];
export type AllTicker = (typeof ALL_TICKERS)[number];
