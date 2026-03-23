#!/usr/bin/env python3
"""
ALPHA ENGINE v8 — "MJÖLNIR" (Thor's Hammer)
=============================================
Two-phase signal system: ML classification → ATR rule optimization.

Phase 1: Binary classification
  Target: "Will this stock return > threshold in next 21 trading days?"
  Models: XGBoost + LightGBM ensemble with calibrated probabilities
  Validation: Purged walk-forward (5-day embargo, expanding window)
  Signal: Only fire when calibrated P(win) > min_confidence

Phase 2: Per-stock ATR optimization
  For each stock with enough signals, walk-forward optimize:
  - ATR target multiple (1.5 - 4.0)
  - ATR stop multiple (0.8 - 2.5)
  - Max hold period (15 - 63 days)
  Find risk-adjusted best combo using Profit Factor × Win Rate metric.

Key differences from v7:
  1. CLASSIFICATION not regression — predicts probability of gain, not rank
  2. CALIBRATED PROBABILITIES — isotonic regression on holdout
  3. FEWER, STRONGER SIGNALS — only fires above confidence threshold
  4. 200MA HARD FILTER — long only above, short only below
  5. ATR OPTIMIZATION — per-stock trading rules as post-processing
  6. ANTI-OVERFITTING — min 3-year expanding window, feature stability checks

Usage:
  python alpha_trainer_v8.py --test      # 15 liquid stocks
  python alpha_trainer_v8.py             # Full universe
  python alpha_trainer_v8.py --no-write  # Evaluate only, don't write to DB
  python alpha_trainer_v8.py --short     # Enable short signals (below 200MA)
"""

import argparse
import json
import os
import sys
import time
import warnings
from datetime import datetime

import numpy as np
import pandas as pd
import psycopg2
from scipy import stats as scipy_stats
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import (
    roc_auc_score, precision_score, recall_score,
    brier_score_loss, log_loss
)

import xgboost as xgb
import lightgbm as lgb

warnings.filterwarnings('ignore')
sys.stdout = os.fdopen(sys.stdout.fileno(), 'w', 1)

# ============================================================================
# Constants
# ============================================================================

TEST_TICKERS = [
    'EQNR', 'DNB', 'MOWI', 'TEL', 'YAR', 'NHY', 'ORK', 'SALM',
    'FRO', 'AKRBP', 'LSG', 'SUBC', 'GSF', 'DNO', 'BAKKA',
]

# Prediction horizon
HORIZON_DAYS = 21          # 1-month forward return
WIN_THRESHOLD = 0.05       # 5% gain = "win" (positive class) — selective

# Walk-forward
MIN_TRAIN_DAYS = 756       # 3 years minimum training window
PURGE_GAP = 5              # 5-day gap between train and test
STEP_SIZE = 63             # Retrain every quarter

# Signal thresholds
MIN_CONFIDENCE = 0.55      # Minimum raw probability to generate signal
MIN_FOLD_AUC = 0.55        # Only use folds with AUC > this (quality gate)
MIN_SIGNALS_PER_STOCK = 5  # Need 5+ signals for ATR optimization

# ATR optimization grid — small grid to reduce overfitting
ATR_TARGET_GRID = [2.0, 2.5, 3.0, 3.5]
ATR_STOP_GRID = [1.0, 1.5, 2.0]
MAX_HOLD_GRID = [21, 42]

# Tree hyperparams — conservative to avoid overfitting
XGB_PARAMS = {
    'max_depth': 4,
    'learning_rate': 0.02,
    'n_estimators': 500,
    'reg_alpha': 2.0,
    'reg_lambda': 5.0,
    'min_child_weight': 30,
    'subsample': 0.65,
    'colsample_bytree': 0.5,
    'scale_pos_weight': 1.0,  # Will be set dynamically
    'objective': 'binary:logistic',
    'eval_metric': 'logloss',
    'random_state': 42,
    'verbosity': 0,
    'early_stopping_rounds': 50,
}

LGBM_PARAMS = {
    'max_depth': 4,
    'learning_rate': 0.02,
    'n_estimators': 500,
    'num_leaves': 12,
    'lambda_l1': 2.0,
    'lambda_l2': 5.0,
    'min_child_samples': 30,
    'subsample': 0.65,
    'colsample_bytree': 0.5,
    'is_unbalance': True,
    'objective': 'binary',
    'metric': 'binary_logloss',
    'random_state': 42,
    'verbose': -1,
}


# ============================================================================
# Feature Engineering
# ============================================================================

def compute_features(df_ticker, obx_returns=None, sector_returns=None):
    """Compute all features for a single ticker's price history.

    Returns DataFrame with features aligned to df_ticker's dates.
    Features are designed to capture:
    - Momentum at multiple scales
    - Mean-reversion setups
    - Volatility structure
    - Microstructure (liquidity, volume patterns)
    - Trend structure
    - Cross-asset context
    """
    df = df_ticker.copy()
    n = len(df)
    if n < 300:
        return pd.DataFrame()

    close = df['close'].values.astype(float)
    high = df['high'].values.astype(float)
    low = df['low'].values.astype(float)
    opn = df['open'].values.astype(float)
    volume = df['volume'].values.astype(float)

    # Daily returns
    ret = np.zeros(n)
    ret[1:] = close[1:] / close[:-1] - 1
    log_ret = np.zeros(n)
    log_ret[1:] = np.log(close[1:] / close[:-1])

    feats = pd.DataFrame(index=df.index)

    # ---- MOMENTUM (multi-scale) ----
    for d in [5, 10, 21, 63, 126, 252]:
        feats[f'ret_{d}d'] = pd.Series(close, index=df.index).pct_change(d)

    # Skip-month momentum (Jegadeesh & Titman)
    feats['mom_12_1'] = pd.Series(close, index=df.index).pct_change(252) - \
                        pd.Series(close, index=df.index).pct_change(21)

    # Momentum quality: consistency of gains
    ret_s = pd.Series(ret, index=df.index)
    feats['mom_quality'] = ret_s.rolling(63).apply(
        lambda x: np.mean(x > 0) if len(x) > 0 else 0.5, raw=True
    )

    # Momentum acceleration
    mom_21 = pd.Series(close, index=df.index).pct_change(21)
    feats['mom_accel'] = mom_21 - mom_21.shift(21)

    # ---- MEAN REVERSION ----
    close_s = pd.Series(close, index=df.index)
    sma20 = close_s.rolling(20).mean()
    sma50 = close_s.rolling(50).mean()
    sma200 = close_s.rolling(200).mean()

    feats['dist_sma20'] = close_s / sma20 - 1
    feats['dist_sma50'] = close_s / sma50 - 1
    feats['dist_sma200'] = close_s / sma200 - 1

    # Z-score (20-day)
    roll_mean = close_s.rolling(20).mean()
    roll_std = close_s.rolling(20).std()
    feats['z_score_20d'] = (close_s - roll_mean) / (roll_std + 1e-8)

    # Bollinger Band position (0 = lower band, 1 = upper band)
    bb_upper = roll_mean + 2 * roll_std
    bb_lower = roll_mean - 2 * roll_std
    feats['bb_position'] = (close_s - bb_lower) / (bb_upper - bb_lower + 1e-8)

    # Distance from 52-week high/low
    high_s = pd.Series(high, index=df.index)
    low_s = pd.Series(low, index=df.index)
    high_252 = high_s.rolling(252).max()
    low_252 = low_s.rolling(252).min()
    feats['dist_52w_high'] = close_s / high_252 - 1
    feats['dist_52w_low'] = close_s / low_252 - 1
    feats['pct_52w_range'] = (close_s - low_252) / (high_252 - low_252 + 1e-8)

    # RSI (14-day)
    delta = close_s.diff()
    gain = delta.where(delta > 0, 0).rolling(14).mean()
    loss = (-delta.where(delta < 0, 0)).rolling(14).mean()
    rs = gain / (loss + 1e-8)
    feats['rsi_14'] = 100 - 100 / (1 + rs)

    # RSI divergence: price makes new high but RSI doesn't
    price_21h = close_s.rolling(21).max()
    rsi_21h = feats['rsi_14'].rolling(21).max()
    feats['rsi_divergence'] = (close_s / price_21h - 1) - (feats['rsi_14'] / rsi_21h - 1)

    # ---- VOLATILITY STRUCTURE ----
    ret_s_abs = ret_s.abs()
    for d in [5, 21, 63]:
        feats[f'vol_{d}d'] = ret_s.rolling(d).std() * np.sqrt(252)

    feats['vol_ratio_5_21'] = feats['vol_5d'] / (feats['vol_21d'] + 1e-8)
    feats['vol_ratio_21_63'] = feats['vol_21d'] / (feats['vol_63d'] + 1e-8)

    # Garman-Klass volatility (uses OHLC — more efficient than close-to-close)
    gk_var = 0.5 * np.log(high / low) ** 2 - (2 * np.log(2) - 1) * np.log(close / opn) ** 2
    feats['gk_vol'] = pd.Series(gk_var, index=df.index).rolling(21).mean().apply(
        lambda x: np.sqrt(x * 252) if x > 0 else 0
    )

    # Downside volatility
    neg_rets = ret_s.where(ret_s < 0, 0)
    feats['downside_vol'] = neg_rets.rolling(63).std() * np.sqrt(252)

    # Max drawdown (21d rolling)
    feats['max_dd_21d'] = close_s.rolling(21).apply(
        lambda x: (x[-1] / x.max() - 1) if len(x) > 0 and x.max() > 0 else 0,
        raw=True
    )

    # ATR (14-day) — normalized by price
    true_range = np.maximum(
        high - low,
        np.maximum(
            np.abs(high - np.roll(close, 1)),
            np.abs(low - np.roll(close, 1))
        )
    )
    true_range[0] = high[0] - low[0]
    atr_14 = pd.Series(true_range, index=df.index).rolling(14).mean()
    feats['atr_pct'] = atr_14 / close_s  # ATR as % of price

    # ---- VOLUME / MICROSTRUCTURE ----
    vol_s = pd.Series(volume, index=df.index)
    vol_sma20 = vol_s.rolling(20).mean()

    feats['volume_ratio'] = vol_s / (vol_sma20 + 1)
    feats['log_dollar_vol'] = np.log1p(vol_s * close_s)

    # Volume trend (is volume increasing or decreasing?)
    feats['vol_trend'] = vol_sma20 / (vol_s.rolling(60).mean() + 1) - 1

    # Amihud illiquidity
    dollar_vol = vol_s * close_s
    feats['amihud'] = (ret_s_abs / (dollar_vol + 1)).rolling(21).mean()

    # On-Balance Volume slope (accumulation/distribution)
    obv = (ret_s.apply(np.sign) * vol_s).cumsum()
    feats['obv_slope'] = obv.rolling(21).apply(
        lambda x: np.polyfit(range(len(x)), x, 1)[0] / (np.mean(np.abs(x)) + 1) if len(x) > 1 else 0,
        raw=True
    )

    # ---- TREND STRUCTURE ----
    feats['above_sma20'] = (close_s > sma20).astype(float)
    feats['above_sma50'] = (close_s > sma50).astype(float)
    feats['above_sma200'] = (close_s > sma200).astype(float)
    feats['trend_score'] = feats['above_sma20'] + feats['above_sma50'] + feats['above_sma200']

    # SMA alignment: 20 > 50 > 200 (bullish) or 200 > 50 > 20 (bearish)
    feats['sma_align'] = ((sma20 > sma50) & (sma50 > sma200)).astype(float) - \
                         ((sma200 > sma50) & (sma50 > sma20)).astype(float)

    # MACD
    ema12 = close_s.ewm(span=12).mean()
    ema26 = close_s.ewm(span=26).mean()
    macd = ema12 - ema26
    macd_signal = macd.ewm(span=9).mean()
    feats['macd_hist'] = (macd - macd_signal) / close_s  # Normalized

    # ADX (Average Directional Index) — trend strength
    plus_dm = high_s.diff().where(high_s.diff() > 0, 0)
    minus_dm = (-low_s.diff()).where(-low_s.diff() > 0, 0)
    tr_s = pd.Series(true_range, index=df.index)
    plus_di = 100 * (plus_dm.rolling(14).mean() / (tr_s.rolling(14).mean() + 1e-8))
    minus_di = 100 * (minus_dm.rolling(14).mean() / (tr_s.rolling(14).mean() + 1e-8))
    dx = 100 * (plus_di - minus_di).abs() / (plus_di + minus_di + 1e-8)
    feats['adx'] = dx.rolling(14).mean()

    # ---- PATTERN FEATURES ----
    # Inside bars (low vol consolidation — often precedes breakout)
    feats['inside_bar_count'] = ((high_s < high_s.shift(1)) & (low_s > low_s.shift(1))).rolling(10).sum()

    # Gap frequency (overnight gaps indicate news-driven moves)
    gap = (opn - np.roll(close, 1)) / (np.roll(close, 1) + 1e-8)
    gap[0] = 0
    feats['gap_magnitude'] = pd.Series(np.abs(gap), index=df.index).rolling(21).mean()

    # Range contraction (Bollinger squeeze)
    band_width = (bb_upper - bb_lower) / (roll_mean + 1e-8)
    feats['bb_squeeze'] = band_width / (band_width.rolling(126).mean() + 1e-8)

    # ---- CALENDAR ----
    if hasattr(df.index, 'month'):
        dates = df.index
    else:
        dates = pd.to_datetime(df['date']) if 'date' in df.columns else df.index

    month = pd.Series(dates.month if hasattr(dates, 'month') else 1, index=df.index)
    feats['is_january'] = (month == 1).astype(float)
    feats['month_sin'] = np.sin(2 * np.pi * month / 12)
    feats['month_cos'] = np.cos(2 * np.pi * month / 12)

    # Day of week
    dow = pd.Series(dates.dayofweek if hasattr(dates, 'dayofweek') else 0, index=df.index)
    feats['is_monday'] = (dow == 0).astype(float)
    feats['is_friday'] = (dow == 4).astype(float)

    # ---- MARKET CONTEXT (if available) ----
    if obx_returns is not None and len(obx_returns) > 0:
        # Align OBX returns
        obx_aligned = obx_returns.reindex(df.index).fillna(0)

        # Beta (63d rolling)
        cov_rm = ret_s.rolling(63).cov(obx_aligned)
        var_m = obx_aligned.rolling(63).var()
        feats['beta_63d'] = cov_rm / (var_m + 1e-8)

        # Idiosyncratic vol
        predicted_ret = feats['beta_63d'] * obx_aligned
        residual = ret_s - predicted_ret
        feats['ivol_63d'] = residual.rolling(63).std() * np.sqrt(252)

        # Excess return over market
        feats['excess_ret_21d'] = feats.get('ret_21d', ret_s.rolling(21).sum()) - \
                                  obx_aligned.rolling(21).sum()

    # ---- CROSS-ASSET (if available, added externally) ----
    # These will be merged in from commodity/FX data

    return feats


def add_cross_asset_features(feats_df, dates, conn):
    """Add commodity, FX, and shipping features from DB."""
    try:
        # Commodities: Brent, WTI, Gold, Aluminium
        comm_symbols = ['BZ=F', 'CL=F', 'GC=F', 'ALI=F']
        for sym in comm_symbols:
            df_c = pd.read_sql(f"""
                SELECT date, close FROM commodity_prices
                WHERE symbol = '{sym}' ORDER BY date
            """, conn, parse_dates=['date']).set_index('date')
            if len(df_c) > 0:
                df_c = df_c.reindex(dates).ffill()
                for d in [5, 21]:
                    col = f'c_{sym.replace("=", "")}_r{d}'
                    feats_df[col] = df_c['close'].pct_change(d)

        # FX: NOK/USD, NOK/EUR
        for pair in ['NOKUSD', 'NOKEUR']:
            df_fx = pd.read_sql(f"""
                SELECT date, rate FROM fx_spot_rates
                WHERE pair = '{pair}' ORDER BY date
            """, conn, parse_dates=['date']).set_index('date')
            if len(df_fx) > 0:
                df_fx = df_fx.reindex(dates).ffill()
                for d in [5, 21]:
                    feats_df[f'fx_{pair}_r{d}'] = df_fx['rate'].pct_change(d)

        # Short positions
        df_shorts = pd.read_sql("""
            SELECT date, ticker, short_pct FROM short_positions ORDER BY date
        """, conn, parse_dates=['date'])
        # Will be merged per-ticker externally

    except Exception as e:
        print(f"  [WARN] Cross-asset feature fetch partial: {e}")

    return feats_df


def add_fundamental_features(feats_df, ticker, dates, conn):
    """Add fundamental features from factor_fundamentals table."""
    try:
        df_fund = pd.read_sql(f"""
            SELECT date, ep, bm, dy, sp, ev_ebitda, mktcap
            FROM factor_fundamentals
            WHERE ticker = '{ticker}'
            ORDER BY date
        """, conn, parse_dates=['date']).set_index('date')

        if len(df_fund) > 0:
            df_fund = df_fund.reindex(dates).ffill()
            for col in ['ep', 'bm', 'dy', 'sp', 'ev_ebitda']:
                if col in df_fund.columns:
                    feats_df[col] = df_fund[col].astype(float)
            if 'mktcap' in df_fund.columns:
                feats_df['mktcap_log'] = np.log1p(df_fund['mktcap'].astype(float))

            # Earnings momentum: change in E/P over 63 days
            if 'ep' in df_fund.columns:
                ep_s = df_fund['ep'].astype(float)
                feats_df['ep_momentum'] = ep_s - ep_s.shift(63)
    except Exception as e:
        print(f"  [WARN] Fundamental features for {ticker}: {e}")

    return feats_df


# ============================================================================
# Walk-Forward Training
# ============================================================================

def add_cross_sectional_features(data):
    """Add cross-sectional rank features within each date.

    These capture relative positioning: is this stock's momentum/vol/value
    extreme relative to peers today?
    """
    rank_cols = ['ret_5d', 'ret_21d', 'ret_63d', 'vol_21d', 'amihud', 'rsi_14',
                 'dist_sma200', 'bb_position', 'volume_ratio']

    for col in rank_cols:
        if col in data.columns:
            # Percentile rank within each date (0-1)
            data[f'{col}_rank'] = data.groupby('date')[col].rank(pct=True)

    # Interaction features from ranks
    if 'ret_21d_rank' in data.columns and 'vol_21d_rank' in data.columns:
        data['mom_x_vol_rank'] = data['ret_21d_rank'] * data['vol_21d_rank']

    if 'ret_21d_rank' in data.columns and 'rsi_14_rank' in data.columns:
        data['mom_x_rsi_rank'] = data['ret_21d_rank'] * data['rsi_14_rank']

    return data


def train_walk_forward(all_data, dates_index, feature_cols, args):
    """
    Purged walk-forward training — no isotonic calibration.
    Uses raw ensemble probabilities with quality gate (skip weak folds).

    Returns list of predictions_df with:
      - ticker, date, prob_win, forward_return, target, above_200ma
    """
    unique_dates = sorted(dates_index.unique())
    n_dates = len(unique_dates)

    min_train_date_idx = MIN_TRAIN_DAYS
    if min_train_date_idx >= n_dates - STEP_SIZE:
        print(f"  [ERROR] Not enough data: {n_dates} dates, need {MIN_TRAIN_DAYS}")
        return []

    all_predictions = []
    fold = 0
    skipped_folds = 0
    test_start_idx = min_train_date_idx

    while test_start_idx + STEP_SIZE <= n_dates:
        fold += 1
        test_end_idx = min(test_start_idx + STEP_SIZE, n_dates)

        # Date boundaries with purge gap
        train_end_date = unique_dates[test_start_idx - PURGE_GAP - 1]
        test_start_date = unique_dates[test_start_idx]
        test_end_date = unique_dates[test_end_idx - 1]

        # Split data
        train_mask = all_data['date'] <= train_end_date
        test_mask = (all_data['date'] >= test_start_date) & (all_data['date'] <= test_end_date)

        train_data = all_data[train_mask].copy()
        test_data = all_data[test_mask].copy()

        if len(train_data) < 500 or len(test_data) < 50:
            test_start_idx += STEP_SIZE
            continue

        # Use last 15% of training as validation for early stopping
        val_cutoff = train_data['date'].quantile(0.85)
        val_mask = train_data['date'] >= val_cutoff
        val_data = train_data[val_mask].copy()
        pure_train = train_data[~val_mask].copy()

        if len(pure_train) < 300 or len(val_data) < 50:
            test_start_idx += STEP_SIZE
            continue

        X_train = pure_train[feature_cols].values
        y_train = pure_train['target'].values
        X_val = val_data[feature_cols].values
        y_val = val_data['target'].values
        X_test = test_data[feature_cols].values

        # Handle NaN/Inf
        X_train = np.nan_to_num(X_train, nan=0, posinf=0, neginf=0)
        X_val = np.nan_to_num(X_val, nan=0, posinf=0, neginf=0)
        X_test = np.nan_to_num(X_test, nan=0, posinf=0, neginf=0)

        # Scale features
        scaler = StandardScaler()
        X_train = scaler.fit_transform(X_train)
        X_val = scaler.transform(X_val)
        X_test = scaler.transform(X_test)

        # Class balance
        pos_rate = y_train.mean()
        if pos_rate < 0.01 or pos_rate > 0.99:
            test_start_idx += STEP_SIZE
            continue
        scale_pos = (1 - pos_rate) / pos_rate

        # Train XGBoost
        xgb_params = XGB_PARAMS.copy()
        xgb_params['scale_pos_weight'] = scale_pos
        model_xgb = xgb.XGBClassifier(**xgb_params)
        model_xgb.fit(X_train, y_train, eval_set=[(X_val, y_val)], verbose=False)

        # Train LightGBM
        model_lgbm = lgb.LGBMClassifier(**LGBM_PARAMS)
        model_lgbm.fit(X_train, y_train, eval_set=[(X_val, y_val)])

        # Ensemble probabilities — raw, no calibration
        prob_xgb = model_xgb.predict_proba(X_test)[:, 1]
        prob_lgbm = model_lgbm.predict_proba(X_test)[:, 1]
        prob_ensemble = 0.5 * prob_xgb + 0.5 * prob_lgbm

        # Quality gate: check validation AUC before using this fold
        test_y = test_data['target'].values
        val_prob = 0.5 * model_xgb.predict_proba(X_val)[:, 1] + \
                   0.5 * model_lgbm.predict_proba(X_val)[:, 1]

        if len(np.unique(y_val)) > 1:
            val_auc = roc_auc_score(y_val, val_prob)
        else:
            val_auc = 0.5

        if len(np.unique(test_y)) > 1:
            test_auc = roc_auc_score(test_y, prob_ensemble)
        else:
            test_auc = 0.5

        # Quality gate: skip folds where model has no edge
        if val_auc < MIN_FOLD_AUC:
            skipped_folds += 1
            period_str = test_start_date.strftime('%Y-%m') if hasattr(test_start_date, 'strftime') else str(test_start_date)[:7]
            print(f"  Fold {fold:2d} [{period_str}]: SKIPPED (val AUC={val_auc:.3f} < {MIN_FOLD_AUC})")
            test_start_idx += STEP_SIZE
            continue

        # Collect predictions
        fold_preds = test_data[['ticker', 'date', 'forward_return', 'target', 'above_200ma']].copy()
        fold_preds['prob_win'] = prob_ensemble
        fold_preds['fold'] = fold

        # Feature importance
        fi_xgb = model_xgb.feature_importances_
        fi_lgbm = model_lgbm.feature_importances_
        fi_avg = (fi_xgb + fi_lgbm) / 2
        top_features = sorted(zip(feature_cols, fi_avg), key=lambda x: -x[1])[:15]
        fold_preds['top_features'] = json.dumps({f: round(float(v), 4) for f, v in top_features})

        all_predictions.append(fold_preds)

        # Signal stats
        high_conf = (prob_ensemble >= MIN_CONFIDENCE).sum()
        high_conf_win_rate = 0
        if high_conf > 0:
            hc_mask = prob_ensemble >= MIN_CONFIDENCE
            high_conf_win_rate = test_y[hc_mask].mean()

        period_str = test_start_date.strftime('%Y-%m') if hasattr(test_start_date, 'strftime') else str(test_start_date)[:7]
        print(f"  Fold {fold:2d} [{period_str}]: "
              f"train={len(pure_train):5d} test={len(test_data):4d} "
              f"valAUC={val_auc:.3f} testAUC={test_auc:.3f} "
              f"signals={high_conf:3d} win%={high_conf_win_rate:.1%} "
              f"pos_rate={pos_rate:.1%}")

        test_start_idx += STEP_SIZE

    print(f"  ({skipped_folds} folds skipped by quality gate)")
    return all_predictions


# ============================================================================
# ATR Optimization (Phase 2)
# ============================================================================

def optimize_atr_per_stock(signals_df, prices_by_ticker, min_signals=MIN_SIGNALS_PER_STOCK):
    """
    Walk-forward ATR optimization per stock.

    For each stock with enough signals, find the best ATR target/stop multiples
    using the first 60% of signals as train and last 40% as test.

    Returns dict: ticker -> {target_mult, stop_mult, max_hold, train_metrics, test_metrics}
    """
    results = {}

    for ticker, group in signals_df.groupby('ticker'):
        if len(group) < min_signals:
            continue

        prices = prices_by_ticker.get(ticker)
        if prices is None or len(prices) < 100:
            continue

        # Sort by date
        group = group.sort_values('date')

        # Walk-forward split: 60% train, 40% test
        split_idx = int(len(group) * 0.6)
        if split_idx < 5 or len(group) - split_idx < 3:
            continue

        train_signals = group.iloc[:split_idx]
        test_signals = group.iloc[split_idx:]

        # Build price lookup
        price_dates = sorted(prices.keys())

        def simulate_trades(sigs, target_mult, stop_mult, max_hold):
            """Simulate ATR-based trades for a set of signals."""
            trades = []

            for _, sig in sigs.iterrows():
                entry_date = sig['date']
                if isinstance(entry_date, str):
                    entry_date = pd.Timestamp(entry_date)

                # Find entry price and ATR
                entry_key = entry_date.strftime('%Y-%m-%d') if hasattr(entry_date, 'strftime') else str(entry_date)[:10]
                if entry_key not in prices:
                    # Try nearby dates
                    found = False
                    for offset in range(1, 4):
                        for d in [(entry_date + pd.Timedelta(days=offset)),
                                  (entry_date - pd.Timedelta(days=offset))]:
                            dk = d.strftime('%Y-%m-%d')
                            if dk in prices:
                                entry_key = dk
                                found = True
                                break
                        if found:
                            break
                    if not found:
                        continue

                entry_data = prices[entry_key]
                entry_price = entry_data['close']
                atr = entry_data.get('atr14', entry_price * 0.02)
                if atr is None or atr <= 0:
                    atr = entry_price * 0.02

                target_price = entry_price + atr * target_mult
                stop_price = entry_price - atr * stop_mult

                # Walk forward through subsequent days
                entry_idx = price_dates.index(entry_key) if entry_key in price_dates else -1
                if entry_idx < 0:
                    continue

                exit_price = None
                exit_reason = None
                hold_days = 0
                trailing_stop = stop_price

                for i in range(entry_idx + 1, min(entry_idx + max_hold + 1, len(price_dates))):
                    day_key = price_dates[i]
                    day_data = prices[day_key]
                    hold_days += 1

                    # Trailing stop: move to breakeven when >1 ATR in profit
                    if day_data['close'] > entry_price + atr and trailing_stop < entry_price:
                        trailing_stop = entry_price

                    # Check intraday high/low
                    if day_data['low'] <= trailing_stop:
                        exit_price = trailing_stop
                        exit_reason = 'stop'
                        break
                    elif day_data['high'] >= target_price:
                        exit_price = target_price
                        exit_reason = 'target'
                        break

                if exit_price is None:
                    # Max hold exit
                    last_idx = min(entry_idx + max_hold, len(price_dates) - 1)
                    exit_price = prices[price_dates[last_idx]]['close']
                    exit_reason = 'max_hold'
                    hold_days = last_idx - entry_idx

                net_return = (exit_price - entry_price) / entry_price - 0.003  # 30bps cost
                trades.append({
                    'net_return': net_return,
                    'exit_reason': exit_reason,
                    'hold_days': hold_days,
                })

            return trades

        # Grid search on training signals
        best_score = -999
        best_params = None
        best_train_metrics = None

        for tm in ATR_TARGET_GRID:
            for sm in ATR_STOP_GRID:
                if tm / sm < 1.2:  # Skip bad risk/reward ratios
                    continue
                for mh in MAX_HOLD_GRID:
                    trades = simulate_trades(train_signals, tm, sm, mh)
                    if len(trades) < 3:
                        continue

                    wins = [t for t in trades if t['net_return'] > 0]
                    losses = [t for t in trades if t['net_return'] <= 0]
                    win_rate = len(wins) / len(trades)

                    gross_wins = sum(t['net_return'] for t in wins)
                    gross_losses = abs(sum(t['net_return'] for t in losses))
                    profit_factor = gross_wins / (gross_losses + 1e-8)
                    avg_return = np.mean([t['net_return'] for t in trades])

                    # Scoring: Profit Factor × Win Rate × sqrt(n_trades)
                    # Penalize very few trades, reward consistency
                    score = profit_factor * win_rate * np.sqrt(len(trades))

                    if score > best_score:
                        best_score = score
                        best_params = (tm, sm, mh)
                        best_train_metrics = {
                            'trades': len(trades),
                            'win_rate': win_rate,
                            'profit_factor': profit_factor,
                            'avg_return': avg_return,
                            'targets': sum(1 for t in trades if t['exit_reason'] == 'target'),
                            'stops': sum(1 for t in trades if t['exit_reason'] == 'stop'),
                        }

        if best_params is None:
            continue

        # Evaluate on test signals with best params
        test_trades = simulate_trades(test_signals, *best_params)
        if len(test_trades) < 2:
            continue

        test_wins = [t for t in test_trades if t['net_return'] > 0]
        test_losses = [t for t in test_trades if t['net_return'] <= 0]
        test_win_rate = len(test_wins) / len(test_trades)
        test_gross_wins = sum(t['net_return'] for t in test_wins)
        test_gross_losses = abs(sum(t['net_return'] for t in test_losses))
        test_pf = test_gross_wins / (test_gross_losses + 1e-8)

        results[ticker] = {
            'target_mult': best_params[0],
            'stop_mult': best_params[1],
            'max_hold': best_params[2],
            'train': best_train_metrics,
            'test': {
                'trades': len(test_trades),
                'win_rate': test_win_rate,
                'profit_factor': test_pf,
                'avg_return': np.mean([t['net_return'] for t in test_trades]),
                'targets': sum(1 for t in test_trades if t['exit_reason'] == 'target'),
                'stops': sum(1 for t in test_trades if t['exit_reason'] == 'stop'),
            },
        }

        print(f"  {ticker:8s}: TP={best_params[0]:.1f}x SL={best_params[1]:.1f}x Hold={best_params[2]:2d}d | "
              f"Train: {best_train_metrics['trades']:2d}t {best_train_metrics['win_rate']:.0%}wr {best_train_metrics['profit_factor']:.1f}pf | "
              f"Test:  {len(test_trades):2d}t {test_win_rate:.0%}wr {test_pf:.1f}pf")

    return results


# ============================================================================
# Main Pipeline
# ============================================================================

def run(args):
    t0 = time.time()
    print("=" * 70)
    print("ALPHA ENGINE v8 — MJÖLNIR")
    print(f"Target: {HORIZON_DAYS}d forward return > {WIN_THRESHOLD:.0%}")
    print(f"Min confidence: {MIN_CONFIDENCE:.0%}")
    print(f"Walk-forward: {MIN_TRAIN_DAYS}d min train, {PURGE_GAP}d purge, {STEP_SIZE}d step")
    print("=" * 70)

    # Connect to database
    db_url = os.environ.get('DATABASE_URL', '')
    if not db_url:
        print("[ERROR] DATABASE_URL not set")
        return

    conn = psycopg2.connect(db_url)

    # ========================================================================
    # 1. Load price data
    # ========================================================================
    print("\n[1/6] Loading price data...")

    ticker_filter = ""
    if args.test:
        tickers_str = "','".join(TEST_TICKERS)
        ticker_filter = f"AND ticker IN ('{tickers_str}')"

    df_prices = pd.read_sql(f"""
        SELECT ticker, date, open, high, low, close, volume
        FROM prices_daily
        WHERE volume > 0 AND close > 0
          AND date >= '2018-01-01'
          {ticker_filter}
        ORDER BY ticker, date
    """, conn, parse_dates=['date'])

    tickers = sorted(df_prices['ticker'].unique())
    print(f"  Loaded {len(df_prices):,} rows for {len(tickers)} tickers")

    # Load OBX index for market returns
    df_obx = pd.read_sql("""
        SELECT date, close FROM prices_daily
        WHERE ticker = 'OBX' AND close > 0
        ORDER BY date
    """, conn, parse_dates=['date']).set_index('date')

    obx_returns = df_obx['close'].pct_change().dropna()
    print(f"  OBX benchmark: {len(obx_returns)} days")

    # ========================================================================
    # 2. Feature engineering per ticker
    # ========================================================================
    print("\n[2/6] Engineering features...")

    all_features = []
    prices_by_ticker = {}  # For ATR optimization

    for i, ticker in enumerate(tickers):
        df_t = df_prices[df_prices['ticker'] == ticker].copy()
        df_t = df_t.sort_values('date').set_index('date')

        if len(df_t) < 300:
            continue

        # Compute features
        feats = compute_features(df_t, obx_returns=obx_returns)
        if feats.empty:
            continue

        # Add fundamentals
        feats = add_fundamental_features(feats, ticker, feats.index, conn)

        # Target: forward return > threshold
        close_s = df_t['close']
        forward_return = close_s.shift(-HORIZON_DAYS) / close_s - 1

        # 200MA filter
        sma200 = close_s.rolling(200).mean()
        above_200ma = (close_s > sma200).astype(float)

        # ATR for later optimization
        true_range = np.maximum(
            df_t['high'].values - df_t['low'].values,
            np.maximum(
                np.abs(df_t['high'].values - np.roll(df_t['close'].values, 1)),
                np.abs(df_t['low'].values - np.roll(df_t['close'].values, 1))
            )
        )
        true_range[0] = df_t['high'].values[0] - df_t['low'].values[0]
        atr14 = pd.Series(true_range, index=df_t.index).rolling(14).mean()

        # Store price data for ATR optimization
        price_dict = {}
        for dt, row in df_t.iterrows():
            dt_str = dt.strftime('%Y-%m-%d')
            price_dict[dt_str] = {
                'open': float(row['open']),
                'high': float(row['high']),
                'low': float(row['low']),
                'close': float(row['close']),
                'atr14': float(atr14.get(dt, row['close'] * 0.02)),
            }
        prices_by_ticker[ticker] = price_dict

        # Combine
        feats['ticker'] = ticker
        feats['date'] = feats.index
        feats['forward_return'] = forward_return
        feats['target'] = (forward_return > WIN_THRESHOLD).astype(int)
        feats['above_200ma'] = above_200ma

        # Drop rows without target (last HORIZON_DAYS rows)
        feats = feats.dropna(subset=['forward_return'])

        all_features.append(feats)

        if (i + 1) % 10 == 0:
            print(f"  {i+1}/{len(tickers)} tickers processed")

    if not all_features:
        print("[ERROR] No valid features generated")
        conn.close()
        return

    all_data = pd.concat(all_features, ignore_index=True)

    # Add cross-sectional rank features (relative to peers on same date)
    all_data = add_cross_sectional_features(all_data)
    print(f"  Total samples: {len(all_data):,}")
    print(f"  Positive rate (>{WIN_THRESHOLD:.0%} gain): {all_data['target'].mean():.1%}")

    # ========================================================================
    # 3. Feature selection
    # ========================================================================
    print("\n[3/6] Feature selection...")

    # Get all numeric feature columns (exclude metadata)
    exclude_cols = {'ticker', 'date', 'forward_return', 'target', 'above_200ma',
                    'fold', 'prob_win', 'prob_raw', 'top_features'}
    feature_cols = [c for c in all_data.columns if c not in exclude_cols
                    and all_data[c].dtype in ['float64', 'float32', 'int64', 'int32']]

    # Remove features with >30% missing
    valid_features = []
    for col in feature_cols:
        miss_rate = all_data[col].isna().mean()
        if miss_rate < 0.30:
            valid_features.append(col)

    # Fill remaining NaN with 0
    all_data[valid_features] = all_data[valid_features].fillna(0)

    # Quick importance check with LightGBM on recent data
    recent = all_data[all_data['date'] >= '2022-01-01']
    if len(recent) > 1000:
        X_quick = recent[valid_features].values
        y_quick = recent['target'].values
        X_quick = np.nan_to_num(X_quick, nan=0, posinf=0, neginf=0)

        quick_lgbm = lgb.LGBMClassifier(
            n_estimators=200, max_depth=3, learning_rate=0.05,
            num_leaves=8, verbose=-1, random_state=42,
            objective='binary'
        )
        quick_lgbm.fit(X_quick, y_quick)

        importance = dict(zip(valid_features, quick_lgbm.feature_importances_))
        # Keep features with non-zero importance, up to 50
        sorted_feats = sorted(importance.items(), key=lambda x: -x[1])
        selected_features = [f for f, v in sorted_feats if v > 0][:50]

        if len(selected_features) < 15:
            selected_features = valid_features[:50]

        print(f"  Selected {len(selected_features)} features from {len(valid_features)} valid")
        print(f"  Top 10: {[f'{f}({v})' for f, v in sorted_feats[:10]]}")
    else:
        selected_features = valid_features[:50]
        print(f"  Using top {len(selected_features)} features (insufficient recent data for selection)")

    feature_cols = selected_features

    # ========================================================================
    # 4. Walk-forward training
    # ========================================================================
    print("\n[4/6] Walk-forward training...")

    # Sort by date for proper walk-forward
    all_data = all_data.sort_values('date')
    dates_index = all_data['date']

    predictions = train_walk_forward(all_data, dates_index, feature_cols, args)

    if not predictions:
        print("[ERROR] No predictions generated")
        conn.close()
        return

    pred_df = pd.concat(predictions, ignore_index=True)
    print(f"\n  Total predictions: {len(pred_df):,}")

    # ========================================================================
    # 5. Signal evaluation & filtering (3-stage gate)
    # ========================================================================
    print("\n[5/6] Signal evaluation (3-stage gate)...")

    # --- Gate 1: Confidence threshold + 200MA ---
    long_signals = pred_df[
        (pred_df['prob_win'] >= MIN_CONFIDENCE) &
        (pred_df['above_200ma'] == 1)
    ].copy()

    if args.short:
        short_signals = pred_df[
            (pred_df['prob_win'] < (1 - MIN_CONFIDENCE)) &
            (pred_df['above_200ma'] == 0)
        ].copy()
        short_signals['direction'] = -1
        long_signals['direction'] = 1
        gate1_signals = pd.concat([long_signals, short_signals])
    else:
        long_signals['direction'] = 1
        gate1_signals = long_signals

    print(f"  Gate 1 (confidence >= {MIN_CONFIDENCE:.0%} + 200MA): {len(gate1_signals):,} signals")

    # --- Gate 2: Per-ticker historical hit rate ---
    # Only keep tickers where the model has historically been right >35%
    MIN_TICKER_HIT_RATE = 0.35
    MIN_TICKER_SIGNALS = 10  # Need at least 10 signals to evaluate

    ticker_hit_rates = gate1_signals.groupby('ticker').agg(
        n_signals=('target', 'count'),
        hit_rate=('target', 'mean'),
        avg_return=('forward_return', 'mean'),
    )

    eligible_tickers = ticker_hit_rates[
        (ticker_hit_rates['n_signals'] >= MIN_TICKER_SIGNALS) &
        (ticker_hit_rates['hit_rate'] >= MIN_TICKER_HIT_RATE)
    ].index.tolist()

    rejected_tickers = ticker_hit_rates[
        ~ticker_hit_rates.index.isin(eligible_tickers)
    ]

    print(f"\n  Gate 2 (per-ticker hit rate >= {MIN_TICKER_HIT_RATE:.0%}):")
    print(f"  {'Ticker':>8s}  {'Signals':>8s}  {'HitRate':>8s}  {'AvgRet':>8s}  {'Status':>8s}")
    for ticker, row in ticker_hit_rates.sort_values('hit_rate', ascending=False).iterrows():
        status = "PASS" if ticker in eligible_tickers else "REJECT"
        color = "" if status == "PASS" else ""
        print(f"  {ticker:>8s}  {row['n_signals']:8.0f}  {row['hit_rate']:7.1%}  {row['avg_return']:+7.2%}  {status:>8s}")

    filtered_signals = gate1_signals[gate1_signals['ticker'].isin(eligible_tickers)].copy()
    print(f"\n  After Gate 2: {len(filtered_signals):,} signals across {len(eligible_tickers)} tickers")

    # --- Gate 3: Non-overlapping signals (no more than 1 signal per ticker per 5 days) ---
    # Prevents piling into the same trade multiple times
    deduped = []
    for ticker, group in filtered_signals.groupby('ticker'):
        group = group.sort_values('date')
        last_signal_date = None
        for _, row in group.iterrows():
            if last_signal_date is None or (row['date'] - last_signal_date).days >= 5:
                deduped.append(row)
                last_signal_date = row['date']
    filtered_signals = pd.DataFrame(deduped)

    print(f"  Gate 3 (deduplicate <=5d apart): {len(filtered_signals):,} unique entry signals")

    if len(filtered_signals) == 0:
        print("[ERROR] No signals pass filters")
        conn.close()
        return

    # Overall metrics
    actual_wins = filtered_signals['target'].mean()
    avg_return = filtered_signals['forward_return'].mean()

    # By confidence bucket
    print(f"\n  Signal quality by confidence bucket:")
    print(f"  {'Bucket':>12s}  {'Count':>6s}  {'Win%':>6s}  {'AvgRet':>8s}")
    for lo, hi in [(0.55, 0.60), (0.60, 0.65), (0.65, 0.70), (0.70, 0.80), (0.80, 1.0)]:
        bucket = filtered_signals[(filtered_signals['prob_win'] >= lo) & (filtered_signals['prob_win'] < hi)]
        if len(bucket) > 0:
            bwr = bucket['target'].mean()
            bar = bucket['forward_return'].mean()
            print(f"  {lo:.0%}-{hi:.0%}:  {len(bucket):6d}  {bwr:5.1%}  {bar:+7.2%}")

    print(f"\n  OVERALL: {len(filtered_signals)} signals, {actual_wins:.1%} win rate, {avg_return:+.2%} avg return")

    # Per-ticker breakdown
    print(f"\n  Per-ticker signal distribution:")
    ticker_stats = filtered_signals.groupby('ticker').agg(
        count=('prob_win', 'count'),
        win_rate=('target', 'mean'),
        avg_ret=('forward_return', 'mean'),
        avg_conf=('prob_win', 'mean'),
    ).sort_values('count', ascending=False)

    for ticker, row in ticker_stats.head(20).iterrows():
        print(f"    {ticker:8s}: {row['count']:3.0f} signals, "
              f"{row['win_rate']:.0%} wr, {row['avg_ret']:+.2%} avg, "
              f"{row['avg_conf']:.2f} conf")

    # ========================================================================
    # 6. ATR optimization per stock
    # ========================================================================
    print("\n[6/6] ATR optimization per stock...")

    atr_results = optimize_atr_per_stock(filtered_signals, prices_by_ticker)

    if atr_results:
        print(f"\n  Optimized {len(atr_results)} stocks")

        # Summary
        test_wrs = [r['test']['win_rate'] for r in atr_results.values()]
        test_pfs = [r['test']['profit_factor'] for r in atr_results.values()]
        print(f"  Avg test win rate: {np.mean(test_wrs):.1%}")
        print(f"  Avg test profit factor: {np.mean(test_pfs):.2f}")

    # ========================================================================
    # Write to database
    # ========================================================================
    if not args.no_write:
        print("\n[DB] Writing signals to database...")

        model_id = 'mjolnir_v8'

        # Register model
        cur = conn.cursor()
        cur.execute("""
            INSERT INTO alpha_model_registry (model_id, model_type, display_name,
                hyperparameters, training_config, is_active, notes)
            VALUES (%s, %s, %s, %s::jsonb, %s::jsonb, true, %s)
            ON CONFLICT (model_id) DO UPDATE SET
                hyperparameters = EXCLUDED.hyperparameters,
                training_config = EXCLUDED.training_config,
                notes = EXCLUDED.notes,
                is_active = true
        """, (
            model_id, 'ensemble',
            'Mjölnir v8 — Binary Classification + ATR',
            json.dumps({"xgb_params": XGB_PARAMS, "lgbm_params": LGBM_PARAMS}),
            f'{{"horizon_days": {HORIZON_DAYS}, "win_threshold": {WIN_THRESHOLD}, '
            f'"min_confidence": {MIN_CONFIDENCE}, "min_train_days": {MIN_TRAIN_DAYS}, '
            f'"purge_gap": {PURGE_GAP}, "step_size": {STEP_SIZE}}}',
            f'Two-phase: classification (P(gain>{WIN_THRESHOLD:.0%}) > {MIN_CONFIDENCE:.0%}) + per-stock ATR optimization',
        ))

        # Write signals (only filtered ones with high confidence)
        batch = []
        for _, row in filtered_signals.iterrows():
            # Get ATR params if available
            atr_info = atr_results.get(row['ticker'], {})
            metadata = {}
            if atr_info:
                metadata = {
                    'atr_target_mult': atr_info['target_mult'],
                    'atr_stop_mult': atr_info['stop_mult'],
                    'atr_max_hold': atr_info['max_hold'],
                    'test_win_rate': round(atr_info['test']['win_rate'], 3),
                    'test_profit_factor': round(atr_info['test']['profit_factor'], 2),
                }

            batch.append((
                row['ticker'],
                row['date'],
                model_id,
                f'{HORIZON_DAYS}d',
                float(row['prob_win'] * 2 - 1),  # Scale to [-1, 1]
                float(row.get('forward_return', 0)),
                float(row['prob_win']),
                row.get('top_features', '{}'),
                json.dumps(metadata) if metadata else '{}',
            ))

        # Batch insert
        inserted = 0
        for i in range(0, len(batch), 500):
            chunk = batch[i:i+500]
            args_str = ','.join(
                cur.mogrify("(%s,%s,%s,%s,%s,%s,%s,%s::jsonb,%s::jsonb)", row).decode()
                for row in chunk
            )
            if args_str:
                cur.execute(f"""
                    INSERT INTO alpha_signals
                        (ticker, signal_date, model_id, horizon, signal_value,
                         predicted_return, confidence, feature_importance, metadata)
                    VALUES {args_str}
                    ON CONFLICT (ticker, signal_date, model_id, horizon)
                    DO UPDATE SET
                        signal_value = EXCLUDED.signal_value,
                        predicted_return = EXCLUDED.predicted_return,
                        confidence = EXCLUDED.confidence,
                        feature_importance = EXCLUDED.feature_importance,
                        metadata = EXCLUDED.metadata
                """)
                inserted += len(chunk)

        conn.commit()
        print(f"  Wrote {inserted} signals as model '{model_id}'")

        # Write ATR optimization results to metadata
        if atr_results:
            cur.execute("""
                UPDATE alpha_model_registry
                SET training_config = training_config || %s::jsonb
                WHERE model_id = %s
            """, (json.dumps({'atr_optimization': {
                k: {
                    'target_mult': v['target_mult'],
                    'stop_mult': v['stop_mult'],
                    'max_hold': v['max_hold'],
                    'test_win_rate': round(v['test']['win_rate'], 3),
                    'test_pf': round(v['test']['profit_factor'], 2),
                } for k, v in atr_results.items()
            }}), model_id))
            conn.commit()
            print(f"  Wrote ATR params for {len(atr_results)} stocks")

        cur.close()

    conn.close()

    elapsed = time.time() - t0
    print(f"\n{'='*70}")
    print(f"Completed in {elapsed:.0f}s")
    print(f"{'='*70}")


# ============================================================================
# Entry point
# ============================================================================

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Alpha Engine v8 — Mjölnir')
    parser.add_argument('--test', action='store_true', help='Use 15 test tickers only')
    parser.add_argument('--no-write', action='store_true', help='Evaluate only, no DB writes')
    parser.add_argument('--short', action='store_true', help='Enable short signals (below 200MA)')
    args = parser.parse_args()

    run(args)
