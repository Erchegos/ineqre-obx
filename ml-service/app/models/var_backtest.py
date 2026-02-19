"""
VaR Backtesting: Kupiec and Christoffersen tests.

Kupiec (1995) — Proportion of Failures (POF) test:
    Tests whether the observed violation rate matches the expected rate.
    H0: actual violation rate = expected rate (1 - confidence)

Christoffersen (1998) — Independence test:
    Tests whether violations are independent (not clustered).
    H0: violations are independently distributed

Combined Conditional Coverage test:
    Joint test of correct rate AND independence.
"""

import numpy as np
from scipy import stats


def kupiec_test(
    returns: np.ndarray,
    var_series: np.ndarray,
    confidence: float = 0.99,
) -> dict:
    """
    Kupiec Proportion of Failures (POF) test.

    Parameters
    ----------
    returns : np.ndarray
        Actual returns (same length as var_series).
    var_series : np.ndarray
        VaR estimates (positive numbers = loss thresholds).
    confidence : float
        VaR confidence level.

    Returns
    -------
    dict with test results.
    """
    # Violations: return < -VaR (loss exceeds VaR)
    violations = returns < -var_series
    n = len(returns)
    x = int(np.sum(violations))
    p_expected = 1 - confidence
    p_observed = x / n if n > 0 else 0

    # LR statistic
    if x == 0 or x == n:
        # Edge case: use simple chi2 approximation
        lr_stat = 2 * n * (p_observed * np.log(max(p_observed, 1e-10) / p_expected)
                          + (1 - p_observed) * np.log(max(1 - p_observed, 1e-10) / (1 - p_expected))) if x > 0 else 0
    else:
        lr_stat = -2 * (
            x * np.log(p_expected) + (n - x) * np.log(1 - p_expected)
            - x * np.log(p_observed) - (n - x) * np.log(1 - p_observed)
        )

    p_value = 1 - stats.chi2.cdf(lr_stat, df=1) if lr_stat > 0 else 1.0

    return {
        "test": "Kupiec POF",
        "n_observations": int(n),
        "n_violations": int(x),
        "expected_violations": float(n * p_expected),
        "violation_rate": float(p_observed),
        "expected_rate": float(p_expected),
        "lr_statistic": float(lr_stat),
        "p_value": float(p_value),
        "reject_h0": bool(p_value < 0.05),
        "interpretation": _kupiec_interpretation(p_observed, p_expected, p_value),
    }


def christoffersen_test(
    returns: np.ndarray,
    var_series: np.ndarray,
) -> dict:
    """
    Christoffersen independence test for VaR violations.

    Tests whether violations cluster (which would indicate
    the model fails to capture volatility dynamics).
    """
    violations = (returns < -var_series).astype(int)
    n = len(violations)

    # Count transitions
    n00, n01, n10, n11 = 0, 0, 0, 0
    for t in range(1, n):
        prev, curr = violations[t - 1], violations[t]
        if prev == 0 and curr == 0:
            n00 += 1
        elif prev == 0 and curr == 1:
            n01 += 1
        elif prev == 1 and curr == 0:
            n10 += 1
        else:
            n11 += 1

    # Transition probabilities
    p01 = n01 / (n00 + n01) if (n00 + n01) > 0 else 0
    p11 = n11 / (n10 + n11) if (n10 + n11) > 0 else 0
    p_hat = (n01 + n11) / (n - 1) if n > 1 else 0

    # LR independence test
    if p01 == 0 or p11 == 0 or p01 == 1 or p11 == 1 or p_hat == 0 or p_hat == 1:
        lr_stat = 0
    else:
        lr_unrestricted = (
            n00 * np.log(1 - p01) + n01 * np.log(p01)
            + n10 * np.log(1 - p11) + n11 * np.log(p11)
        )
        lr_restricted = (
            (n00 + n10) * np.log(1 - p_hat) + (n01 + n11) * np.log(p_hat)
        )
        lr_stat = -2 * (lr_restricted - lr_unrestricted)

    p_value = 1 - stats.chi2.cdf(lr_stat, df=1) if lr_stat > 0 else 1.0

    return {
        "test": "Christoffersen Independence",
        "transition_matrix": {
            "n00": n00, "n01": n01,
            "n10": n10, "n11": n11,
        },
        "p01": float(p01),
        "p11": float(p11),
        "clustering_ratio": float(p11 / p01) if p01 > 0 else None,
        "lr_statistic": float(lr_stat),
        "p_value": float(p_value),
        "reject_h0": bool(p_value < 0.05),
        "interpretation": _christoffersen_interpretation(p01, p11, p_value),
    }


def run_backtest(
    returns: np.ndarray,
    var_series: np.ndarray,
    confidence: float = 0.99,
    method_name: str = "Historical",
) -> dict:
    """
    Run full VaR backtest: Kupiec + Christoffersen + summary.
    """
    # Align lengths
    min_len = min(len(returns), len(var_series))
    ret = returns[-min_len:]
    var = var_series[-min_len:]

    # Remove NaN
    mask = ~(np.isnan(ret) | np.isnan(var))
    ret = ret[mask]
    var = var[mask]

    kupiec = kupiec_test(ret, var, confidence)
    chris = christoffersen_test(ret, var)

    # Traffic light system (Basel)
    violations = int(kupiec["n_violations"])
    n = kupiec["n_observations"]
    expected = kupiec["expected_violations"]

    if violations <= expected * 1.5:
        traffic_light = "GREEN"
    elif violations <= expected * 2.5:
        traffic_light = "YELLOW"
    else:
        traffic_light = "RED"

    return {
        "method": method_name,
        "confidence": confidence,
        "kupiec": kupiec,
        "christoffersen": chris,
        "traffic_light": traffic_light,
        "summary": {
            "model_adequate": not kupiec["reject_h0"],
            "violations_independent": not chris["reject_h0"],
            "overall_pass": not kupiec["reject_h0"] and not chris["reject_h0"],
        },
    }


def _kupiec_interpretation(p_obs: float, p_exp: float, p_val: float) -> str:
    ratio = p_obs / p_exp if p_exp > 0 else 0
    if p_val >= 0.05:
        return f"PASS — Violation rate ({p_obs:.3f}) consistent with expected ({p_exp:.3f}). Model is well-calibrated."
    elif ratio > 1:
        return f"FAIL — Too many violations ({p_obs:.3f} vs {p_exp:.3f} expected). VaR underestimates risk."
    else:
        return f"FAIL — Too few violations ({p_obs:.3f} vs {p_exp:.3f} expected). VaR is overly conservative."


def _christoffersen_interpretation(p01: float, p11: float, p_val: float) -> str:
    if p_val >= 0.05:
        return "PASS — Violations appear independent. No significant clustering detected."
    elif p11 > p01:
        return f"FAIL — Violations cluster (P(viol|viol)={p11:.3f} > P(viol|no viol)={p01:.3f}). Model misses vol persistence."
    else:
        return "FAIL — Violation pattern shows significant dependence structure."
