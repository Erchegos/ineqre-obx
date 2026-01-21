import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { verify } from 'jsonwebtoken';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'eu-north-1',
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

    // Generate presigned URL for S3 download (valid for 1 hour)
    const command = new GetObjectCommand({
      Bucket: process.env.S3_BUCKET || 'ineqre-research',
      Key: attachment.file_path,
    });

    const presignedUrl = await getSignedUrl(s3Client, command, {
      expiresIn: 3600, // 1 hour
    });

    // Log access
    await pool.query(
      `INSERT INTO research_access_logs (token_id, document_id, action, accessed_at)
       VALUES ($1, $2, 'download', NOW())`,
      [tokenId, documentId]
    );

    return NextResponse.json({
      url: presignedUrl,
      filename: attachment.filename,
      content_type: attachment.content_type,
    });
  } catch (error) {
    console.error('Error generating download URL:', error);
    return NextResponse.json(
      { error: 'Failed to generate download link' },
      { status: 500 }
    );
  }
}
