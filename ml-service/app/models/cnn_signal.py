"""
1D CNN + Transformer encoder for residual time-series pattern detection.

Architecture:
    Input: (batch, 60, 1) — 60-day return windows
    Conv1D(1→16, k=5) → ReLU → Conv1D(16→32, k=3) → ReLU → Conv1D(32→64, k=3) → ReLU
    → AdaptiveAvgPool1D(1) → TransformerEncoder(d=64, nhead=2, layers=1)
    → Linear(64→1) → Tanh → signal ∈ [-1, 1]

Training: Walk-forward, MSE loss on forward 5-day returns.
"""

import numpy as np
from typing import Optional, List, Dict

try:
    import torch
    import torch.nn as nn
    HAS_TORCH = True
except ImportError:
    HAS_TORCH = False


if HAS_TORCH:
    class ReturnCNN(nn.Module):
        """1D CNN + Transformer for return time-series signals."""

        def __init__(self, window: int = 60, d_model: int = 64, nhead: int = 2, n_layers: int = 1):
            super().__init__()
            self.conv = nn.Sequential(
                nn.Conv1d(1, 16, kernel_size=5, padding=2),
                nn.ReLU(),
                nn.Conv1d(16, 32, kernel_size=3, padding=1),
                nn.ReLU(),
                nn.Conv1d(32, d_model, kernel_size=3, padding=1),
                nn.ReLU(),
            )
            self.pool = nn.AdaptiveAvgPool1d(1)

            encoder_layer = nn.TransformerEncoderLayer(
                d_model=d_model, nhead=nhead, dim_feedforward=128,
                dropout=0.1, batch_first=True,
            )
            self.transformer = nn.TransformerEncoder(encoder_layer, num_layers=n_layers)
            self.head = nn.Sequential(
                nn.Linear(d_model, 32),
                nn.ReLU(),
                nn.Dropout(0.1),
                nn.Linear(32, 1),
                nn.Tanh(),  # output in [-1, 1]
            )

        def forward(self, x: torch.Tensor) -> torch.Tensor:
            """
            x: (batch, window, 1) or (batch, window)
            Returns: (batch, 1) signal in [-1, 1]
            """
            if x.dim() == 2:
                x = x.unsqueeze(-1)  # (batch, window, 1)

            # Conv expects (batch, channels, length)
            x = x.permute(0, 2, 1)  # (batch, 1, window)
            x = self.conv(x)  # (batch, 64, window)

            # Pool to single vector
            x = self.pool(x).squeeze(-1)  # (batch, 64)

            # Transformer (treat as sequence of length 1)
            x = x.unsqueeze(1)  # (batch, 1, 64)
            x = self.transformer(x)  # (batch, 1, 64)
            x = x.squeeze(1)  # (batch, 64)

            return self.head(x)  # (batch, 1)


def _create_windows(returns: np.ndarray, window: int = 60, forward: int = 5) -> tuple:
    """
    Create training windows from return series.

    Returns (X, y) where:
        X: (N, window) past return windows
        y: (N,) forward return targets
    """
    n = len(returns)
    if n < window + forward:
        return np.array([]), np.array([])

    X = []
    y = []
    for i in range(window, n - forward):
        X.append(returns[i - window:i])
        y.append(np.sum(returns[i:i + forward]))

    return np.array(X), np.array(y)


def train_cnn_model(
    returns_matrix: np.ndarray,
    tickers: Optional[List[str]] = None,
    window: int = 60,
    forward_days: int = 5,
    train_pct: float = 0.8,
    epochs: int = 50,
    batch_size: int = 64,
    learning_rate: float = 1e-3,
) -> dict:
    """
    Train the CNN model on multiple asset return series.

    Parameters
    ----------
    returns_matrix : np.ndarray
        Shape (T, N) — daily returns for N assets.
    tickers : list[str], optional
    window : int
        Lookback window for each sample.
    forward_days : int
        Target forward return horizon.
    train_pct : float
        Train/test split ratio.
    epochs : int
    batch_size : int
    learning_rate : float

    Returns
    -------
    dict with model state_dict, training metrics, per-asset signals
    """
    if not HAS_TORCH:
        raise ImportError("PyTorch not installed. Run: pip install torch --index-url https://download.pytorch.org/whl/cpu")

    n_obs, n_assets = returns_matrix.shape

    # Create pooled training data from all assets
    all_X = []
    all_y = []
    for j in range(n_assets):
        X, y = _create_windows(returns_matrix[:, j], window, forward_days)
        if len(X) > 0:
            all_X.append(X)
            all_y.append(y)

    if not all_X:
        raise ValueError("Insufficient data to create training windows")

    X_all = np.vstack(all_X)
    y_all = np.concatenate(all_y)

    # Normalize targets to [-1, 1] range
    y_std = np.std(y_all)
    y_mean = np.mean(y_all)
    if y_std < 1e-10:
        y_std = 1.0
    y_normalized = (y_all - y_mean) / (3 * y_std)  # clip extreme targets
    y_normalized = np.clip(y_normalized, -1, 1)

    # Train/test split
    n_total = len(X_all)
    n_train = int(n_total * train_pct)
    X_train, X_test = X_all[:n_train], X_all[n_train:]
    y_train, y_test = y_normalized[:n_train], y_normalized[n_train:]

    # Convert to tensors
    X_train_t = torch.FloatTensor(X_train).unsqueeze(-1)  # (N, window, 1)
    y_train_t = torch.FloatTensor(y_train).unsqueeze(-1)  # (N, 1)
    X_test_t = torch.FloatTensor(X_test).unsqueeze(-1)
    y_test_t = torch.FloatTensor(y_test).unsqueeze(-1)

    # Create model
    model = ReturnCNN(window=window)
    optimizer = torch.optim.Adam(model.parameters(), lr=learning_rate, weight_decay=1e-4)
    criterion = nn.MSELoss()

    # Training loop
    model.train()
    train_losses = []
    for epoch in range(epochs):
        indices = torch.randperm(n_train)
        epoch_loss = 0
        n_batches = 0

        for start in range(0, n_train, batch_size):
            end = min(start + batch_size, n_train)
            batch_idx = indices[start:end]
            batch_X = X_train_t[batch_idx]
            batch_y = y_train_t[batch_idx]

            optimizer.zero_grad()
            pred = model(batch_X)
            loss = criterion(pred, batch_y)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()

            epoch_loss += loss.item()
            n_batches += 1

        train_losses.append(epoch_loss / n_batches if n_batches > 0 else 0)

    # Evaluate
    model.eval()
    with torch.no_grad():
        test_pred = model(X_test_t)
        test_loss = criterion(test_pred, y_test_t).item()

    # Generate current signals for each asset
    signals = {}
    if tickers is not None:
        for j, ticker in enumerate(tickers):
            rets = returns_matrix[:, j]
            if len(rets) >= window:
                last_window = rets[-window:]
                x = torch.FloatTensor(last_window).unsqueeze(0).unsqueeze(-1)
                with torch.no_grad():
                    sig = model(x).item()
                signals[ticker] = float(sig)
            else:
                signals[ticker] = 0.0

    return {
        "model_state": model.state_dict(),
        "train_loss_final": train_losses[-1] if train_losses else 0,
        "test_loss": test_loss,
        "n_train_samples": n_train,
        "n_test_samples": len(X_test),
        "epochs": epochs,
        "signals": signals,
        "y_mean": float(y_mean),
        "y_std": float(y_std),
    }


def predict_cnn_signals(
    model_state: dict,
    returns_matrix: np.ndarray,
    tickers: List[str],
    window: int = 60,
) -> Dict[str, float]:
    """Generate CNN signals for current portfolio using a trained model."""
    if not HAS_TORCH:
        return {t: 0.0 for t in tickers}

    model = ReturnCNN(window=window)
    model.load_state_dict(model_state)
    model.eval()

    signals = {}
    for j, ticker in enumerate(tickers):
        rets = returns_matrix[:, j]
        if len(rets) >= window:
            last_window = rets[-window:]
            x = torch.FloatTensor(last_window).unsqueeze(0).unsqueeze(-1)
            with torch.no_grad():
                sig = model(x).item()
            signals[ticker] = float(sig)
        else:
            signals[ticker] = 0.0

    return signals
