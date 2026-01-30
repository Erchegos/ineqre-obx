#!/usr/bin/env python3
"""Import DNB data from CSV to database"""
import csv
import psycopg2
import sys

DATABASE_URL = "postgresql://postgres.gznnailatxljhfadbwxr:Su.201712949340@aws-1-us-east-1.pooler.supabase.com:6543/postgres?sslmode=require"

print("Connecting to database...", flush=True)
conn = psycopg2.connect(DATABASE_URL)
cur = conn.cursor()
print("Connected!", flush=True)

# Get existing dates
cur.execute("SELECT to_char(date, 'YYYY-MM-DD') FROM prices_daily WHERE ticker = 'DNB'")
existing_dates = set(row[0] for row in cur.fetchall())
print(f"Found {len(existing_dates)} existing dates", flush=True)

# Read CSV and insert
print("Reading CSV and inserting...", flush=True)
new_count = 0
with open('/tmp/dnb_yahoo.csv', 'r') as f:
    reader = csv.DictReader(f)
    batch = []
    for row in reader:
        date_str = row['Date'][:10]

        if date_str in existing_dates:
            continue

        batch.append((
            'DNB',
            date_str,
            float(row['Open']),
            float(row['High']),
            float(row['Low']),
            float(row['Close']),
            int(float(row['Volume'])),
            float(row['Close']),
            'yahoo'
        ))
        new_count += 1

        if len(batch) >= 500:
            cur.executemany("""
                INSERT INTO prices_daily (ticker, date, open, high, low, close, volume, adj_close, source)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (ticker, date, source) DO NOTHING
            """, batch)
            conn.commit()
            print(f"  Inserted {new_count} rows...", flush=True)
            batch = []

    if batch:
        cur.executemany("""
            INSERT INTO prices_daily (ticker, date, open, high, low, close, volume, adj_close, source)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (ticker, date, source) DO NOTHING
        """, batch)
        conn.commit()

print(f"\nInserted {new_count} new rows", flush=True)

# Final stats
cur.execute("SELECT COUNT(*), MIN(date), MAX(date) FROM prices_daily WHERE ticker = 'DNB'")
stats = cur.fetchone()
print(f"\nDNB Data Summary:", flush=True)
print(f"  Total rows: {stats[0]}", flush=True)
print(f"  Date range: {stats[1]} to {stats[2]}", flush=True)

cur.execute("SELECT source, COUNT(*) FROM prices_daily WHERE ticker = 'DNB' GROUP BY source")
for row in cur.fetchall():
    print(f"  {row[0]}: {row[1]} rows", flush=True)

conn.close()
print("\nDone!", flush=True)
