#!/bin/bash

set -u

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG_FILE="$ROOT_DIR/logs/bot.log"
LOOP_SLEEP_SECS="${BOT_LOOP_SLEEP_SECS:-}"
MARKET_SCAN_INTERVAL_SECS="${BOT_MARKET_SCAN_INTERVAL_SECS:-}"

if [ -z "$LOOP_SLEEP_SECS" ] && [ -f "$ROOT_DIR/.env" ]; then
  LOOP_SLEEP_SECS="$(
    awk -F= '/^BOT_LOOP_SLEEP_SECS=/{gsub(/[[:space:]]/, "", $2); print $2; exit}' "$ROOT_DIR/.env"
  )"
fi

if [ -z "$MARKET_SCAN_INTERVAL_SECS" ] && [ -f "$ROOT_DIR/.env" ]; then
  MARKET_SCAN_INTERVAL_SECS="$(
    awk -F= '/^BOT_MARKET_SCAN_INTERVAL_SECS=/{gsub(/[[:space:]]/, "", $2); print $2; exit}' "$ROOT_DIR/.env"
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

case "$MARKET_SCAN_INTERVAL_SECS" in
  ''|*[!0-9]*)
    MARKET_SCAN_INTERVAL_SECS=60
    ;;
esac

if [ "$MARKET_SCAN_INTERVAL_SECS" -le 0 ]; then
  MARKET_SCAN_INTERVAL_SECS=60
fi

if [ "$MARKET_SCAN_INTERVAL_SECS" -lt "$LOOP_SLEEP_SECS" ]; then
  MARKET_SCAN_INTERVAL_SECS="$LOOP_SLEEP_SECS"
fi

mkdir -p "$ROOT_DIR/logs"
touch "$LOG_FILE"

exec >>"$LOG_FILE" 2>&1

echo "[$(date '+%Y-%m-%d %H:%M:%S %Z')] bot loop started pid=$$ interval=${LOOP_SLEEP_SECS}s marketScanEvery=${MARKET_SCAN_INTERVAL_SECS}s"

LAST_FULL_SCAN_TS=0

while true; do
  NOW_TS="$(date +%s)"
  MANAGEMENT_ONLY=0

  if [ "$LAST_FULL_SCAN_TS" -gt 0 ]; then
    ELAPSED="$((NOW_TS - LAST_FULL_SCAN_TS))"
    if [ "$ELAPSED" -lt "$MARKET_SCAN_INTERVAL_SECS" ]; then
      MANAGEMENT_ONLY=1
    fi
  fi

  if [ "$MANAGEMENT_ONLY" -eq 1 ]; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S %Z')] bot management cycle start"
    BOT_MANAGEMENT_ONLY=1 node "$ROOT_DIR/runtime/torus-ai-trading.js"
  else
    echo "[$(date '+%Y-%m-%d %H:%M:%S %Z')] bot full cycle start"
    node "$ROOT_DIR/runtime/torus-ai-trading.js"
    LAST_FULL_SCAN_TS="$NOW_TS"
  fi
  rc=$?
  echo "[$(date '+%Y-%m-%d %H:%M:%S %Z')] bot cycle end rc=$rc mode=$([ "$MANAGEMENT_ONLY" -eq 1 ] && echo management || echo full)"
  sleep "$LOOP_SLEEP_SECS"
done
