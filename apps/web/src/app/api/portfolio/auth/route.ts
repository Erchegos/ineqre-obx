import { NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';
import { sign } from 'jsonwebtoken';
import { pool } from '@/lib/db';
import { rateLimit } from '@/lib/rate-limit';
import { validateBody, authRequestSchema } from '@/lib/validation';
import { getJwtSecret, safeErrorResponse, secureJsonResponse, logSecurityEvent } from '@/lib/security';

/**
 * POST /api/portfolio/auth
 *
 * Authenticate with password to receive a JWT token.
 * Reuses the same research_access_tokens table (same password).
 */
export async function POST(req: NextRequest) {
  const rateLimitResult = rateLimit(req, 'auth');
  if (rateLimitResult) {
    logSecurityEvent('rate_limit_exceeded', { endpoint: '/api/portfolio/auth' }, req);
    return rateLimitResult;
  }

  try {
    const validation = await validateBody(req, authRequestSchema);
    if (!validation.success) {
      return validation.response;
    }

    const { password } = validation.data;

    const result = await pool.query(
      `SELECT id, token_hash, description
       FROM research_access_tokens
       WHERE is_active = true
       AND (expires_at IS NULL OR expires_at > NOW())`
    );

    for (const row of result.rows) {
      const isValid = await bcrypt.compare(password, row.token_hash);
      if (isValid) {
        await pool.query(
          'UPDATE research_access_tokens SET last_used_at = NOW() WHERE id = $1',
          [row.id]
        );

        const profile = row.description || 'default';
        const token = sign(
          { tokenId: row.id, scope: 'portfolio', profile },
          getJwtSecret(),
          { expiresIn: '4h' }
        );

        return secureJsonResponse({ token, profile });
      }
    }

    logSecurityEvent('auth_failed', { reason: 'invalid_password', endpoint: 'portfolio' }, req);
    return secureJsonResponse({ error: 'Authentication failed' }, { status: 401 });
  } catch (error) {
    return safeErrorResponse(error, 'Authentication failed');
  }
}
