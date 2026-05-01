#!/bin/bash

set -e

echo "🔁 Restaurar última configuração automática..."

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_DIR"

CONFIG_FILE="strategy-config.generated.json"
BACKUP_DIR="config-history"

if [ ! -d "$BACKUP_DIR" ]; then
  echo "❌ Pasta config-history não existe."
  exit 1
fi

LAST_BACKUP=$(ls -t $BACKUP_DIR/strategy-config.generated.*.json 2>/dev/null | head -n 1)

if [ -z "$LAST_BACKUP" ]; then
  echo "❌ Nenhum backup encontrado."
  exit 1
fi

echo "📦 Último backup encontrado:"
echo "$LAST_BACKUP"

echo ""
echo "♻️ Restaurar configuração..."

cp "$LAST_BACKUP" "$CONFIG_FILE"

echo "✅ Configuração restaurada."

echo ""
echo "🔄 Reiniciar bot..."

./restart.sh

echo ""
echo "🚀 Sistema a correr com configuração restaurada."