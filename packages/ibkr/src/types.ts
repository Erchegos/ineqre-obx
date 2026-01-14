// packages/ibkr/src/types.ts
import { z } from "zod";

/**
 * IBKR Client Portal Gateway configuration
 */
export interface IBKRConfig {
  baseUrl: string;
  timeout?: number;
}

/**
 * Contract search result
 */
export const ContractSchema = z.object({
  conid: z.number(),
  symbol: z.string(),
  description: z.string().optional(),
  exchange: z.string().optional(),
  currency: z.string().optional(),
  secType: z.string().optional(),
});

export type Contract = z.infer<typeof ContractSchema>;

/**
 * Historical bar data
 */
export const HistoricalBarSchema = z.object({
  t: z.number(), // Unix timestamp (ms)
  o: z.number(), // Open
  h: z.number(), // High
  l: z.number(), // Low
  c: z.number(), // Close
  v: z.number(), // Volume
});

export type HistoricalBar = z.infer<typeof HistoricalBarSchema>;

/**
 * Historical data response
 */
export const HistoricalDataResponseSchema = z.object({
  symbol: z.string().optional(),
  text: z.string().optional(),
  data: z.array(HistoricalBarSchema).optional(),
});

export type HistoricalDataResponse = z.infer<typeof HistoricalDataResponseSchema>;

/**
 * Price data for ingestion
 */
export interface PriceData {
  ticker: string;
  date: string; // YYYY-MM-DD
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/**
 * Ingestion result
 */
export interface IngestionResult {
  ticker: string;
  success: boolean;
  barsIngested: number;
  error?: string;
}
