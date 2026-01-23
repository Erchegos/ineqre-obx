# Missing PDFs Report

## Summary

6 research documents from January 23, 2026 are missing PDF attachments.

## Investigation Results

### Root Cause

1. **Body Text Truncation**: Email processor truncates body_text to 1850 characters ([email-processor.js:335](scripts/email-processor.js#L335))
2. **URL Extraction Failure**: PDF URLs were not extracted during initial email processing
3. **FactSet Tracking URLs**: Emails only contain time-sensitive, single-use FactSet download links (no PDF attachments)

### Documents Missing PDFs

| Ticker | Subject | Date | Status |
|--------|---------|------|--------|
| N/A | Kongsberg Gruppen - US missile plant to start production in late 2027 - Newsflash | 2026-01-23 | Missing |
| N/A | Storebrand - Likely to end 2025E on a high note - Quarterly Preview | 2026-01-23 | Missing |
| N/A | Mips - Strapped In - Quarterly Preview | 2026-01-23 | Missing |
| N/A | Thule Group - Finding Traction - Quarterly Preview | 2026-01-23 | Missing |
| N/A | Investor - Listed upside limited – Down to Hold - Quarterly Review | 2026-01-23 | Missing |
| N/A | Borregaard ASA - Meaningful price hikes beyond horizon - Update | 2026-01-23 | Missing |

### What We Tried

✅ **Successfully extracted PDF URLs from IMAP** - Re-fetched emails and extracted FactSet tracking URLs
✅ **Updated database** - Appended "Full Report: URL" to body_text
❌ **Download attempts failed** - All FactSet URLs return HTTP 500 (expired/require authentication)
❌ **No email attachments** - Emails don't contain PDF attachments, only HTML tracking links

### FactSet URL Example

```
https://parp.hosting.factset.com/PARTNERS_TD_TRACK/external/download?q$3f243e4a9cc71de5f4903e9f6674e2faafdda4fds8wb0QcF9kmYTm7nCdBYGdywlzn47yrcW13w1KIn5ei3gwnmBRMmPbLRkMMIn01D3-z3Mynm5Gn2liNKTE9IZPLpIIfcaGjRtc5S39NctqeareosxcZMz9QntQIR8f-jw98WIicqLbURoc3eyCDcUoGWHaEurzkwarUQKSk2ORDe4YDs1-u7CQ5x4ScrgotZMD2XGnTF6AvQo1ckiPdOLhWjIsUwnU8jNg6itB0OofIesoP8da28Vyco63bX75_DnbR97OLmwpxzzfmvZ06jhqnWt9Az98LB2__T1WnFA5XjWB5N6nwhePfKPd7Fyq1
```

These are time-sensitive, single-use download tracking URLs that:
- Require valid session/authentication
- Expire after a certain time period
- Return HTTP 500 when expired or accessed without proper context

## Solution

Since the FactSet tracking URLs have expired and the emails don't contain PDF attachments:

1. **Open emails in Gmail** - Click the tracking links from within the email (may work if session is still valid)
2. **Access Pareto Securities portal** - Download PDFs directly from the research portal
3. **Manual upload** - After downloading, manually add PDFs to the research portal

## Scripts Created

The following utility scripts were created during investigation:

- **fetch-pdfs-from-imap.js** - ✅ Successfully extracted 6 PDF URLs from IMAP emails
- **check-email-attachments.js** - Verified emails don't have PDF attachments
- **download-factset-pdfs.js** - Attempted download with proper headers (HTTP 500)
- **analyze-email-structure.js** - Analyzed email structure and confirmed no alternative links
- **extract-urls-from-body.js** - Identified body text truncation issue
- **find-missing-pdf-urls.js** - Diagnostic tool for finding missing PDFs
- **test-imap-connection.js** - IMAP connection testing utility

## Recommendation

To prevent this issue in the future:

1. **Increase body_text limit** - Raise from 1850 to at least 3000 characters
2. **Improve URL extraction** - Ensure PDF URLs are always extracted from HTML emails
3. **Save raw emails** - Store raw email files when PDF URLs are found
4. **Immediate download** - Download PDFs during email processing, not as a separate step
