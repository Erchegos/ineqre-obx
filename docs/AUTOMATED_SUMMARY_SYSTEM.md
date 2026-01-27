# Automated Research Summary System

## Overview

The research portal now has a fully automated system for importing emails from Gmail, downloading PDFs, and generating AI summaries using Claude API.

## System Components

### 1. Email Processing Pipeline

The system runs automatically every 30 minutes via GitHub Actions and consists of three main steps:

#### Step 1: Email Import
- **Script**: `scripts/email-processor.js`
- **Function**: Connects to Gmail via IMAP and imports research emails
- **Stores**: Email metadata, subject, body text in PostgreSQL database

#### Step 2: PDF Download
- **Script**: `scripts/gmail-pdf-downloader.js`
- **Function**: Downloads PDF attachments via Gmail API
- **Stores**: PDFs in Supabase Storage

#### Step 3: AI Summary Generation
- **Script**: `scripts/auto-generate-summaries.js`
- **Function**: Generates professional summaries using Claude API
- **Stores**: Summaries in `ai_summary` column of `research_documents` table

### 2. GitHub Actions Workflow

**File**: `.github/workflows/import-emails.yml`

```yaml
- name: Generate AI Summaries
  env:
    DATABASE_URL: ${{ secrets.DATABASE_URL }}
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
  run: node scripts/generate-all-summaries.js
```

**Schedule**: Runs every 30 minutes (`*/30 * * * *`)

### 3. Manual Generation via Web Interface

#### API Endpoint
- **File**: `apps/web/src/app/api/research/generate-summaries/route.ts`
- **URL**: `POST /api/research/generate-summaries`
- **Function**: Processes 5 documents at a time
- **Rate Limiting**: 1 second delay between requests

#### UI Button
- **Location**: Research portal header (`apps/web/src/app/research/page.tsx`)
- **Button**: " Generate AI Summaries"
- **Features**:
  - Shows loading state during generation
  - Displays status message with results
  - Automatically refreshes document list when complete
  - Requires authentication token

### 4. Command Line Usage

Run summary generation manually:

```bash
node scripts/auto-generate-summaries.js
```

Check summary status:

```bash
node scripts/check-summaries.js
```

Check documents missing summaries:

```bash
node scripts/check-missing-summaries.js
```

## AI Summary Generation

### Model Configuration
- **Model**: `claude-3-haiku-20240307`
- **Max Tokens**: 1024
- **Input Limit**: 15,000 characters of cleaned body text

### Prompt Template

The system uses a structured prompt that ensures summaries cover:

1. Investment thesis and recommendation
2. Key financial metrics, estimates, or valuation
3. Significant events, catalysts, or changes
4. Target price or rating if mentioned

### Text Cleaning

Before sending to Claude API, the system:

1. Removes email disclaimers and footers
2. Strips email addresses and phone numbers
3. Removes "CLICK HERE" buttons and links
4. Removes analyst contact information

### Response Cleaning

After receiving the summary, the system:

1. Removes meta-commentary ("Here is a summary...")
2. Strips section headers from the response
3. Removes multiple consecutive newlines
4. Trims whitespace

## Current Status

### Database Statistics (as of last check)
- **Total documents**: 367
- **With summaries**: 317 (86.4%)
- **Without summaries**: 50 (13.6%)

### Documents Without Summaries
- All 50 documents have empty `body_text` fields
- These are from January 2024
- Likely due to email parsing issues in older import runs
- System correctly skips these (no content to summarize)

## Technical Details

### SSL/TLS Configuration

For local development, the system disables SSL validation:

```javascript
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: false // Disable SSL for local development
});
```

### Rate Limiting

To avoid Claude API rate limits:
- Process max 10 documents per run (can be adjusted)
- 1 second delay between API calls
- 5 minute timeout for API route

### Error Handling

- Failed summaries are logged but don't stop batch processing
- Documents with failed summaries remain marked as needing summaries
- Will be retried on next run

## Environment Variables Required

### For Email Import
- `EMAIL_USER`: Gmail email address
- `EMAIL_PASSWORD`: Gmail app password
- `GMAIL_CREDENTIALS`: Gmail API credentials JSON
- `GMAIL_TOKEN`: Gmail API token JSON

### For Summary Generation
- `ANTHROPIC_API_KEY`: Claude API key
- `DATABASE_URL`: PostgreSQL connection string

### For PDF Storage
- `SUPABASE_URL`: Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY`: Supabase service role key

## Future Improvements

1. **Retry Logic**: Implement exponential backoff for failed summaries
2. **Parallel Processing**: Generate summaries in parallel with concurrency control
3. **Quality Metrics**: Track summary quality scores
4. **Custom Prompts**: Allow different prompt templates per source
5. **Summary Updates**: Regenerate summaries when document content changes
6. **Notification System**: Alert when new summaries are generated

## Monitoring

### Check System Health

```bash
# Check recent documents and summary status
node scripts/check-summaries.js

# Check documents missing summaries
node scripts/check-missing-summaries.js

# View GitHub Actions logs
# Go to: https://github.com/[your-repo]/actions
```

### Key Metrics to Monitor

1. Summary generation success rate
2. Average summary length
3. API response times
4. Failed summary attempts
5. Documents without body text

## Troubleshooting

### Issue: Summaries not generating

**Check**:
1. Verify `ANTHROPIC_API_KEY` is set correctly
2. Check database connection with `node scripts/check-summaries.js`
3. Ensure documents have non-empty `body_text`
4. Review Claude API quota and rate limits

### Issue: GitHub Actions failing

**Check**:
1. Verify all secrets are configured in GitHub
2. Check Actions tab for error logs
3. Verify workflow file syntax
4. Test scripts locally first

### Issue: Empty body_text

**Cause**: Email parsing issues in `email-processor.js`

**Solution**:
1. Check email format compatibility
2. Review IMAP parsing logic
3. Consider alternative parsing libraries

## Summary

The automated summary generation system is fully operational with:

[OK] GitHub Actions running every 30 minutes
[OK] Manual web interface for on-demand generation
[OK] Command-line scripts for testing and monitoring
[OK] 317/367 documents with AI-generated summaries
[OK] Robust error handling and rate limiting
[OK] Clean, professional summaries using Claude 3 Haiku
