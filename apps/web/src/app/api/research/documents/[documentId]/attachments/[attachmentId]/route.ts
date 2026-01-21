import { NextRequest, NextResponse } from 'next/server';
import { verify } from 'jsonwebtoken';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { pool } from '@/lib/db';

// Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

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

    // Try to download from Supabase Storage first
    console.log('[PDF Download] Attempting Supabase Storage:', attachment.file_path);

    const { data: supabaseData, error: supabaseError } = await supabase.storage
      .from('research-pdfs')
      .download(attachment.file_path);

    let fileBuffer: Buffer;

    if (supabaseData && !supabaseError) {
      // Successfully downloaded from Supabase
      console.log('[PDF Download] Downloaded from Supabase Storage');
      fileBuffer = Buffer.from(await supabaseData.arrayBuffer());
    } else {
      // Fallback to local storage (for development)
      console.log('[PDF Download] Supabase failed, trying local storage');
      const storageDir = process.env.STORAGE_DIR || '/Users/olaslettebak/Documents/Intelligence_Equity_Research/code/InEqRe_OBX/storage/research';
      const filePath = path.join(storageDir, attachment.file_path);

      console.log('[PDF Download] Local path:', filePath);
      console.log('[PDF Download] File exists:', fs.existsSync(filePath));

      if (!fs.existsSync(filePath)) {
        console.error('[PDF Download] File not found in Supabase or local storage');
        return NextResponse.json(
          { error: 'File not found', supabaseError: supabaseError?.message },
          { status: 404 }
        );
      }

      fileBuffer = fs.readFileSync(filePath);
      console.log('[PDF Download] Downloaded from local storage');
    }

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
