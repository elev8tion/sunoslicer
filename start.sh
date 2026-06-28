#!/bin/bash
# SunoSlicer Pro — One-command start
echo ""
echo "╔══════════════════════════════════════════╗"
echo "║        SunoSlicer Pro — Starting         ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# Always operate from the project root, regardless of where start.sh is called from
cd "$(dirname "$0")" || exit 1

# ── Python virtualenv (auto) ───────────────────────────────────────────────
# torch/demucs need a compatible Python (3.12 recommended). We keep a local
# .venv so the system Python is never touched. Created on first run, then reused.
if [ ! -d ".venv" ]; then
    VENV_PY=$(command -v python3.12 || command -v python3.13 || command -v python3 || command -v python)
    echo "🐍  Creating virtualenv (.venv) with $VENV_PY ..."
    "$VENV_PY" -m venv .venv || { echo "❌  Failed to create .venv"; exit 1; }
fi

# shellcheck disable=SC1091
source .venv/bin/activate
PYTHON="$(command -v python)"

if [ ! -d "node_modules" ]; then
    echo "📦  Installing frontend dependencies..."
    npm install
fi

$PYTHON -c "import flask, demucs" 2>/dev/null
if [ $? -ne 0 ]; then
    echo "📦  Installing Python dependencies..."
    $PYTHON -m pip install -r requirements.txt
fi

echo ""
echo "🚀  Starting servers..."
echo "    Backend:  http://localhost:7865 (AI separation)"
echo "    Frontend: http://localhost:7866 (editor UI)"
echo ""

$PYTHON server.py &
BACKEND_PID=$!

npm run dev &
FRONTEND_PID=$!

cleanup() {
    echo ""
    echo "Shutting down..."
    kill $BACKEND_PID 2>/dev/null
    kill $FRONTEND_PID 2>/dev/null
    exit 0
}
trap cleanup SIGINT SIGTERM
wait
