# IBKR Fundamentals Data Guide

## Overview

IBKR provides extensive fundamental data for stocks through their TWS API. The data is returned as XML and includes company information, financial metrics, officer details, industry classifications, and more.

## Available Data from Company Overview (ReportSnapshot)

Based on testing with EQNR, the `ReportSnapshot` report type provides:

### Company Identification
- Company name
- Ticker symbol
- ISIN, RIC, PermID
- Exchange information

### Company Details
- Business description
- Financial summary
- Reporting currency
- Number of employees
- Shares outstanding
- Total float
- Latest financial reporting dates (annual/interim)

### Contact Information
- Street address
- City, postal code, country
- Phone numbers (main, fax, contact)
- Email
- Website
- Investor relations contact

### Industry Classification
- TRBC (Thomson Reuters Business Classification)
- NAICS (North American Industry Classification System)
- SIC (Standard Industrial Classification)
- Multiple industry codes and descriptions

### Corporate Officers
- Name, age
- Title
- Start date
- Rank/order

### Other Data Available
- Peer companies
- Historical data references
- Last modified dates

## Example: EQNR Data

From `/tmp/EQNR_fundamentals.xml`:

```xml
<Company Name>Equinor ASA</CompanyName>
<Ticker>EQNR</Ticker>
<Employees>25,155</Employees>
<SharesOut>2,518,471,175</SharesOut>
<TotalFloat>805,387,926</TotalFloat>
<Industry>Integrated Oil & Gas</Industry>
<BusinessSummary>Equinor ASA, formerly Statoil ASA is a Norway-based international energy company...</BusinessSummary>
```

## Report Types

### 1. ReportSnapshot (Company Overview)
**Available**: YES (tested and working)

Contains:
- Company identifiers
- Business description
- Contact information
- Officers
- Industry classification
- Shares outstanding
- Employee count

### 2. ReportsFinStatements (Financial Statements)
**Availability**: Requires specific data subscription

Would contain:
- Income statement (quarterly/annual)
- Balance sheet
- Cash flow statement
- Multiple periods of historical data

### 3. RESC (Analyst Forecasts)
**Availability**: Requires specific data subscription

Would contain:
- Analyst ratings and recommendations
- Price targets
- Earnings estimates
- Revenue forecasts

### 4. ReportRatios (Financial Ratios)
**Availability**: Requires specific data subscription

Would contain:
- P/E ratio
- P/B ratio
- ROE, ROA
- Profit margins
- Dividend yield
- Debt ratios

## Data Not Available via IBKR

The following data shown in your screenshots is **NOT** available via IBKR API:

1. **Analyst Ratings Charts** - The visual ratings history and distribution
2. **Dividends History Chart** - The bar chart of dividend payments
3. **Price Target Range** - The specific analyst price targets
4. **Detailed Financial Trends** - The sparkline charts
5. **ESG Ratings** - Environmental, Social, Governance scores
6. **Morningstar Ratings** - Star ratings and economic moat

These are proprietary to Interactive Brokers' web interface and not exposed via API.

## Alternative Data Sources

To get the missing data, you can:

### 1. Financial Modeling Prep API
- Free tier available
- Provides: financials, ratios, analyst ratings, price targets
- URL: https://financialmodelingprep.com/

### 2. Alpha Vantage
- Free tier with API key
- Provides: company overview, income statement, balance sheet, cash flow
- URL: https://www.alphavantage.co/

### 3. Yahoo Finance API (unofficial)
- Free but unofficial
- Provides: most fundamental data
- Library: `yahoo-finance2` npm package

### 4. Polygon.io
- Paid service
- Comprehensive fundamental data
- Real-time and historical

### 5. Web Scraping
- Scrape from Yahoo Finance, MarketWatch, or similar
- More maintenance required
- Use libraries like Puppeteer or Cheerio

## Using IBKR Fundamentals Data

### Fetch Company Overview

```typescript
import { FundamentalsClient, FundamentalsReportType, SecType } from "@/packages/ibkr/src";

const client = new FundamentalsClient();
await client.connect();

const xml = await client.fetchFundamentalReport(
  "EQNR",
  "OSE",
  FundamentalsReportType.COMPANY_OVERVIEW,
  SecType.STK,
  "NOK"
);

// Parse XML to extract data
// Save to database or process further
```

### Parse XML Data

Install XML parser:
```bash
npm install fast-xml-parser
```

Parse the data:
```typescript
import { XMLParser } from 'fast-xml-parser';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_"
});

const data = parser.parse(xml);

// Extract specific fields
const companyName = data.ReportSnapshot.CoIDs.CoID.find(
  (id: any) => id["@_Type"] === "CompanyName"
)["#text"];

const employees = data.ReportSnapshot.CoGeneralInfo.Employees;
const sharesOut = data.ReportSnapshot.CoGeneralInfo.SharesOut["#text"];
```

### Store in Database

Example schema:
```sql
CREATE TABLE company_fundamentals (
  id SERIAL PRIMARY KEY,
  ticker VARCHAR(10) NOT NULL,
  company_name VARCHAR(255),
  business_summary TEXT,
  sector VARCHAR(100),
  industry VARCHAR(100),
  employees INTEGER,
  shares_outstanding BIGINT,
  reporting_currency VARCHAR(3),
  website VARCHAR(255),
  email VARCHAR(255),
  phone VARCHAR(50),
  address TEXT,
  raw_xml TEXT, -- Store full XML for future parsing
  last_updated TIMESTAMP DEFAULT NOW(),
  UNIQUE(ticker)
);
```

## Recommendations

For your Intelligence Equity Research platform:

1. **Use IBKR for**: Company overview, basic company info, contact details
2. **Use Financial Modeling Prep for**: Financial statements, ratios, analyst ratings
3. **Use Yahoo Finance for**: Real-time quotes, dividend history
4. **Web scraping for**: Visual charts and specific broker research

## Implementation Plan

1. **Phase 1**: Implement IBKR company overview fetching
   - Store basic company data
   - Update weekly or monthly

2. **Phase 2**: Add Financial Modeling Prep integration
   - Fetch financial statements
   - Calculate custom ratios
   - Store analyst ratings

3. **Phase 3**: Create aggregated dashboard
   - Combine data from multiple sources
   - Display in your web interface
   - Update on schedule

## Example: Complete Integration

```typescript
// 1. Fetch from IBKR
const ibkrData = await fetchIBKRFundamentals("EQNR", "OSE");

// 2. Fetch from Financial Modeling Prep
const fmpData = await fetchFMPData("EQNR");

// 3. Combine and store
const fundamentals = {
  ticker: "EQNR",
  companyName: ibkrData.companyName,
  businessSummary: ibkrData.businessSummary,
  employees: ibkrData.employees,
  revenue: fmpData.financials.revenue,
  netIncome: fmpData.financials.netIncome,
  pe Ratio: fmpData.ratios.peRatio,
  analystRating: fmpData.analystRating,
  targetPrice: fmpData.targetPrice,
};

// 4. Save to database
await saveFundamentals(fundamentals);
```

## Conclusion

IBKR provides basic company overview data via API, but for comprehensive fundamental data including financials, ratios, and analyst ratings, you'll need to integrate additional data sources. The good news is that many of these sources offer free tiers that should be sufficient for your needs.
