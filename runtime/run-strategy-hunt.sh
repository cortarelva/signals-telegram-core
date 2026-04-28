#!/bin/bash

set -u

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT_DIR/runtime/strategy-hunt.env.sh"

LOG_DIR="$ROOT_DIR/logs/strategy-hunt"
LOG_FILE="$LOG_DIR/strategy-hunt.log"

mkdir -p "$LOG_DIR" "$STRATEGY_HUNT_OUTPUT_DIR"
touch "$LOG_FILE"

exec >>"$LOG_FILE" 2>&1

echo "[$(date '+%Y-%m-%d %H:%M:%S %Z')] strategy hunt start"
cd "$ROOT_DIR"
npm run hunt:crypto
rc=$?
echo "[$(date '+%Y-%m-%d %H:%M:%S %Z')] strategy hunt end rc=$rc"
exit "$rc"
