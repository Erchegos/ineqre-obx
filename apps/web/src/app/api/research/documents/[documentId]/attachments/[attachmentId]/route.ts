import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { verify } from 'jsonwebtoken';
import fs from 'fs';
import path from 'path';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

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

type RouteContext = {
  params: {
    documentId: string;
    attachmentId: string;
  };
};

export async function GET(
  req: NextRequest,
  { params }: RouteContext
) {
  const tokenId = verifyToken(req);

  if (!tokenId) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    );
  }

  try {
    const { documentId, attachmentId } = params;

    // Get attachment info
    const result = await pool.query(
      `SELECT a.*, d.ticker, d.source
       FROM research_attachments a
       JOIN research_documents d ON a.document_id = d.id
       WHERE a.id = $1 AND d.id = $2`,
      [attachmentId, documentId]
    );

    if (result.rows.length === 0) {
      return NextResponse.json(
        { error: 'Attachment not found' },
        { status: 404 }
      );
    }

    const attachment = result.rows[0];

    // Get storage directory (same as email processor)
    const storageDir = process.env.STORAGE_DIR || path.join(process.cwd(), 'storage', 'research');
    const filePath = path.join(storageDir, attachment.file_path);

    // Check if file exists
    if (!fs.existsSync(filePath)) {
      return NextResponse.json(
        { error: 'File not found on disk' },
        { status: 404 }
      );
    }

    // Read file
    const fileBuffer = fs.readFileSync(filePath);

    // Log access
    await pool.query(
      `INSERT INTO research_access_logs (token_id, document_id, action, accessed_at)
       VALUES ($1, $2, 'download', NOW())`,
      [tokenId, documentId]
    );

    // Return file with appropriate headers
    return new NextResponse(fileBuffer, {
      headers: {
        'Content-Type': attachment.content_type || 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${attachment.filename}"`,
        'Content-Length': attachment.file_size.toString(),
      },
    });
  } catch (error) {
    console.error('Error serving file:', error);
    return NextResponse.json(
      { error: 'Failed to download file' },
      { status: 500 }
    );
  }
}
