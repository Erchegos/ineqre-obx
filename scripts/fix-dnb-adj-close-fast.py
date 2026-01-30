#!/usr/bin/env python3
"""Fix DNB adjusted close prices - fast version using single UPDATE"""
import yfinance as yf
import psycopg2
import numpy as np

DATABASE_URL = "postgresql://postgres.gznnailatxljhfadbwxr:Su.201712949340@aws-1-us-east-1.pooler.supabase.com:6543/postgres?sslmode=require"

print("Fetching DNB.OL with dividends...", flush=True)
ticker = yf.Ticker("DNB.OL")
hist = ticker.history(period="max", actions=True)
print(f"Got {len(hist)} rows", flush=True)

# Calculate adjustment factors for dividends
print("Calculating dividend-adjusted prices...", flush=True)

close_prices = hist['Close'].values.copy()
dividends = hist['Dividends'].values

adj_factors = np.ones(len(hist))
for i in range(len(hist) - 2, -1, -1):
    if dividends[i + 1] > 0:
        adj_ratio = (close_prices[i + 1] - dividends[i + 1]) / close_prices[i + 1]
        adj_factors[i] = adj_factors[i + 1] * adj_ratio
    else:
        adj_factors[i] = adj_factors[i + 1]

adj_close = close_prices * adj_factors

# Scale to match IBKR
dates = [d.strftime('%Y-%m-%d') for d in hist.index]
idx_2021_07_01 = dates.index('2021-07-01')
yahoo_adj_close_at_transition = adj_close[idx_2021_07_01]
ibkr_close = 186.85
scale_factor = ibkr_close / yahoo_adj_close_at_transition
print(f"Scale factor: {scale_factor:.6f}", flush=True)

adj_close_scaled = adj_close * scale_factor

# Connect and do bulk update
print("\nConnecting to database...", flush=True)
conn = psycopg2.connect(DATABASE_URL)
cur = conn.cursor()

# Build VALUES clause for bulk update
print("Building bulk update...", flush=True)
values_list = []
for i, (idx, row) in enumerate(hist.iterrows()):
    date_str = idx.strftime('%Y-%m-%d')
    adj_close_val = float(adj_close_scaled[i])
    values_list.append(f"('{date_str}'::date, {adj_close_val})")

# Split into chunks to avoid query size limits
chunk_size = 1000
total_updated = 0

for chunk_start in range(0, len(values_list), chunk_size):
    chunk_end = min(chunk_start + chunk_size, len(values_list))
    chunk = values_list[chunk_start:chunk_end]

    sql = f"""
        UPDATE prices_daily p
        SET adj_close = v.adj_close
        FROM (VALUES {','.join(chunk)}) AS v(date, adj_close)
        WHERE p.ticker = 'DNB'
          AND p.source = 'yahoo'
          AND p.date = v.date
    """
    cur.execute(sql)
    total_updated += cur.rowcount
    print(f"  Updated chunk {chunk_start//chunk_size + 1}: {cur.rowcount} rows", flush=True)

conn.commit()
print(f"\nTotal updated: {total_updated}", flush=True)

# Verify
print("\nVerifying transition:", flush=True)
cur.execute("""
    SELECT date, close, adj_close, source FROM prices_daily
    WHERE ticker = 'DNB' AND date BETWEEN '2021-06-28' AND '2021-07-08'
    ORDER BY date
""")
for row in cur.fetchall():
    print(f"  {row[0]}: close={float(row[1]):.2f}, adj_close={float(row[2]):.2f} ({row[3]})", flush=True)

print("\nSample early data:", flush=True)
cur.execute("""
    SELECT date, close, adj_close FROM prices_daily
    WHERE ticker = 'DNB' AND source = 'yahoo' AND date < '2000-02-01'
    ORDER BY date LIMIT 3
""")
for row in cur.fetchall():
    print(f"  {row[0]}: close={float(row[1]):.2f}, adj_close={float(row[2]):.2f}", flush=True)

conn.close()
print("\nDone!", flush=True)
