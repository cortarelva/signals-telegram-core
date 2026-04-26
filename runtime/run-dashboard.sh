#!/bin/bash

set -u

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG_FILE="$ROOT_DIR/logs/dashboard.log"

mkdir -p "$ROOT_DIR/logs"
touch "$LOG_FILE"

exec >>"$LOG_FILE" 2>&1

echo "[$(date '+%Y-%m-%d %H:%M:%S %Z')] dashboard started pid=$$"
exec node "$ROOT_DIR/runtime/dashboard-server.js"
