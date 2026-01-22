#!/usr/bin/env bash
set -euo pipefail

: "${SQLITE_PATH:=/var/data/data.db}"
mkdir -p "$(dirname "$SQLITE_PATH")"

cd /app/apps/worker
node dist/db/migrate.js
node dist/index.js &
WORKER_PID=$!

trap 'kill "$WORKER_PID" >/dev/null 2>&1 || true' SIGINT SIGTERM

cd /app/apps/web
exec npm run start -- --port 3000
