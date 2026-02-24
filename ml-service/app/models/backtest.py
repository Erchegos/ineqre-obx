"""
Walk-forward backtest engine for portfolio signals.

Monthly rebalancing, transaction costs, rolling performance metrics.
Evaluates signal quality with regime-conditional analysis.
"""

import numpy as np
from typing import Optional, List, Dict


def walkforward_backtest(
    returns_matrix: np.ndarray,
    signals_history: List[Dict[str, float]],
    dates: List[str],
    tickers: List[str],
    rebalance_freq: int = 21,  # monthly (~21 trading days)
    transaction_cost_bps: float = 10,
    risk_free_rate: float = 0.045,
    regime_history: Optional[List[str]] = None,
) -> dict:
    """
    Walk-forward backtest using signal-based allocation.

    Parameters
    ----------
    returns_matrix : np.ndarray
        Shape (T, N) — daily returns for N assets.
    signals_history : list[dict[str, float]]
        List of signal dicts (one per rebalance date), each mapping ticker → signal [-1, 1].
    dates : list[str]
        Date strings aligned with returns_matrix.
    tickers : list[str]
        Asset tickers.
    rebalance_freq : int
        Days between rebalances.
    transaction_cost_bps : float
        One-way transaction costs in basis points.
    risk_free_rate : float
        Annual risk-free rate.
    regime_history : list[str], optional
        Regime labels aligned with returns_matrix.

    Returns
    -------
    dict with equity curve, rolling metrics, regime-conditional stats, trade log
    """
    n_obs, n_assets = returns_matrix.shape
    tc = transaction_cost_bps / 10000

    # Signal-based weight construction: normalize long-only signals to weights
    def signals_to_weights(signals: Dict[str, float]) -> np.ndarray:
        raw = np.array([max(0, signals.get(t, 0)) for t in tickers])
        total = raw.sum()
        if total < 1e-10:
            return np.ones(n_assets) / n_assets  # equal weight fallback
        return raw / total

    # Compute equity curve
    equity = [1.0]
    weights = np.ones(n_assets) / n_assets  # start equal weight
    portfolio_returns = []
    weight_history = []
    trade_log = []
    signal_idx = 0

    for t in range(n_obs):
        # Rebalance check
        if t % rebalance_freq == 0 and signal_idx < len(signals_history):
            new_weights = signals_to_weights(signals_history[signal_idx])
            turnover = np.sum(np.abs(new_weights - weights))
            cost = turnover * tc

            if turnover > 0.01:
                trade_log.append({
                    "date": dates[t] if t < len(dates) else f"day_{t}",
                    "turnover": float(turnover),
                    "cost_bps": float(cost * 10000),
                    "n_trades": int(np.sum(np.abs(new_weights - weights) > 0.005)),
                })

            weights = new_weights
            signal_idx += 1
            # Apply transaction cost
            equity.append(equity[-1] * (1 - cost))
        else:
            equity.append(equity[-1])

        # Daily return
        daily_ret = np.sum(weights * returns_matrix[t])
        portfolio_returns.append(daily_ret)
        equity[-1] *= (1 + daily_ret)

        weight_history.append(weights.copy())

    portfolio_returns = np.array(portfolio_returns)
    equity_curve = np.array(equity)

    # Performance metrics
    total_return = equity_curve[-1] / equity_curve[0] - 1
    ann_return = (1 + total_return) ** (252 / max(n_obs, 1)) - 1
    ann_vol = np.std(portfolio_returns) * np.sqrt(252)
    sharpe = (ann_return - risk_free_rate) / ann_vol if ann_vol > 1e-10 else 0

    # Sortino
    downside = portfolio_returns[portfolio_returns < 0]
    downside_vol = np.std(downside) * np.sqrt(252) if len(downside) > 5 else ann_vol
    sortino = (ann_return - risk_free_rate) / downside_vol if downside_vol > 1e-10 else 0

    # Max drawdown
    peak = np.maximum.accumulate(equity_curve)
    drawdowns = (peak - equity_curve) / peak
    max_dd = float(np.max(drawdowns))

    # Rolling 252-day metrics
    rolling_window = min(252, n_obs // 2)
    rolling_sharpe = []
    rolling_vol = []
    rolling_dates = []
    for i in range(rolling_window, len(portfolio_returns)):
        window_rets = portfolio_returns[i - rolling_window:i]
        w_ann_ret = np.mean(window_rets) * 252
        w_vol = np.std(window_rets) * np.sqrt(252)
        w_sharpe = (w_ann_ret - risk_free_rate) / w_vol if w_vol > 1e-10 else 0
        rolling_sharpe.append(float(w_sharpe))
        rolling_vol.append(float(w_vol))
        if i < len(dates):
            rolling_dates.append(dates[i])

    # Regime-conditional performance
    regime_stats = {}
    if regime_history is not None and len(regime_history) == n_obs:
        regimes = set(regime_history)
        for regime in regimes:
            mask = np.array([r == regime for r in regime_history])
            regime_rets = portfolio_returns[mask]
            if len(regime_rets) > 5:
                r_ann = float(np.mean(regime_rets) * 252)
                r_vol = float(np.std(regime_rets) * np.sqrt(252))
                r_sharpe = (r_ann - risk_free_rate) / r_vol if r_vol > 1e-10 else 0
                regime_stats[regime] = {
                    "ann_return": r_ann,
                    "ann_vol": r_vol,
                    "sharpe": float(r_sharpe),
                    "n_days": int(np.sum(mask)),
                    "avg_daily_return": float(np.mean(regime_rets)),
                    "max_daily_loss": float(np.min(regime_rets)),
                }

    # Subsample equity curve for response size
    step = max(1, len(equity_curve) // 500)
    chart_equity = equity_curve[::step].tolist()
    chart_dates = dates[::step] if dates else []
    chart_dates = chart_dates[:len(chart_equity)]

    # Average turnover
    total_turnover = sum(t["turnover"] for t in trade_log)
    avg_monthly_turnover = total_turnover / max(len(trade_log), 1)

    return {
        "metrics": {
            "total_return": float(total_return),
            "annualized_return": float(ann_return),
            "annualized_vol": float(ann_vol),
            "sharpe_ratio": float(sharpe),
            "sortino_ratio": float(sortino),
            "max_drawdown": float(max_dd),
            "avg_monthly_turnover": float(avg_monthly_turnover),
            "total_transaction_costs_bps": float(sum(t["cost_bps"] for t in trade_log)),
            "n_rebalances": len(trade_log),
        },
        "equity_curve": {
            "dates": chart_dates,
            "values": chart_equity,
        },
        "rolling_metrics": {
            "dates": rolling_dates,
            "sharpe": rolling_sharpe,
            "vol": rolling_vol,
        },
        "regime_conditional": regime_stats,
        "trade_log": trade_log[-12:],  # last 12 rebalances
    }
