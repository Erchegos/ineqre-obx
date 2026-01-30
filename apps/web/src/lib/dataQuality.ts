/**
 * Data Quality Metrics for Stock Universe
 *
 * Calculates data completeness and quality tiers for backtesting readiness.
 */

export type DataTier = 'A' | 'B' | 'C' | 'F';

export interface DataQualityMetrics {
  expectedDays: number;
  actualDays: number;
  completenessPct: number;
  dataTier: DataTier;
  dualPair?: string;
}

/**
 * Dual-listed stock pairs (Oslo Børs ↔ NYSE)
 * Key: ticker → Value: dual-listed pair ticker
 */
export const DUAL_PAIRS: Record<string, string> = {
  'EQNR': 'EQNR.US',
  'EQNR.US': 'EQNR',
  'FRO': 'FRO.US',
  'FRO.US': 'FRO',
  'BWLPG': 'BWLP.US',
  'BWLP.US': 'BWLPG',
  'HAFNI': 'HAFN.US',
  'HAFN.US': 'HAFNI',
  'CADLR': 'CDLR',
  'CDLR': 'CADLR',
};

/**
 * Calculate expected trading days between two dates (business days only)
 * Formula: Total calendar days - estimated weekends
 *
 * Note: Does not account for holidays. Actual trading days may vary by ~3-5%.
 * This is acceptable for Phase 1 data quality assessment.
 *
 * @param startDate ISO date string (YYYY-MM-DD)
 * @param endDate ISO date string (YYYY-MM-DD), defaults to today
 * @returns Estimated number of trading days
 */
export function calculateExpectedDays(
  startDate: string,
  endDate: string = new Date().toISOString().slice(0, 10)
): number {
  const start = new Date(startDate);
  const end = new Date(endDate);

  // Invalid dates
  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return 0;
  }

  // Calculate total calendar days
  const msPerDay = 1000 * 60 * 60 * 24;
  const totalDays = Math.floor((end.getTime() - start.getTime()) / msPerDay);

  if (totalDays < 0) return 0;

  // Estimate business days (weekdays only)
  // Approximate: 5/7 of total days, accounting for weekends
  // More accurate method: iterate through each day
  const fullWeeks = Math.floor(totalDays / 7);
  const remainingDays = totalDays % 7;

  // Full weeks contribute 5 business days each
  let businessDays = fullWeeks * 5;

  // Add remaining days, checking if they fall on weekdays
  const startDay = start.getDay(); // 0 = Sunday, 6 = Saturday
  for (let i = 0; i < remainingDays; i++) {
    const dayOfWeek = (startDay + i) % 7;
    if (dayOfWeek !== 0 && dayOfWeek !== 6) { // Not Sunday or Saturday
      businessDays++;
    }
  }

  return businessDays;
}

/**
 * Calculate data completeness percentage
 *
 * @param actualRows Number of actual price rows in database
 * @param expectedDays Expected trading days based on listing date
 * @returns Completeness percentage (0-100), capped at 100%
 */
export function calculateCompleteness(actualRows: number, expectedDays: number): number {
  if (expectedDays === 0) return 0;

  const completeness = (actualRows / expectedDays) * 100;

  // Cap at 100% (can happen if expectedDays underestimates due to no holiday adjustment)
  return Math.min(completeness, 100);
}

/**
 * Assign data quality tier for backtesting readiness
 *
 * Tier A: 95%+ complete AND 3+ years (756+ days) → Gold standard
 * Tier B: 85%+ complete AND 2+ years (504+ days) → Acceptable
 * Tier C: 75%+ complete OR 1+ year (252+ days) → Limited use
 * Tier F: Everything else → Unsuitable for backtesting
 *
 * @param rows Actual number of price rows
 * @param completenessPct Data completeness percentage
 * @returns Data tier classification
 */
export function calculateDataTier(rows: number, completenessPct: number): DataTier {
  // Tier A: 95%+ complete AND 3+ years (756 trading days)
  if (completenessPct >= 95 && rows >= 756) {
    return 'A';
  }

  // Tier B: 85%+ complete AND 2+ years (504 trading days)
  if (completenessPct >= 85 && rows >= 504) {
    return 'B';
  }

  // Tier C: 75%+ complete OR 1+ year (252 trading days)
  // Allows either good completeness OR sufficient history
  if (completenessPct >= 75 || rows >= 252) {
    return 'C';
  }

  // Tier F: Everything else (insufficient data for backtesting)
  return 'F';
}

/**
 * Calculate all data quality metrics for a stock
 *
 * @param startDate Stock's listing/start date (ISO format)
 * @param endDate Stock's last price date (ISO format)
 * @param actualRows Number of actual price rows in database
 * @param ticker Stock ticker (to identify dual-listed pairs)
 * @returns Complete data quality metrics
 */
export function calculateDataQualityMetrics(
  startDate: string,
  endDate: string,
  actualRows: number,
  ticker: string
): DataQualityMetrics {
  const expectedDays = calculateExpectedDays(startDate, endDate);
  const completenessPct = calculateCompleteness(actualRows, expectedDays);
  const dataTier = calculateDataTier(actualRows, completenessPct);
  const dualPair = DUAL_PAIRS[ticker];

  return {
    expectedDays,
    actualDays: actualRows,
    completenessPct: Math.round(completenessPct * 10) / 10, // Round to 1 decimal
    dataTier,
    dualPair,
  };
}
