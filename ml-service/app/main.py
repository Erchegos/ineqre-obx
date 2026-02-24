"""
ML Prediction Microservice for Oslo Børs Predictive Factors
FastAPI service for training ensemble models and generating predictions

Models: XGBoost (50%) + LightGBM (50%) ensemble
Target: 1-month forward returns with probability distributions
Includes: Multivariate HMM regime detection, spectral clustering, SHAP importance
"""

# Prevent PyTorch OpenMP/MKL multi-threading from crashing uvicorn workers
import os
os.environ.setdefault("OMP_NUM_THREADS", "1")
os.environ.setdefault("MKL_NUM_THREADS", "1")

try:
    import torch
    torch.set_num_threads(1)
except ImportError:
    pass

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Dict, List, Optional
import numpy as np
import pandas as pd
from sklearn.preprocessing import StandardScaler
from sklearn.model_selection import train_test_split
from .models.ml_models import create_xgb_model, create_lgbm_model, HAS_XGB, HAS_LGBM
import joblib
import psycopg2
from psycopg2.extras import RealDictCursor
import os
import json
from datetime import datetime

app = FastAPI(title="Oslo Børs ML Prediction Service", version="2.0.0")

# Enable CORS for Next.js frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Volatility models router (GARCH, MSGARCH, VaR, Jump Detection)
from .volatility_router import router as volatility_router
app.include_router(volatility_router)

# Multivariate regime detection router (3-state HMM)
from .regime_router import router as regime_router
app.include_router(regime_router)

# Spectral clustering + OU mean-reversion router
from .clustering_router import router as clustering_router
app.include_router(clustering_router)

# CNN signals, signal combiner, and backtest router
from .signals_router import router as signals_router
app.include_router(signals_router)

# Feature columns (19 predictive factors)
FEATURE_COLUMNS = [
    'mom1m', 'mom6m', 'mom11m', 'mom36m', 'chgmom',
    'vol1m', 'vol3m', 'vol12m', 'maxret', 'beta', 'ivol',
    'bm', 'nokvol', 'ep', 'dy', 'sp', 'sg', 'mktcap',
    'dum_jan'
]

# Model cache
models_cache = {}

# ============================================================================
# Request/Response Models
# ============================================================================

class TrainRequest(BaseModel):
    start_date: str
    end_date: str
    test_split_date: str
    model_version: str

class PredictRequest(BaseModel):
    ticker: str
    date: str
    features: Dict[str, Optional[float]]

class PredictionResponse(BaseModel):
    ticker: str
    prediction_date: str
    target_date: str
    ensemble_prediction: float
    gb_prediction: float
    rf_prediction: float
    percentiles: Dict[str, float]
    feature_importance: Dict[str, float]
    confidence_score: float

# ============================================================================
# Database Connection
# ============================================================================

def get_db_connection():
    """Get PostgreSQL connection"""
    return psycopg2.connect(
        os.environ['DATABASE_URL'],
        cursor_factory=RealDictCursor
    )

# ============================================================================
# Feature Engineering
# ============================================================================

def engineer_features(df: pd.DataFrame) -> pd.DataFrame:
    """
    Add interaction and transformation features
    """
    # Convert all numeric columns to float (psycopg2 returns them as strings)
    numeric_cols = FEATURE_COLUMNS + ['target_return_1m']
    for col in numeric_cols:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors='coerce')

    # Replace infinities and very large values
    df = df.replace([np.inf, -np.inf], np.nan)

    # Log transform for skewed features (avoid log of zero/negative)
    if 'mktcap' in df.columns:
        df['log_mktcap'] = np.log(df['mktcap'].clip(lower=1))
    if 'nokvol' in df.columns:
        df['log_nokvol'] = np.log(df['nokvol'].clip(lower=1))

    # Interaction: momentum reversal for illiquid stocks
    if 'mom1m' in df.columns and 'nokvol' in df.columns:
        nokvol_median = df['nokvol'].median()
        df['mom1m_x_illiquid'] = df['mom1m'] * (df['nokvol'] < nokvol_median).astype(int)

    # Winsorize extreme values (1st and 99th percentiles)
    for col in ['mom1m', 'mom6m', 'vol1m', 'beta']:
        if col in df.columns:
            p01 = df[col].quantile(0.01)
            p99 = df[col].quantile(0.99)
            df[col] = df[col].clip(lower=p01, upper=p99)

    # Fill NaN with 0 for model training
    df = df.fillna(0)

    return df

# ============================================================================
# Model Training
# ============================================================================

@app.post("/train")
async def train_models(request: TrainRequest):
    """
    Train ensemble models and save to database
    """
    try:
        print(f"Loading training data from {request.start_date} to {request.end_date}")

        # Load data from factor_combined_view using database URL directly
        query = """
        SELECT ticker, date::text as date,
               mom1m, mom6m, mom11m, mom36m, chgmom,
               vol1m, vol3m, vol12m, maxret, beta, ivol,
               bm, nokvol, ep, dy, sp, sg, mktcap, dum_jan,
               target_return_1m
        FROM factor_combined_view
        WHERE date BETWEEN %(start_date)s AND %(end_date)s
          AND target_return_1m IS NOT NULL
        ORDER BY date ASC
        """

        df = pd.read_sql(query, os.environ['DATABASE_URL'], params={'start_date': request.start_date, 'end_date': request.end_date})

        print(f"Loaded {len(df)} samples")
        print(f"Columns: {df.columns.tolist()}")
        print(f"First date values: {df['date'].head()}")
        print(f"Date dtype: {df['date'].dtype}")

        if len(df) < 100:
            raise HTTPException(status_code=400, detail=f"Insufficient data: {len(df)} samples (need 100+)")

        # Engineer features
        df = engineer_features(df)

        # Convert date column to string for comparison (extract just YYYY-MM-DD)
        df['date'] = pd.to_datetime(df['date']).dt.strftime('%Y-%m-%d')

        print(f"Date range in data: {df['date'].min()} to {df['date'].max()}")
        print(f"Test split date: {request.test_split_date}")

        # Split train/test by date
        train_df = df[df['date'] < request.test_split_date]
        test_df = df[df['date'] >= request.test_split_date]

        print(f"Train samples: {len(train_df)}, Test samples: {len(test_df)}")

        # Prepare features and target
        feature_cols = [col for col in FEATURE_COLUMNS if col in df.columns]
        feature_cols += ['log_mktcap', 'log_nokvol', 'mom1m_x_illiquid']
        feature_cols = [col for col in feature_cols if col in df.columns]

        X_train = train_df[feature_cols].values
        y_train = train_df['target_return_1m'].values
        X_test = test_df[feature_cols].values
        y_test = test_df['target_return_1m'].values

        # Standardize features
        scaler = StandardScaler()
        X_train_scaled = scaler.fit_transform(X_train)
        X_test_scaled = scaler.transform(X_test)

        print("Training XGBoost model...")
        xgb_model = create_xgb_model()
        xgb_model.fit(X_train_scaled, y_train)

        print("Training LightGBM model...")
        lgbm_model = create_lgbm_model()
        lgbm_model.fit(X_train_scaled, y_train)

        # Evaluate
        xgb_train_r2 = xgb_model.score(X_train_scaled, y_train)
        xgb_test_r2 = xgb_model.score(X_test_scaled, y_test)
        lgbm_train_r2 = lgbm_model.score(X_train_scaled, y_train)
        lgbm_test_r2 = lgbm_model.score(X_test_scaled, y_test)

        # Ensemble R² (50/50 blend)
        xgb_pred_test = xgb_model.predict(X_test_scaled)
        lgbm_pred_test = lgbm_model.predict(X_test_scaled)
        ensemble_pred_test = 0.5 * xgb_pred_test + 0.5 * lgbm_pred_test

        from sklearn.metrics import r2_score, mean_squared_error
        ensemble_test_r2 = r2_score(y_test, ensemble_pred_test)
        ensemble_test_mse = mean_squared_error(y_test, ensemble_pred_test)

        # Alias for backward compat in model save
        gb_model = xgb_model
        rf_model = lgbm_model
        gb_test_r2 = xgb_test_r2
        rf_test_r2 = lgbm_test_r2
        gb_train_r2 = xgb_train_r2
        rf_train_r2 = lgbm_train_r2

        print(f"XGB Test R²: {xgb_test_r2:.4f}, LGBM Test R²: {lgbm_test_r2:.4f}, Ensemble R²: {ensemble_test_r2:.4f}")

        # Save models
        model_dir = f'/tmp/models/{request.model_version}'
        os.makedirs(model_dir, exist_ok=True)
        joblib.dump(gb_model, f'{model_dir}/gb_model.joblib')
        joblib.dump(rf_model, f'{model_dir}/rf_model.joblib')
        joblib.dump(scaler, f'{model_dir}/scaler.joblib')
        joblib.dump(feature_cols, f'{model_dir}/features.joblib')

        # Cache in memory
        models_cache[request.model_version] = {
            'gb': gb_model,
            'rf': rf_model,
            'scaler': scaler,
            'features': feature_cols
        }

        # Save metadata to database
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute("""
            INSERT INTO ml_model_metadata (
                model_version, trained_at, training_start_date, training_end_date,
                n_training_samples, train_r2, test_r2,
                gb_params, rf_params, ensemble_weights, is_active
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (model_version) DO UPDATE SET
                trained_at = EXCLUDED.trained_at,
                test_r2 = EXCLUDED.test_r2,
                is_active = EXCLUDED.is_active
        """, (
            request.model_version,
            datetime.now(),
            request.start_date,
            request.end_date,
            len(train_df),
            float((gb_train_r2 + rf_train_r2) / 2),
            float(ensemble_test_r2),
            json.dumps({'model': 'xgboost', 'n_estimators': 300, 'learning_rate': 0.05, 'max_depth': 6}),
            json.dumps({'model': 'lightgbm', 'n_estimators': 300, 'learning_rate': 0.05, 'num_leaves': 31}),
            json.dumps({'xgb': 0.5, 'lgbm': 0.5}),
            True
        ))
        conn.commit()
        conn.close()

        return {
            'success': True,
            'model_version': request.model_version,
            'train_samples': len(train_df),
            'test_samples': len(test_df),
            'gb_test_r2': float(gb_test_r2),
            'rf_test_r2': float(rf_test_r2),
            'ensemble_test_r2': float(ensemble_test_r2),
            'ensemble_test_mse': float(ensemble_test_mse)
        }

    except Exception as e:
        import traceback
        print(f"Training error: {str(e)}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

# ============================================================================
# Inference
# ============================================================================

@app.post("/predict", response_model=PredictionResponse)
async def predict(request: PredictRequest):
    """
    Generate prediction for a single ticker/date
    """
    try:
        # Load latest active model
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute("""
            SELECT model_version FROM ml_model_metadata
            WHERE is_active = true
            ORDER BY trained_at DESC
            LIMIT 1
        """)
        result = cur.fetchone()
        conn.close()

        if not result:
            raise HTTPException(status_code=404, detail="No active model found")

        model_version = result['model_version']

        # Load models (cache in memory)
        if model_version not in models_cache:
            model_dir = f'/tmp/models/{model_version}'
            if not os.path.exists(model_dir):
                raise HTTPException(status_code=404, detail=f"Model {model_version} not found")

            models_cache[model_version] = {
                'gb': joblib.load(f'{model_dir}/gb_model.joblib'),
                'rf': joblib.load(f'{model_dir}/rf_model.joblib'),
                'scaler': joblib.load(f'{model_dir}/scaler.joblib'),
                'features': joblib.load(f'{model_dir}/features.joblib')
            }

        models = models_cache[model_version]
        feature_cols = models['features']

        # Prepare features
        feature_dict = request.features.copy()

        # Replace None with 0
        feature_dict = {k: (v if v is not None else 0) for k, v in feature_dict.items()}

        # Engineer features (same as training)
        if 'mktcap' in feature_dict and feature_dict['mktcap'] and feature_dict['mktcap'] > 0:
            feature_dict['log_mktcap'] = np.log(max(feature_dict['mktcap'], 1))
        else:
            feature_dict['log_mktcap'] = 0

        if 'nokvol' in feature_dict and feature_dict['nokvol'] and feature_dict['nokvol'] > 0:
            feature_dict['log_nokvol'] = np.log(max(feature_dict['nokvol'], 1))
        else:
            feature_dict['log_nokvol'] = 0

        # Interaction term
        if 'mom1m' in feature_dict and 'nokvol' in feature_dict:
            feature_dict['mom1m_x_illiquid'] = 0  # Can't compute without proper nokvol

        # Create feature vector
        X = np.array([[feature_dict.get(col, 0) for col in feature_cols]])
        X_scaled = models['scaler'].transform(X)

        # Predict with both models
        gb_pred = models['gb'].predict(X_scaled)[0]
        rf_pred = models['rf'].predict(X_scaled)[0]

        # Ensemble (50/50 blend)
        ensemble_pred = 0.5 * gb_pred + 0.5 * rf_pred

        # Estimate prediction uncertainty from model disagreement
        pred_diff = abs(gb_pred - rf_pred)
        pred_std = max(pred_diff / 2, 0.005)  # minimum uncertainty

        # Generate percentiles (assume normal distribution)
        percentiles = {
            'p05': float(ensemble_pred - 1.645 * pred_std),
            'p25': float(ensemble_pred - 0.674 * pred_std),
            'p50': float(ensemble_pred),
            'p75': float(ensemble_pred + 0.674 * pred_std),
            'p95': float(ensemble_pred + 1.645 * pred_std)
        }

        # Feature importance (normalized)
        gb_importance = dict(zip(feature_cols, models['gb'].feature_importances_))
        rf_importance = dict(zip(feature_cols, models['rf'].feature_importances_))
        gb_total = sum(gb_importance.values()) or 1
        rf_total = sum(rf_importance.values()) or 1
        combined_importance = {
            k: float(0.5 * gb_importance.get(k, 0) / gb_total + 0.5 * rf_importance.get(k, 0) / rf_total)
            for k in feature_cols
        }

        # Sort by importance and take top 10
        top_features = dict(sorted(combined_importance.items(), key=lambda x: x[1], reverse=True)[:10])

        # Confidence score (inverse of prediction std, normalized)
        confidence = float(1 / (1 + pred_std * 10))  # Scale for 0-1 range

        # Calculate target date (1 month forward = ~30 days)
        from datetime import datetime, timedelta
        target_date = datetime.strptime(request.date, '%Y-%m-%d') + timedelta(days=30)

        return PredictionResponse(
            ticker=request.ticker,
            prediction_date=request.date,
            target_date=target_date.strftime('%Y-%m-%d'),
            ensemble_prediction=float(ensemble_pred),
            gb_prediction=float(gb_pred),
            rf_prediction=float(rf_pred),
            percentiles=percentiles,
            feature_importance=top_features,
            confidence_score=confidence
        )

    except HTTPException:
        raise
    except Exception as e:
        print(f"Prediction error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

# ============================================================================
# Health Check
# ============================================================================

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "service": "ml-prediction",
        "models_cached": list(models_cache.keys())
    }

@app.get("/")
async def root():
    """Root endpoint"""
    return {
        "service": "Oslo Børs ML Prediction Service",
        "version": "1.0.0",
        "endpoints": {
            "/train": "POST - Train ensemble models",
            "/predict": "POST - Generate prediction",
            "/health": "GET - Health check"
        }
    }
