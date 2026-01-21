#!/bin/bash

echo "=== Email Import Automation Setup ==="
echo ""
echo "This will set up automatic email imports from Pareto Securities"
echo ""

# Get the absolute path to the project
PROJECT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )/.." && pwd )"
echo "Project directory: $PROJECT_DIR"
echo ""

# Find node path
NODE_PATH=$(which node)
echo "Node path: $NODE_PATH"
echo ""

# Create logs directory if it doesn't exist
mkdir -p "$PROJECT_DIR/logs"

# Show options
echo "Choose automation schedule:"
echo "1) Every hour (recommended)"
echo "2) Every 30 minutes"
echo "3) 9 AM daily"
echo "4) 9 AM and 4 PM daily"
echo "5) Custom (you'll edit crontab manually)"
echo ""
read -p "Enter choice (1-5): " CHOICE

case $CHOICE in
  1)
    CRON_SCHEDULE="0 * * * *"
    DESCRIPTION="every hour"
    ;;
  2)
    CRON_SCHEDULE="*/30 * * * *"
    DESCRIPTION="every 30 minutes"
    ;;
  3)
    CRON_SCHEDULE="0 9 * * *"
    DESCRIPTION="at 9 AM daily"
    ;;
  4)
    CRON_SCHEDULE="0 9,16 * * *"
    DESCRIPTION="at 9 AM and 4 PM daily"
    ;;
  5)
    echo ""
    echo "Opening crontab for manual editing..."
    echo "Add this line:"
    echo "0 * * * * cd $PROJECT_DIR && $NODE_PATH scripts/email-processor.js >> logs/email-import.log 2>&1"
    echo ""
    read -p "Press enter to open crontab..."
    crontab -e
    exit 0
    ;;
  *)
    echo "Invalid choice"
    exit 1
    ;;
esac

# Create the cron job
CRON_JOB="$CRON_SCHEDULE cd $PROJECT_DIR && $NODE_PATH scripts/email-processor.js >> logs/email-import.log 2>&1"

# Check if cron job already exists
if crontab -l 2>/dev/null | grep -F "email-processor.js" > /dev/null; then
  echo ""
  echo "⚠️  A cron job for email-processor.js already exists!"
  echo ""
  crontab -l | grep "email-processor.js"
  echo ""
  read -p "Do you want to replace it? (y/n): " REPLACE
  if [ "$REPLACE" != "y" ]; then
    echo "Cancelled"
    exit 0
  fi
  # Remove old cron job
  crontab -l | grep -v "email-processor.js" | crontab -
fi

# Add the new cron job
(crontab -l 2>/dev/null; echo "$CRON_JOB") | crontab -

echo ""
echo "✅ Automation set up successfully!"
echo "   Schedule: $DESCRIPTION"
echo ""
echo "📝 Your cron jobs:"
crontab -l
echo ""
echo "📊 To view logs:"
echo "   tail -f $PROJECT_DIR/logs/email-import.log"
echo ""
echo "🧪 To test manually:"
echo "   cd $PROJECT_DIR && node scripts/email-processor.js"
echo ""
