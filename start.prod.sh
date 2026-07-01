#!/bin/bash
# PropertyLens - Production start script
# Usage: ./start.prod.sh

set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "PropertyLens — Production Mode"
echo "============================="

# ── Build Frontend ────────────────────────────────────────────────────────────
echo ""
echo "Building frontend..."
cd "$SCRIPT_DIR/frontend"
if [ ! -d "node_modules" ]; then
  npm install
fi
npm run build
echo "  Frontend built"

# ── Backend ──────────────────────────────────────────────────────────────────
echo ""
echo "Setting up Python backend..."
cd "$SCRIPT_DIR/backend"

if [ ! -d "venv" ]; then
  python3 -m venv venv
  echo "  Created virtual environment"
fi

source venv/bin/activate
pip install -q -r requirements.txt
echo "  Dependencies installed"

echo ""
echo "Starting server on http://localhost:8000"
uvicorn main:app --host 0.0.0.0 --port 8000
