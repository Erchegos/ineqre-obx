"""
Signal combiner: weighted blend of multiple alpha signals with regime conditioning.

Default weights:
    ML (XGB/LGBM):  25%
    CNN:            20%
    Momentum:       15%
    Valuation:      15%
    Cluster (MR):   15%
    Regime:         10%

In Crisis regime, weights shift:
    Regime → 25%, CNN → 10%, others adjusted proportionally.
"""

import numpy as np
from typing import Optional, List, Dict


# Default signal weights
DEFAULT_WEIGHTS = {
    "ml": 0.25,
    "cnn": 0.20,
    "momentum": 0.15,
    "valuation": 0.15,
    "cluster": 0.15,
    "regime": 0.10,
}

# Crisis-adjusted weights (regime becomes primary)
CRISIS_WEIGHTS = {
    "ml": 0.20,
    "cnn": 0.10,
    "momentum": 0.15,
    "valuation": 0.10,
    "cluster": 0.15,
    "regime": 0.30,
}


def _normalize_signal(value: float, min_val: float = -1, max_val: float = 1) -> float:
    """Clamp signal to [-1, 1] range."""
    return max(min_val, min(max_val, value))


def _momentum_signal(mom1m: float, mom6m: float, mom11m: float) -> float:
    """Convert momentum factors to [-1, 1] signal."""
    # Simple scoring: positive momentum = positive signal
    score = 0
    if mom1m > 0.02:
        score += 0.4
    elif mom1m < -0.02:
        score -= 0.4
    if mom6m > 0.05:
        score += 0.3
    elif mom6m < -0.05:
        score -= 0.3
    if mom11m > 0.05:
        score += 0.3
    elif mom11m < -0.05:
        score -= 0.3
    return _normalize_signal(score)


def _valuation_signal(ep: float, bm: float, dy: float) -> float:
    """Convert valuation factors to [-1, 1] signal."""
    score = 0
    # E/P: higher = cheaper = positive
    if ep > 0.08:
        score += 0.5
    elif ep > 0.04:
        score += 0.2
    elif ep > 0:
        score -= 0.1
    else:
        score -= 0.3
    # B/M: higher = cheaper
    if bm > 1.0:
        score += 0.3
    elif bm > 0.5:
        score += 0.1
    elif bm > 0:
        score -= 0.1
    # D/Y: moderate yield = positive
    if 0.02 < dy < 0.08:
        score += 0.2
    return _normalize_signal(score)


def _regime_signal(regime_label: str) -> float:
    """Convert regime state to [-1, 1] signal."""
    signals = {
        "Bull": 0.8,
        "Neutral": 0.0,
        "Crisis": -0.8,
        "Low Volatility": 0.5,
        "High Volatility": -0.5,
        "Bear": -0.7,
    }
    return signals.get(regime_label, 0.0)


def combine_signals(
    ticker: str,
    ml_prediction: Optional[float] = None,
    cnn_signal: Optional[float] = None,
    momentum_factors: Optional[dict] = None,
    valuation_factors: Optional[dict] = None,
    cluster_z_score: Optional[float] = None,
    regime_label: Optional[str] = None,
    custom_weights: Optional[dict] = None,
) -> dict:
    """
    Combine multiple signals into a single composite signal.

    Returns dict with combined_signal, component_signals, weights_used.
    """
    # Determine weights based on regime
    is_crisis = regime_label in ("Crisis", "Bear", "High Volatility")
    weights = custom_weights or (CRISIS_WEIGHTS if is_crisis else DEFAULT_WEIGHTS)

    # Build component signals
    components = {}

    # ML signal: scale prediction to [-1, 1] (±5% monthly = ±1)
    if ml_prediction is not None:
        components["ml"] = _normalize_signal(ml_prediction * 20)  # ±5% → ±1
    else:
        components["ml"] = 0
        weights = {**weights, "ml": 0}

    # CNN signal: already in [-1, 1]
    if cnn_signal is not None:
        components["cnn"] = _normalize_signal(cnn_signal)
    else:
        components["cnn"] = 0
        weights = {**weights, "cnn": 0}

    # Momentum
    if momentum_factors and any(v is not None for v in momentum_factors.values()):
        components["momentum"] = _momentum_signal(
            momentum_factors.get("mom1m", 0) or 0,
            momentum_factors.get("mom6m", 0) or 0,
            momentum_factors.get("mom11m", 0) or 0,
        )
    else:
        components["momentum"] = 0
        weights = {**weights, "momentum": 0}

    # Valuation
    if valuation_factors and any(v is not None and v > 0 for v in valuation_factors.values()):
        components["valuation"] = _valuation_signal(
            valuation_factors.get("ep", 0) or 0,
            valuation_factors.get("bm", 0) or 0,
            valuation_factors.get("dy", 0) or 0,
        )
    else:
        components["valuation"] = 0
        weights = {**weights, "valuation": 0}

    # Cluster mean-reversion: negative z-score = buy signal
    if cluster_z_score is not None:
        components["cluster"] = _normalize_signal(-cluster_z_score / 3)  # z=3 → signal=-1
    else:
        components["cluster"] = 0
        weights = {**weights, "cluster": 0}

    # Regime
    if regime_label is not None:
        components["regime"] = _regime_signal(regime_label)
    else:
        components["regime"] = 0
        weights = {**weights, "regime": 0}

    # Normalize weights to sum to 1
    total_weight = sum(weights.values())
    if total_weight > 0:
        norm_weights = {k: v / total_weight for k, v in weights.items()}
    else:
        norm_weights = {k: 1.0 / len(weights) for k in weights}

    # Weighted combination
    combined = sum(
        norm_weights.get(k, 0) * components.get(k, 0)
        for k in components
    )
    combined = _normalize_signal(combined)

    # Classify combined signal
    if combined > 0.5:
        classification = "Strong Buy"
    elif combined > 0.15:
        classification = "Buy"
    elif combined > -0.15:
        classification = "Hold"
    elif combined > -0.5:
        classification = "Sell"
    else:
        classification = "Strong Sell"

    return {
        "ticker": ticker,
        "combined_signal": float(combined),
        "classification": classification,
        "component_signals": {k: float(v) for k, v in components.items()},
        "weights_used": {k: float(v) for k, v in norm_weights.items()},
        "regime_adjusted": is_crisis,
    }


def combine_portfolio_signals(
    tickers: List[str],
    ml_predictions: Optional[Dict[str, float]] = None,
    cnn_signals: Optional[Dict[str, float]] = None,
    momentum_data: Optional[Dict[str, dict]] = None,
    valuation_data: Optional[Dict[str, dict]] = None,
    cluster_assignments: Optional[Dict[str, dict]] = None,
    regime_label: Optional[str] = None,
) -> List[dict]:
    """Combine signals for all tickers in a portfolio."""
    results = []
    for ticker in tickers:
        result = combine_signals(
            ticker=ticker,
            ml_prediction=ml_predictions.get(ticker) if ml_predictions else None,
            cnn_signal=cnn_signals.get(ticker) if cnn_signals else None,
            momentum_factors=momentum_data.get(ticker) if momentum_data else None,
            valuation_factors=valuation_data.get(ticker) if valuation_data else None,
            cluster_z_score=cluster_assignments.get(ticker, {}).get("z_score") if cluster_assignments else None,
            regime_label=regime_label,
        )
        results.append(result)
    return results
