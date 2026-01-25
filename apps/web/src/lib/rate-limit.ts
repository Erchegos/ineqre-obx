/**
 * Rate Limiting Module
 *
 * Provides IP-based and user-based rate limiting for API endpoints.
 * Uses in-memory storage with automatic cleanup.
 *
 * OWASP Best Practice: Implement rate limiting to prevent brute force attacks,
 * denial of service, and API abuse.
 */

import { NextRequest, NextResponse } from 'next/server';

// Rate limit configuration per endpoint type
export interface RateLimitConfig {
  // Maximum requests allowed in the time window
  maxRequests: number;
  // Time window in milliseconds
  windowMs: number;
  // Optional: different limits for authenticated users
  authenticatedMaxRequests?: number;
  // Message to return when rate limited
  message?: string;
}

// Default configurations for different endpoint types
export const RATE_LIMIT_CONFIGS = {
  // Strict limit for auth endpoints (prevent brute force)
  auth: {
    maxRequests: 5,
    windowMs: 15 * 60 * 1000, // 15 minutes
    message: 'Too many authentication attempts. Please try again later.',
  },
  // Standard limit for public data endpoints
  public: {
    maxRequests: 100,
    windowMs: 60 * 1000, // 1 minute
    authenticatedMaxRequests: 200,
    message: 'Rate limit exceeded. Please slow down your requests.',
  },
  // Higher limit for read-heavy endpoints
  read: {
    maxRequests: 200,
    windowMs: 60 * 1000, // 1 minute
    authenticatedMaxRequests: 500,
    message: 'Rate limit exceeded. Please slow down your requests.',
  },
  // Strict limit for expensive operations (AI, heavy DB queries)
  expensive: {
    maxRequests: 10,
    windowMs: 60 * 1000, // 1 minute
    authenticatedMaxRequests: 30,
    message: 'Rate limit exceeded for this resource-intensive operation.',
  },
  // Very strict limit for write operations
  write: {
    maxRequests: 20,
    windowMs: 60 * 1000, // 1 minute
    authenticatedMaxRequests: 50,
    message: 'Rate limit exceeded for write operations.',
  },
} as const;

// In-memory store for rate limiting
// Key: IP or user ID, Value: { count, resetTime }
interface RateLimitEntry {
  count: number;
  resetTime: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();

// Cleanup old entries every 5 minutes to prevent memory leaks
const CLEANUP_INTERVAL = 5 * 60 * 1000;
let lastCleanup = Date.now();

function cleanupExpiredEntries(): void {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL) return;

  lastCleanup = now;
  for (const [key, entry] of rateLimitStore.entries()) {
    if (entry.resetTime < now) {
      rateLimitStore.delete(key);
    }
  }
}

/**
 * Extract client IP from request headers
 * Handles various proxy configurations (Vercel, Cloudflare, nginx)
 */
export function getClientIp(req: NextRequest): string {
  // Check various headers in order of preference
  const forwardedFor = req.headers.get('x-forwarded-for');
  if (forwardedFor) {
    // Take the first IP (client IP) from the chain
    return forwardedFor.split(',')[0].trim();
  }

  const realIp = req.headers.get('x-real-ip');
  if (realIp) {
    return realIp.trim();
  }

  const cfConnectingIp = req.headers.get('cf-connecting-ip');
  if (cfConnectingIp) {
    return cfConnectingIp.trim();
  }

  // Fallback for local development
  return '127.0.0.1';
}

/**
 * Extract user ID from JWT token if present
 */
export function getUserIdFromRequest(req: NextRequest): string | null {
  const authHeader = req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return null;
  }

  try {
    // Extract token and decode payload (without verification - just for identification)
    const token = authHeader.slice(7);
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
    return payload.tokenId?.toString() || null;
  } catch {
    return null;
  }
}

/**
 * Check rate limit for a given identifier
 * Returns { allowed: boolean, remaining: number, resetIn: number }
 */
export function checkRateLimit(
  identifier: string,
  config: RateLimitConfig,
  isAuthenticated: boolean = false
): { allowed: boolean; remaining: number; resetIn: number } {
  cleanupExpiredEntries();

  const now = Date.now();
  const maxRequests = isAuthenticated && config.authenticatedMaxRequests
    ? config.authenticatedMaxRequests
    : config.maxRequests;

  const entry = rateLimitStore.get(identifier);

  if (!entry || entry.resetTime < now) {
    // Create new entry
    rateLimitStore.set(identifier, {
      count: 1,
      resetTime: now + config.windowMs,
    });
    return {
      allowed: true,
      remaining: maxRequests - 1,
      resetIn: config.windowMs,
    };
  }

  if (entry.count >= maxRequests) {
    return {
      allowed: false,
      remaining: 0,
      resetIn: entry.resetTime - now,
    };
  }

  // Increment count
  entry.count++;
  return {
    allowed: true,
    remaining: maxRequests - entry.count,
    resetIn: entry.resetTime - now,
  };
}

/**
 * Rate limit middleware for API routes
 *
 * Usage:
 * ```ts
 * export async function GET(req: NextRequest) {
 *   const rateLimitResult = rateLimit(req, 'public');
 *   if (rateLimitResult) return rateLimitResult;
 *   // ... rest of handler
 * }
 * ```
 */
export function rateLimit(
  req: NextRequest,
  configType: keyof typeof RATE_LIMIT_CONFIGS = 'public'
): NextResponse | null {
  const config = RATE_LIMIT_CONFIGS[configType];
  const ip = getClientIp(req);
  const userId = getUserIdFromRequest(req);

  // Use user ID if authenticated, otherwise use IP
  const identifier = userId ? `user:${userId}` : `ip:${ip}`;
  const isAuthenticated = !!userId;

  // Also check IP separately for authenticated users (defense in depth)
  if (isAuthenticated) {
    const ipResult = checkRateLimit(`ip:${ip}`, config, false);
    if (!ipResult.allowed) {
      return createRateLimitResponse(config, ipResult);
    }
  }

  const result = checkRateLimit(identifier, config, isAuthenticated);

  if (!result.allowed) {
    return createRateLimitResponse(config, result);
  }

  return null; // Request allowed
}

/**
 * Create a 429 Too Many Requests response with proper headers
 */
function createRateLimitResponse(
  config: RateLimitConfig,
  result: { remaining: number; resetIn: number }
): NextResponse {
  const response = NextResponse.json(
    {
      error: 'Too Many Requests',
      message: config.message || 'Rate limit exceeded. Please try again later.',
      retryAfter: Math.ceil(result.resetIn / 1000),
    },
    { status: 429 }
  );

  // Add standard rate limit headers
  response.headers.set('Retry-After', Math.ceil(result.resetIn / 1000).toString());
  response.headers.set('X-RateLimit-Remaining', result.remaining.toString());
  response.headers.set('X-RateLimit-Reset', Math.ceil(result.resetIn / 1000).toString());

  return response;
}

/**
 * Add rate limit headers to a successful response
 */
export function addRateLimitHeaders(
  response: NextResponse,
  identifier: string,
  config: RateLimitConfig,
  isAuthenticated: boolean = false
): NextResponse {
  const result = checkRateLimit(identifier, config, isAuthenticated);
  response.headers.set('X-RateLimit-Remaining', result.remaining.toString());
  response.headers.set('X-RateLimit-Reset', Math.ceil(result.resetIn / 1000).toString());
  return response;
}
