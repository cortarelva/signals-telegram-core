#!/bin/bash

set -u

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT_DIR/runtime/btc-gated-bearish-lab.env.sh"

LOG_DIR="$ROOT_DIR/logs/btc-gated-bearish-lab"
LOG_FILE="$LOG_DIR/bot.log"
LOOP_SLEEP_SECS="${BOT_LOOP_SLEEP_SECS:-60}"

mkdir -p "$LOG_DIR" "$ROOT_DIR/runtime/btc-gated-bearish-lab"
touch "$LOG_FILE"

exec >>"$LOG_FILE" 2>&1

echo "[$(date '+%Y-%m-%d %H:%M:%S %Z')] btc-gated bearish lab loop started pid=$$ interval=${LOOP_SLEEP_SECS}s"

while true; do
  echo "[$(date '+%Y-%m-%d %H:%M:%S %Z')] btc-gated bearish lab cycle start"
  node "$ROOT_DIR/runtime/torus-ai-trading.js"
  rc=$?
  echo "[$(date '+%Y-%m-%d %H:%M:%S %Z')] btc-gated bearish lab cycle end rc=$rc"
  sleep "$LOOP_SLEEP_SECS"
done
