#!/bin/bash
# SunoSlicer Pro — One-command start
echo ""
echo "╔══════════════════════════════════════════╗"
echo "║        SunoSlicer Pro — Starting         ║"
echo "╚══════════════════════════════════════════╝"
echo ""

PYTHON=$(command -v python3 || command -v python)

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
