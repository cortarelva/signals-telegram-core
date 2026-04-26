#!/usr/bin/env bash

set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-/opt/TorusAiTrading}"
PROJECT_USER="${PROJECT_USER:-$USER}"
NODE_MAJOR="${NODE_MAJOR:-22}"

echo "[hetzner] starting runtime bootstrap"
echo "[hetzner] project dir: ${PROJECT_DIR}"
echo "[hetzner] project user: ${PROJECT_USER}"

if ! command -v apt-get >/dev/null 2>&1; then
  echo "[hetzner][error] this bootstrap script expects Ubuntu/Debian with apt-get" >&2
  exit 1
fi

sudo apt-get update
sudo apt-get install -y \
  ca-certificates \
  curl \
  git \
  build-essential \
  sqlite3 \
  ufw

if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'process.versions.node.split(`.`)[0]')" -lt "${NODE_MAJOR}" ]; then
  echo "[hetzner] installing Node.js ${NODE_MAJOR}.x"
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | sudo -E bash -
  sudo apt-get install -y nodejs
fi

sudo mkdir -p "${PROJECT_DIR}"
sudo chown -R "${PROJECT_USER}:${PROJECT_USER}" "${PROJECT_DIR}"

mkdir -p "${PROJECT_DIR}/logs"

if [ -f "${PROJECT_DIR}/package-lock.json" ]; then
  echo "[hetzner] installing npm dependencies from package-lock.json"
  cd "${PROJECT_DIR}"
  npm ci
else
  echo "[hetzner][warn] package-lock.json not found in ${PROJECT_DIR}; skipping npm ci"
fi

echo "[hetzner] bootstrap complete"
echo "[hetzner] next steps:"
echo "  1. copy your .env into ${PROJECT_DIR}/.env"
echo "  2. install the systemd service files from deploy/hetzner/systemd/"
echo "  3. enable torus-ai-trading-bot.service and torus-ai-trading-dashboard.service"
