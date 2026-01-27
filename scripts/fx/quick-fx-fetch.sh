#!/bin/bash

# Quick FX data fetch from Norges Bank
# Fetches 1 year of historical data

export DATABASE_URL="postgresql://postgres.gznnailatxljhfadbwxr:Su.201712949340@aws-1-us-east-1.pooler.supabase.com:6543/postgres?sslmode=require"

echo "Fetching FX rates from Norges Bank..."
echo "This will take about 30 seconds..."

npx tsx scripts/fx/fetch-fx-rates-fixer.ts --backfill 365

echo ""
echo "Verifying data..."
psql "$DATABASE_URL" -c "SELECT currency_pair, COUNT(*) as days, MIN(date) as start, MAX(date) as end FROM fx_spot_rates WHERE source = 'norges_bank' GROUP BY currency_pair ORDER BY currency_pair;"
