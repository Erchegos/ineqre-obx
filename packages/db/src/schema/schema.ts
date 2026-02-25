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
