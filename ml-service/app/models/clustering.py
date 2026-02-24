"""
Spectral clustering on residual correlation matrices + OU mean-reversion z-scores.

1. Remove market factor (OBX beta) from returns to get residuals
2. Compute residual correlation matrix
3. Spectral clustering to group stocks by co-movement structure
4. Fit AR(1) / Ornstein-Uhlenbeck to each cluster spread for mean-reversion signals
"""

import numpy as np
from typing import Optional, List
from sklearn.cluster import SpectralClustering
from sklearn.metrics import silhouette_score


def _compute_residuals(returns_matrix: np.ndarray, benchmark_returns: np.ndarray) -> np.ndarray:
    """Remove market factor via OLS regression: residual = r_i - beta_i * r_m."""
    n_obs, n_assets = returns_matrix.shape
    residuals = np.zeros_like(returns_matrix)

    for j in range(n_assets):
        y = returns_matrix[:, j]
        x = benchmark_returns
        # OLS: beta = cov(y,x) / var(x)
        valid = ~(np.isnan(y) | np.isnan(x))
        if valid.sum() < 30:
            residuals[:, j] = y
            continue
        yv, xv = y[valid], x[valid]
        cov_xy = np.cov(yv, xv)[0, 1]
        var_x = np.var(xv, ddof=1)
        beta = cov_xy / var_x if var_x > 1e-12 else 0
        alpha = np.mean(yv) - beta * np.mean(xv)
        residuals[:, j] = y - alpha - beta * x

    return residuals


def _select_n_clusters(corr_matrix: np.ndarray, min_k: int = 3, max_k: int = 8) -> int:
    """Select optimal cluster count by silhouette score."""
    n = corr_matrix.shape[0]
    max_k = min(max_k, n - 1)
    if max_k < min_k:
        return min_k

    # Convert correlation to affinity (ensure non-negative)
    affinity = (corr_matrix + 1) / 2  # map [-1,1] to [0,1]
    np.fill_diagonal(affinity, 1.0)

    best_k = min_k
    best_score = -1

    for k in range(min_k, max_k + 1):
        try:
            sc = SpectralClustering(
                n_clusters=k,
                affinity="precomputed",
                random_state=42,
                n_init=10,
            )
            labels = sc.fit_predict(affinity)
            if len(set(labels)) < 2:
                continue
            score = silhouette_score(1 - corr_matrix, labels, metric="precomputed")
            if score > best_score:
                best_score = score
                best_k = k
        except Exception:
            continue

    return best_k


def _fit_ou_process(spread: np.ndarray) -> dict:
    """
    Fit Ornstein-Uhlenbeck process via AR(1) on the spread.
    OU: dX = theta*(mu - X)*dt + sigma*dW
    Discrete: X_t = phi*X_{t-1} + (1-phi)*mu + eps
    """
    spread = spread[~np.isnan(spread)]
    if len(spread) < 30:
        return {"half_life": None, "z_score": 0, "mu": 0, "sigma": 0, "phi": 0}

    mu = np.mean(spread)
    centered = spread - mu

    # AR(1) coefficient
    x_lag = centered[:-1]
    x_now = centered[1:]
    var_lag = np.var(x_lag, ddof=1)
    phi = np.cov(x_now, x_lag)[0, 1] / var_lag if var_lag > 1e-12 else 0

    # Clamp phi to avoid log issues
    phi = max(min(phi, 0.9999), -0.9999)

    # Half-life in days
    half_life = -np.log(2) / np.log(abs(phi)) if abs(phi) > 0.001 else None

    # Residual std
    residual = x_now - phi * x_lag
    sigma = np.std(residual, ddof=1)

    # Current z-score
    z_score = (spread[-1] - mu) / sigma if sigma > 1e-10 else 0

    return {
        "half_life": float(half_life) if half_life is not None else None,
        "z_score": float(z_score),
        "mu": float(mu),
        "sigma": float(sigma),
        "phi": float(phi),
    }


def fit_spectral_clusters(
    returns_matrix: np.ndarray,
    benchmark_returns: Optional[np.ndarray] = None,
    tickers: Optional[List[str]] = None,
    n_clusters: Optional[int] = None,
) -> dict:
    """
    Spectral clustering on residual correlations + OU z-scores.

    Parameters
    ----------
    returns_matrix : np.ndarray
        Shape (T, N) — daily log returns for N assets.
    benchmark_returns : np.ndarray, optional
        Shape (T,) — benchmark returns. If None, uses equal-weight portfolio.
    tickers : list[str], optional
        Ticker names.
    n_clusters : int, optional
        Force cluster count. If None, auto-select via silhouette.

    Returns
    -------
    dict with keys:
        n_clusters, clusters (list of cluster info), assignments (ticker -> cluster_id),
        silhouette_score, residual_correlation (N x N matrix)
    """
    n_obs, n_assets = returns_matrix.shape
    if tickers is None:
        tickers = [f"Asset_{i}" for i in range(n_assets)]

    # Compute residuals
    if benchmark_returns is not None:
        residuals = _compute_residuals(returns_matrix, benchmark_returns)
    else:
        # Use equal-weight portfolio as proxy benchmark
        ew_returns = np.mean(returns_matrix, axis=1)
        residuals = _compute_residuals(returns_matrix, ew_returns)

    # Residual correlation matrix
    resid_corr = np.corrcoef(residuals.T)
    resid_corr = np.nan_to_num(resid_corr, nan=0)
    np.fill_diagonal(resid_corr, 1.0)

    # Select number of clusters
    if n_clusters is None:
        n_clusters = _select_n_clusters(resid_corr)

    # Fit spectral clustering
    affinity = (resid_corr + 1) / 2
    np.fill_diagonal(affinity, 1.0)

    sc = SpectralClustering(
        n_clusters=n_clusters,
        affinity="precomputed",
        random_state=42,
        n_init=10,
    )
    labels = sc.fit_predict(affinity)

    # Compute silhouette score
    sil_score = 0.0
    if len(set(labels)) >= 2:
        try:
            sil_score = float(silhouette_score(1 - resid_corr, labels, metric="precomputed"))
        except Exception:
            pass

    # Build cluster info + OU z-scores
    clusters = []
    for c in range(n_clusters):
        mask = labels == c
        cluster_tickers = [tickers[i] for i in range(n_assets) if mask[i]]
        cluster_indices = [i for i in range(n_assets) if mask[i]]

        if len(cluster_indices) == 0:
            continue

        # Cluster spread = equal-weight residual of cluster members
        cluster_spread = np.mean(residuals[:, cluster_indices], axis=1)
        ou_params = _fit_ou_process(cluster_spread)

        # Intra-cluster correlation
        if len(cluster_indices) >= 2:
            sub_corr = resid_corr[np.ix_(cluster_indices, cluster_indices)]
            mask_upper = np.triu(np.ones_like(sub_corr, dtype=bool), k=1)
            intra_corr = float(np.mean(sub_corr[mask_upper]))
        else:
            intra_corr = 1.0

        clusters.append({
            "id": int(c),
            "tickers": cluster_tickers,
            "n_members": len(cluster_tickers),
            "half_life": ou_params["half_life"],
            "z_score": ou_params["z_score"],
            "ou_mu": ou_params["mu"],
            "ou_sigma": ou_params["sigma"],
            "ou_phi": ou_params["phi"],
            "intra_cluster_correlation": intra_corr,
            "mean_reversion_signal": _classify_mr_signal(ou_params["z_score"]),
        })

    # Per-ticker assignments
    assignments = {}
    for i, ticker in enumerate(tickers):
        cluster_id = int(labels[i])
        cluster_info = next((c for c in clusters if c["id"] == cluster_id), None)
        assignments[ticker] = {
            "cluster_id": cluster_id,
            "z_score": cluster_info["z_score"] if cluster_info else 0,
            "half_life": cluster_info["half_life"] if cluster_info else None,
            "signal": cluster_info["mean_reversion_signal"] if cluster_info else "Neutral",
        }

    return {
        "n_clusters": n_clusters,
        "clusters": clusters,
        "assignments": assignments,
        "silhouette_score": sil_score,
        "residual_correlation": resid_corr.tolist(),
    }


def _classify_mr_signal(z_score: float) -> str:
    """Classify mean-reversion signal from z-score."""
    if z_score > 2.0:
        return "Strong Sell"  # Spread too high, expect reversion down
    elif z_score > 1.0:
        return "Sell"
    elif z_score < -2.0:
        return "Strong Buy"  # Spread too low, expect reversion up
    elif z_score < -1.0:
        return "Buy"
    return "Neutral"
