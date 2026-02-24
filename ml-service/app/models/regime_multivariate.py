"""
Multivariate HMM regime detection for portfolio-level analysis.

3-state model (Bull / Neutral / Crisis) fitted on multivariate features:
- Cross-sectional average returns (5-day rolling)
- Realized volatility (20-day Yang-Zhang proxy)
- Average pairwise rolling correlation (60-day)

Each feature is computed from the full portfolio, giving a market-regime
classification rather than single-stock regime.
"""

import warnings
import numpy as np
from typing import Optional, List
from hmmlearn.hmm import GaussianHMM


def _rolling_vol(returns: np.ndarray, window: int = 20) -> np.ndarray:
    """Compute rolling annualized volatility (simple std proxy)."""
    n = len(returns)
    vol = np.full(n, np.nan)
    for i in range(window, n):
        vol[i] = np.std(returns[i - window:i], ddof=1) * np.sqrt(252)
    return vol


def _rolling_mean(arr: np.ndarray, window: int) -> np.ndarray:
    """Simple rolling mean."""
    n = len(arr)
    out = np.full(n, np.nan)
    for i in range(window, n):
        out[i] = np.mean(arr[i - window:i])
    return out


def _rolling_correlation(ret_a: np.ndarray, ret_b: np.ndarray, window: int = 60) -> np.ndarray:
    """Rolling Pearson correlation between two return series."""
    n = len(ret_a)
    corr = np.full(n, np.nan)
    for i in range(window, n):
        a = ret_a[i - window:i]
        b = ret_b[i - window:i]
        std_a = np.std(a, ddof=1)
        std_b = np.std(b, ddof=1)
        if std_a > 1e-10 and std_b > 1e-10:
            corr[i] = np.corrcoef(a, b)[0, 1]
        else:
            corr[i] = 0.0
    return corr


def _avg_pairwise_correlation(returns_matrix: np.ndarray, window: int = 60) -> np.ndarray:
    """Average pairwise rolling correlation across all assets."""
    n_obs, n_assets = returns_matrix.shape
    if n_assets < 2:
        return _rolling_vol(returns_matrix[:, 0], window=window) * 0  # zeros

    avg_corr = np.full(n_obs, np.nan)
    for i in range(window, n_obs):
        block = returns_matrix[i - window:i]
        corr_matrix = np.corrcoef(block.T)
        # Extract upper triangle (exclude diagonal)
        mask = np.triu(np.ones_like(corr_matrix, dtype=bool), k=1)
        pairwise = corr_matrix[mask]
        avg_corr[i] = np.nanmean(pairwise) if len(pairwise) > 0 else 0.0

    return avg_corr


def fit_multivariate_regime(
    returns_matrix: np.ndarray,
    benchmark_returns: Optional[np.ndarray] = None,
    tickers: Optional[List[str]] = None,
    dates: Optional[List[str]] = None,
    n_states: int = 3,
    n_iter: int = 300,
) -> dict:
    """
    Fit 3-state multivariate HMM on portfolio-level features.

    Parameters
    ----------
    returns_matrix : np.ndarray
        Shape (T, N) — daily log returns for N portfolio assets.
    benchmark_returns : np.ndarray, optional
        Shape (T,) — benchmark (OBX) returns for correlation feature.
        If None, uses cross-sectional average as proxy.
    tickers : list[str], optional
        Ticker names for labelling.
    dates : list[str], optional
        Date strings for output alignment.
    n_states : int
        Number of hidden states (default 3: Bull/Neutral/Crisis).
    n_iter : int
        Max EM iterations.

    Returns
    -------
    dict with keys:
        current_state, state_probs, transition_matrix, state_stats,
        regime_history (last 252 days), state_labels, bic,
        regime_conditional_returns (per-state expected annualized returns)
    """
    n_obs, n_assets = returns_matrix.shape

    # Feature 1: Cross-sectional average return (5-day rolling)
    avg_returns = np.mean(returns_matrix, axis=1)
    feat_ret = _rolling_mean(avg_returns, window=5)

    # Feature 2: Portfolio realized vol (20-day)
    feat_vol = _rolling_vol(avg_returns, window=20)

    # Feature 3: Average pairwise correlation (60-day)
    if n_assets >= 2:
        feat_corr = _avg_pairwise_correlation(returns_matrix, window=60)
    elif benchmark_returns is not None:
        feat_corr = _rolling_correlation(avg_returns, benchmark_returns, window=60)
    else:
        feat_corr = np.zeros(n_obs)

    # Stack features and drop NaN rows
    features = np.column_stack([feat_ret, feat_vol, feat_corr])
    valid_mask = ~np.any(np.isnan(features), axis=1)
    valid_idx = np.where(valid_mask)[0]

    if len(valid_idx) < 100:
        raise ValueError(f"Insufficient valid observations: {len(valid_idx)} (need >= 100)")

    X = features[valid_idx]

    # Standardize features for HMM (improves convergence)
    feat_mean = X.mean(axis=0)
    feat_std = X.std(axis=0)
    feat_std[feat_std < 1e-10] = 1.0
    X_scaled = (X - feat_mean) / feat_std

    # Fit HMM
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        model = GaussianHMM(
            n_components=n_states,
            covariance_type="full",
            n_iter=n_iter,
            random_state=42,
            tol=1e-5,
        )
        model.fit(X_scaled)

    # Decode states
    states = model.predict(X_scaled)
    state_probs = model.predict_proba(X_scaled)

    # Classify states by their mean return feature (ascending):
    # Lowest return mean = Crisis (0), Mid = Neutral (1), Highest = Bull (2)
    state_return_means = []
    for s in range(n_states):
        mask = states == s
        if np.any(mask):
            state_return_means.append(np.mean(X[mask, 0]))  # mean of return feature
        else:
            state_return_means.append(0)

    sort_idx = np.argsort(state_return_means)  # ascending: crisis, neutral, bull
    remap = {old: new for new, old in enumerate(sort_idx)}
    states_sorted = np.array([remap[s] for s in states])
    probs_sorted = state_probs[:, sort_idx]

    # Reorder transition matrix
    trans = model.transmat_[sort_idx][:, sort_idx]

    # State labels
    state_labels = _get_state_labels(n_states)

    # State statistics — computed from ORIGINAL returns (not features)
    state_stats = []
    for i in range(n_states):
        orig_idx = sort_idx[i]
        mask = states == orig_idx
        state_indices = valid_idx[mask]

        # Average return across all assets in this regime
        regime_returns = avg_returns[state_indices]
        expected_duration = 1.0 / (1.0 - trans[i, i]) if trans[i, i] < 1 else float('inf')

        # Per-asset expected returns in this regime
        per_asset_returns = {}
        if tickers is not None:
            for j, ticker in enumerate(tickers):
                asset_rets = returns_matrix[state_indices, j]
                per_asset_returns[ticker] = float(np.mean(asset_rets) * 252) if len(asset_rets) > 0 else 0

        # Vol in this regime
        regime_vol = float(np.std(regime_returns) * np.sqrt(252)) if len(regime_returns) > 5 else 0
        regime_avg_corr = float(np.nanmean(feat_corr[state_indices])) if len(state_indices) > 0 else 0

        state_stats.append({
            "label": state_labels[i],
            "mean_return": float(np.mean(regime_returns) * 252) if len(regime_returns) > 0 else 0,
            "annualized_vol": regime_vol,
            "avg_correlation": regime_avg_corr,
            "expected_duration_days": float(expected_duration),
            "frequency": float(np.sum(mask) / len(states)),
            "n_observations": int(np.sum(mask)),
            "per_asset_returns": per_asset_returns,
        })

    # Current state
    current_state = int(states_sorted[-1])
    current_probs = probs_sorted[-1].tolist()

    # BIC
    n_features = X.shape[1]
    n_params = (
        n_states * (n_states - 1)  # transition probs
        + n_states * n_features  # means
        + n_states * n_features * (n_features + 1) // 2  # covariance (full)
    )
    log_lik = float(model.score(X_scaled) * len(X_scaled))
    bic = -2 * log_lik + n_params * np.log(len(X_scaled))

    # Regime history (last 252 points for charting)
    history_len = min(252, len(states_sorted))
    regime_history = []
    for k in range(history_len):
        idx = len(states_sorted) - history_len + k
        entry = {
            "state": int(states_sorted[idx]),
            "label": state_labels[int(states_sorted[idx])],
            "probs": probs_sorted[idx].tolist(),
        }
        if dates is not None:
            date_idx = valid_idx[len(states_sorted) - history_len + k]
            if date_idx < len(dates):
                entry["date"] = dates[date_idx]
        regime_history.append(entry)

    # Regime-conditional expected returns for portfolio optimization
    regime_conditional_returns = {}
    for i in range(n_states):
        regime_conditional_returns[state_labels[i]] = state_stats[i]["per_asset_returns"]

    result = {
        "n_states": n_states,
        "current_state": current_state,
        "current_state_label": state_labels[current_state],
        "current_probs": current_probs,
        "state_labels": state_labels,
        "transition_matrix": trans.tolist(),
        "state_stats": state_stats,
        "regime_history": regime_history,
        "regime_conditional_returns": regime_conditional_returns,
        "bic": float(bic),
        "n_observations": len(X_scaled),
    }

    return result


def _get_state_labels(n: int) -> List[str]:
    if n == 3:
        return ["Crisis", "Neutral", "Bull"]
    elif n == 2:
        return ["Bear", "Bull"]
    else:
        return [f"State {i}" for i in range(n)]
