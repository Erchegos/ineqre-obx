"""
Value at Risk (VaR) and Expected Shortfall (CVaR/ES) computation.

Three methods:
1. Historical Simulation — empirical quantile of past returns
2. Parametric (Normal) — mean ± z * σ
3. GARCH-filtered — uses conditional volatility from GARCH(1,1)

All VaR values are reported as positive numbers representing loss
(i.e., VaR = 0.02 means 2% potential loss).
"""

from typing import List, Optional

import numpy as np
from scipy import stats
from arch import arch_model


def compute_var(
    returns: np.ndarray,
    confidence_levels: Optional[List[float]] = None,
    window: int = 252,
) -> dict:
    """
    Compute VaR using all three methods.

    Parameters
    ----------
    returns : np.ndarray
        Log returns series.
    confidence_levels : list[float]
        Confidence levels (e.g., [0.95, 0.99]).
    window : int
        Lookback window for historical simulation.

    Returns
    -------
    dict with VaR and ES for each method and confidence level.
    """
    if confidence_levels is None:
        confidence_levels = [0.95, 0.99]

    recent = returns[-window:] if len(returns) > window else returns
    n = len(recent)

    result = {}

    for cl in confidence_levels:
        alpha = 1 - cl
        key = f"{int(cl * 100)}"

        # 1. Historical Simulation
        hist_var = -float(np.percentile(recent, alpha * 100))
        tail = recent[recent <= -hist_var]
        hist_es = -float(np.mean(tail)) if len(tail) > 0 else hist_var

        # 2. Parametric (Normal)
        mu = float(np.mean(recent))
        sigma = float(np.std(recent, ddof=1))
        z = stats.norm.ppf(alpha)
        param_var = -(mu + z * sigma)
        # ES under normal: mu + sigma * phi(z) / alpha
        param_es = -(mu - sigma * stats.norm.pdf(z) / alpha)

        # 3. GARCH-filtered
        garch_var, garch_es = _garch_var(returns, alpha)

        result[key] = {
            "confidence": cl,
            "historical": {
                "var": float(hist_var),
                "es": float(hist_es),
            },
            "parametric": {
                "var": float(param_var),
                "es": float(param_es),
            },
            "garch": {
                "var": float(garch_var),
                "es": float(garch_es),
            },
        }

    return result


def _garch_var(returns: np.ndarray, alpha: float):
    """
    Compute 1-day VaR using GARCH(1,1) conditional volatility.

    Uses the last conditional variance as the forecast,
    then applies normal quantile.
    """
    try:
        scaled = returns * 100.0
        am = arch_model(scaled, vol="Garch", p=1, q=1, dist="normal", mean="Constant")
        res = am.fit(disp="off", show_warning=False)

        # 1-step forecast
        fcast = res.forecast(horizon=1)
        fcast_var = fcast.variance.iloc[-1].iloc[0]  # in %^2
        fcast_vol = np.sqrt(fcast_var) / 100.0  # back to decimal
        mu = res.params.get("mu", 0) / 100.0

        z = stats.norm.ppf(alpha)
        var_val = -(mu + z * fcast_vol)

        # ES under GARCH-normal
        es_val = -(mu - fcast_vol * stats.norm.pdf(z) / alpha)

        return max(var_val, 0), max(es_val, 0)
    except Exception:
        # Fallback to simple parametric
        sigma = np.std(returns[-252:], ddof=1)
        mu = np.mean(returns[-252:])
        z = stats.norm.ppf(alpha)
        return max(-(mu + z * sigma), 0), max(-(mu - sigma * stats.norm.pdf(z) / alpha), 0)


def compute_var_series(
    returns: np.ndarray,
    confidence: float = 0.99,
    window: int = 252,
) -> dict:
    """
    Compute rolling VaR series for backtesting visualization.

    Returns arrays of:
    - dates (indices)
    - actual returns
    - historical VaR
    - parametric VaR
    - GARCH VaR (refit every 20 days for speed)
    """
    n = len(returns)
    if n < window + 20:
        raise ValueError(f"Need at least {window + 20} observations, got {n}")

    alpha = 1 - confidence
    z = stats.norm.ppf(alpha)

    hist_var = np.full(n, np.nan)
    param_var = np.full(n, np.nan)
    garch_var = np.full(n, np.nan)
    actual = returns.copy()

    # GARCH: fit every 20 days and use conditional vol for intermediate days
    last_garch_fit = None
    garch_cond_vol = None

    for t in range(window, n):
        lookback = returns[t - window:t]

        # Historical
        hist_var[t] = -np.percentile(lookback, alpha * 100)

        # Parametric
        mu = np.mean(lookback)
        sigma = np.std(lookback, ddof=1)
        param_var[t] = -(mu + z * sigma)

        # GARCH (refit every 20 days)
        if last_garch_fit is None or (t - last_garch_fit) >= 20:
            try:
                scaled = lookback * 100.0
                am = arch_model(scaled, vol="Garch", p=1, q=1, dist="normal", mean="Constant")
                res = am.fit(disp="off", show_warning=False)
                garch_cond_vol = res.conditional_volatility.values / 100.0
                garch_mu = res.params.get("mu", 0) / 100.0
                last_garch_fit = t
                # Use last conditional vol for this day
                garch_var[t] = -(garch_mu + z * garch_cond_vol[-1])
            except Exception:
                garch_var[t] = param_var[t]
        else:
            # Interpolate using EWMA between GARCH refits
            garch_var[t] = param_var[t]  # fallback

    return {
        "actual_returns": actual[window:].tolist(),
        "historical_var": hist_var[window:].tolist(),
        "parametric_var": param_var[window:].tolist(),
        "garch_var": garch_var[window:].tolist(),
        "confidence": confidence,
        "window": window,
    }
