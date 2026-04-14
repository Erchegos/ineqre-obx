/**
 * Sector-Commodity Mapping Constants
 * Used by /commodities and /sectors dashboards.
 */

export const SECTOR_MAP: Record<string, {
  color: string;
  icon: string;
  commodities: string[];
  primaryCommodity: string | null;
  tickers: string[];
  rateIndices?: string[];
}> = {
  Energy: {
    color: "#ef4444",
    icon: "flame",
    commodities: ["BZ=F", "CL=F", "NG=F"],
    primaryCommodity: "BZ=F",
    tickers: ["EQNR", "DNO", "AKRBP", "SUBC", "VAR", "DOFG", "OET", "TGS"],
  },
  Seafood: {
    color: "#22c55e",
    icon: "fish",
    commodities: ["SALMON"],
    primaryCommodity: "SALMON",
    tickers: ["MOWI", "SALM", "LSG", "GSF", "BAKKA", "AUSS"],
  },
  Shipping: {
    color: "#3b82f6",
    icon: "anchor",
    commodities: [],
    primaryCommodity: null,
    tickers: ["FRO", "HAFNI", "2020", "GOGL", "MPCC", "FLNG", "SOFF", "BORR", "HAVI", "DOFG"],
    rateIndices: ["BDI", "BDTI", "BCTI"],
  },
  Materials: {
    color: "#f59e0b",
    icon: "cube",
    commodities: ["ALI=F", "HG=F"],
    primaryCommodity: "ALI=F",
    tickers: ["NHY", "ELK"],
  },
  Financials: {
    color: "#6366f1",
    icon: "landmark",
    commodities: [],
    primaryCommodity: null,
    tickers: ["DNB", "NOBA", "MING", "SRBNK", "NOFI", "HELG", "PARB", "GJENSIDI", "STB", "PROTCT", "AKER", "ABG"],
  },
  Technology: {
    color: "#06b6d4",
    icon: "cpu",
    commodities: [],
    primaryCommodity: null,
    tickers: ["NOD", "CRAYN", "KAHOT", "OTEC", "LINK", "NORBT", "BWLPG"],
  },
  Industrials: {
    color: "#8b5cf6",
    icon: "cog",
    commodities: [],
    primaryCommodity: null,
    tickers: ["AKSO", "TOM", "KOG", "WWASA", "SCHB", "HYON", "NEL"],
  },
  "Consumer Staples": {
    color: "#14b8a6",
    icon: "cart",
    commodities: [],
    primaryCommodity: null,
    tickers: ["ORK", "AEGA", "GYL"],
  },
  "Real Estate": {
    color: "#a78bfa",
    icon: "building",
    commodities: [],
    primaryCommodity: null,
    tickers: ["ENTRA", "OBOS", "SBO"],
  },
  "Health Care": {
    color: "#ec4899",
    icon: "heart",
    commodities: [],
    primaryCommodity: null,
    tickers: ["PHO", "MEDI", "PCIB"],
  },
};

export const COMMODITY_META: Record<string, {
  name: string;
  category: string;
  importance: number;
  unit: string;
}> = {
  "BZ=F":   { name: "Brent Crude",  category: "Energy",   importance: 100, unit: "USD/bbl" },
  "CL=F":   { name: "WTI Crude",    category: "Energy",   importance: 80,  unit: "USD/bbl" },
  "NG=F":   { name: "Natural Gas",  category: "Energy",   importance: 60,  unit: "USD/MMBtu" },
  "ALI=F":  { name: "Aluminium",    category: "Metals",   importance: 70,  unit: "USD/t" },
  "HG=F":   { name: "Copper",       category: "Metals",   importance: 55,  unit: "USD/lb" },
  "GC=F":   { name: "Gold",         category: "Metals",   importance: 65,  unit: "USD/oz" },
  "SI=F":   { name: "Silver",       category: "Metals",   importance: 40,  unit: "USD/oz" },
  "SALMON": { name: "Salmon",       category: "Seafood",  importance: 90,  unit: "NOK/kg" },
  "RB=F":   { name: "Gasoline",     category: "Energy",   importance: 45,  unit: "USD/gal" },
  "HO=F":   { name: "Heating Oil",  category: "Energy",   importance: 35,  unit: "USD/gal" },
  "TTF=F":  { name: "TTF Gas",      category: "Energy",   importance: 50,  unit: "EUR/MWh" },
  "MTF=F":  { name: "Coal",         category: "Energy",   importance: 30,  unit: "USD/t" },
  "ZS=F":   { name: "Soybeans",     category: "Agriculture", importance: 25, unit: "USD/bu" },
  "ZW=F":   { name: "Wheat",        category: "Agriculture", importance: 20, unit: "USD/bu" },
  "LBS=F":  { name: "Lumber",       category: "Materials",importance: 20,  unit: "USD/mbf" },
  "TIO=F":  { name: "Iron Ore",     category: "Metals",   importance: 35,  unit: "USD/t" },
  "STEEL":  { name: "Steel",        category: "Metals",   importance: 30,  unit: "CNY/t" },
};
