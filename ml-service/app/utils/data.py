"""
Shared database utilities for fetching price data.

Provides log-return series aligned for volatility model consumption.
"""

import os
import numpy as np
import pandas as pd
import psycopg2
import psycopg2.extras


def get_db_connection():
    """Get a psycopg2 connection using DATABASE_URL."""
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise RuntimeError("DATABASE_URL environment variable not set")
    return psycopg2.connect(url, cursor_factory=psycopg2.extras.RealDictCursor)


def fetch_returns(ticker: str, limit: int = 1260) -> pd.DataFrame:
    """
    Fetch daily OHLCV + compute log returns for a ticker.

    Returns DataFrame with columns:
        date, open, high, low, close, adj_close, volume, log_return
    Sorted ascending by date. NaN returns dropped.
    """
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT date, open, high, low, close, adj_close, volume
                FROM prices_daily
                WHERE ticker = %s
                  AND close IS NOT NULL
                  AND close > 0
                ORDER BY date DESC
                LIMIT %s
                """,
                (ticker, limit),
            )
            rows = cur.fetchall()
    finally:
        conn.close()

    if len(rows) < 30:
        raise ValueError(f"Insufficient data for {ticker}: {len(rows)} rows (need >= 30)")

    df = pd.DataFrame(rows)
    df["date"] = pd.to_datetime(df["date"])
    for col in ["open", "high", "low", "close", "adj_close", "volume"]:
        df[col] = pd.to_numeric(df[col], errors="coerce")

    df = df.sort_values("date").reset_index(drop=True)

    # Use adj_close if available, else close
    price_col = "adj_close" if df["adj_close"].notna().sum() > len(df) * 0.5 else "close"
    df["log_return"] = np.log(df[price_col] / df[price_col].shift(1))
    df = df.dropna(subset=["log_return"]).reset_index(drop=True)

    return df
