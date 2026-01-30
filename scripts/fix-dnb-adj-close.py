#!/usr/bin/env python3
"""Fix DNB adjusted close prices with proper dividend adjustments"""
import yfinance as yf
import psycopg2
import numpy as np
import sys

DATABASE_URL = "postgresql://postgres.gznnailatxljhfadbwxr:Su.201712949340@aws-1-us-east-1.pooler.supabase.com:6543/postgres?sslmode=require"

print("Fetching DNB.OL with dividends...", flush=True)
ticker = yf.Ticker("DNB.OL")
hist = ticker.history(period="max", actions=True)
print(f"Got {len(hist)} rows", flush=True)

# Calculate adjustment factors for dividends
print("\nCalculating dividend-adjusted prices...", flush=True)

close_prices = hist['Close'].values.copy()
dividends = hist['Dividends'].values

# Calculate cumulative adjustment factor (backwards)
adj_factors = np.ones(len(hist))

# Work backwards through the data
for i in range(len(hist) - 2, -1, -1):
    if dividends[i + 1] > 0:
        adj_ratio = (close_prices[i + 1] - dividends[i + 1]) / close_prices[i + 1]
        adj_factors[i] = adj_factors[i + 1] * adj_ratio
    else:
        adj_factors[i] = adj_factors[i + 1]

# Calculate adjusted close
adj_close = close_prices * adj_factors

# Scale to match IBKR
dates = [d.strftime('%Y-%m-%d') for d in hist.index]
try:
    idx_2021_07_01 = dates.index('2021-07-01')
    yahoo_adj_close_at_transition = adj_close[idx_2021_07_01]
    ibkr_close = 186.85
    scale_factor = ibkr_close / yahoo_adj_close_at_transition
    print(f"Yahoo adj_close at 2021-07-01: {yahoo_adj_close_at_transition:.4f}", flush=True)
    print(f"Scale factor: {scale_factor:.6f}", flush=True)
except ValueError:
    scale_factor = 1.376379
    print(f"Using fallback scale factor: {scale_factor:.6f}", flush=True)

adj_close_scaled = adj_close * scale_factor

# Connect to database
print("\nConnecting to database...", flush=True)
conn = psycopg2.connect(DATABASE_URL)
cur = conn.cursor()

# Batch update using a temp approach - prepare all updates
print("Preparing batch update...", flush=True)
updates = []
for i, (idx, row) in enumerate(hist.iterrows()):
    date_str = idx.strftime('%Y-%m-%d')
    adj_close_val = float(adj_close_scaled[i])
    updates.append((adj_close_val, 'DNB', 'yahoo', date_str))

print(f"Updating {len(updates)} rows...", flush=True)

# Execute batch
cur.executemany("""
    UPDATE prices_daily
    SET adj_close = %s
    WHERE ticker = %s AND source = %s AND date = %s
""", updates)

conn.commit()
print(f"Updated rows: {cur.rowcount}", flush=True)

# Verify
print("\nVerifying transition (adj_close):", flush=True)
cur.execute("""
    SELECT date, close, adj_close, source FROM prices_daily
    WHERE ticker = 'DNB' AND date BETWEEN '2021-06-28' AND '2021-07-08'
    ORDER BY date
""")
for row in cur.fetchall():
    print(f"  {row[0]}: close={float(row[1]):.2f}, adj_close={float(row[2]):.2f} ({row[3]})", flush=True)

# Show sample of early data
print("\nSample early data (2000):", flush=True)
cur.execute("""
    SELECT date, close, adj_close FROM prices_daily
    WHERE ticker = 'DNB' AND date < '2000-02-01'
    ORDER BY date LIMIT 5
""")
for row in cur.fetchall():
    print(f"  {row[0]}: close={float(row[1]):.2f}, adj_close={float(row[2]):.2f}", flush=True)

conn.close()
print("\nDone!", flush=True)
