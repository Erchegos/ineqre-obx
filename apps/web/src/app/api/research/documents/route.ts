import { NextRequest, NextResponse } from 'next/server';
import { verify } from 'jsonwebtoken';
import { pool } from '@/lib/db';

// Verify JWT token from request
function verifyToken(req: NextRequest): string | null {
  const authHeader = req.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  const token = authHeader.substring(7);
  try {
    const decoded = verify(
      token,
      process.env.JWT_SECRET || 'your-secret-key-change-this'
    ) as { tokenId: string };
    return decoded.tokenId;
  } catch (error) {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const tokenId = verifyToken(req);

  if (!tokenId) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    );
  }

  try {
    const { searchParams } = new URL(req.url);
    const ticker = searchParams.get('ticker');
    const source = searchParams.get('source');
    const limit = parseInt(searchParams.get('limit') || '100');

    let query = `
      SELECT
        d.id,
        d.ticker,
        d.source,
        d.subject,
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

    query += ` GROUP BY d.id, d.ticker, d.source, d.subject, d.received_date, d.attachment_count`;
    query += ` ORDER BY d.received_date DESC`;
    query += ` LIMIT $${paramCount + 1}`;
    params.push(limit);

    const result = await pool.query(query, params);

    // Log access
    await pool.query(
      `INSERT INTO research_access_logs (token_id, action, accessed_at)
       VALUES ($1, 'list', NOW())`,
      [tokenId]
    );

    return NextResponse.json(result.rows);
  } catch (error) {
    console.error('Error fetching documents:', error);
    return NextResponse.json(
      { error: 'Failed to fetch documents' },
      { status: 500 }
    );
  }
}
