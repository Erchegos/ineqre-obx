#!/usr/bin/env python3
"""
Test all tickers from obx-tickers.ts to see which ones work with IBKR
"""
import asyncio
import os
import sys
from ib_insync import IB, Stock, Index

# All tickers from obx-tickers.ts
TICKERS = [
    "OBX",
    # Core verified tickers (36)
    "AFG", "AKER", "AKRBP", "ATEA", "AUSS", "AUTO", "BAKKA", "BRG", "BWLPG",
    "CADLR", "DNB", "ELK", "ENTRA", "EQNR", "FRO", "GJF", "HAVI", "HEX",
    "KIT", "KOG", "MPCC", "MOWI", "NAS", "NHY", "NOD", "ORK", "RECSI",
    "SALM", "SCATC", "SUBC", "TECH", "TGS", "TIETO", "VAR", "VEI", "YAR",
    # Additional tickers to test (22)
    "CMBTO", "DOFG", "HAFNI", "HAUTO", "LSG", "MING", "ODL", "OLT",
    "PROT", "SB1NO", "SBNOR", "SNI", "SPOL", "STB", "SWON", "TEL",
    "TOM", "VENDA", "VENDB", "WAWI", "WWI", "WWIB"
]

async def test_ticker(ib, ticker):
    """Test if ticker can be resolved on IBKR"""
    try:
        if ticker == "OBX":
            contract = Index(ticker, "OSE", "NOK")
        else:
            contract = Stock(ticker, "OSE", "NOK")

        qualified = await ib.qualifyContractsAsync(contract)
        if qualified:
            return {"ticker": ticker, "success": True}
        else:
            return {"ticker": ticker, "success": False, "error": "Not found"}
    except Exception as e:
        return {"ticker": ticker, "success": False, "error": str(e)}

async def main():
    print("=== Testing All Tickers ===\n")

    ib = IB()
    try:
        await ib.connectAsync('127.0.0.1', 4002, clientId=3)
        print("✓ Connected to IB Gateway\n")
    except:
        await ib.connectAsync('127.0.0.1', 4001, clientId=3)
        print("✓ Connected to TWS\n")

    working = []
    failed = []

    for ticker in TICKERS:
        print(f"Testing {ticker}...", end=" ")
        result = await test_ticker(ib, ticker)

        if result["success"]:
            print("✓")
            working.append(ticker)
        else:
            print(f"✗ ({result.get('error', 'unknown')})")
            failed.append(ticker)

        await asyncio.sleep(0.5)

    ib.disconnect()

    print("\n=== Results ===")
    print(f"\n✓ Working ({len(working)}):")
    print(", ".join(working))

    print(f"\n✗ Failed ({len(failed)}):")
    print(", ".join(failed))

    print(f"\nTotal: {len(TICKERS)} tested, {len(working)} working, {len(failed)} failed")

    # Generate Python list for daily-update.py
    print("\n=== Copy this to daily-update.py ===")
    print("TICKERS = [")
    for i in range(0, len(working), 8):
        chunk = working[i:i+8]
        formatted = ", ".join(f'"{t}"' for t in chunk)
        print(f'    {formatted},')
    print("]")

if __name__ == "__main__":
    asyncio.run(main())
