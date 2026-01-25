/**
 * Input Validation Module
 *
 * Provides schema-based validation for all API inputs using Zod.
 * Includes sanitization, type checking, and length limits.
 *
 * OWASP Best Practice: Validate all user inputs on the server side.
 * Never trust client-side validation alone.
 */

import { z } from 'zod';
import { NextResponse } from 'next/server';

// ============================================================================
// Common Validation Schemas
// ============================================================================

/**
 * Ticker symbol validation
 * - 1-10 uppercase alphanumeric characters
 * - No special characters except allowed ones
 */
export const tickerSchema = z
  .string()
  .min(1, 'Ticker is required')
  .max(10, 'Ticker must be at most 10 characters')
  .regex(/^[A-Z0-9]+$/, 'Ticker must contain only uppercase letters and numbers')
  .transform((val) => val.toUpperCase());

/**
 * Date validation (YYYY-MM-DD format)
 */
export const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format')
  .refine((date) => {
    const parsed = new Date(date);
    return !isNaN(parsed.getTime());
  }, 'Invalid date');

/**
 * Pagination parameters
 */
export const paginationSchema = z.object({
  limit: z
    .string()
    .optional()
    .transform((val) => {
      const num = parseInt(val || '100', 10);
      return Math.min(Math.max(1, num), 1000); // Clamp between 1 and 1000
    }),
  offset: z
    .string()
    .optional()
    .transform((val) => {
      const num = parseInt(val || '0', 10);
      return Math.max(0, num); // Minimum 0
    }),
});

/**
 * Date range parameters
 */
export const dateRangeSchema = z.object({
  startDate: dateSchema.optional(),
  endDate: dateSchema.optional(),
}).refine(
  (data) => {
    if (data.startDate && data.endDate) {
      return new Date(data.startDate) <= new Date(data.endDate);
    }
    return true;
  },
  { message: 'Start date must be before or equal to end date' }
);

/**
 * Period parameter (for analytics)
 */
export const periodSchema = z
  .string()
  .optional()
  .transform((val) => {
    const period = val?.toLowerCase() || '1y';
    const validPeriods = ['1m', '3m', '6m', '1y', '2y', '3y', '5y', '10y', 'ytd', 'max'];
    return validPeriods.includes(period) ? period : '1y';
  });

// ============================================================================
// API-Specific Schemas
// ============================================================================

/**
 * Authentication request body
 */
export const authRequestSchema = z.object({
  password: z
    .string()
    .min(1, 'Password is required')
    .max(128, 'Password must be at most 128 characters'),
});

/**
 * Asset type validation
 * Valid types: equity, index, commodity_etf, index_etf
 */
export const assetTypeSchema = z
  .enum(['equity', 'index', 'commodity_etf', 'index_etf'])
  .optional();

/**
 * Stocks list query parameters
 */
export const stocksQuerySchema = z.object({
  search: z
    .string()
    .max(100, 'Search query too long')
    .optional()
    .transform((val) => val?.trim()),
  limit: paginationSchema.shape.limit,
  offset: paginationSchema.shape.offset,
  active: z
    .string()
    .optional()
    .transform((val) => val === 'true'),
  assetTypes: z
    .string()
    .optional()
    .transform((val) => {
      if (!val) return ['equity']; // Default to equities only
      const types = val.split(',').map((t) => t.trim().toLowerCase());
      const validTypes = ['equity', 'index', 'commodity_etf', 'index_etf'];
      return types.filter((t) => validTypes.includes(t));
    }),
});

/**
 * Prices query parameters
 */
export const pricesQuerySchema = z.object({
  startDate: dateSchema.optional(),
  endDate: dateSchema.optional(),
  limit: z
    .string()
    .optional()
    .transform((val) => {
      const num = parseInt(val || '1000', 10);
      return Math.min(Math.max(1, num), 10000); // Allow up to 10k for price data
    }),
});

/**
 * Correlation request parameters
 */
export const correlationQuerySchema = z.object({
  tickers: z
    .string()
    .min(1, 'Tickers are required')
    .transform((val) => {
      const tickers = val.split(',').map((t) => t.trim().toUpperCase());
      if (tickers.length > 50) {
        throw new Error('Maximum 50 tickers allowed');
      }
      return tickers;
    }),
  period: periodSchema,
});

/**
 * Analytics request parameters
 */
export const analyticsQuerySchema = z.object({
  period: periodSchema,
  benchmark: z
    .string()
    .optional()
    .transform((val) => val?.toUpperCase() || 'OBX'),
});

/**
 * Document ID validation (UUID)
 */
export const documentIdSchema = z
  .string()
  .uuid('Invalid document ID format');

/**
 * Research documents query parameters
 */
export const documentsQuerySchema = z.object({
  limit: z
    .string()
    .optional()
    .transform((val) => {
      const num = parseInt(val || '100', 10);
      return Math.min(Math.max(1, num), 500);
    }),
  offset: paginationSchema.shape.offset,
  source: z
    .string()
    .max(50)
    .optional()
    .transform((val) => val?.trim()),
  ticker: z
    .string()
    .max(10)
    .optional()
    .transform((val) => val?.trim().toUpperCase()),
});

/**
 * IBKR import request body
 */
export const ibkrImportSchema = z.object({
  ticker: tickerSchema,
  exchange: z
    .string()
    .max(10)
    .default('OSE')
    .transform((val) => val.toUpperCase()),
  duration: z
    .string()
    .regex(/^\d+\s+(Y|M|D|W)$/i, 'Duration must be like "1 Y", "6 M", "30 D"')
    .default('10 Y'),
});

// ============================================================================
// Validation Utilities
// ============================================================================

/**
 * Validate request body and return parsed data or error response
 */
export async function validateBody<T extends z.ZodSchema>(
  request: Request,
  schema: T
): Promise<{ success: true; data: z.infer<T> } | { success: false; response: NextResponse }> {
  try {
    const body = await request.json();
    const result = schema.safeParse(body);

    if (!result.success) {
      return {
        success: false,
        response: NextResponse.json(
          {
            error: 'Validation Error',
            message: 'Invalid request body',
            details: result.error.errors.map((e) => ({
              field: e.path.join('.'),
              message: e.message,
            })),
          },
          { status: 400 }
        ),
      };
    }

    return { success: true, data: result.data };
  } catch (error) {
    return {
      success: false,
      response: NextResponse.json(
        {
          error: 'Validation Error',
          message: 'Invalid JSON body',
        },
        { status: 400 }
      ),
    };
  }
}

/**
 * Validate URL search params and return parsed data or error response
 */
export function validateQuery<T extends z.ZodSchema>(
  searchParams: URLSearchParams,
  schema: T
): { success: true; data: z.infer<T> } | { success: false; response: NextResponse } {
  // Convert URLSearchParams to object
  const params: Record<string, string> = {};
  searchParams.forEach((value, key) => {
    params[key] = value;
  });

  const result = schema.safeParse(params);

  if (!result.success) {
    return {
      success: false,
      response: NextResponse.json(
        {
          error: 'Validation Error',
          message: 'Invalid query parameters',
          details: result.error.errors.map((e) => ({
            field: e.path.join('.'),
            message: e.message,
          })),
        },
        { status: 400 }
      ),
    };
  }

  return { success: true, data: result.data };
}

/**
 * Validate URL path parameters
 */
export function validateParams<T extends z.ZodSchema>(
  params: Record<string, string>,
  schema: T
): { success: true; data: z.infer<T> } | { success: false; response: NextResponse } {
  const result = schema.safeParse(params);

  if (!result.success) {
    return {
      success: false,
      response: NextResponse.json(
        {
          error: 'Validation Error',
          message: 'Invalid path parameters',
          details: result.error.errors.map((e) => ({
            field: e.path.join('.'),
            message: e.message,
          })),
        },
        { status: 400 }
      ),
    };
  }

  return { success: true, data: result.data };
}

/**
 * Sanitize a string to prevent XSS and injection attacks
 * Removes HTML tags and dangerous characters
 */
export function sanitizeString(input: string): string {
  return input
    .replace(/<[^>]*>/g, '') // Remove HTML tags
    .replace(/[<>"'&]/g, '') // Remove special characters
    .trim();
}

/**
 * Sanitize numeric input - ensure it's a valid number
 */
export function sanitizeNumber(input: unknown, defaultValue: number = 0): number {
  if (typeof input === 'number' && !isNaN(input) && isFinite(input)) {
    return input;
  }
  if (typeof input === 'string') {
    const parsed = parseFloat(input);
    if (!isNaN(parsed) && isFinite(parsed)) {
      return parsed;
    }
  }
  return defaultValue;
}

/**
 * Clamp an integer between min and max values
 */
export function clampInt(value: number, min: number, max: number): number {
  return Math.min(Math.max(Math.floor(value), min), max);
}
