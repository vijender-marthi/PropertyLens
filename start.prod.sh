#!/usr/bin/env bash
# PropertyLens production runtime entrypoint.
# Build/install is handled by scripts/install-production-service.sh.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HOST="${PROPERTYLENS_HOST:-127.0.0.1}"
PORT="${PROPERTYLENS_PORT:-8100}"
DB_PATH="${PROPERTYLENS_DB_PATH:-/var/lib/propertylens/propertylens.db}"

export PROPERTYLENS_DB_PATH="$DB_PATH"

cd "$SCRIPT_DIR/backend"

if [ ! -x "venv/bin/uvicorn" ]; then
  echo "Missing backend virtualenv. Run scripts/install-production-service.sh first." >&2
  exit 1
fi

exec "$SCRIPT_DIR/backend/venv/bin/uvicorn" main:app --host "$HOST" --port "$PORT"
