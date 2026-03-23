#!/usr/bin/env python3
"""
ALPHA ENGINE v6 — "BIFROST"
============================
Multi-layer ensemble with physics-inspired features,
probability calibration, and intelligent abstention.

Architecture:
  Layer 1: 90+ features (microstructure, entropy, momentum decomposition, cross-asset)
  Layer 2: 5-model diverse stack (XGB, LGBM, CatBoost, Ridge LR, MLP)
  Layer 3: Isotonic-calibrated meta-learner with regime-aware abstention

Target: >70% hit rate on SELECTED predictions (abstain on uncertain ones)
Method: Only trade when confidence + agreement + regime all favorable

Academic foundations:
  - Amihud (2002): Illiquidity premium
  - Jegadeesh & Titman (1993): Momentum with skip-month
  - Fama & French (2015): 5-factor model
  - Ehsani & Linnainmaa (2022): Momentum decomposition (own vs sector)
  - Daniel & Moskowitz (2016): Momentum crash avoidance via vol scaling
  - Hurst (1951): Long-range dependence / fractal analysis
  - Pincus (1991): Approximate entropy for regime detection
  - Roll (1984): Implied spread from return autocovariance
  - Kyle (1985): Price impact / lambda estimation
  - Ødegaard (2023): Asset pricing on Oslo Stock Exchange

Usage:
  python alpha_trainer_v6.py --test     # 15 liquid stocks, fast iteration
  python alpha_trainer_v6.py            # Full universe
  python alpha_trainer_v6.py --no-write # Evaluate only, don't write signals
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
from sklearn.calibration import CalibratedClassifierCV
from sklearn.isotonic import IsotonicRegression
from sklearn.linear_model import LogisticRegression
from sklearn.neural_network import MLPClassifier
from sklearn.preprocessing import StandardScaler
from sklearn.neighbors import KNeighborsClassifier

import xgboost as xgb
import lightgbm as lgb
import catboost as cb

warnings.filterwarnings('ignore')
sys.stdout = os.fdopen(sys.stdout.fileno(), 'w', 1)  # unbuffered

# ============================================================================
# Constants
# ============================================================================

TEST_TICKERS = [
    'EQNR', 'DNB', 'MOWI', 'TEL', 'YAR', 'NHY', 'ORK', 'SALM',
    'FRO', 'AKRBP', 'LSG', 'SUBC', 'GSF', 'DNO', 'BAKKA',
]

TRAIN_WINDOW = 504    # 2 years training
MIN_TRAIN = 252       # Minimum training observations
TEST_WINDOW = 21      # 1 month test
PURGE_GAP = 5         # 5-day purge between train/test
HORIZON = 21          # 21-day forward prediction

# Tree model hyperparameters — conservative to prevent overfitting
XGB_PARAMS = {
    'max_depth': 4,
    'learning_rate': 0.03,
    'n_estimators': 500,
    'reg_alpha': 1.0,
    'reg_lambda': 3.0,
    'min_child_weight': 25,
    'subsample': 0.7,
    'colsample_bytree': 0.6,
    'objective': 'binary:logistic',
    'eval_metric': 'logloss',
    'random_state': 42,
    'verbosity': 0,
}

LGBM_PARAMS = {
    'max_depth': 4,
    'learning_rate': 0.03,
    'n_estimators': 500,
    'num_leaves': 15,
    'lambda_l1': 1.0,
    'lambda_l2': 3.0,
    'min_child_samples': 25,
    'subsample': 0.7,
    'colsample_bytree': 0.6,
    'objective': 'binary',
    'metric': 'binary_logloss',
    'random_state': 42,
    'verbose': -1,
}

CAT_PARAMS = {
    'depth': 4,
    'learning_rate': 0.03,
    'iterations': 500,
    'l2_leaf_reg': 5.0,
    'subsample': 0.7,
    'random_seed': 42,
    'verbose': 0,
    'loss_function': 'Logloss',
    'auto_class_weights': 'Balanced',
}


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

    # Include OBX for market features
    obx_filter = f"OR ticker = 'OBX'" if ticker_filter else ""

    prices = pd.read_sql(f"""
        SELECT ticker, date, open, high, low, close, volume
        FROM prices_daily
        WHERE close > 0 AND volume >= 0
          AND date >= '2018-01-01'
          {f"AND (ticker IN ({tickers_sql}) {obx_filter})" if test_mode else ""}
        ORDER BY ticker, date
    """, conn, parse_dates=['date'])
    print(f"  Prices: {len(prices):,} rows, {prices.ticker.nunique()} tickers")

    # Good tickers: enough history
    ticker_counts = prices.groupby('ticker').size()
    good_tickers = list(ticker_counts[ticker_counts >= 504].index)
    good_tickers = [t for t in good_tickers if t != 'OBX']
    print(f"  Good tickers (≥504 days): {len(good_tickers)}")

    fundamentals = pd.read_sql(f"""
        SELECT ticker, date, bm, ep, dy, sp, sg, mktcap, ev_ebitda
        FROM factor_fundamentals
        WHERE TRUE {ticker_filter.replace('ticker', 'ticker')}
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

    # Sector data for cross-sectional features
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
# Physics-Inspired Feature Functions
# ============================================================================

def hurst_exponent(series, max_lag=20):
    """Hurst exponent via Rescaled Range (R/S) analysis.
    From hydrology (Hurst 1951), applied to financial time series.
    H < 0.5: mean-reverting (anti-persistent)
    H = 0.5: random walk (Brownian motion)
    H > 0.5: trending (persistent / long memory)
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
            deviations = np.cumsum(chunk - mean)
            R = np.max(deviations) - np.min(deviations)
            S = np.std(chunk, ddof=1)
            if S > 1e-10:
                rs_list.append(R / S)
        if rs_list:
            rs_values.append(np.mean(rs_list))
    if len(rs_values) < 3:
        return 0.5
    log_lags = np.log(np.array(list(lags)[:len(rs_values)]))
    log_rs = np.log(np.array(rs_values))
    try:
        H = np.polyfit(log_lags, log_rs, 1)[0]
        return np.clip(H, 0.0, 1.0)
    except:
        return 0.5


def approx_entropy(series, m=2, r_mult=0.2):
    """Approximate entropy (Pincus 1991) — regularity/predictability measure.
    From nonlinear dynamics / thermodynamics.
    Low ApEn: regular, predictable (deterministic dynamics)
    High ApEn: irregular, random (stochastic)
    A low ApEn stock is MORE predictable by pattern-matching models.
    """
    N = len(series)
    if N < m + 2:
        return 0.0
    r = r_mult * np.std(series)
    if r < 1e-10:
        return 0.0

    def phi(dim):
        patterns = np.array([series[i:i + dim] for i in range(N - dim + 1)])
        n_patterns = len(patterns)
        counts = np.zeros(n_patterns)
        for i in range(n_patterns):
            dist = np.max(np.abs(patterns - patterns[i]), axis=1)
            counts[i] = np.sum(dist <= r)
        counts /= n_patterns
        return np.mean(np.log(counts + 1e-10))

    return abs(phi(m) - phi(m + 1))


def spectral_entropy(series):
    """Spectral entropy — uniformity of frequency distribution.
    From signal processing / information theory.
    Low: dominated by few frequencies (periodic, predictable)
    High: flat spectrum (white noise, unpredictable)
    """
    if len(series) < 8:
        return 0.0
    centered = series - np.mean(series)
    fft_vals = np.fft.rfft(centered)
    power = np.abs(fft_vals) ** 2
    total = np.sum(power)
    if total < 1e-10:
        return 0.0
    psd = power / total
    psd = psd[psd > 0]
    return -np.sum(psd * np.log2(psd)) / np.log2(len(psd) + 1)


def roll_spread(returns, window=21):
    """Roll (1984) implied bid-ask spread estimator.
    Spread = 2 * sqrt(-Cov(r_t, r_{t-1}))
    Only valid when autocovariance is negative (market microstructure).
    Positive autocovariance → spread = 0 (trend dominates).
    """
    if len(returns) < window + 1:
        return 0.0
    r = returns[-window:]
    cov = np.cov(r[1:], r[:-1])[0, 1]
    if cov < 0:
        return 2.0 * np.sqrt(-cov)
    return 0.0


def amihud_illiquidity(returns, volumes, window=21):
    """Amihud (2002) illiquidity ratio.
    ILLIQ = avg(|r_t| / Volume_t)
    High ILLIQ = illiquid (large price impact per unit volume).
    Strong return predictor — illiquid stocks earn premium.
    """
    if len(returns) < window or len(volumes) < window:
        return 0.0
    r = np.abs(returns[-window:])
    v = volumes[-window:]
    mask = v > 0
    if mask.sum() < 5:
        return 0.0
    return np.mean(r[mask] / v[mask]) * 1e6  # Scale for interpretability


def ou_halflife(series, max_hl=252):
    """Ornstein-Uhlenbeck mean-reversion half-life.
    From stochastic physics / Langevin equation:
      dx = θ(μ - x)dt + σdW
    Half-life = -ln(2) / ln(1 + θ)
    Short half-life → fast mean reversion → tradeable.
    Long half-life → slow or no reversion → momentum.
    """
    if len(series) < 20:
        return max_hl
    y = np.array(series)
    dy = np.diff(y)
    y_lag = y[:-1]
    # OLS: dy = a + b*y_lag
    try:
        X = np.column_stack([np.ones(len(y_lag)), y_lag])
        beta = np.linalg.lstsq(X, dy, rcond=None)[0]
        theta = beta[1]
        if theta >= 0:
            return max_hl  # Not mean-reverting
        hl = -np.log(2) / np.log(1 + theta)
        return np.clip(hl, 1, max_hl)
    except:
        return max_hl


def variance_ratio(returns, short=5, long=20):
    """Lo & MacKinlay (1988) variance ratio test.
    VR = Var(long-period return) / (long/short * Var(short-period return))
    VR ≈ 1: random walk
    VR > 1: momentum (positive autocorrelation)
    VR < 1: mean-reversion (negative autocorrelation)
    """
    if len(returns) < long + 5:
        return 1.0
    r = returns[-max(len(returns), long * 3):]
    short_var = np.var(r)
    if short_var < 1e-15:
        return 1.0
    # Long-period returns
    long_rets = np.array([np.sum(r[i:i + long]) for i in range(0, len(r) - long + 1, short)])
    if len(long_rets) < 3:
        return 1.0
    long_var = np.var(long_rets)
    ratio = long / short
    expected_var = ratio * short_var
    if expected_var < 1e-15:
        return 1.0
    return long_var / expected_var


# ============================================================================
# Feature Engineering (90+ features, 11 groups)
# ============================================================================

def engineer_features(data: dict) -> pd.DataFrame:
    print("\n[2/8] ENGINEERING 90+ FEATURES")
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

        # ---- GROUP 1: MOMENTUM (12 features) ----
        for w in [1, 2, 3, 5, 10, 21, 63, 126, 252]:
            df[f'ret_{w}d'] = df['close'].pct_change(w)

        # Skip-month momentum (Jegadeesh & Titman 1993)
        # Use 12-month return but skip most recent month
        df['mom_12_1'] = df['close'].pct_change(252) - df['close'].pct_change(21)

        # Momentum quality: long-term minus short-term (strip reversal)
        df['mom_quality'] = df['ret_252d'] - df['ret_21d']

        # Acceleration: change in momentum
        df['mom_accel'] = df['ret_63d'] - df['ret_63d'].shift(21)

        # ---- GROUP 2: MEAN REVERSION / CONTRARIAN (8 features) ----
        for w in [20, 50, 200]:
            sma = df['close'].rolling(w, min_periods=w).mean()
            df[f'dist_sma{w}'] = (df['close'] - sma) / (sma + 1e-10)

        std20 = df['close'].rolling(20).std()
        sma20 = df['close'].rolling(20).mean()
        df['z_score_20d'] = (df['close'] - sma20) / (std20 + 1e-10)

        std60 = df['close'].rolling(60).std()
        sma60 = df['close'].rolling(60).mean()
        df['z_score_60d'] = (df['close'] - sma60) / (std60 + 1e-10)

        # Distance to 52-week high/low
        roll_max = df['close'].rolling(252, min_periods=63).max()
        roll_min = df['close'].rolling(252, min_periods=63).min()
        df['dist_52w_high'] = (df['close'] - roll_max) / (roll_max + 1e-10)
        df['dist_52w_low'] = (df['close'] - roll_min) / (roll_min + 1e-10)

        # OU half-life (rolling 63d)
        df['ou_halflife'] = np.nan
        for i in range(63, len(df)):
            df.iloc[i, df.columns.get_loc('ou_halflife')] = ou_halflife(
                close[i - 63:i], max_hl=252
            )

        # ---- GROUP 3: VOLATILITY & HIGHER MOMENTS (12 features) ----
        for w in [5, 21, 63]:
            df[f'vol_{w}d'] = df['ret'].rolling(w).std() * np.sqrt(252)

        # Volatility ratios (regime change detection)
        df['vol_ratio_5_21'] = df['vol_5d'] / (df['vol_21d'] + 1e-10)
        df['vol_ratio_21_63'] = df['vol_21d'] / (df['vol_63d'] + 1e-10)

        # Volatility of volatility (GARCH-like instability measure)
        df['vol_of_vol'] = df['vol_21d'].rolling(63).std()

        # Higher moments (skewness, kurtosis)
        df['skew_21d'] = df['ret'].rolling(21).apply(
            lambda x: scipy_stats.skew(x) if len(x) >= 10 else 0, raw=True
        )
        df['kurt_21d'] = df['ret'].rolling(21).apply(
            lambda x: scipy_stats.kurtosis(x) if len(x) >= 10 else 0, raw=True
        )

        # Downside volatility (semi-variance)
        df['downside_vol_21d'] = df['ret'].rolling(21).apply(
            lambda x: np.sqrt(np.mean(np.minimum(x, 0) ** 2)) * np.sqrt(252), raw=True
        )

        # Max drawdown (21d rolling)
        df['max_dd_21d'] = df['close'].rolling(21).apply(
            lambda x: (x[-1] / x.max() - 1) if x.max() > 0 else 0, raw=True
        )

        # Garman-Klass volatility estimator (uses OHLC — more efficient than close-close)
        log_hl = np.log(high / (low + 1e-10)) ** 2
        log_co = np.log(close / (df['open'].values + 1e-10)) ** 2
        gk = 0.5 * log_hl - (2 * np.log(2) - 1) * log_co
        df['gk_vol_21d'] = pd.Series(gk).rolling(21).mean().apply(lambda x: np.sqrt(abs(x) * 252))

        # ---- GROUP 4: MICROSTRUCTURE & LIQUIDITY (8 features) ----
        dollar_volume = close * volume

        # Amihud illiquidity (rolling 21d)
        df['amihud_21d'] = np.nan
        for i in range(21, len(df)):
            df.iloc[i, df.columns.get_loc('amihud_21d')] = amihud_illiquidity(
                returns[i - 21:i], volume[i - 21:i], 21
            )

        # Log dollar volume (size/liquidity proxy)
        df['log_dollar_vol'] = np.log(dollar_volume + 1)

        # Volume ratio (unusual activity detection)
        vol_sma20 = pd.Series(volume).rolling(20).mean()
        df['volume_ratio'] = volume / (vol_sma20.values + 1)

        # Turnover trend
        vol_sma5 = pd.Series(volume).rolling(5).mean()
        df['vol_trend'] = vol_sma5.values / (vol_sma20.values + 1)

        # Roll (1984) implied spread
        df['roll_spread'] = np.nan
        for i in range(22, len(df)):
            df.iloc[i, df.columns.get_loc('roll_spread')] = roll_spread(returns[i - 21:i])

        # Serial correlation (return autocorrelation — Kyle's lambda proxy)
        df['autocorr_1d'] = df['ret'].rolling(21).apply(
            lambda x: np.corrcoef(x[1:], x[:-1])[0, 1] if len(x) > 5 else 0, raw=True
        )
        df['autocorr_5d'] = df['ret'].rolling(63).apply(
            lambda x: np.corrcoef(x[5:], x[:-5])[0, 1] if len(x) > 10 else 0, raw=True
        )

        # Variance ratio (Lo-MacKinlay random walk test)
        df['var_ratio'] = np.nan
        for i in range(63, len(df)):
            df.iloc[i, df.columns.get_loc('var_ratio')] = variance_ratio(returns[i - 63:i])

        # ---- GROUP 5: ENTROPY & COMPLEXITY (4 features) ----
        # These are computationally expensive — compute every 5 days, ffill
        df['hurst'] = np.nan
        df['approx_ent'] = np.nan
        df['spec_ent'] = np.nan

        for i in range(63, len(df), 5):  # Every 5 days for speed
            window_rets = returns[max(0, i - 63):i]
            if len(window_rets) >= 20:
                df.iloc[i, df.columns.get_loc('hurst')] = hurst_exponent(window_rets)
                df.iloc[i, df.columns.get_loc('approx_ent')] = approx_entropy(window_rets)
                df.iloc[i, df.columns.get_loc('spec_ent')] = spectral_entropy(window_rets)

        df['hurst'] = df['hurst'].ffill()
        df['approx_ent'] = df['approx_ent'].ffill()
        df['spec_ent'] = df['spec_ent'].ffill()

        # Complexity-volatility interaction
        df['complexity_vol'] = df['approx_ent'] * df['vol_21d']

        # ---- GROUP 6: CROSS-ASSET BETAS (8 features) ----
        # Merge OBX for market features
        df = df.merge(obx, on='date', how='left')
        df['obx_close'] = df['obx_close'].ffill()
        df['obx_ret'] = df['obx_close'].pct_change()

        # Rolling beta to market (63d)
        df['beta_63d'] = df['ret'].rolling(63).apply(
            lambda x: np.nan, raw=True  # placeholder
        )
        # Compute beta properly
        for i in range(63, len(df)):
            stock_r = returns[i - 63:i]
            mkt_r = df['obx_ret'].values[i - 63:i]
            valid = ~(np.isnan(stock_r) | np.isnan(mkt_r))
            if valid.sum() > 20:
                cov = np.cov(stock_r[valid], mkt_r[valid])
                if cov[1, 1] > 1e-15:
                    df.iloc[i, df.columns.get_loc('beta_63d')] = cov[0, 1] / cov[1, 1]

        # Idiosyncratic volatility (residual from market model)
        df['ivol_63d'] = np.nan
        for i in range(63, len(df)):
            stock_r = returns[i - 63:i]
            mkt_r = df['obx_ret'].values[i - 63:i]
            valid = ~(np.isnan(stock_r) | np.isnan(mkt_r))
            if valid.sum() > 20:
                beta = df.iloc[i].get('beta_63d', 1.0)
                if np.isnan(beta):
                    beta = 1.0
                resid = stock_r[valid] - beta * mkt_r[valid]
                df.iloc[i, df.columns.get_loc('ivol_63d')] = np.std(resid) * np.sqrt(252)

        # Excess return vs market
        df['excess_ret_21d'] = df['ret_21d'] - df['obx_ret'].rolling(21).apply(
            lambda x: (1 + x).prod() - 1 if len(x) >= 5 else 0, raw=True
        )

        # ---- GROUP 7: TREND STRUCTURE (6 features) ----
        sma20v = df['close'].rolling(20).mean()
        sma50v = df['close'].rolling(50).mean()
        sma200v = df['close'].rolling(200).mean()

        df['above_sma20'] = (df['close'] > sma20v).astype(float)
        df['above_sma50'] = (df['close'] > sma50v).astype(float)
        df['above_sma200'] = (df['close'] > sma200v).astype(float)
        df['trend_score'] = df['above_sma20'] + df['above_sma50'] + df['above_sma200']

        # MACD signal
        ema12 = df['close'].ewm(span=12).mean()
        ema26 = df['close'].ewm(span=26).mean()
        macd = ema12 - ema26
        signal_line = macd.ewm(span=9).mean()
        df['macd_above'] = (macd > signal_line).astype(float)

        # Momentum alignment (1m/3m/6m all same sign)
        df['mom_align'] = (
            (df['ret_21d'] > 0).astype(float) +
            (df['ret_63d'] > 0).astype(float) +
            (df['ret_126d'] > 0).astype(float)
        )

        # ---- GROUP 8: CALENDAR & SEASONALITY (5 features) ----
        df['is_january'] = (df['date'].dt.month == 1).astype(float)
        df['is_turn_of_month'] = (
            (df['date'].dt.day <= 3) | (df['date'].dt.day >= 28)
        ).astype(float)
        df['is_end_of_quarter'] = (
            df['date'].dt.month.isin([3, 6, 9, 12]) &
            (df['date'].dt.day >= 25)
        ).astype(float)
        # Cyclical month encoding
        df['month_sin'] = np.sin(2 * np.pi * df['date'].dt.month / 12)
        df['month_cos'] = np.cos(2 * np.pi * df['date'].dt.month / 12)

        # Store sector
        df['sector'] = sector_map.get(ticker, 'Unknown')

        all_dfs.append(df)

    features = pd.concat(all_dfs, ignore_index=True)
    print(f"  → {len(features):,} rows from {features.ticker.nunique()} tickers (before merges)")

    # ---- MERGE COMMODITIES ----
    print("  Merging commodities...")
    commodities = data['commodities']
    for sym in ['BZ=F', 'CL=F', 'GC=F', 'ALI=F', 'NG=F', 'HG=F']:
        c = commodities[commodities.ticker == sym][['date', 'close']].rename(
            columns={'close': f'c_{sym}'}
        )
        c[f'c_{sym}_r21'] = c[f'c_{sym}'].pct_change(21)
        c[f'c_{sym}_r63'] = c[f'c_{sym}'].pct_change(63)
        features = features.merge(c[['date', f'c_{sym}_r21', f'c_{sym}_r63']], on='date', how='left')

    # ---- MERGE FX ----
    print("  Merging FX...")
    fx = data['fx']
    for pair in ['NOKUSD', 'NOKEUR']:
        f = fx[fx.pair == pair][['date', 'rate']].rename(columns={'rate': f'fx_{pair}'})
        f[f'fx_{pair}_r21'] = f[f'fx_{pair}'].pct_change(21)
        features = features.merge(f[['date', f'fx_{pair}_r21']], on='date', how='left')

    # ---- MERGE SHORTS ----
    print("  Merging short interest...")
    shorts = data['shorts']
    if len(shorts) > 0:
        shorts_pivot = shorts[['ticker', 'date', 'short_pct']].copy()
        shorts_pivot['short_change_21d'] = shorts_pivot.groupby('ticker')['short_pct'].diff(21)
        features = features.merge(
            shorts_pivot[['ticker', 'date', 'short_pct', 'short_change_21d']],
            on=['ticker', 'date'], how='left'
        )
    else:
        features['short_pct'] = 0
        features['short_change_21d'] = 0

    # ---- MERGE SHIPPING ----
    print("  Merging shipping rates...")
    shipping = data['shipping']
    if len(shipping) > 0:
        for rate in ['BDI', 'BDTI']:
            s = shipping[shipping.rate_name == rate][['date', 'value']].rename(
                columns={'value': f'ship_{rate}'}
            )
            s[f'ship_{rate}_r21'] = s[f'ship_{rate}'].pct_change(21)
            features = features.merge(s[['date', f'ship_{rate}_r21']], on='date', how='left')

    # ---- MERGE FUNDAMENTALS ----
    print("  Merging fundamentals...")
    fund = data['fundamentals']
    if len(fund) > 0:
        features = features.merge(
            fund[['ticker', 'date', 'bm', 'ep', 'dy', 'sp', 'mktcap', 'ev_ebitda']],
            on=['ticker', 'date'], how='left',
            suffixes=('', '_fund')
        )
        # Forward-fill fundamentals (they're quarterly)
        for col in ['bm', 'ep', 'dy', 'sp', 'mktcap', 'ev_ebitda']:
            if col in features.columns:
                features[col] = features.groupby('ticker')[col].ffill()

        # Fundamental momentum (change in EP over 63d — earnings revision proxy)
        features['ep_momentum'] = features.groupby('ticker')['ep'].diff(63)
        features['mktcap_log'] = np.log(features['mktcap'].clip(lower=1) + 1)

    # Fill NaN
    features = features.fillna(method='ffill').fillna(0)

    # ---- CROSS-SECTIONAL RANKS (10 features) ----
    print("  Computing cross-sectional ranks...")
    rank_cols = ['ret_21d', 'ret_63d', 'vol_21d', 'amihud_21d', 'beta_63d']
    fund_rank_cols = [c for c in ['ep', 'bm', 'dy', 'mktcap_log'] if c in features.columns]
    rank_cols += fund_rank_cols

    for col in rank_cols:
        if col in features.columns:
            features[f'{col}_rank'] = features.groupby('date')[col].rank(pct=True)

    # ---- INTERACTION FEATURES (6 features) ----
    print("  Computing interaction features...")
    # Momentum × Volatility (Daniel & Moskowitz 2016 — vol-scaled momentum)
    features['mom_x_vol'] = features.get('ret_63d_rank', 0) * features.get('vol_21d_rank', 0)

    # Value × Momentum (classic combo — Asness et al. 2013)
    if 'ep_rank' in features.columns and 'ret_252d' in features.columns:
        ret252_rank = features.groupby('date')['ret_252d'].rank(pct=True)
        features['value_x_mom'] = features['ep_rank'] * ret252_rank

    # Short squeeze indicator: high short interest + positive momentum
    features['short_squeeze'] = features['short_pct'] * features.get('ret_21d', 0).clip(lower=0)

    # Complexity × Value: low entropy + value = strong setup
    if 'ep_rank' in features.columns:
        features['complexity_value'] = (1 - features['approx_ent']) * features['ep_rank']

    # Trend × Volume: strong trend + high volume = confirmed
    features['trend_vol'] = features['trend_score'] * features.get('volume_ratio', 1)

    # Beta × Market return: systematic exposure
    features['systematic_exposure'] = features['beta_63d'] * features['obx_ret'].rolling(21).sum()

    # ---- SECTOR MOMENTUM (own vs sector — Ehsani & Linnainmaa 2022) ----
    print("  Computing sector momentum decomposition...")
    sector_rets = features.groupby(['date', 'sector'])['ret_21d'].transform('mean')
    features['sector_ret_21d'] = sector_rets
    features['own_momentum'] = features['ret_21d'] - features['sector_ret_21d']

    # ---- TARGETS ----
    print("  Computing targets...")
    features['fwd_ret_21d'] = features.groupby('ticker')['close'].transform(
        lambda x: x.shift(-HORIZON) / x - 1
    )
    features['target_dir_21d'] = (features['fwd_ret_21d'] > 0).astype(int)

    # Target: up more than median cross-sectional return
    cs_median = features.groupby('date')['fwd_ret_21d'].transform('median')
    features['target_above_median'] = (features['fwd_ret_21d'] > cs_median).astype(int)

    # Drop rows without target
    features = features.dropna(subset=['fwd_ret_21d'])

    # Identify feature columns
    exclude = {'ticker', 'date', 'open', 'high', 'low', 'close', 'volume', 'ret',
               'obx_close', 'obx_ret', 'sector', 'fwd_ret_21d',
               'target_dir_21d', 'target_above_median'}
    feature_cols = [c for c in features.columns if c not in exclude and features[c].dtype in ['float64', 'float32', 'int64', 'int32']]

    # Remove features with >30% NaN
    nan_pct = features[feature_cols].isna().mean()
    good_features = [c for c in feature_cols if nan_pct[c] < 0.3]

    # Fill remaining NaN
    features[good_features] = features[good_features].fillna(0)

    print(f"  → Final: {len(features):,} rows, {len(good_features)} features, {features.ticker.nunique()} tickers")
    print(f"  → Target balance (21d up): {features['target_dir_21d'].mean():.1%}")
    print(f"  → Target balance (above median): {features['target_above_median'].mean():.1%}")

    return features, good_features


# ============================================================================
# Feature Selection (Importance-Based)
# ============================================================================

def select_features(X, y, feature_cols, max_features=60):
    """Quick feature importance via LightGBM, keep top features."""
    print(f"\n  Feature selection ({len(feature_cols)} → max {max_features})...")

    model = lgb.LGBMClassifier(
        n_estimators=100, max_depth=3, num_leaves=8,
        learning_rate=0.1, verbose=-1, random_state=42,
        subsample=0.5, colsample_bytree=0.5,
    )
    model.fit(X[feature_cols].values, y.values)

    importance = pd.Series(model.feature_importances_, index=feature_cols)
    importance = importance.sort_values(ascending=False)

    # Keep features with importance > 0
    selected = list(importance[importance > 0].head(max_features).index)

    print(f"  → Selected {len(selected)} features")
    print(f"  → Top 15:")
    for feat in selected[:15]:
        print(f"      {feat:35s} {importance[feat]:8.4f}")

    return selected


# ============================================================================
# Walk-Forward Cross-Validation
# ============================================================================

def walk_forward_splits(dates, train_window=TRAIN_WINDOW, test_window=TEST_WINDOW,
                        purge=PURGE_GAP, min_train=MIN_TRAIN):
    """Generate walk-forward train/test date splits with purging gap."""
    unique_dates = sorted(dates.unique())
    splits = []

    for i in range(train_window, len(unique_dates) - test_window, test_window):
        train_end_idx = i
        test_start_idx = i + purge
        test_end_idx = min(test_start_idx + test_window, len(unique_dates))

        if test_start_idx >= len(unique_dates):
            break
        if train_end_idx - max(0, train_end_idx - train_window) < min_train:
            continue

        train_start = unique_dates[max(0, train_end_idx - train_window)]
        train_end = unique_dates[train_end_idx - 1]
        test_start = unique_dates[test_start_idx]
        test_end = unique_dates[min(test_end_idx - 1, len(unique_dates) - 1)]

        splits.append((train_start, train_end, test_start, test_end))

    return splits


# ============================================================================
# Model Training — 5-Model Diverse Stack
# ============================================================================

def train_model_stack(X_train, y_train, X_val, y_val, feature_cols):
    """Train 5 diverse models: XGB, LGBM, CatBoost, Ridge LR, MLP.
    Diversity is key — ensemble of correlated models adds no value.
    Trees capture interactions, LR captures linear patterns, MLP captures non-linearity.
    """
    models = {}

    # 1. XGBoost
    xgb_model = xgb.XGBClassifier(**XGB_PARAMS)
    xgb_model.fit(
        X_train, y_train,
        eval_set=[(X_val, y_val)],
        verbose=False,
    )
    xgb_model.set_params(n_estimators=xgb_model.best_iteration + 1 if hasattr(xgb_model, 'best_iteration') and xgb_model.best_iteration else 100)
    models['xgb'] = xgb_model

    # 2. LightGBM
    lgbm_model = lgb.LGBMClassifier(**LGBM_PARAMS)
    lgbm_model.fit(
        X_train, y_train,
        eval_set=[(X_val, y_val)],
        callbacks=[lgb.early_stopping(30, verbose=False), lgb.log_evaluation(period=0)],
    )
    models['lgbm'] = lgbm_model

    # 3. CatBoost
    cat_model = cb.CatBoostClassifier(**CAT_PARAMS)
    cat_model.fit(
        X_train, y_train,
        eval_set=(X_val, y_val),
        early_stopping_rounds=30,
    )
    models['cat'] = cat_model

    # 4. Ridge Logistic Regression (captures linear patterns trees may miss)
    scaler = StandardScaler()
    X_train_scaled = scaler.fit_transform(X_train)
    lr_model = LogisticRegression(
        C=0.1, penalty='l2', solver='lbfgs', max_iter=500, random_state=42
    )
    lr_model.fit(X_train_scaled, y_train)
    models['lr'] = lr_model
    models['lr_scaler'] = scaler

    # 5. MLP Neural Network (non-linear patterns different from trees)
    X_train_scaled_mlp = scaler.transform(X_train)  # reuse scaler
    mlp_model = MLPClassifier(
        hidden_layer_sizes=(64, 32), activation='relu',
        alpha=0.01,  # L2 regularization
        learning_rate='adaptive', max_iter=200,
        random_state=42, early_stopping=True, validation_fraction=0.15,
    )
    mlp_model.fit(X_train_scaled_mlp, y_train)
    models['mlp'] = mlp_model

    return models


def predict_stack(models, X, return_individual=False):
    """Get predictions from all 5 models + ensemble average."""
    probs = {}

    probs['xgb'] = models['xgb'].predict_proba(X)[:, 1]
    probs['lgbm'] = models['lgbm'].predict_proba(X)[:, 1]
    probs['cat'] = models['cat'].predict_proba(X)[:, 1]

    X_scaled = models['lr_scaler'].transform(X)
    probs['lr'] = models['lr'].predict_proba(X_scaled)[:, 1]
    probs['mlp'] = models['mlp'].predict_proba(X_scaled)[:, 1]

    # Ensemble: weighted average (trees 25% each, linear models 12.5% each)
    ensemble = (
        0.25 * probs['xgb'] +
        0.25 * probs['lgbm'] +
        0.25 * probs['cat'] +
        0.125 * probs['lr'] +
        0.125 * probs['mlp']
    )
    probs['ensemble'] = ensemble

    # Agreement: fraction of models that predict same direction
    directions = np.array([
        (probs['xgb'] > 0.5).astype(float),
        (probs['lgbm'] > 0.5).astype(float),
        (probs['cat'] > 0.5).astype(float),
        (probs['lr'] > 0.5).astype(float),
        (probs['mlp'] > 0.5).astype(float),
    ])
    agreement = np.mean(directions, axis=0)  # 0-1, proportion agreeing on UP
    # Agreement score: max(agreement, 1-agreement) = how much consensus
    consensus = np.maximum(agreement, 1 - agreement)
    probs['agreement'] = consensus

    if return_individual:
        return probs
    return ensemble, consensus


# ============================================================================
# Probability Calibration
# ============================================================================

def calibrate_probabilities(raw_probs, true_labels):
    """Isotonic regression calibration.
    Tree models output poorly calibrated probabilities.
    Isotonic regression maps raw probs → true conditional frequencies.
    After calibration, P(Y=1|p̂=0.7) ≈ 70%.
    """
    calibrator = IsotonicRegression(y_min=0.01, y_max=0.99, out_of_bounds='clip')
    calibrator.fit(raw_probs, true_labels)
    return calibrator


# ============================================================================
# Meta-Learner
# ============================================================================

def train_meta_learner(base_probs_dict, true_labels):
    """Train logistic regression meta-learner on base model outputs.
    The meta-learner learns which models to trust and when.
    """
    X_meta = np.column_stack([
        base_probs_dict['xgb'],
        base_probs_dict['lgbm'],
        base_probs_dict['cat'],
        base_probs_dict['lr'],
        base_probs_dict['mlp'],
        base_probs_dict['agreement'],
    ])

    meta_model = LogisticRegression(C=1.0, max_iter=200, random_state=42)
    meta_model.fit(X_meta, true_labels)

    return meta_model


def predict_meta(meta_model, base_probs_dict):
    X_meta = np.column_stack([
        base_probs_dict['xgb'],
        base_probs_dict['lgbm'],
        base_probs_dict['cat'],
        base_probs_dict['lr'],
        base_probs_dict['mlp'],
        base_probs_dict['agreement'],
    ])
    return meta_model.predict_proba(X_meta)[:, 1]


# ============================================================================
# Walk-Forward Training & Evaluation
# ============================================================================

def run_walk_forward(features, feature_cols, target_col='target_dir_21d'):
    print(f"\n[3/8] WALK-FORWARD TRAINING (5-model stack)")
    print("=" * 60)
    print(f"  Features: {len(feature_cols)}, Target: {target_col}")

    splits = walk_forward_splits(features['date'])
    print(f"  Walk-forward splits: {len(splits)}")

    all_predictions = []
    all_meta_probs = []
    fold_calibrators = []
    feature_importance_sum = np.zeros(len(feature_cols))
    n_folds = 0

    for fold_idx, (train_start, train_end, test_start, test_end) in enumerate(splits):
        # Split data
        train_mask = (features['date'] >= train_start) & (features['date'] <= train_end)
        test_mask = (features['date'] >= test_start) & (features['date'] <= test_end)

        X_train = features.loc[train_mask, feature_cols].values
        y_train = features.loc[train_mask, target_col].values
        X_test = features.loc[test_mask, feature_cols].values
        y_test = features.loc[test_mask, target_col].values

        if len(X_train) < 100 or len(X_test) < 10:
            continue

        # Validation split from train (last 20%)
        val_size = max(int(len(X_train) * 0.2), 20)
        X_val = X_train[-val_size:]
        y_val = y_train[-val_size:]
        X_train_sub = X_train[:-val_size]
        y_train_sub = y_train[:-val_size]

        if len(np.unique(y_train_sub)) < 2 or len(np.unique(y_val)) < 2:
            continue

        try:
            # Train 5-model stack
            models = train_model_stack(X_train_sub, y_train_sub, X_val, y_val, feature_cols)

            # Get predictions on test
            test_probs = predict_stack(models, X_test, return_individual=True)
            ensemble_prob = test_probs['ensemble']
            agreement = test_probs['agreement']

            # Calibrate on validation set
            val_probs = predict_stack(models, X_val, return_individual=True)
            calibrator = calibrate_probabilities(val_probs['ensemble'], y_val)
            calibrated_test = calibrator.predict(ensemble_prob)

            # Train meta-learner on validation
            meta_model = train_meta_learner(val_probs, y_val)
            meta_prob = predict_meta(meta_model, test_probs)

            # Accumulate feature importance (from XGB)
            feature_importance_sum += models['xgb'].feature_importances_

            # Store predictions
            test_df = features.loc[test_mask, ['ticker', 'date', 'fwd_ret_21d', target_col]].copy()
            test_df['raw_prob'] = ensemble_prob
            test_df['calibrated_prob'] = calibrated_test
            test_df['meta_prob'] = meta_prob
            test_df['agreement'] = agreement
            test_df['fold'] = fold_idx

            # Individual model probs for analysis
            for model_name in ['xgb', 'lgbm', 'cat', 'lr', 'mlp']:
                test_df[f'prob_{model_name}'] = test_probs[model_name]

            all_predictions.append(test_df)
            n_folds += 1

            if (fold_idx + 1) % 25 == 0:
                recent = pd.concat(all_predictions[-25:])
                acc = (recent['meta_prob'] > 0.5).astype(int).eq(recent[target_col]).mean()
                print(f"    Fold {fold_idx + 1}/{len(splits)}: "
                      f"Meta Acc={acc:.1%}, N={len(recent)}")

        except Exception as e:
            if fold_idx < 5:
                print(f"    Fold {fold_idx}: Error: {e}")
            continue

    if not all_predictions:
        print("  ERROR: No successful folds!")
        return None, None, None

    predictions = pd.concat(all_predictions, ignore_index=True)
    print(f"\n  → {len(predictions):,} predictions, {n_folds} folds")

    # Feature importance
    feature_importance = pd.Series(
        feature_importance_sum / max(n_folds, 1), index=feature_cols
    ).sort_values(ascending=False)

    print(f"\n  Top 20 features:")
    for feat in feature_importance.head(20).index:
        print(f"    {feat:35s} {feature_importance[feat]:8.4f}")

    return predictions, feature_importance, n_folds


# ============================================================================
# Abstention Engine — "Know When You Don't Know"
# ============================================================================

def evaluate_abstention(predictions, target_col='target_dir_21d'):
    print(f"\n[4/8] ABSTENTION & CONFIDENCE ANALYSIS")
    print("=" * 60)

    # --- Raw model accuracy ---
    for model_name in ['raw_prob', 'calibrated_prob', 'meta_prob']:
        prob = predictions[model_name]
        pred = (prob > 0.5).astype(int)
        acc = pred.eq(predictions[target_col]).mean()
        label = model_name.replace('_prob', '').replace('_', ' ').title()
        print(f"\n  {label} (all predictions):")
        print(f"    Accuracy:  {acc:.1%}")
        print(f"    N:         {len(predictions):,}")

    # --- Agreement-based filtering ---
    print(f"\n  AGREEMENT FILTERING:")
    print(f"  {'Consensus':12s} {'Accuracy':10s} {'Trades':10s} {'Avg Return':12s} {'Pct Used':8s}")
    print(f"  {'-' * 60}")

    for min_agreement in [0.6, 0.7, 0.8, 0.9, 1.0]:
        mask = predictions['agreement'] >= min_agreement
        if mask.sum() < 10:
            continue
        subset = predictions[mask]
        long_mask = subset['meta_prob'] > 0.5
        long_sub = subset[long_mask]
        if len(long_sub) < 10:
            continue
        acc = (long_sub[target_col] == 1).mean()
        avg_ret = long_sub['fwd_ret_21d'].mean() * 100
        pct = len(long_sub) / len(predictions) * 100
        print(f"  ≥{min_agreement:.0%}          {acc:7.1%}   {len(long_sub):8,}     {avg_ret:+8.2f}%    {pct:5.1f}%")

    # --- Combined: Meta-probability + Agreement ---
    print(f"\n  COMBINED FILTER (Meta Prob × Agreement):")
    print(f"  {'Meta>':6s} {'Agree≥':7s} {'Hit Rate':10s} {'Avg Ret':10s} {'Trades':8s} {'Pct':6s}")
    print(f"  {'-' * 60}")

    best_hr = 0
    best_config = None

    for prob_thresh in [0.50, 0.55, 0.60, 0.65, 0.70]:
        for agree_thresh in [0.6, 0.8, 1.0]:
            mask = (
                (predictions['meta_prob'] > prob_thresh) &
                (predictions['agreement'] >= agree_thresh)
            )
            if mask.sum() < 50:
                continue
            subset = predictions[mask]
            hit_rate = (subset[target_col] == 1).mean()
            avg_ret = subset['fwd_ret_21d'].mean() * 100
            pct = len(subset) / len(predictions) * 100

            if hit_rate > best_hr and len(subset) >= 100:
                best_hr = hit_rate
                best_config = (prob_thresh, agree_thresh, hit_rate, len(subset), avg_ret)

            print(f"  >{prob_thresh:.2f}  ≥{agree_thresh:.0%}     "
                  f"{hit_rate:7.1%}    {avg_ret:+7.2f}%  {len(subset):6,}   {pct:4.1f}%")

    if best_config:
        print(f"\n  ★ Best config: Meta>{best_config[0]:.2f}, Agree≥{best_config[1]:.0%}")
        print(f"    Hit rate: {best_config[2]:.1%}, Trades: {best_config[3]:,}, Avg return: {best_config[4]:+.2f}%")

    # --- Per-stock analysis with best config ---
    if best_config:
        prob_t, agree_t = best_config[0], best_config[1]
    else:
        prob_t, agree_t = 0.55, 0.8

    print(f"\n  PER-STOCK ANALYSIS (Meta>{prob_t:.2f}, Agree≥{agree_t:.0%}):")
    print(f"  {'Ticker':10s} {'Hit Rate':10s} {'Avg Ret':10s} {'Trades':8s} {'Pct Used':8s}")
    print(f"  {'-' * 55}")

    mask = (predictions['meta_prob'] > prob_t) & (predictions['agreement'] >= agree_t)
    for ticker in sorted(predictions['ticker'].unique()):
        tmask = mask & (predictions['ticker'] == ticker)
        total = (predictions['ticker'] == ticker).sum()
        if tmask.sum() < 10:
            continue
        subset = predictions[tmask]
        hit = (subset[target_col] == 1).mean()
        avg_ret = subset['fwd_ret_21d'].mean() * 100
        pct = len(subset) / total * 100
        print(f"  {ticker:10s} {hit:7.1%}     {avg_ret:+7.2f}%   {len(subset):6,}   {pct:5.1f}%")

    # --- Long-only backtest with abstention (NON-OVERLAPPING 21d periods) ---
    print(f"\n  LONG-ONLY BACKTEST (Meta>{prob_t:.2f}, Agree≥{agree_t:.0%}):")
    mask = (predictions['meta_prob'] > prob_t) & (predictions['agreement'] >= agree_t)
    selected = predictions[mask].copy()

    if len(selected) > 0:
        selected['signal_strength'] = selected['meta_prob'] * selected['agreement']
        period_returns = []

        # Use non-overlapping rebalance dates (every 21 trading days)
        all_dates = sorted(selected['date'].unique())
        rebal_dates = all_dates[::HORIZON]  # Every 21 days

        for date in rebal_dates:
            day_signals = selected[selected['date'] == date].nlargest(10, 'signal_strength')
            if len(day_signals) == 0:
                continue
            avg_fwd = day_signals['fwd_ret_21d'].mean()
            cost = 0.003  # 30bps round-trip
            net_ret = avg_fwd - cost
            period_returns.append({
                'date': date,
                'gross_return': avg_fwd,
                'net_return': net_ret,
                'n_stocks': len(day_signals),
                'hit': (day_signals['fwd_ret_21d'] > 0).mean(),
            })

        bt = pd.DataFrame(period_returns)
        if len(bt) > 0:
            total_gross = (1 + bt['gross_return']).prod() - 1
            total_net = (1 + bt['net_return']).prod() - 1
            avg_hit = bt['hit'].mean()
            n_periods = len(bt)
            years = n_periods * HORIZON / 252
            ann_gross = (1 + total_gross) ** (1 / max(years, 0.5)) - 1
            ann_net = (1 + total_net) ** (1 / max(years, 0.5)) - 1

            # Sharpe (annualized from 21d periods ≈ monthly)
            monthly_rets = bt['net_return'].values
            sharpe = (np.mean(monthly_rets) / (np.std(monthly_rets) + 1e-10)) * np.sqrt(252 / HORIZON)

            # Max drawdown
            cumulative = (1 + bt['net_return']).cumprod()
            peak = cumulative.cummax()
            drawdown = (cumulative / peak - 1)
            max_dd = drawdown.min()

            # Win rate (% of periods with positive return)
            win_rate = (bt['net_return'] > 0).mean()

            print(f"    Non-overlapping periods: {n_periods}")
            print(f"    Years: {years:.1f}")
            print(f"    Avg position hit rate: {avg_hit:.1%}")
            print(f"    Period win rate: {win_rate:.1%}")
            print(f"    Total gross: {total_gross:+.1%}")
            print(f"    Total net (after 30bps): {total_net:+.1%}")
            print(f"    Annualized gross: {ann_gross:+.1%}")
            print(f"    Annualized net: {ann_net:+.1%}")
            print(f"    Sharpe: {sharpe:+.2f}")
            print(f"    Max drawdown: {max_dd:.1%}")
            print(f"    Avg stocks per period: {bt['n_stocks'].mean():.1f}")
            print(f"    Avg gross return/period: {bt['gross_return'].mean()*100:+.2f}%")

    return best_config


# ============================================================================
# Adaptive Per-Stock Thresholds
# ============================================================================

def optimize_per_stock_thresholds(predictions, target_col='target_dir_21d', min_hr=0.65):
    """Find per-stock meta-probability threshold that achieves target hit rate.
    Uses the first 70% of data for optimization, validates on last 30%.
    """
    print(f"\n[5/8] PER-STOCK THRESHOLD OPTIMIZATION")
    print("=" * 60)
    print(f"  Target hit rate: ≥{min_hr:.0%}")

    thresholds = {}
    results = []

    for ticker in sorted(predictions['ticker'].unique()):
        tdf = predictions[predictions['ticker'] == ticker].sort_values('date')
        if len(tdf) < 100:
            continue

        # Split: optimize on first 70%, validate on last 30%
        split_idx = int(len(tdf) * 0.7)
        opt_df = tdf.iloc[:split_idx]
        val_df = tdf.iloc[split_idx:]

        best_thresh = None
        best_trades = 0

        # Search for threshold that achieves target HR on optimization set
        for thresh in np.arange(0.50, 0.80, 0.02):
            mask = opt_df['meta_prob'] > thresh
            if mask.sum() < 20:
                continue
            hr = (opt_df.loc[mask, target_col] == 1).mean()
            if hr >= min_hr and mask.sum() > best_trades:
                best_thresh = thresh
                best_trades = mask.sum()

        if best_thresh is None:
            # Fallback: use highest threshold with reasonable trade count
            best_thresh = 0.55
            for thresh in np.arange(0.75, 0.50, -0.02):
                mask = opt_df['meta_prob'] > thresh
                if mask.sum() >= 30:
                    best_thresh = thresh
                    break

        thresholds[ticker] = best_thresh

        # Validate
        val_mask = val_df['meta_prob'] > best_thresh
        if val_mask.sum() >= 10:
            val_hr = (val_df.loc[val_mask, target_col] == 1).mean()
            val_ret = val_df.loc[val_mask, 'fwd_ret_21d'].mean() * 100
            val_pct = val_mask.sum() / len(val_df) * 100
        else:
            val_hr = 0
            val_ret = 0
            val_pct = 0

        results.append({
            'ticker': ticker,
            'threshold': best_thresh,
            'opt_hr': (opt_df.loc[opt_df['meta_prob'] > best_thresh, target_col] == 1).mean()
                      if (opt_df['meta_prob'] > best_thresh).sum() > 0 else 0,
            'val_hr': val_hr,
            'val_ret': val_ret,
            'val_pct': val_pct,
            'val_trades': val_mask.sum() if val_mask.sum() >= 0 else 0,
        })

    results_df = pd.DataFrame(results).sort_values('val_hr', ascending=False)

    print(f"\n  {'Ticker':10s} {'Thresh':8s} {'Opt HR':8s} {'Val HR':8s} {'Val Ret':10s} {'Trades':8s} {'Pct':6s}")
    print(f"  {'-' * 65}")
    for _, row in results_df.iterrows():
        print(f"  {row['ticker']:10s} {row['threshold']:6.2f}   "
              f"{row['opt_hr']:6.1%}   {row['val_hr']:6.1%}   "
              f"{row['val_ret']:+7.2f}%   {row['val_trades']:5.0f}   {row['val_pct']:4.1f}%")

    # Summary
    good = results_df[results_df['val_hr'] >= min_hr]
    print(f"\n  Stocks achieving ≥{min_hr:.0%} hit rate on validation: {len(good)}/{len(results_df)}")
    if len(good) > 0:
        print(f"  Average validation hit rate: {good['val_hr'].mean():.1%}")
        print(f"  Average validation return: {good['val_ret'].mean():+.2f}%")

    return thresholds, results_df


# ============================================================================
# Signal Generation
# ============================================================================

def generate_signals(predictions, thresholds, feature_importance):
    """Generate trading signals from predictions + abstention logic."""
    print(f"\n[6/8] GENERATING SIGNALS")
    print("=" * 60)

    signals = []
    for _, row in predictions.iterrows():
        ticker = row['ticker']
        thresh = thresholds.get(ticker, 0.55)
        meta_prob = row['meta_prob']
        agreement = row['agreement']

        # Abstention checks
        if meta_prob <= thresh:
            continue
        if agreement < 0.6:
            continue

        # Signal value: probability mapped to [-1, 1]
        # Only long signals (meta_prob > 0.5 after threshold filter)
        signal = (meta_prob - 0.5) * 2  # Maps 0.5→0, 1.0→1

        signals.append({
            'ticker': ticker,
            'signal_date': row['date'],
            'model_id': 'bifrost_v6_21d',
            'signal_value': round(float(signal), 4),
            'predicted_return': round(float(row.get('fwd_ret_21d', 0)), 4),
            'confidence': round(float(meta_prob), 4),
            'agreement': round(float(agreement), 4),
        })

    print(f"  → {len(signals):,} signals generated (from {len(predictions):,} predictions)")
    print(f"  → Abstention rate: {1 - len(signals) / len(predictions):.1%}")

    return pd.DataFrame(signals) if signals else pd.DataFrame()


# ============================================================================
# Database Writing
# ============================================================================

def write_signals_to_db(signals_df, conn):
    """Write signals to alpha_signals table with fresh connection."""
    if signals_df.empty:
        print("  No signals to write")
        return

    print(f"\n[7/8] WRITING TO DATABASE")
    print("=" * 60)

    try:
        cur = conn.cursor()

        # Ensure model is registered
        cur.execute("""
            INSERT INTO alpha_model_registry (model_id, model_type, description, version, is_active)
            VALUES
                ('bifrost_v6_21d', 'ensemble_stack', 'Bifrost v6: 5-model stack + meta-learner + abstention (21d)', 'v6.0', true)
            ON CONFLICT (model_id) DO UPDATE SET
                description = EXCLUDED.description,
                is_active = true
        """)
        conn.commit()

        # Write signals in batches
        batch_size = 500
        total = len(signals_df)
        written = 0

        for start in range(0, total, batch_size):
            batch = signals_df.iloc[start:start + batch_size]
            values = []
            for _, row in batch.iterrows():
                values.append(cur.mogrify(
                    "(%s, %s, %s, %s, %s, %s)",
                    (row['ticker'], row['signal_date'], row['model_id'],
                     row['signal_value'], row['predicted_return'], row['confidence'])
                ).decode())

            if values:
                sql = f"""
                    INSERT INTO alpha_signals (ticker, signal_date, model_id, signal_value, predicted_return, confidence)
                    VALUES {','.join(values)}
                    ON CONFLICT (ticker, signal_date, model_id) DO UPDATE SET
                        signal_value = EXCLUDED.signal_value,
                        predicted_return = EXCLUDED.predicted_return,
                        confidence = EXCLUDED.confidence
                """
                cur.execute(sql)
                written += len(batch)

            if written % 2000 == 0 and written > 0:
                conn.commit()
                print(f"    Written {written:,} / {total:,}")

        conn.commit()
        print(f"  → {written:,} signals written to database")

    except Exception as e:
        print(f"  DB write error: {e}")
        try:
            conn.rollback()
        except:
            pass


# ============================================================================
# Main
# ============================================================================

def main():
    parser = argparse.ArgumentParser(description='Alpha Engine v6 — Bifrost')
    parser.add_argument('--test', action='store_true', help='Test mode (15 tickers)')
    parser.add_argument('--no-write', action='store_true', help='Skip DB write')
    parser.add_argument('--target-hr', type=float, default=0.65,
                        help='Target hit rate for per-stock thresholds (default 0.65)')
    args = parser.parse_args()

    print("=" * 60)
    print(f"  ALPHA ENGINE v6 — BIFROST")
    print(f"  {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"  MODE: {'TEST (15 tickers)' if args.test else 'FULL UNIVERSE'}")
    print(f"  ARCHITECTURE: 5-model stack + meta-learner + abstention")
    print(f"  FEATURES: 90+ (11 groups incl. entropy, microstructure, Hurst)")
    print(f"  TARGET HIT RATE: ≥{args.target_hr:.0%}")
    print("=" * 60)

    start_time = time.time()

    # Load data
    db_url = get_db_url()
    conn = psycopg2.connect(db_url)
    data = load_data(conn, test_mode=args.test)

    # Feature engineering
    features, feature_cols = engineer_features(data)

    # Feature selection
    selected_features = select_features(
        features, features['target_dir_21d'], feature_cols, max_features=60
    )

    # Walk-forward training
    predictions, feature_importance, n_folds = run_walk_forward(
        features, selected_features, target_col='target_dir_21d'
    )

    if predictions is None:
        print("\nFATAL: No predictions generated. Check data.")
        conn.close()
        return

    # Abstention analysis
    best_config = evaluate_abstention(predictions)

    # Per-stock threshold optimization
    thresholds, threshold_results = optimize_per_stock_thresholds(
        predictions, min_hr=args.target_hr
    )

    # Generate signals
    signals_df = generate_signals(predictions, thresholds, feature_importance)

    # Write to DB
    if not args.no_write and not signals_df.empty:
        try:
            # Fresh connection for writing
            write_conn = psycopg2.connect(db_url)
            write_signals_to_db(signals_df, write_conn)
            write_conn.close()
        except Exception as e:
            print(f"  DB connection error: {e}")
            # Try original connection
            try:
                write_signals_to_db(signals_df, conn)
            except:
                print("  Could not write signals — connection timed out")

    # Summary
    elapsed = time.time() - start_time
    print(f"\n[8/8] SUMMARY")
    print("=" * 60)
    print(f"  Total time: {elapsed / 60:.1f} minutes")
    print(f"  Tickers processed: {features.ticker.nunique()}")
    print(f"  Features engineered: {len(feature_cols)} → {len(selected_features)} selected")
    print(f"  Walk-forward folds: {n_folds}")
    print(f"  Total predictions: {len(predictions):,}")
    print(f"  Signals generated: {len(signals_df):,}")
    print(f"  Abstention rate: {1 - len(signals_df) / max(len(predictions), 1):.1%}")

    if best_config:
        print(f"  Best global config: Meta>{best_config[0]:.2f}, Agree≥{best_config[1]:.0%}")
        print(f"  Best global hit rate: {best_config[2]:.1%}")

    good_stocks = threshold_results[threshold_results['val_hr'] >= args.target_hr]
    if len(good_stocks) > 0:
        print(f"  Stocks meeting ≥{args.target_hr:.0%} HR target: {len(good_stocks)}/{len(threshold_results)}")
        print(f"    {', '.join(good_stocks['ticker'].values)}")

    conn.close()
    print("\nDone.")


if __name__ == '__main__':
    main()
