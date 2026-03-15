#!/bin/bash

echo "🛑 A parar sistema..."

if [ -f bot.pid ]; then
  kill $(cat bot.pid) 2>/dev/null
  rm bot.pid
  echo "Bot parado"
fi

if [ -f dashboard.pid ]; then
  kill $(cat dashboard.pid) 2>/dev/null
  rm dashboard.pid
  echo "Dashboard parado"
fi

echo "✅ Sistema parado"