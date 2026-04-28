#!/bin/bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"

node "$ROOT_DIR/botstart-btc-gated-bearish-lab.js"
node "$ROOT_DIR/dashboardstart-btc-gated-bearish-lab.js"

echo "Dashboard: http://127.0.0.1:3006"
