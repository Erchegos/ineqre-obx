#!/bin/bash
#
# Daily Data Update - Intelligence Equity Research
#
# Fetches latest prices and runs the full ML pipeline.
# Tries IBKR Gateway first; falls back to Yahoo Finance if unavailable.
#
# Usage:
#   ./scripts/daily-update.sh              # Auto-detect IBKR, fallback Yahoo
#   ./scripts/daily-update.sh --yahoo      # Force Yahoo only (no IBKR needed)
#   ./scripts/daily-update.sh --ibkr       # Force IBKR only (fails if not running)
#   ./scripts/daily-update.sh --skip-prices # Skip price fetch, just run ML pipeline
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WEB_DIR="$(dirname "$SCRIPT_DIR")"
cd "$WEB_DIR"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log()  { echo -e "${CYAN}[$(date +%H:%M:%S)]${NC} $1"; }
ok()   { echo -e "${GREEN}[OK]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
fail() { echo -e "${RED}[FAIL]${NC} $1"; }

# Parse args
MODE="auto"
SKIP_PRICES=false
for arg in "$@"; do
  case "$arg" in
    --yahoo)       MODE="yahoo" ;;
    --ibkr)        MODE="ibkr" ;;
    --skip-prices) SKIP_PRICES=true ;;
  esac
done

echo ""
echo "================================================================"
echo "  DAILY DATA UPDATE — Intelligence Equity Research"
echo "================================================================"
echo "  Started:  $(date)"
echo "  Mode:     $MODE"
echo "================================================================"
echo ""

PRICE_STATUS="skipped"
START_TIME=$(date +%s)

# ─── Step 1: Fetch Prices ────────────────────────────────────────────

if [ "$SKIP_PRICES" = true ]; then
  log "Skipping price fetch (--skip-prices)"
else
  IBKR_AVAILABLE=false

  if [ "$MODE" != "yahoo" ]; then
    # Check if IBKR Gateway is running on port 4002
    if nc -z localhost 4002 2>/dev/null; then
      IBKR_AVAILABLE=true
    fi
  fi

  if [ "$MODE" = "ibkr" ] || ([ "$MODE" = "auto" ] && [ "$IBKR_AVAILABLE" = true ]); then
    log "Step 1: Fetching prices from IBKR Gateway..."
    if NODE_TLS_REJECT_UNAUTHORIZED=0 npx tsx scripts/ibkr-daily-update.ts; then
      ok "IBKR price update complete"
      PRICE_STATUS="ibkr"
    else
      fail "IBKR price update failed"
      if [ "$MODE" = "ibkr" ]; then
        fail "Aborting (--ibkr mode, no fallback)"
        exit 1
      fi
      warn "Falling back to Yahoo Finance..."
      if node scripts/backfill-yahoo.mjs; then
        ok "Yahoo price backfill complete"
        PRICE_STATUS="yahoo (fallback)"
      else
        fail "Yahoo backfill also failed"
        exit 1
      fi
    fi

  elif [ "$MODE" = "yahoo" ] || ([ "$MODE" = "auto" ] && [ "$IBKR_AVAILABLE" = false ]); then
    if [ "$MODE" = "auto" ]; then
      warn "IBKR Gateway not detected on port 4002"
    fi
    log "Step 1: Fetching prices from Yahoo Finance..."
    if node scripts/backfill-yahoo.mjs; then
      ok "Yahoo price backfill complete"
      PRICE_STATUS="yahoo"
    else
      fail "Yahoo backfill failed"
      exit 1
    fi
  fi
fi

echo ""

# ─── Step 2: ML Pipeline ────────────────────────────────────────────

log "Step 2: Running ML pipeline (factors → predictions)..."
echo ""

if NODE_TLS_REJECT_UNAUTHORIZED=0 npx tsx scripts/ml-daily-pipeline.ts; then
  ok "ML pipeline complete"
  ML_STATUS="success"
else
  fail "ML pipeline failed"
  ML_STATUS="failed"
fi

# ─── Step 3: Intelligence Data (shorts + commodities) ─────────────────

echo ""
log "Step 3: Fetching intelligence data..."

INTEL_STATUS="success"

log "  3a: Finanstilsynet short positions..."
if NODE_TLS_REJECT_UNAUTHORIZED=0 npx tsx scripts/fetch-ssr-shorts.ts; then
  ok "Short positions updated"
else
  warn "Short positions fetch failed (non-critical)"
  INTEL_STATUS="partial"
fi

log "  3b: Commodity prices + stock sensitivity..."
if NODE_TLS_REJECT_UNAUTHORIZED=0 npx tsx scripts/fetch-commodities.ts --days=30; then
  ok "Commodity prices updated"
else
  warn "Commodity prices fetch failed (non-critical)"
  INTEL_STATUS="partial"
fi

log "  3c: NewsWeb regulatory filings..."
if NODE_TLS_REJECT_UNAUTHORIZED=0 npx tsx scripts/fetch-newsweb-filings.ts --days=3; then
  ok "NewsWeb filings updated"
else
  warn "NewsWeb fetch failed (non-critical)"
  INTEL_STATUS="partial"
fi

# ─── Summary ─────────────────────────────────────────────────────────

END_TIME=$(date +%s)
DURATION=$(( END_TIME - START_TIME ))
MINUTES=$(( DURATION / 60 ))
SECONDS=$(( DURATION % 60 ))

echo ""
echo "================================================================"
echo "  DAILY UPDATE COMPLETE"
echo "================================================================"
echo "  Prices:    $PRICE_STATUS"
echo "  ML:        $ML_STATUS"
echo "  Intel:     $INTEL_STATUS"
echo "  Duration:  ${MINUTES}m ${SECONDS}s"
echo "  Finished:  $(date)"
echo "================================================================"
echo ""

if [ "$ML_STATUS" = "failed" ]; then
  exit 1
fi
