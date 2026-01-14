#!/usr/bin/env python3
"""
Fetch latest daily bar for all tickers and update database
"""
import asyncio
import os
import sys
from ib_insync import IB, Stock, Index
import psycopg2

DATABASE_URL = os.environ.get("DATABASE_URL")
if not DATABASE_URL:
    print("ERROR: DATABASE_URL environment variable required")
    sys.exit(1)

TICKERS = [
    "OBX", "EQNR", "DNB", "MOWI", "NHY", "TEL", "YAR", "AKER",
    "SALM", "ORK", "AKRBP", "STB", "SUBSEA", "KAHOT", "GOGL",
    "MPCC", "PGS", "XXL", "SCATC", "GJF", "TGS"
]

def upsert_bar(conn, ticker, bar):
    """Insert single bar into database"""
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
    
    with conn.cursor() as cur:
        cur.execute(query, (
            ticker.upper(),
            bar.date.strftime('%Y-%m-%d'),
            float(bar.open),
            float(bar.high),
            float(bar.low),
            float(bar.close),
            None,
            int(bar.volume),
            'ibkr'
        ))
        conn.commit()

async def update_ticker(ib, ticker):
    """Fetch and update latest bar for ticker"""
    try:
        # Create and qualify contract
        if ticker == "OBX":
            contract = Index(ticker, "OSE", "NOK")
        else:
            contract = Stock(ticker, "OSE", "NOK")
        
        qualified = await ib.qualifyContractsAsync(contract)
        if not qualified:
            return {"ticker": ticker, "success": False, "error": "Not found"}
        
        # Fetch last 5 days to ensure we get latest
        bars = await ib.reqHistoricalDataAsync(
            qualified[0],
            endDateTime='',
            durationStr='5 D',
            barSizeSetting='1 day',
            whatToShow='TRADES',
            useRTH=True,
            formatDate=1
        )
        
        if not bars:
            return {"ticker": ticker, "success": False, "error": "No data"}
        
        # Return latest bar
        latest = bars[-1]
        return {
            "ticker": ticker,
            "success": True,
            "bar": latest,
            "date": latest.date.strftime('%Y-%m-%d')
        }
        
    except Exception as e:
        return {"ticker": ticker, "success": False, "error": str(e)}

async def main():
    print("=== TWS Daily Update ===")
    print(f"Time: {datetime.now().isoformat()}\n")
    
    ib = IB()
    await ib.connectAsync('127.0.0.1', 4001, clientId=1)
    print("✓ Connected to TWS")
    
    conn = psycopg2.connect(DATABASE_URL, sslmode='require')
    print("✓ Database connected\n")
    
    results = []
    
    try:
        for ticker in TICKERS:
            print(f"[{ticker}] Updating...")
            result = await update_ticker(ib, ticker)
            results.append(result)
            
            if result["success"]:
                upsert_bar(conn, ticker, result["bar"])
                print(f"[{ticker}] ✓ Updated: {result['date']}")
            else:
                print(f"[{ticker}] ✗ Failed: {result['error']}")
            
            await asyncio.sleep(1)
        
        # Summary
        print("\n=== Update Summary ===\n")
        successful = [r for r in results if r["success"]]
        failed = [r for r in results if not r["success"]]
        
        print(f"✓ Successful: {len(successful)}/{len(results)}")
        print(f"✗ Failed: {len(failed)}/{len(results)}")
        
        if failed:
            print("\nFailed tickers:")
            for r in failed:
                print(f"  - {r['ticker']}: {r['error']}")
        
    finally:
        conn.close()
        ib.disconnect()

if __name__ == "__main__":
    from datetime import datetime
    asyncio.run(main())
