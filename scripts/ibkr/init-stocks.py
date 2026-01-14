#!/usr/bin/env python3
"""
Initialize stocks table with OBX tickers
"""
import psycopg2
import os
from dotenv import load_dotenv

load_dotenv('apps/web/.env.local')

DATABASE_URL = os.environ.get("DATABASE_URL") or os.environ.get("SUPABASE_DATABASE_URL")

TICKERS = [
    ("OBX", "OBX Index"),
    ("EQNR", "Equinor ASA"),
    ("DNB", "DNB Bank ASA"),
    ("MOWI", "Mowi ASA"),
    ("NHY", "Norsk Hydro ASA"),
    ("TEL", "Telenor ASA"),
    ("YAR", "Yara International ASA"),
    ("AKER", "Aker ASA"),
    ("SALM", "SalMar ASA"),
    ("ORK", "Orkla ASA"),
    ("AKRBP", "Aker BP ASA"),
    ("STB", "Storebrand ASA"),
    ("MPCC", "MPC Container Ships ASA"),
    ("SCATC", "Scatec ASA"),
    ("GJF", "Gjensidige Forsikring ASA"),
    ("TGS", "TGS ASA"),
]

conn = psycopg2.connect(DATABASE_URL, sslmode='require')

try:
    with conn.cursor() as cur:
        # Check current schema
        cur.execute("""
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'stocks'
            ORDER BY ordinal_position
        """)
        
        columns = [row[0] for row in cur.fetchall()]
        print(f"Stocks table columns: {columns}")
        
        # Insert tickers (ticker and name only)
        print("Inserting tickers...")
        for ticker, name in TICKERS:
            cur.execute("""
                INSERT INTO stocks (ticker, name)
                VALUES (%s, %s)
                ON CONFLICT (ticker) DO UPDATE SET
                    name = EXCLUDED.name
            """, (ticker, name))
        
        conn.commit()
        print(f"✓ Inserted {len(TICKERS)} tickers into stocks table")
        
        # Verify
        cur.execute("SELECT COUNT(*) FROM stocks WHERE ticker IN %s", 
                   (tuple(t[0] for t in TICKERS),))
        count = cur.fetchone()[0]
        print(f"✓ Verified {count} tickers in database")
        
finally:
    conn.close()
