#!/bin/bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"

node "$ROOT_DIR/botstatus-btc-gated-bearish-lab.js"
node "$ROOT_DIR/dashboardstatus-btc-gated-bearish-lab.js"
