#!/bin/bash
# Batch optimizer runner for all ML-ready tickers
#
# Usage: ./scripts/run-optimizer-batch.sh [--dry-run] [--ticker TICKER]
#
# This script:
# 1. Exports factor data from PostgreSQL to CSV
# 2. Runs the Python optimizer on each ticker
# 3. Copies results to the web app's optimizer-configs directory

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
WEB_DIR="$PROJECT_ROOT/apps/web"
OPTIMIZER_DIR="$HOME/Documents/Intelligence_Equity_Research/PredOptimizer"
CONFIG_OUTPUT_DIR="$WEB_DIR/src/data/optimizer-configs"

DRY_RUN=false
SPECIFIC_TICKER=""

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --ticker)
      SPECIFIC_TICKER="$2"
      shift 2
      ;;
    *)
      echo "Unknown option: $1"
      exit 1
      ;;
  esac
done

echo "============================================================"
echo "OPTIMIZER BATCH RUNNER"
echo "============================================================"
echo "Project root: $PROJECT_ROOT"
echo "Optimizer dir: $OPTIMIZER_DIR"
echo "Config output: $CONFIG_OUTPUT_DIR"
echo ""

# Step 1: Export factor data
echo "Step 1: Exporting factor data from database..."
cd "$WEB_DIR"
if [ -n "$SPECIFIC_TICKER" ]; then
  npx tsx scripts/export-factors-for-optimizer.ts --ticker "$SPECIFIC_TICKER"
else
  npx tsx scripts/export-factors-for-optimizer.ts
fi
echo ""

# Step 2: Check Python optimizer exists
if [ ! -f "$OPTIMIZER_DIR/ticker_factor_optimizer.py" ]; then
  echo "ERROR: Python optimizer not found at $OPTIMIZER_DIR/ticker_factor_optimizer.py"
  exit 1
fi

# Step 3: Run Python optimizer
echo "Step 2: Running Python optimizer..."
cd "$OPTIMIZER_DIR"

# Activate virtual environment if it exists
if [ -d ".venv" ]; then
  echo "Activating virtual environment..."
  source .venv/bin/activate
fi

if [ "$DRY_RUN" = true ]; then
  echo "[DRY RUN] Would run: python ticker_factor_optimizer.py --ticker ${SPECIFIC_TICKER:-ALL} --csv-dir data/factors --output-dir configs/ticker_optimized --n-trials 100 --timeout 600"
else
  if [ -n "$SPECIFIC_TICKER" ]; then
    python ticker_factor_optimizer.py \
      --ticker "$SPECIFIC_TICKER" \
      --csv-dir data/factors \
      --output-dir configs/ticker_optimized \
      --n-trials 100 \
      --timeout 600
  else
    python ticker_factor_optimizer.py \
      --ticker ALL \
      --csv-dir data/factors \
      --output-dir configs/ticker_optimized \
      --n-trials 100 \
      --timeout 600
  fi
fi
echo ""

# Step 4: Copy results to web app
echo "Step 3: Copying optimizer configs to web app..."
mkdir -p "$CONFIG_OUTPUT_DIR"

if [ "$DRY_RUN" = true ]; then
  echo "[DRY RUN] Would copy: $OPTIMIZER_DIR/configs/ticker_optimized/*.json -> $CONFIG_OUTPUT_DIR/"
else
  if [ -d "$OPTIMIZER_DIR/configs/ticker_optimized" ]; then
    cp "$OPTIMIZER_DIR/configs/ticker_optimized/"*.json "$CONFIG_OUTPUT_DIR/" 2>/dev/null || echo "No new configs to copy"
    echo "Configs copied successfully"
  else
    echo "No optimizer output directory found"
  fi
fi
echo ""

# Step 5: Summary
echo "============================================================"
echo "COMPLETE"
echo "============================================================"
echo "Optimizer configs in: $CONFIG_OUTPUT_DIR"
ls -la "$CONFIG_OUTPUT_DIR/"*.json 2>/dev/null || echo "No configs found"
echo ""
echo "To commit changes:"
echo "  cd $PROJECT_ROOT"
echo "  git add apps/web/src/data/optimizer-configs/"
echo "  git commit -m 'Add optimizer configs for ML tickers'"
echo "  git push"
