#!/bin/bash
#
# Email monitoring script for Pareto Securities research emails
# This script should be run periodically (e.g., every 15 minutes via cron)
#

cd "$(dirname "$0")/.."

echo "[$(date)] Starting email import..."
node scripts/email-processor.js >> logs/email-monitor.log 2>&1

if [ $? -eq 0 ]; then
    echo "[$(date)] Email import completed successfully"
else
    echo "[$(date)] Email import failed with exit code $?"
fi
