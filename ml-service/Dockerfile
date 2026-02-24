FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    gcc \
    postgresql-client \
    && rm -rf /var/lib/apt/lists/*

# Install CPU-only PyTorch first (avoids 4GB+ CUDA download)
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu

# Install remaining Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application
COPY app/ ./app/

# Create model directory
RUN mkdir -p /tmp/models

EXPOSE 8000

# Prevent PyTorch OpenMP/MKL multi-threading from crashing uvicorn
ENV OMP_NUM_THREADS=1
ENV MKL_NUM_THREADS=1

# Run with 2 workers; use shell form so $PORT is expanded at runtime
CMD uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --workers 2 --timeout-keep-alive 120
