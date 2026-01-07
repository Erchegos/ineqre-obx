#!/usr/bin/env python3
"""
clean_euronext_csvs.py

Purpose
- Read multiple Euronext "Historical Data" CSV exports (one file per equity)
- Auto-detect header row + delimiter
- Normalize schema
- Output:
  1) One consolidated file: obx_equities.clean.csv
  2) One cleaned file per ticker (optional switch)

Usage
- Default (consolidated only):
  python3 tools/clean_euronext_csvs.py

- Specify input and output:
  python3 tools/clean_euronext_csvs.py \
    --in-dir "/Users/olaslettebak/Documents/Intelligence Equity Research /CSV_OBX_Equity" \
    --out-dir "/Users/olaslettebak/Documents/Intelligence Equity Research /CSV_OBX_Equity_CLEAN"

- Also write per-ticker cleaned CSVs:
  python3 tools/clean_euronext_csvs.py --write-per-ticker

Notes
- Handles BOM, quoted headers, ";" vs "," separators, non-data preamble lines.
- Parses dates as day-first.
- Drops rows without a valid date.
"""

from __future__ import annotations

import argparse
import csv
import glob
import os
import re
import sys
from typing import Optional, Tuple, List

import pandas as pd


DEFAULT_IN_DIR = "/Users/olaslettebak/Documents/Intelligence Equity Research /CSV_OBX_Equity"
DEFAULT_OUT_DIR = "/Users/olaslettebak/Documents/Intelligence Equity Research /CSV_OBX_Equity_CLEAN"


# Target schema for downstream work
TARGET_COLS = [
    "date",
    "open",
    "high",
    "low",
    "close",
    "number_of_shares",
    "number_of_trades",
    "turnover",
    "vwap",
    "ticker",
]


def normalize_col_name(col: str) -> str:
    c = col.strip().lower()
    c = c.replace("\ufeff", "")  # BOM
    c = c.replace("\u200b", "")  # zero width
    c = re.sub(r"\s+", "_", c)
    c = re.sub(r"[^a-z0-9_]", "", c)
    return c


def detect_header_and_sep(path: str, scan_lines: int = 200) -> Tuple[Optional[int], Optional[str]]:
    """
    Detect header row and delimiter by scanning the first N lines.
    We want the line that contains 'Date' and at least one of Open/Close/Last.
    """
    with open(path, "r", encoding="utf-8-sig", errors="ignore") as f:
        lines = f.readlines()

    def score_header(line: str) -> int:
        l = line.strip()
        if not l:
            return 0
        low = l.lower().replace('"', "").replace("'", "")
        s = 0
        if "date" in low:
            s += 3
        if "open" in low:
            s += 2
        if "high" in low:
            s += 1
        if "low" in low:
            s += 1
        if "close" in low:
            s += 2
        if "last" in low:
            s += 2
        if "turnover" in low:
            s += 1
        if "vwap" in low:
            s += 1
        return s

    best_i = None
    best_score = 0
    best_sep = None

    for i, raw in enumerate(lines[:scan_lines]):
        line = raw.strip()
        sc = score_header(line)
        if sc >= 5 and sc > best_score:
            # delimiter guess
            sep = None
            # choose the delimiter that yields more fields
            candidates = [(";", line.count(";")), (",", line.count(",")), ("\t", line.count("\t"))]
            candidates.sort(key=lambda x: x[1], reverse=True)
            if candidates[0][1] > 0:
                sep = candidates[0][0]
            else:
                # fallback to sniff
                try:
                    sep = csv.Sniffer().sniff(line).delimiter
                except Exception:
                    sep = ","

            best_i = i
            best_score = sc
            best_sep = sep

    return best_i, best_sep


def read_euronext_csv(path: str) -> pd.DataFrame:
    header_idx, sep = detect_header_and_sep(path)
    if header_idx is None or sep is None:
        raise ValueError("Could not detect header row / delimiter")

    df = pd.read_csv(
        path,
        skiprows=header_idx,
        sep=sep,
        encoding="utf-8-sig",
        engine="python",
    )

    # Normalize column names
    df.columns = [normalize_col_name(c) for c in df.columns]

    # Typical Euronext columns are:
    # date, open, high, low, last, close, number_of_shares, number_of_trades, turnover, vwap
    # Sometimes "close" is absent and "last" is the close.
    if "close" not in df.columns and "last" in df.columns:
        df["close"] = df["last"]

    # If "date" is missing, bail out
    if "date" not in df.columns:
        raise ValueError("Missing date column after parsing")

    # Ensure all expected fields exist
    for c in ["open", "high", "low", "close", "number_of_shares", "number_of_trades", "turnover", "vwap"]:
        if c not in df.columns:
            df[c] = pd.NA

    df = df[["date", "open", "high", "low", "close", "number_of_shares", "number_of_trades", "turnover", "vwap"]].copy()

    # Parse date day-first (Euronext export uses dd/mm/yyyy)
    df["date"] = pd.to_datetime(df["date"], dayfirst=True, errors="coerce")
    df = df.dropna(subset=["date"])

    # Convert numerics (handles blanks)
    for c in ["open", "high", "low", "close", "number_of_shares", "number_of_trades", "turnover", "vwap"]:
        df[c] = pd.to_numeric(df[c], errors="coerce")

    return df


def main(argv: List[str]) -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--in-dir", default=DEFAULT_IN_DIR, help="Directory with raw Euronext CSV exports")
    p.add_argument("--out-dir", default=DEFAULT_OUT_DIR, help="Output directory")
    p.add_argument("--out-file", default="obx_equities.clean.csv", help="Consolidated output filename")
    p.add_argument("--write-per-ticker", action="store_true", help="Also write one cleaned csv per ticker")
    args = p.parse_args(argv)

    in_dir = args.in_dir
    out_dir = args.out_dir
    out_path = os.path.join(out_dir, args.out_file)

    os.makedirs(out_dir, exist_ok=True)

    files = sorted(glob.glob(os.path.join(in_dir, "*.csv")))
    print("IN_DIR:", in_dir)
    print("CSV files:", len(files))
    if not files:
        print("No csv files found.")
        return 2

    all_rows = []
    skipped = []
    for f in files:
        ticker = os.path.splitext(os.path.basename(f))[0].upper()
        try:
            df = read_euronext_csv(f)
            df["ticker"] = ticker
            all_rows.append(df)

            if args.write_per_ticker:
                per_path = os.path.join(out_dir, f"{ticker}.clean.csv")
                df.to_csv(per_path, index=False)
        except Exception as e:
            skipped.append((ticker, f, str(e)))
            continue

    out = (
        pd.concat(all_rows, ignore_index=True)
        if all_rows
        else pd.DataFrame(columns=TARGET_COLS)
    )

    # Enforce final column order
    for c in TARGET_COLS:
        if c not in out.columns:
            out[c] = pd.NA
    out = out[TARGET_COLS].copy()

    out.to_csv(out_path, index=False)

    print("Skipped:", len(skipped))
    if skipped:
        print("Skip details:")
        for t, f, err in skipped[:50]:
            print(" -", t, "=>", err)
        if len(skipped) > 50:
            print(" - (more skipped not shown)")

    print("Total rows:", len(out))
    print("Wrote:", out_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
