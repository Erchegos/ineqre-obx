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
 * Authenticate with username + password to receive a JWT token.
 * Username maps to `description` field in research_access_tokens.
 * Only active, non-expired tokens are checked.
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

    const { username, password } = validation.data;

    // If username provided, only check that specific account
    // Otherwise fall back to checking all active tokens (legacy behavior)
    const query = username
      ? `SELECT id, token_hash, description
         FROM research_access_tokens
         WHERE is_active = true
           AND description = $1
           AND (expires_at IS NULL OR expires_at > NOW())`
      : `SELECT id, token_hash, description
         FROM research_access_tokens
         WHERE is_active = true
           AND (expires_at IS NULL OR expires_at > NOW())`;

    const params = username ? [username] : [];
    const result = await pool.query(query, params);

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
          { expiresIn: '8h' }
        );

        return secureJsonResponse({ token, profile });
      }
    }

    logSecurityEvent('auth_failed', { reason: 'invalid_credentials', endpoint: 'portfolio', username: username || 'none' }, req);
    return secureJsonResponse({ error: 'Invalid username or password' }, { status: 401 });
  } catch (error) {
    return safeErrorResponse(error, 'Authentication failed');
  }
}
