#!/bin/bash
# PropertyLens - Start script
# Usage: ./start.sh

set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "🏠 PropertyLens — RE Consolidation Tool"
echo "======================================="

# ── Backend ───────────────────────────────────────────────────────────────────
echo ""
echo "📦 Setting up Python backend..."
cd "$SCRIPT_DIR/backend"

if [ ! -d "venv" ]; then
  python3 -m venv venv
  echo "  Created virtual environment"
fi

source venv/bin/activate
pip3 install -q -r requirements.txt
echo "  Dependencies installed"

echo ""
echo "🚀 Starting FastAPI backend on http://localhost:8000"
uvicorn main:app --reload --host 0.0.0.0 --port 8000 &
BACKEND_PID=$!
echo "  Backend PID: $BACKEND_PID"

# ── Frontend ──────────────────────────────────────────────────────────────────
echo ""
echo "📦 Setting up React frontend..."
cd "$SCRIPT_DIR/frontend"

if [ ! -d "node_modules" ]; then
  echo "  Installing npm packages (first run, may take a minute)..."
  npm install
fi

echo ""
echo "🚀 Starting React dev server on http://localhost:5177"
npm run dev &
FRONTEND_PID=$!

echo ""
echo "======================================="
echo "✅ Both servers running!"
echo "   Frontend: http://localhost:5177"
echo "   Backend:  http://localhost:8000"
echo "   API Docs: http://localhost:8000/docs"
echo ""
echo "Press Ctrl+C to stop both servers"
echo ""

# Wait and handle Ctrl+C
trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; echo 'Stopped.'" INT TERM
wait $BACKEND_PID $FRONTEND_PID
