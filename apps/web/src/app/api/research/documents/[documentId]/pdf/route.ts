import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verify } from 'jsonwebtoken';

// Lazy initialization to avoid build-time errors when env vars aren't available
function getSupabaseClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
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

// Extract PDF link from email body text
function extractPdfLink(bodyText: string): string | null {
  // Look for the "Click to open report" link pattern
  const linkMatch = bodyText.match(/https:\/\/parp\.hosting\.factset\.com\/[^\s\)]+/);
  if (linkMatch) {
    return linkMatch[0];
  }

  // Fallback to any factset link
  const factsetMatch = bodyText.match(/https:\/\/[^\s]*factset[^\s]*/i);
  if (factsetMatch) {
    return factsetMatch[0];
  }

  // Last resort: any https link in the text
  const anyLinkMatch = bodyText.match(/https?:\/\/[^\s\)]+/);
  return anyLinkMatch ? anyLinkMatch[0] : null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ documentId: string }> }
) {
  // Verify authentication
  const tokenId = verifyToken(request);
  if (!tokenId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Await params in Next.js 16
    const { documentId } = await params;

    // Get Supabase client at runtime
    const supabase = getSupabaseClient();

    // Fetch document
    const { data: doc, error } = await supabase
      .from('research_documents')
      .select('*')
      .eq('id', documentId)
      .single();

    if (error || !doc) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }

    // Extract the PDF link from the email body
    const pdfLink = extractPdfLink(doc.body_text);

    if (!pdfLink) {
      return NextResponse.json({
        error: 'No PDF link found in email'
      }, { status: 404 });
    }

    // Fetch the PDF from the Pareto/FactSet server
    const pdfResponse = await fetch(pdfLink, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      },
    });

    if (!pdfResponse.ok) {
      throw new Error(`Failed to fetch PDF: ${pdfResponse.status} ${pdfResponse.statusText}`);
    }

    // Get the PDF content
    const pdfBuffer = await pdfResponse.arrayBuffer();

    // Generate a clean filename
    const filename = `${doc.ticker || 'report'}_${doc.subject.substring(0, 50).replace(/[^a-z0-9]/gi, '_')}.pdf`;

    // Return the PDF
    return new NextResponse(Buffer.from(pdfBuffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'private, max-age=3600',
      },
    });
  } catch (error: any) {
    console.error('PDF download error:', error);
    return NextResponse.json({
      error: error.message || 'Failed to download PDF'
    }, { status: 500 });
  }
}
