#!/bin/bash

set -u

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT_DIR/runtime/btc-gated-bearish-lab.env.sh"

LOG_DIR="$ROOT_DIR/logs/btc-gated-bearish-lab"
LOG_FILE="$LOG_DIR/dashboard.log"

mkdir -p "$LOG_DIR" "$ROOT_DIR/runtime/btc-gated-bearish-lab"
touch "$LOG_FILE"

exec >>"$LOG_FILE" 2>&1

echo "[$(date '+%Y-%m-%d %H:%M:%S %Z')] btc-gated bearish lab dashboard started pid=$$ port=${DASHBOARD_PORT}"
exec node "$ROOT_DIR/runtime/dashboard-server.js"
