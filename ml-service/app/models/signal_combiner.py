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


def _valuation_signal(metrics: dict) -> float:
    """
    Composite valuation score from up to 5 metrics.

    Uses sector-relative z-scores if available (z_ep, z_bm, etc.),
    otherwise falls back to absolute thresholds.
    For E/P, B/M, D/Y, S/P: positive z = above sector median = cheaper.
    For EV/EBITDA: positive z = above sector median = MORE expensive, so invert.
    """
    # Check if z-scores are available
    has_z = any(
        metrics.get(f"z_{m}") is not None and metrics.get(f"z_{m}") != 0
        for m in ["ep", "bm", "dy", "sp", "ev_ebitda"]
    )

    if has_z:
        return _valuation_signal_zscore(metrics)
    return _valuation_signal_absolute(metrics)


def _valuation_signal_zscore(metrics: dict) -> float:
    """Sector-relative z-score based valuation signal."""
    z_scores: list[float] = []

    for m in ["ep", "bm", "dy", "sp"]:
        z = metrics.get(f"z_{m}")
        if z is not None and z != 0:
            # Positive z = above sector median = cheaper → positive signal
            z_scores.append(_normalize_signal(z / 2))  # z=2 → signal=1

    z_ev = metrics.get("z_ev_ebitda")
    if z_ev is not None and z_ev != 0:
        # Positive z = above sector median = MORE expensive → INVERT
        z_scores.append(_normalize_signal(-z_ev / 2))

    if not z_scores:
        return 0.0
    return _normalize_signal(sum(z_scores) / len(z_scores))


def _valuation_signal_absolute(metrics: dict) -> float:
    """Absolute threshold based valuation signal (fallback)."""
    sub_scores: list[float] = []

    ep = metrics.get("ep", 0) or 0
    if ep != 0:
        if ep > 0.08:
            sub_scores.append(1.0)
        elif ep > 0.04:
            sub_scores.append(0.3)
        elif ep > 0:
            sub_scores.append(-0.2)
        else:
            sub_scores.append(-1.0)

    bm = metrics.get("bm", 0) or 0
    if bm != 0:
        if bm > 1.0:
            sub_scores.append(1.0)
        elif bm > 0.5:
            sub_scores.append(0.3)
        elif bm > 0.2:
            sub_scores.append(-0.2)
        else:
            sub_scores.append(-0.5)

    dy = metrics.get("dy", 0) or 0
    if dy != 0:
        if 0.02 < dy < 0.08:
            sub_scores.append(0.5)
        elif dy > 0:
            sub_scores.append(0.1)
        else:
            sub_scores.append(-0.3)

    ev_ebitda = metrics.get("ev_ebitda", 0) or 0
    if ev_ebitda > 0:
        if ev_ebitda < 6:
            sub_scores.append(1.0)
        elif ev_ebitda < 10:
            sub_scores.append(0.3)
        elif ev_ebitda < 15:
            sub_scores.append(-0.2)
        else:
            sub_scores.append(-0.5)

    sp = metrics.get("sp", 0) or 0
    if sp > 0:
        if sp > 1.0:
            sub_scores.append(0.5)
        elif sp > 0.5:
            sub_scores.append(0.2)
        else:
            sub_scores.append(-0.1)

    if not sub_scores:
        return 0.0
    return _normalize_signal(sum(sub_scores) / len(sub_scores))


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

    # Valuation (5-metric composite: E/P, B/M, D/Y, EV/EBITDA, S/P)
    if valuation_factors and any(v is not None and v > 0 for v in valuation_factors.values()):
        components["valuation"] = _valuation_signal(valuation_factors)
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
