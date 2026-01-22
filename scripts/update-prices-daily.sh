#!/bin/bash
# Daily price update script for IBKR
# Run this after market close (6 PM Oslo time)

cd /Users/olaslettebak/Documents/Intelligence_Equity_Research/code/InEqRe_OBX

# Create logs directory if it doesn't exist
mkdir -p logs

# Load environment variables and run Python script
export $(cat .env | grep -v '^#' | xargs)
/usr/local/bin/python3 scripts/ibkr/daily-update.py >> logs/ibkr-update.log 2>&1

# Log completion
echo "$(date): Price update completed" >> logs/ibkr-update.log
