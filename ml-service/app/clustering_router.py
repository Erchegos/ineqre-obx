"""
FastAPI router for spectral clustering + OU mean-reversion signals.

Endpoints:
    POST /clustering/spectral  — Cluster portfolio stocks by residual correlation
"""

import traceback
import numpy as np
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional

from .models.clustering import fit_spectral_clusters
from .utils.data import fetch_returns

router = APIRouter(prefix="/clustering", tags=["clustering"])


class ClusteringRequest(BaseModel):
    """Request body for spectral clustering."""
    tickers: list[str]
    benchmark: str = "OBX"
    lookback_days: int = 504  # 2 years
    n_clusters: Optional[int] = None  # Auto-select if None


@router.post("/spectral")
async def spectral_clustering_endpoint(request: ClusteringRequest):
    """
    Run spectral clustering on residual correlations.

    Returns cluster assignments, OU mean-reversion z-scores,
    and per-cluster half-life estimates.
    """
    try:
        if len(request.tickers) < 3:
            raise HTTPException(status_code=400, detail="Need at least 3 tickers for clustering")

        if len(request.tickers) > 60:
            raise HTTPException(status_code=400, detail="Maximum 60 tickers")

        # Fetch returns for all tickers
        ticker_dfs = {}
        for ticker in request.tickers:
            try:
                df = fetch_returns(ticker.upper(), limit=request.lookback_days)
                ticker_dfs[ticker.upper()] = df
            except ValueError:
                pass

        valid_tickers = list(ticker_dfs.keys())
        if len(valid_tickers) < 3:
            raise HTTPException(
                status_code=400,
                detail=f"Only {len(valid_tickers)} tickers have sufficient data"
            )

        # Fetch benchmark
        benchmark_returns = None
        try:
            bench_df = fetch_returns(request.benchmark.upper(), limit=request.lookback_days)
            bench_dates = set(bench_df["date"].dt.strftime("%Y-%m-%d").tolist())
        except ValueError:
            bench_dates = None

        # Align to common dates
        date_sets = [set(df["date"].dt.strftime("%Y-%m-%d").tolist()) for df in ticker_dfs.values()]
        common_dates = sorted(set.intersection(*date_sets))

        if bench_dates is not None:
            common_dates = sorted(set(common_dates) & bench_dates)

        if len(common_dates) < 120:
            raise HTTPException(
                status_code=400,
                detail=f"Only {len(common_dates)} common dates (need >= 120)"
            )

        # Build aligned matrices
        returns_matrix = np.zeros((len(common_dates), len(valid_tickers)))
        for j, ticker in enumerate(valid_tickers):
            df = ticker_dfs[ticker]
            df_indexed = df.set_index(df["date"].dt.strftime("%Y-%m-%d"))
            for i, d in enumerate(common_dates):
                if d in df_indexed.index:
                    returns_matrix[i, j] = df_indexed.loc[d, "log_return"]

        if bench_dates is not None:
            bench_indexed = bench_df.set_index(bench_df["date"].dt.strftime("%Y-%m-%d"))
            benchmark_returns = np.array([
                bench_indexed.loc[d, "log_return"] if d in bench_indexed.index else 0.0
                for d in common_dates
            ])

        # Run clustering
        result = fit_spectral_clusters(
            returns_matrix=returns_matrix,
            benchmark_returns=benchmark_returns,
            tickers=valid_tickers,
            n_clusters=request.n_clusters,
        )

        # Don't send the full residual correlation matrix (too large)
        del result["residual_correlation"]

        result["tickers"] = valid_tickers
        result["common_dates"] = len(common_dates)

        return result

    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(
            status_code=500,
            detail=f"Spectral clustering failed: {str(e)}"
        )
