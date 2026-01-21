# Manual PDF Download Guide

Since the automated browser login doesn't work, here are alternative approaches:

## Option 1: Quick Test (Try First)

Run the simple download script:
```bash
node scripts/download-pdfs-simple.js
```

This attempts direct downloads without authentication. It might work for some links!

## Option 2: Manual Download + Bulk Import

The most reliable method:

### Step 1: Create a Download Folder
```bash
mkdir -p ~/ParetoPDFs
```

### Step 2: Download PDFs Manually from Gmail

1. Open Gmail
2. Search for: `from:noreply@research.paretosec.com`
3. Open each email
4. Click "CLICK HERE FOR THE FULL REPORT" link
5. Save PDF to `~/ParetoPDFs/`
   - Use the email subject as filename
   - Or let browser auto-name them

**Tip**: Open multiple tabs and download in parallel!

### Step 3: Run Import Script

I'll create a script that imports all PDFs from that folder:

```bash
node scripts/import-downloaded-pdfs.js ~/ParetoPDFs
```

This will:
- Read all PDFs from the folder
- Match them to emails by subject/date
- Import them into the database
- Make them available in the portal

## Option 3: Browser Extension Method

### Install "Copy Cookies" Chrome Extension

1. Install: https://chrome.google.com/webstore/detail/copy-cookies
2. Go to Gmail
3. Click extension → Copy all cookies
4. Save to `cookies.json` in project root

Then run:
```bash
node scripts/download-pdfs-with-cookies.js
```

## Option 4: Wait for New Emails

The automated system works perfectly for **new emails**:

1. Set up automatic processing:
   ```bash
   ./scripts/setup-cron.sh
   ```

2. Future emails will automatically have PDFs downloaded

3. Old emails can still be accessed through Gmail when needed

## Recommendation

**For existing emails**: Use Option 2 (Manual Download + Bulk Import)
- Most reliable
- You can download 50-100 PDFs in 15-20 minutes
- One-time task

**For future emails**: Use Option 4 (Automatic Processing)
- Set it up once
- All future emails automatically have PDFs
- Zero manual work going forward

---

## Creating the Import Script

Let me know which option you prefer, and I'll help set it up!
