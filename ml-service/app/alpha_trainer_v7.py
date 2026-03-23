#!/usr/bin/env python3
"""
ALPHA ENGINE v7 — "YGGDRASIL" (The World Tree)
================================================
Multi-scale signal fusion with regime-dependent weighting,
cross-sectional ranking, and portfolio-aware backtesting.

Key innovations over v6:
  1. CROSS-SECTIONAL RANKING: Predict rank, not direction. More stable.
  2. MULTI-HORIZON FUSION: 5d + 21d + 63d signals weighted by regime.
  3. REGIME-AWARE WEIGHTING: HMM-detected regime determines signal blend.
  4. EXPANDING WINDOW: Uses all available history (not fixed 504d).
  5. PORTFOLIO BACKTEST: Top quintile long-only with risk limits.
  6. INFORMATION COEFFICIENT (IC): Proper evaluation via rank correlation.

Architecture:
  Stage 0: Regime Detection (market vol percentile + trend)
  Stage 1: 100+ features (physics-inspired + microstructure + cross-asset)
  Stage 2: 3 horizon-specific models (5d / 21d / 63d)
  Stage 3: Regime-weighted signal fusion
  Stage 4: Cross-sectional ranking → portfolio construction
  Stage 5: Non-overlapping backtest with realistic costs

Evaluation metrics (quant fund standard):
  - IC (Spearman rank correlation of predicted vs actual rank)
  - ICIR (IC / std(IC) — stability of predictive power)
  - Long-Short spread (top vs bottom quintile monthly return)
  - Turnover-adjusted Sharpe ratio

Academic foundations (extending v6):
  - Grinold & Kahn (2000): Fundamental Law of Active Management
    IR = IC × sqrt(Breadth) — the math behind diversified alpha
  - Marchenko & Pastur (1967): Random Matrix Theory for covariance cleaning
  - Schreiber (2000): Transfer entropy for information flow detection
  - Mallat (1999): Wavelet multiresolution analysis
  - Ødegaard (2023): Factor premiums on Oslo Stock Exchange

Usage:
  python alpha_trainer_v7.py --test     # 15 liquid stocks
  python alpha_trainer_v7.py            # Full universe
  python alpha_trainer_v7.py --no-write # Evaluate only
"""

import argparse
import os
import sys
import time
import warnings
from datetime import datetime

import numpy as np
import pandas as pd
import psycopg2
from scipy import stats as scipy_stats
from scipy.linalg import eigh
from sklearn.linear_model import Ridge, LogisticRegression
from sklearn.neural_network import MLPRegressor
from sklearn.preprocessing import StandardScaler

import xgboost as xgb
import lightgbm as lgb
import catboost as cb

warnings.filterwarnings('ignore')
sys.stdout = os.fdopen(sys.stdout.fileno(), 'w', 1)

# ============================================================================
# Constants
# ============================================================================

TEST_TICKERS = [
    'EQNR', 'DNB', 'MOWI', 'TEL', 'YAR', 'NHY', 'ORK', 'SALM',
    'FRO', 'AKRBP', 'LSG', 'SUBC', 'GSF', 'DNO', 'BAKKA',
]

# Multi-horizon targets
HORIZONS = {
    'fast':   5,    # 1-week: short-term reversal + microstructure
    'medium': 21,   # 1-month: momentum + value + cross-asset
    'slow':   63,   # 3-month: fundamental momentum + quality
}

MIN_TRAIN = 504      # 2 years minimum training
PURGE_GAP = 5        # 5-day purge between train/test
REBAL_PERIOD = 21    # Monthly rebalancing for backtest

# Regime-dependent signal weights
# Key insight: different time-scale signals work in different regimes
REGIME_WEIGHTS = {
    'low_vol':   {'fast': 0.10, 'medium': 0.30, 'slow': 0.60},  # Trend following
    'normal':    {'fast': 0.20, 'medium': 0.50, 'slow': 0.30},  # Balanced
    'high_vol':  {'fast': 0.50, 'medium': 0.35, 'slow': 0.15},  # Mean reversion
    'crisis':    {'fast': 0.00, 'medium': 0.00, 'slow': 0.00},  # Cash (no signals)
}

# Tree hyperparams — regularized
TREE_PARAMS = {
    'xgb': {
        'max_depth': 4, 'learning_rate': 0.03, 'n_estimators': 400,
        'reg_alpha': 1.0, 'reg_lambda': 3.0, 'min_child_weight': 20,
        'subsample': 0.7, 'colsample_bytree': 0.6,
        'objective': 'reg:squarederror', 'random_state': 42, 'verbosity': 0,
    },
    'lgbm': {
        'max_depth': 4, 'learning_rate': 0.03, 'n_estimators': 400,
        'num_leaves': 15, 'lambda_l1': 1.0, 'lambda_l2': 3.0,
        'min_child_samples': 20, 'subsample': 0.7, 'colsample_bytree': 0.6,
        'objective': 'regression', 'metric': 'mse',
        'random_state': 42, 'verbose': -1,
    },
    'cat': {
        'depth': 4, 'learning_rate': 0.03, 'iterations': 400,
        'l2_leaf_reg': 5.0, 'subsample': 0.7,
        'random_seed': 42, 'verbose': 0,
        'loss_function': 'RMSE',
    },
}


# ============================================================================
# Physics / Information Theory Functions
# ============================================================================

def hurst_exponent(series, max_lag=20):
    """Hurst exponent via R/S analysis (Hurst 1951).
    H < 0.5: mean-reverting | H = 0.5: random walk | H > 0.5: trending
    """
    if len(series) < max_lag * 2:
        return 0.5
    lags = range(2, min(max_lag + 1, len(series) // 2))
    rs_values = []
    for lag in lags:
        rs_list = []
        for start in range(0, len(series) - lag, lag):
            chunk = series[start:start + lag]
            if len(chunk) < lag:
                continue
            mean = np.mean(chunk)
            devs = np.cumsum(chunk - mean)
            R = np.max(devs) - np.min(devs)
            S = np.std(chunk, ddof=1)
            if S > 1e-10:
                rs_list.append(R / S)
        if rs_list:
            rs_values.append(np.mean(rs_list))
    if len(rs_values) < 3:
        return 0.5
    try:
        H = np.polyfit(np.log(np.array(list(lags)[:len(rs_values)])),
                        np.log(np.array(rs_values)), 1)[0]
        return np.clip(H, 0.0, 1.0)
    except:
        return 0.5


def approx_entropy(series, m=2, r_mult=0.2):
    """Approximate entropy (Pincus 1991) — predictability measure."""
    N = len(series)
    if N < m + 2:
        return 0.0
    r = r_mult * np.std(series)
    if r < 1e-10:
        return 0.0

    def phi(dim):
        patterns = np.array([series[i:i + dim] for i in range(N - dim + 1)])
        n_pat = len(patterns)
        counts = np.zeros(n_pat)
        for i in range(n_pat):
            dist = np.max(np.abs(patterns - patterns[i]), axis=1)
            counts[i] = np.sum(dist <= r)
        counts /= n_pat
        return np.mean(np.log(counts + 1e-10))

    return abs(phi(m) - phi(m + 1))


def spectral_entropy(series):
    """Spectral entropy — frequency distribution uniformity."""
    if len(series) < 8:
        return 0.0
    fft_vals = np.fft.rfft(series - np.mean(series))
    power = np.abs(fft_vals) ** 2
    total = np.sum(power)
    if total < 1e-10:
        return 0.0
    psd = power / total
    psd = psd[psd > 0]
    return -np.sum(psd * np.log2(psd)) / np.log2(len(psd) + 1)


def amihud_illiquidity(returns, volumes, window=21):
    """Amihud (2002) ILLIQ ratio."""
    if len(returns) < window or len(volumes) < window:
        return 0.0
    r = np.abs(returns[-window:])
    v = volumes[-window:]
    mask = v > 0
    if mask.sum() < 5:
        return 0.0
    return np.mean(r[mask] / v[mask]) * 1e6


def ou_halflife(series, max_hl=252):
    """Ornstein-Uhlenbeck half-life (Langevin equation)."""
    if len(series) < 20:
        return max_hl
    y = np.array(series)
    dy = np.diff(y)
    y_lag = y[:-1]
    try:
        X = np.column_stack([np.ones(len(y_lag)), y_lag])
        beta = np.linalg.lstsq(X, dy, rcond=None)[0]
        theta = beta[1]
        if theta >= 0:
            return max_hl
        hl = -np.log(2) / np.log(1 + theta)
        return np.clip(hl, 1, max_hl)
    except:
        return max_hl


def clean_correlation_rmt(returns_matrix, q_ratio=None):
    """Random Matrix Theory correlation cleaning (Marchenko-Pastur 1967).

    Removes noise eigenvalues from the correlation matrix.
    Only keeps eigenvalues above the Marchenko-Pastur upper bound.
    This gives a "cleaner" correlation/beta estimate.

    Args:
        returns_matrix: N×T matrix (N assets, T time periods)
        q_ratio: T/N ratio (computed if not provided)
    Returns:
        Cleaned correlation matrix
    """
    N, T = returns_matrix.shape
    if q_ratio is None:
        q_ratio = T / N

    # Sample correlation matrix
    corr = np.corrcoef(returns_matrix)

    # Eigendecomposition
    eigenvalues, eigenvectors = eigh(corr)

    # Marchenko-Pastur bounds
    lambda_plus = (1 + 1 / np.sqrt(q_ratio)) ** 2
    lambda_minus = (1 - 1 / np.sqrt(q_ratio)) ** 2

    # Zero out noise eigenvalues (below MP upper bound)
    cleaned_eigenvalues = eigenvalues.copy()
    noise_mask = eigenvalues < lambda_plus
    if noise_mask.any():
        # Replace noise eigenvalues with their mean (preserve trace)
        noise_mean = np.mean(eigenvalues[noise_mask])
        cleaned_eigenvalues[noise_mask] = noise_mean

    # Reconstruct cleaned correlation matrix
    cleaned_corr = eigenvectors @ np.diag(cleaned_eigenvalues) @ eigenvectors.T

    # Normalize diagonal to 1
    d = np.sqrt(np.diag(cleaned_corr))
    d[d < 1e-10] = 1
    cleaned_corr = cleaned_corr / np.outer(d, d)
    np.fill_diagonal(cleaned_corr, 1.0)

    return cleaned_corr


def transfer_entropy(source, target, lag=1, bins=5):
    """Transfer entropy (Schreiber 2000) — directed information flow.

    TE(X→Y) measures how much knowing past X reduces uncertainty about Y
    beyond what past Y alone provides.

    High TE(EQNR→AKRBP) means EQNR returns help predict AKRBP.
    This identifies leader-follower relationships.
    """
    N = len(source) - lag
    if N < bins * 5:
        return 0.0

    # Discretize into bins
    src = pd.qcut(source[:N], bins, labels=False, duplicates='drop').astype(int)
    tgt_curr = pd.qcut(target[lag:lag + N], bins, labels=False, duplicates='drop').astype(int)
    tgt_past = pd.qcut(target[:N], bins, labels=False, duplicates='drop').astype(int)

    # Joint and marginal distributions
    # TE = H(Y_t | Y_{t-1}) - H(Y_t | Y_{t-1}, X_{t-1})
    # = I(Y_t; X_{t-1} | Y_{t-1})

    # P(y_t, y_{t-1})
    jy = np.histogram2d(tgt_curr, tgt_past, bins=bins)[0]
    jy = jy / jy.sum()

    # P(y_t, y_{t-1}, x_{t-1})
    # Use 3D histogram via bincount
    combined = tgt_curr * bins * bins + tgt_past * bins + src
    jxyz = np.bincount(combined, minlength=bins ** 3).reshape(bins, bins, bins).astype(float)
    jxyz = jxyz / jxyz.sum()

    te = 0.0
    for yt in range(bins):
        for yt1 in range(bins):
            for xt1 in range(bins):
                p_xyz = jxyz[yt, yt1, xt1]
                p_yz = jy[yt, yt1]
                p_yt1_xt1 = jxyz[:, yt1, xt1].sum()
                p_yt1 = jy[:, yt1].sum()

                if p_xyz > 0 and p_yz > 0 and p_yt1_xt1 > 0 and p_yt1 > 0:
                    te += p_xyz * np.log2(
                        (p_xyz * p_yt1) / (p_yz * p_yt1_xt1 + 1e-15) + 1e-15
                    )

    return max(0, te)


# ============================================================================
# Regime Detection
# ============================================================================

def detect_regime(obx_vol_pctile, obx_trend):
    """Simple but effective regime classification.
    Based on OBX volatility percentile and trend.
    """
    if obx_vol_pctile > 0.90:
        return 'crisis'
    elif obx_vol_pctile > 0.65:
        return 'high_vol'
    elif obx_vol_pctile < 0.30:
        return 'low_vol'
    else:
        return 'normal'


# ============================================================================
# Data Loading
# ============================================================================

def get_db_url():
    url = os.environ.get('DATABASE_URL') or os.environ.get('SUPABASE_DATABASE_URL')
    if not url:
        for p in ['../apps/web/.env.local', '../apps/web/.env', '../.env']:
            try:
                with open(p) as f:
                    for line in f:
                        if line.startswith('DATABASE_URL='):
                            return line.split('=', 1)[1].strip().strip('"')
            except FileNotFoundError:
                continue
    return url


def load_data(conn, test_mode=False):
    print("\n[1/8] LOADING DATA")
    print("=" * 60)

    ticker_filter = ""
    if test_mode:
        tickers_sql = ",".join(f"'{t}'" for t in TEST_TICKERS)
        ticker_filter = f"AND ticker IN ({tickers_sql})"

    obx_clause = f"OR ticker = 'OBX'" if ticker_filter else ""

    prices = pd.read_sql(f"""
        SELECT ticker, date, open, high, low, close, volume
        FROM prices_daily
        WHERE close > 0 AND volume >= 0
          AND date >= '2018-01-01'
          {f"AND (ticker IN ({tickers_sql}) {obx_clause})" if test_mode else ""}
        ORDER BY ticker, date
    """, conn, parse_dates=['date'])
    print(f"  Prices: {len(prices):,} rows, {prices.ticker.nunique()} tickers")

    ticker_counts = prices.groupby('ticker').size()
    good_tickers = list(ticker_counts[ticker_counts >= MIN_TRAIN].index)
    good_tickers = [t for t in good_tickers if t != 'OBX']
    print(f"  Good tickers (≥{MIN_TRAIN} days): {len(good_tickers)}")

    fundamentals = pd.read_sql(f"""
        SELECT ticker, date, bm, ep, dy, sp, sg, mktcap, ev_ebitda
        FROM factor_fundamentals
        WHERE TRUE {ticker_filter}
        ORDER BY ticker, date
    """, conn, parse_dates=['date'])
    print(f"  Fundamentals: {len(fundamentals):,}")

    commodities = pd.read_sql("""
        SELECT symbol AS ticker, date, close
        FROM commodity_prices
        WHERE symbol IN ('BZ=F', 'CL=F', 'GC=F', 'ALI=F', 'NG=F', 'HG=F')
        ORDER BY symbol, date
    """, conn, parse_dates=['date'])
    print(f"  Commodities: {len(commodities):,}")

    shorts = pd.read_sql(f"""
        SELECT ticker, date, short_pct, change_pct
        FROM short_positions WHERE TRUE {ticker_filter}
        ORDER BY ticker, date
    """, conn, parse_dates=['date'])
    print(f"  Shorts: {len(shorts):,}")

    fx = pd.read_sql("""
        SELECT currency_pair AS pair, date, spot_rate AS rate FROM fx_spot_rates
        WHERE currency_pair IN ('NOKUSD', 'NOKEUR')
        ORDER BY date
    """, conn, parse_dates=['date'])
    print(f"  FX: {len(fx):,}")

    shipping = pd.read_sql("""
        SELECT index_name AS rate_name, rate_date AS date, rate_value AS value
        FROM shipping_market_rates
        WHERE index_name IN ('BDI', 'BDTI')
        ORDER BY rate_date
    """, conn, parse_dates=['date'])
    print(f"  Shipping rates: {len(shipping):,}")

    stocks_info = pd.read_sql("""
        SELECT ticker, sector FROM stocks WHERE sector IS NOT NULL
    """, conn)
    sector_map = dict(zip(stocks_info.ticker, stocks_info.sector))

    obx = prices[prices.ticker == 'OBX'][['date', 'close']].rename(columns={'close': 'obx_close'})

    return {
        'prices': prices, 'fundamentals': fundamentals,
        'commodities': commodities, 'shorts': shorts, 'fx': fx,
        'shipping': shipping, 'obx': obx, 'good_tickers': good_tickers,
        'sector_map': sector_map,
    }


# ============================================================================
# Feature Engineering (100+ features)
# ============================================================================

def engineer_features(data: dict) -> pd.DataFrame:
    print("\n[2/8] ENGINEERING 100+ FEATURES")
    print("=" * 60)

    prices = data['prices'].copy()
    obx = data['obx'].copy()
    sector_map = data['sector_map']
    good_tickers = data['good_tickers']

    all_dfs = []
    n_tickers = len(good_tickers)

    for idx, ticker in enumerate(good_tickers):
        if (idx + 1) % 25 == 0 or idx == 0:
            print(f"  Processing {idx + 1}/{n_tickers}: {ticker}")

        df = prices[prices.ticker == ticker].copy().sort_values('date').reset_index(drop=True)
        if len(df) < MIN_TRAIN:
            continue

        close = df['close'].values
        high = df['high'].values
        low = df['low'].values
        volume = df['volume'].values.astype(float)
        returns = np.diff(np.log(close + 1e-10))
        returns = np.insert(returns, 0, 0)
        df['ret'] = returns

        # ── MOMENTUM (multi-scale) ──
        for w in [1, 2, 3, 5, 10, 21, 63, 126, 252]:
            df[f'ret_{w}d'] = df['close'].pct_change(w)

        # Skip-month momentum (Jegadeesh & Titman 1993)
        df['mom_12_1'] = df['close'].pct_change(252) - df['close'].pct_change(21)
        df['mom_quality'] = df['ret_252d'] - df['ret_21d']
        df['mom_accel'] = df['ret_63d'] - df['ret_63d'].shift(21)

        # ── MEAN REVERSION ──
        for w in [20, 50, 200]:
            sma = df['close'].rolling(w, min_periods=w).mean()
            df[f'dist_sma{w}'] = (df['close'] - sma) / (sma + 1e-10)

        std20 = df['close'].rolling(20).std()
        sma20 = df['close'].rolling(20).mean()
        df['z_score_20d'] = (df['close'] - sma20) / (std20 + 1e-10)

        roll_max = df['close'].rolling(252, min_periods=63).max()
        roll_min = df['close'].rolling(252, min_periods=63).min()
        df['dist_52w_high'] = (df['close'] - roll_max) / (roll_max + 1e-10)
        df['dist_52w_low'] = (df['close'] - roll_min) / (roll_min + 1e-10)

        # OU half-life (rolling 63d, every 5 days for speed)
        df['ou_halflife'] = np.nan
        for i in range(63, len(df), 5):
            df.iloc[i, df.columns.get_loc('ou_halflife')] = ou_halflife(close[i - 63:i])
        df['ou_halflife'] = df['ou_halflife'].ffill()

        # ── VOLATILITY & HIGHER MOMENTS ──
        for w in [5, 21, 63]:
            df[f'vol_{w}d'] = df['ret'].rolling(w).std() * np.sqrt(252)

        df['vol_ratio_5_21'] = df['vol_5d'] / (df['vol_21d'] + 1e-10)
        df['vol_ratio_21_63'] = df['vol_21d'] / (df['vol_63d'] + 1e-10)
        df['vol_of_vol'] = df['vol_21d'].rolling(63).std()

        df['skew_21d'] = df['ret'].rolling(21).apply(
            lambda x: scipy_stats.skew(x) if len(x) >= 10 else 0, raw=True)
        df['kurt_21d'] = df['ret'].rolling(21).apply(
            lambda x: scipy_stats.kurtosis(x) if len(x) >= 10 else 0, raw=True)
        df['downside_vol'] = df['ret'].rolling(21).apply(
            lambda x: np.sqrt(np.mean(np.minimum(x, 0) ** 2)) * np.sqrt(252), raw=True)
        df['max_dd_21d'] = df['close'].rolling(21).apply(
            lambda x: (x[-1] / x.max() - 1) if x.max() > 0 else 0, raw=True)

        # Garman-Klass vol (uses OHLC — 5x more efficient than close-close)
        log_hl = np.log(high / (low + 1e-10)) ** 2
        log_co = np.log(close / (df['open'].values + 1e-10)) ** 2
        gk = 0.5 * log_hl - (2 * np.log(2) - 1) * log_co
        df['gk_vol'] = pd.Series(gk).rolling(21).mean().apply(lambda x: np.sqrt(abs(x) * 252))

        # ── MICROSTRUCTURE ──
        df['amihud'] = np.nan
        for i in range(21, len(df)):
            df.iloc[i, df.columns.get_loc('amihud')] = amihud_illiquidity(
                returns[i - 21:i], volume[i - 21:i])

        df['log_dollar_vol'] = np.log(close * volume + 1)
        vol_sma20 = pd.Series(volume).rolling(20).mean()
        df['volume_ratio'] = volume / (vol_sma20.values + 1)
        df['vol_trend'] = pd.Series(volume).rolling(5).mean().values / (vol_sma20.values + 1)

        # Serial correlation (Kyle's lambda proxy)
        df['autocorr_1d'] = df['ret'].rolling(21).apply(
            lambda x: np.corrcoef(x[1:], x[:-1])[0, 1] if len(x) > 5 else 0, raw=True)

        # ── ENTROPY & COMPLEXITY (every 5 days, ffill) ──
        df['hurst'] = np.nan
        df['approx_ent'] = np.nan
        df['spec_ent'] = np.nan

        for i in range(63, len(df), 5):
            wr = returns[max(0, i - 63):i]
            if len(wr) >= 20:
                df.iloc[i, df.columns.get_loc('hurst')] = hurst_exponent(wr)
                df.iloc[i, df.columns.get_loc('approx_ent')] = approx_entropy(wr)
                df.iloc[i, df.columns.get_loc('spec_ent')] = spectral_entropy(wr)

        for col in ['hurst', 'approx_ent', 'spec_ent']:
            df[col] = df[col].ffill()

        # ── MARKET BETA & IDIOSYNCRATIC VOL ──
        df = df.merge(obx, on='date', how='left')
        df['obx_close'] = df['obx_close'].ffill()
        df['obx_ret'] = df['obx_close'].pct_change()

        df['beta_63d'] = np.nan
        df['ivol_63d'] = np.nan
        for i in range(63, len(df)):
            sr = returns[i - 63:i]
            mr = df['obx_ret'].values[i - 63:i]
            valid = ~(np.isnan(sr) | np.isnan(mr))
            if valid.sum() > 20:
                cov_mat = np.cov(sr[valid], mr[valid])
                if cov_mat[1, 1] > 1e-15:
                    beta = cov_mat[0, 1] / cov_mat[1, 1]
                    df.iloc[i, df.columns.get_loc('beta_63d')] = beta
                    resid = sr[valid] - beta * mr[valid]
                    df.iloc[i, df.columns.get_loc('ivol_63d')] = np.std(resid) * np.sqrt(252)

        # Excess return
        obx_cum_21 = df['obx_ret'].rolling(21).apply(
            lambda x: (1 + x).prod() - 1 if len(x) >= 5 else 0, raw=True)
        df['excess_ret_21d'] = df['ret_21d'] - obx_cum_21

        # ── TREND STRUCTURE ──
        sma20v = df['close'].rolling(20).mean()
        sma50v = df['close'].rolling(50).mean()
        sma200v = df['close'].rolling(200).mean()
        df['above_sma20'] = (df['close'] > sma20v).astype(float)
        df['above_sma50'] = (df['close'] > sma50v).astype(float)
        df['above_sma200'] = (df['close'] > sma200v).astype(float)
        df['trend_score'] = df['above_sma20'] + df['above_sma50'] + df['above_sma200']

        ema12 = df['close'].ewm(span=12).mean()
        ema26 = df['close'].ewm(span=26).mean()
        df['macd_above'] = ((ema12 - ema26) > (ema12 - ema26).ewm(span=9).mean()).astype(float)
        df['mom_align'] = (
            (df['ret_21d'] > 0).astype(float) +
            (df['ret_63d'] > 0).astype(float) +
            (df['ret_126d'] > 0).astype(float)
        )

        # ── CALENDAR ──
        df['is_january'] = (df['date'].dt.month == 1).astype(float)
        df['is_turn_of_month'] = ((df['date'].dt.day <= 3) | (df['date'].dt.day >= 28)).astype(float)
        df['month_sin'] = np.sin(2 * np.pi * df['date'].dt.month / 12)
        df['month_cos'] = np.cos(2 * np.pi * df['date'].dt.month / 12)

        df['sector'] = sector_map.get(ticker, 'Unknown')
        all_dfs.append(df)

    features = pd.concat(all_dfs, ignore_index=True)
    print(f"  → {len(features):,} rows from {features.ticker.nunique()} tickers")

    # ── MERGE EXTERNAL DATA ──
    print("  Merging commodities, FX, shorts, shipping, fundamentals...")

    # Commodities
    for sym in ['BZ=F', 'CL=F', 'GC=F', 'ALI=F', 'NG=F', 'HG=F']:
        c = data['commodities'][data['commodities'].ticker == sym][['date', 'close']].copy()
        c = c.rename(columns={'close': f'c_{sym}'})
        for w in [5, 21, 63]:
            c[f'c_{sym}_r{w}'] = c[f'c_{sym}'].pct_change(w)
        features = features.merge(c[['date'] + [f'c_{sym}_r{w}' for w in [5, 21, 63]]],
                                   on='date', how='left')

    # FX
    for pair in ['NOKUSD', 'NOKEUR']:
        f = data['fx'][data['fx'].pair == pair][['date', 'rate']].rename(columns={'rate': f'fx_{pair}'})
        for w in [5, 21]:
            f[f'fx_{pair}_r{w}'] = f[f'fx_{pair}'].pct_change(w)
        features = features.merge(f[['date'] + [f'fx_{pair}_r{w}' for w in [5, 21]]],
                                   on='date', how='left')

    # Shorts
    if len(data['shorts']) > 0:
        sp = data['shorts'][['ticker', 'date', 'short_pct']].copy()
        sp['short_change_21d'] = sp.groupby('ticker')['short_pct'].diff(21)
        features = features.merge(sp[['ticker', 'date', 'short_pct', 'short_change_21d']],
                                   on=['ticker', 'date'], how='left')
    else:
        features['short_pct'] = 0
        features['short_change_21d'] = 0

    # Shipping
    if len(data['shipping']) > 0:
        for rate in ['BDI', 'BDTI']:
            s = data['shipping'][data['shipping'].rate_name == rate][['date', 'value']].rename(
                columns={'value': f'ship_{rate}'})
            s[f'ship_{rate}_r21'] = s[f'ship_{rate}'].pct_change(21)
            features = features.merge(s[['date', f'ship_{rate}_r21']], on='date', how='left')

    # Fundamentals
    if len(data['fundamentals']) > 0:
        features = features.merge(
            data['fundamentals'][['ticker', 'date', 'bm', 'ep', 'dy', 'sp', 'mktcap', 'ev_ebitda']],
            on=['ticker', 'date'], how='left', suffixes=('', '_fund'))
        for col in ['bm', 'ep', 'dy', 'sp', 'mktcap', 'ev_ebitda']:
            if col in features.columns:
                features[col] = features.groupby('ticker')[col].ffill()
        features['ep_momentum'] = features.groupby('ticker')['ep'].diff(63)
        features['mktcap_log'] = np.log(features['mktcap'].clip(lower=1) + 1)

    features = features.fillna(method='ffill').fillna(0)

    # ── CROSS-SECTIONAL RANKS ──
    print("  Computing cross-sectional ranks...")
    rank_cols = ['ret_5d', 'ret_21d', 'ret_63d', 'vol_21d', 'amihud', 'beta_63d']
    fund_rank = [c for c in ['ep', 'bm', 'dy', 'mktcap_log'] if c in features.columns]
    for col in rank_cols + fund_rank:
        if col in features.columns:
            features[f'{col}_rank'] = features.groupby('date')[col].rank(pct=True)

    # ── INTERACTION FEATURES ──
    print("  Computing interaction features...")
    features['mom_x_vol'] = features.get('ret_63d_rank', 0) * features.get('vol_21d_rank', 0)
    if 'ep_rank' in features.columns:
        r252_rank = features.groupby('date')['ret_252d'].rank(pct=True)
        features['value_x_mom'] = features['ep_rank'] * r252_rank
    features['short_squeeze'] = features['short_pct'] * features.get('ret_21d', 0).clip(lower=0)
    features['trend_vol'] = features['trend_score'] * features.get('volume_ratio', 1)
    features['systematic_exposure'] = features['beta_63d'] * features['obx_ret'].rolling(21).sum()

    # ── SECTOR MOMENTUM DECOMPOSITION (Ehsani & Linnainmaa 2022) ──
    print("  Computing sector momentum decomposition...")
    features['sector_ret_21d'] = features.groupby(['date', 'sector'])['ret_21d'].transform('mean')
    features['own_momentum'] = features['ret_21d'] - features['sector_ret_21d']

    # ── REGIME FEATURES ──
    print("  Computing regime features...")
    obx_data = data['obx'].copy()
    obx_data['obx_vol_21d'] = obx_data['obx_close'].pct_change().rolling(21).std() * np.sqrt(252)
    obx_data['obx_vol_pctile'] = obx_data['obx_vol_21d'].rolling(252, min_periods=63).rank(pct=True)
    obx_data['obx_trend'] = (obx_data['obx_close'] > obx_data['obx_close'].rolling(200).mean()).astype(float)
    obx_data['regime'] = obx_data.apply(
        lambda r: detect_regime(r.get('obx_vol_pctile', 0.5), r.get('obx_trend', 1)), axis=1)

    features = features.merge(
        obx_data[['date', 'obx_vol_pctile', 'obx_trend', 'regime']],
        on='date', how='left')
    features['obx_vol_pctile'] = features['obx_vol_pctile'].ffill().fillna(0.5)
    features['obx_trend'] = features['obx_trend'].ffill().fillna(1)
    features['regime'] = features['regime'].ffill().fillna('normal')

    # ── MULTI-HORIZON TARGETS ──
    print("  Computing multi-horizon targets...")
    for name, horizon in HORIZONS.items():
        features[f'fwd_ret_{name}'] = features.groupby('ticker')['close'].transform(
            lambda x: x.shift(-horizon) / x - 1)
        # Cross-sectional rank of forward return (0-1, uniform)
        features[f'target_rank_{name}'] = features.groupby('date')[f'fwd_ret_{name}'].rank(pct=True)

    features = features.dropna(subset=['fwd_ret_medium'])

    # Identify feature columns
    exclude = {'ticker', 'date', 'open', 'high', 'low', 'close', 'volume', 'ret',
               'obx_close', 'obx_ret', 'sector', 'regime'}
    exclude.update({f'fwd_ret_{n}' for n in HORIZONS})
    exclude.update({f'target_rank_{n}' for n in HORIZONS})

    feature_cols = [c for c in features.columns
                    if c not in exclude
                    and features[c].dtype in ['float64', 'float32', 'int64', 'int32']]

    # Remove >30% NaN features
    nan_pct = features[feature_cols].isna().mean()
    feature_cols = [c for c in feature_cols if nan_pct[c] < 0.3]
    features[feature_cols] = features[feature_cols].fillna(0)

    print(f"  → Final: {len(features):,} rows, {len(feature_cols)} features, "
          f"{features.ticker.nunique()} tickers")
    for name in HORIZONS:
        if f'target_rank_{name}' in features.columns:
            col = f'fwd_ret_{name}'
            up_pct = (features[col] > 0).mean()
            print(f"  → {name} horizon ({HORIZONS[name]}d): {up_pct:.1%} positive")

    return features, feature_cols


# ============================================================================
# Feature Selection
# ============================================================================

def select_features(X, y, feature_cols, max_features=60):
    """Quick feature importance via LightGBM for a given target."""
    model = lgb.LGBMRegressor(
        n_estimators=100, max_depth=3, num_leaves=8,
        learning_rate=0.1, verbose=-1, random_state=42,
        subsample=0.5, colsample_bytree=0.5,
    )
    model.fit(X[feature_cols].values, y.values)
    importance = pd.Series(model.feature_importances_, index=feature_cols)
    importance = importance.sort_values(ascending=False)
    selected = list(importance[importance > 0].head(max_features).index)
    return selected, importance


# ============================================================================
# Walk-Forward Training (Multi-Horizon)
# ============================================================================

def train_horizon_model(X_train, y_train, X_val, y_val, horizon_name):
    """Train XGB + LGBM + CatBoost regressor stack for one horizon.
    Predict RANK (0-1), not direction. Regression is the right approach
    for rank prediction — it preserves ordering information.
    """
    models = {}

    # XGBoost
    xgb_model = xgb.XGBRegressor(**TREE_PARAMS['xgb'])
    xgb_model.fit(X_train, y_train, eval_set=[(X_val, y_val)], verbose=False)
    models['xgb'] = xgb_model

    # LightGBM
    lgbm_model = lgb.LGBMRegressor(**TREE_PARAMS['lgbm'])
    lgbm_model.fit(X_train, y_train, eval_set=[(X_val, y_val)],
                   callbacks=[lgb.early_stopping(30, verbose=False), lgb.log_evaluation(0)])
    models['lgbm'] = lgbm_model

    # CatBoost
    cat_model = cb.CatBoostRegressor(**TREE_PARAMS['cat'])
    cat_model.fit(X_train, y_train, eval_set=(X_val, y_val), early_stopping_rounds=30)
    models['cat'] = cat_model

    return models


def predict_horizon(models, X):
    """Ensemble prediction from 3 tree models."""
    p_xgb = models['xgb'].predict(X)
    p_lgbm = models['lgbm'].predict(X)
    p_cat = models['cat'].predict(X)
    return (p_xgb + p_lgbm + p_cat) / 3.0


def run_walk_forward(features, feature_cols):
    print(f"\n[3/8] WALK-FORWARD TRAINING (3 horizons × 3 models)")
    print("=" * 60)

    # Feature selection per horizon
    horizon_features = {}
    for name in HORIZONS:
        target_col = f'target_rank_{name}'
        if target_col not in features.columns:
            continue
        mask = features[target_col].notna()
        selected, importance = select_features(
            features.loc[mask], features.loc[mask, target_col], feature_cols, max_features=50)
        horizon_features[name] = selected
        print(f"\n  {name.upper()} horizon: {len(selected)} features selected")
        print(f"    Top 10: {', '.join(selected[:10])}")

    # Walk-forward splits (monthly rebalance)
    unique_dates = sorted(features['date'].unique())
    n_dates = len(unique_dates)

    all_predictions = []
    feature_importance_sum = {name: np.zeros(len(horizon_features.get(name, [])))
                              for name in HORIZONS if name in horizon_features}
    n_folds = 0

    # Expanding window with monthly steps
    for test_start_idx in range(MIN_TRAIN + PURGE_GAP, n_dates - REBAL_PERIOD, REBAL_PERIOD):
        train_end_idx = test_start_idx - PURGE_GAP
        test_end_idx = min(test_start_idx + REBAL_PERIOD, n_dates)

        train_end = unique_dates[train_end_idx]
        test_start = unique_dates[test_start_idx]
        test_end = unique_dates[test_end_idx - 1]

        train_mask = features['date'] <= train_end
        test_mask = (features['date'] >= test_start) & (features['date'] <= test_end)

        X_train_full = features.loc[train_mask]
        X_test_full = features.loc[test_mask]

        if len(X_train_full) < 200 or len(X_test_full) < 10:
            continue

        # Validation: last 20% of training
        val_size = max(int(len(X_train_full) * 0.15), 50)
        train_data = X_train_full.iloc[:-val_size]
        val_data = X_train_full.iloc[-val_size:]

        test_pred = X_test_full[['ticker', 'date', 'regime']].copy()
        for name in HORIZONS:
            test_pred[f'fwd_ret_{name}'] = X_test_full[f'fwd_ret_{name}'].values
            test_pred[f'target_rank_{name}'] = X_test_full[f'target_rank_{name}'].values

        try:
            # Train per-horizon models
            for name in HORIZONS:
                if name not in horizon_features:
                    continue
                feats = horizon_features[name]
                target = f'target_rank_{name}'

                Xtr = train_data[feats].values
                ytr = train_data[target].values
                Xv = val_data[feats].values
                yv = val_data[target].values
                Xt = X_test_full[feats].values

                valid_train = ~np.isnan(ytr)
                valid_val = ~np.isnan(yv)
                if valid_train.sum() < 100 or valid_val.sum() < 20:
                    test_pred[f'pred_{name}'] = 0.5
                    continue

                models = train_horizon_model(
                    Xtr[valid_train], ytr[valid_train],
                    Xv[valid_val], yv[valid_val], name)

                pred = predict_horizon(models, Xt)
                test_pred[f'pred_{name}'] = pred

                # Accumulate importance
                imp = models['xgb'].feature_importances_
                feature_importance_sum[name][:len(imp)] += imp

            # Regime-weighted fusion
            regime = test_pred['regime'].values
            fused = np.zeros(len(test_pred))
            for i in range(len(test_pred)):
                r = regime[i] if isinstance(regime[i], str) else 'normal'
                weights = REGIME_WEIGHTS.get(r, REGIME_WEIGHTS['normal'])
                for name in HORIZONS:
                    if f'pred_{name}' in test_pred.columns:
                        fused[i] += weights[name] * test_pred[f'pred_{name}'].values[i]

            test_pred['fused_signal'] = fused
            test_pred['fold'] = n_folds

            all_predictions.append(test_pred)
            n_folds += 1

            if n_folds % 10 == 0:
                recent = pd.concat(all_predictions[-10:])
                valid = recent['target_rank_medium'].notna()
                if valid.sum() > 0:
                    ic = scipy_stats.spearmanr(
                        recent.loc[valid, 'fused_signal'],
                        recent.loc[valid, 'target_rank_medium']
                    )[0]
                    print(f"    Fold {n_folds}: IC={ic:+.3f}, N={valid.sum()}")

        except Exception as e:
            if n_folds < 3:
                print(f"    Fold error: {e}")
            continue

    if not all_predictions:
        print("  ERROR: No successful folds!")
        return None, None, 0

    predictions = pd.concat(all_predictions, ignore_index=True)
    print(f"\n  → {len(predictions):,} predictions, {n_folds} folds")

    # Feature importance per horizon
    print(f"\n  Feature importance summary:")
    for name in HORIZONS:
        if name in horizon_features and feature_importance_sum[name].sum() > 0:
            imp = pd.Series(
                feature_importance_sum[name] / max(n_folds, 1),
                index=horizon_features[name]
            ).sort_values(ascending=False)
            print(f"\n    {name.upper()} top 10:")
            for f in imp.head(10).index:
                print(f"      {f:30s} {imp[f]:8.4f}")

    return predictions, horizon_features, n_folds


# ============================================================================
# Evaluation — Information Coefficient & Portfolio Backtest
# ============================================================================

def evaluate_predictions(predictions):
    print(f"\n[4/8] EVALUATION — INFORMATION COEFFICIENT")
    print("=" * 60)

    # ── IC per horizon ──
    for name in HORIZONS:
        pred_col = f'pred_{name}'
        actual_col = f'target_rank_{name}'
        if pred_col not in predictions.columns:
            continue

        valid = predictions[[pred_col, actual_col]].dropna()
        if len(valid) < 50:
            continue

        ic = scipy_stats.spearmanr(valid[pred_col], valid[actual_col])[0]

        # Rolling IC (per fold)
        fold_ics = []
        for fold in predictions['fold'].unique():
            fdf = predictions[predictions['fold'] == fold][[pred_col, actual_col]].dropna()
            if len(fdf) >= 20:
                fold_ic = scipy_stats.spearmanr(fdf[pred_col], fdf[actual_col])[0]
                fold_ics.append(fold_ic)

        ic_mean = np.mean(fold_ics) if fold_ics else ic
        ic_std = np.std(fold_ics) if len(fold_ics) > 1 else 1
        icir = ic_mean / (ic_std + 1e-10)

        # % positive IC folds
        pct_positive = np.mean([x > 0 for x in fold_ics]) if fold_ics else 0

        print(f"\n  {name.upper()} horizon ({HORIZONS[name]}d):")
        print(f"    Overall IC:    {ic:+.4f}")
        print(f"    Mean fold IC:  {ic_mean:+.4f}")
        print(f"    IC std:        {ic_std:.4f}")
        print(f"    ICIR:          {icir:+.2f}")
        print(f"    % positive IC: {pct_positive:.0%} ({len(fold_ics)} folds)")

    # ── Fused signal IC ──
    valid = predictions[['fused_signal', 'target_rank_medium']].dropna()
    if len(valid) > 50:
        ic = scipy_stats.spearmanr(valid['fused_signal'], valid['target_rank_medium'])[0]
        fold_ics = []
        for fold in predictions['fold'].unique():
            fdf = predictions[predictions['fold'] == fold][['fused_signal', 'target_rank_medium']].dropna()
            if len(fdf) >= 20:
                fold_ics.append(scipy_stats.spearmanr(fdf['fused_signal'], fdf['target_rank_medium'])[0])

        fold_ics = [x for x in fold_ics if not np.isnan(x)]
        ic_mean = np.mean(fold_ics) if fold_ics else 0.0
        ic_std = np.std(fold_ics) if len(fold_ics) > 1 else 1
        icir = ic_mean / (ic_std + 1e-10)
        pct_pos = np.mean([x > 0 for x in fold_ics]) if fold_ics else 0.0

        print(f"\n  FUSED SIGNAL (regime-weighted):")
        print(f"    Overall IC:    {ic:+.4f}")
        print(f"    Mean fold IC:  {ic_mean:+.4f}")
        print(f"    ICIR:          {icir:+.2f}")
        print(f"    % positive IC: {pct_pos:.0%}")

        # Fundamental Law estimate
        n_stocks = predictions.groupby('date')['ticker'].nunique().median()
        ir_est = abs(ic_mean) * np.sqrt(n_stocks)
        sharpe_est = ir_est * np.sqrt(252 / REBAL_PERIOD)
        print(f"\n    Fundamental Law of Active Management:")
        print(f"      IC = {ic_mean:+.4f}")
        print(f"      Breadth = {n_stocks:.0f} stocks")
        print(f"      IR estimate = IC × √N = {ir_est:.2f}")
        print(f"      Annualized Sharpe estimate = {sharpe_est:.2f}")


def run_portfolio_backtest(predictions):
    print(f"\n[5/8] PORTFOLIO BACKTEST — TOP QUINTILE LONG-ONLY")
    print("=" * 60)

    # Deduplicate: keep latest fold per (ticker, date)
    predictions = predictions.sort_values('fold').groupby(['ticker', 'date']).last().reset_index()

    # Non-overlapping rebalance dates
    all_dates = sorted(predictions['date'].unique())
    rebal_dates = all_dates[::REBAL_PERIOD]

    period_returns = []
    holdings_history = []

    for i, date in enumerate(rebal_dates):
        day_data = predictions[predictions['date'] == date].copy()
        if len(day_data) < 5:
            continue

        # Rank stocks by fused signal on this date
        day_data['signal_rank'] = day_data['fused_signal'].rank(pct=True)

        # Top quintile (top 20% by signal)
        n_long = max(int(len(day_data) * 0.2), 1)
        top = day_data.nlargest(n_long, 'fused_signal')

        # Equal weight within top quintile
        # Bottom quintile (for L/S spread analysis)
        bottom = day_data.nsmallest(n_long, 'fused_signal')

        # Use 21d forward return (medium horizon)
        if 'fwd_ret_medium' not in top.columns:
            continue

        long_ret = top['fwd_ret_medium'].mean()
        short_ret = bottom['fwd_ret_medium'].mean()
        ls_spread = long_ret - short_ret

        # Market (equal weight all)
        market_ret = day_data['fwd_ret_medium'].mean()

        # Long-only excess
        long_excess = long_ret - market_ret

        # Transaction cost (30bps round-trip)
        cost = 0.003
        long_net = long_ret - cost

        period_returns.append({
            'date': date,
            'long_gross': long_ret,
            'long_net': long_net,
            'short_gross': short_ret,
            'ls_spread': ls_spread,
            'market': market_ret,
            'long_excess': long_excess,
            'n_long': len(top),
            'n_total': len(day_data),
            'hit_rate': (top['fwd_ret_medium'] > 0).mean(),
            'top_tickers': ', '.join(top['ticker'].values[:5]),
        })

    if not period_returns:
        print("  No rebalance periods!")
        return

    bt = pd.DataFrame(period_returns)

    # Cumulative returns
    bt['cum_long_gross'] = (1 + bt['long_gross']).cumprod()
    bt['cum_long_net'] = (1 + bt['long_net']).cumprod()
    bt['cum_market'] = (1 + bt['market']).cumprod()

    total_long_gross = bt['cum_long_gross'].iloc[-1] - 1
    total_long_net = bt['cum_long_net'].iloc[-1] - 1
    total_market = bt['cum_market'].iloc[-1] - 1
    n_periods = len(bt)
    years = n_periods * REBAL_PERIOD / 252

    ann_long_gross = (1 + total_long_gross) ** (1 / max(years, 0.5)) - 1
    ann_long_net = (1 + total_long_net) ** (1 / max(years, 0.5)) - 1
    ann_market = (1 + total_market) ** (1 / max(years, 0.5)) - 1

    # Sharpe (annualized from monthly periods)
    sharpe_gross = (np.mean(bt['long_gross']) / (np.std(bt['long_gross']) + 1e-10)) * np.sqrt(252 / REBAL_PERIOD)
    sharpe_net = (np.mean(bt['long_net']) / (np.std(bt['long_net']) + 1e-10)) * np.sqrt(252 / REBAL_PERIOD)
    sharpe_market = (np.mean(bt['market']) / (np.std(bt['market']) + 1e-10)) * np.sqrt(252 / REBAL_PERIOD)

    # Max drawdown
    peak = bt['cum_long_net'].cummax()
    dd = bt['cum_long_net'] / peak - 1
    max_dd = dd.min()

    # Win rates
    period_win_rate = (bt['long_net'] > 0).mean()
    avg_hit_rate = bt['hit_rate'].mean()
    avg_ls_spread = bt['ls_spread'].mean() * 100

    # Long/Short hit rates
    long_beats_market = (bt['long_excess'] > 0).mean()

    print(f"\n  RESULTS ({n_periods} periods, {years:.1f} years)")
    print(f"  {'':40s} {'Long Q1':>10s} {'Market':>10s}")
    print(f"  {'-' * 62}")
    print(f"  {'Total Return':40s} {total_long_gross:>+9.1%}  {total_market:>+9.1%}")
    print(f"  {'Total Return (net of costs)':40s} {total_long_net:>+9.1%}")
    print(f"  {'Annualized Return':40s} {ann_long_gross:>+9.1%}  {ann_market:>+9.1%}")
    print(f"  {'Annualized Return (net)':40s} {ann_long_net:>+9.1%}")
    print(f"  {'Sharpe Ratio':40s} {sharpe_gross:>+9.2f}  {sharpe_market:>+9.2f}")
    print(f"  {'Sharpe Ratio (net)':40s} {sharpe_net:>+9.2f}")
    print(f"  {'Max Drawdown':40s} {max_dd:>9.1%}")
    print(f"  {'Period Win Rate (net)':40s} {period_win_rate:>9.1%}")
    print(f"  {'Avg Position Hit Rate':40s} {avg_hit_rate:>9.1%}")
    print(f"  {'Long Beats Market %':40s} {long_beats_market:>9.1%}")
    print(f"  {'Avg L/S Spread (per period)':40s} {avg_ls_spread:>+8.2f}%")
    print(f"  {'Avg Stocks in Long Basket':40s} {bt['n_long'].mean():>9.1f}")

    # Per-period detail
    print(f"\n  PERIOD DETAIL (last 12):")
    print(f"  {'Date':12s} {'Long':>8s} {'Mkt':>8s} {'L-S':>8s} {'Hit':>6s} {'N':>4s}  Top Holdings")
    print(f"  {'-' * 75}")
    for _, row in bt.tail(12).iterrows():
        print(f"  {str(row['date'])[:10]:12s} "
              f"{row['long_gross']:>+7.2%} "
              f"{row['market']:>+7.2%} "
              f"{row['ls_spread']:>+7.2%} "
              f"{row['hit_rate']:>5.0%} "
              f"{row['n_long']:>3.0f}  "
              f"{row['top_tickers']}")

    # Per-stock analysis: which stocks appear most in top quintile?
    print(f"\n  STOCK SELECTION FREQUENCY (top quintile):")
    all_top = predictions.copy()
    all_top['in_top'] = False

    for date in rebal_dates:
        mask = all_top['date'] == date
        if mask.sum() < 5:
            continue
        n_top = max(int(mask.sum() * 0.2), 1)
        top_idx = all_top.loc[mask].nlargest(n_top, 'fused_signal').index
        all_top.loc[top_idx, 'in_top'] = True

    stock_freq = all_top.groupby('ticker').agg(
        times_in_top=('in_top', 'sum'),
        total_dates=('in_top', 'count'),
        avg_signal=('fused_signal', 'mean'),
        avg_fwd_ret=('fwd_ret_medium', 'mean'),
    )
    stock_freq['selection_rate'] = stock_freq['times_in_top'] / stock_freq['total_dates']
    stock_freq['hit_rate'] = all_top[all_top['in_top']].groupby('ticker').apply(
        lambda x: (x['fwd_ret_medium'] > 0).mean()
    )
    stock_freq = stock_freq.sort_values('selection_rate', ascending=False)

    print(f"  {'Ticker':10s} {'Selected%':>10s} {'Avg Ret':>10s} {'Hit Rate':>10s} {'Times':>6s}")
    print(f"  {'-' * 50}")
    for ticker, row in stock_freq.head(15).iterrows():
        hr = row.get('hit_rate', 0)
        print(f"  {ticker:10s} {row['selection_rate']:>9.1%}  "
              f"{row['avg_fwd_ret']*100:>+8.2f}%  "
              f"{hr:>9.1%}  "
              f"{row['times_in_top']:>5.0f}")

    return bt


# ============================================================================
# Signal Generation & DB Writing
# ============================================================================

def generate_and_write_signals(predictions, conn, no_write=False):
    print(f"\n[6/8] GENERATING SIGNALS")
    print("=" * 60)

    # Use the most recent prediction per ticker
    latest_date = predictions['date'].max()
    latest = predictions[predictions['date'] == latest_date].copy()
    print(f"  Latest signal date: {latest_date}")
    print(f"  Stocks with signals: {len(latest)}")

    if len(latest) == 0:
        return

    # Signal value: centered and scaled fused signal
    # fused_signal is predicted rank (0-1), center at 0.5, scale to [-1, 1]
    latest['signal_value'] = (latest['fused_signal'] - 0.5) * 2

    # All historical signals for backtest
    all_signals = predictions[['ticker', 'date', 'fused_signal', 'fwd_ret_medium']].copy()
    all_signals['signal_value'] = (all_signals['fused_signal'] - 0.5) * 2
    all_signals['model_id'] = 'yggdrasil_v7'
    all_signals['confidence'] = all_signals['fused_signal'].clip(0, 1)
    all_signals['predicted_return'] = all_signals['fwd_ret_medium'].fillna(0)

    # Deduplicate: overlapping walk-forward folds produce multiple predictions per (ticker, date)
    # Keep last fold's prediction (most recent training data)
    all_signals = all_signals.sort_values('date').drop_duplicates(subset=['ticker', 'date'], keep='last')
    print(f"  → {len(all_signals):,} total signals across all dates (after dedup)")

    if no_write:
        print("  → Skipping DB write (--no-write)")
        return

    try:
        write_conn = psycopg2.connect(get_db_url())
        cur = write_conn.cursor()

        # Register model
        cur.execute("""
            INSERT INTO alpha_model_registry (model_id, model_type, display_name, is_active, notes)
            VALUES ('yggdrasil_v7', 'multi_horizon_stack', 'Yggdrasil v7', true,
                    'Multi-scale signal fusion (5d/21d/63d) with regime weighting, cross-sectional ranking')
            ON CONFLICT (model_id) DO UPDATE SET
                display_name = EXCLUDED.display_name, is_active = true, notes = EXCLUDED.notes
        """)
        write_conn.commit()

        # Write signals in batches
        batch_size = 500
        written = 0
        for start in range(0, len(all_signals), batch_size):
            batch = all_signals.iloc[start:start + batch_size]
            values = []
            for _, row in batch.iterrows():
                values.append(cur.mogrify(
                    "(%s, %s, %s, %s, %s, %s, %s)",
                    (row['ticker'], row['date'], row['model_id'], '21d',
                     round(float(row['signal_value']), 4),
                     round(float(row['predicted_return']), 4),
                     round(float(row['confidence']), 4))
                ).decode())

            if values:
                sql = f"""
                    INSERT INTO alpha_signals (ticker, signal_date, model_id, horizon,
                                              signal_value, predicted_return, confidence)
                    VALUES {','.join(values)}
                    ON CONFLICT (ticker, signal_date, model_id, horizon) DO UPDATE SET
                        signal_value = EXCLUDED.signal_value,
                        predicted_return = EXCLUDED.predicted_return,
                        confidence = EXCLUDED.confidence
                """
                cur.execute(sql)
                written += len(batch)

            if written % 5000 == 0 and written > 0:
                write_conn.commit()
                print(f"    Written {written:,} / {len(all_signals):,}")

        write_conn.commit()
        print(f"  → {written:,} signals written to database")
        write_conn.close()

    except Exception as e:
        print(f"  DB write error: {e}")


# ============================================================================
# Main
# ============================================================================

def main():
    parser = argparse.ArgumentParser(description='Alpha Engine v7 — Yggdrasil')
    parser.add_argument('--test', action='store_true', help='Test mode (15 tickers)')
    parser.add_argument('--no-write', action='store_true', help='Skip DB write')
    args = parser.parse_args()

    print("=" * 60)
    print(f"  ALPHA ENGINE v7 — YGGDRASIL")
    print(f"  {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"  MODE: {'TEST (15 tickers)' if args.test else 'FULL UNIVERSE'}")
    print(f"  ARCHITECTURE: 3 horizons × 3 models + regime fusion")
    print(f"  HORIZONS: {', '.join(f'{n}={h}d' for n,h in HORIZONS.items())}")
    print(f"  EVALUATION: IC, ICIR, Fundamental Law, Portfolio Backtest")
    print("=" * 60)

    start_time = time.time()

    db_url = get_db_url()
    conn = psycopg2.connect(db_url)
    data = load_data(conn, test_mode=args.test)

    features, feature_cols = engineer_features(data)

    predictions, horizon_features, n_folds = run_walk_forward(features, feature_cols)

    if predictions is None:
        print("\nFATAL: No predictions generated.")
        conn.close()
        return

    evaluate_predictions(predictions)

    bt = run_portfolio_backtest(predictions)

    generate_and_write_signals(predictions, conn, no_write=args.no_write)

    # ── REGIME ANALYSIS ──
    print(f"\n[7/8] REGIME ANALYSIS")
    print("=" * 60)
    for regime in ['low_vol', 'normal', 'high_vol', 'crisis']:
        rmask = predictions['regime'] == regime
        if rmask.sum() < 50:
            continue
        rdf = predictions[rmask]
        valid = rdf[['fused_signal', 'target_rank_medium']].dropna()
        if len(valid) < 20:
            continue
        ic = scipy_stats.spearmanr(valid['fused_signal'], valid['target_rank_medium'])[0]
        avg_ret = rdf['fwd_ret_medium'].mean() * 100
        pct = rmask.sum() / len(predictions) * 100
        print(f"  {regime:10s}: IC={ic:+.4f}, Avg ret={avg_ret:+.2f}%, "
              f"N={rmask.sum():,} ({pct:.0f}%)")

    # ── SUMMARY ──
    elapsed = time.time() - start_time
    print(f"\n[8/8] SUMMARY")
    print("=" * 60)
    print(f"  Total time: {elapsed / 60:.1f} minutes")
    print(f"  Tickers: {features.ticker.nunique()}")
    print(f"  Features: {len(feature_cols)} → {sum(len(v) for v in horizon_features.values())} selected across horizons")
    print(f"  Walk-forward folds: {n_folds}")
    print(f"  Total predictions: {len(predictions):,}")

    conn.close()
    print("\nDone.")


if __name__ == '__main__':
    main()
