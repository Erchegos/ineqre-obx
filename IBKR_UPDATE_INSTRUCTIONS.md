# IBKR Price Data Update Instructions

## Current Status

- **IBKR data**: Last updated 2026-01-16
- **YFinance data**: Updated through 2026-01-20 (fallback source)
- **Application**: Currently configured to use IBKR data only

## To Update IBKR Prices

### Prerequisites
1. IB Gateway must be running on `https://localhost:5000`
2. You must be logged in to your Interactive Brokers account
3. Market data subscriptions must be active

### Steps to Update

1. **Start IB Gateway** (if not already running)
   - Launch IB Gateway application
   - Log in with your credentials
   - Ensure it's running on port 5000

2. **Run the Update Script**
   ```bash
   cd /Users/olaslettebak/Documents/Intelligence_Equity_Research/code/InEqRe_OBX
   pnpm --filter web ibkr:update
   ```

3. **The script will:**
   - Connect to IB Gateway at `https://localhost:5000`
   - Connect to your production database
   - Fetch the last 5 days of data for each ticker
   - Update the `prices_daily` table with source='ibkr'
   - Show progress for each ticker

### Expected Output
```
=== IBKR Daily Update ===
Time: 2026-01-20T...

✓ IBKR Gateway connected
✓ Database connected

[AFG] Updating...
[AFG] ✓ Updated: 2026-01-20
[AKER] Updating...
[AKER] ✓ Updated: 2026-01-20
...

=== Update Summary ===
✓ Successful: 52/52
✗ Failed: 0/52
```

## Alternative: Use YFinance Data

If you want to temporarily use YFinance data (which is already up-to-date):

The queries have been reverted to use `source = 'ibkr'` only. To switch to accepting any source:

1. Remove the `WHERE p.source = 'ibkr'` filter from:
   - `apps/web/src/app/page.tsx` (line 18)
   - `apps/web/src/app/stocks/page.tsx` (line 35)

## Troubleshooting

### IB Gateway Not Running
```
Error: IBKR Gateway not responding at https://localhost:5000
```
**Solution**: Start IB Gateway and ensure it's accessible

### Connection Timeout
```
Error: connect ECONNREFUSED ::1:5000
```
**Solution**: Check IB Gateway is running and listening on port 5000

### Contract Not Found
```
Error: Contract not found
```
**Solution**: Verify the ticker symbol is correct for OSE exchange

## Automation (Optional)

To run this automatically every day, you can:

1. **Use cron** (macOS/Linux):
   ```bash
   # Edit crontab
   crontab -e

   # Add this line to run at 6 PM every weekday
   0 18 * * 1-5 cd /Users/olaslettebak/Documents/Intelligence_Equity_Research/code/InEqRe_OBX && pnpm --filter web ibkr:update
   ```

2. **Use GitHub Actions** (if deploying):
   - Set up a scheduled workflow
   - Connect to IB Gateway via secure tunnel
   - Run the update script on schedule
