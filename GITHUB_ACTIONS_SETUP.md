# GitHub Actions Setup Guide

This guide will help you set up automatic email imports using GitHub Actions (cloud-based, free).

## Benefits
- ✅ Runs every 30 minutes automatically
- ✅ Works even when your Mac is off
- ✅ Completely free (GitHub Actions is free for public repos, and has generous free tier for private repos)
- ✅ No need to keep your computer on

## Setup Steps

### 1. Get your Gmail App Password

You already have this in your `.env` file as `EMAIL_PASSWORD`. If you need a new one:

1. Go to https://myaccount.google.com/apppasswords
2. Create a new app password for "Mail"
3. Copy the 16-character password

### 2. Add Secrets to GitHub

Go to your GitHub repository:
1. Click **Settings** tab
2. Click **Secrets and variables** → **Actions**
3. Click **New repository secret**

Add these secrets (one at a time):

| Secret Name | Value |
|------------|-------|
| `DATABASE_URL` | Your Supabase database URL (from `.env`) |
| `SUPABASE_URL` | Your Supabase project URL (from `.env`) |
| `SUPABASE_SERVICE_ROLE_KEY` | Your Supabase service role key (from `.env`) |
| `EMAIL_USER` | Your Gmail address (from `.env`) |
| `EMAIL_PASSWORD` | Your Gmail app password (from `.env`) |

### 3. Push the workflow file to GitHub

```bash
cd /Users/olaslettebak/Documents/Intelligence_Equity_Research/code/InEqRe_OBX
git add .github/workflows/import-emails.yml
git commit -m "Add GitHub Actions workflow for email import"
git push
```

### 4. Enable GitHub Actions

1. Go to your repository on GitHub
2. Click the **Actions** tab
3. If prompted, click **I understand my workflows, go ahead and enable them**

### 5. Test it manually (optional)

1. Go to **Actions** tab
2. Click **Import Pareto Emails** workflow
3. Click **Run workflow** → **Run workflow**
4. Watch it run and check the logs

## How to Check Secrets

To see your current `.env` values (to copy to GitHub):

```bash
cd /Users/olaslettebak/Documents/Intelligence_Equity_Research/code/InEqRe_OBX
cat .env
```

Look for these values:
- `DATABASE_URL`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `EMAIL_USER`
- `EMAIL_PASSWORD`

## Schedule

The workflow runs:
- **Every 30 minutes** automatically
- Can also be triggered **manually** from the Actions tab

To change the schedule, edit `.github/workflows/import-emails.yml` and change this line:
```yaml
- cron: '*/30 * * * *'  # Every 30 minutes
```

Common schedules:
- `0 * * * *` - Every hour
- `0 9,16 * * *` - 9 AM and 4 PM daily
- `*/15 * * * *` - Every 15 minutes

## Monitoring

1. Go to **Actions** tab on GitHub
2. Click any workflow run to see logs
3. Check if emails are being imported

## Troubleshooting

**Workflow not running?**
- Make sure you enabled Actions in your repo settings
- Check that all secrets are set correctly

**Emails not importing?**
- Click on a workflow run and check the logs
- Make sure your Gmail app password is correct
- Check that EMAIL_USER and EMAIL_PASSWORD secrets are set

**Need to disable?**
- Delete `.github/workflows/import-emails.yml` or
- Disable the workflow in the Actions tab

## Current Status

- ✅ Workflow file created
- ⏳ Waiting for secrets to be added
- ⏳ Waiting for push to GitHub

Once you complete steps 2 and 3, it will start running automatically!
