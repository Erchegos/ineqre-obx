# FX Pairs - Quant Trader Implementation

## Overview

Professional FX analytics system for NOK-based portfolios following strict quantitative finance conventions. All calculations match the PDF specification for institutional-grade FX risk management.

---

## Implementation Checklist

### Core Calculation Engine
- [x] Canonical FX representation (NOK/X format)
- [x] FX log return construction
- [x] Interest rate alignment validation
- [x] Forward rate pricing (Covered IRP)
- [x] Carry decomposition
- [x] FX forward P&L attribution
- [x] FX volatility (annualized, rolling)
- [x] Currency beta estimation (OLS)
- [x] Hedged return construction
- [x] Stress scenario engine (deterministic)
- [x] Data integrity validation
- [x] IRP validation

### Data Pipeline
- [x] Database schema for FX spot rates
- [x] IBKR fetch script (fx/fetch-fx-rates.ts)
- [ ] Interest rate data fetching
- [ ] Forward rate calculation job
- [ ] Daily update automation

### API Layer
- [x] GET /api/fx-pairs - Comprehensive FX analytics
- [ ] GET /api/fx-pairs/forwards - Forward curve
- [ ] POST /api/fx-pairs/hedge - Hedge calculator
- [ ] POST /api/fx-pairs/stress - Stress scenarios

### Frontend
- [x] FX Pairs dashboard (/fx-pairs)
- [ ] Forward curve visualization
- [ ] Hedge calculator UI
- [ ] Stress scenario grid
- [ ] Currency correlation matrix

---

## Quick Start

### 1. Fetch FX Data (Required First Step)

```bash
# Fetch last 252 trading days
tsx scripts/fx/fetch-fx-rates.ts --backfill 252

# This will populate fx_spot_rates table with:
# - NOK/USD
# - NOK/EUR
# - NOK/GBP
```

### 2. View FX Analytics

```bash
# Start dev server (if not running)
npm run dev

# Navigate to:
open http://localhost:3000/fx-pairs
```

### 3. Test API

```bash
# Get NOK/USD analytics
curl 'http://localhost:3000/api/fx-pairs?pair=NOKUSD&days=252' | jq

# Response includes:
# - Latest spot rate
# - Log returns series
# - Annualized volatility
# - Rolling volatility (20D, 63D, 252D)
# - Return statistics
```

---

## File Structure

```
InEqRe_OBX/
├── apps/web/src/
│   ├── lib/
│   │   └── fxPairCalculations.ts    # Core calculation engine (500+ lines)
│   ├── app/
│   │   ├── api/fx-pairs/
│   │   │   └── route.ts             # FX analytics API
│   │   └── fx-pairs/
│   │       └── page.tsx             # Quant trader dashboard
│   └── ...
├── scripts/fx/
│   └── fetch-fx-rates.ts            # IBKR data fetcher
└── docs/
    └── FX_PAIRS_QUANT_IMPLEMENTATION.md
```

---

## Calculation Specifications (Per PDF)

### 1. Canonical FX Representation

All pairs normalized as **NOK/X** (NOK per 1 unit of foreign currency).

```typescript
normalizeFXPair("NOKUSD") // Valid
normalizeFXPair("USDNOK") // Error: must be NOK/X format
```

### 2. FX Log Return Construction

Time-additive returns for volatility estimation:

```
r^FX_t = ln(S_t / S_t-1)
```

Implementation: `calculateFXLogReturns()`

### 3. Interest Rate Inputs

Rates must be aligned by:
- Tenor (1M, 3M, 6M, 12M)
- Compounding convention
- Day count (ACT/360, ACT/365)

Validation: `validateInterestRateAlignment()`

### 4. Forward Rate Pricing

Strict no-arbitrage IRP:

```
F_{t,T} = S_t × [(1 + r_NOK × T) / (1 + r_X × T)]

Log form: ln(F) = ln(S) + (r_NOK - r_X) × T
```

Implementation: `calculateForwardPrice()`

### 5. Carry Decomposition

Interest rate differential embedded in forward:

```
Carry_{t,T} = r_NOK - r_X
```

Implementation: `calculateCarry()`

### 6. FX Forward P&L Attribution

Decomposition into components:

```
P&L_t = S_t - F_0

Components:
- Spot movement: S_t - S_0
- Carry accrual: (r_NOK - r_X) × Notional × τ
- Roll yield: Residual
```

Implementation: `attributeForwardPnL()`

### 7. FX Volatility

Annualized standard deviation of log returns:

```
σ_FX = sqrt(252) × std(r^FX)
```

Implementation: `calculateFXVolatility()`, `calculateRollingFXVolatility()`

### 8. Currency Beta Estimation

OLS regression for economic exposure:

```
r^Equity_NOK = α + β_FX × r^FX + ε
```

Implementation: `estimateCurrencyBetaOLS()`

### 9. Hedged Return Construction

Explicit carry retention:

```
r^Hedged = r^Equity_NOK - h × r^FX + h × Carry
```

Implementation: `constructHedgedReturn()`, `calculateHedgedReturnSeries()`

### 10. Stress Scenario Engine

Deterministic FX shocks (no Monte Carlo):

```typescript
applyFXStressScenario(
  spot,
  forward,
  fxShock: 0.10, // 10% depreciation
  equityReturn,
  equityBeta,
  hedgeRatio,
  carry
)
```

Implementation: `applyFXStressScenario()`, `generateStressScenarioGrid()`

### 11. Data Integrity Rules

Mandatory validations:
- Calendar-aligned series
- Zero missing FX days
- Reproducible inputs
- IRP validation

Implementation: `validateFXDataIntegrity()`, `validateIRP()`

### 12. Output Requirements

Each FX pair must expose:
- Spot rates
- Returns (log and simple)
- Volatility (annualized and rolling)
- Forward curve
- Carry
- Hedge cost
- Stress sensitivities

API: `/api/fx-pairs` returns complete analytics bundle

---

## API Response Structure

```json
{
  "pair": "NOKUSD",
  "dataPoints": 252,
  "dateRange": {
    "start": "2025-01-23",
    "end": "2026-01-23"
  },
  "latest": {
    "date": "2026-01-23",
    "spot": 10.5123,
    "logReturn": 0.0024,
    "simpleReturn": 0.0024
  },
  "volatility": {
    "annualized": 8.45,
    "window": 252,
    "observations": 251
  },
  "rollingVolatility": {
    "20D": 7.82,
    "63D": 8.15,
    "252D": 8.45
  },
  "returnStats": {
    "mean": 0.012,
    "min": -2.45,
    "max": 2.18,
    "annualizedMean": 3.02
  },
  "timeSeries": {
    "spot": [...],
    "returns": [...],
    "volatility20D": [...],
    "volatility63D": [...],
    "volatility252D": [...]
  },
  "dataIntegrity": {
    "valid": true,
    "errors": []
  }
}
```

---

## Dashboard Features

### Current Implementation

1. **Pair Selector**
   - Toggle between NOK/USD, NOK/EUR, NOK/GBP
   - Instant data refresh

2. **Key Metrics Grid**
   - Spot rate
   - Daily return (log)
   - Annualized volatility
   - Rolling volatility (20D)
   - Mean return
   - Annualized return

3. **Interactive Charts**
   - Spot rate time series
   - Daily log returns
   - Rolling volatility (20D, 63D, 252D)
   - Professional styling (no emojis)

4. **Statistics Table**
   - Mean daily return
   - Annualized return
   - Min/Max returns
   - Data point count

### Planned Additions

1. **Forward Curve Tab**
   - 1M, 3M, 6M, 12M forwards
   - Carry heatmap
   - IRP validation status

2. **Hedge Calculator**
   - Input: hedge ratio (slider)
   - Output: hedged return series
   - Volatility reduction metric

3. **Stress Scenarios**
   - Grid: FX shock × hedge ratio
   - P&L heatmap
   - Optimal hedge identification

4. **Correlation Matrix**
   - NOK/USD, NOK/EUR, NOK/GBP correlations
   - Rolling correlation charts

---

## Testing Checklist

### Calculation Engine Tests

```bash
# Create test file
cat > apps/web/src/lib/__test_fx_pairs.ts << 'EOF'
import { calculateFXLogReturns, calculateFXVolatility, calculateForwardPrice } from './fxPairCalculations';

// Test 1: Log returns
const spots = [
  { date: '2026-01-20', pair: 'NOKUSD', spot: 10.50 },
  { date: '2026-01-21', pair: 'NOKUSD', spot: 10.52 },
  { date: '2026-01-22', pair: 'NOKUSD', spot: 10.48 },
];

const returns = calculateFXLogReturns(spots);
console.log('Log Returns:', returns);

// Test 2: Forward pricing
const forward = calculateForwardPrice(10.50, 0.045, 0.055, 91/365);
console.log('Forward Rate:', forward);

// Test 3: Volatility
const vol = calculateFXVolatility(returns);
console.log('Volatility:', vol);
EOF

# Run tests
npx tsx apps/web/src/lib/__test_fx_pairs.ts
```

### API Tests

```bash
# Test each pair
for pair in NOKUSD NOKEUR NOKGBP; do
  echo "Testing $pair..."
  curl "http://localhost:3000/api/fx-pairs?pair=$pair&days=252" | jq '.pair, .volatility'
done
```

### Data Integrity Tests

```bash
# Verify data completeness
psql "$DATABASE_URL" -c "
  SELECT
    currency_pair,
    COUNT(*) as days,
    MIN(date) as start_date,
    MAX(date) as end_date
  FROM fx_spot_rates
  GROUP BY currency_pair
  ORDER BY currency_pair;
"
```

---

## Next Steps

### Phase 1: Forward Curve (Priority)
- [ ] Fetch interest rate data (Norges Bank, Fed, ECB, BoE)
- [ ] Calculate synthetic forwards via IRP
- [ ] Store in fx_forward_rates table
- [ ] Build /api/fx-pairs/forwards endpoint
- [ ] Add forward curve chart to dashboard

### Phase 2: Hedge Calculator
- [ ] Build POST /api/fx-pairs/hedge endpoint
- [ ] Accept: ticker, hedge ratio, tenor
- [ ] Return: hedged return series, vol reduction
- [ ] Add interactive UI with slider
- [ ] Real-time P&L attribution

### Phase 3: Stress Testing
- [ ] Build POST /api/fx-pairs/stress endpoint
- [ ] Generate scenario grid
- [ ] Add heatmap visualization
- [ ] Export to CSV for analysis

### Phase 4: Correlation Analysis
- [ ] Calculate rolling correlations between pairs
- [ ] Build correlation matrix API
- [ ] Add correlation heatmap
- [ ] Show regime-dependent correlations

---

## Production Deployment Checklist

- [ ] Set up daily FX data fetch job (cron)
- [ ] Add error monitoring and alerts
- [ ] Implement data quality checks
- [ ] Add API rate limiting
- [ ] Cache frequently accessed data
- [ ] Add WebSocket for live updates
- [ ] Create admin dashboard for data health
- [ ] Document API with Swagger/OpenAPI

---

## Key Design Decisions

1. **Log returns over simple returns** - Time additivity for volatility
2. **Strict IRP validation** - No arbitrage opportunities
3. **Deterministic stress scenarios** - No Monte Carlo complexity
4. **Professional UI** - No emojis, clean quant aesthetic
5. **Database-first** - Pre-compute analytics for speed
6. **Type-safe calculations** - Full TypeScript with Zod validation

---

## Performance Metrics

Target SLAs:
- API response time: < 200ms (p95)
- Chart load time: < 1 second
- Data freshness: Daily updates by 09:00 CET
- Uptime: 99.9%

---

## References

- PDF: `FX_Pair_Calculations_Quant_Trader_Layout.pdf`
- Calculation Library: `apps/web/src/lib/fxPairCalculations.ts`
- API: `apps/web/src/app/api/fx-pairs/route.ts`
- Dashboard: `apps/web/src/app/fx-pairs/page.tsx`
- IBKR Integration: `scripts/fx/fetch-fx-rates.ts`
