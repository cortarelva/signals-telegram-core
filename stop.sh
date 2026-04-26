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

echo "🛑 A parar sistema..."

bot_pid="$(find_running_pid "$BOT_PID_FILE" "$BOT_LOOP_PATTERN")"
if [ -n "${bot_pid:-}" ]; then
  stop_pid_tree "$bot_pid"
  echo "Bot parado (PID $bot_pid)"
fi
rm -f "$BOT_PID_FILE"

dashboard_pid="$(find_running_pid "$DASHBOARD_PID_FILE" "$DASHBOARD_PATTERN")"
if [ -n "${dashboard_pid:-}" ]; then
  stop_pid_tree "$dashboard_pid"
  echo "Dashboard parado (PID $dashboard_pid)"
fi
rm -f "$DASHBOARD_PID_FILE"

echo "✅ Sistema parado"
