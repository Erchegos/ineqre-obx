#!/bin/bash

# Script to set up automatic email processing with cron
# This will run the email processor every 15 minutes

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
LOG_DIR="$PROJECT_DIR/logs"

# Create logs directory if it doesn't exist
mkdir -p "$LOG_DIR"

# Cron entry
CRON_CMD="*/15 * * * * cd $PROJECT_DIR && /usr/local/bin/node scripts/email-processor.js >> $LOG_DIR/email-processor.log 2>&1"

echo "Setting up automatic email processing..."
echo ""
echo "This will add the following cron job:"
echo "$CRON_CMD"
echo ""
echo "This means:"
echo "- Email processor will run every 15 minutes"
echo "- New research emails will be imported automatically"
echo "- PDFs will be downloaded and stored"
echo "- Logs will be saved to: $LOG_DIR/email-processor.log"
echo ""
read -p "Do you want to add this cron job? (y/n) " -n 1 -r
echo

if [[ $REPLY =~ ^[Yy]$ ]]
then
    # Add to crontab
    (crontab -l 2>/dev/null; echo "$CRON_CMD") | crontab -
    echo "✓ Cron job added successfully!"
    echo ""
    echo "To view your cron jobs:"
    echo "  crontab -l"
    echo ""
    echo "To remove the cron job:"
    echo "  crontab -e"
    echo "  (then delete the line with 'email-processor.js')"
    echo ""
    echo "To view logs:"
    echo "  tail -f $LOG_DIR/email-processor.log"
else
    echo "Cron job not added."
    echo ""
    echo "You can run the email processor manually:"
    echo "  cd $PROJECT_DIR"
    echo "  node scripts/email-processor.js"
fi
