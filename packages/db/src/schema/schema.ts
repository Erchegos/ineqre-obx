// packages/db/src/schema/schema.ts
export { pricesDaily } from "./pricesDaily";

// Predictive factors module exports
export {
  factorTechnical,
  type FactorTechnical,
  type NewFactorTechnical,
} from "./factorTechnical";

export {
  factorFundamentals,
  type FactorFundamentals,
  type NewFactorFundamentals,
} from "./factorFundamentals";

export {
  mlPredictions,
  mlModelMetadata,
  type MlPrediction,
  type NewMlPrediction,
  type MlModelMetadata,
  type NewMlModelMetadata,
} from "./mlPredictions";

// News event system
export {
  newsEvents,
  newsTickerMap,
  newsSectorMap,
  type NewsEvent,
  type NewNewsEvent,
  type NewsTickerMap,
  type NewNewsTickerMap,
  type NewsSectorMap,
  type NewNewsSectorMap,
} from "./news";

// Short positions (Finanstilsynet SSR)
export {
  shortPositions,
  shortPositionHolders,
  type ShortPosition,
  type NewShortPosition,
  type ShortPositionHolder,
  type NewShortPositionHolder,
} from "./shortPositions";

// Commodity prices & stock sensitivity
export {
  commodityPrices,
  commodityStockSensitivity,
  type CommodityPrice,
  type NewCommodityPrice,
  type CommodityStockSensitivity,
  type NewCommodityStockSensitivity,
} from "./commodityPrices";

// NewsWeb filings & insider transactions
export {
  newswebFilings,
  insiderTransactions,
  type NewswebFiling,
  type NewNewswebFiling,
  type InsiderTransaction,
  type NewInsiderTransaction,
} from "./filings";

// Shipping intelligence
export {
  shippingCompanies,
  shippingVessels,
  shippingPositions,
  shippingVesselContracts,
  shippingCompanyRates,
  shippingMarketRates,
  shippingPorts,
  type ShippingCompany,
  type NewShippingCompany,
  type ShippingVessel,
  type NewShippingVessel,
  type ShippingPosition,
  type NewShippingPosition,
  type ShippingVesselContract,
  type NewShippingVesselContract,
  type ShippingCompanyRate,
  type NewShippingCompanyRate,
  type ShippingMarketRate,
  type NewShippingMarketRate,
  type ShippingPort,
  type NewShippingPort,
} from "./shipping";

// Harvest tracker (wellboat trip tracking)
export {
  harvestVessels,
  harvestSlaughterhouses,
  harvestTrips,
  harvestQuarterlyEstimates,
  type HarvestVessel,
  type NewHarvestVessel,
  type HarvestSlaughterhouse,
  type NewHarvestSlaughterhouse,
  type HarvestTrip,
  type NewHarvestTrip,
  type HarvestQuarterlyEstimate,
  type NewHarvestQuarterlyEstimate,
} from "./harvestTracker";
