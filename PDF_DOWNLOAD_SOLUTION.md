# Automatic PDF Download Solution

## Overview

The research portal now automatically downloads and stores Pareto research report PDFs when processing emails. This eliminates authentication issues and ensures reports are always available.

## How It Works

### 1. Email Processing
When the email processor runs (`scripts/email-processor.js`):
- Extracts the "Full Report" link from each Pareto email
- Downloads the PDF from the FactSet/Pareto servers
- Stores it locally as an attachment
- Saves metadata to the database

### 2. User Experience
When users click "View Report" in the portal:
- System checks for stored PDF attachments first
- If PDF exists: Downloads it directly (fast, always works)
- If no PDF: Falls back to copying the report link

## Usage

### Automatic Mode (Recommended)
Set up a cron job to process emails automatically:

```bash
# Run every 30 minutes
*/30 * * * * cd /path/to/InEqRe_OBX && node scripts/email-processor.js >> logs/email-processor.log 2>&1
```

Or use the provided script:
```bash
./scripts/monitor-emails.sh
```

### Manual Mode
Process emails on demand:
```bash
cd /Users/olaslettebak/Documents/Intelligence_Equity_Research/code/InEqRe_OBX
node scripts/email-processor.js
```

## Technical Details

### Storage Location
PDFs are stored in: `storage/research/YYYY/MM/documentId/filename.pdf`

Example:
```
storage/research/2026/01/a1b2c3d4-uuid/BAKKA_Q4_Results.pdf
```

### Database Schema
PDFs are stored as regular attachments in the `research_attachments` table:
- `document_id`: Links to research_documents
- `filename`: PDF filename
- `content_type`: `application/pdf`
- `file_path`: Relative path to the stored file
- `file_size`: Size in bytes

### API Endpoint
PDFs are served through the existing attachment endpoint:
```
GET /api/research/documents/{documentId}/attachments/{attachmentId}
Authorization: Bearer {jwt_token}
```

## Benefits

✅ **Always Available**: PDFs are permanently stored, no broken links
✅ **No Authentication Required**: Users don't need Pareto/FactSet access
✅ **Fully Automated**: No manual intervention needed
✅ **Fast Downloads**: Served from local storage
✅ **Existing Infrastructure**: Uses the same attachment system

## Monitoring

Check the email processor logs to see PDF downloads:
```bash
tail -f logs/email-processor.log
```

Look for messages like:
```
✓ Downloaded and saved PDF: BAKKA_Q4_Results.pdf (1234KB)
```

## Troubleshooting

### PDF Download Fails
If you see:
```
⚠ PDF download failed: HTTP 500
```

This is normal for some links - they require authentication. The email will still be processed, just without the PDF. Users can still access the report through the original email link.

### Storage Space
Monitor disk usage in the `storage/research/` directory:
```bash
du -sh storage/research/
```

Typical PDF sizes: 500KB - 5MB per report

### Reprocessing Emails
To force reprocessing of emails (e.g., to download PDFs for old emails):
1. Delete entries from `research_documents` table
2. Run email processor again

**Note**: Be careful - this will re-import all emails!

## Future Improvements

Possible enhancements:
- [ ] Retry failed PDF downloads
- [ ] Support for other research providers (DNB, ABG, etc.)
- [ ] PDF text extraction for search
- [ ] Cloud storage (S3, Supabase Storage) instead of local files
- [ ] Cleanup old PDFs after X months

## Files Modified

1. `scripts/email-processor.js` - Added PDF download logic
2. `apps/web/src/app/research/page.tsx` - Check for stored PDFs first
3. `apps/web/src/app/api/research/documents/[documentId]/attachments/[attachmentId]/route.ts` - Existing endpoint serves PDFs

## Commit History

- `cd9aa82` - Initial implementation of automatic PDF download
