#!/usr/bin/env python3
"""
Alpha Engine — Comprehensive ML Training Pipeline v4
======================================================
Major improvements over v3:
  - Cross-sectional rank target (more stable than raw returns)
  - CatBoost added to ensemble (XGB 35% / LGBM 35% / CatBoost 30%)
  - Multi-horizon targets (5D, 21D) trained simultaneously
  - Feature selection via importance pruning (top 40 features)
  - Proper early stopping with holdout
  - Transaction cost model in evaluation (10bps spread + 5bps commission)
  - OSE-specific factors: oil beta, NOK sensitivity, short interest
  - Test mode (--test) runs on 15 liquid stocks for fast iteration

Usage:
  python alpha_trainer.py              # Full run (all stocks)
  python alpha_trainer.py --test       # Test on 15 liquid stocks
  python alpha_trainer.py --evaluate-only  # Evaluate only
"""

import os
import sys
import json
import warnings
import argparse

# Unbuffered output for progress tracking
sys.stdout = os.fdopen(sys.stdout.fileno(), 'w', 1)  # line-buffered
from datetime import datetime, timedelta
from typing import Optional, List

import numpy as np
import pandas as pd
import psycopg2
from psycopg2.extras import execute_values
import xgboost as xgb
import lightgbm as lgbm
from sklearn.metrics import mean_absolute_error
from scipy import stats

warnings.filterwarnings("ignore", category=FutureWarning)
warnings.filterwarnings("ignore", category=UserWarning)

# Try CatBoost
try:
    from catboost import CatBoostRegressor
    HAS_CATBOOST = True
except ImportError:
    HAS_CATBOOST = False
    print("  [WARN] CatBoost not installed — using XGB/LGBM only")

# Test tickers: most liquid OSE stocks across sectors
TEST_TICKERS = [
    'EQNR', 'DNB', 'MOWI', 'NHY', 'TEL', 'AKRBP', 'YAR', 'ORK',
    'FRO', 'SALM', 'LSG', 'SUBC', 'DNO', 'GOGL', 'GSF',
]

# Transaction costs
SPREAD_BPS = 10   # 10bps spread
COMMISSION_BPS = 5  # 5bps commission
TOTAL_COST_BPS = SPREAD_BPS + COMMISSION_BPS  # 15bps one-way, 30bps round-trip

# ============================================================================
# Database connection
# ============================================================================

def get_connection():
    """Connect to Supabase PostgreSQL."""
    for envpath in ['.env.local', '../apps/web/.env.local', '../../apps/web/.env.local']:
        if os.path.exists(envpath):
            with open(envpath) as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith('#') and '=' in line:
                        key, val = line.split('=', 1)
                        os.environ.setdefault(key.strip(), val.strip().strip('"').strip("'"))

    db_url = os.environ.get('DATABASE_URL', '')
    if not db_url:
        raise ValueError("DATABASE_URL not set")

    import urllib.parse
    parsed = urllib.parse.urlparse(db_url)
    conn = psycopg2.connect(
        host=parsed.hostname,
        port=parsed.port or 5432,
        dbname=parsed.path.lstrip('/'),
        user=parsed.username,
        password=urllib.parse.unquote(parsed.password or ''),
        sslmode='require',
    )
    return conn


# ============================================================================
# Data Loading
# ============================================================================

def load_all_data(conn, test_mode=False) -> dict:
    """Load all data needed for feature engineering."""
    print("\n[1/6] LOADING DATA")
    print("=" * 60)

    ticker_filter = ""
    if test_mode:
        tickers_str = ",".join(f"'{t}'" for t in TEST_TICKERS + ['OBX'])
        ticker_filter = f"AND ticker IN ({tickers_str})"
        print(f"  TEST MODE: {len(TEST_TICKERS)} tickers")

    # Prices
    print("  Loading prices...")
    prices = pd.read_sql(f"""
        SELECT ticker, date, open, high, low, close, volume
        FROM prices_daily
        WHERE close > 0 {ticker_filter}
        ORDER BY ticker, date
    """, conn, parse_dates=['date'])
    print(f"    → {len(prices):,} price rows, {prices.ticker.nunique()} tickers")

    # Filter to stocks with enough history
    good_tickers = prices.groupby('ticker').size()
    good_tickers = good_tickers[good_tickers >= 252].index.tolist()
    prices = prices[prices.ticker.isin(good_tickers)]
    print(f"    → {len(good_tickers)} tickers with ≥1yr data")

    # Stocks metadata
    stocks = pd.read_sql("SELECT ticker, name, sector FROM stocks", conn)

    # Fundamentals
    print("  Loading fundamentals...")
    fund_filter = ""
    if test_mode:
        fund_tickers = ",".join(f"'{t}'" for t in TEST_TICKERS)
        fund_filter = f"AND ticker IN ({fund_tickers})"
    fundamentals = pd.read_sql(f"""
        SELECT ticker, date, bm, ep, dy, sp, mktcap
        FROM factor_fundamentals
        WHERE date IS NOT NULL {fund_filter}
        ORDER BY ticker, date
    """, conn, parse_dates=['date'])
    print(f"    → {len(fundamentals):,} fundamental rows")

    # Commodity prices
    print("  Loading commodities...")
    commodities = pd.read_sql("""
        SELECT symbol, date, close FROM commodity_prices
        WHERE close > 0
        ORDER BY symbol, date
    """, conn, parse_dates=['date'])
    print(f"    → {len(commodities):,} commodity rows, {commodities.symbol.nunique()} symbols")

    # Commodity sensitivities
    sensitivities = pd.read_sql("""
        SELECT ticker, commodity_symbol, beta, r_squared, correlation_252d
        FROM commodity_stock_sensitivity
    """, conn)
    print(f"    → {len(sensitivities):,} sensitivity rows")

    # Short positions
    print("  Loading shorts...")
    short_filter = ""
    if test_mode:
        short_tickers = ",".join(f"'{t}'" for t in TEST_TICKERS)
        short_filter = f"AND ticker IN ({short_tickers})"
    shorts = pd.read_sql(f"""
        SELECT ticker, date, short_pct, change_pct, active_positions
        FROM short_positions
        WHERE TRUE {short_filter}
        ORDER BY ticker, date
    """, conn, parse_dates=['date'])
    print(f"    → {len(shorts):,} short position rows")

    # Shipping rates (BDI etc.)
    print("  Loading market rates...")
    rates = pd.read_sql("""
        SELECT index_name, rate_date AS date, rate_value AS value FROM shipping_market_rates
        WHERE index_name IN ('BDI', 'BDTI', 'BCTI')
        ORDER BY rate_date
    """, conn, parse_dates=['date'])
    print(f"    → {len(rates):,} market rate rows")

    # FX rates (NOK sensitivity)
    print("  Loading FX rates...")
    fx = pd.read_sql("""
        SELECT currency_pair AS pair, date, spot_rate AS rate FROM fx_spot_rates
        WHERE currency_pair IN ('NOKUSD', 'NOKEUR')
        ORDER BY date
    """, conn, parse_dates=['date'])
    print(f"    → {len(fx):,} FX rate rows")

    # OBX index
    obx = prices[prices.ticker == 'OBX'][['date', 'close']].rename(columns={'close': 'obx_close'})

    return {
        'prices': prices,
        'stocks': stocks,
        'fundamentals': fundamentals,
        'commodities': commodities,
        'sensitivities': sensitivities,
        'shorts': shorts,
        'rates': rates,
        'fx': fx,
        'obx': obx,
        'good_tickers': good_tickers,
    }


# ============================================================================
# Feature Engineering — Focused & Effective
# ============================================================================

def engineer_features(data: dict) -> pd.DataFrame:
    """Build feature matrix — focused on features that actually predict."""
    print("\n[2/6] ENGINEERING FEATURES")
    print("=" * 60)

    prices = data['prices'].copy()
    obx = data['obx'].copy()

    all_features = []

    # Pivot commodities for merge
    commodity_pivoted = {}
    for sym in ['BZ=F', 'CL=F', 'GC=F', 'ALI=F', 'NG=F', 'HG=F']:
        cdf = data['commodities'][data['commodities'].symbol == sym][['date', 'close']].copy()
        cdf = cdf.rename(columns={'close': f'comm_{sym}'})
        commodity_pivoted[sym] = cdf

    # Salmon separately (different symbol pattern)
    salmon_df = data['commodities'][data['commodities'].symbol == 'SALMON'][['date', 'close']].copy()
    salmon_df = salmon_df.rename(columns={'close': 'comm_SALMON'})

    # BDI rates
    bdi = data['rates'][data['rates'].index_name == 'BDI'][['date', 'value']].rename(columns={'value': 'bdi'})

    # FX rates pivot
    fx_pivoted = {}
    for pair in ['NOKUSD', 'NOKEUR']:
        fdf = data['fx'][data['fx'].pair == pair][['date', 'rate']].copy()
        fdf = fdf.rename(columns={'rate': f'fx_{pair}'})
        fx_pivoted[pair] = fdf

    tickers = [t for t in data['good_tickers'] if t != 'OBX']
    print(f"  Processing {len(tickers)} tickers...")

    for i, ticker in enumerate(tickers):
        if (i + 1) % 25 == 0:
            print(f"    → {i+1}/{len(tickers)}")

        df = prices[prices.ticker == ticker].copy().sort_values('date').reset_index(drop=True)
        if len(df) < 260:
            continue

        c = df['close'].values.astype(float)
        h = df['high'].values.astype(float)
        l = df['low'].values.astype(float)
        v = df['volume'].values.astype(float)
        dates = df['date'].values

        # ---- Returns at multiple horizons ----
        ret1d = np.concatenate([[np.nan], np.diff(np.log(np.maximum(c, 1e-8)))])
        ret5d = pd.Series(c).pct_change(5).values
        ret10d = pd.Series(c).pct_change(10).values
        ret21d = pd.Series(c).pct_change(21).values
        ret63d = pd.Series(c).pct_change(63).values
        ret126d = pd.Series(c).pct_change(126).values
        ret252d = pd.Series(c).pct_change(252).values

        # ---- Volatility ----
        vol5d = pd.Series(ret1d).rolling(5).std().values * np.sqrt(252)
        vol21d = pd.Series(ret1d).rolling(21).std().values * np.sqrt(252)
        vol63d = pd.Series(ret1d).rolling(63).std().values * np.sqrt(252)
        vol_ratio = np.where(vol63d > 0, vol5d / vol63d, np.nan)

        # ---- RSI 14 ----
        delta = np.diff(c, prepend=c[0])
        gains = np.where(delta > 0, delta, 0)
        losses = np.where(delta < 0, -delta, 0)
        avg_gain = pd.Series(gains).ewm(span=14, adjust=False).mean().values
        avg_loss = pd.Series(losses).ewm(span=14, adjust=False).mean().values
        rs = np.where(avg_loss > 1e-10, avg_gain / avg_loss, 100.0)
        rsi14 = 100 - (100 / (1 + rs))

        # ---- Bollinger position ----
        sma20 = pd.Series(c).rolling(20).mean().values
        std20 = pd.Series(c).rolling(20).std().values
        bb_position = np.where(std20 > 1e-10, (c - sma20) / (2 * std20), 0)

        # ---- Price vs SMAs ----
        sma50 = pd.Series(c).rolling(50).mean().values
        sma200 = pd.Series(c).rolling(200).mean().values
        price_sma20 = np.where(sma20 > 0, c / sma20 - 1, 0)
        price_sma50 = np.where(sma50 > 0, c / sma50 - 1, 0)
        price_sma200 = np.where(sma200 > 0, c / sma200 - 1, 0)

        # ---- 52-week position ----
        high_52w = pd.Series(h).rolling(252).max().values
        low_52w = pd.Series(l).rolling(252).min().values
        dist_52w_high = np.where(high_52w > 0, c / high_52w - 1, 0)

        # ---- Volume features ----
        vol_avg20 = pd.Series(v).rolling(20).mean().values
        vol_ratio_20d = np.where(vol_avg20 > 1e-5, v / vol_avg20, 1)

        # ---- Amihud illiquidity ----
        dollar_vol = v * c / 1e6
        amihud = np.where(dollar_vol > 1e-8, np.abs(ret1d) / dollar_vol, np.nan)
        amihud_21d = pd.Series(amihud).rolling(21).mean().values

        # ---- MACD normalized ----
        ema12 = pd.Series(c).ewm(span=12).mean().values
        ema26 = pd.Series(c).ewm(span=26).mean().values
        macd = ema12 - ema26
        macd_signal = pd.Series(macd).ewm(span=9).mean().values
        macd_hist = macd - macd_signal
        macd_norm = np.where(c > 0, macd_hist / c, 0)

        # ---- Short-term reversal (strong on small exchanges) ----
        reversal_5d = -ret5d

        # ---- Skewness (21d) ----
        skew_21d = pd.Series(ret1d).rolling(21).skew().values

        feat = pd.DataFrame({
            'date': dates,
            'ticker': ticker,
            'close': c,
            # Returns (7 horizons)
            'ret_1d': ret1d, 'ret_5d': ret5d, 'ret_10d': ret10d,
            'ret_21d': ret21d, 'ret_63d': ret63d, 'ret_126d': ret126d, 'ret_252d': ret252d,
            # Volatility
            'vol_5d': vol5d, 'vol_21d': vol21d, 'vol_63d': vol63d, 'vol_ratio': vol_ratio,
            # Technical
            'rsi_14': rsi14, 'bb_position': bb_position,
            'price_sma20': price_sma20, 'price_sma50': price_sma50, 'price_sma200': price_sma200,
            'dist_52w_high': dist_52w_high,
            'macd_norm': macd_norm,
            # Volume & liquidity
            'vol_ratio_20d': vol_ratio_20d, 'amihud_21d': amihud_21d,
            # Reversal & distribution
            'reversal_5d': reversal_5d, 'skew_21d': skew_21d,
        })

        all_features.append(feat)

    features = pd.concat(all_features, ignore_index=True)
    features['date'] = pd.to_datetime(features['date'])
    print(f"  → {len(features):,} rows, {features.shape[1]} base features")

    # ---- Merge OBX ----
    obx = obx.sort_values('date')
    obx['obx_ret1d'] = obx['obx_close'].pct_change()
    obx['obx_ret21d'] = obx['obx_close'].pct_change(21)
    obx['obx_ret5d'] = obx['obx_close'].pct_change(5)
    obx['obx_vol21d'] = obx['obx_ret1d'].rolling(21).std() * np.sqrt(252)
    features = features.merge(obx[['date', 'obx_ret1d', 'obx_ret21d', 'obx_ret5d', 'obx_vol21d']], on='date', how='left')

    # Excess returns
    features['excess_ret_21d'] = features['ret_21d'] - features['obx_ret21d']

    # ---- Rolling beta to OBX (63d) — vectorized ----
    print("  Computing rolling betas...")
    beta_results = []
    for ticker, group in features.groupby('ticker'):
        ret = group['ret_1d'].values
        mkt = group['obx_ret1d'].values
        betas = np.full(len(ret), np.nan)
        for j in range(63, len(ret)):
            x = mkt[j-63:j]
            y = ret[j-63:j]
            mask = ~(np.isnan(x) | np.isnan(y))
            if mask.sum() > 30:
                cov_xy = np.cov(x[mask], y[mask])
                betas[j] = cov_xy[0, 1] / max(cov_xy[0, 0], 1e-10)
        beta_results.append(pd.Series(betas, index=group.index, name='beta_63d'))
    features['beta_63d'] = pd.concat(beta_results)

    # Idiosyncratic vol
    features['idio_vol'] = features['vol_21d'] - features['beta_63d'].abs() * features['obx_vol21d']

    # ---- Commodity factors ----
    print("  Merging commodity features...")
    for sym, cdf in commodity_pivoted.items():
        cdf = cdf.copy()
        col = f'comm_{sym}'
        cdf[f'{col}_ret5d'] = cdf[col].pct_change(5)
        cdf[f'{col}_ret21d'] = cdf[col].pct_change(21)
        features = features.merge(cdf[['date', f'{col}_ret5d', f'{col}_ret21d']], on='date', how='left')

    # Salmon
    salmon_df_m = salmon_df.copy()
    salmon_df_m['comm_SALMON_ret5d'] = salmon_df_m['comm_SALMON'].pct_change(5)
    salmon_df_m['comm_SALMON_ret21d'] = salmon_df_m['comm_SALMON'].pct_change(21)
    features = features.merge(salmon_df_m[['date', 'comm_SALMON_ret5d', 'comm_SALMON_ret21d']], on='date', how='left')

    # Oil interaction: oil return × stock beta (OSE-specific: oil moves everything)
    features['oil_interaction'] = features.get('comm_BZ=F_ret21d', pd.Series(0, index=features.index)) * features['beta_63d']

    # ---- BDI rate ----
    if len(bdi) > 0:
        bdi_m = bdi.copy()
        bdi_m['bdi_ret21d'] = bdi_m['bdi'].pct_change(21)
        features = features.merge(bdi_m[['date', 'bdi_ret21d']], on='date', how='left')

    # ---- FX (NOK sensitivity) ----
    print("  Merging FX features...")
    for pair, fdf in fx_pivoted.items():
        fdf = fdf.copy()
        col = f'fx_{pair}'
        fdf[f'{col}_ret5d'] = fdf[col].pct_change(5)
        fdf[f'{col}_ret21d'] = fdf[col].pct_change(21)
        features = features.merge(fdf[['date', f'{col}_ret5d', f'{col}_ret21d']], on='date', how='left')

    # NOK interaction: NOK weakness × stock return (exporters benefit from weak NOK)
    if 'fx_NOKUSD_ret21d' in features.columns:
        features['nok_interaction'] = features['fx_NOKUSD_ret21d'] * features['ret_21d']

    # ---- Short interest ----
    print("  Merging short interest...")
    shorts = data['shorts'].copy()
    if len(shorts) > 0:
        shorts['date'] = pd.to_datetime(shorts['date'])
        shorts = shorts.sort_values(['ticker', 'date'])
        shorts['short_change_5d'] = shorts.groupby('ticker')['short_pct'].diff(5)
        features = features.merge(
            shorts[['ticker', 'date', 'short_pct', 'short_change_5d']],
            on=['ticker', 'date'], how='left'
        )

    # ---- Fundamentals ----
    print("  Merging fundamentals...")
    fund = data['fundamentals'].copy()
    if len(fund) > 0:
        fund['date'] = pd.to_datetime(fund['date'])
        fund = fund.sort_values(['ticker', 'date']).drop_duplicates(subset=['ticker', 'date'], keep='last')
        features = features.merge(fund[['ticker', 'date', 'bm', 'ep', 'dy', 'sp', 'mktcap']],
                                   on=['ticker', 'date'], how='left')

    # Forward-fill fundamentals & shorts
    for col in ['bm', 'ep', 'dy', 'sp', 'mktcap', 'short_pct', 'short_change_5d']:
        if col in features.columns:
            features[col] = features.groupby('ticker')[col].ffill()

    # Log market cap
    if 'mktcap' in features.columns:
        features['log_mktcap'] = np.log1p(features['mktcap'].fillna(0))

    # ---- Cross-sectional ranks (key for financial ML) ----
    print("  Computing cross-sectional ranks...")
    rank_cols = ['ret_21d', 'ret_63d', 'vol_21d', 'reversal_5d', 'rsi_14']
    for col in rank_cols:
        if col in features.columns:
            features[f'{col}_rank'] = features.groupby('date')[col].rank(pct=True)

    # ---- Sector features ----
    sector_map = dict(zip(data['stocks'].ticker, data['stocks'].sector))
    features['sector'] = features['ticker'].map(sector_map).fillna('Unknown')

    for col in ['ret_21d']:
        sector_mean = features.groupby(['date', 'sector'])[col].transform('mean')
        features[f'{col}_vs_sector'] = features[col] - sector_mean

    # ---- Seasonality ----
    features['month'] = features['date'].dt.month
    features['is_january'] = (features['month'] == 1).astype(int)
    features['is_q4'] = (features['month'] >= 10).astype(int)

    # ---- Targets (multi-horizon) ----
    print("  Computing forward returns (targets)...")
    features = features.sort_values(['ticker', 'date'])
    features['fwd_ret_5d'] = features.groupby('ticker')['close'].transform(
        lambda x: x.shift(-5) / x - 1
    )
    features['fwd_ret_21d'] = features.groupby('ticker')['close'].transform(
        lambda x: x.shift(-21) / x - 1
    )

    # Cross-sectional rank target (more stable, less noisy)
    # Rank forward returns within each date → [0, 1] → center to [-0.5, 0.5]
    for target_col in ['fwd_ret_5d', 'fwd_ret_21d']:
        rank_col = f'{target_col}_rank'
        features[rank_col] = features.groupby('date')[target_col].rank(pct=True) - 0.5

    # Drop rows with no target
    features = features.dropna(subset=['fwd_ret_21d'])

    # ---- Winsorize features at 1st/99th percentile ----
    print("  Winsorizing features...")
    exclude_cols = {'date', 'ticker', 'close', 'sector', 'month',
                    'fwd_ret_21d', 'fwd_ret_5d', 'fwd_ret_21d_rank', 'fwd_ret_5d_rank',
                    'obx_ret1d', 'obx_ret21d', 'obx_ret5d', 'obx_vol21d'}
    feature_cols = [c for c in features.columns if c not in exclude_cols
                    and features[c].dtype in [np.float64, np.float32, float, np.int64, int]]
    for col in feature_cols:
        if features[col].dtype in [np.float64, np.float32, float]:
            lo, hi = features[col].quantile(0.01), features[col].quantile(0.99)
            if lo != hi:
                features[col] = features[col].clip(lo, hi)

    print(f"  → Final: {len(features):,} rows, {len(feature_cols)} features, "
          f"{features.ticker.nunique()} tickers")
    print(f"  → Date range: {features.date.min().date()} to {features.date.max().date()}")

    return features


# ============================================================================
# Feature Selection
# ============================================================================

def select_features(features: pd.DataFrame, target='fwd_ret_21d_rank', max_features=40):
    """Select top features using a quick XGBoost importance scan."""
    print(f"\n  Feature selection (target={target})...")
    exclude_cols = {'date', 'ticker', 'close', 'sector', 'month',
                    'fwd_ret_21d', 'fwd_ret_5d', 'fwd_ret_21d_rank', 'fwd_ret_5d_rank',
                    'obx_ret1d', 'obx_ret21d', 'obx_ret5d', 'obx_vol21d'}
    all_cols = [c for c in features.columns if c not in exclude_cols
                and features[c].dtype in [np.float64, np.float32, float, np.int64, int]]

    # Quick training on last 50% of data for feature importance
    dates = sorted(features['date'].unique())
    mid = len(dates) // 2
    train_dates = dates[mid:]
    df = features[features['date'].isin(train_dates)].copy()

    X = df[all_cols].fillna(0)
    y = df[target].fillna(0)

    model = xgb.XGBRegressor(
        n_estimators=100, max_depth=3, learning_rate=0.1,
        subsample=0.7, colsample_bytree=0.5,
        random_state=42, n_jobs=-1, verbosity=0,
    )
    model.fit(X, y)

    importance = dict(zip(all_cols, model.feature_importances_))
    sorted_features = sorted(importance.items(), key=lambda x: -x[1])

    selected = [f[0] for f in sorted_features[:max_features]]
    print(f"  → Selected {len(selected)} / {len(all_cols)} features")
    print(f"  → Top 10: {', '.join(selected[:10])}")

    return selected


# ============================================================================
# Model Training with Walk-Forward Validation
# ============================================================================

def train_walk_forward(features: pd.DataFrame, feature_cols: List[str],
                       target='fwd_ret_21d_rank', horizon_label='21d') -> dict:
    """Walk-forward training with purging and early stopping."""
    print(f"\n[3/6] WALK-FORWARD TRAINING (horizon={horizon_label}, target={target})")
    print("=" * 60)

    print(f"  Using {len(feature_cols)} features")
    dates = sorted(features['date'].unique())

    # Walk-forward params
    train_window = 504  # 2 years of trading days
    test_window = 21    # 1 month
    purge_gap = 5       # prevent target leakage
    min_train = 252     # at least 1 year

    rebal_dates = dates[train_window::test_window]
    print(f"  Rebalance dates: {len(rebal_dates)} ({str(rebal_dates[0])[:10]} to {str(rebal_dates[-1])[:10]})")

    all_predictions = []
    fold_metrics = []

    for fold_idx, rebal_date in enumerate(rebal_dates):
        date_idx = list(dates).index(rebal_date) if rebal_date in dates else None
        if date_idx is None:
            continue

        train_end_idx = max(0, date_idx - purge_gap)
        train_start_idx = max(0, date_idx - train_window)

        if train_end_idx - train_start_idx < min_train:
            continue

        train_dates_slice = dates[train_start_idx:train_end_idx]
        test_start_idx = date_idx
        test_end_idx = min(len(dates), date_idx + test_window)
        test_dates_slice = dates[test_start_idx:test_end_idx]

        if len(test_dates_slice) == 0:
            continue

        train_mask = features['date'].isin(train_dates_slice)
        test_mask = features['date'].isin(test_dates_slice)

        X_train = features.loc[train_mask, feature_cols].fillna(0).values
        y_train = features.loc[train_mask, target].fillna(0).values
        X_test = features.loc[test_mask, feature_cols].fillna(0).values
        y_test = features.loc[test_mask, target].values
        y_test_raw = features.loc[test_mask, target.replace('_rank', '')].values if '_rank' in target else y_test
        test_info = features.loc[test_mask, ['date', 'ticker']].copy()

        if len(X_train) < 100 or len(X_test) < 10:
            continue

        # Split last 10% of training as validation for early stopping
        val_size = max(int(len(X_train) * 0.1), 50)
        X_val = X_train[-val_size:]
        y_val = y_train[-val_size:]
        X_tr = X_train[:-val_size]
        y_tr = y_train[:-val_size]

        # ---- XGBoost ----
        xgb_model = xgb.XGBRegressor(
            n_estimators=500,
            max_depth=3,  # Shallower trees = less overfitting
            learning_rate=0.03,
            subsample=0.7,
            colsample_bytree=0.6,
            reg_alpha=0.5,
            reg_lambda=2.0,
            min_child_weight=20,  # More regularization
            gamma=0.1,
            random_state=42,
            n_jobs=-1,
            verbosity=0,
            early_stopping_rounds=30,
        )
        xgb_model.fit(X_tr, y_tr, eval_set=[(X_val, y_val)], verbose=False)
        xgb_pred = xgb_model.predict(X_test)

        # ---- LightGBM ----
        lgbm_model = lgbm.LGBMRegressor(
            n_estimators=500,
            max_depth=3,
            learning_rate=0.03,
            subsample=0.7,
            colsample_bytree=0.6,
            reg_alpha=0.5,
            reg_lambda=2.0,
            min_child_samples=20,
            random_state=42,
            n_jobs=-1,
            verbose=-1,
        )
        lgbm_model.fit(X_tr, y_tr, eval_set=[(X_val, y_val)],
                        callbacks=[lgbm.log_evaluation(0), lgbm.early_stopping(30)])
        lgbm_pred = lgbm_model.predict(X_test)

        # ---- CatBoost (if available) ----
        cat_pred = None
        if HAS_CATBOOST:
            cat_model = CatBoostRegressor(
                iterations=500,
                depth=3,
                learning_rate=0.03,
                l2_leaf_reg=5.0,
                subsample=0.7,
                random_seed=42,
                verbose=0,
                early_stopping_rounds=30,
            )
            cat_model.fit(X_tr, y_tr, eval_set=(X_val, y_val), verbose=False)
            cat_pred = cat_model.predict(X_test)

        # ---- Ensemble ----
        if HAS_CATBOOST and cat_pred is not None:
            ensemble_pred = 0.35 * xgb_pred + 0.35 * lgbm_pred + 0.30 * cat_pred
        else:
            ensemble_pred = 0.50 * xgb_pred + 0.50 * lgbm_pred

        # Store predictions
        for j in range(len(X_test)):
            if pd.isna(y_test[j]):
                continue
            pred_row = {
                'date': test_info.iloc[j]['date'],
                'ticker': test_info.iloc[j]['ticker'],
                'xgb_pred': float(xgb_pred[j]),
                'lgbm_pred': float(lgbm_pred[j]),
                'ensemble_pred': float(ensemble_pred[j]),
                'actual_rank': float(y_test[j]),
                'actual_return': float(y_test_raw[j]) if not np.isnan(y_test_raw[j]) else 0,
                'fold': fold_idx,
            }
            if HAS_CATBOOST and cat_pred is not None:
                pred_row['cat_pred'] = float(cat_pred[j])
            all_predictions.append(pred_row)

        # Fold metrics (on rank correlation which is what we optimize)
        valid_mask = ~np.isnan(y_test)
        if valid_mask.sum() > 5:
            ic = np.corrcoef(ensemble_pred[valid_mask], y_test[valid_mask])[0, 1]
            rank_ic = stats.spearmanr(ensemble_pred[valid_mask], y_test[valid_mask])[0]
        else:
            ic, rank_ic = 0, 0

        fold_metrics.append({
            'date': str(rebal_date)[:10],
            'ic': ic,
            'rank_ic': rank_ic,
            'n': int(valid_mask.sum()),
        })

        if (fold_idx + 1) % 5 == 0:
            print(f"    Fold {fold_idx+1}/{len(rebal_dates)}: IC={ic:.4f}, RankIC={rank_ic:.4f}, N={valid_mask.sum()}")

    pred_df = pd.DataFrame(all_predictions)
    print(f"\n  → {len(pred_df):,} total out-of-sample predictions")
    print(f"  → {len(fold_metrics)} folds completed")

    # Feature importance from last XGB model
    importance = dict(zip(feature_cols, xgb_model.feature_importances_))
    top_features = sorted(importance.items(), key=lambda x: -x[1])[:15]
    print(f"\n  Top 15 features ({horizon_label}):")
    for fname, fimp in top_features:
        print(f"    {fname:30s} {fimp:.4f}")

    return {
        'predictions': pred_df,
        'fold_metrics': fold_metrics,
        'feature_importance': importance,
        'feature_cols': feature_cols,
        'last_xgb_model': xgb_model,
        'last_lgbm_model': lgbm_model,
        'last_cat_model': cat_model if HAS_CATBOOST else None,
        'horizon': horizon_label,
    }


# ============================================================================
# Evaluation (with transaction costs)
# ============================================================================

def evaluate(results: dict):
    """Print comprehensive evaluation with transaction costs."""
    print(f"\n[4/6] EVALUATION ({results['horizon']})")
    print("=" * 60)

    pred_df = results['predictions']
    if len(pred_df) == 0:
        print("  No predictions to evaluate!")
        return {}

    eval_results = {}
    model_cols = [('XGBoost', 'xgb_pred'), ('LightGBM', 'lgbm_pred')]
    if 'cat_pred' in pred_df.columns:
        model_cols.append(('CatBoost', 'cat_pred'))
    model_cols.append(('Ensemble', 'ensemble_pred'))

    for model_name, col in model_cols:
        predicted = pred_df[col].values
        actual_rank = pred_df['actual_rank'].values
        actual_return = pred_df['actual_return'].values

        # Rank-based metrics
        ic = np.corrcoef(predicted, actual_rank)[0, 1]
        rank_ic = stats.spearmanr(predicted, actual_rank)[0]

        # Direction accuracy (on actual returns)
        hits = np.mean(np.sign(predicted) == np.sign(actual_return))

        # ---- Long-short with transaction costs ----
        ls_returns_gross = []
        ls_returns_net = []
        for d, group in pred_df.groupby('date'):
            if len(group) < 10:
                continue
            g = group.sort_values(col, ascending=False)
            n = max(len(g) // 5, 1)  # quintile
            long_ret = g.head(n)['actual_return'].mean()
            short_ret = g.tail(n)['actual_return'].mean()
            ls_gross = long_ret - short_ret
            ls_returns_gross.append(ls_gross)
            # Round-trip cost: 30bps (15bps entry + 15bps exit) for longs and shorts
            ls_net = ls_gross - 2 * TOTAL_COST_BPS / 10000  # both legs
            ls_returns_net.append(ls_net)

        ls_mean_gross = np.mean(ls_returns_gross) if ls_returns_gross else 0
        ls_mean_net = np.mean(ls_returns_net) if ls_returns_net else 0
        ls_std = np.std(ls_returns_net) if ls_returns_net and len(ls_returns_net) > 1 else 1
        ls_sharpe = (ls_mean_net / ls_std * np.sqrt(12)) if ls_std > 0 else 0

        # ---- Top-quintile long-only return ----
        long_only_returns = []
        for d, group in pred_df.groupby('date'):
            if len(group) < 10:
                continue
            g = group.sort_values(col, ascending=False)
            n = max(len(g) // 5, 1)
            long_ret = g.head(n)['actual_return'].mean()
            long_only_returns.append(long_ret - TOTAL_COST_BPS / 10000)  # one-way cost

        long_mean = np.mean(long_only_returns) if long_only_returns else 0

        print(f"\n  {model_name} ({results['horizon']}):")
        print(f"    Rank IC (Pearson):  {ic:+.4f}")
        print(f"    Rank IC (Spearman): {rank_ic:+.4f}")
        print(f"    Hit Rate:           {hits:.1%}")
        print(f"    L/S Gross (avg):    {ls_mean_gross:+.2%}")
        print(f"    L/S Net (avg):      {ls_mean_net:+.2%}  (after {2*TOTAL_COST_BPS}bps RT)")
        print(f"    L/S Sharpe (net):   {ls_sharpe:+.2f}")
        print(f"    Long-Only (net):    {long_mean:+.2%}")
        print(f"    N predictions:      {len(pred_df):,}")
        print(f"    N periods:          {len(ls_returns_net)}")

        eval_results[model_name] = {
            'ic': ic, 'rank_ic': rank_ic, 'hit_rate': hits,
            'ls_gross': ls_mean_gross, 'ls_net': ls_mean_net,
            'ls_sharpe': ls_sharpe, 'long_only_net': long_mean,
        }

    return eval_results


# ============================================================================
# Generate Signals for Latest Date
# ============================================================================

def generate_signals(features: pd.DataFrame, results: dict, conn, horizon='21d'):
    """Generate and store signals for the most recent dates."""
    print(f"\n[5/6] GENERATING SIGNALS ({horizon})")
    print("=" * 60)

    feature_cols = results['feature_cols']
    xgb_model = results['last_xgb_model']
    lgbm_model = results['last_lgbm_model']
    cat_model = results.get('last_cat_model')

    # Latest 5 dates with features
    latest_dates = sorted(features['date'].unique())[-5:]

    all_signals = []
    for date in latest_dates:
        day_data = features[features['date'] == date].copy()
        if len(day_data) < 5:
            continue

        X = day_data[feature_cols].fillna(0).values
        xgb_pred = xgb_model.predict(X)
        lgbm_pred = lgbm_model.predict(X)

        if cat_model is not None:
            cat_pred = cat_model.predict(X)
            ensemble_pred = 0.35 * xgb_pred + 0.35 * lgbm_pred + 0.30 * cat_pred
        else:
            cat_pred = None
            ensemble_pred = 0.50 * xgb_pred + 0.50 * lgbm_pred

        # Cross-sectional z-score → signal in [-1, 1]
        def to_signal(preds):
            mean = np.mean(preds)
            std = np.std(preds)
            if std < 1e-10:
                return np.zeros_like(preds)
            return np.clip((preds - mean) / std / 2, -1, 1)

        xgb_sig = to_signal(xgb_pred)
        lgbm_sig = to_signal(lgbm_pred)
        ens_sig = to_signal(ensemble_pred)

        horizon_days = 5 if horizon == '5d' else 21

        for j, (_, row) in enumerate(day_data.iterrows()):
            date_str = str(row['date'])[:10]
            for model_id, sig, pred in [
                ('xgb_v4', xgb_sig[j], xgb_pred[j]),
                ('lgbm_v4', lgbm_sig[j], lgbm_pred[j]),
                ('ensemble_v4', ens_sig[j], ensemble_pred[j]),
            ]:
                model_tag = f'{model_id}_{horizon}'
                all_signals.append((
                    row['ticker'], date_str, model_tag,
                    float(sig), float(pred),
                    min(1.0, abs(float(sig)) * 1.5 + 0.2),
                    horizon_days,
                ))

            if cat_pred is not None:
                cat_sig = to_signal(cat_pred)
                all_signals.append((
                    row['ticker'], date_str, f'cat_v4_{horizon}',
                    float(cat_sig[j]), float(cat_pred[j]),
                    min(1.0, abs(float(cat_sig[j])) * 1.5 + 0.2),
                    horizon_days,
                ))

    print(f"  → {len(all_signals)} new signals")

    # Also add walk-forward historical signals
    pred_df = results['predictions']
    hist_signals = []
    horizon_days = 5 if horizon == '5d' else 21

    for d, group in pred_df.groupby('date'):
        date_str = str(d)[:10]
        for model_col, model_id in [('xgb_pred', 'xgb_v4'), ('lgbm_pred', 'lgbm_v4'), ('ensemble_pred', 'ensemble_v4')]:
            preds = group[model_col].values
            mean, std = np.mean(preds), np.std(preds)
            if std < 1e-10:
                sigs = np.zeros_like(preds)
            else:
                sigs = np.clip((preds - mean) / std / 2, -1, 1)

            for j, (_, row) in enumerate(group.iterrows()):
                hist_signals.append((
                    row['ticker'], date_str, f'{model_id}_{horizon}',
                    float(sigs[j]), float(row[model_col]),
                    min(1.0, abs(float(sigs[j])) * 1.5 + 0.2),
                    horizon_days,
                ))

        if 'cat_pred' in group.columns:
            preds = group['cat_pred'].values
            mean, std = np.mean(preds), np.std(preds)
            sigs = np.clip((preds - mean) / std / 2, -1, 1) if std > 1e-10 else np.zeros_like(preds)
            for j, (_, row) in enumerate(group.iterrows()):
                hist_signals.append((
                    row['ticker'], date_str, f'cat_v4_{horizon}',
                    float(sigs[j]), float(row['cat_pred']),
                    min(1.0, abs(float(sigs[j])) * 1.5 + 0.2),
                    horizon_days,
                ))

    combined = hist_signals + all_signals

    # Deduplicate
    seen = set()
    unique = []
    for s in combined:
        key = (s[0], s[1], s[2], s[6])  # ticker, date, model_id, horizon
        if key not in seen:
            seen.add(key)
            unique.append(s)

    print(f"  → {len(unique)} unique signals (deduped from {len(combined)})")

    # Write to database
    cur = conn.cursor()
    # Only delete signals for this horizon version
    cur.execute("DELETE FROM alpha_signals WHERE model_id LIKE %s", (f'%v4_{horizon}',))

    execute_values(
        cur,
        """INSERT INTO alpha_signals (ticker, signal_date, model_id, signal_value, predicted_return, confidence, horizon)
           VALUES %s
           ON CONFLICT (ticker, signal_date, model_id, horizon) DO UPDATE SET
             signal_value = EXCLUDED.signal_value,
             predicted_return = EXCLUDED.predicted_return,
             confidence = EXCLUDED.confidence""",
        unique,
        page_size=500,
    )
    conn.commit()
    print(f"  → Signals written to database")

    return len(unique)


# ============================================================================
# Write Performance Metrics
# ============================================================================

def write_performance(results: dict, conn, horizon='21d'):
    """Write performance metrics to alpha_model_performance."""
    print(f"\n[6/6] WRITING PERFORMANCE METRICS ({horizon})")
    print("=" * 60)

    pred_df = results['predictions']
    cur = conn.cursor()

    # Only delete for this version
    cur.execute("DELETE FROM alpha_model_performance WHERE model_id LIKE %s", (f'%v4%',))

    model_cols = [('xgb_pred', f'xgb_v4_{horizon}'), ('lgbm_pred', f'lgbm_v4_{horizon}'),
                  ('ensemble_pred', f'ensemble_v4_{horizon}')]
    if 'cat_pred' in pred_df.columns:
        model_cols.append(('cat_pred', f'cat_v4_{horizon}'))

    records = 0
    for model_col, model_id in model_cols:
        dates = sorted(pred_df['date'].unique())

        for window_days in [21, 63]:
            for di, eval_date in enumerate(dates):
                window_start = max(0, di - window_days)
                window_dates = dates[window_start:di + 1]
                window_data = pred_df[pred_df['date'].isin(window_dates)]

                if len(window_data) < 20:
                    continue

                predicted = window_data[model_col].values
                actual_return = window_data['actual_return'].values

                # IC
                ic = np.corrcoef(predicted, actual_return)[0, 1] if len(predicted) > 2 else 0
                # Hit rate
                hits = np.mean(np.sign(predicted) == np.sign(actual_return))
                # MAE
                mae = mean_absolute_error(actual_return, predicted)

                # L/S return
                ls_rets = []
                for d, g in window_data.groupby('date'):
                    if len(g) < 5:
                        continue
                    g_sorted = g.sort_values(model_col, ascending=False)
                    n = max(len(g) // 5, 1)
                    ls_ret = g_sorted.head(n)['actual_return'].mean() - g_sorted.tail(n)['actual_return'].mean()
                    ls_rets.append(ls_ret - 2 * TOTAL_COST_BPS / 10000)  # net of costs

                ls_ret_avg = np.mean(ls_rets) if ls_rets else 0
                sharpe = (np.mean(ls_rets) / np.std(ls_rets) * np.sqrt(12)) if ls_rets and len(ls_rets) > 1 and np.std(ls_rets) > 1e-10 else 0

                eval_date_str = str(eval_date)[:10]
                cur.execute("""
                    INSERT INTO alpha_model_performance
                      (model_id, evaluation_date, window_days, hit_rate, ic, mae, sharpe, long_short_return, n_predictions)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (model_id, evaluation_date, window_days) DO UPDATE SET
                      hit_rate = EXCLUDED.hit_rate, ic = EXCLUDED.ic, mae = EXCLUDED.mae,
                      sharpe = EXCLUDED.sharpe, long_short_return = EXCLUDED.long_short_return,
                      n_predictions = EXCLUDED.n_predictions
                """, (model_id, eval_date_str, window_days, float(hits), float(ic),
                      float(mae), float(sharpe), float(ls_ret_avg), len(window_data)))
                records += 1

    conn.commit()
    print(f"  → {records} performance records written")


# ============================================================================
# Main
# ============================================================================

def main():
    parser = argparse.ArgumentParser(description='Alpha Engine Training Pipeline v4')
    parser.add_argument('--test', action='store_true', help='Run on 15 liquid stocks only')
    parser.add_argument('--evaluate-only', action='store_true')
    parser.add_argument('--max-features', type=int, default=40, help='Max features after selection')
    args = parser.parse_args()

    print("=" * 60)
    print("  ALPHA ENGINE — ML TRAINING PIPELINE v4")
    print(f"  {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    if args.test:
        print(f"  MODE: TEST ({len(TEST_TICKERS)} tickers)")
    else:
        print("  MODE: FULL (all tickers)")
    if HAS_CATBOOST:
        print("  MODELS: XGBoost + LightGBM + CatBoost")
    else:
        print("  MODELS: XGBoost + LightGBM")
    print(f"  COSTS: {TOTAL_COST_BPS}bps one-way ({2*TOTAL_COST_BPS}bps RT)")
    print("=" * 60)

    conn = get_connection()

    # Load data
    data = load_all_data(conn, test_mode=args.test)

    # Engineer features
    features = engineer_features(data)

    # Feature selection
    selected_21d = select_features(features, target='fwd_ret_21d_rank', max_features=args.max_features)

    # ---- Train 21D horizon ----
    results_21d = train_walk_forward(features, selected_21d, target='fwd_ret_21d_rank', horizon_label='21d')
    eval_21d = evaluate(results_21d)

    # ---- Train 5D horizon ----
    selected_5d = select_features(features, target='fwd_ret_5d_rank', max_features=args.max_features)
    results_5d = train_walk_forward(features, selected_5d, target='fwd_ret_5d_rank', horizon_label='5d')
    eval_5d = evaluate(results_5d)

    if not args.evaluate_only:
        # Clear old v3 signals
        cur = conn.cursor()
        cur.execute("DELETE FROM alpha_signals WHERE model_id LIKE '%v3%'")
        cur.execute("DELETE FROM alpha_model_performance WHERE model_id LIKE '%v3%'")
        conn.commit()

        # Generate signals for both horizons
        n_21d = generate_signals(features, results_21d, conn, horizon='21d')
        n_5d = generate_signals(features, results_5d, conn, horizon='5d')

        # Write performance
        write_performance(results_21d, conn, horizon='21d')
        write_performance(results_5d, conn, horizon='5d')

        print("\n" + "=" * 60)
        print("  PIPELINE COMPLETE")
        print("=" * 60)
        print(f"  21D signals: {n_21d}")
        print(f"  5D signals:  {n_5d}")
        if HAS_CATBOOST:
            print(f"  Models: xgb_v4, lgbm_v4, cat_v4, ensemble_v4")
        else:
            print(f"  Models: xgb_v4, lgbm_v4, ensemble_v4")
        print(f"  Transaction costs: {TOTAL_COST_BPS}bps one-way")

        # Summary table
        print("\n  PERFORMANCE SUMMARY:")
        print(f"  {'Model':<20} {'Horizon':<8} {'IC':>8} {'RankIC':>8} {'Hit%':>8} {'L/S Net':>10} {'Sharpe':>8}")
        print("  " + "-" * 70)
        for horizon, eval_res in [('21d', eval_21d), ('5d', eval_5d)]:
            for model_name, metrics in eval_res.items():
                print(f"  {model_name:<20} {horizon:<8} {metrics['ic']:>+.4f} {metrics['rank_ic']:>+.4f} "
                      f"{metrics['hit_rate']:>7.1%} {metrics['ls_net']:>+9.2%} {metrics['ls_sharpe']:>+.2f}")
    else:
        print("\n  (Evaluate-only mode — no signals written)")

    conn.close()


if __name__ == '__main__':
    main()
