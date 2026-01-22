# Automated PDF Download Setup

This guide explains how to set up automatic PDF downloads in GitHub Actions.

## Current Automation

The system runs every 30 minutes via GitHub Actions:
1. **Import emails** - Downloads new research emails from your inbox
2. **Download PDFs** - Fetches PDF attachments using Gmail API

## Setup Instructions

### Step 1: Add GitHub Secrets

You need to add two new secrets to your GitHub repository:

1. Go to your repository on GitHub
2. Click **Settings** → **Secrets and variables** → **Actions**
3. Click **New repository secret**
4. Add these two secrets:

#### GMAIL_CREDENTIALS

This is the content of your `gmail-credentials.json` file:

```bash
# Copy the content from your local file
cat /Users/olaslettebak/Documents/Intelligence_Equity_Research/code/InEqRe_OBX/gmail-credentials.json
```

- Name: `GMAIL_CREDENTIALS`
- Value: Paste the entire JSON content (it should start with `{"installed":{` or `{"web":{`)

#### GMAIL_TOKEN

This is the content of your `gmail-token.json` file:

```bash
# Copy the content from your local file
cat /Users/olaslettebak/Documents/Intelligence_Equity_Research/code/InEqRe_OBX/gmail-token.json
```

- Name: `GMAIL_TOKEN`
- Value: Paste the entire JSON content (it should contain `access_token`, `refresh_token`, etc.)

### Step 2: Verify Automation

Once you've added the secrets:

1. Go to **Actions** tab in your GitHub repository
2. Click on **Import Pareto Emails** workflow
3. Click **Run workflow** → **Run workflow** to test manually
4. Check the logs to verify PDFs are being downloaded

### Step 3: Monitor

The workflow runs automatically every 30 minutes. You can:
- Check recent runs in the **Actions** tab
- View logs to see how many PDFs were downloaded
- Visit https://ineqre.no to see the results

## How It Works

### Email Import (email-processor.js)
- Connects to your email via IMAP
- Downloads new Pareto research emails
- Saves email metadata and body text to database
- **Does not download PDFs** (they're not attachments)

### PDF Download (gmail-pdf-downloader.js)
- Uses Gmail API to fetch raw email content
- Extracts FactSet PDF download links from email body
- Properly decodes quoted-printable encoded URLs
- Downloads PDFs and uploads to Supabase Storage
- Updates database with attachment records

## Troubleshooting

### "Error: gmail-credentials.json not found"
- Make sure you added the `GMAIL_CREDENTIALS` secret in GitHub
- Verify the JSON is valid

### "Token has been expired or revoked"
- The `GMAIL_TOKEN` may have expired
- Run the script locally to refresh: `node scripts/gmail-pdf-downloader.js`
- Copy the new content from `gmail-token.json` and update the `GMAIL_TOKEN` secret

### "No PDFs downloaded"
- Check that emails are being imported (check database)
- Verify the workflow ran successfully (check Actions tab)
- Look for errors in the workflow logs

## Local Testing

You can test locally before pushing:

```bash
cd /Users/olaslettebak/Documents/Intelligence_Equity_Research/code/InEqRe_OBX

# Run email import
node scripts/email-processor.js

# Run PDF download
node scripts/gmail-pdf-downloader.js
```

## Security Notes

- **Never commit** `gmail-credentials.json` or `gmail-token.json` to Git
- These files are in `.gitignore` and won't be pushed
- GitHub Secrets are encrypted and only accessible to GitHub Actions
- The Gmail token uses read-only permissions (`gmail.readonly` scope)
