#!/usr/bin/env python3
"""
Fetch 10 years of historical data from TWS and load into prices_daily
"""
import asyncio
import os
import sys
from datetime import datetime, timedelta
from ib_insync import IB, Stock, Index, util
import psycopg2
from psycopg2.extras import execute_batch
from dotenv import load_dotenv

# Load environment variables from .env.local
load_dotenv('.env.local')

DATABASE_URL = os.environ.get("DATABASE_URL") or os.environ.get("SUPABASE_DATABASE_URL")
if not DATABASE_URL:
    print("ERROR: DATABASE_URL or SUPABASE_DATABASE_URL environment variable required")
    sys.exit(1)

TICKERS = [
    "OBX", "EQNR", "DNB", "MOWI", "NHY", "TEL", "YAR", "AKER",
    "SALM", "ORK", "AKRBP", "STB", "MPCC", "SCATC", "GJF", "TGS"
]

def upsert_bars(conn, ticker, bars):
    """Insert bars into prices_daily table"""
    if not bars:
        return 0
    
    query = """
        INSERT INTO prices_daily 
            (ticker, date, open, high, low, close, adj_close, volume, source)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (ticker, date) DO UPDATE SET
            open = EXCLUDED.open,
            high = EXCLUDED.high,
            low = EXCLUDED.low,
            close = EXCLUDED.close,
            volume = EXCLUDED.volume,
            source = EXCLUDED.source
    """
    
    data = []
    for bar in bars:
        data.append((
            ticker.upper(),
            bar.date.strftime('%Y-%m-%d'),
            float(bar.open),
            float(bar.high),
            float(bar.low),
            float(bar.close),
            None,  # adj_close
            int(bar.volume),
            'ibkr'
        ))
    
    with conn.cursor() as cur:
        execute_batch(cur, query, data, page_size=1000)
        conn.commit()
    
    return len(data)

async def fetch_ticker_data(ib, ticker):
    """Fetch historical data for a single ticker"""
    try:
        print(f"\n[{ticker}] Resolving contract...")
        
        # Create contract
        if ticker == "OBX":
            contract = Index(ticker, "OSE", "NOK")
        else:
            contract = Stock(ticker, "OSE", "NOK")
        
        # Qualify
        qualified = await ib.qualifyContractsAsync(contract)
        if not qualified:
            return {"ticker": ticker, "success": False, "error": "Contract not found"}
        
        contract = qualified[0]
        print(f"[{ticker}] Found conid={contract.conId}")
        
        # Request 10 years of daily bars
        print(f"[{ticker}] Fetching 10 years of daily data...")
        
        bars = await ib.reqHistoricalDataAsync(
            contract,
            endDateTime='',
            durationStr='10 Y',
            barSizeSetting='1 day',
            whatToShow='TRADES',
            useRTH=True,
            formatDate=1
        )
        
        print(f"[{ticker}] Received {len(bars)} bars")
        
        return {
            "ticker": ticker,
            "success": True,
            "bars": bars,
            "count": len(bars)
        }
        
    except Exception as e:
        print(f"[{ticker}] ✗ Error: {e}")
        return {"ticker": ticker, "success": False, "error": str(e)}

async def main():
    print("=== TWS Historical Backfill ===\n")
    
    # Connect to TWS
    ib = IB()
    await ib.connectAsync('127.0.0.1', 4001, clientId=1)
    print("✓ Connected to TWS")
    
    # Connect to database
    print("✓ Connecting to database...")
    conn = psycopg2.connect(DATABASE_URL, sslmode='require')
    print("✓ Database connected\n")
    
    results = []
    
    try:
        for ticker in TICKERS:
            result = await fetch_ticker_data(ib, ticker)
            results.append(result)
            
            if result["success"]:
                count = upsert_bars(conn, ticker, result["bars"])
                print(f"[{ticker}] ✓ Upserted {count} records")
            
            # Rate limiting - TWS has strict limits
            print(f"[{ticker}] Waiting 11 seconds (rate limit)...")
            await asyncio.sleep(11)
        
        # Summary
        print("\n=== Backfill Summary ===\n")
        successful = [r for r in results if r["success"]]
        failed = [r for r in results if not r["success"]]
        total_bars = sum(r.get("count", 0) for r in successful)
        
        print(f"✓ Successful: {len(successful)}/{len(results)}")
        print(f"✗ Failed: {len(failed)}/{len(results)}")
        print(f"Total bars: {total_bars:,}\n")
        
        if failed:
            print("Failed tickers:")
            for r in failed:
                print(f"  - {r['ticker']}: {r.get('error', 'Unknown')}")
            print()
        
        # Database stats
        with conn.cursor() as cur:
            cur.execute("""
                SELECT 
                    source,
                    COUNT(*) as rows,
                    COUNT(DISTINCT ticker) as tickers,
                    MIN(date)::text as earliest,
                    MAX(date)::text as latest
                FROM prices_daily
                GROUP BY source
                ORDER BY source
            """)
            
            print("=== Database Stats ===\n")
            for row in cur.fetchall():
                print(f"Source: {row[0]}")
                print(f"  Tickers: {row[2]}")
                print(f"  Rows: {row[1]:,}")
                print(f"  Range: {row[3]} to {row[4]}\n")
        
    finally:
        conn.close()
        ib.disconnect()

if __name__ == "__main__":
    asyncio.run(main())
