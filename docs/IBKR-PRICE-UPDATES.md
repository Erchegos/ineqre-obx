# IBKR Price Updates

## Automatic Daily Updates

Stock prices from Interactive Brokers are now updated automatically every weekday at 6:00 PM (after Oslo Børs closes at 4:20 PM).

### Schedule
- **Time**: 6:00 PM Oslo time
- **Days**: Monday through Friday (weekdays only)
- **Stocks**: All tickers in the universe (OBX, EQNR, DNB, MOWI, etc.)

### How It Works

1. **IB Gateway**: Must be running and connected
   - The script connects to IB Gateway on port 4002
   - Falls back to TWS on port 4001 if Gateway is not available

2. **Launch Agent**: macOS launchd service runs the update automatically
   - Configuration: `~/Library/LaunchAgents/com.ineqre.ibkr-daily-update.plist`
   - Script: `scripts/update-prices-daily.sh`
   - Python script: `scripts/ibkr/daily-update.py`

3. **Logs**: Check logs for status
   - Main log: `logs/ibkr-launchd.log`
   - Error log: `logs/ibkr-launchd-error.log`
   - Update log: `logs/ibkr-update.log`

## Manual Updates

To manually update prices (useful for testing or if automatic update fails):

```bash
# From project root
export $(cat .env | grep -v '^#' | xargs) && python3 scripts/ibkr/daily-update.py
```

Or use the shell script:

```bash
./scripts/update-prices-daily.sh
```

## Check Price Status

To see what prices are currently in the database:

```bash
node scripts/check-prices.js
```

This shows:
- ✓ Latest data is today
- ○ Latest data is yesterday (normal - today's data comes after market close)
- ⚠️ Data is older than yesterday

## Troubleshooting

### No new prices after 6 PM

1. Check if IB Gateway is running:
   ```bash
   ps aux | grep -i gateway
   ```

2. Check the logs:
   ```bash
   tail -50 logs/ibkr-update.log
   ```

3. Verify launchd job is loaded:
   ```bash
   launchctl list | grep ineqre
   ```

4. Manually run the update to see errors:
   ```bash
   ./scripts/update-prices-daily.sh
   ```

### Failed tickers

Some tickers may fail if:
- They're not available on IBKR
- The symbol needs to be updated in the script
- Trading is suspended

Current known issues:
- SUBSEA, KAHOT, GOGL, PGS, XXL - not found on IBKR with current symbols

## Configuration

### Update the ticker list

Edit [scripts/ibkr/daily-update.py](../scripts/ibkr/daily-update.py:16):

```python
TICKERS = [
    "OBX", "EQNR", "DNB", "MOWI", "NHY", "TEL", "YAR", "AKER",
    "SALM", "ORK", "AKRBP", "STB", "SUBSEA", "KAHOT", "GOGL",
    "MPCC", "PGS", "XXL", "SCATC", "GJF", "TGS"
]
```

### Change update time

Edit `~/Library/LaunchAgents/com.ineqre.ibkr-daily-update.plist` and change:

```xml
<key>Hour</key>
<integer>18</integer>  <!-- 6 PM -->
<key>Minute</key>
<integer>0</integer>
```

Then reload:

```bash
launchctl unload ~/Library/LaunchAgents/com.ineqre.ibkr-daily-update.plist
launchctl load ~/Library/LaunchAgents/com.ineqre.ibkr-daily-update.plist
```

## Status Check (Today)

Last manual update run: 2026-01-22 at 5:29 PM
- ✓ Successfully updated 16/21 tickers
- Latest data: 2026-01-21 (yesterday's closing prices)
- Next automatic update: Today at 6:00 PM
