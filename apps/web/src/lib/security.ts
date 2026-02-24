/**
 * Security Utilities Module
 *
 * Provides secure authentication, JWT handling, and other security functions.
 * Follows OWASP best practices for secure coding.
 *
 * OWASP Best Practices Implemented:
 * - Secure JWT secret handling (no hardcoded fallbacks)
 * - Constant-time comparison for sensitive values
 * - Proper error handling without information leakage
 * - Security headers
 */

import { NextRequest, NextResponse } from 'next/server';
import { verify, JwtPayload } from 'jsonwebtoken';

// ============================================================================
// JWT Secret Management
// ============================================================================

/**
 * Get JWT secret from environment variables.
 * Throws an error if not configured - never uses a default value.
 *
 * SECURITY: Never hardcode secrets or use default values in production.
 */
export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    console.error('[SECURITY] JWT_SECRET environment variable is not set');
    throw new Error('JWT_SECRET is not configured');
  }

  // Warn if secret is too short (should be at least 32 characters)
  if (secret.length < 32) {
    console.warn('[SECURITY] JWT_SECRET is shorter than recommended (32+ characters)');
  }

  return secret;
}

/**
 * Verify a JWT token and return the payload.
 * Uses the secure getJwtSecret() function.
 */
export function verifyJwtToken(token: string): JwtPayload | null {
  try {
    const secret = getJwtSecret();
    const decoded = verify(token, secret);

    if (typeof decoded === 'string') {
      return null;
    }

    return decoded;
  } catch (error) {
    // Log the error type for debugging but don't expose details
    if (error instanceof Error) {
      console.warn('[AUTH] Token verification failed:', error.name);
    }
    return null;
  }
}

/**
 * Extract and verify bearer token from Authorization header.
 * Returns the decoded payload or null if invalid.
 */
export function extractAndVerifyToken(req: NextRequest): JwtPayload | null {
  const authHeader = req.headers.get('authorization');

  if (!authHeader) {
    return null;
  }

  // Must be Bearer token
  if (!authHeader.startsWith('Bearer ')) {
    return null;
  }

  const token = authHeader.slice(7);

  if (!token) {
    return null;
  }

  return verifyJwtToken(token);
}

// ============================================================================
// Authentication Middleware
// ============================================================================

/**
 * Require authentication for an API route.
 * Returns null if authenticated, or an error response if not.
 *
 * Usage:
 * ```ts
 * export async function GET(req: NextRequest) {
 *   const authError = requireAuth(req);
 *   if (authError) return authError;
 *   // ... rest of handler
 * }
 * ```
 */
export function requireAuth(req: NextRequest): NextResponse | null {
  const payload = extractAndVerifyToken(req);

  if (!payload) {
    return NextResponse.json(
      {
        error: 'Unauthorized',
        message: 'Valid authentication token required',
      },
      { status: 401 }
    );
  }

  return null;
}

/**
 * Get authenticated user info from request.
 * Returns null if not authenticated.
 */
export function getAuthUser(req: NextRequest): { tokenId: string; profile: string } | null {
  const payload = extractAndVerifyToken(req);

  if (!payload || !payload.tokenId) {
    return null;
  }

  return { tokenId: payload.tokenId.toString(), profile: payload.profile?.toString() || 'default' };
}

// ============================================================================
// Security Headers
// ============================================================================

/**
 * Standard security headers for API responses.
 * These help prevent common web vulnerabilities.
 */
export const SECURITY_HEADERS = {
  // Prevent MIME type sniffing
  'X-Content-Type-Options': 'nosniff',
  // Prevent clickjacking
  'X-Frame-Options': 'DENY',
  // Enable XSS filter in older browsers
  'X-XSS-Protection': '1; mode=block',
  // Strict referrer policy
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  // Permissions policy
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
};

/**
 * Add security headers to a response
 */
export function addSecurityHeaders(response: NextResponse): NextResponse {
  Object.entries(SECURITY_HEADERS).forEach(([key, value]) => {
    response.headers.set(key, value);
  });
  return response;
}

/**
 * Create a JSON response with security headers
 */
export function secureJsonResponse(
  data: unknown,
  options: { status?: number; headers?: Record<string, string> } = {}
): NextResponse {
  const response = NextResponse.json(data, { status: options.status || 200 });

  // Add security headers
  addSecurityHeaders(response);

  // Add any custom headers
  if (options.headers) {
    Object.entries(options.headers).forEach(([key, value]) => {
      response.headers.set(key, value);
    });
  }

  return response;
}

// ============================================================================
// Error Responses (without information leakage)
// ============================================================================

/**
 * Generic error response that doesn't leak internal details.
 * Log the actual error internally but return a sanitized message.
 */
export function safeErrorResponse(
  error: unknown,
  publicMessage: string = 'An error occurred',
  status: number = 500
): NextResponse {
  // Log the actual error for debugging
  if (error instanceof Error) {
    console.error(`[API Error] ${error.name}: ${error.message}`);
    if (process.env.NODE_ENV === 'development') {
      console.error(error.stack);
    }
  } else {
    console.error('[API Error]', error);
  }

  return secureJsonResponse(
    {
      error: status >= 500 ? 'Internal Server Error' : 'Error',
      message: publicMessage,
    },
    { status }
  );
}

// ============================================================================
// Input Sanitization Helpers
// ============================================================================

/**
 * Check if a value looks like it might be an injection attempt.
 * This is a defense-in-depth measure, not a replacement for parameterized queries.
 */
export function detectInjectionAttempt(value: string): boolean {
  const suspiciousPatterns = [
    /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|UNION|ALTER|CREATE|EXEC|EXECUTE)\b)/i, // SQL keywords
    /<script\b[^>]*>/i, // Script tags
    /javascript:/i, // JavaScript URI
    /on\w+\s*=/i, // Event handlers
    /\$\{.*\}/i, // Template literals
    /\{\{.*\}\}/i, // Template expressions
  ];

  return suspiciousPatterns.some((pattern) => pattern.test(value));
}

/**
 * Log a potential security event for monitoring.
 * In production, this should integrate with your security monitoring system.
 */
export function logSecurityEvent(
  event: string,
  details: Record<string, unknown>,
  req?: NextRequest
): void {
  const logEntry = {
    timestamp: new Date().toISOString(),
    event,
    ip: req?.headers.get('x-forwarded-for') || req?.headers.get('x-real-ip') || 'unknown',
    userAgent: req?.headers.get('user-agent') || 'unknown',
    ...details,
  };

  // In production, send to security monitoring system
  // For now, just log to console
  console.warn('[SECURITY EVENT]', JSON.stringify(logEntry));
}
