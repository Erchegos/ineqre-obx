#!/bin/bash

# Start FX Hedging Analytics Dev Server
# Usage: ./start-fx-dev.sh

echo "🚀 Starting FX Hedging Analytics Development Server..."
echo ""

# Kill any existing dev server
echo "Stopping any existing dev servers..."
lsof -ti:3000 | xargs kill -9 2>/dev/null || true
sleep 2

# Start dev server
echo "Starting Next.js dev server..."
npm run dev

# Server will be available at http://localhost:3000
# Navigate to http://localhost:3000/fx-hedging to see the FX dashboard
