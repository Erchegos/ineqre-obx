#!/usr/bin/env python3
"""
Resolve Oslo Børs tickers to IB contract IDs using TWS API
"""
import asyncio
from ib_insync import IB, Stock, Index, util

# OBX constituents
TICKERS = [
    "OBX",     # Index
    "EQNR",    # Equinor
    "DNB",     # DNB Bank
    "MOWI",    # Mowi
    "NHY",     # Norsk Hydro
    "TEL",     # Telenor
    "YAR",     # Yara International
    "AKER",    # Aker
    "SALM",    # SalMar
    "ORK",     # Orkla
    "AKRBP",   # Aker BP
    "STB",     # Storebrand
    "SUBSEA",  # Subsea 7
    "KAHOT",   # Kahoot
    "GOGL",    # Golden Ocean Group
    "MPCC",    # MPC Container Ships
    "PGS",     # Petroleum Geo-Services
    "XXL",     # XXL ASA
    "SCATC",   # Scatec
    "GJF",     # Gjensidige
    "TGS",     # TGS
]

async def resolve_contracts():
    ib = IB()
    
    try:
        # Connect to TWS
        await ib.connectAsync('127.0.0.1', 4001, clientId=1)
        print("✓ Connected to TWS\n")
        
        results = []
        
        for ticker in TICKERS:
            print(f"Searching: {ticker}...")
            
            try:
                # Try as stock first
                if ticker == "OBX":
                    # OBX is an index
                    contract = Index(ticker, "OSE", "NOK")
                else:
                    # Regular stock
                    contract = Stock(ticker, "OSE", "NOK")
                
                # Qualify the contract
                qualified = await ib.qualifyContractsAsync(contract)
                
                if qualified:
                    c = qualified[0]
                    print(f"  ✓ Found: conid={c.conId}, name={c.localSymbol}")
                    results.append({
                        "ticker": ticker,
                        "conid": c.conId,
                        "symbol": c.localSymbol,
                        "exchange": c.exchange,
                        "currency": c.currency,
                    })
                else:
                    print(f"  ✗ Not found")
                    results.append({"ticker": ticker, "conid": None})
                
                # Rate limiting
                await asyncio.sleep(0.1)
                
            except Exception as e:
                print(f"  ✗ Error: {e}")
                results.append({"ticker": ticker, "conid": None})
        
        # Summary
        print("\n=== Summary ===\n")
        successful = [r for r in results if r["conid"] is not None]
        failed = [r for r in results if r["conid"] is None]
        
        print(f"✓ Resolved: {len(successful)}/{len(results)}")
        print(f"✗ Failed: {len(failed)}/{len(results)}\n")
        
        if failed:
            print("Failed tickers:")
            for r in failed:
                print(f"  - {r['ticker']}")
            print()
        
        # Print mapping
        print("=== Contract Mapping ===")
        for r in successful:
            print(f"{r['ticker']}: {r['conid']}")
        
    finally:
        ib.disconnect()

if __name__ == "__main__":
    asyncio.run(resolve_contracts())
