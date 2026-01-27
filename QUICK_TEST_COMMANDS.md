# Quick Test Commands for FX Module

## Check if FX fetch is done

```bash
ps aux | grep "fetch-fx-rates" | grep -v grep
```

If nothing shows, it's done.

## Check how much data we have

```bash
psql "postgresql://postgres.gznnailatxljhfadbwxr:Su.201712949340@aws-1-us-east-1.pooler.supabase.com:6543/postgres?sslmode=require" -c "SELECT currency_pair, COUNT(*) as days, MIN(date) as start, MAX(date) as end FROM fx_spot_rates WHERE source = 'norges_bank' GROUP BY currency_pair ORDER BY currency_pair;"
```

## Test the API

```bash
curl -s 'http://localhost:3000/api/fx-pairs?pair=NOKUSD&days=252' | jq '.dataPoints, .volatility'
```

## View the dashboard

Open: http://localhost:3000/fx-pairs

## Fix colors for dark mode

The page currently uses hardcoded colors. Once data is loading properly, I'll update all inline styles to use CSS variables like:
- `var(--background)` instead of `#ffffff`
- `var(--foreground)` instead of `#0a0a0a`
- `var(--card-bg)` instead of `#fff`
- `var(--border)` instead of `#dee2e6`
- `var(--accent)` instead of `#3498db`

## Get real IBKR data (when gateway is properly configured)

The IB Gateway needs to be accessible on port 5000 or you need to configure the correct port in the script.

Check IBKR gateway status:
```bash
curl -k https://localhost:5000/v1/api/tickle
```

If that works, then run:
```bash
export DATABASE_URL="postgresql://postgres.gznnailatxljhfadbwxr:Su.201712949340@aws-1-us-east-1.pooler.supabase.com:6543/postgres?sslmode=require"
npx tsx scripts/fx/fetch-fx-rates.ts --backfill 365
```
