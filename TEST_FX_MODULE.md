# FX Hedging Module - Local Testing Guide

## Step 1: Run Database Migrations

```bash
cd /Users/olaslettebak/Documents/Intelligence_Equity_Research/code/InEqRe_OBX

# Make sure DATABASE_URL is set in your .env file
# It should look like: DATABASE_URL=postgresql://user:password@host:port/database

# Run migrations to create FX tables
psql $DATABASE_URL -f packages/db/src/schema/003_fx_hedging_tables.sql

# Seed FX exposure data for 23 stocks
psql $DATABASE_URL -f packages/db/src/schema/004_seed_fx_exposures.sql
```

**Expected Output:**
```
CREATE TABLE
CREATE INDEX
CREATE INDEX
... (multiple CREATE statements)

INSERT 0 23  (or similar)
```

## Step 2: Verify Database Setup

```bash
# Check that tables were created
psql $DATABASE_URL -c "\dt fx_*"

# Should show:
# - fx_spot_rates
# - fx_forward_rates
# - fx_currency_betas
# - fx_exposure_decomposition
# - fx_hedge_pnl
# - fx_optimal_hedges
# - fx_market_regimes

# Check that data was seeded
psql $DATABASE_URL -c "SELECT ticker, usd_revenue_pct, eur_revenue_pct, nok_revenue_pct FROM stock_fx_exposure ORDER BY usd_revenue_pct DESC LIMIT 10;"

# Should show stocks like EQNR, FRO, etc. with their FX exposure
```

## Step 3: Start Development Server

```bash
cd InEqRe_OBX
npm run dev

# Wait for:
# ✓ Ready in X ms
# ◐ Compiling /fx-hedging ...
```

## Step 4: Test the FX Dashboard

Open your browser and navigate to:

```
http://localhost:3000/fx-hedging
```

### What You Should See:

1. **Header**
   - "FX Hedging Analytics" title
   - Description about currency risk management

2. **Info Box**
   - Explanation of the module's purpose
   - Academic framework note

3. **Summary Stats**
   - Average USD exposure (should be ~45%)
   - Average EUR exposure (should be ~20%)
   - Average GBP exposure (should be ~2%)
   - Average NOK exposure (should be ~32%)

4. **Exposure Table**
   - 23 rows of stock data
   - Columns: Ticker, Company, Sector, USD%, EUR%, GBP%, NOK%, Source
   - Stocks should be sorted by USD exposure (highest first)
   - EQNR, FRO, AKRBP should be at the top

### Example Data You Should See:

| Ticker | USD % | EUR % | GBP % | NOK % |
|--------|-------|-------|-------|-------|
| FRO    | 90.0  | 5.0   | 0.0   | 5.0   |
| AKRBP  | 85.0  | 10.0  | 0.0   | 5.0   |
| EQNR   | 80.0  | 15.0  | 0.0   | 5.0   |
| ...    | ...   | ...   | ...   | ...   |

## Step 5: Test the API Endpoint

Open a new terminal and test the API:

```bash
# Get all exposures
curl http://localhost:3000/api/fx-hedging/exposures | jq

# Get specific ticker
curl "http://localhost:3000/api/fx-hedging/exposures?ticker=EQNR" | jq
```

### Expected Response:

```json
{
  "count": 1,
  "data": {
    "ticker": "EQNR",
    "name": "Equinor ASA",
    "sector": "Energy",
    "exposure": {
      "USD": 80.0,
      "EUR": 15.0,
      "GBP": 0.0,
      "NOK": 5.0,
      "OTHER": 0.0
    },
    "lastUpdated": "2025-12-31",
    "source": "Annual Report 2025",
    "notes": "Oil & gas revenues primarily USD-denominated"
  }
}
```

## Step 6: Test the Calculation Library

Create a test script to verify calculations:

```bash
cd InEqRe_OBX
node --loader tsx apps/web/src/lib/__test_fx_calculations.ts
```

**Create this test file:**

```typescript
// apps/web/src/lib/__test_fx_calculations.ts
import {
  decomposeReturn,
  estimateCurrencyBeta,
  calculateForwardRate,
  calculateOptimalHedgeRatio,
} from "./fxHedging";

console.log("=== FX Hedging Calculations Test ===\n");

// Test 1: Return Decomposition
console.log("1. Return Decomposition");
const decomp = decomposeReturn(
  2.3, // NOK return: 2.3%
  { usd: 1.5, eur: 0.3, gbp: 0.0 }, // FX returns
  { usdPct: 0.8, eurPct: 0.15, gbpPct: 0.0 } // EQNR exposure
);
console.log("Total NOK return:", decomp.totalReturnNOK, "%");
console.log("FX contribution:", decomp.fxContribution.toFixed(3), "%");
console.log("Pure equity return:", decomp.pureEquityReturn.toFixed(3), "%");
console.log("Interaction term:", decomp.interactionTerm.toFixed(3), "%\n");

// Test 2: Currency Beta
console.log("2. Currency Beta Estimation");
const equityReturns = [0.5, -0.3, 0.8, -0.2, 0.6, 0.4, -0.5, 0.7];
const fxReturns = [0.3, -0.2, 0.5, -0.1, 0.4, 0.2, -0.3, 0.4];
const beta = estimateCurrencyBeta(equityReturns, fxReturns, 8);
console.log("Beta:", beta.beta.toFixed(3));
console.log("R²:", beta.rSquared.toFixed(3));
console.log("t-stat:", beta.tStat.toFixed(2));
console.log("p-value:", beta.pValue.toFixed(4), "\n");

// Test 3: Forward Rate (IRP)
console.log("3. Forward Rate Calculation");
const forward = calculateForwardRate(
  10.5, // Spot: 10.5 NOK/USD
  0.045, // NOK rate: 4.5%
  0.055, // USD rate: 5.5%
  91 // 3 months
);
console.log("Spot rate:", forward.spotRate);
console.log("Forward rate:", forward.forwardRate.toFixed(4));
console.log("Forward points:", forward.forwardPoints.toFixed(2), "pips");
console.log("Annualized carry:", forward.annualizedCarry.toFixed(2), "%\n");

// Test 4: Optimal Hedge
console.log("4. Optimal Hedge Ratio");
const optimal = calculateOptimalHedgeRatio(equityReturns, fxReturns, 8, -0.01);
console.log("Min variance hedge:", (optimal.minVarianceHedge * 100).toFixed(1), "%");
console.log("Vol (0% hedge):", optimal.vol0pct.toFixed(2), "%");
console.log("Vol (optimal hedge):", optimal.volOptimal.toFixed(2), "%");
console.log("Opportunity cost:", optimal.opportunityCost.toFixed(2), "%\n");

console.log("✅ All calculations completed successfully!");
```

Run it:
```bash
npx tsx apps/web/src/lib/__test_fx_calculations.ts
```

## Troubleshooting

### Issue: "relation does not exist"
**Solution:** Run the migration SQL files again
```bash
psql $DATABASE_URL -f packages/db/src/schema/003_fx_hedging_tables.sql
```

### Issue: "No data displayed"
**Solution:** Check that seed data was inserted
```bash
psql $DATABASE_URL -c "SELECT COUNT(*) FROM stock_fx_exposure;"
# Should return 23
```

### Issue: "Connection refused"
**Solution:** Make sure PostgreSQL is running and DATABASE_URL is correct
```bash
echo $DATABASE_URL
psql $DATABASE_URL -c "SELECT version();"
```

### Issue: "Module not found"
**Solution:** The calculation library path might need adjustment
```bash
cd InEqRe_OBX/apps/web
npm install
```

## Success Criteria

✅ **Database Setup Complete**
- All 10 FX tables created
- 23 stocks seeded with exposure data
- Indexes created for performance

✅ **API Working**
- `/api/fx-hedging/exposures` returns 200
- Response includes ticker, name, exposure breakdown
- Query parameter filtering works

✅ **Frontend Working**
- `/fx-hedging` page loads without errors
- Exposure table displays 23 stocks
- Summary stats calculate correctly
- Styling matches existing design system

✅ **Calculations Verified**
- Return decomposition sums correctly
- Beta estimation produces reasonable values
- Forward rate matches IRP formula
- Optimal hedge ratio between 0 and 1

## Next Steps After Testing

Once everything works locally:

1. **Add more API endpoints** for beta, forward rates, hedge analysis
2. **Create individual stock page** at `/fx-hedging/[ticker]`
3. **Implement IBKR FX data fetching** to populate fx_spot_rates table
4. **Build interactive charts** using Recharts
5. **Set up daily calculation jobs** for pre-computing analytics

---

**Questions?** Check the implementation summary in `docs/FX_HEDGING_IMPLEMENTATION_SUMMARY.md`
