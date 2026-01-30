#!/usr/bin/env python3
"""
Fetch DNB Historical Data from Yahoo Finance using yfinance library

This is more reliable than scraping or direct API calls
"""
import os
import yfinance as yf
import psycopg2
from datetime import datetime
from dotenv import load_dotenv

load_dotenv()

def main():
    print("=" * 70)
    print("FETCH DNB HISTORICAL DATA FROM YAHOO FINANCE (yfinance)")
    print("=" * 70)
    print("\nUsing Python yfinance library\n")

    # Connect to database
    print("[1/4] Connecting to database...")
    conn = psycopg2.connect(os.environ['DATABASE_URL'])
    cur = conn.cursor()

    # Get existing dates
    cur.execute("""
        SELECT to_char(date, 'YYYY-MM-DD') as date_str
        FROM prices_daily
        WHERE ticker = 'DNB'
    """)
    existing_dates = set(row[0] for row in cur.fetchall())
    print(f"Found {len(existing_dates)} existing dates in database\n")

    # Fetch from Yahoo Finance
    print("[2/4] Fetching DNB.OL data from Yahoo Finance...")
    ticker = yf.Ticker("DNB.OL")

    # Get maximum history
    hist = ticker.history(period="max")

    print(f"Fetched {len(hist)} bars from Yahoo Finance")

    if len(hist) == 0:
        print("No data returned from Yahoo Finance. Aborting.")
        return

    print(f"  Date range: {hist.index[0].strftime('%Y-%m-%d')} to {hist.index[-1].strftime('%Y-%m-%d')}\n")

    # Filter out existing dates
    print("[3/4] Filtering data...")
    new_bars = []
    for idx, row in hist.iterrows():
        date_str = idx.strftime('%Y-%m-%d')
        if date_str not in existing_dates:
            new_bars.append({
                'date': date_str,
                'open': float(row['Open']),
                'high': float(row['High']),
                'low': float(row['Low']),
                'close': float(row['Close']),
                'volume': int(row['Volume']),
                'adj_close': float(row['Close'])  # yfinance returns adjusted prices by default
            })

    print(f"Found {len(new_bars)} new dates to insert")
    print(f"  ({len(existing_dates)} dates already exist)\n")

    if len(new_bars) == 0:
        print("No new data to insert. Database is up to date.")
        return

    # Insert new data
    print("[4/4] Inserting new data into database...")
    print(f"Inserting {len(new_bars)} price records from Yahoo Finance...\n")

    inserted = 0
    for i, bar in enumerate(new_bars):
        cur.execute("""
            INSERT INTO prices_daily (ticker, date, open, high, low, close, volume, adj_close, source)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, 'yahoo')
            ON CONFLICT (ticker, date, source) DO UPDATE SET
                open = EXCLUDED.open,
                high = EXCLUDED.high,
                low = EXCLUDED.low,
                close = EXCLUDED.close,
                volume = EXCLUDED.volume,
                adj_close = EXCLUDED.adj_close
        """, (
            'DNB',
            bar['date'],
            bar['open'],
            bar['high'],
            bar['low'],
            bar['close'],
            bar['volume'],
            bar['adj_close']
        ))
        inserted += 1

        if (i + 1) % 500 == 0:
            print(f"  Progress: {i + 1}/{len(new_bars)} rows inserted...")

    conn.commit()

    print(f"\nDatabase update complete!")
    print(f"  New records inserted: {inserted}")
    print(f"  Source: Yahoo Finance (yahoo)")

    # Get final statistics
    cur.execute("""
        SELECT
            COUNT(*) as total_rows,
            MIN(date) as start_date,
            MAX(date) as end_date,
            COUNT(DISTINCT source) as sources
        FROM prices_daily
        WHERE ticker = 'DNB'
    """)
    stats = cur.fetchone()

    start_date = stats[1].strftime('%Y-%m-%d')
    end_date = stats[2].strftime('%Y-%m-%d')
    years = (stats[2] - stats[1]).days / 365.0

    print("\n" + "=" * 70)
    print("UPDATED DNB METRICS")
    print("=" * 70)
    print(f"Start Date: {start_date}")
    print(f"End Date: {end_date}")
    print(f"Total Rows: {stats[0]}")
    print(f"Years of History: {years:.1f} years")
    print(f"Data Sources: {stats[3]} (IBKR + Yahoo Finance)")

    print("\nDNB historical data successfully extended!")

    cur.close()
    conn.close()
    print("\nDisconnected from database")

if __name__ == "__main__":
    main()
