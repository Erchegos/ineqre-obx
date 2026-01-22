# Gmail API Setup Guide

This guide will help you set up Gmail API access to download PDF attachments from research emails.

## Step 1: Enable Gmail API

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or select existing one)
3. Go to [Gmail API Library](https://console.cloud.google.com/apis/library/gmail.googleapis.com)
4. Click "Enable"

## Step 2: Create OAuth 2.0 Credentials

1. Go to [API Credentials](https://console.cloud.google.com/apis/credentials)
2. Click "Create Credentials" > "OAuth client ID"
3. If prompted, configure the OAuth consent screen:
   - User Type: External
   - App name: "InEqRe Research PDF Downloader"
   - User support email: Your email
   - Developer contact: Your email
   - Click "Save and Continue"
   - Scopes: Skip this for now
   - Test users: Add your Gmail address
   - Click "Save and Continue"

4. Back at "Create OAuth client ID":
   - Application type: **Desktop app**
   - Name: "InEqRe PDF Downloader"
   - Click "Create"

## Step 3: Download Credentials

1. Click the download icon (⬇️) next to your newly created OAuth client
2. Save the JSON file as `gmail-credentials.json`
3. Move it to the project root: `/Users/olaslettebak/Documents/Intelligence_Equity_Research/code/InEqRe_OBX/gmail-credentials.json`

## Step 4: Run the Script

```bash
cd /Users/olaslettebak/Documents/Intelligence_Equity_Research/code/InEqRe_OBX
node scripts/gmail-pdf-downloader.js
```

The script will:
1. Open a browser for one-time authorization
2. Save the access token for future use
3. Download all PDF attachments from recent emails
4. Upload them to Supabase Storage

## Troubleshooting

### "Access blocked: This app's request is invalid"
- Make sure you added your Gmail address to "Test users" in OAuth consent screen
- The app must be in "Testing" mode

### "Error: gmail-credentials.json not found"
- Make sure the file is in the project root directory
- Check that the filename is exactly `gmail-credentials.json`

### "Token has been expired or revoked"
- Delete `gmail-token.json`
- Run the script again to re-authorize

## Security Note

- Keep `gmail-credentials.json` and `gmail-token.json` private
- These files are already in `.gitignore` and won't be committed to Git
- The script only requests read-only access to Gmail
