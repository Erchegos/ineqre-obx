# Fundamentals Panel Implementation Guide

## Overview

This guide explains how to add a sliding fundamentals panel to your stock list. When users click on a stock, a panel slides in from the right showing detailed company information without leaving the page.

## Features

- Slides in from right side (600px wide, responsive)
- Dark overlay background
- Smooth animations
- Shows comprehensive company data:
  - Key metrics (employees, shares, float)
  - Business description
  - Recent financial performance
  - Key executives
  - Contact information
  - Investor relations
  - Financial reporting dates
- Click outside or X button to close
- No page reload required

## Files Created

### 1. Component
**File**: `apps/web/src/components/StockFundamentalsPanel.tsx`

The main React component for the sliding panel.

### 2. API Endpoint
**File**: `apps/web/src/app/api/fundamentals/[ticker]/route.ts`

Serves fundamental data from database for a specific ticker.

**URL**: `GET /api/fundamentals/EQNR`

**Response**:
```json
{
  "success": true,
  "data": {
    "ticker": "EQNR",
    "companyName": "Equinor ASA",
    "industry": "Integrated Oil & Gas",
    "employees": 25155,
    "businessSummary": "...",
    "officers": [...],
    ...
  }
}
```

### 3. Example Implementation
**File**: `apps/web/src/app/stocks/page-with-fundamentals.tsx.example`

Shows how to integrate the panel into your existing stock list.

## Implementation Steps

### Step 1: Import the Component

Add to your stocks page (`apps/web/src/app/stocks/page.tsx`):

```typescript
import StockFundamentalsPanel from "@/components/StockFundamentalsPanel";
```

### Step 2: Add State

Add state variables for panel control:

```typescript
const [selectedTicker, setSelectedTicker] = useState<string>("");
const [isPanelOpen, setIsPanelOpen] = useState(false);
```

### Step 3: Add Click Handler

Add function to handle stock row clicks:

```typescript
const handleStockClick = (ticker: string, event: React.MouseEvent) => {
  // Don't open panel if clicking on a link
  if ((event.target as HTMLElement).tagName === "A") {
    return;
  }

  setSelectedTicker(ticker);
  setIsPanelOpen(true);
};
```

### Step 4: Add onClick to Table Rows

Update your table row `<tr>` element:

```typescript
<tr
  key={stock.ticker}
  onClick={(e) => handleStockClick(stock.ticker, e)}
  style={{
    cursor: "pointer",
    transition: "background 0.2s",
  }}
  onMouseEnter={(e) => {
    e.currentTarget.style.background = "var(--muted)";
  }}
  onMouseLeave={(e) => {
    e.currentTarget.style.background = "transparent";
  }}
>
  {/* ... existing cells ... */}
</tr>
```

### Step 5: Add Panel Component

At the end of your component JSX (after closing `</div>`):

```typescript
<StockFundamentalsPanel
  ticker={selectedTicker}
  isOpen={isPanelOpen}
  onClose={() => setIsPanelOpen(false)}
/>
```

### Step 6: Update User Hint

Add hint text so users know they can click rows:

```typescript
<p style={{ fontSize: 14, color: "var(--muted-foreground)" }}>
  {stocks.length} stocks available • Click any row for fundamentals
</p>
```

## Complete Example

See `apps/web/src/app/stocks/page-with-fundamentals.tsx.example` for a full working example.

## Testing

1. Start dev server: `npm run dev`
2. Go to http://localhost:3000/stocks
3. Click on any stock row (not the "View Stats" link)
4. Panel should slide in from right with company info
5. Click overlay or X to close

## Test API Endpoint

```bash
curl http://localhost:3000/api/fundamentals/EQNR
curl http://localhost:3000/api/fundamentals/DNB
curl http://localhost:3000/api/fundamentals/AKER
```

## Customization

### Change Panel Width

In `StockFundamentalsPanel.tsx`, modify:

```typescript
width: '600px',  // Change to '800px', '50vw', etc.
```

### Change Animation Speed

```typescript
transition: 'transform 0.3s ease',  // Change to '0.5s', '0.2s', etc.
```

### Add More Sections

Add new sections in the panel component:

```typescript
<section style={{ marginBottom: 32 }}>
  <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>
    YOUR SECTION TITLE
  </h3>
  {/* Your content */}
</section>
```

### Style Colors

The panel uses CSS variables that match your theme:
- `var(--card-bg)` - Panel background
- `var(--border)` - Border colors
- `var(--foreground)` - Text color
- `var(--muted-foreground)` - Muted text
- `var(--muted)` - Muted backgrounds

## Data Requirements

The panel requires data in the database. Make sure you've:

1. Created the schema:
```bash
npx tsx scripts/create-fundamentals-schema.sql
```

2. Imported data:
```bash
npx tsx scripts/import-obx-fundamentals.ts
npx tsx scripts/import-fundamentals-to-db.ts
```

3. Verified data:
```bash
NODE_TLS_REJECT_UNAUTHORIZED='0' npx tsx -e "
import { Pool } from 'pg';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: false });
pool.query('SELECT COUNT(*) FROM company_fundamentals').then(r => console.log(r.rows[0]));
"
```

## Troubleshooting

### Panel doesn't open
- Check browser console for errors
- Verify API endpoint returns data: `curl http://localhost:3000/api/fundamentals/EQNR`
- Check state is updating: add `console.log` in `handleStockClick`

### No data shown
- Verify ticker exists in database
- Check API response in Network tab
- Ensure DATABASE_URL is set correctly

### Panel looks wrong
- Check CSS variables are defined in your theme
- Verify z-index doesn't conflict with other elements
- Check browser console for style errors

## Adding to Other Pages

You can use this panel on any page:

```typescript
// 1. Import
import StockFundamentalsPanel from "@/components/StockFundamentalsPanel";

// 2. Add state
const [ticker, setTicker] = useState("");
const [open, setOpen] = useState(false);

// 3. Add button/link
<button onClick={() => { setTicker("EQNR"); setOpen(true); }}>
  View Fundamentals
</button>

// 4. Add panel
<StockFundamentalsPanel
  ticker={ticker}
  isOpen={open}
  onClose={() => setOpen(false)}
/>
```

## Next Enhancements

Ideas for future improvements:

1. **Add Charts** - Show price history in panel
2. **Add Ratios** - Integrate Financial Modeling Prep API for P/E, ROE, etc.
3. **Add Analyst Ratings** - Show buy/hold/sell recommendations
4. **Add Comparison** - Compare multiple stocks side-by-side
5. **Add Watchlist** - Star button to add to watchlist
6. **Add News** - Show recent news for the company
7. **Add Keyboard Shortcuts** - ESC to close, arrow keys to navigate

## Mobile Responsiveness

The panel is already responsive:
- Width: `maxWidth: '90vw'` on mobile
- Slides in from right on all devices
- Touch-enabled overlay dismiss

## Performance

The panel:
- Only fetches data when opened
- Caches API responses (browser default)
- Uses React state for instant UI updates
- Minimal re-renders with proper state management

## Summary

The fundamentals panel provides a modern, non-disruptive way to view company details. Users stay on the stock list while getting detailed information in a smooth sliding panel. Perfect for quick reference and exploration.
