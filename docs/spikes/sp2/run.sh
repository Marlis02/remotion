#!/usr/bin/env bash
# Единая точка запуска: node из nvm (в PATH его нет) + .env через --env-file.
# Скрипты сами .env не читают — ключ и голос приходят только через process.env.
set -euo pipefail
NODE_BIN="$HOME/.nvm/versions/node/v22.22.1/bin/node"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
exec "$NODE_BIN" --env-file="$ROOT/.env" "$@"
