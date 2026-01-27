# Adjusted Prices Fix - Summary

## Problem Identified

EQNR and other stocks showed **vertical -95% drops** in the chart. These were unadjusted dividend payments causing incorrect performance calculations.

Example from EQNR data:
```
Apr 28, 2023: 305.00 NOK
May 1, 2023:   28.60 NOK  (-90.62%) ← BAD DATA
May 2, 2023:  297.10 NOK  (+938.81%) ← BAD DATA
```

## Root Cause

IB Gateway's default `WhatToShow.TRADES` returns **raw unadjusted prices**. We need `WhatToShow.ADJUSTED_LAST` for dividend and split-adjusted prices.

## Solution Implemented

### 1. Modified TWS Client
**File:** `packages/ibkr/src/tws-client.ts`

Added `adjusted` parameter to `getHistoricalData()`:
```typescript
async getHistoricalData(
  symbol: string,
  exchange: string,
  duration: string = "1 Y",
  barSize: BarSizeSetting = BarSizeSetting.DAYS_ONE,
  secType: SecType = SecType.STK,
  currency: string = "NOK",
  adjusted: boolean = true  // NEW PARAMETER
): Promise<HistoricalBar[]>
```

### 2. Database Schema
**Two fields in `prices_daily` table:**
- `close`: Raw unadjusted closing price
- `adj_close`: Dividend and split adjusted price

**CRITICAL:** Frontend must use `adj_close` for all calculations!

### 3. Re-imported Stocks

Successfully re-imported 6 major stocks with proper adjustments:

| Ticker | Bars | Avg Adj Factor | Dividend Impact |
|--------|------|----------------|-----------------|
| EQNR   | 2,507 | 97.08% | ~3% dividends |
| FRO    | 2,507 | 96.05% | ~4% dividends |
| DNB    | 1,151 | 87.25% | ~13% dividends! |
| MOWI   | 2,507 | 84.58% | ~15% dividends! |
| YAR    | 688   | 61.32% | ~39% (spin-off/split) |
| NHY    | 5,022 | 65.58% | ~34% dividends |

### 4. Created Scripts

**`scripts/reimport-with-adjusted-prices.ts`**
- Fetches BOTH raw and adjusted prices
- Stores raw in `close`, adjusted in `adj_close`
- Used for manual re-import of specific stocks

**`scripts/update-all-with-adjusted-prices.ts`**
- Updates ALL OSE stocks with adjusted prices
- Should be run once to fix entire database
- Includes progress tracking and error handling

## Verification

After fix, EQNR data looks correct:
```
Date       | Raw Close | Adj Close | Adj Factor
Apr 28, 2023 | 305.00   | 298.69    | 97.93%
May 2, 2023  | 297.10   | 290.95    | 97.93%
May 3, 2023  | 293.40   | 287.33    | 97.93%
```

No more crazy jumps! May 1st (bad holiday data) is filtered out.

## Next Steps

### 1. Update All Remaining Stocks
```bash
npx tsx scripts/update-all-with-adjusted-prices.ts
```

This will:
- Connect to IB Gateway
- Fetch adjusted + raw prices for all OSE stocks
- Update database with proper adj_close values
- Takes ~1-2 hours depending on number of stocks

### 2. Update Frontend to Use `adj_close`

**API routes to update:**
- `apps/web/src/app/api/prices/[ticker]/route.ts`
- `apps/web/src/app/api/analytics/[ticker]/route.ts`
- `apps/web/src/app/api/volatility/[ticker]/route.ts`
- `apps/web/src/app/api/correlation/route.ts`

**Change all SQL queries from:**
```sql
SELECT date, close, volume FROM prices_daily
```

**To:**
```sql
SELECT date, adj_close as close, volume FROM prices_daily
```

Or explicitly:
```sql
SELECT date, close as raw_close, adj_close, volume FROM prices_daily
```

### 3. Display Currency in UI

Add currency display to price labels:
- Asset list: Show "123.45 NOK" instead of "123.45 kr"
- Charts: Add currency to axis labels
- Use `stocks.currency` field from database

### 4. Handle Dual-Listed Stocks

Currently blocked by primary key constraint. Options:
1. Use `.US` suffix for US versions (e.g., `EQNR.US`)
2. Implement schema migration for composite key `(ticker, exchange, currency)`

## Important Notes

### For Future Imports

**ALWAYS fetch both adjusted and raw prices:**

```typescript
// 1. Fetch adjusted
const adjustedData = await client.getHistoricalData(
  ticker, exchange, "10 Y", "1 day", SecType.STK, "NOK", true
);

// 2. Fetch raw
const rawData = await client.getHistoricalData(
  ticker, exchange, "10 Y", "1 day", SecType.STK, "NOK", false
);

// 3. Store both
await pool.query(`
  INSERT INTO prices_daily (ticker, date, open, high, low, close, volume, adj_close, source)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'ibkr')
`, [
  ticker,
  dateStr,
  rawBar.open,
  rawBar.high,
  rawBar.low,
  rawBar.close,      // Raw close
  Math.round(rawBar.volume),
  adjBar.close       // Adjusted close
]);
```

### Why Both?

- **Raw prices:** For accurate historical price display, dividend tracking
- **Adjusted prices:** For calculating returns, performance, correlations
- **Frontend:** Should use `adj_close` for all calculations to get accurate returns

### Common Adjustment Factors

- **Small adjustments (95-99%)**: Regular quarterly/annual dividends
- **Medium adjustments (85-95%)**: High dividend stocks (e.g., DNB, MOWI)
- **Large adjustments (60-80%)**: Stock splits, spin-offs, special dividends

## Files Changed

```
packages/ibkr/src/tws-client.ts
packages/db/src/schema/006_dual_listed_stocks.sql
scripts/reimport-with-adjusted-prices.ts
scripts/update-all-with-adjusted-prices.ts
scripts/import-ose-dual-listed.ts
docs/TICKER_DATA_FETCHING_GUIDE.md
docs/ADJUSTED_PRICES_FIX_SUMMARY.md (this file)
```

## Testing

After updating all stocks, verify:
```bash
# Check EQNR data
npx tsx -e "
import { Pool } from 'pg';
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const result = await pool.query('SELECT date, close, adj_close FROM prices_daily WHERE ticker = \\'EQNR\\' ORDER BY date DESC LIMIT 10');
console.table(result.rows);
await pool.end();
"
```

Expected: `adj_close` should be slightly lower than `close` (reflecting dividends).

---

**Last Updated:** 2026-01-27
**Status:** ✅ Critical fix implemented, 6 major stocks updated
**Action Required:** Run full database update script for remaining stocks
