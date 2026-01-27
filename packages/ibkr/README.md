# IBKR Package

Production-ready wrapper for Interactive Brokers TWS/Gateway API.

## Quick Start

```typescript
import { TWSClient, SecType } from "@/packages/ibkr/src";

// Create client
const client = new TWSClient();
await client.connect();

// Fetch historical data
const data = await client.importAsset("AAPL", "SMART", "1 Y", {
  secType: SecType.STK,
  currency: "USD",
});

console.log(`Fetched ${data.length} data points`);

await client.disconnect();
```

## Features

- Automatic connection management
- Historical data fetching for any ticker
- Support for stocks, indices, forex
- Easy asset import and data ingestion
- Works in both Node.js scripts and Next.js API routes
- Comprehensive error handling
- Rate limiting support
- TypeScript support

## Installation

The package is already installed as part of the monorepo.

External dependencies:
- `@stoqey/ib` - TWS API client

## Documentation

See [IBKR_API_GUIDE.md](../../docs/IBKR_API_GUIDE.md) for complete documentation.

## Examples

### Import Single Stock

```bash
npx tsx scripts/examples/import-single-stock.ts AAPL SMART 1Y
```

### Import Multiple Stocks

```typescript
const results = await client.importAssets(
  [
    { symbol: "AAPL", exchange: "SMART", currency: "USD" },
    { symbol: "GOOGL", exchange: "SMART", currency: "USD" },
  ],
  { duration: "1 Y", delayMs: 200 }
);
```

### Next.js API Route

```typescript
import { TWSClient } from "@/packages/ibkr/src";

export async function POST(req: NextRequest) {
  const client = new TWSClient();
  try {
    await client.connect();
    const data = await client.importAsset("AAPL", "SMART", "1 Y");
    return NextResponse.json({ data });
  } finally {
    await client.disconnect();
  }
}
```

## API Reference

### TWSClient

Main client class for IBKR operations.

#### Methods

- `connect()` - Connect to IB Gateway
- `disconnect()` - Disconnect from IB Gateway
- `getHistoricalData(symbol, exchange, duration, barSize?, secType?, currency?)` - Fetch raw historical bars
- `importAsset(symbol, exchange, duration, options?)` - Import single asset (returns PriceData[])
- `importAssets(assets[], options?)` - Import multiple assets with rate limiting
- `convertToPriceData(ticker, bars)` - Convert bars to database format

### Helper Functions

- `createTWSClient(config?)` - Create and connect client in one step
- `fetchHistoricalData(symbol, exchange, duration, options?)` - One-off fetch with auto connection

### Types

- `TWSConfig` - Client configuration
- `HistoricalBar` - Raw bar data from IBKR
- `PriceData` - Database-ready price data
- `ContractDetails` - Contract specification

### Enums

- `SecType` - Security types (STK, IND, FUT, OPT, CASH, etc.)
- `BarSizeSetting` - Bar sizes (DAYS_ONE, HOURS_ONE, MINS_ONE, etc.)
- `WhatToShow` - Data type (TRADES, MIDPOINT, BID, ASK, etc.)

## Configuration

### IB Gateway Setup

1. Enable API in Global Configuration
2. Set Socket port to 4002
3. Add 127.0.0.1 to trusted IPs

### Client Configuration

```typescript
const client = new TWSClient({
  clientId: 100,              // Unique client ID
  host: "127.0.0.1",          // IB Gateway host
  port: 4002,                 // IB Gateway port
  connectionTimeout: 5000,    // Connection timeout (ms)
  requestTimeout: 30000,      // Request timeout (ms)
});
```

## Rate Limiting

IBKR limits historical data requests:
- Max 60 requests per 10 minutes
- Use `delayMs` option for bulk imports
- Recommended: 200ms between requests

```typescript
await client.importAssets(assets, {
  duration: "1 Y",
  delayMs: 200, // 200ms delay between requests
});
```

## Error Handling

The client provides detailed error messages:

```typescript
try {
  await client.connect();
  const data = await client.importAsset("INVALID", "OSE", "1 Y");
} catch (error) {
  if (error.message.includes("Connection")) {
    console.error("IB Gateway not running");
  } else if (error.message.includes("timeout")) {
    console.error("Request timed out");
  } else {
    console.error("Unknown error:", error);
  }
} finally {
  await client.disconnect();
}
```

## Testing

```bash
# Test connection
npx tsx scripts/test-ibkr-tws.ts

# Test single import
npx tsx scripts/examples/import-single-stock.ts AAPL SMART 1Y

# Test bulk import
npx tsx scripts/examples/import-multiple-stocks.ts
```

## License

Private - Internal use only
