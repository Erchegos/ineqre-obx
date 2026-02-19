"""
Regime detection using Hidden Markov Models + per-regime GARCH.

Approximates MSGARCH (Markov-Switching GARCH) by:
1. Fitting a Gaussian HMM to returns to identify K regimes
2. Fitting separate GARCH(1,1) models per regime
3. Combining vol forecasts using filtered state probabilities

This is the practical production approach — full MLE MSGARCH is
computationally expensive and often unstable for daily data.

Also provides:
- Transition matrix (regime persistence, expected durations)
- Smoothed state probabilities
- Current state assignment
- Regime-conditional statistics
"""

import warnings
import numpy as np
import pandas as pd
from hmmlearn.hmm import GaussianHMM
from arch import arch_model


def fit_regime_model(
    returns: np.ndarray,
    dates: object = None,
    n_states: int = 2,
    n_iter: int = 200,
) -> dict:
    """
    Fit Gaussian HMM with `n_states` regimes to return series.

    Parameters
    ----------
    returns : np.ndarray
        Log returns.
    dates : array-like, optional
        Corresponding dates for output alignment.
    n_states : int
        Number of hidden states (2 or 3).
    n_iter : int
        Max EM iterations.

    Returns
    -------
    dict with keys:
        states: list of state assignments per observation
        state_probs: smoothed state probabilities (T x K)
        transition_matrix: K x K transition probability matrix
        state_stats: per-state {mean, vol, expected_duration}
        current_state: most likely current state (0-indexed)
        current_probs: current state probabilities
        state_labels: human-readable state names sorted by vol
        model_score: log-likelihood of the model
        bic: Bayesian Information Criterion
    """
    X = returns.reshape(-1, 1)
    n = len(X)

    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        model = GaussianHMM(
            n_components=n_states,
            covariance_type="full",
            n_iter=n_iter,
            random_state=42,
            tol=1e-4,
        )
        model.fit(X)

    # Decode: most likely state sequence
    states = model.predict(X)

    # Smoothed probabilities
    state_probs = model.predict_proba(X)

    # Sort states by volatility (ascending): state 0 = low vol
    state_vols = np.sqrt(model.covars_.flatten()) * np.sqrt(252)
    sort_idx = np.argsort(state_vols)

    # Remap
    remap = {old: new for new, old in enumerate(sort_idx)}
    states_sorted = np.array([remap[s] for s in states])
    probs_sorted = state_probs[:, sort_idx]

    # Reorder transition matrix
    trans = model.transmat_[sort_idx][:, sort_idx]

    # State statistics
    state_labels = _get_state_labels(n_states)
    state_stats = []
    for i in range(n_states):
        orig_idx = sort_idx[i]
        mask = states == orig_idx
        state_returns = returns[mask]
        expected_duration = 1.0 / (1.0 - trans[i, i]) if trans[i, i] < 1 else np.inf

        state_stats.append({
            "label": state_labels[i],
            "mean_return": float(np.mean(state_returns) * 252) if len(state_returns) > 0 else 0,
            "annualized_vol": float(np.std(state_returns) * np.sqrt(252)) if len(state_returns) > 0 else 0,
            "expected_duration_days": float(expected_duration),
            "frequency": float(np.sum(mask) / n),
            "n_observations": int(np.sum(mask)),
        })

    # Current state
    current_state = int(states_sorted[-1])
    current_probs = probs_sorted[-1].tolist()

    # BIC
    n_params = n_states * n_states + 2 * n_states - 1  # trans + means + vars
    log_lik = float(model.score(X) * n)
    bic = -2 * log_lik + n_params * np.log(n)

    result = {
        "n_states": n_states,
        "states": states_sorted.tolist(),
        "state_probs": probs_sorted.tolist(),
        "transition_matrix": trans.tolist(),
        "state_stats": state_stats,
        "current_state": current_state,
        "current_probs": current_probs,
        "state_labels": state_labels,
        "model_score": float(model.score(X)),
        "bic": float(bic),
    }

    if dates is not None:
        result["dates"] = [str(d) for d in dates[-len(states_sorted):]]

    return result


def fit_msgarch(
    returns: np.ndarray,
    dates: object = None,
    n_states: int = 2,
) -> dict:
    """
    Approximate MSGARCH: HMM regime detection + per-regime GARCH(1,1).

    Returns regime model output + per-regime GARCH parameters and
    a blended conditional volatility forecast.
    """
    # Step 1: Fit regime model
    regime_result = fit_regime_model(returns, dates, n_states)

    states = np.array(regime_result["states"])
    current_probs = regime_result["current_probs"]

    # Step 2: Fit GARCH per regime
    regime_garch = []
    for i in range(n_states):
        mask = states == i
        state_returns = returns[mask]

        if len(state_returns) < 50:
            # Not enough data for GARCH — use simple vol
            vol = float(np.std(state_returns) * np.sqrt(252)) if len(state_returns) > 5 else 0
            regime_garch.append({
                "state": i,
                "label": regime_result["state_labels"][i],
                "garch_params": None,
                "fallback_vol": vol,
                "forecast_vol": vol,
            })
            continue

        try:
            scaled = state_returns * 100.0
            am = arch_model(scaled, vol="Garch", p=1, q=1, dist="normal", mean="Constant")
            res = am.fit(disp="off", show_warning=False)

            omega = float(res.params.get("omega", 0))
            alpha = float(res.params.get("alpha[1]", 0))
            beta = float(res.params.get("beta[1]", 0))
            persistence = alpha + beta

            # 1-step forecast
            fcast = res.forecast(horizon=1)
            fcast_var = fcast.variance.iloc[-1].iloc[0]
            fcast_vol = float(np.sqrt(fcast_var * 252) / 100.0)

            regime_garch.append({
                "state": i,
                "label": regime_result["state_labels"][i],
                "garch_params": {
                    "omega": omega,
                    "alpha": alpha,
                    "beta": beta,
                    "persistence": persistence,
                },
                "forecast_vol": fcast_vol,
            })
        except Exception:
            vol = float(np.std(state_returns) * np.sqrt(252))
            regime_garch.append({
                "state": i,
                "label": regime_result["state_labels"][i],
                "garch_params": None,
                "fallback_vol": vol,
                "forecast_vol": vol,
            })

    # Step 3: Blended forecast = Σ P(state_i) × forecast_vol_i
    blended_vol = sum(
        current_probs[i] * rg["forecast_vol"]
        for i, rg in enumerate(regime_garch)
    )

    return {
        **regime_result,
        "regime_garch": regime_garch,
        "blended_forecast_vol": float(blended_vol),
    }


def _get_state_labels(n: int):
    if n == 2:
        return ["Low Volatility", "High Volatility"]
    elif n == 3:
        return ["Low Volatility", "Normal", "High Volatility"]
    else:
        return [f"State {i}" for i in range(n)]
