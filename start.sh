#!/bin/bash

set -u

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
BOT_PID_FILE="$ROOT_DIR/bot.pid"
DASHBOARD_PID_FILE="$ROOT_DIR/dashboard.pid"
BOT_LOOP_PATTERN="runtime/run-bot-loop.sh|runtime/signals-telegram-core.js"
DASHBOARD_PATTERN="runtime/run-dashboard.sh|runtime/dashboard-server.js"

find_running_pid() {
  local pid_file="$1"
  local pattern="$2"

  if [ -f "$pid_file" ]; then
    local pid
    pid="$(cat "$pid_file" 2>/dev/null || true)"
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      echo "$pid"
      return 0
    fi
  fi

  pgrep -fo "$pattern"
}

stop_pid_tree() {
  local pid="$1"
  [ -n "$pid" ] || return 0

  pkill -TERM -P "$pid" 2>/dev/null || true
  kill "$pid" 2>/dev/null || true
}

echo "🚀 A arrancar bot e dashboard..."

mkdir -p "$ROOT_DIR/logs"

echo "A sincronizar espelho SQLite..."
node "$ROOT_DIR/runtime/bootstrap-sqlite-store.js" >/dev/null 2>&1 || true

existing_bot_pid="$(find_running_pid "$BOT_PID_FILE" "$BOT_LOOP_PATTERN")"
if [ -n "${existing_bot_pid:-}" ]; then
  echo "A parar bot antigo (PID $existing_bot_pid)..."
  stop_pid_tree "$existing_bot_pid"
fi

existing_dashboard_pid="$(find_running_pid "$DASHBOARD_PID_FILE" "$DASHBOARD_PATTERN")"
if [ -n "${existing_dashboard_pid:-}" ]; then
  echo "A parar dashboard antigo (PID $existing_dashboard_pid)..."
  stop_pid_tree "$existing_dashboard_pid"
fi

rm -f "$BOT_PID_FILE" "$DASHBOARD_PID_FILE"

nohup bash "$ROOT_DIR/runtime/run-bot-loop.sh" >/dev/null 2>&1 &
echo $! > "$BOT_PID_FILE"
echo "Bot iniciado em loop (PID $(cat "$BOT_PID_FILE"))"

nohup bash "$ROOT_DIR/runtime/run-dashboard.sh" >/dev/null 2>&1 &
echo $! > "$DASHBOARD_PID_FILE"
echo "Dashboard iniciado (PID $(cat "$DASHBOARD_PID_FILE"))"

echo "✅ Sistema iniciado"
