#!/bin/bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"

node "$ROOT_DIR/botstop-btc-gated-bearish-lab.js"
node "$ROOT_DIR/dashboardstop-btc-gated-bearish-lab.js"
