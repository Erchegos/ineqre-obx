import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { jsPDF } from 'jspdf';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function verifyToken(request: NextRequest): boolean {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return false;

  const token = authHeader.substring(7);
  return token === process.env.RESEARCH_TOKEN;
}

export async function GET(
  request: NextRequest,
  { params }: { params: { documentId: string } }
) {
  // Verify authentication
  if (!verifyToken(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Fetch document
    const { data: doc, error } = await supabase
      .from('research_documents')
      .select('*')
      .eq('id', params.documentId)
      .single();

    if (error || !doc) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }

    // Create PDF
    const pdf = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
    });

    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 20;
    const maxWidth = pageWidth - (margin * 2);
    let y = margin;

    // Helper to add text with wrapping
    const addText = (text: string, fontSize: number, isBold: boolean = false, color: [number, number, number] = [0, 0, 0]) => {
      pdf.setFontSize(fontSize);
      pdf.setFont('helvetica', isBold ? 'bold' : 'normal');
      pdf.setTextColor(...color);

      const lines = pdf.splitTextToSize(text, maxWidth);

      for (const line of lines) {
        if (y > pageHeight - margin) {
          pdf.addPage();
          y = margin;
        }
        pdf.text(line, margin, y);
        y += fontSize * 0.5;
      }
      y += 3;
    };

    // Add header
    addText('RESEARCH REPORT', 10, true, [100, 100, 100]);
    y += 2;

    // Add metadata
    if (doc.ticker) {
      pdf.setFillColor(59, 130, 246);
      pdf.roundedRect(margin, y - 4, 30, 8, 2, 2, 'F');
      pdf.setTextColor(255, 255, 255);
      pdf.setFontSize(10);
      pdf.setFont('helvetica', 'bold');
      pdf.text(doc.ticker, margin + 15, y + 1, { align: 'center' });
      y += 10;
    }

    // Source and date
    pdf.setTextColor(100, 100, 100);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(9);
    pdf.text(`${doc.source} • ${new Date(doc.received_date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })}`, margin, y);
    y += 10;

    // Subject
    addText(doc.subject, 16, true, [0, 0, 0]);
    y += 5;

    // Divider
    pdf.setDrawColor(200, 200, 200);
    pdf.line(margin, y, pageWidth - margin, y);
    y += 8;

    // Body text
    if (doc.body_text) {
      const bodyText = doc.body_text.trim();

      // Check for report link in body
      const linkMatch = bodyText.match(/Full Report:\s*(https?:\/\/[^\s]+)/);
      let mainText = bodyText;
      let reportLink = null;

      if (linkMatch) {
        reportLink = linkMatch[1];
        mainText = bodyText.substring(0, linkMatch.index).trim();
      }

      // Add main body text
      addText(mainText, 10, false, [40, 40, 40]);
      y += 5;

      // Add clickable link if available
      if (reportLink) {
        pdf.setDrawColor(200, 200, 200);
        pdf.line(margin, y, pageWidth - margin, y);
        y += 8;

        pdf.setTextColor(59, 130, 246);
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(11);
        pdf.text('View Full Report Online', margin, y);
        y += 7;

        pdf.setTextColor(30, 100, 200);
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(9);

        // Wrap long URL
        const urlLines = pdf.splitTextToSize(reportLink, maxWidth);
        for (const line of urlLines) {
          pdf.textWithLink(line, margin, y, { url: reportLink });
          pdf.setDrawColor(30, 100, 200);
          const textWidth = pdf.getTextWidth(line);
          pdf.line(margin, y + 0.5, margin + textWidth, y + 0.5);
          y += 5;
        }
      }
    } else {
      addText('(Email body content is not available)', 10, false, [150, 150, 150]);
    }

    // Footer
    const footerY = pageHeight - 15;
    pdf.setFontSize(8);
    pdf.setTextColor(150, 150, 150);
    pdf.setFont('helvetica', 'normal');
    pdf.text(`Generated from InEqRe Research Portal • ${new Date().toLocaleDateString()}`, pageWidth / 2, footerY, { align: 'center' });

    // Return PDF as buffer
    const pdfBuffer = Buffer.from(pdf.output('arraybuffer'));

    return new NextResponse(pdfBuffer, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${doc.ticker || 'report'}_${doc.subject.substring(0, 50).replace(/[^a-z0-9]/gi, '_')}.pdf"`,
      },
    });
  } catch (error: any) {
    console.error('PDF generation error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
