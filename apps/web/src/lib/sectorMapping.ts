/**
 * Sector-Commodity Mapping Constants
 *
 * Maps OSE sectors to their commodity drivers and constituent stocks.
 * Used by commodity dashboard, sector overview, and API routes.
 *
 * Full commodity universe matches TradingEconomics coverage:
 * Energy (7), Metals (6), Agricultural (3), Seafood (1)
 */

export interface SectorDef {
  color: string;
  commodities: string[];
  primaryCommodity: string | null;
  tickers: string[];
  rateIndices?: string[];
}

export const SECTOR_MAP: Record<string, SectorDef> = {
  Energy: {
    color: "#ef4444",
    commodities: ["BZ=F", "CL=F", "NG=F", "RB=F", "HO=F", "TTF=F"],
    primaryCommodity: "BZ=F",
    tickers: ["EQNR", "DNO", "AKRBP", "SUBC", "VAR", "DOFG", "OET", "TGS"],
  },
  Seafood: {
    color: "#22c55e",
    commodities: ["SALMON"],
    primaryCommodity: "SALMON",
    tickers: ["MOWI", "SALM", "LSG", "GSF", "BAKKA", "AUSS"],
  },
  Shipping: {
    color: "#3b82f6",
    commodities: [],
    primaryCommodity: null,
    tickers: ["FRO", "HAFNI", "2020", "GOGL", "MPCC", "FLNG", "SOFF", "BORR", "HAVI", "DOFG"],
    rateIndices: ["BDI", "BDTI", "BCTI"],
  },
  Materials: {
    color: "#f59e0b",
    commodities: ["ALI=F", "HG=F", "TIO=F", "STEEL"],
    primaryCommodity: "ALI=F",
    tickers: ["NHY", "ELK"],
  },
};

export interface CommodityMeta {
  name: string;
  category: string;
  importance: number;
  unit: string;
}

/** Full commodity universe — matches TradingEconomics correlation matrix */
export const COMMODITY_META: Record<string, CommodityMeta> = {
  // Energy
  "CL=F":   { name: "Crude Oil",     category: "Energy",       importance: 95,  unit: "USD/bbl" },
  "BZ=F":   { name: "Brent",         category: "Energy",       importance: 100, unit: "USD/bbl" },
  "NG=F":   { name: "Natural Gas",   category: "Energy",       importance: 60,  unit: "USD/MMBtu" },
  "RB=F":   { name: "Gasoline",      category: "Energy",       importance: 55,  unit: "USD/gal" },
  "HO=F":   { name: "Heating Oil",   category: "Energy",       importance: 50,  unit: "USD/gal" },
  "TTF=F":  { name: "TTF Gas",       category: "Energy",       importance: 65,  unit: "EUR/MWh" },
  "MTF=F":  { name: "Coal",          category: "Energy",       importance: 45,  unit: "USD/t" },
  // Metals
  "GC=F":   { name: "Gold",          category: "Metals",       importance: 70,  unit: "USD/oz" },
  "SI=F":   { name: "Silver",        category: "Metals",       importance: 45,  unit: "USD/oz" },
  "HG=F":   { name: "Copper",        category: "Metals",       importance: 60,  unit: "USD/lb" },
  "ALI=F":  { name: "Aluminium",     category: "Metals",       importance: 65,  unit: "USD/t" },
  "TIO=F":  { name: "Iron Ore",     category: "Metals",       importance: 55,  unit: "USD/t" },
  "STEEL":  { name: "Steel",        category: "Metals",       importance: 50,  unit: "CNY/t" },
  // Agricultural
  "ZS=F":   { name: "Soybeans",      category: "Agricultural", importance: 40,  unit: "USc/bu" },
  "ZW=F":   { name: "Wheat",         category: "Agricultural", importance: 40,  unit: "USc/bu" },
  "LBS=F":  { name: "Lumber",        category: "Agricultural", importance: 30,  unit: "USD/mbf" },
  // Seafood
  "SALMON": { name: "Salmon",        category: "Seafood",      importance: 90,  unit: "NOK/kg" },
};

/** Category colors for treemap and scatter */
export const CATEGORY_COLORS: Record<string, string> = {
  Energy:       "#ef4444",
  Metals:       "#f59e0b",
  Agricultural: "#a855f7",
  Seafood:      "#22c55e",
};

/** Get sector for a ticker */
export function getSectorForTicker(ticker: string): string | null {
  for (const [sector, def] of Object.entries(SECTOR_MAP)) {
    if (def.tickers.includes(ticker)) return sector;
  }
  return null;
}

/** Get all tickers across all sectors */
export function getAllSectorTickers(): string[] {
  const set = new Set<string>();
  for (const def of Object.values(SECTOR_MAP)) {
    for (const t of def.tickers) set.add(t);
  }
  return Array.from(set);
}
