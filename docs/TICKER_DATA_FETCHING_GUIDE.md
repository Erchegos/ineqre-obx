# Ticker Data Fetching Guide - Interactive Brokers Gateway

## Overview
This guide outlines the critical data points, structure, and process for fetching new ticker data from Interactive Brokers (IB) Gateway into the InEqRe system.

---

## 1. CRITICAL DATA FIELDS

### A. Stock Master Data (stocks table)
```typescript
{
  ticker: string;        // Primary identifier (e.g., "EQNR", "DNB")
  name: string;          // Full company name (e.g., "Equinor ASA")
  isin?: string;         // International Securities ID
  sector: string;        // Business sector classification (REQUIRED)
  currency: string;      // Trading currency (default: "NOK")
  exchange: string;      // Exchange code (default: "OSE")
  asset_type: string;    // equity | index | commodity_etf | index_etf
  is_active: boolean;    // Trading status
}
```

### B. Daily Price Data (prices_daily table)
```typescript
{
  ticker: string;        // Foreign key to stocks
  date: string;          // Format: YYYYMMDD (e.g., "20260127")
  open: number;          // Opening price (raw)
  high: number;          // Daily high (raw)
  low: number;           // Daily low (raw)
  close: number;         // Closing price RAW/UNADJUSTED (REQUIRED)
  volume: number;        // Trading volume (integer)
  adj_close: number;     // ADJUSTED close for splits/dividends (REQUIRED)
  source: string;        // "ibkr" for IB Gateway data
}
```

**CRITICAL:** Always store BOTH raw and adjusted prices:
- `close`: Raw unadjusted closing price
- `adj_close`: Dividend and split adjusted price

**Frontend should ALWAYS use `adj_close` for calculations** to get accurate returns and performance metrics.

---

## 2. SECTOR CLASSIFICATION REQUIREMENTS

**CRITICAL:** Before fetching, determine the correct sector for each ticker.

### Available Sectors:
1. **Energy** - Oil & gas, energy services, seismic data
2. **Finance** - Banks, insurance companies
3. **Shipping** - Shipping companies, offshore, tankers, bulkers, drilling
4. **Seafood** - Salmon farming, aquaculture equipment
5. **Technology** - IT consulting, software, semiconductors, telecom
6. **Industrial** - Manufacturing, construction, engineering, chemicals, metals
7. **Real Estate** - Property companies
8. **Consumer** - Retail, airlines, consumer services
9. **Healthcare** - Pharma, biotech, medical devices
10. **Materials** - Raw materials, silicon production
11. **Renewable Energy** - Solar, hydrogen, clean energy
12. **Investment** - Pure holding companies (ONLY if diversified portfolio)
13. **Index** - Market indices
14. **Commodities** - Commodity ETFs

### Classification Rules:
- **Research the company first** - Check company website, investor relations
- **Primary business activity** determines sector (not holdings)
- **Shipping companies** include: tankers, bulkers, offshore vessels, drilling rigs
- **Industrial** includes: construction, engineering consulting, manufacturing
- **Technology** includes: IT services, software, semiconductors, telecom
- **Investment** is ONLY for diversified holding companies (not single-sector holdings)

---

## 3. IB GATEWAY FETCH STRUCTURE

### A. Connection Setup
```typescript
import { TWSClient } from "@ineqre/ibkr";
import { SecType } from "@stoqey/ib";

const client = new TWSClient();
await client.connect();
```

### B. Historical Data Request Parameters
```typescript
const adjustedData = await client.getHistoricalData(
  ticker: string,        // "EQNR", "DNB", etc.
  exchange: string,      // "OSE" for Oslo Stock Exchange
  duration: string,      // "10 Y" = 10 years, "5 Y" = 5 years
  barSize: string,       // "1 day" for daily data
  secType: SecType,      // SecType.STK for stocks
  currency: string,      // "NOK" for Norwegian stocks
  adjusted: boolean      // true = ADJUSTED_LAST (default), false = TRADES
);
```

**CRITICAL:** Always fetch BOTH adjusted and raw prices:
```typescript
// 1. Fetch adjusted prices (dividend/split adjusted)
const adjustedData = await client.getHistoricalData(
  ticker, exchange, "10 Y", "1 day", SecType.STK, "NOK", true
);

// 2. Fetch raw prices (unadjusted)
const rawData = await client.getHistoricalData(
  ticker, exchange, "10 Y", "1 day", SecType.STK, "NOK", false
);

// 3. Store both in database:
//    - close = rawData[i].close
//    - adj_close = adjustedData[i].close
```

### C. Recommended Fetch Parameters

#### For New Norwegian Stocks (OSE):
```typescript
{
  exchange: "OSE",
  duration: "10 Y",      // Fetch maximum history
  barSize: "1 day",
  secType: SecType.STK,
  currency: "NOK"
}
```

#### For International Indices/ETFs:
```typescript
{
  exchange: "SMART",     // IB Smart routing
  duration: "10 Y",
  barSize: "1 day",
  secType: SecType.IND,  // For indices
  currency: "USD"        // Or appropriate currency
}
```

---

## 4. DATA VALIDATION CHECKLIST

Before inserting data into database:

- [ ] **Ticker exists** - Verify ticker is correct
- [ ] **Company name** - Full legal name from IB
- [ ] **Sector classification** - MUST be assigned (research company)
- [ ] **Minimum data points** - At least 100 daily bars
- [ ] **Date format** - YYYYMMDD format (e.g., "20260127")
- [ ] **Price validity** - Close > 0 for all records
- [ ] **Volume format** - Integer (not decimal)
- [ ] **Currency match** - Currency matches exchange
- [ ] **No duplicates** - Check for existing ticker before insert
- [ ] **Adjusted close** - Set to close price if no split/dividend data

---

## 5. DATABASE INSERT STRUCTURE

### A. Insert Stock Master Record
```sql
INSERT INTO stocks (ticker, name, sector, exchange, currency, asset_type)
VALUES ($1, $2, $3, $4, $5, $6)
ON CONFLICT (ticker) DO UPDATE SET
  name = EXCLUDED.name,
  sector = EXCLUDED.sector;
```

### B. Insert Daily Price Data
```sql
INSERT INTO prices_daily (
  ticker, date, open, high, low, close, volume, adj_close, source
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'ibkr')
ON CONFLICT (ticker, date, source) DO UPDATE SET
  open = EXCLUDED.open,
  high = EXCLUDED.high,
  low = EXCLUDED.low,
  close = EXCLUDED.close,
  volume = EXCLUDED.volume,
  adj_close = EXCLUDED.adj_close;
```

---

## 6. FETCHING WORKFLOW

### Step 1: Research Phase
```bash
# 1. Identify new tickers to add
# 2. Research each company:
#    - Company website
#    - Investor relations
#    - Business description
# 3. Determine correct sector classification
# 4. Note: exchange, currency, asset_type
```

### Step 2: Prepare Ticker List
```typescript
const newTickers = [
  {
    ticker: "EXAMPLE",
    name: "Example Company ASA",
    sector: "Technology",  // MUST BE DETERMINED
    exchange: "OSE",
    currency: "NOK",
    asset_type: "equity"
  },
  // ... more tickers
];
```

### Step 3: Fetch Data
```typescript
// Use scripts/import-new-stocks.ts or similar
for (const stock of newTickers) {
  console.log(`Fetching ${stock.ticker}...`);

  // 1. Connect to IB Gateway
  // Fetch ADJUSTED prices (dividend/split adjusted)
  const adjustedData = await client.getHistoricalData(
    stock.ticker,
    stock.exchange,
    "10 Y",
    "1 day",
    SecType.STK,
    stock.currency,
    true  // ADJUSTED
  );

  // Fetch RAW prices (unadjusted)
  const rawData = await client.getHistoricalData(
    stock.ticker,
    stock.exchange,
    "10 Y",
    "1 day",
    SecType.STK,
    stock.currency,
    false  // RAW
  );

  // 2. Insert stock master record
  await insertStock(stock);

  // 3. Insert daily price data with BOTH raw and adjusted
  for (let i = 0; i < rawData.length; i++) {
    const rawBar = rawData[i];
    const adjBar = adjustedData.find(b => b.time === rawBar.time);

    await pool.query(`
      INSERT INTO prices_daily (ticker, date, open, high, low, close, volume, adj_close, source)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'ibkr')
      ON CONFLICT (ticker, date, source) DO UPDATE SET
        open = EXCLUDED.open,
        high = EXCLUDED.high,
        low = EXCLUDED.low,
        close = EXCLUDED.close,  -- Raw close
        volume = EXCLUDED.volume,
        adj_close = EXCLUDED.adj_close  -- Adjusted close
    `, [
      stock.ticker,
      rawBar.time.replace(/-/g, ''),
      rawBar.open,
      rawBar.high,
      rawBar.low,
      rawBar.close,      // Raw close
      Math.round(rawBar.volume),
      adjBar?.close || rawBar.close  // Adjusted close
    ]);
  }

  // 4. Rate limiting (1000ms between requests to fetch both)
  await sleep(1000);
}
```

### Step 4: Verification
```bash
# 1. Check data was inserted
npx tsx scripts/check-sectors.ts

# 2. Verify data quality
SELECT ticker, name, sector,
       COUNT(*) as rows,
       MIN(date) as start_date,
       MAX(date) as end_date
FROM stocks s
JOIN prices_daily p ON s.ticker = p.ticker
WHERE s.ticker IN ('NEW_TICKER_1', 'NEW_TICKER_2')
GROUP BY s.ticker, s.name, s.sector;

# 3. Update latest prices
npx tsx scripts/update-latest-prices.ts
```

---

## 7. COMMON ISSUES & SOLUTIONS

### Issue: "No security definition found"
**Solution:** Check ticker symbol, exchange code, or try SMART routing

### Issue: Incorrect sector classification
**Solution:** Run sector fix script:
```typescript
// scripts/fix-sector-classifications.ts
const corrections = [
  { ticker: 'TICKER', sector: 'CorrectSector', note: 'Reason' }
];
```

### Issue: Missing adjusted close data
**Solution:** Set adj_close = close for stocks without split/dividend history

### Issue: Volume as decimal
**Solution:** Round to integer: `Math.round(bar.volume)`

---

## 8. MAINTENANCE SCRIPTS

### Daily Price Updates
```bash
# Updates last 10 days for all tickers
npx tsx scripts/update-latest-prices.ts
```

### Sector Verification
```bash
# Shows all companies grouped by sector
npx tsx scripts/check-sectors.ts
```

### Sector Corrections
```bash
# Fix misclassified sectors
npx tsx scripts/fix-sector-classifications.ts
```

---

## 9. ASSET TYPE CLASSIFICATIONS

### Equity (asset_type = 'equity')
- Norwegian companies traded on OSE
- Standard stocks with dividends
- **Default for most Norwegian tickers**

### Index (asset_type = 'index')
- OBX, OSEBX, OSEAX (Norwegian indices)
- SPX, NDX, DAX, ESTX50 (International indices)
- Used for benchmark comparisons

### Commodity ETF (asset_type = 'commodity_etf')
- GLD, SLV, USO, DBC, DBB
- COPX, XLE, XOP
- Physical commodity tracking

### Index ETF (asset_type = 'index_etf')
- SPY, QQQ, IWM, VGK, EFA
- Index tracking ETFs

---

## 10. QUICK REFERENCE CHECKLIST

When adding new tickers, always:

1. ✅ Research company business (website, IR)
2. ✅ Determine correct sector (see section 2)
3. ✅ Verify exchange and currency
4. ✅ Fetch maximum historical data (10Y)
5. ✅ Validate data quality (>100 rows, close > 0)
6. ✅ Insert with correct asset_type
7. ✅ Run verification scripts
8. ✅ Update sector mapping in update-sectors.ts
9. ✅ Test in UI (asset list, correlation matrix)
10. ✅ Commit changes with descriptive message

---

## EXAMPLE: Adding a New Ticker

```typescript
// 1. Research
// Company: Aker Carbon Capture ASA
// Ticker: ACC
// Business: Carbon capture technology
// Sector: Renewable Energy (clean tech)

// 2. Fetch
const client = new TWSClient();
await client.connect();

const data = await client.getHistoricalData(
  "ACC",
  "OSE",
  "5 Y",  // Company is newer
  "1 day",
  SecType.STK,
  "NOK"
);

// 3. Insert
await pool.query(`
  INSERT INTO stocks (ticker, name, sector, exchange, currency, asset_type)
  VALUES ('ACC', 'Aker Carbon Capture ASA', 'Renewable Energy', 'OSE', 'NOK', 'equity')
`);

// 4. Insert price data (loop through data)
// 5. Update scripts/update-sectors.ts with mapping
// 6. Verify and commit
```

---

## Contact & Updates

For questions or updates to this guide, see:
- IB Gateway docs: packages/ibkr/README.md
- Database schema: packages/db/src/schema/
- Example scripts: scripts/examples/

**Last Updated:** 2026-01-27
