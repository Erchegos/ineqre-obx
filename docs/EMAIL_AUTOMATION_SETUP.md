# Email Automation Setup for Pareto Securities Research

## Current Status

✅ **242 Pareto Securities research emails from 2026** have been imported
✅ All emails include: subject, date, ticker, source, sender
✅ Emails visible in research portal at `/research`
✅ Automatic import script configured

## What's Been Implemented

### 1. Email Import Script (`scripts/email-processor.js`)
- Automatically connects to Gmail via IMAP
- Filters for Pareto Securities emails (`noreply@research.paretosec.com`)
- Extracts metadata: subject, date, ticker (from subject), sender
- Attempts body text extraction with HTML-to-text conversion
- Processes attachments (PDFs, etc.)
- Batch size: 500 emails per run

### 2. Monitoring Script (`scripts/monitor-emails.sh`)
- Wrapper for periodic email import
- Logs output to `logs/email-monitor.log`
- Can be run via cron for automatic updates

### 3. Body Text Extraction
- Implemented recursive MIME parsing for complex email structures
- HTML-to-plain-text conversion
- **Current Issue**: Gmail IMAP has reliability issues with body downloads
  - Connection timeouts during batch processing
  - Download streams occasionally fail

## Setup for Automatic Email Import

### Option 1: Cron Job (Recommended for Mac/Linux)

Add to crontab (`crontab -e`):

```bash
# Run every 15 minutes during business hours (9 AM - 6 PM)
*/15 9-18 * * 1-5 cd /Users/olaslettebak/Documents/Intelligence_Equity_Research/code/InEqRe_OBX && /usr/local/bin/node scripts/email-processor.js >> logs/email-monitor.log 2>&1

# Or run every hour, 24/7
0 * * * * cd /Users/olaslettebak/Documents/Intelligence_Equity_Research/code/InEqRe_OBX && /usr/local/bin/node scripts/email-processor.js >> logs/email-monitor.log 2>&1
```

### Option 2: LaunchD (Mac Native)

Create `~/Library/LaunchAgents/com.ineqre.email-monitor.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.ineqre.email-monitor</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/node</string>
        <string>/Users/olaslettebak/Documents/Intelligence_Equity_Research/code/InEqRe_OBX/scripts/email-processor.js</string>
    </array>
    <key>WorkingDirectory</key>
    <string>/Users/olaslettebak/Documents/Intelligence_Equity_Research/code/InEqRe_OBX</string>
    <key>StartInterval</key>
    <integer>900</integer> <!-- Every 15 minutes -->
    <key>StandardOutPath</key>
    <string>/Users/olaslettebak/Documents/Intelligence_Equity_Research/code/InEqRe_OBX/logs/email-monitor.log</string>
    <key>StandardErrorPath</key>
    <string>/Users/olaslettebak/Documents/Intelligence_Equity_Research/code/InEqRe_OBX/logs/email-monitor.log</string>
</dict>
</plist>
```

Load the service:
```bash
launchctl load ~/Library/LaunchAgents/com.ineqre.email-monitor.plist
launchctl start com.ineqre.email-monitor
```

## Manual Import

To manually import new emails:

```bash
cd /Users/olaslettebak/Documents/Intelligence_Equity_Research/code/InEqRe_OBX
node scripts/email-processor.js
```

## Email Body Text - Current Status & Solutions

### Issue
Body text extraction via Gmail IMAP is unreliable due to:
1. Gmail rate limiting / timeouts on large batches
2. Complex MIME structures (HTML + inline images)
3. Connection drops during sequential downloads

### What's Available Now
- **Subject lines**: Full research report titles (e.g., "Navigator Holdings - Steady as she goes - Quarterly Preview")
- **Metadata**: Date, ticker (extracted from subject), source
- **Attachments**: PDFs and other attachments are detected (though not downloaded yet)

### Solutions for Body Text

#### Option A: Manual Trigger (Quick Fix)
Users click "Show Email" → triggers on-demand body fetch for that specific email

#### Option B: Gmail API (Best Long-term)
- More reliable than IMAP
- Better rate limits
- Requires OAuth2 setup
- Can batch download efficiently

#### Option C: Email Forwarding Rule
- Set up Gmail filter to forward Pareto emails to a dedicated webhook
- Webhook processes email immediately upon receipt
- 100% real-time, no polling needed

#### Option D: Accept Current State
- Subject lines provide good preview
- Focus on link extraction to full reports
- Many research emails have clickable PDF links

## Link Extraction

The research portal already extracts links from email body text when available:
- Auto-detects URLs in format: `https://research.paretosec.com/...`
- "View Full Report" button appears when link found
- Opens report in new tab

## Configuration

All settings in `.env` file:
```bash
EMAIL_IMAP_HOST=imap.gmail.com
EMAIL_IMAP_PORT=993
EMAIL_USER=Slettebakola@gmail.com
EMAIL_PASSWORD=cblvhbrnkksuxgbu  # App-specific password
DATABASE_URL=postgresql://...
```

## Monitoring

Check import logs:
```bash
tail -f /Users/olaslettebak/Documents/Intelligence_Equity_Research/code/InEqRe_OBX/logs/email-monitor.log
```

Check database:
```bash
node -e "
const { Pool } = require('pg');
require('dotenv').config();
let cs = process.env.DATABASE_URL.trim().replace(/^['\\\"']|['\\\"']$/g, '').replace(/[?&]sslmode=\\w+/g, '');
const pool = new Pool({ connectionString: cs, ssl: { rejectUnauthorized: false }});
pool.query('SELECT COUNT(*), MAX(received_date) FROM research_documents WHERE source = \\'Pareto Securities\\' AND received_date >= \\'2026-01-01\\'')
  .then(r => { console.log(r.rows[0]); return pool.end(); });
"
```

## Next Steps

1. **Immediate**: Set up cron job or LaunchD for automatic imports
2. **Short-term**: Test with next incoming Pareto email
3. **Medium-term**: Decide on body text solution (Options A-D above)
4. **Long-term**: Consider Gmail API migration for better reliability

## Troubleshooting

### No new emails imported
- Check email credentials in `.env`
- Verify Gmail app password hasn't expired
- Check logs for connection errors

### Body text missing
- This is expected currently due to IMAP limitations
- Subject lines and metadata are still available
- See "Solutions for Body Text" above

### Script crashes
- Check `logs/email-monitor.log` for errors
- Verify database connection string
- Ensure Gmail allows IMAP access
