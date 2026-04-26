#!/bin/bash

set -u

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG_FILE="$ROOT_DIR/logs/bot.log"
LOOP_SLEEP_SECS="${BOT_LOOP_SLEEP_SECS:-}"

if [ -z "$LOOP_SLEEP_SECS" ] && [ -f "$ROOT_DIR/.env" ]; then
  LOOP_SLEEP_SECS="$(
    awk -F= '/^BOT_LOOP_SLEEP_SECS=/{gsub(/[[:space:]]/, "", $2); print $2; exit}' "$ROOT_DIR/.env"
  )"
fi

case "$LOOP_SLEEP_SECS" in
  ''|*[!0-9]*)
    LOOP_SLEEP_SECS=60
    ;;
esac

if [ "$LOOP_SLEEP_SECS" -le 0 ]; then
  LOOP_SLEEP_SECS=60
fi

mkdir -p "$ROOT_DIR/logs"
touch "$LOG_FILE"

exec >>"$LOG_FILE" 2>&1

echo "[$(date '+%Y-%m-%d %H:%M:%S %Z')] bot loop started pid=$$ interval=${LOOP_SLEEP_SECS}s"

while true; do
  echo "[$(date '+%Y-%m-%d %H:%M:%S %Z')] bot cycle start"
  node "$ROOT_DIR/runtime/signals-telegram-core.js"
  rc=$?
  echo "[$(date '+%Y-%m-%d %H:%M:%S %Z')] bot cycle end rc=$rc"
  sleep "$LOOP_SLEEP_SECS"
done
