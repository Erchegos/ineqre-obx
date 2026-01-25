import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { rateLimit } from '@/lib/rate-limit';
import { validateQuery, documentsQuerySchema } from '@/lib/validation';
import { getAuthUser, secureJsonResponse, safeErrorResponse } from '@/lib/security';

/**
 * GET /api/research/documents
 *
 * List research documents. Requires authentication.
 *
 * Security measures:
 * - JWT authentication required
 * - Rate limiting (200 req/min)
 * - Input validation for query params
 * - Parameterized queries (SQL injection prevention)
 */
export async function GET(req: NextRequest) {
  // Rate limiting
  const rateLimitResult = rateLimit(req, 'read');
  if (rateLimitResult) return rateLimitResult;

  // Authentication required
  const user = getAuthUser(req);
  if (!user) {
    return secureJsonResponse(
      { error: 'Unauthorized', message: 'Valid authentication token required' },
      { status: 401 }
    );
  }

  try {
    // Validate query parameters
    const { searchParams } = new URL(req.url);
    const validation = validateQuery(searchParams, documentsQuerySchema);
    if (!validation.success) return validation.response;

    const { ticker, source, limit } = validation.data;

    let query = `
      SELECT
        d.id,
        d.ticker,
        d.source,
        d.subject,
        d.body_text,
        d.ai_summary,
        d.received_date,
        d.attachment_count,
        COALESCE(
          json_agg(
            json_build_object(
              'id', a.id,
              'filename', a.filename,
              'content_type', a.content_type,
              'file_size', a.file_size
            ) ORDER BY a.created_at
          ) FILTER (WHERE a.id IS NOT NULL),
          '[]'::json
        ) as attachments
      FROM research_documents d
      LEFT JOIN research_attachments a ON d.id = a.document_id
    `;

    const conditions: string[] = [];
    const params: any[] = [];
    let paramCount = 0;

    if (ticker) {
      paramCount++;
      conditions.push(`d.ticker = $${paramCount}`);
      params.push(ticker);
    }

    if (source) {
      paramCount++;
      conditions.push(`d.source = $${paramCount}`);
      params.push(source);
    }

    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`;
    }

    query += ` GROUP BY d.id, d.ticker, d.source, d.subject, d.body_text, d.ai_summary, d.received_date, d.attachment_count`;
    query += ` ORDER BY d.received_date DESC`;
    query += ` LIMIT $${paramCount + 1}`;
    params.push(limit);

    const result = await pool.query(query, params);

    // Log access
    await pool.query(
      `INSERT INTO research_access_logs (token_id, action, accessed_at)
       VALUES ($1, 'list', NOW())`,
      [user.tokenId]
    );

    return secureJsonResponse(result.rows);
  } catch (error) {
    return safeErrorResponse(error, 'Failed to fetch documents');
  }
}
