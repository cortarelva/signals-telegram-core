#!/bin/bash

set -u

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
export STRATEGY_HUNT_PROFILE_ENV_FILE="${STRATEGY_HUNT_PROFILE_ENV_FILE:-$ROOT_DIR/runtime/strategy-hunt.broad.env.sh}"
exec /usr/bin/bash "$ROOT_DIR/runtime/run-strategy-hunt.sh"
