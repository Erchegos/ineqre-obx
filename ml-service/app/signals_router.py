"""
FastAPI router for CNN signals, signal combiner, and walk-forward backtest.

Endpoints:
    POST /signals/cnn         — Train CNN and get current signals
    POST /signals/combine     — Combine all signal sources
    POST /signals/backtest    — Walk-forward backtest on combined signals
"""

import asyncio
import traceback
import numpy as np
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional

from .models.cnn_signal import train_cnn_model, HAS_TORCH
from .models.signal_combiner import combine_portfolio_signals
from .models.backtest import walkforward_backtest
from .utils.data import fetch_returns

router = APIRouter(prefix="/signals", tags=["signals"])


class CNNRequest(BaseModel):
    tickers: list[str]
    lookback_days: int = 1260
    epochs: int = 30
    window: int = 60


class CombineRequest(BaseModel):
    tickers: list[str]
    ml_predictions: Optional[dict[str, float]] = None
    cnn_signals: Optional[dict[str, float]] = None
    momentum_data: Optional[dict[str, dict]] = None
    valuation_data: Optional[dict[str, dict]] = None
    cluster_assignments: Optional[dict[str, dict]] = None
    regime_label: Optional[str] = None


class BacktestRequest(BaseModel):
    tickers: list[str]
    lookback_days: int = 1260
    rebalance_freq: int = 21
    transaction_cost_bps: float = 10


def _run_cnn_sync(tickers: list[str], lookback_days: int, window: int, epochs: int) -> dict:
    """Synchronous CNN training — runs in thread pool to avoid blocking event loop."""
    ticker_dfs = {}
    for ticker in tickers:
        try:
            df = fetch_returns(ticker.upper(), limit=lookback_days)
            ticker_dfs[ticker.upper()] = df
        except ValueError:
            pass

    valid_tickers = list(ticker_dfs.keys())
    if len(valid_tickers) < 2:
        raise ValueError("Insufficient data for CNN — need at least 2 tickers with price history")

    date_sets = [set(df["date"].dt.strftime("%Y-%m-%d").tolist()) for df in ticker_dfs.values()]
    common_dates = sorted(set.intersection(*date_sets))

    if len(common_dates) < 200:
        raise ValueError(f"Only {len(common_dates)} common dates (need >= 200)")

    returns_matrix = np.zeros((len(common_dates), len(valid_tickers)))
    for j, ticker in enumerate(valid_tickers):
        df = ticker_dfs[ticker]
        df_indexed = df.set_index(df["date"].dt.strftime("%Y-%m-%d"))
        for i, d in enumerate(common_dates):
            if d in df_indexed.index:
                returns_matrix[i, j] = df_indexed.loc[d, "log_return"]

    result = train_cnn_model(
        returns_matrix=returns_matrix,
        tickers=valid_tickers,
        window=window,
        epochs=epochs,
    )

    del result["model_state"]
    return {"tickers": valid_tickers, **result}


@router.post("/cnn")
async def cnn_endpoint(request: CNNRequest):
    """Train CNN model on portfolio returns and generate current signals."""
    try:
        if not HAS_TORCH:
            raise HTTPException(status_code=501, detail="PyTorch not installed")

        if len(request.tickers) < 2:
            raise HTTPException(status_code=400, detail="Need at least 2 tickers")

        # Run CPU-heavy training in thread pool to avoid blocking the event loop
        result = await asyncio.to_thread(
            _run_cnn_sync, request.tickers, request.lookback_days, request.window, request.epochs
        )
        return result

    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"CNN training failed: {str(e)}")


@router.post("/combine")
async def combine_endpoint(request: CombineRequest):
    """Combine all signal sources for portfolio tickers."""
    try:
        results = combine_portfolio_signals(
            tickers=request.tickers,
            ml_predictions=request.ml_predictions,
            cnn_signals=request.cnn_signals,
            momentum_data=request.momentum_data,
            valuation_data=request.valuation_data,
            cluster_assignments=request.cluster_assignments,
            regime_label=request.regime_label,
        )

        return {
            "tickers": request.tickers,
            "signals": results,
            "regime_adjusted": request.regime_label in ("Crisis", "Bear", "High Volatility"),
        }

    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Signal combination failed: {str(e)}")


@router.post("/backtest")
async def backtest_endpoint(request: BacktestRequest):
    """
    Run walk-forward backtest using equal-weight signals.
    For a full signal-based backtest, use the /signals/combine first,
    then pass the signal history here.
    """
    try:
        if len(request.tickers) < 2:
            raise HTTPException(status_code=400, detail="Need at least 2 tickers")

        # Fetch and align
        ticker_dfs = {}
        for ticker in request.tickers:
            try:
                df = fetch_returns(ticker.upper(), limit=request.lookback_days)
                ticker_dfs[ticker.upper()] = df
            except ValueError:
                pass

        valid_tickers = list(ticker_dfs.keys())
        if len(valid_tickers) < 2:
            raise HTTPException(status_code=400, detail="Insufficient data")

        date_sets = [set(df["date"].dt.strftime("%Y-%m-%d").tolist()) for df in ticker_dfs.values()]
        common_dates = sorted(set.intersection(*date_sets))

        if len(common_dates) < 252:
            raise HTTPException(status_code=400, detail=f"Only {len(common_dates)} common dates (need >= 252)")

        returns_matrix = np.zeros((len(common_dates), len(valid_tickers)))
        for j, ticker in enumerate(valid_tickers):
            df = ticker_dfs[ticker]
            df_indexed = df.set_index(df["date"].dt.strftime("%Y-%m-%d"))
            for i, d in enumerate(common_dates):
                if d in df_indexed.index:
                    returns_matrix[i, j] = df_indexed.loc[d, "log_return"]

        # Generate equal-weight signals for each rebalance period
        n_rebalances = len(common_dates) // request.rebalance_freq + 1
        signals_history = [
            {t: 1.0 / len(valid_tickers) for t in valid_tickers}
            for _ in range(n_rebalances)
        ]

        result = walkforward_backtest(
            returns_matrix=returns_matrix,
            signals_history=signals_history,
            dates=common_dates,
            tickers=valid_tickers,
            rebalance_freq=request.rebalance_freq,
            transaction_cost_bps=request.transaction_cost_bps,
        )

        result["tickers"] = valid_tickers
        return result

    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Backtest failed: {str(e)}")
