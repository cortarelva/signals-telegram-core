#!/bin/bash

set -e

echo "🔄 Reiniciar sistema + recalibrar"

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_DIR"

required_files=(
  "stop.sh"
  "start.sh"
  "auto-calibrate.js"
)

for file in "${required_files[@]}"; do
  if [ ! -f "$file" ]; then
    echo "❌ Ficheiro em falta: $file"
    exit 1
  fi
done

echo ""
echo "1) Parar bot e dashboard..."
./stop.sh || true

echo ""
echo "2) Correr auto-calibrate..."
node auto-calibrate.js

echo ""
echo "3) Arrancar bot e dashboard..."
./start.sh

echo ""
echo "✅ Recalibração concluída e sistema reiniciado."