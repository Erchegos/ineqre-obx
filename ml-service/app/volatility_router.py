"""
FastAPI router for volatility model endpoints.

Endpoints:
    GET /volatility/garch/{ticker}      — GARCH(1,1) fit + forecast
    GET /volatility/regime/{ticker}     — HMM regime detection
    GET /volatility/msgarch/{ticker}    — MSGARCH (HMM + per-regime GARCH)
    GET /volatility/var/{ticker}        — VaR/ES computation
    GET /volatility/var-backtest/{ticker} — VaR backtesting
    GET /volatility/jumps/{ticker}      — Jump detection
    GET /volatility/full/{ticker}       — All models combined
"""

import traceback
import numpy as np
from fastapi import APIRouter, HTTPException, Query

from .utils.data import fetch_returns
from .models.garch import fit_garch
from .models.regime import fit_regime_model, fit_msgarch
from .models.var_models import compute_var, compute_var_series
from .models.var_backtest import run_backtest
from .models.jump_detection import detect_jumps

router = APIRouter(prefix="/volatility", tags=["volatility"])


@router.get("/garch/{ticker}")
async def garch_endpoint(
    ticker: str,
    limit: int = Query(1260, ge=100, le=5000),
    dist: str = Query("normal", regex="^(normal|t|skewt)$"),
):
    """Fit GARCH(1,1) and return parameters + conditional vol forecast."""
    try:
        df = fetch_returns(ticker.upper(), limit=limit)
        returns = df["log_return"].values

        result = fit_garch(returns, dist=dist)

        # Add date alignment for conditional vol
        dates = df["date"].dt.strftime("%Y-%m-%d").tolist()
        n_vol = len(result["conditional_vol"])
        result["dates"] = dates[-n_vol:]

        return {"ticker": ticker.upper(), **result}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"GARCH fitting failed: {str(e)}")


@router.get("/regime/{ticker}")
async def regime_endpoint(
    ticker: str,
    limit: int = Query(1260, ge=100, le=5000),
    n_states: int = Query(2, ge=2, le=3),
):
    """Fit HMM regime model and return state assignments + transition matrix."""
    try:
        df = fetch_returns(ticker.upper(), limit=limit)
        returns = df["log_return"].values
        dates = df["date"].dt.strftime("%Y-%m-%d").tolist()

        result = fit_regime_model(returns, dates=dates, n_states=n_states)

        # Trim state_probs for response size (last 252 points)
        if len(result["state_probs"]) > 252:
            result["state_probs"] = result["state_probs"][-252:]
            result["states"] = result["states"][-252:]
            if "dates" in result:
                result["dates"] = result["dates"][-252:]

        return {"ticker": ticker.upper(), **result}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Regime model failed: {str(e)}")


@router.get("/msgarch/{ticker}")
async def msgarch_endpoint(
    ticker: str,
    limit: int = Query(1260, ge=100, le=5000),
    n_states: int = Query(2, ge=2, le=3),
):
    """
    Fit approximate MSGARCH: HMM regime detection + per-regime GARCH(1,1).
    Returns blended volatility forecast weighted by current state probabilities.
    """
    try:
        df = fetch_returns(ticker.upper(), limit=limit)
        returns = df["log_return"].values
        dates = df["date"].dt.strftime("%Y-%m-%d").tolist()

        result = fit_msgarch(returns, dates=dates, n_states=n_states)

        # Trim for response size
        if len(result["state_probs"]) > 252:
            result["state_probs"] = result["state_probs"][-252:]
            result["states"] = result["states"][-252:]
            if "dates" in result:
                result["dates"] = result["dates"][-252:]

        return {"ticker": ticker.upper(), **result}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"MSGARCH failed: {str(e)}")


@router.get("/var/{ticker}")
async def var_endpoint(
    ticker: str,
    limit: int = Query(1260, ge=100, le=5000),
    window: int = Query(252, ge=60, le=2520),
):
    """Compute VaR and Expected Shortfall using historical, parametric, and GARCH methods."""
    try:
        df = fetch_returns(ticker.upper(), limit=limit)
        returns = df["log_return"].values

        result = compute_var(returns, confidence_levels=[0.95, 0.99], window=window)

        return {
            "ticker": ticker.upper(),
            "n_observations": len(returns),
            "window": window,
            "var": result,
        }
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"VaR computation failed: {str(e)}")


@router.get("/var-backtest/{ticker}")
async def var_backtest_endpoint(
    ticker: str,
    limit: int = Query(1260, ge=252, le=5000),
    confidence: float = Query(0.99, ge=0.9, le=0.999),
    window: int = Query(252, ge=60, le=2520),
):
    """
    Backtest VaR models using Kupiec + Christoffersen tests.
    Returns pass/fail for each method + traffic light classification.
    """
    try:
        df = fetch_returns(ticker.upper(), limit=limit)
        returns = df["log_return"].values
        dates = df["date"].dt.strftime("%Y-%m-%d").tolist()

        if len(returns) < window + 50:
            raise ValueError(f"Need at least {window + 50} observations for backtest")

        # Compute rolling VaR series
        var_series = compute_var_series(returns, confidence=confidence, window=window)

        actual = np.array(var_series["actual_returns"])
        results = {}

        for method in ["historical", "parametric", "garch"]:
            var_arr = np.array(var_series[f"{method}_var"])
            # Remove NaN pairs
            mask = ~(np.isnan(actual) | np.isnan(var_arr))
            results[method] = run_backtest(
                actual[mask], var_arr[mask],
                confidence=confidence,
                method_name=method.title(),
            )

        # Add the VaR series for charting (subsample for response size)
        n_points = len(actual)
        step = max(1, n_points // 500)
        chart_dates = dates[window::step][:len(actual[::step])]

        return {
            "ticker": ticker.upper(),
            "confidence": confidence,
            "window": window,
            "results": results,
            "chart": {
                "dates": chart_dates,
                "actual_returns": actual[::step].tolist(),
                "historical_var": np.array(var_series["historical_var"])[::step].tolist(),
                "parametric_var": np.array(var_series["parametric_var"])[::step].tolist(),
                "garch_var": np.array(var_series["garch_var"])[::step].tolist(),
            },
        }
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"VaR backtest failed: {str(e)}")


@router.get("/jumps/{ticker}")
async def jumps_endpoint(
    ticker: str,
    limit: int = Query(1260, ge=100, le=5000),
    threshold: float = Query(3.0, ge=2.0, le=6.0),
):
    """Detect jump events in return series."""
    try:
        df = fetch_returns(ticker.upper(), limit=limit)
        returns = df["log_return"].values
        dates = df["date"].dt.strftime("%Y-%m-%d").tolist()
        volumes = df["volume"].values if "volume" in df.columns else None

        result = detect_jumps(
            returns, dates, volumes=volumes,
            threshold_sigma=threshold,
        )

        return {"ticker": ticker.upper(), **result}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Jump detection failed: {str(e)}")


@router.get("/full/{ticker}")
async def full_endpoint(
    ticker: str,
    limit: int = Query(1260, ge=100, le=5000),
):
    """
    Run all volatility models for a ticker. Returns combined results.
    This is the primary endpoint for the frontend volatility page.
    """
    try:
        df = fetch_returns(ticker.upper(), limit=limit)
        returns = df["log_return"].values
        dates = df["date"].dt.strftime("%Y-%m-%d").tolist()
        volumes = df["volume"].values if "volume" in df.columns else None

        # Run models (sequential — each is fast enough)
        garch_result = _safe_run(lambda: fit_garch(returns), "garch")
        regime_result = _safe_run(
            lambda: fit_msgarch(returns, dates=dates, n_states=2), "msgarch"
        )
        var_result = _safe_run(
            lambda: compute_var(returns, confidence_levels=[0.95, 0.99]), "var"
        )
        jump_result = _safe_run(
            lambda: detect_jumps(returns, dates, volumes=volumes), "jumps"
        )

        # VaR backtest (rolling VaR series + Kupiec/Christoffersen)
        backtest_result = None
        if len(returns) >= 302:  # need window(252) + 50
            def _run_backtest():
                bt_confidence = 0.99
                bt_window = 252
                var_series = compute_var_series(returns, confidence=bt_confidence, window=bt_window)
                actual = np.array(var_series["actual_returns"])
                results = {}
                for method in ["historical", "parametric", "garch"]:
                    var_arr = np.array(var_series["{}_var".format(method)])
                    mask = ~(np.isnan(actual) | np.isnan(var_arr))
                    results[method] = run_backtest(
                        actual[mask], var_arr[mask],
                        confidence=bt_confidence,
                        method_name=method.title(),
                    )
                # Subsample chart for response size
                n_pts = len(actual)
                step = max(1, n_pts // 500)
                chart_dates = dates[bt_window::step][:len(actual[::step])]
                return {
                    "confidence": bt_confidence,
                    "window": bt_window,
                    "results": results,
                    "chart": {
                        "dates": chart_dates,
                        "actual_returns": actual[::step].tolist(),
                        "historical_var": np.array(var_series["historical_var"])[::step].tolist(),
                        "parametric_var": np.array(var_series["parametric_var"])[::step].tolist(),
                        "garch_var": np.array(var_series["garch_var"])[::step].tolist(),
                    },
                }
            backtest_result = _safe_run(_run_backtest, "var_backtest")

        # Trim large arrays for response
        if garch_result and "conditional_vol" in garch_result:
            n_vol = len(garch_result["conditional_vol"])
            garch_result["dates"] = dates[-n_vol:]
        if regime_result and "state_probs" in regime_result:
            if len(regime_result["state_probs"]) > 252:
                regime_result["state_probs"] = regime_result["state_probs"][-252:]
                regime_result["states"] = regime_result["states"][-252:]
                if "dates" in regime_result:
                    regime_result["dates"] = regime_result["dates"][-252:]

        return {
            "ticker": ticker.upper(),
            "n_observations": len(returns),
            "garch": garch_result,
            "regime": regime_result,
            "var": var_result,
            "var_backtest": backtest_result,
            "jumps": jump_result,
        }
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Full analysis failed: {str(e)}")


def _safe_run(fn, name: str):
    """Run a model function, returning None on failure instead of crashing."""
    try:
        return fn()
    except Exception as e:
        print(f"[WARN] {name} model failed: {e}")
        return {"error": str(e)}
