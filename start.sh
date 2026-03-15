#!/bin/bash

set -u

echo "🚀 A arrancar bot e dashboard..."

mkdir -p logs

# parar processos antigos se existirem
if [ -f bot.pid ] && kill -0 "$(cat bot.pid)" 2>/dev/null; then
  echo "A parar bot antigo (PID $(cat bot.pid))..."
  kill "$(cat bot.pid)" 2>/dev/null || true
fi

if [ -f dashboard.pid ] && kill -0 "$(cat dashboard.pid)" 2>/dev/null; then
  echo "A parar dashboard antigo (PID $(cat dashboard.pid))..."
  kill "$(cat dashboard.pid)" 2>/dev/null || true
fi

rm -f bot.pid dashboard.pid

# bot em loop
nohup bash -c 'while true; do node signals-telegram-core.js; sleep 60; done' \
  > logs/bot.log 2>&1 &
echo $! > bot.pid
echo "Bot iniciado em loop (PID $(cat bot.pid))"

# dashboard servidor web
nohup node dashboard-server.js > logs/dashboard.log 2>&1 &
echo $! > dashboard.pid
echo "Dashboard iniciado (PID $(cat dashboard.pid))"

echo "✅ Sistema iniciado"