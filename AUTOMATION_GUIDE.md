# Email Import Automation Guide

This guide shows you how to automatically import new Pareto Securities emails.

## Option 1: Cron Job (Mac/Linux Server)

### Quick Setup

1. **Edit your crontab:**
   ```bash
   crontab -e
   ```

2. **Add this line to run every hour:**
   ```
   0 * * * * cd /Users/olaslettebak/Documents/Intelligence_Equity_Research/code/InEqRe_OBX && /usr/local/bin/node scripts/email-processor.js >> logs/email-import.log 2>&1
   ```

3. **Or run every 30 minutes:**
   ```
   */30 * * * * cd /Users/olaslettebak/Documents/Intelligence_Equity_Research/code/InEqRe_OBX && /usr/local/bin/node scripts/email-processor.js >> logs/email-import.log 2>&1
   ```

4. **Or run at 9 AM every day:**
   ```
   0 9 * * * cd /Users/olaslettebak/Documents/Intelligence_Equity_Research/code/InEqRe_OBX && /usr/local/bin/node scripts/email-processor.js >> logs/email-import.log 2>&1
   ```

### View Logs

```bash
# View recent imports
tail -f logs/email-import.log

# View all logs
cat logs/email-import.log
```

### Check if it's working

```bash
# List your cron jobs
crontab -l

# Check recent log entries
tail -20 logs/email-import.log
```

## Option 2: GitHub Actions (Cloud-Based)

Create `.github/workflows/import-emails.yml`:

```yaml
name: Import Pareto Emails

on:
  schedule:
    # Run every hour
    - cron: '0 * * * *'
  workflow_dispatch: # Allow manual trigger

jobs:
  import:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'

      - name: Install dependencies
        run: cd InEqRe_OBX && npm install

      - name: Import emails
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
          GMAIL_CLIENT_ID: ${{ secrets.GMAIL_CLIENT_ID }}
          GMAIL_CLIENT_SECRET: ${{ secrets.GMAIL_CLIENT_SECRET }}
          GMAIL_REFRESH_TOKEN: ${{ secrets.GMAIL_REFRESH_TOKEN }}
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
        run: cd InEqRe_OBX && node scripts/email-processor.js
```

Then add your secrets in GitHub: Settings → Secrets → Actions

## Option 3: Vercel Cron (Serverless)

Create a Vercel cron endpoint:

**File: `apps/web/src/app/api/cron/import-emails/route.ts`**

```typescript
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  // Verify cron secret
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Run email import
  // ... import logic here ...

  return NextResponse.json({ success: true });
}
```

**Add to `vercel.json`:**

```json
{
  "crons": [{
    "path": "/api/cron/import-emails",
    "schedule": "0 * * * *"
  }]
}
```

## Recommended Schedule

- **Every hour**: Good for active monitoring
- **Every 30 minutes**: If you need faster updates
- **9 AM daily**: If you only need morning updates
- **9 AM & 4 PM**: Twice daily for start and end of day

## Testing

Run manually to test:
```bash
cd /Users/olaslettebak/Documents/Intelligence_Equity_Research/code/InEqRe_OBX
node scripts/email-processor.js
```

## Current Status

- ✅ Email processor script ready
- ✅ Gmail OAuth configured
- ✅ Supabase storage ready
- ✅ Database schema ready
- ⏳ Automation not yet configured

Choose one option above and set it up!
