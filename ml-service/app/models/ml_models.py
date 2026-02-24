"""
XGBoost + LightGBM ensemble for equity return prediction.

Replaces the GB/RF ensemble (v2) with modern boosted tree models.
50/50 blend of XGBoost and LightGBM.

Features: Same 19 factors + engineered features as v2.
Target: 1-month forward returns.
"""

import numpy as np
import pandas as pd
from typing import Optional, List, Dict

try:
    from xgboost import XGBRegressor
    HAS_XGB = True
except ImportError:
    HAS_XGB = False

try:
    from lightgbm import LGBMRegressor
    HAS_LGBM = True
except ImportError:
    HAS_LGBM = False

try:
    import shap
    HAS_SHAP = True
except ImportError:
    HAS_SHAP = False


def create_xgb_model(
    max_depth: int = 6,
    n_estimators: int = 300,
    learning_rate: float = 0.05,
    subsample: float = 0.8,
    colsample_bytree: float = 0.8,
    random_state: int = 42,
) -> "XGBRegressor":
    """Create XGBoost regressor with tuned hyperparameters."""
    if not HAS_XGB:
        raise ImportError("xgboost not installed. Run: pip install xgboost>=2.0")

    return XGBRegressor(
        max_depth=max_depth,
        n_estimators=n_estimators,
        learning_rate=learning_rate,
        subsample=subsample,
        colsample_bytree=colsample_bytree,
        random_state=random_state,
        n_jobs=-1,
        verbosity=0,
        reg_alpha=0.1,  # L1 regularization
        reg_lambda=1.0,  # L2 regularization
        min_child_weight=10,
    )


def create_lgbm_model(
    num_leaves: int = 31,
    n_estimators: int = 300,
    learning_rate: float = 0.05,
    subsample: float = 0.8,
    feature_fraction: float = 0.8,
    random_state: int = 42,
) -> "LGBMRegressor":
    """Create LightGBM regressor with tuned hyperparameters."""
    if not HAS_LGBM:
        raise ImportError("lightgbm not installed. Run: pip install lightgbm>=4.0")

    return LGBMRegressor(
        num_leaves=num_leaves,
        n_estimators=n_estimators,
        learning_rate=learning_rate,
        subsample=subsample,
        colsample_bytree=feature_fraction,
        random_state=random_state,
        n_jobs=-1,
        verbose=-1,
        reg_alpha=0.1,
        reg_lambda=1.0,
        min_child_samples=10,
    )


def train_ensemble(
    X_train: np.ndarray,
    y_train: np.ndarray,
    X_test: np.ndarray,
    y_test: np.ndarray,
    feature_names: List[str],
) -> dict:
    """
    Train XGBoost + LightGBM ensemble.

    Returns trained models, evaluation metrics, and SHAP values.
    """
    from sklearn.metrics import r2_score, mean_squared_error, mean_absolute_error

    xgb_model = create_xgb_model()
    lgbm_model = create_lgbm_model()

    # Train both
    xgb_model.fit(X_train, y_train)
    lgbm_model.fit(X_train, y_train)

    # Predictions
    xgb_pred_test = xgb_model.predict(X_test)
    lgbm_pred_test = lgbm_model.predict(X_test)
    ensemble_pred_test = 0.5 * xgb_pred_test + 0.5 * lgbm_pred_test

    xgb_pred_train = xgb_model.predict(X_train)
    lgbm_pred_train = lgbm_model.predict(X_train)

    # Metrics
    metrics = {
        "xgb_train_r2": float(r2_score(y_train, xgb_pred_train)),
        "xgb_test_r2": float(r2_score(y_test, xgb_pred_test)),
        "xgb_test_rmse": float(np.sqrt(mean_squared_error(y_test, xgb_pred_test))),
        "lgbm_train_r2": float(r2_score(y_train, lgbm_pred_train)),
        "lgbm_test_r2": float(r2_score(y_test, lgbm_pred_test)),
        "lgbm_test_rmse": float(np.sqrt(mean_squared_error(y_test, lgbm_pred_test))),
        "ensemble_test_r2": float(r2_score(y_test, ensemble_pred_test)),
        "ensemble_test_rmse": float(np.sqrt(mean_squared_error(y_test, ensemble_pred_test))),
        "ensemble_test_mae": float(mean_absolute_error(y_test, ensemble_pred_test)),
    }

    # Feature importance (native + SHAP)
    xgb_importance = dict(zip(feature_names, xgb_model.feature_importances_.tolist()))
    lgbm_importance = dict(zip(feature_names, lgbm_model.feature_importances_.tolist()))

    # Normalize importances
    xgb_total = sum(xgb_importance.values()) or 1
    lgbm_total = sum(lgbm_importance.values()) or 1
    combined_importance = {
        k: float(0.5 * xgb_importance.get(k, 0) / xgb_total + 0.5 * lgbm_importance.get(k, 0) / lgbm_total)
        for k in feature_names
    }

    # SHAP values (if available)
    shap_values = None
    if HAS_SHAP:
        try:
            # Use a subsample for speed
            n_explain = min(100, len(X_test))
            X_explain = X_test[:n_explain]

            xgb_explainer = shap.TreeExplainer(xgb_model)
            xgb_shap = xgb_explainer.shap_values(X_explain)

            lgbm_explainer = shap.TreeExplainer(lgbm_model)
            lgbm_shap = lgbm_explainer.shap_values(X_explain)

            # Average absolute SHAP across models
            avg_shap = 0.5 * np.abs(xgb_shap).mean(axis=0) + 0.5 * np.abs(lgbm_shap).mean(axis=0)
            shap_values = dict(zip(feature_names, avg_shap.tolist()))
        except Exception:
            pass

    return {
        "xgb_model": xgb_model,
        "lgbm_model": lgbm_model,
        "metrics": metrics,
        "feature_importance": combined_importance,
        "shap_importance": shap_values,
    }


def predict_ensemble(
    xgb_model,
    lgbm_model,
    X: np.ndarray,
    feature_names: List[str],
) -> dict:
    """
    Generate ensemble prediction with uncertainty estimates.

    Returns point prediction + percentiles from tree variance.
    """
    xgb_pred = xgb_model.predict(X)[0]
    lgbm_pred = lgbm_model.predict(X)[0]
    ensemble_pred = 0.5 * xgb_pred + 0.5 * lgbm_pred

    # Uncertainty from individual tree predictions
    xgb_tree_preds = []
    for tree in xgb_model.get_booster().get_dump():
        pass  # XGBoost doesn't easily expose per-tree predictions

    # Use prediction disagreement as uncertainty proxy
    pred_diff = abs(xgb_pred - lgbm_pred)
    pred_std = max(pred_diff / 2, 0.005)  # minimum uncertainty

    percentiles = {
        "p05": float(ensemble_pred - 1.645 * pred_std),
        "p25": float(ensemble_pred - 0.674 * pred_std),
        "p50": float(ensemble_pred),
        "p75": float(ensemble_pred + 0.674 * pred_std),
        "p95": float(ensemble_pred + 1.645 * pred_std),
    }

    # Feature importance for this prediction (via SHAP if available)
    local_importance = None
    if HAS_SHAP:
        try:
            xgb_explainer = shap.TreeExplainer(xgb_model)
            xgb_shap = xgb_explainer.shap_values(X)
            lgbm_explainer = shap.TreeExplainer(lgbm_model)
            lgbm_shap = lgbm_explainer.shap_values(X)
            avg_shap = 0.5 * xgb_shap[0] + 0.5 * lgbm_shap[0]
            local_importance = dict(zip(feature_names, avg_shap.tolist()))
        except Exception:
            pass

    confidence = float(1 / (1 + pred_std * 10))

    return {
        "ensemble_prediction": float(ensemble_pred),
        "xgb_prediction": float(xgb_pred),
        "lgbm_prediction": float(lgbm_pred),
        "percentiles": percentiles,
        "confidence_score": confidence,
        "local_shap": local_importance,
    }
