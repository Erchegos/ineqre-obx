import { NextRequest, NextResponse } from 'next/server';
import { verify } from 'jsonwebtoken';
import { createClient } from '@supabase/supabase-js';
import { pool } from '@/lib/db';

// Create Supabase client lazily
function getSupabaseClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    console.error('[Supabase] Missing environment variables:', {
      hasUrl: !!url,
      hasKey: !!key
    });
    throw new Error('Supabase configuration missing');
  }

  return createClient(url, key);
}

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
  params: Promise<{
    documentId: string;
    attachmentId: string;
  }>;
};

export async function GET(
  req: NextRequest,
  context: RouteContext
) {
  const tokenId = verifyToken(req);

  if (!tokenId) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    );
  }

  try {
    const params = await context.params;
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

    // Download from Supabase Storage
    console.log('[PDF Download] Downloading from Supabase Storage:', attachment.file_path);

    let supabase;
    try {
      supabase = getSupabaseClient();
    } catch (error) {
      console.error('[PDF Download] Failed to create Supabase client:', error);
      return NextResponse.json(
        { error: 'Storage configuration error' },
        { status: 500 }
      );
    }

    const { data: supabaseData, error: supabaseError } = await supabase.storage
      .from('research-pdfs')
      .download(attachment.file_path);

    if (supabaseError || !supabaseData) {
      console.error('[PDF Download] Failed to download from Supabase:', {
        error: supabaseError,
        path: attachment.file_path,
        bucket: 'research-pdfs'
      });
      return NextResponse.json(
        { error: 'File not found', details: supabaseError?.message },
        { status: 404 }
      );
    }

    console.log('[PDF Download] Successfully downloaded from Supabase Storage');
    const fileBuffer = Buffer.from(await supabaseData.arrayBuffer());

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
