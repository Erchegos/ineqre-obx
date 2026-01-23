# Index Data Availability Summary

## Current Database Status

### OBX Index (Oslo Børs Benchmark Index)
- **Ticker**: OBX
- **Data Range**: April 20, 2020 - January 21, 2026
- **Total Days**: 1,453 trading days  
- **Years of Data**: ~5.75 years
- **Source**: Interactive Brokers Gateway (port 4002)

## IB Gateway Testing Results

### Tested (January 23, 2026)

#### Requested: 20 years of OBX data
- **Result**: ❌ Only 5.75 years available
- **Limitation**: IB Gateway limits OBX historical data to ~5.75 years
- **Test Script**: `scripts/test-obx-20y-tws.ts`

#### Other Nordic Indexes Tested
- OSEBX (Oslo Børs Benchmark Index) - ❌ Not found
- OSEAX (Oslo Børs All-Share Index) - ❌ Not found
- OBX25 - ❌ Not found
- OMXS30 (OMX Stockholm 30) - ❌ Not found
- OMXC25 (OMX Copenhagen 25) - ❌ Not found
- OMXH25 (OMX Helsinki 25) - ❌ Not found

**Note**: These may be available with different contract specifications or from different data providers.

## Recommendations for 20-Year Data

To obtain 20 years of OBX index data, consider:

1. **Oslo Børs Direct**
   - Contact Oslo Børs for historical index data
   - https://www.oslobors.no/

2. **Alternative Data Providers**
   - Bloomberg Terminal
   - Refinitiv/Thomson Reuters
   - FactSet
   - S&P Capital IQ

3. **Academic/Research Sources**
   - Norwegian School of Economics (NHH)
   - BI Norwegian Business School
   - May have historical Norwegian market data

## Current Volatility Correlation Implementation

The volatility correlation chart uses:
- **Stock volatility** vs **OBX volatility**
- **Time period**: Full available history (currently 5.75 years)
- **Correlation window**: Rolling 30-day
- **Chart location**: `/volatility/[ticker]` page

With 5.75 years of data, this provides meaningful correlation analysis for:
- Market regime changes (COVID-19 pandemic, recovery period)
- Recent market cycles
- Current correlation dynamics

## Files

- Test scripts: `scripts/test-obx-20y-tws.ts`, `scripts/search-indexes.ts`
- Ticker list: `packages/ibkr/src/obx-tickers.ts`
- Volatility correlation chart: `apps/web/src/components/VolatilityCorrelationChart.tsx`
