"""
GARCH(1,1) model fitting using the `arch` library.

Fits a standard GARCH(1,1) to log returns and returns:
- Parameters: omega (ω), alpha (α), beta (β)
- Persistence: α + β
- Half-life of vol shocks
- Conditional variance forecast (1-step and multi-step)
- Standardized residuals for VaR/diagnostic use
"""

import numpy as np
import pandas as pd
from arch import arch_model


def fit_garch(
    returns: np.ndarray,
    p: int = 1,
    q: int = 1,
    dist: str = "normal",
    horizon: int = 10,
) -> dict:
    """
    Fit GARCH(p,q) to a return series.

    Parameters
    ----------
    returns : np.ndarray
        Log returns (NOT percentage returns — the arch library will scale).
    p : int
        GARCH lag order (default 1).
    q : int
        ARCH lag order (default 1).
    dist : str
        Error distribution: 'normal', 't', 'skewt'.
    horizon : int
        Forecast horizon in days.

    Returns
    -------
    dict with keys:
        params: {omega, alpha, beta, persistence, half_life, unconditional_vol}
        conditional_vol: list of annualized conditional volatilities (last 252 or all)
        forecast: {h1, h5, h10, ...} annualized vol forecasts
        residuals: standardized residuals
        fit_stats: {log_likelihood, aic, bic, num_obs}
        dist_params: distribution parameters (df for t, etc.)
    """
    # arch expects returns scaled to percentage
    scaled = returns * 100.0

    am = arch_model(scaled, vol="Garch", p=p, q=q, dist=dist, mean="Constant")
    res = am.fit(disp="off", show_warning=False)

    # Extract parameters
    omega = res.params.get("omega", 0)
    alpha = res.params.get("alpha[1]", 0)
    beta_param = res.params.get("beta[1]", 0)
    persistence = alpha + beta_param

    # Half-life of vol shocks: log(0.5) / log(persistence)
    half_life = np.log(0.5) / np.log(persistence) if 0 < persistence < 1 else np.nan

    # Unconditional variance (percentage^2) → annualized vol
    uncond_var = omega / (1 - persistence) if persistence < 1 else np.nan
    uncond_vol_annual = np.sqrt(uncond_var * 252) / 100.0 if not np.isnan(uncond_var) else np.nan

    # Conditional volatility series (annualized)
    cond_vol = res.conditional_volatility  # in % space
    cond_vol_annual = (cond_vol * np.sqrt(252) / 100.0).tolist()

    # Standardized residuals
    raw_resid = res.resid / cond_vol
    if hasattr(raw_resid, 'dropna'):
        raw_resid = raw_resid.dropna()
    std_resid = np.array(raw_resid)
    std_resid = std_resid[~np.isnan(std_resid)].tolist()

    # Forecast
    forecasts = res.forecast(horizon=horizon)
    forecast_var = forecasts.variance.iloc[-1]  # last row = from last obs
    forecast_dict = {}
    for h in [1, 5, 10]:
        if h <= horizon:
            key = f"h{h:d}"
            # forecast_var[f"h.{h}"] is variance in %^2 space
            col_name = f"h.{h}"
            if col_name in forecast_var.index:
                fv = forecast_var[col_name]
                forecast_dict[key] = float(np.sqrt(fv * 252) / 100.0)

    # Distribution parameters
    dist_params = {}
    if dist == "t" and "nu" in res.params:
        dist_params["df"] = float(res.params["nu"])
    elif dist == "skewt":
        if "nu" in res.params:
            dist_params["df"] = float(res.params["nu"])
        if "lambda" in res.params:
            dist_params["skew"] = float(res.params["lambda"])

    return {
        "params": {
            "omega": float(omega),
            "alpha": float(alpha),
            "beta": float(beta_param),
            "persistence": float(persistence),
            "half_life": float(half_life) if not np.isnan(half_life) else None,
            "unconditional_vol": float(uncond_vol_annual) if not np.isnan(uncond_vol_annual) else None,
        },
        "conditional_vol": cond_vol_annual[-min(252, len(cond_vol_annual)):],
        "forecast": forecast_dict,
        "residuals": std_resid[-min(252, len(std_resid)):],
        "fit_stats": {
            "log_likelihood": float(res.loglikelihood),
            "aic": float(res.aic),
            "bic": float(res.bic),
            "num_obs": int(res.nobs),
        },
        "dist_params": dist_params,
    }
