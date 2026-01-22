/**
 * OBX and Oslo Børs tickers - VERIFIED WORKING
 * Updated as of 2026-01-22
 *
 * All 57 tickers verified working with IB Gateway (port 4002)
 *
 * Failed/removed: SBNOR, VENDA, VENDB
 */

export const OBX_INDEX_TICKER = "OBX";

export const OBX_TICKERS = [
  // Verified working tickers (56 stocks + OBX index)
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
  "CMBTO",    // Cambi Group ASA
  "DNB",      // DNB Bank ASA
  "DOFG",     // DOF Group ASA
  "ELK",      // Elkem ASA
  "ENTRA",    // Entra ASA
  "EQNR",     // Equinor ASA
  "FRO",      // Frontline PLC
  "GJF",      // Gjensidige Forsikring ASA
  "HAFNI",    // Hafnia Limited
  "HAUTO",    // Hurtigruten ASA
  "HAVI",     // Havila Shipping ASA
  "HEX",      // Hexagon Composites ASA
  "KIT",      // Kitron ASA
  "KOG",      // Kongsberg Gruppen ASA
  "LSG",      // Lerøy Seafood Group ASA
  "MING",     // Multiconsult ASA
  "MPCC",     // MPC Container Ships ASA
  "MOWI",     // Mowi ASA
  "NAS",      // Norwegian Air Shuttle ASA
  "NHY",      // Norsk Hydro ASA
  "NOD",      // Nordic Semiconductor ASA
  "ODL",      // Odfjell Drilling Ltd
  "OLT",      // Oceanteam ASA
  "ORK",      // Orkla ASA
  "PROT",     // Protector Forsikring ASA
  "RECSI",    // REC Silicon ASA
  "SALM",     // SalMar ASA
  "SB1NO",    // SpareBank 1 Nord-Norge
  "SCATC",    // Scatec ASA
  "SNI",      // Schibsted ASA
  "SPOL",     // Sparebank 1 Østlandet
  "STB",      // Storebrand ASA
  "SUBC",     // Subsea 7 SA
  "SWON",     // Sbanken ASA
  "TECH",     // Technip Energies NV
  "TEL",      // Telenor ASA
  "TGS",      // TGS ASA
  "TIETO",    // TietoEVRY Oyj
  "TOM",      // Tomra Systems ASA
  "VAR",      // Vår Energi ASA
  "VEI",      // Veidekke ASA
  "VEND",     // Vend Marketplace
  "WAWI",     // Wallenius Wilhelmsen ASA
  "WWI",      // Wilh. Wilhelmsen Holding ASA
  "WWIB",     // Wilh. Wilhelmsen Holding B
  "YAR",      // Yara International ASA
] as const;

export const ALL_TICKERS = [OBX_INDEX_TICKER, ...OBX_TICKERS] as const;

export type OBXTicker = (typeof OBX_TICKERS)[number];
export type AllTicker = (typeof ALL_TICKERS)[number];
