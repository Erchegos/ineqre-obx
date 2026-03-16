/**
 * Shipping TCE (Time Charter Equivalent) Calculation Library
 *
 * All formulas are based on Baltic Exchange methodology used by professional
 * shipbrokers. Sources:
 *   - Baltic Exchange voyage calculation methods
 *   - Worldscale Association annual flat rate tables
 *   - Industry standard voyage cost models
 *
 * TCE = (Gross Freight - Voyage Costs) / Round-trip Voyage Days
 * For TC vessels: TCE = daily rate (no voyage cost deduction)
 */

/* ─── Reference Data ──────────────────────────────────────────── */

export interface VoyageParams {
  ladenSpeedKnots: number;
  ballastSpeedKnots: number;
  ladenFuelMtDay: number;       // VLSFO consumption (MT/day) laden
  ballastFuelMtDay: number;     // VLSFO consumption (MT/day) ballast
  portIdleFuelMtDay: number;    // fuel at port/maneuvering
  standardCargoMt: number;      // typical cargo size (metric tonnes)
  portCostLoadUsd: number;      // port disbursements at load port ($)
  portCostDischargeUsd: number; // port disbursements at discharge port ($)
  portDaysLoad: number;         // days at load port (loading + idle)
  portDaysDisch: number;        // days at discharge port (discharging + idle)
}

/**
 * Vessel voyage parameters by type.
 * Speeds and fuel consumption are at "eco" sailing speeds typical for 2024-2026.
 * Source: industry standard assumptions; actual varies by age/spec/weather.
 */
export const VESSEL_VOYAGE_PARAMS: Record<string, VoyageParams> = {
  vlcc: {
    ladenSpeedKnots: 13.5, ballastSpeedKnots: 15.0,
    ladenFuelMtDay: 82,   ballastFuelMtDay: 62,  portIdleFuelMtDay: 15,
    standardCargoMt: 260000, portCostLoadUsd: 90000, portCostDischargeUsd: 90000,
    portDaysLoad: 1.5, portDaysDisch: 1.5,
  },
  suezmax: {
    ladenSpeedKnots: 14.0, ballastSpeedKnots: 15.5,
    ladenFuelMtDay: 50,   ballastFuelMtDay: 38,  portIdleFuelMtDay: 10,
    standardCargoMt: 130000, portCostLoadUsd: 70000, portCostDischargeUsd: 70000,
    portDaysLoad: 1.5, portDaysDisch: 1.5,
  },
  aframax_lr2: {
    ladenSpeedKnots: 13.5, ballastSpeedKnots: 15.0,
    ladenFuelMtDay: 42,   ballastFuelMtDay: 32,  portIdleFuelMtDay: 8,
    standardCargoMt: 80000, portCostLoadUsd: 50000, portCostDischargeUsd: 50000,
    portDaysLoad: 1.5, portDaysDisch: 1.5,
  },
  lr2_tanker: {
    ladenSpeedKnots: 14.0, ballastSpeedKnots: 15.5,
    ladenFuelMtDay: 40,   ballastFuelMtDay: 30,  portIdleFuelMtDay: 8,
    standardCargoMt: 75000, portCostLoadUsd: 50000, portCostDischargeUsd: 50000,
    portDaysLoad: 1.5, portDaysDisch: 1.5,
  },
  mr_tanker: {
    ladenSpeedKnots: 13.5, ballastSpeedKnots: 15.0,
    ladenFuelMtDay: 28,   ballastFuelMtDay: 22,  portIdleFuelMtDay: 6,
    standardCargoMt: 37000, portCostLoadUsd: 35000, portCostDischargeUsd: 35000,
    portDaysLoad: 1.5, portDaysDisch: 1.5,
  },
  handy_tanker: {
    ladenSpeedKnots: 13.0, ballastSpeedKnots: 14.5,
    ladenFuelMtDay: 22,   ballastFuelMtDay: 17,  portIdleFuelMtDay: 5,
    standardCargoMt: 25000, portCostLoadUsd: 28000, portCostDischargeUsd: 28000,
    portDaysLoad: 1.5, portDaysDisch: 1.5,
  },
  lng_carrier: {
    ladenSpeedKnots: 19.0, ballastSpeedKnots: 19.5,
    ladenFuelMtDay: 130,  ballastFuelMtDay: 100, portIdleFuelMtDay: 25,
    standardCargoMt: 65000, portCostLoadUsd: 100000, portCostDischargeUsd: 100000,
    portDaysLoad: 1.0, portDaysDisch: 1.0,
  },
  vlgc: {
    ladenSpeedKnots: 16.5, ballastSpeedKnots: 17.5,
    ladenFuelMtDay: 55,   ballastFuelMtDay: 42,  portIdleFuelMtDay: 10,
    standardCargoMt: 44000, portCostLoadUsd: 60000, portCostDischargeUsd: 60000,
    portDaysLoad: 2.0, portDaysDisch: 2.0,
  },
  capesize: {
    ladenSpeedKnots: 13.5, ballastSpeedKnots: 14.5,
    ladenFuelMtDay: 52,   ballastFuelMtDay: 42,  portIdleFuelMtDay: 8,
    standardCargoMt: 170000, portCostLoadUsd: 35000, portCostDischargeUsd: 35000,
    portDaysLoad: 4.0, portDaysDisch: 5.0,
  },
  newcastlemax: {
    ladenSpeedKnots: 13.5, ballastSpeedKnots: 14.5,
    ladenFuelMtDay: 58,   ballastFuelMtDay: 46,  portIdleFuelMtDay: 9,
    standardCargoMt: 200000, portCostLoadUsd: 40000, portCostDischargeUsd: 40000,
    portDaysLoad: 4.0, portDaysDisch: 5.0,
  },
  panamax_bulk: {
    ladenSpeedKnots: 13.0, ballastSpeedKnots: 14.0,
    ladenFuelMtDay: 32,   ballastFuelMtDay: 26,  portIdleFuelMtDay: 6,
    standardCargoMt: 75000, portCostLoadUsd: 25000, portCostDischargeUsd: 25000,
    portDaysLoad: 4.0, portDaysDisch: 4.0,
  },
  ultramax: {
    ladenSpeedKnots: 12.5, ballastSpeedKnots: 13.5,
    ladenFuelMtDay: 26,   ballastFuelMtDay: 20,  portIdleFuelMtDay: 5,
    standardCargoMt: 63000, portCostLoadUsd: 20000, portCostDischargeUsd: 20000,
    portDaysLoad: 3.5, portDaysDisch: 4.0,
  },
  pctc: {
    ladenSpeedKnots: 18.0, ballastSpeedKnots: 18.5,
    ladenFuelMtDay: 65,   ballastFuelMtDay: 60,  portIdleFuelMtDay: 12,
    standardCargoMt: 4000, portCostLoadUsd: 80000, portCostDischargeUsd: 80000,
    portDaysLoad: 2.0, portDaysDisch: 2.0,
  },
  container_feeder: {
    ladenSpeedKnots: 14.0, ballastSpeedKnots: 14.5,
    ladenFuelMtDay: 30,   ballastFuelMtDay: 25,  portIdleFuelMtDay: 8,
    standardCargoMt: 5000, portCostLoadUsd: 40000, portCostDischargeUsd: 40000,
    portDaysLoad: 1.5, portDaysDisch: 1.5,
  },
  chemical_tanker: {
    ladenSpeedKnots: 13.0, ballastSpeedKnots: 14.0,
    ladenFuelMtDay: 30,   ballastFuelMtDay: 24,  portIdleFuelMtDay: 7,
    standardCargoMt: 30000, portCostLoadUsd: 45000, portCostDischargeUsd: 45000,
    portDaysLoad: 2.0, portDaysDisch: 2.0,
  },
};

/* ─── Standard Reference Routes ──────────────────────────────── */

export interface RouteParams {
  code: string;
  description: string;
  vesselType: string;
  ladenDistanceNm: number;
  ballastDistanceNm: number;
  canalFeeUsd: number;       // Suez/Panama canal cost (one-way laden)
  wsFlat2025?: number;       // Worldscale flat rate ($/tonne), 2025 table
  loadPort: string;
  dischargePort: string;
  segment: "tanker_crude" | "tanker_clean" | "dry_bulk" | "gas" | "lng" | "container" | "car_carrier";
}

/**
 * Key Baltic Exchange reference routes.
 * Distances from sea-distances.org / Portworld calculator.
 * WS flat rates from Worldscale Association 2025 annual table (approximate).
 */
export const REFERENCE_ROUTES: RouteParams[] = [
  // ── CRUDE TANKERS ──
  { code: "TD3C", description: "VLCC AG-China (MEG-Ningbo)", vesselType: "vlcc",
    ladenDistanceNm: 6550, ballastDistanceNm: 6200,
    canalFeeUsd: 0, wsFlat2025: 17.15, loadPort: "Ras Tanura", dischargePort: "Ningbo",
    segment: "tanker_crude" },
  { code: "TD20", description: "Suezmax WAF-UKC (Bonny-Lavera)", vesselType: "suezmax",
    ladenDistanceNm: 5050, ballastDistanceNm: 4400,
    canalFeeUsd: 480000, wsFlat2025: 22.65, loadPort: "Bonny", dischargePort: "Lavera",
    segment: "tanker_crude" },
  { code: "TD17", description: "Suezmax Baltic-UKC (Primorsk-Rotterdam)", vesselType: "suezmax",
    ladenDistanceNm: 1900, ballastDistanceNm: 1900,
    canalFeeUsd: 0, wsFlat2025: 9.35, loadPort: "Primorsk", dischargePort: "Rotterdam",
    segment: "tanker_crude" },
  { code: "TD6", description: "Suezmax CPC-Med (Novorossiysk-Augusta)", vesselType: "suezmax",
    ladenDistanceNm: 1100, ballastDistanceNm: 1100,
    canalFeeUsd: 0, wsFlat2025: 7.80, loadPort: "Novorossiysk", dischargePort: "Augusta",
    segment: "tanker_crude" },
  // ── PRODUCT / CLEAN TANKERS ──
  { code: "TC1", description: "LR2/Aframax AG-Japan clean (Jubail-Chiba)", vesselType: "lr2_tanker",
    ladenDistanceNm: 5850, ballastDistanceNm: 5500,
    canalFeeUsd: 0, wsFlat2025: 26.60, loadPort: "Jubail", dischargePort: "Chiba",
    segment: "tanker_clean" },
  { code: "TC2", description: "MR UKC-USAC (Rotterdam-New York)", vesselType: "mr_tanker",
    ladenDistanceNm: 3600, ballastDistanceNm: 3600,
    canalFeeUsd: 0, wsFlat2025: 31.55, loadPort: "Rotterdam", dischargePort: "New York",
    segment: "tanker_clean" },
  // ── DRY BULK ──
  { code: "C5", description: "Capesize W.Australia-China (Dampier-Qingdao)", vesselType: "capesize",
    ladenDistanceNm: 4600, ballastDistanceNm: 4800,
    canalFeeUsd: 0, wsFlat2025: undefined, loadPort: "Dampier", dischargePort: "Qingdao",
    segment: "dry_bulk" },
  { code: "C3", description: "Capesize Brazil-China (Tubarao-Qingdao)", vesselType: "capesize",
    ladenDistanceNm: 11600, ballastDistanceNm: 8500,
    canalFeeUsd: 0, wsFlat2025: undefined, loadPort: "Tubarao", dischargePort: "Qingdao",
    segment: "dry_bulk" },
  { code: "P3A_03", description: "Panamax ECSA-Europe (Santos-Rotterdam)", vesselType: "panamax_bulk",
    ladenDistanceNm: 5950, ballastDistanceNm: 5200,
    canalFeeUsd: 0, wsFlat2025: undefined, loadPort: "Santos", dischargePort: "Rotterdam",
    segment: "dry_bulk" },
  // ── GAS ──
  { code: "TC18", description: "VLGC ME-Asia (Ras Tanura-Chiba)", vesselType: "vlgc",
    ladenDistanceNm: 6200, ballastDistanceNm: 6000,
    canalFeeUsd: 0, wsFlat2025: undefined, loadPort: "Ras Tanura", dischargePort: "Chiba",
    segment: "gas" },
  { code: "TC19", description: "VLGC USGoM-Asia (Houston-Chiba)", vesselType: "vlgc",
    ladenDistanceNm: 13500, ballastDistanceNm: 12000,
    canalFeeUsd: 390000, wsFlat2025: undefined, loadPort: "Houston", dischargePort: "Chiba",
    segment: "gas" },
];

/* ─── Daily OPEX (running costs, not voyage costs) ───────────── */

/**
 * Daily OPEX estimates by vessel type (USD/day).
 * Includes crew, maintenance, insurance, management. Excludes voyage costs and finance.
 * Source: industry benchmarks (Clarksons Research 2024 estimates).
 */
export const DAILY_OPEX: Record<string, number> = {
  vlcc: 9500,
  suezmax: 8500,
  aframax_lr2: 8000,
  lr2_tanker: 8000,
  mr_tanker: 7000,
  handy_tanker: 6500,
  lng_carrier: 20000,   // LNG carriers have high OPEX (specialized crew + systems)
  vlgc: 11000,
  capesize: 8000,
  newcastlemax: 8500,
  panamax_bulk: 6500,
  ultramax: 6000,
  pctc: 14000,           // car carriers high OPEX (specialized facilities)
  container_feeder: 6500,
  chemical_tanker: 9000, // higher due to tank cleaning, specialized equipment
};

/* ─── Core Calculations ───────────────────────────────────────── */

/**
 * Calculate round-trip voyage TCE from a Worldscale rate.
 *
 * This is the definitive formula used by Baltic Exchange panelists.
 * TCE = (GrossFreight - Bunkers - PortCosts - CanalFees) / RoundTripDays
 *
 * @param wsRate - Worldscale rate (e.g. 70 for WS 70)
 * @param wsFlat - Worldscale flat rate in $/tonne (from annual Worldscale table)
 * @param cargoMt - Cargo size in metric tonnes
 * @param ladenNm - Laden voyage distance in nautical miles
 * @param ballastNm - Ballast voyage distance in nautical miles
 * @param params - Vessel voyage parameters
 * @param vlsfoPrice - VLSFO bunker price ($/MT), default $530
 * @param canalFee - Canal transit fee (Suez/Panama, one-way laden), default $0
 * @returns { tce, grossFreight, totalVoyageCosts, roundTripDays, breakdown }
 */
export function wsToTCE(
  wsRate: number,
  wsFlat: number,
  cargoMt: number,
  ladenNm: number,
  ballastNm: number,
  params: VoyageParams,
  vlsfoPrice = 530,
  canalFee = 0,
): {
  tce: number;
  grossFreight: number;
  bunkerCost: number;
  portCosts: number;
  canalFees: number;
  totalVoyageCosts: number;
  roundTripDays: number;
  ladenDays: number;
  ballastDays: number;
  netRevenue: number;
} {
  const grossFreight = (wsRate / 100) * wsFlat * cargoMt;

  const ladenSea = ladenNm / (params.ladenSpeedKnots * 24);
  const ballastSea = ballastNm / (params.ballastSpeedKnots * 24);
  const portDays = params.portDaysLoad + params.portDaysDisch;

  const bunkerSea = (ladenSea * params.ladenFuelMtDay + ballastSea * params.ballastFuelMtDay) * vlsfoPrice;
  const bunkerPort = portDays * params.portIdleFuelMtDay * vlsfoPrice;
  const bunkerCost = bunkerSea + bunkerPort;

  const portCosts = params.portCostLoadUsd + params.portCostDischargeUsd;
  const canalFees = canalFee;

  const totalVoyageCosts = bunkerCost + portCosts + canalFees;
  const roundTripDays = ladenSea + ballastSea + portDays;

  const netRevenue = grossFreight - totalVoyageCosts;
  const tce = roundTripDays > 0 ? netRevenue / roundTripDays : 0;

  return {
    tce, grossFreight, bunkerCost, portCosts, canalFees,
    totalVoyageCosts, roundTripDays,
    ladenDays: ladenSea + params.portDaysLoad,
    ballastDays: ballastSea + params.portDaysDisch,
    netRevenue,
  };
}

/**
 * Calculate TCE from a $/tonne freight rate (dry bulk style).
 */
export function freightPerTonneToTCE(
  freightPerTonne: number,
  cargoMt: number,
  ladenNm: number,
  ballastNm: number,
  params: VoyageParams,
  vlsfoPrice = 530,
  canalFee = 0,
) {
  return wsToTCE(100, freightPerTonne, cargoMt, ladenNm, ballastNm, params, vlsfoPrice, canalFee);
}

/**
 * Get reference voyage days for a standard route.
 */
export function getVoyageDays(routeCode: string, vesselType?: string): {
  ladenDays: number; ballastDays: number; portDays: number; total: number;
} | null {
  const route = REFERENCE_ROUTES.find(r => r.code === routeCode);
  const vtype = vesselType || route?.vesselType;
  if (!route || !vtype) return null;

  const params = VESSEL_VOYAGE_PARAMS[vtype];
  if (!params) return null;

  const ladenSea = route.ladenDistanceNm / (params.ladenSpeedKnots * 24);
  const ballastSea = route.ballastDistanceNm / (params.ballastSpeedKnots * 24);
  const portDays = params.portDaysLoad + params.portDaysDisch;

  return {
    ladenDays: ladenSea + params.portDaysLoad,
    ballastDays: ballastSea + params.portDaysDisch,
    portDays,
    total: ladenSea + ballastSea + portDays,
  };
}

/**
 * Given a spot market TCE rate (from Baltic Exchange or Pareto),
 * estimate the revenue breakdown for a spot vessel over N days.
 *
 * This is what we use in the earnings calculator when we have a
 * $/day TCE rate directly (as Pareto publishes).
 *
 * @param tceDayRate - TCE rate in $/day (already net of voyage costs)
 * @param vesselType - vessel type key
 * @param utilizationDays - number of earning days (default 365 * 0.96 per year, 90*0.96 per quarter)
 * @returns gross TCE revenue, OPEX, and net earnings
 */
export function spotEarnings(
  tceDayRate: number,
  vesselType: string,
  utilizationDays = 86.4, // 90 days × 96% utilization
): {
  tce: number;
  grossRevenue: number;
  opex: number;
  netEarnings: number;
  utilizationDays: number;
} {
  const opexPerDay = DAILY_OPEX[vesselType] ?? 8000;
  const grossRevenue = tceDayRate * utilizationDays;
  const opex = opexPerDay * utilizationDays;
  const netEarnings = grossRevenue - opex;

  return { tce: tceDayRate, grossRevenue, opex, netEarnings, utilizationDays };
}

/**
 * Estimate quarterly net TCE earnings for a mixed TC/spot fleet.
 *
 * @param tcVessels - array of {rate, vesselType} for time-chartered vessels
 * @param spotVessels - array of {marketTce, vesselType} for spot vessels
 * @param utilizationPct - fleet utilization (default 96%)
 * @returns per-vessel-day blended TCE, quarterly revenue, opex, net
 */
export function fleetQuarterlyEarnings(
  tcVessels: { rate: number; vesselType: string }[],
  spotVessels: { marketTce: number; vesselType: string }[],
  utilizationPct = 0.96,
): {
  blendedTce: number;
  dailyGrossRevenue: number;
  dailyOpex: number;
  dailyNetTce: number;
  quarterlyGross: number;
  quarterlyOpex: number;
  quarterlyNet: number;
  tcVesselCount: number;
  spotVesselCount: number;
} {
  const QUARTER_DAYS = 90 * utilizationPct;

  let totalTcRate = 0;
  let totalTcOpex = 0;
  for (const v of tcVessels) {
    totalTcRate += v.rate;
    totalTcOpex += DAILY_OPEX[v.vesselType] ?? 8000;
  }

  let totalSpotTce = 0;
  let totalSpotOpex = 0;
  for (const v of spotVessels) {
    totalSpotTce += v.marketTce;
    totalSpotOpex += DAILY_OPEX[v.vesselType] ?? 8000;
  }

  const totalVessels = tcVessels.length + spotVessels.length;
  const totalDailyGross = totalTcRate + totalSpotTce;
  const totalDailyOpex = totalTcOpex + totalSpotOpex;
  const blendedTce = totalVessels > 0 ? totalDailyGross / totalVessels : 0;

  return {
    blendedTce,
    dailyGrossRevenue: totalDailyGross,
    dailyOpex: totalDailyOpex,
    dailyNetTce: totalDailyGross - totalDailyOpex,
    quarterlyGross: totalDailyGross * QUARTER_DAYS,
    quarterlyOpex: totalDailyOpex * QUARTER_DAYS,
    quarterlyNet: (totalDailyGross - totalDailyOpex) * QUARTER_DAYS,
    tcVesselCount: tcVessels.length,
    spotVesselCount: spotVessels.length,
  };
}

/**
 * Map Baltic Exchange route codes to vessel types in our DB.
 */
export const ROUTE_TO_VESSEL_TYPE: Record<string, string> = {
  TD3C: "vlcc", TD20: "suezmax", TD17: "suezmax", TD6: "suezmax",
  TC1: "lr2_tanker", TC2: "mr_tanker",
  C5: "capesize", C3: "capesize", C14: "capesize",
  P3A_03: "panamax_bulk", P2A_03: "panamax_bulk",
  TC18: "vlgc", TC19: "vlgc",
};

/**
 * Map our vessel type names to the best available market TCE index.
 * This drives which Pareto/Baltic rate to use in earnings calculations.
 */
export const VESSEL_TYPE_TO_RATE_INDEX: Record<string, { primary: string; fallback?: string }> = {
  vlcc:             { primary: "VLCC_TD3C_TCE" },
  suezmax:          { primary: "SUEZMAX_TD20_TCE" },
  aframax_lr2:      { primary: "AFRAMAX_TCE", fallback: "LR2_TCE" },
  lr2_tanker:       { primary: "LR2_TCE", fallback: "AFRAMAX_TCE" },
  mr_tanker:        { primary: "MR_TC2_TCE" },
  handy_tanker:     { primary: "MR_TC2_TCE" },            // no separate Handy rate; proxy w/ MR discount
  lng_carrier:      { primary: "LNG_SPOT_TFDE" },
  vlgc:             { primary: "VLGC_ME_ASIA" },
  capesize:         { primary: "CAPESIZE_5TC", fallback: "BCI" },
  newcastlemax:     { primary: "CAPESIZE_5TC" },          // Newcastlemax tracks Capesize + small premium
  panamax_bulk:     { primary: "PANAMAX_TCE" },
  ultramax:         { primary: "ULTRAMAX_TCE" },
  pctc:             { primary: "PCTC_SPOT" },             // no Baltic index for PCTCs
  container_feeder: { primary: "SCFI", fallback: "CCFI" },
  chemical_tanker:  { primary: "AFRAMAX_TCE" },           // chemical tanker proxy
};

/**
 * Handy tanker TCE = MR rate × 0.78 (typical discount).
 * Newcastlemax TCE = Capesize rate × 1.05 (slight premium for larger parcel size).
 * PCTC and container_feeder have no reliable free market index — use historical averages.
 */
export const VESSEL_TYPE_RATE_ADJUSTMENT: Record<string, number> = {
  handy_tanker: 0.78,
  newcastlemax: 1.05,
  pctc: 0,           // no market index available — use contracted rates only
  container_feeder: 0,
  chemical_tanker: 0.80,
};
