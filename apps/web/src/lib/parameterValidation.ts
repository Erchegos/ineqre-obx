/**
 * Parameter Validation Framework
 *
 * Prevents look-ahead bias in quantitative analysis by:
 * - Timestamping all parameter estimates
 * - Validating that estimates don't use future data
 * - Tracking estimation windows and data availability
 *
 * Critical for backtesting credibility with Oslo Børs professionals.
 */

export interface ParameterEstimate<T = number> {
  value: T;
  estimatedAt: Date;
  estimationWindow: {
    startDate: Date;
    endDate: Date;
    observations: number;
  };
  metadata?: {
    method?: string;
    confidence?: number;
    standardError?: number;
  };
}

export interface ValidationResult {
  isValid: boolean;
  violations: string[];
  warnings: string[];
}

/**
 * Creates a timestamped parameter estimate
 */
export function createEstimate<T = number>(
  value: T,
  estimationWindow: {
    startDate: Date;
    endDate: Date;
    observations: number;
  },
  metadata?: {
    method?: string;
    confidence?: number;
    standardError?: number;
  }
): ParameterEstimate<T> {
  return {
    value,
    estimatedAt: new Date(),
    estimationWindow,
    metadata,
  };
}

/**
 * Validates that a parameter estimate doesn't use future data
 * relative to a specified point-in-time
 */
export function validateLookAhead(
  estimate: ParameterEstimate,
  asOfDate: Date
): ValidationResult {
  const violations: string[] = [];
  const warnings: string[] = [];

  // CRITICAL: Estimation window must end on or before the as-of date
  if (estimate.estimationWindow.endDate > asOfDate) {
    violations.push(
      `Look-ahead bias detected: Estimation window ends ${estimate.estimationWindow.endDate.toISOString().split('T')[0]} ` +
      `but as-of date is ${asOfDate.toISOString().split('T')[0]}`
    );
  }

  // WARNING: Using very recent data (less than 1 day lag)
  const lagDays = Math.floor(
    (asOfDate.getTime() - estimate.estimationWindow.endDate.getTime()) / (1000 * 60 * 60 * 24)
  );
  if (lagDays < 1 && lagDays >= 0) {
    warnings.push(
      `Estimation window ends on same day as as-of date. ` +
      `In production, data may not be available until T+1.`
    );
  }

  // WARNING: Estimate is stale (more than 90 days old)
  if (lagDays > 90) {
    warnings.push(
      `Estimation window ended ${lagDays} days before as-of date. ` +
      `Parameter may be stale.`
    );
  }

  // WARNING: Insufficient observations for reliable estimate
  if (estimate.estimationWindow.observations < 30) {
    warnings.push(
      `Only ${estimate.estimationWindow.observations} observations used. ` +
      `Recommend minimum 30 for statistical reliability.`
    );
  }

  return {
    isValid: violations.length === 0,
    violations,
    warnings,
  };
}

/**
 * Validates a batch of estimates for use in backtesting
 */
export function validateBacktest(
  estimates: Array<{ ticker: string; estimate: ParameterEstimate }>,
  backtestDate: Date
): {
  isValid: boolean;
  tickerViolations: Record<string, string[]>;
  summary: {
    total: number;
    valid: number;
    invalid: number;
    warnings: number;
  };
} {
  const tickerViolations: Record<string, string[]> = {};
  let validCount = 0;
  let warningCount = 0;

  for (const { ticker, estimate } of estimates) {
    const result = validateLookAhead(estimate, backtestDate);

    if (!result.isValid) {
      tickerViolations[ticker] = result.violations;
    } else {
      validCount++;
    }

    if (result.warnings.length > 0) {
      warningCount++;
      if (!tickerViolations[ticker]) {
        tickerViolations[ticker] = [];
      }
      tickerViolations[ticker].push(...result.warnings.map(w => `WARNING: ${w}`));
    }
  }

  return {
    isValid: Object.keys(tickerViolations).length === 0 || validCount === estimates.length,
    tickerViolations,
    summary: {
      total: estimates.length,
      valid: validCount,
      invalid: estimates.length - validCount,
      warnings: warningCount,
    },
  };
}

/**
 * Creates a beta estimate with proper timestamping
 */
export function createBetaEstimate(
  beta: number,
  startDate: Date,
  endDate: Date,
  observations: number,
  standardError?: number,
  pValue?: number
): ParameterEstimate<number> {
  return createEstimate(beta, { startDate, endDate, observations }, {
    method: 'Ordinary Least Squares',
    standardError,
    confidence: pValue !== undefined ? 1 - pValue : undefined,
  });
}

/**
 * Creates a correlation estimate with proper timestamping
 */
export function createCorrelationEstimate(
  correlation: number,
  startDate: Date,
  endDate: Date,
  observations: number,
  pValue?: number
): ParameterEstimate<number> {
  return createEstimate(correlation, { startDate, endDate, observations }, {
    method: 'Pearson Correlation',
    confidence: pValue !== undefined ? 1 - pValue : undefined,
  });
}

/**
 * Creates a volatility estimate with proper timestamping
 */
export function createVolatilityEstimate(
  volatility: number,
  startDate: Date,
  endDate: Date,
  observations: number,
  method: string = 'Yang-Zhang'
): ParameterEstimate<number> {
  return createEstimate(volatility, { startDate, endDate, observations }, {
    method,
  });
}

/**
 * Utility: Get tier classification based on data quality
 */
export function getTier(observations: number, lagDays: number): 'A' | 'B' | 'C' | 'F' {
  if (observations >= 252 && lagDays <= 5) return 'A'; // Backtesting ready
  if (observations >= 126 && lagDays <= 10) return 'B'; // Analysis ready
  if (observations >= 60 && lagDays <= 30) return 'C'; // Research only
  return 'F'; // Insufficient data
}

/**
 * Format estimate for display with temporal context
 */
export function formatEstimate(
  estimate: ParameterEstimate,
  decimalPlaces: number = 4
): {
  value: string;
  period: string;
  age: string;
  tier: 'A' | 'B' | 'C' | 'F';
} {
  const endDate = estimate.estimationWindow.endDate;
  const lagDays = Math.floor(
    (new Date().getTime() - endDate.getTime()) / (1000 * 60 * 60 * 24)
  );

  return {
    value: typeof estimate.value === 'number'
      ? estimate.value.toFixed(decimalPlaces)
      : String(estimate.value),
    period: `${estimate.estimationWindow.startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`,
    age: lagDays === 0 ? 'Today' : lagDays === 1 ? '1 day ago' : `${lagDays} days ago`,
    tier: getTier(estimate.estimationWindow.observations, lagDays),
  };
}
