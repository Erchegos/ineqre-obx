"""
Jump detection in return series.

Identifies abnormal price moves using multiple methods:
1. Statistical threshold — returns exceeding N conditional σ
2. HMM-based — regime transitions detected by the HMM model
3. Volume-confirmed — large returns with abnormal volume

Output: list of jump events with dates, magnitudes, and classification.
"""

import numpy as np
import pandas as pd


def detect_jumps(
    returns: np.ndarray,
    dates=None,
    volumes=None,
    threshold_sigma: float = 3.0,
    rolling_window: int = 60,
    min_abs_return: float = 0.03,
) -> dict:
    """
    Detect jump events in a return series.

    Parameters
    ----------
    returns : np.ndarray
        Log returns.
    dates : array-like
        Corresponding dates.
    volumes : np.ndarray, optional
        Trading volumes for volume-confirmation.
    threshold_sigma : float
        Number of rolling σ for jump threshold (default 3.0).
    rolling_window : int
        Window for rolling mean/std computation.
    min_abs_return : float
        Minimum absolute return to qualify as jump (default 3%).

    Returns
    -------
    dict with:
        jumps: list of jump events
        summary: aggregate statistics
        intensity: jump frequency (jumps per year)
    """
    n = len(returns)
    dates = [str(d) for d in dates]

    # Rolling statistics
    rolling_mean = pd.Series(returns).rolling(rolling_window, min_periods=20).mean().values
    rolling_std = pd.Series(returns).rolling(rolling_window, min_periods=20).std().values

    # Volume z-scores (if available)
    vol_zscore = None
    if volumes is not None and len(volumes) == n:
        vol_rolling_mean = pd.Series(volumes).rolling(rolling_window, min_periods=20).mean().values
        vol_rolling_std = pd.Series(volumes).rolling(rolling_window, min_periods=20).std().values
        with np.errstate(divide="ignore", invalid="ignore"):
            vol_zscore = np.where(
                vol_rolling_std > 0,
                (volumes - vol_rolling_mean) / vol_rolling_std,
                0,
            )

    jumps = []
    for t in range(rolling_window, n):
        if np.isnan(rolling_std[t]) or rolling_std[t] == 0:
            continue

        z = (returns[t] - rolling_mean[t]) / rolling_std[t]
        abs_ret = abs(returns[t])

        if abs(z) >= threshold_sigma and abs_ret >= min_abs_return:
            direction = "up" if returns[t] > 0 else "down"

            jump = {
                "date": dates[t],
                "return": float(returns[t]),
                "return_pct": float(returns[t] * 100),
                "z_score": float(z),
                "direction": direction,
                "magnitude": _classify_magnitude(abs(z)),
            }

            if vol_zscore is not None:
                jump["volume_z"] = float(vol_zscore[t])
                jump["volume_confirmed"] = bool(vol_zscore[t] > 2.0)

            jumps.append(jump)

    # Summary
    n_jumps = len(jumps)
    trading_days = n - rolling_window
    years = trading_days / 252.0

    up_jumps = [j for j in jumps if j["direction"] == "up"]
    down_jumps = [j for j in jumps if j["direction"] == "down"]

    summary = {
        "total_jumps": n_jumps,
        "up_jumps": len(up_jumps),
        "down_jumps": len(down_jumps),
        "avg_jump_size": float(np.mean([abs(j["return"]) for j in jumps])) if jumps else 0,
        "max_up": float(max((j["return"] for j in up_jumps), default=0)),
        "max_down": float(min((j["return"] for j in down_jumps), default=0)),
        "intensity_per_year": float(n_jumps / years) if years > 0 else 0,
        "jump_contribution": _compute_jump_contribution(returns[rolling_window:], jumps, dates[rolling_window:]),
    }

    return {
        "jumps": jumps,
        "summary": summary,
        "threshold_sigma": threshold_sigma,
        "rolling_window": rolling_window,
    }


def _classify_magnitude(abs_z: float) -> str:
    if abs_z >= 5:
        return "extreme"
    elif abs_z >= 4:
        return "large"
    else:
        return "moderate"


def _compute_jump_contribution(
    returns: np.ndarray,
    jumps,
    dates,
) -> float:
    """
    Compute what fraction of total variance is explained by jump days.
    """
    if len(jumps) == 0 or len(returns) == 0:
        return 0.0

    jump_dates = set(j["date"] for j in jumps)
    jump_returns = [r for r, d in zip(returns, dates) if d in jump_dates]

    if len(jump_returns) == 0:
        return 0.0

    total_var = np.var(returns)
    if total_var == 0:
        return 0.0

    # Variance contribution = sum of squared jump returns / total sum of squares
    jump_ss = sum(r ** 2 for r in jump_returns)
    total_ss = sum(r ** 2 for r in returns)

    return float(jump_ss / total_ss) if total_ss > 0 else 0.0
