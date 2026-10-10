#!/usr/bin/env bash
# One-command start for Ephemera on macOS (also works on Linux).
#   ./dev.sh         development mode
#   ./dev.sh prod    production build (what to use for the demo)
set -euo pipefail
cd "$(dirname "$0")"

MODE="${1:-dev}"
REDIS_STARTED=0
PIDS=()

say() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
die() { printf '\n\033[31mError:\033[0m %s\n' "$*" >&2; exit 1; }

cleanup() {
  echo
  say "Stopping"
  for pid in "${PIDS[@]:-}"; do [ -n "$pid" ] && kill "$pid" 2>/dev/null || true; done
  if [ "$REDIS_STARTED" = 1 ]; then redis-cli shutdown nosave 2>/dev/null || true; fi
}
trap cleanup EXIT INT TERM

# ---- 1. Check tools --------------------------------------------------------
command -v node >/dev/null || die "Node.js is missing. Run: brew install node"
command -v redis-server >/dev/null || die "Redis is missing. Run: brew install redis"

PY=""
for candidate in python3.13 python3.12 python3.11 python3; do
  if command -v "$candidate" >/dev/null; then PY="$candidate"; break; fi
done
[ -n "$PY" ] || die "Python 3 is missing. Run: brew install python"
"$PY" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)' \
  || die "Python 3.10 or newer is needed. Run: brew install python"

# ---- 2. Redis (no disk persistence, so deleted secrets stay deleted) -------
if redis-cli ping >/dev/null 2>&1; then
  say "Redis is already running"
else
  say "Starting Redis"
  redis-server --save "" --appendonly no --daemonize yes >/dev/null
  REDIS_STARTED=1
  sleep 1
  redis-cli ping >/dev/null 2>&1 || die "Redis did not start"
fi

# ---- 3. Backend ------------------------------------------------------------
if [ ! -d backend/venv ]; then
  say "Creating Python environment (first run only)"
  "$PY" -m venv backend/venv
fi
say "Installing backend packages"
backend/venv/bin/pip install --quiet --upgrade pip
backend/venv/bin/pip install --quiet -r backend/requirements.txt

say "Starting backend on http://127.0.0.1:8000"
(cd backend && exec venv/bin/uvicorn main:app --host 127.0.0.1 --port 8000) &
PIDS+=($!)

# ---- 4. Frontend -----------------------------------------------------------
if [ ! -d frontend/node_modules ]; then
  say "Installing frontend packages (first run only, about a minute)"
  (cd frontend && npm install --no-audit --no-fund)
fi

if [ "$MODE" = "prod" ]; then
  say "Building frontend"
  (cd frontend && npm run build)
  say "Open http://localhost:3000  (Ctrl+C to stop)"
  (cd frontend && exec npm run start) &
else
  say "Open http://localhost:3000  (Ctrl+C to stop)"
  (cd frontend && exec npm run dev) &
fi
PIDS+=($!)

wait
