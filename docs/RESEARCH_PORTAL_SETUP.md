# Research Portal Setup Guide

Complete guide to set up the Pareto Securities research email pipeline and password-protected portal.

## Overview

The research portal automatically:
1. Monitors your email inbox for Pareto research emails
2. Extracts PDFs and attachments
3. Uploads to S3 storage
4. Makes them available via password-protected portal at `/research`

## Prerequisites

- PostgreSQL database
- AWS S3 bucket (or compatible storage)
- Email account with IMAP access
- Node.js 18+ installed

## Step 1: Database Setup

Run the migration to create research tables:

```bash
psql -h your-host -U your-user -d your-database -f packages/db/src/schema/003_research_documents.sql
```

Or if using a migration tool:
```bash
cd packages/db
npm run migrate
```

**Important:** The default password is `research2024`. Change it immediately:

```sql
-- Generate new password hash with bcrypt (rounds=10)
-- Example: bcrypt.hash('your-new-password', 10)
UPDATE research_access_tokens
SET token_hash = '$2b$10$YOUR_NEW_HASH_HERE'
WHERE description = 'Default research portal access';
```

To generate a bcrypt hash in Node.js:
```javascript
const bcrypt = require('bcrypt');
bcrypt.hash('your-new-password', 10, (err, hash) => {
  console.log(hash);
});
```

## Step 2: Environment Variables

Add these to your `.env` file:

```bash
# Database
DATABASE_URL=postgresql://user:password@host:port/database

# JWT Secret for session tokens
JWT_SECRET=d93458e8a1de8bfba653505d4b5a488312d4895596dd5d05d1001fde33680c6a

# Email Configuration
EMAIL_IMAP_HOST=imap.gmail.com
EMAIL_IMAP_PORT=993
EMAIL_USER=Slettebakola@gmail.com
EMAIL_PASSWORD=cblvhbrnkksuxgbu


# AWS S3
AWS_REGION=eu-north-1
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
S3_BUCKET=ineqre-research
```

### Gmail Setup

If using Gmail:
1. Enable 2-factor authentication
2. Go to https://myaccount.google.com/apppasswords
3. Generate an "App Password" for "Mail"
4. Use that password in `EMAIL_PASSWORD`

### AWS S3 Setup

```bash
# Create bucket
aws s3 mb s3://ineqre-research --region eu-north-1

# Set bucket policy (optional - for additional security)
aws s3api put-bucket-policy --bucket ineqre-research --policy '{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": {"AWS": "arn:aws:iam::YOUR-ACCOUNT:user/YOUR-USER"},
    "Action": ["s3:GetObject", "s3:PutObject"],
    "Resource": "arn:aws:s3:::ineqre-research/*"
  }]
}'
```

## Step 3: Install Dependencies

```bash
# In project root
npm install imapflow @aws-sdk/client-s3 @aws-sdk/s3-request-presigner pdf-parse pg dotenv bcrypt jsonwebtoken

# Or with pnpm
pnpm add imapflow @aws-sdk/client-s3 @aws-sdk/s3-request-presigner pdf-parse pg dotenv bcrypt jsonwebtoken
```

## Step 4: Test Email Processor

Run manually to test:

```bash
node scripts/email-processor.js
```

You should see output like:
```
Connecting to email server...
Connected!
Searching for new Pareto research emails...
Processing: BAKKA: Q4 Results from noreply@research.paretosec.com
  Uploaded attachment: BAKKA_Q4_2024.pdf
✓ Processed document uuid-here with 1 attachments

✓ Processed 1 emails
```

## Step 5: Set Up Automated Processing

### Option A: Cron Job (Linux/Mac)

```bash
crontab -e
```

Add this line to run every 10 minutes:
```
*/10 * * * * cd /path/to/InEqRe_OBX && node scripts/email-processor.js >> logs/email-processor.log 2>&1
```

### Option B: systemd Service (Linux)

Create `/etc/systemd/system/research-email.service`:

```ini
[Unit]
Description=Research Email Processor
After=network.target

[Service]
Type=simple
User=your-user
WorkingDirectory=/path/to/InEqRe_OBX
ExecStart=/usr/bin/node scripts/email-processor.js
Restart=on-failure
RestartSec=600

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
sudo systemctl daemon-reload
sudo systemctl enable research-email.service
sudo systemctl start research-email.service
```

### Option C: PM2 Process Manager

```bash
npm install -g pm2

# Start with cron schedule
pm2 start scripts/email-processor.js --name research-email --cron "*/10 * * * *"

# Save and setup autostart
pm2 save
pm2 startup
```

## Step 6: Access the Portal

1. Navigate to `http://localhost:3000/research` (or your production URL)
2. Enter the password you set in Step 1
3. You should see any processed research documents

## Step 7: Configure Email Filters (Optional)

Edit `scripts/email-processor.js` to add more senders:

```javascript
senderFilters: [
  'noreply@research.paretosec.com',
  'research@pareto.no',
  'research@dnb.no',           // Add DNB
  'research@abgsc.no',          // Add ABG
],
```

## Security Considerations

1. **Change default password immediately** using the SQL command in Step 1
2. **Use strong JWT_SECRET** - generate with: `openssl rand -hex 32`
3. **Enable HTTPS** in production
4. **Restrict S3 bucket access** to only your application
5. **Use app-specific passwords** for email, never your main password
6. **Monitor access logs**:
   ```sql
   SELECT * FROM research_access_logs ORDER BY accessed_at DESC LIMIT 100;
   ```

## Troubleshooting

### Emails not being processed

Check email processor output:
```bash
node scripts/email-processor.js
```

Common issues:
- Wrong email credentials → Check `EMAIL_USER` and `EMAIL_PASSWORD`
- IMAP not enabled → Enable IMAP in email settings
- Wrong sender filter → Add correct sender to `senderFilters`

### Cannot access portal

1. Check database connection:
   ```bash
   psql $DATABASE_URL -c "SELECT COUNT(*) FROM research_documents;"
   ```

2. Check if token exists:
   ```sql
   SELECT * FROM research_access_tokens WHERE is_active = true;
   ```

3. Check browser console for errors

### Attachments not downloading

1. Check S3 credentials in `.env`
2. Verify bucket exists: `aws s3 ls s3://ineqre-research`
3. Check attachment record:
   ```sql
   SELECT * FROM research_attachments LIMIT 5;
   ```

## Advanced Configuration

### Add More Access Tokens

```sql
-- Generate hash first with bcrypt
INSERT INTO research_access_tokens (token_hash, description, is_active)
VALUES ('$2b$10$...', 'Secondary access token', true);
```

### Set Token Expiration

```sql
UPDATE research_access_tokens
SET expires_at = NOW() + INTERVAL '90 days'
WHERE id = 'token-uuid';
```

### View Processing Stats

```sql
-- Documents per source
SELECT source, COUNT(*) as count
FROM research_documents
GROUP BY source
ORDER BY count DESC;

-- Documents by month
SELECT
  DATE_TRUNC('month', received_date) as month,
  COUNT(*) as documents,
  SUM(attachment_count) as attachments
FROM research_documents
GROUP BY month
ORDER BY month DESC;

-- Recent downloads
SELECT
  d.subject,
  a.filename,
  l.accessed_at
FROM research_access_logs l
JOIN research_documents d ON l.document_id = d.id
JOIN research_attachments a ON d.id = a.document_id
WHERE l.action = 'download'
ORDER BY l.accessed_at DESC
LIMIT 20;
```

## Next Steps

1. **Email forwarding**: Set up email rules to forward Pareto emails to dedicated inbox
2. **Notifications**: Add Slack/email notifications when new research arrives
3. **Search**: Implement full-text search using the `search_vector` column
4. **Ticker linking**: Link documents to stock detail pages
5. **PDF viewer**: Add in-browser PDF viewing instead of download-only
6. **Multi-user**: Add proper user authentication system

## Support

For issues or questions:
- Check logs: `tail -f logs/email-processor.log`
- Database logs: Check PostgreSQL logs
- Application logs: Check Next.js console output
