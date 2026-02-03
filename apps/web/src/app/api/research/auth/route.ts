import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { sign } from 'jsonwebtoken';
import { pool } from '@/lib/db';
import { rateLimit, getClientIp } from '@/lib/rate-limit';
import { validateBody, authRequestSchema } from '@/lib/validation';
import { getJwtSecret, safeErrorResponse, secureJsonResponse, logSecurityEvent } from '@/lib/security';

/**
 * POST /api/research/auth
 *
 * Authenticate with password to receive a JWT token.
 *
 * Security measures:
 * - Rate limiting (5 attempts per 15 minutes per IP)
 * - Input validation (password required, max 128 chars)
 * - Secure JWT secret from environment (no fallback)
 * - Generic error messages (no information leakage)
 * - Security event logging for failed attempts
 */
export async function POST(req: NextRequest) {
  // Rate limiting - strict for auth endpoints (prevent brute force)
  const rateLimitResult = rateLimit(req, 'auth');
  if (rateLimitResult) {
    logSecurityEvent('rate_limit_exceeded', { endpoint: '/api/research/auth' }, req);
    return rateLimitResult;
  }

  try {
    // Validate request body
    const validation = await validateBody(req, authRequestSchema);
    if (!validation.success) {
      return validation.response;
    }

    const { password } = validation.data;

    // Get active tokens from database
    const result = await pool.query(
      `SELECT id, token_hash
       FROM research_access_tokens
       WHERE is_active = true
       AND (expires_at IS NULL OR expires_at > NOW())`
    );

    // Check password against all active tokens
    for (const row of result.rows) {
      const isValid = await bcrypt.compare(password, row.token_hash);
      if (isValid) {
        // Update last_used_at
        await pool.query(
          'UPDATE research_access_tokens SET last_used_at = NOW() WHERE id = $1',
          [row.id]
        );

        // Generate JWT token for session using secure secret
        const token = sign(
          { tokenId: row.id },
          getJwtSecret(),
          { expiresIn: '24h' }
        );

        return secureJsonResponse({ token });
      }
    }

    // Log failed authentication attempt
    logSecurityEvent('auth_failed', { reason: 'invalid_password' }, req);

    // No matching token found - use generic message to prevent enumeration
    return secureJsonResponse(
      { error: 'Authentication failed' },
      { status: 401 }
    );
  } catch (error) {
    // Log error but don't expose internal details
    return safeErrorResponse(error, 'Authentication failed');
  }
}
