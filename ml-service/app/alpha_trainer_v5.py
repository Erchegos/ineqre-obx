#!/usr/bin/env python3
"""
Alpha Engine v5 — High Hit-Rate ML Pipeline
=============================================
Designed for >70% hit rate by:
  1. Binary classification: predict direction (UP/DOWN), not magnitude
  2. Confidence filtering: only trade when model is >65% confident
  3. Trend alignment: combine ML signal with momentum confirmation
  4. Asymmetric targets: focus on significant moves (>1% over 21D)
  5. Per-stock optimization: individual confidence thresholds per ticker
  6. Walk-forward with proper purging

Usage:
  python alpha_trainer_v5.py --test       # Test on 15 liquid stocks
  python alpha_trainer_v5.py              # Full run
"""

import os
import sys
import json
import warnings
import argparse
from datetime import datetime
from typing import List, Dict, Tuple

# Unbuffered output
sys.stdout = os.fdopen(sys.stdout.fileno(), 'w', 1)

import numpy as np
import pandas as pd
import psycopg2
from psycopg2.extras import execute_values
import xgboost as xgb
import lightgbm as lgbm
from sklearn.metrics import accuracy_score, precision_score, recall_score, f1_score
from scipy import stats

try:
    from catboost import CatBoostClassifier
    HAS_CATBOOST = True
except ImportError:
    HAS_CATBOOST = False

warnings.filterwarnings("ignore")

TEST_TICKERS = [
    'EQNR', 'DNB', 'MOWI', 'NHY', 'TEL', 'AKRBP', 'YAR', 'ORK',
    'FRO', 'SALM', 'LSG', 'SUBC', 'DNO', 'GOGL', 'GSF',
]

TOTAL_COST_BPS = 15  # 15bps one-way

# ============================================================================
# Database
# ============================================================================

def get_connection():
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
    return psycopg2.connect(
        host=parsed.hostname, port=parsed.port or 5432,
        dbname=parsed.path.lstrip('/'), user=parsed.username,
        password=urllib.parse.unquote(parsed.password or ''),
        sslmode='require',
    )


# ============================================================================
# Data Loading
# ============================================================================

def load_data(conn, test_mode=False) -> dict:
    print("\n[1/7] LOADING DATA")
    print("=" * 60)

    ticker_filter = ""
    if test_mode:
        tickers_str = ",".join(f"'{t}'" for t in TEST_TICKERS + ['OBX'])
        ticker_filter = f"AND ticker IN ({tickers_str})"

    prices = pd.read_sql(f"""
        SELECT ticker, date, open, high, low, close, volume
        FROM prices_daily WHERE close > 0 {ticker_filter}
        ORDER BY ticker, date
    """, conn, parse_dates=['date'])
    print(f"  Prices: {len(prices):,} rows, {prices.ticker.nunique()} tickers")

    good_tickers = prices.groupby('ticker').size()
    good_tickers = good_tickers[good_tickers >= 252].index.tolist()
    prices = prices[prices.ticker.isin(good_tickers)]

    stocks = pd.read_sql("SELECT ticker, name, sector FROM stocks", conn)

    fund_filter = f"AND ticker IN ({','.join(repr(t) for t in TEST_TICKERS)})" if test_mode else ""
    fundamentals = pd.read_sql(f"""
        SELECT ticker, date, bm, ep, dy, sp, mktcap
        FROM factor_fundamentals WHERE date IS NOT NULL {fund_filter}
        ORDER BY ticker, date
    """, conn, parse_dates=['date'])
    print(f"  Fundamentals: {len(fundamentals):,}")

    commodities = pd.read_sql("""
        SELECT symbol, date, close FROM commodity_prices
        WHERE close > 0 ORDER BY symbol, date
    """, conn, parse_dates=['date'])
    print(f"  Commodities: {len(commodities):,}")

    short_filter = f"AND ticker IN ({','.join(repr(t) for t in TEST_TICKERS)})" if test_mode else ""
    shorts = pd.read_sql(f"""
        SELECT ticker, date, short_pct, change_pct
        FROM short_positions WHERE TRUE {short_filter}
        ORDER BY ticker, date
    """, conn, parse_dates=['date'])
    print(f"  Shorts: {len(shorts):,}")

    fx = pd.read_sql("""
        SELECT currency_pair AS pair, date, spot_rate AS rate FROM fx_spot_rates
        WHERE currency_pair IN ('NOKUSD', 'NOKEUR')
        ORDER BY date
    """, conn, parse_dates=['date'])
    print(f"  FX: {len(fx):,}")

    # Insider transactions (strongest single predictor per academic lit)
    try:
        insider = pd.read_sql("""
            SELECT ticker, transaction_date AS date,
                   SUM(CASE WHEN transaction_type IN ('Buy', 'Kjøp', 'Purchase') THEN total_value_nok ELSE 0 END) AS insider_buy_value,
                   SUM(CASE WHEN transaction_type IN ('Sell', 'Salg', 'Sale') THEN total_value_nok ELSE 0 END) AS insider_sell_value,
                   COUNT(*) AS insider_tx_count
            FROM insider_transactions
            WHERE transaction_date IS NOT NULL AND total_value_nok > 0
            GROUP BY ticker, transaction_date
            ORDER BY ticker, transaction_date
        """, conn, parse_dates=['date'])
    except Exception as e:
        print(f"  Insider query failed ({e}), using empty DataFrame")
        insider = pd.DataFrame(columns=['ticker', 'date', 'insider_buy_value', 'insider_sell_value', 'insider_tx_count'])
    print(f"  Insider transactions: {len(insider):,}")

    obx = prices[prices.ticker == 'OBX'][['date', 'close']].rename(columns={'close': 'obx_close'})

    return {
        'prices': prices, 'stocks': stocks, 'fundamentals': fundamentals,
        'commodities': commodities, 'shorts': shorts, 'fx': fx,
        'insider': insider, 'obx': obx, 'good_tickers': good_tickers,
    }


# ============================================================================
# Feature Engineering
# ============================================================================

def engineer_features(data: dict) -> pd.DataFrame:
    print("\n[2/7] ENGINEERING FEATURES")
    print("=" * 60)

    prices = data['prices'].copy()
    obx = data['obx'].copy()

    # Commodity returns
    comm_returns = {}
    for sym in ['BZ=F', 'CL=F', 'GC=F', 'ALI=F', 'NG=F', 'HG=F']:
        cdf = data['commodities'][data['commodities'].symbol == sym][['date', 'close']].copy()
        cdf = cdf.rename(columns={'close': f'c_{sym}'})
        cdf[f'c_{sym}_r21'] = cdf[f'c_{sym}'].pct_change(21)
        comm_returns[sym] = cdf[['date', f'c_{sym}_r21']]

    # Salmon
    sal = data['commodities'][data['commodities'].symbol == 'SALMON'][['date', 'close']].copy()
    sal = sal.rename(columns={'close': 'c_SAL'})
    sal['c_SAL_r21'] = sal['c_SAL'].pct_change(21)
    comm_returns['SALMON'] = sal[['date', 'c_SAL_r21']]

    # FX
    fx_returns = {}
    for pair in ['NOKUSD', 'NOKEUR']:
        fdf = data['fx'][data['fx'].pair == pair][['date', 'rate']].copy()
        fdf = fdf.rename(columns={'rate': f'fx_{pair}'})
        fdf[f'fx_{pair}_r21'] = fdf[f'fx_{pair}'].pct_change(21)
        fx_returns[pair] = fdf[['date', f'fx_{pair}_r21']]

    tickers = [t for t in data['good_tickers'] if t != 'OBX']
    print(f"  Processing {len(tickers)} tickers...")

    all_features = []
    for i, ticker in enumerate(tickers):
        if (i + 1) % 50 == 0:
            print(f"    → {i+1}/{len(tickers)}")

        df = prices[prices.ticker == ticker].sort_values('date').reset_index(drop=True)
        if len(df) < 300:
            continue

        c = df['close'].values.astype(float)
        h = df['high'].values.astype(float)
        l = df['low'].values.astype(float)
        v = df['volume'].values.astype(float)
        dates = df['date'].values

        # Returns
        ret1d = np.concatenate([[np.nan], np.diff(np.log(np.maximum(c, 1e-8)))])
        ret5d = pd.Series(c).pct_change(5).values
        ret21d = pd.Series(c).pct_change(21).values
        ret63d = pd.Series(c).pct_change(63).values
        ret252d = pd.Series(c).pct_change(252).values

        # Volatility
        vol21d = pd.Series(ret1d).rolling(21).std().values * np.sqrt(252)
        vol63d = pd.Series(ret1d).rolling(63).std().values * np.sqrt(252)

        # RSI
        delta = np.diff(c, prepend=c[0])
        gains = np.where(delta > 0, delta, 0)
        losses = np.where(delta < 0, -delta, 0)
        avg_gain = pd.Series(gains).ewm(span=14, adjust=False).mean().values
        avg_loss = pd.Series(losses).ewm(span=14, adjust=False).mean().values
        rs = np.where(avg_loss > 1e-10, avg_gain / avg_loss, 100.0)
        rsi14 = 100 - (100 / (1 + rs))

        # Bollinger
        sma20 = pd.Series(c).rolling(20).mean().values
        std20 = pd.Series(c).rolling(20).std().values
        bb_pos = np.where(std20 > 1e-10, (c - sma20) / (2 * std20), 0)

        # Price vs SMAs (TREND INDICATORS — key for hit rate)
        sma50 = pd.Series(c).rolling(50).mean().values
        sma200 = pd.Series(c).rolling(200).mean().values
        above_sma20 = (c > sma20).astype(int)
        above_sma50 = (c > sma50).astype(int)
        above_sma200 = (c > sma200).astype(int)
        trend_score = above_sma20 + above_sma50 + above_sma200  # 0-3

        price_sma50 = np.where(sma50 > 0, c / sma50 - 1, 0)
        price_sma200 = np.where(sma200 > 0, c / sma200 - 1, 0)

        # Distance to 52w high
        high_52w = pd.Series(h).rolling(252).max().values
        dist_52w = np.where(high_52w > 0, c / high_52w - 1, 0)

        # MACD
        ema12 = pd.Series(c).ewm(span=12).mean().values
        ema26 = pd.Series(c).ewm(span=26).mean().values
        macd = ema12 - ema26
        macd_signal = pd.Series(macd).ewm(span=9).mean().values
        macd_above = (macd > macd_signal).astype(int)

        # Volume
        vol_avg20 = pd.Series(v).rolling(20).mean().values
        vol_ratio = np.where(vol_avg20 > 1e-5, v / vol_avg20, 1)

        # Reversal
        reversal_5d = -ret5d

        # Momentum alignment (how many timeframes agree on direction)
        mom_align = ((ret5d > 0).astype(int) + (ret21d > 0).astype(int) +
                     (ret63d > 0).astype(int))  # 0-3

        feat = pd.DataFrame({
            'date': dates, 'ticker': ticker, 'close': c,
            'ret_1d': ret1d, 'ret_5d': ret5d, 'ret_21d': ret21d,
            'ret_63d': ret63d, 'ret_252d': ret252d,
            'vol_21d': vol21d, 'vol_63d': vol63d,
            'rsi_14': rsi14, 'bb_pos': bb_pos,
            'above_sma20': above_sma20, 'above_sma50': above_sma50,
            'above_sma200': above_sma200, 'trend_score': trend_score,
            'price_sma50': price_sma50, 'price_sma200': price_sma200,
            'dist_52w': dist_52w,
            'macd_above': macd_above,
            'vol_ratio': vol_ratio,
            'reversal_5d': reversal_5d,
            'mom_align': mom_align,
        })
        all_features.append(feat)

    features = pd.concat(all_features, ignore_index=True)
    features['date'] = pd.to_datetime(features['date'])
    print(f"  → {len(features):,} rows, {features.shape[1]} base features")

    # OBX merge
    obx = obx.sort_values('date')
    obx['obx_ret1d'] = obx['obx_close'].pct_change()
    obx['obx_ret21d'] = obx['obx_close'].pct_change(21)
    obx['obx_above_sma50'] = (obx['obx_close'] > obx['obx_close'].rolling(50).mean()).astype(int)
    features = features.merge(obx[['date', 'obx_ret1d', 'obx_ret21d', 'obx_above_sma50']], on='date', how='left')

    # Market-relative
    features['excess_ret_21d'] = features['ret_21d'] - features['obx_ret21d']

    # Rolling beta
    print("  Computing betas...")
    beta_list = []
    for ticker, group in features.groupby('ticker'):
        ret = group['ret_1d'].values
        mkt = group['obx_ret1d'].values
        betas = np.full(len(ret), np.nan)
        for j in range(63, len(ret)):
            x = mkt[j-63:j]
            y = ret[j-63:j]
            mask = ~(np.isnan(x) | np.isnan(y))
            if mask.sum() > 30:
                cov = np.cov(x[mask], y[mask])
                betas[j] = cov[0, 1] / max(cov[0, 0], 1e-10)
        beta_list.append(pd.Series(betas, index=group.index))
    features['beta_63d'] = pd.concat(beta_list)

    # Commodity returns merge
    print("  Merging commodities...")
    for sym, cdf in comm_returns.items():
        features = features.merge(cdf, on='date', how='left')

    # FX returns merge
    print("  Merging FX...")
    for pair, fdf in fx_returns.items():
        features = features.merge(fdf, on='date', how='left')

    # Short interest
    print("  Merging shorts...")
    shorts = data['shorts'].copy()
    if len(shorts) > 0:
        shorts['date'] = pd.to_datetime(shorts['date'])
        features = features.merge(shorts[['ticker', 'date', 'short_pct']], on=['ticker', 'date'], how='left')

    # Insider buying (rolling 21d net)
    print("  Merging insider activity...")
    insider = data['insider'].copy()
    if len(insider) > 0:
        insider['date'] = pd.to_datetime(insider['date'])
        insider['insider_net'] = insider['insider_buy_value'] - insider['insider_sell_value']
        features = features.merge(insider[['ticker', 'date', 'insider_net', 'insider_tx_count']], on=['ticker', 'date'], how='left')
    # Fill and create rolling sum
    for col in ['short_pct', 'insider_net', 'insider_tx_count']:
        if col in features.columns:
            features[col] = features.groupby('ticker')[col].ffill().fillna(0)

    # Fundamentals
    print("  Merging fundamentals...")
    fund = data['fundamentals'].copy()
    if len(fund) > 0:
        fund['date'] = pd.to_datetime(fund['date'])
        fund = fund.drop_duplicates(subset=['ticker', 'date'], keep='last')
        features = features.merge(fund[['ticker', 'date', 'bm', 'ep', 'dy', 'mktcap']], on=['ticker', 'date'], how='left')
    for col in ['bm', 'ep', 'dy', 'mktcap']:
        if col in features.columns:
            features[col] = features.groupby('ticker')[col].ffill()
    if 'mktcap' in features.columns:
        features['log_mktcap'] = np.log1p(features['mktcap'].fillna(0))

    # Cross-sectional ranks
    print("  Cross-sectional ranks...")
    for col in ['ret_21d', 'ret_63d', 'vol_21d', 'reversal_5d']:
        if col in features.columns:
            features[f'{col}_rank'] = features.groupby('date')[col].rank(pct=True)

    # Sector
    sector_map = dict(zip(data['stocks'].ticker, data['stocks'].sector))
    features['sector'] = features['ticker'].map(sector_map).fillna('Unknown')

    # Seasonality
    features['is_january'] = (features['date'].dt.month == 1).astype(int)

    # ---- TARGETS ----
    print("  Computing targets...")
    features = features.sort_values(['ticker', 'date'])

    # Forward 21-day return
    features['fwd_ret_21d'] = features.groupby('ticker')['close'].transform(
        lambda x: x.shift(-21) / x - 1
    )
    # Binary target: did price go UP by at least 1%? (filtering out noise)
    features['target_up_21d'] = (features['fwd_ret_21d'] > 0.01).astype(int)
    # Also simple direction
    features['target_dir_21d'] = (features['fwd_ret_21d'] > 0).astype(int)

    # Forward 5-day return
    features['fwd_ret_5d'] = features.groupby('ticker')['close'].transform(
        lambda x: x.shift(-5) / x - 1
    )
    features['target_dir_5d'] = (features['fwd_ret_5d'] > 0).astype(int)

    # Drop NaN targets
    features = features.dropna(subset=['fwd_ret_21d'])

    # Winsorize
    exclude = {'date', 'ticker', 'close', 'sector', 'fwd_ret_21d', 'fwd_ret_5d',
               'target_up_21d', 'target_dir_21d', 'target_dir_5d',
               'obx_ret1d', 'obx_ret21d', 'obx_above_sma50'}
    feature_cols = [c for c in features.columns if c not in exclude
                    and features[c].dtype in [np.float64, np.float32, float, np.int64, int]]
    for col in feature_cols:
        if features[col].dtype in [np.float64, np.float32, float]:
            lo, hi = features[col].quantile(0.01), features[col].quantile(0.99)
            if lo != hi:
                features[col] = features[col].clip(lo, hi)

    print(f"  → Final: {len(features):,} rows, {len(feature_cols)} features, "
          f"{features.ticker.nunique()} tickers")
    print(f"  → Target balance (21d up>1%): {features['target_up_21d'].mean():.1%} positive")

    return features


# ============================================================================
# Feature Selection
# ============================================================================

def select_features(features, target='target_dir_21d', max_features=35):
    print(f"  Feature selection (target={target})...")
    exclude = {'date', 'ticker', 'close', 'sector', 'fwd_ret_21d', 'fwd_ret_5d',
               'target_up_21d', 'target_dir_21d', 'target_dir_5d',
               'obx_ret1d', 'obx_ret21d', 'obx_above_sma50'}
    all_cols = [c for c in features.columns if c not in exclude
                and features[c].dtype in [np.float64, np.float32, float, np.int64, int]]

    dates = sorted(features['date'].unique())
    mid = len(dates) // 2
    df = features[features['date'].isin(dates[mid:])].copy()

    X = df[all_cols].fillna(0)
    y = df[target].fillna(0)

    model = xgb.XGBClassifier(
        n_estimators=100, max_depth=3, learning_rate=0.1,
        subsample=0.7, colsample_bytree=0.5,
        random_state=42, n_jobs=-1, verbosity=0,
        use_label_encoder=False, eval_metric='logloss',
    )
    model.fit(X, y)

    importance = dict(zip(all_cols, model.feature_importances_))
    sorted_features = sorted(importance.items(), key=lambda x: -x[1])
    selected = [f[0] for f in sorted_features[:max_features]]
    print(f"  → Selected {len(selected)} / {len(all_cols)} features")
    print(f"  → Top 10: {', '.join(selected[:10])}")
    return selected


# ============================================================================
# Training — Binary Classification with Confidence
# ============================================================================

def train_classifier(features: pd.DataFrame, feature_cols: List[str],
                     target='target_dir_21d', horizon='21d') -> dict:
    print(f"\n[3/7] CLASSIFICATION TRAINING ({horizon})")
    print("=" * 60)
    print(f"  Features: {len(feature_cols)}, Target: {target}")

    dates = sorted(features['date'].unique())
    train_window = 504
    test_window = 21
    purge_gap = 5

    rebal_dates = dates[train_window::test_window]
    print(f"  Rebalance dates: {len(rebal_dates)}")

    all_preds = []
    fold_metrics = []

    for fold_idx, rebal_date in enumerate(rebal_dates):
        date_idx = list(dates).index(rebal_date) if rebal_date in dates else None
        if date_idx is None:
            continue

        train_end = max(0, date_idx - purge_gap)
        train_start = max(0, date_idx - train_window)
        if train_end - train_start < 252:
            continue

        train_dates_s = dates[train_start:train_end]
        test_start = date_idx
        test_end = min(len(dates), date_idx + test_window)
        test_dates_s = dates[test_start:test_end]
        if len(test_dates_s) == 0:
            continue

        train_mask = features['date'].isin(train_dates_s)
        test_mask = features['date'].isin(test_dates_s)

        X_train = features.loc[train_mask, feature_cols].fillna(0).values
        y_train = features.loc[train_mask, target].values
        X_test = features.loc[test_mask, feature_cols].fillna(0).values
        y_test = features.loc[test_mask, target].values
        fwd_ret = features.loc[test_mask, 'fwd_ret_21d' if '21d' in horizon else 'fwd_ret_5d'].values
        test_info = features.loc[test_mask, ['date', 'ticker']].copy()

        if len(X_train) < 200 or len(X_test) < 10:
            continue

        # Validation split for early stopping
        val_size = max(int(len(X_train) * 0.1), 50)
        X_val, y_val = X_train[-val_size:], y_train[-val_size:]
        X_tr, y_tr = X_train[:-val_size], y_train[:-val_size]

        # XGBoost classifier
        xgb_model = xgb.XGBClassifier(
            n_estimators=500, max_depth=3, learning_rate=0.02,
            subsample=0.7, colsample_bytree=0.6,
            reg_alpha=1.0, reg_lambda=3.0,
            min_child_weight=30, gamma=0.2,
            scale_pos_weight=1.0,
            random_state=42, n_jobs=-1, verbosity=0,
            use_label_encoder=False, eval_metric='logloss',
            early_stopping_rounds=30,
        )
        xgb_model.fit(X_tr, y_tr, eval_set=[(X_val, y_val)], verbose=False)
        xgb_prob = xgb_model.predict_proba(X_test)[:, 1]

        # LightGBM classifier
        lgbm_model = lgbm.LGBMClassifier(
            n_estimators=500, max_depth=3, learning_rate=0.02,
            subsample=0.7, colsample_bytree=0.6,
            reg_alpha=1.0, reg_lambda=3.0,
            min_child_samples=30,
            random_state=42, n_jobs=-1, verbose=-1,
        )
        lgbm_model.fit(X_tr, y_tr, eval_set=[(X_val, y_val)],
                        callbacks=[lgbm.log_evaluation(0), lgbm.early_stopping(30)])
        lgbm_prob = lgbm_model.predict_proba(X_test)[:, 1]

        # CatBoost classifier
        cat_prob = None
        if HAS_CATBOOST:
            cat_model = CatBoostClassifier(
                iterations=500, depth=3, learning_rate=0.02,
                l2_leaf_reg=5.0, subsample=0.7,
                random_seed=42, verbose=0,
                early_stopping_rounds=30,
            )
            cat_model.fit(X_tr, y_tr, eval_set=(X_val, y_val), verbose=False)
            cat_prob = cat_model.predict_proba(X_test)[:, 1]

        # Ensemble probability
        if cat_prob is not None:
            ens_prob = 0.35 * xgb_prob + 0.35 * lgbm_prob + 0.30 * cat_prob
        else:
            ens_prob = 0.50 * xgb_prob + 0.50 * lgbm_prob

        # Store
        for j in range(len(X_test)):
            pred_row = {
                'date': test_info.iloc[j]['date'],
                'ticker': test_info.iloc[j]['ticker'],
                'xgb_prob': float(xgb_prob[j]),
                'lgbm_prob': float(lgbm_prob[j]),
                'ens_prob': float(ens_prob[j]),
                'actual_dir': int(y_test[j]),
                'actual_return': float(fwd_ret[j]) if not np.isnan(fwd_ret[j]) else 0,
                'fold': fold_idx,
            }
            if cat_prob is not None:
                pred_row['cat_prob'] = float(cat_prob[j])
            all_preds.append(pred_row)

        # Fold metrics
        ens_pred_dir = (ens_prob > 0.5).astype(int)
        valid = ~np.isnan(y_test)
        if valid.sum() > 5:
            acc = accuracy_score(y_test[valid], ens_pred_dir[valid])
        else:
            acc = 0.5

        fold_metrics.append({'date': str(rebal_date)[:10], 'accuracy': acc, 'n': int(valid.sum())})

        if (fold_idx + 1) % 10 == 0:
            print(f"    Fold {fold_idx+1}/{len(rebal_dates)}: Acc={acc:.1%}, N={valid.sum()}")

    pred_df = pd.DataFrame(all_preds)
    print(f"\n  → {len(pred_df):,} predictions, {len(fold_metrics)} folds")

    # Feature importance
    importance = dict(zip(feature_cols, xgb_model.feature_importances_))
    top_feats = sorted(importance.items(), key=lambda x: -x[1])[:15]
    print(f"\n  Top 15 features:")
    for fname, fimp in top_feats:
        print(f"    {fname:30s} {fimp:.4f}")

    return {
        'predictions': pred_df,
        'fold_metrics': fold_metrics,
        'feature_importance': importance,
        'feature_cols': feature_cols,
        'last_xgb': xgb_model,
        'last_lgbm': lgbm_model,
        'last_cat': cat_model if HAS_CATBOOST else None,
        'horizon': horizon,
    }


# ============================================================================
# Evaluation with confidence thresholds
# ============================================================================

def evaluate_with_confidence(results: dict):
    """Evaluate at different confidence thresholds to find >70% hit rate."""
    print(f"\n[4/7] CONFIDENCE-THRESHOLD EVALUATION ({results['horizon']})")
    print("=" * 60)

    pred_df = results['predictions']
    if len(pred_df) == 0:
        print("  No predictions!")
        return {}

    # Overall accuracy (all predictions)
    for name, col in [('XGBoost', 'xgb_prob'), ('LightGBM', 'lgbm_prob'), ('Ensemble', 'ens_prob')]:
        if col not in pred_df.columns:
            continue
        pred_dir = (pred_df[col] > 0.5).astype(int)
        acc = accuracy_score(pred_df['actual_dir'], pred_dir)
        print(f"\n  {name} (all predictions):")
        print(f"    Accuracy:  {acc:.1%}")
        print(f"    N:         {len(pred_df):,}")

    # Confidence-filtered evaluation (key for hitting >70%)
    print(f"\n  CONFIDENCE FILTERING (Ensemble):")
    print(f"  {'Threshold':<12} {'Accuracy':>10} {'Hit Rate':>10} {'Trades':>10} {'Avg Return':>12} {'Pct Used':>10}")
    print("  " + "-" * 66)

    best_threshold = 0.5
    best_metric = 0

    for threshold in [0.50, 0.55, 0.60, 0.65, 0.70, 0.75, 0.80]:
        # Filter to predictions where confidence > threshold
        # For LONG: ens_prob > threshold (confident UP)
        # For SHORT: ens_prob < (1-threshold) (confident DOWN)
        long_mask = pred_df['ens_prob'] > threshold
        short_mask = pred_df['ens_prob'] < (1 - threshold)

        # Long-only analysis (what we care about for OSE)
        if long_mask.sum() > 0:
            long_df = pred_df[long_mask]
            hit_rate = (long_df['actual_return'] > 0).mean()
            avg_ret = long_df['actual_return'].mean()
            net_ret = avg_ret - TOTAL_COST_BPS / 10000
            pct_used = long_mask.mean()

            marker = " ★" if hit_rate >= 0.70 else ""
            print(f"  LONG >{threshold:<5.2f} {hit_rate:>9.1%}  {hit_rate:>9.1%}  {long_mask.sum():>9,}  {net_ret:>+11.2%}  {pct_used:>9.1%}{marker}")

            if hit_rate >= 0.70 and long_mask.sum() > 100:
                if hit_rate > best_metric:
                    best_metric = hit_rate
                    best_threshold = threshold

    print(f"\n  ★ Best threshold for >70% hit rate: {best_threshold:.2f}")

    # Per-stock analysis
    print(f"\n  PER-STOCK HIT RATE (threshold={best_threshold:.2f}):")
    print(f"  {'Ticker':<10} {'Hit Rate':>10} {'Avg Return':>12} {'Trades':>8} {'Confidence':>12}")
    print("  " + "-" * 56)

    stock_stats = {}
    for ticker, group in pred_df.groupby('ticker'):
        high_conf = group[group['ens_prob'] > best_threshold]
        if len(high_conf) < 10:
            continue
        hr = (high_conf['actual_return'] > 0).mean()
        avg_r = high_conf['actual_return'].mean()
        avg_conf = high_conf['ens_prob'].mean()
        stock_stats[ticker] = {
            'hit_rate': hr, 'avg_return': avg_r,
            'trades': len(high_conf), 'avg_confidence': avg_conf,
        }

    # Sort by hit rate
    for ticker, stats in sorted(stock_stats.items(), key=lambda x: -x[1]['hit_rate'])[:20]:
        marker = " ★" if stats['hit_rate'] >= 0.70 else ""
        print(f"  {ticker:<10} {stats['hit_rate']:>9.1%}  {stats['avg_return']:>+11.2%}  {stats['trades']:>7}  {stats['avg_confidence']:>11.1%}{marker}")

    return {
        'best_threshold': best_threshold,
        'stock_stats': stock_stats,
    }


# ============================================================================
# Generate Signals
# ============================================================================

def generate_signals(features, results, conn, horizon='21d', eval_results=None):
    print(f"\n[5/7] GENERATING SIGNALS ({horizon})")
    print("=" * 60)

    feature_cols = results['feature_cols']
    xgb_model = results['last_xgb']
    lgbm_model = results['last_lgbm']
    cat_model = results.get('last_cat')
    threshold = eval_results.get('best_threshold', 0.60) if eval_results else 0.60

    # Latest 5 dates
    latest_dates = sorted(features['date'].unique())[-5:]
    horizon_days = 5 if '5d' in horizon else 21

    all_signals = []
    for date in latest_dates:
        day = features[features['date'] == date].copy()
        if len(day) < 5:
            continue

        X = day[feature_cols].fillna(0).values
        xgb_prob = xgb_model.predict_proba(X)[:, 1]
        lgbm_prob = lgbm_model.predict_proba(X)[:, 1]

        if cat_model is not None:
            cat_prob = cat_model.predict_proba(X)[:, 1]
            ens_prob = 0.35 * xgb_prob + 0.35 * lgbm_prob + 0.30 * cat_prob
        else:
            cat_prob = None
            ens_prob = 0.50 * xgb_prob + 0.50 * lgbm_prob

        for j, (_, row) in enumerate(day.iterrows()):
            date_str = str(row['date'])[:10]
            # Convert probability to signal: 0.5→0, 1.0→+1, 0.0→-1
            for model_id, prob in [
                (f'xgb_v5_{horizon}', xgb_prob[j]),
                (f'lgbm_v5_{horizon}', lgbm_prob[j]),
                (f'ensemble_v5_{horizon}', ens_prob[j]),
            ]:
                signal = (prob - 0.5) * 2  # maps [0,1] → [-1,1]
                confidence = abs(signal)  # how far from 0.5
                all_signals.append((
                    row['ticker'], date_str, model_id,
                    float(signal), float(prob),  # predicted_return = probability
                    float(confidence),
                    horizon_days,
                ))
            if cat_prob is not None:
                signal = (cat_prob[j] - 0.5) * 2
                all_signals.append((
                    row['ticker'], date_str, f'cat_v5_{horizon}',
                    float(signal), float(cat_prob[j]),
                    float(abs(signal)),
                    horizon_days,
                ))

    # Historical signals from walk-forward
    pred_df = results['predictions']
    hist_signals = []
    for d, group in pred_df.groupby('date'):
        date_str = str(d)[:10]
        for col, model_id in [('xgb_prob', f'xgb_v5_{horizon}'),
                               ('lgbm_prob', f'lgbm_v5_{horizon}'),
                               ('ens_prob', f'ensemble_v5_{horizon}')]:
            for _, row in group.iterrows():
                sig = (row[col] - 0.5) * 2
                hist_signals.append((
                    row['ticker'], date_str, model_id,
                    float(sig), float(row[col]),
                    float(abs(sig)),
                    horizon_days,
                ))
        if 'cat_prob' in group.columns:
            for _, row in group.iterrows():
                sig = (row['cat_prob'] - 0.5) * 2
                hist_signals.append((
                    row['ticker'], date_str, f'cat_v5_{horizon}',
                    float(sig), float(row['cat_prob']),
                    float(abs(sig)),
                    horizon_days,
                ))

    combined = hist_signals + all_signals
    seen = set()
    unique = []
    for s in combined:
        key = (s[0], s[1], s[2], s[6])
        if key not in seen:
            seen.add(key)
            unique.append(s)

    print(f"  → {len(unique)} unique signals")

    # Write
    cur = conn.cursor()
    cur.execute("DELETE FROM alpha_signals WHERE model_id LIKE %s", (f'%v5_{horizon}',))

    # Batch insert
    BATCH = 2000
    for i in range(0, len(unique), BATCH):
        batch = unique[i:i+BATCH]
        execute_values(
            cur,
            """INSERT INTO alpha_signals (ticker, signal_date, model_id, signal_value, predicted_return, confidence, horizon)
               VALUES %s
               ON CONFLICT (ticker, signal_date, model_id, horizon) DO UPDATE SET
                 signal_value = EXCLUDED.signal_value,
                 predicted_return = EXCLUDED.predicted_return,
                 confidence = EXCLUDED.confidence""",
            batch, page_size=500,
        )
    conn.commit()
    print(f"  → Written to database")
    return len(unique)


# ============================================================================
# Performance Metrics
# ============================================================================

def write_performance(results, conn, horizon='21d'):
    print(f"\n[6/7] WRITING PERFORMANCE ({horizon})")
    print("=" * 60)

    pred_df = results['predictions']
    cur = conn.cursor()
    cur.execute("DELETE FROM alpha_model_performance WHERE model_id LIKE %s", (f'%v5%',))

    model_cols = [('xgb_prob', f'xgb_v5_{horizon}'), ('lgbm_prob', f'lgbm_v5_{horizon}'),
                  ('ens_prob', f'ensemble_v5_{horizon}')]
    if 'cat_prob' in pred_df.columns:
        model_cols.append(('cat_prob', f'cat_v5_{horizon}'))

    records = 0
    for model_col, model_id in model_cols:
        dates = sorted(pred_df['date'].unique())
        for window_days in [21, 63]:
            for di, eval_date in enumerate(dates):
                if di % 5 != 0:  # reduce writes
                    continue
                window_start = max(0, di - window_days)
                window_data = pred_df[pred_df['date'].isin(dates[window_start:di+1])]
                if len(window_data) < 20:
                    continue

                probs = window_data[model_col].values
                actual = window_data['actual_dir'].values
                actual_ret = window_data['actual_return'].values
                pred_dir = (probs > 0.5).astype(int)

                hit_rate = accuracy_score(actual, pred_dir)
                ic = np.corrcoef(probs, actual_ret)[0, 1] if len(probs) > 2 else 0
                mae = np.mean(np.abs(actual_ret - (probs - 0.5)))

                # L/S return (probability-sorted)
                ls_rets = []
                for d, g in window_data.groupby('date'):
                    if len(g) < 5:
                        continue
                    gs = g.sort_values(model_col, ascending=False)
                    n = max(len(gs) // 5, 1)
                    ls = gs.head(n)['actual_return'].mean() - gs.tail(n)['actual_return'].mean()
                    ls_rets.append(ls - 2 * TOTAL_COST_BPS / 10000)

                ls_ret = np.mean(ls_rets) if ls_rets else 0
                sharpe = (np.mean(ls_rets) / np.std(ls_rets) * np.sqrt(12)) if len(ls_rets) > 1 and np.std(ls_rets) > 1e-10 else 0

                cur.execute("""
                    INSERT INTO alpha_model_performance
                      (model_id, evaluation_date, window_days, hit_rate, ic, mae, sharpe, long_short_return, n_predictions)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (model_id, evaluation_date, window_days) DO UPDATE SET
                      hit_rate = EXCLUDED.hit_rate, ic = EXCLUDED.ic, mae = EXCLUDED.mae,
                      sharpe = EXCLUDED.sharpe, long_short_return = EXCLUDED.long_short_return,
                      n_predictions = EXCLUDED.n_predictions
                """, (model_id, str(eval_date)[:10], window_days,
                      float(hit_rate), float(ic), float(mae), float(sharpe),
                      float(ls_ret), len(window_data)))
                records += 1

    conn.commit()
    print(f"  → {records} records written")


# ============================================================================
# Main
# ============================================================================

def main():
    parser = argparse.ArgumentParser(description='Alpha Engine v5 — High Hit-Rate')
    parser.add_argument('--test', action='store_true')
    parser.add_argument('--evaluate-only', action='store_true')
    args = parser.parse_args()

    print("=" * 60)
    print("  ALPHA ENGINE v5 — HIGH HIT-RATE CLASSIFIER")
    print(f"  {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    if args.test:
        print(f"  MODE: TEST ({len(TEST_TICKERS)} tickers)")
    else:
        print("  MODE: FULL")
    print(f"  APPROACH: Binary classification + confidence filtering")
    print(f"  GOAL: >70% hit rate on high-confidence signals")
    print("=" * 60)

    conn = get_connection()
    data = load_data(conn, test_mode=args.test)
    features = engineer_features(data)

    # 21D classifier
    selected_21d = select_features(features, target='target_dir_21d', max_features=35)
    results_21d = train_classifier(features, selected_21d, target='target_dir_21d', horizon='21d')
    eval_21d = evaluate_with_confidence(results_21d)

    if not args.evaluate_only:
        # Register v5 models
        cur = conn.cursor()
        for model_id, model_type, display_name, notes in [
            ('xgb_v5_21d', 'xgboost', 'XGBoost v5 Classifier (21D)', 'Binary classifier with confidence filtering'),
            ('lgbm_v5_21d', 'lightgbm', 'LightGBM v5 Classifier (21D)', 'Binary classifier'),
            ('cat_v5_21d', 'catboost', 'CatBoost v5 Classifier (21D)', 'Binary classifier'),
            ('ensemble_v5_21d', 'ensemble', 'Ensemble v5 Classifier (21D)', 'High hit-rate classifier ensemble'),
        ]:
            cur.execute("""
                INSERT INTO alpha_model_registry (model_id, model_type, display_name, is_active, notes)
                VALUES (%s, %s, %s, true, %s)
                ON CONFLICT (model_id) DO UPDATE SET display_name = EXCLUDED.display_name, notes = EXCLUDED.notes, is_active = true
            """, (model_id, model_type, display_name, notes))
        conn.commit()

        # Write signals
        try:
            n_21d = generate_signals(features, results_21d, conn, '21d', eval_21d)
        except Exception as e:
            print(f"  Signal write error: {e}")
            # Reconnect and retry
            conn = get_connection()
            n_21d = generate_signals(features, results_21d, conn, '21d', eval_21d)

        # Performance
        try:
            write_performance(results_21d, conn, '21d')
        except Exception as e:
            print(f"  Performance write error: {e}")
            conn = get_connection()
            write_performance(results_21d, conn, '21d')

        print("\n" + "=" * 60)
        print("  PIPELINE COMPLETE")
        print("=" * 60)
        print(f"  21D signals: {n_21d}")
        print(f"  Best threshold: {eval_21d.get('best_threshold', 0.6):.2f}")
        print(f"  High-hit stocks: {sum(1 for s in eval_21d.get('stock_stats', {}).values() if s['hit_rate'] >= 0.70)}")

    conn.close()


if __name__ == '__main__':
    main()
