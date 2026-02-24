"""
FastAPI router for multivariate regime detection.

Endpoints:
    POST /regime/multivariate  — Fit 3-state HMM on portfolio returns
"""

import traceback
import numpy as np
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional

from .models.regime_multivariate import fit_multivariate_regime
from .utils.data import fetch_returns

router = APIRouter(prefix="/regime", tags=["regime"])


class MultivariateRegimeRequest(BaseModel):
    """Request body for multivariate regime detection."""
    tickers: list[str]
    benchmark: str = "OBX"
    n_states: int = 3
    lookback_days: int = 1260  # 5 years


@router.post("/multivariate")
async def multivariate_regime_endpoint(request: MultivariateRegimeRequest):
    """
    Fit 3-state multivariate HMM on portfolio-level features.

    Accepts a list of tickers, fetches their returns from DB,
    computes cross-sectional features, and fits the HMM.

    Returns regime state, transition matrix, and per-asset
    regime-conditional expected returns.
    """
    try:
        if len(request.tickers) < 2:
            raise HTTPException(status_code=400, detail="Need at least 2 tickers")

        if len(request.tickers) > 60:
            raise HTTPException(status_code=400, detail="Maximum 60 tickers")

        # Fetch returns for all tickers
        ticker_dfs = {}
        for ticker in request.tickers:
            try:
                df = fetch_returns(ticker.upper(), limit=request.lookback_days)
                ticker_dfs[ticker.upper()] = df
            except ValueError:
                pass  # Skip tickers with insufficient data

        valid_tickers = list(ticker_dfs.keys())
        if len(valid_tickers) < 2:
            raise HTTPException(
                status_code=400,
                detail=f"Only {len(valid_tickers)} tickers have sufficient data"
            )

        # Fetch benchmark returns
        benchmark_df = None
        try:
            benchmark_df = fetch_returns(request.benchmark.upper(), limit=request.lookback_days)
        except ValueError:
            pass  # Proceed without benchmark

        # Align all series to common dates
        date_sets = [set(df["date"].dt.strftime("%Y-%m-%d").tolist()) for df in ticker_dfs.values()]
        common_dates = sorted(set.intersection(*date_sets))

        if benchmark_df is not None:
            bench_dates = set(benchmark_df["date"].dt.strftime("%Y-%m-%d").tolist())
            common_dates = sorted(set(common_dates) & bench_dates)

        if len(common_dates) < 120:
            raise HTTPException(
                status_code=400,
                detail=f"Only {len(common_dates)} common trading days (need >= 120)"
            )

        # Build aligned return matrix (T x N)
        returns_matrix = np.zeros((len(common_dates), len(valid_tickers)))
        for j, ticker in enumerate(valid_tickers):
            df = ticker_dfs[ticker]
            df_indexed = df.set_index(df["date"].dt.strftime("%Y-%m-%d"))
            for i, d in enumerate(common_dates):
                if d in df_indexed.index:
                    returns_matrix[i, j] = df_indexed.loc[d, "log_return"]

        # Benchmark returns aligned
        benchmark_returns = None
        if benchmark_df is not None:
            bench_indexed = benchmark_df.set_index(benchmark_df["date"].dt.strftime("%Y-%m-%d"))
            benchmark_returns = np.array([
                bench_indexed.loc[d, "log_return"] if d in bench_indexed.index else 0.0
                for d in common_dates
            ])

        # Fit model
        result = fit_multivariate_regime(
            returns_matrix=returns_matrix,
            benchmark_returns=benchmark_returns,
            tickers=valid_tickers,
            dates=common_dates,
            n_states=request.n_states,
        )

        result["tickers"] = valid_tickers
        result["benchmark"] = request.benchmark.upper()
        result["common_dates"] = len(common_dates)

        return result

    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(
            status_code=500,
            detail=f"Multivariate regime detection failed: {str(e)}"
        )
