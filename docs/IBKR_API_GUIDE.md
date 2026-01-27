# IBKR API Integration Guide

Complete guide for using the IBKR TWS API wrapper to import market data.

## Overview

The IBKR API integration provides a production-ready wrapper around Interactive Brokers TWS/Gateway API for fetching historical market data.

## Setup

### 1. IB Gateway Configuration

1. Download and install IB Gateway from Interactive Brokers
2. Launch IB Gateway and log in
3. Go to **Edit > Global Configuration > API > Settings**
4. Enable **Enable ActiveX and Socket Clients**
5. Set **Socket port** to **4002** (or 4001 for TWS)
6. Add **127.0.0.1** to trusted IPs
7. **Enable** "Allow connections from localhost only"

### 2. Verify Connection

```bash
npx tsx scripts/test-ibkr-tws.ts
```

Expected output:
```
Testing IBKR TWS API connection...
Connecting to IB Gateway on port 4002...
[OK] Connected to IB Gateway
[INFO] Server version: 193
[INFO] Managed accounts: U12345678
[SUCCESS] IBKR Gateway is properly configured and accessible
```

## API Reference

### TWSClient Class

Main client for interacting with IBKR.

#### Basic Usage

```typescript
import { TWSClient, SecType } from "@/packages/ibkr/src";

const client = new TWSClient();
await client.connect();

// Fetch historical data
const data = await client.importAsset("AAPL", "SMART", "1 Y", {
  secType: SecType.STK,
  currency: "USD",
});

await client.disconnect();
```

#### Configuration Options

```typescript
const client = new TWSClient({
  clientId: 100,              // Unique client ID (default: random)
  host: "127.0.0.1",          // IB Gateway host
  port: 4002,                 // IB Gateway port
  connectionTimeout: 5000,    // Connection timeout in ms
  requestTimeout: 30000,      // Request timeout in ms
});
```

### Methods

#### `connect(): Promise<void>`

Connect to IB Gateway. Must be called before making requests.

```typescript
await client.connect();
```

#### `disconnect(): Promise<void>`

Disconnect from IB Gateway.

```typescript
await client.disconnect();
```

#### `getHistoricalData()`

Fetch historical bars for a single symbol.

```typescript
const bars = await client.getHistoricalData(
  "AAPL",                        // symbol
  "SMART",                       // exchange
  "1 Y",                         // duration
  BarSizeSetting.DAYS_ONE,      // bar size
  SecType.STK,                  // security type
  "USD"                         // currency
);
```

**Duration strings:**
- `"1 D"` - 1 day
- `"1 W"` - 1 week
- `"1 M"` - 1 month
- `"3 M"` - 3 months
- `"6 M"` - 6 months
- `"1 Y"` - 1 year
- `"2 Y"` - 2 years
- `"5 Y"` - 5 years
- `"10 Y"` - 10 years

**Bar sizes:**
- `BarSizeSetting.SECS_ONE` - 1 second
- `BarSizeSetting.SECS_FIVE` - 5 seconds
- `BarSizeSetting.MINS_ONE` - 1 minute
- `BarSizeSetting.MINS_FIVE` - 5 minutes
- `BarSizeSetting.MINS_FIFTEEN` - 15 minutes
- `BarSizeSetting.HOURS_ONE` - 1 hour
- `BarSizeSetting.DAYS_ONE` - 1 day (default)

**Security types:**
- `SecType.STK` - Stock
- `SecType.IND` - Index
- `SecType.FUT` - Future
- `SecType.OPT` - Option
- `SecType.FOP` - Future option
- `SecType.CASH` - Forex
- `SecType.CFD` - Contract for difference

#### `importAsset()`

Fetch and convert historical data for database insertion.

```typescript
const priceData = await client.importAsset(
  "EQNR",    // symbol
  "OSE",     // exchange
  "5 Y",     // duration
  {
    secType: SecType.STK,
    currency: "NOK",
  }
);

// Returns array of:
// [{ ticker: "EQNR", date: "2021-01-15", open: 150.5, high: 152.0, low: 149.5, close: 151.0, volume: 1000000 }]
```

#### `importAssets()`

Import multiple assets with rate limiting.

```typescript
const results = await client.importAssets(
  [
    { symbol: "AAPL", exchange: "SMART", currency: "USD" },
    { symbol: "GOOGL", exchange: "SMART", currency: "USD" },
    { symbol: "MSFT", exchange: "SMART", currency: "USD" },
  ],
  {
    duration: "1 Y",
    delayMs: 200, // 200ms delay between requests
  }
);

// Returns Map<string, PriceData[]>
for (const [ticker, data] of results.entries()) {
  console.log(`${ticker}: ${data.length} data points`);
}
```

### Helper Functions

#### `createTWSClient()`

Create and connect client in one step.

```typescript
const client = await createTWSClient({ port: 4002 });
// Client is already connected
```

#### `fetchHistoricalData()`

One-off data fetch with automatic connection management.

```typescript
const data = await fetchHistoricalData("AAPL", "SMART", "1 Y");
// Automatically connects and disconnects
```

## Exchange Codes

### Common Exchanges

- `SMART` - IBKR Smart routing (recommended for US stocks)
- `NYSE` - New York Stock Exchange
- `NASDAQ` - NASDAQ
- `ARCA` - NYSE Arca
- `OSE` - Oslo Børs (Norway)
- `SFB` - Stockholm (Sweden)
- `CPH` - Copenhagen (Denmark)
- `LSE` - London Stock Exchange
- `IBIS` - Frankfurt (Germany)

### Currency Codes

- `USD` - US Dollar
- `NOK` - Norwegian Krone
- `SEK` - Swedish Krona
- `DKK` - Danish Krone
- `EUR` - Euro
- `GBP` - British Pound

## Examples

### Example 1: Import Single US Stock

```typescript
import { TWSClient, SecType } from "@/packages/ibkr/src";

const client = new TWSClient();

try {
  await client.connect();

  const data = await client.importAsset("AAPL", "SMART", "2 Y", {
    secType: SecType.STK,
    currency: "USD",
  });

  console.log(`Fetched ${data.length} data points for AAPL`);

  // Insert into database
  // await insertPriceData(data);

} finally {
  await client.disconnect();
}
```

### Example 2: Import Norwegian Stocks

```typescript
import { TWSClient, SecType } from "@/packages/ibkr/src";
import { OBX_TICKERS } from "@/packages/ibkr/src";

const client = new TWSClient();

try {
  await client.connect();

  const assets = OBX_TICKERS.slice(1, 6).map(ticker => ({
    symbol: ticker,
    exchange: "OSE",
    currency: "NOK",
  }));

  const results = await client.importAssets(assets, {
    duration: "1 Y",
    delayMs: 200, // Rate limiting
  });

  for (const [ticker, data] of results.entries()) {
    if (data.length > 0) {
      console.log(`${ticker}: ${data.length} points`);
      // await insertPriceData(data);
    }
  }

} finally {
  await client.disconnect();
}
```

### Example 3: Quick One-Off Fetch

```typescript
import { fetchHistoricalData, SecType } from "@/packages/ibkr/src";

// Automatic connection management
const data = await fetchHistoricalData("TSLA", "SMART", "6 M", {
  secType: SecType.STK,
  currency: "USD",
});

console.table(data.slice(-10)); // Last 10 data points
```

### Example 4: Next.js API Route

```typescript
import { NextRequest, NextResponse } from "next/server";
import { TWSClient, SecType } from "@/packages/ibkr/src";

export async function POST(req: NextRequest) {
  const { symbol, exchange } = await req.json();

  const client = new TWSClient();

  try {
    await client.connect();

    const data = await client.importAsset(symbol, exchange, "1 Y");

    return NextResponse.json({
      success: true,
      dataPoints: data.length,
      sample: data.slice(-5),
    });

  } catch (error: any) {
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );

  } finally {
    await client.disconnect();
  }
}
```

## Command Line Tools

### Test Connection

```bash
npx tsx scripts/test-ibkr-tws.ts
```

### Import Single Stock

```bash
npx tsx scripts/examples/import-single-stock.ts AAPL SMART 1Y
npx tsx scripts/examples/import-single-stock.ts EQNR OSE 5Y
```

### Import Multiple Stocks

```bash
npx tsx scripts/examples/import-multiple-stocks.ts
```

### Quick Data Fetch

```bash
npx tsx scripts/examples/fetch-quick-data.ts AAPL SMART
```

## Troubleshooting

### Connection Errors

**Error: Connection timeout**

- IB Gateway not running
- Wrong port (use 4002 for Gateway, 4001 for TWS)
- API not enabled in settings

**Error: Connection failed - IB Gateway not running or API not enabled**

- Check IB Gateway is running
- Go to Edit > Global Configuration > API > Settings
- Enable "Enable ActiveX and Socket Clients"
- Set correct Socket port (4002)

### Data Errors

**Error: No security definition has been found**

- Invalid symbol or exchange combination
- Try using "SMART" exchange for US stocks
- For Norwegian stocks, use "OSE" exchange

**Error: Request timeout**

- Symbol might not have data for requested duration
- Reduce duration (e.g., from "10 Y" to "5 Y")
- Check if symbol is correct

### Rate Limiting

IBKR has rate limits for historical data requests:

- Max 60 requests per 10 minutes
- Use `delayMs` option in `importAssets()` to add delays
- Recommended: 200ms between requests

## Best Practices

1. **Always disconnect**: Use try/finally to ensure disconnection
2. **Rate limiting**: Add delays between bulk imports
3. **Error handling**: Catch and log errors per-symbol
4. **Connection pooling**: Reuse client for multiple requests
5. **Timeout handling**: Set appropriate timeouts for your use case

## API Limits

- **Historical data**: Max 60 requests per 10 minutes
- **Connection**: One connection per client ID
- **Data history**: Varies by security type (typically 5-10 years for stocks)

## Support

For issues:
1. Check IB Gateway is running and configured
2. Verify connection with test script
3. Check IBKR status page for outages
4. Review IBKR TWS API documentation

## References

- [IBKR TWS API Documentation](https://interactivebrokers.github.io/tws-api/)
- [@stoqey/ib Library](https://github.com/stoqey/ib)
- [Contract Specifications](https://www.interactivebrokers.com/en/index.php?f=2222)
