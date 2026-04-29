#!/bin/bash

set -u

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT_DIR/runtime/strategy-hunt.env.sh"

if [ -n "${STRATEGY_HUNT_PROFILE_ENV_FILE:-}" ] && [ -f "${STRATEGY_HUNT_PROFILE_ENV_FILE}" ]; then
  . "${STRATEGY_HUNT_PROFILE_ENV_FILE}"
fi

PROFILE_NAME="${STRATEGY_HUNT_PROFILE_NAME:-default}"
LOCK_FILE="${STRATEGY_HUNT_LOCK_FILE:-$ROOT_DIR/runtime/strategy-hunt.lock}"
LOADAVG_MAX="${STRATEGY_HUNT_LOADAVG_MAX:-2.40}"
MEM_AVAILABLE_MB_MIN="${STRATEGY_HUNT_MEM_AVAILABLE_MB_MIN:-700}"

LOG_DIR="$ROOT_DIR/logs/strategy-hunt"
LOG_FILE="$LOG_DIR/strategy-hunt-${PROFILE_NAME}.log"

mkdir -p "$LOG_DIR" "$STRATEGY_HUNT_OUTPUT_DIR"
touch "$LOG_FILE"

exec >>"$LOG_FILE" 2>&1

mem_available_mb() {
  awk '/MemAvailable:/ { print int($2 / 1024) }' /proc/meminfo
}

cpu_load_1m() {
  awk '{ print $1 }' /proc/loadavg
}

if ! exec 9>"$LOCK_FILE"; then
  echo "[$(date '+%Y-%m-%d %H:%M:%S %Z')] strategy hunt profile=${PROFILE_NAME} failed to open lock $LOCK_FILE"
  exit 1
fi

if ! flock -n 9; then
  echo "[$(date '+%Y-%m-%d %H:%M:%S %Z')] strategy hunt profile=${PROFILE_NAME} skipped reason=lock_busy"
  exit 0
fi

CURRENT_LOAD="$(cpu_load_1m)"
CURRENT_MEM_MB="$(mem_available_mb)"

if ! awk -v current="$CURRENT_LOAD" -v max="$LOADAVG_MAX" 'BEGIN { exit (current <= max ? 0 : 1) }'; then
  echo "[$(date '+%Y-%m-%d %H:%M:%S %Z')] strategy hunt profile=${PROFILE_NAME} skipped reason=high_load load1m=${CURRENT_LOAD} max=${LOADAVG_MAX}"
  exit 0
fi

if [ "${CURRENT_MEM_MB:-0}" -lt "${MEM_AVAILABLE_MB_MIN}" ]; then
  echo "[$(date '+%Y-%m-%d %H:%M:%S %Z')] strategy hunt profile=${PROFILE_NAME} skipped reason=low_mem availableMb=${CURRENT_MEM_MB} min=${MEM_AVAILABLE_MB_MIN}"
  exit 0
fi

echo "[$(date '+%Y-%m-%d %H:%M:%S %Z')] strategy hunt start profile=${PROFILE_NAME} load1m=${CURRENT_LOAD} memAvailableMb=${CURRENT_MEM_MB}"
cd "$ROOT_DIR"

if command -v ionice >/dev/null 2>&1; then
  HUNT_PREFIX=(ionice -c3 nice -n 10)
else
  HUNT_PREFIX=(nice -n 10)
fi

env \
  STRATEGY_HUNT_PROFILE_NAME="${PROFILE_NAME}" \
  "${HUNT_PREFIX[@]}" npm run hunt:crypto
rc=$?

if [ "$rc" -eq 0 ] && [ "${STRATEGY_HUNT_BUILD_REGISTRY:-1}" = "1" ]; then
  env \
    STRATEGY_HUNT_PROFILE_NAME="${PROFILE_NAME}" \
    "${HUNT_PREFIX[@]}" npm run hunt:registry
  registry_rc=$?
  echo "[$(date '+%Y-%m-%d %H:%M:%S %Z')] strategy hunt registry profile=${PROFILE_NAME} rc=${registry_rc}"
  if [ "$registry_rc" -ne 0 ]; then
    rc="$registry_rc"
  fi
fi

echo "[$(date '+%Y-%m-%d %H:%M:%S %Z')] strategy hunt end profile=${PROFILE_NAME} rc=$rc"
exit "$rc"
