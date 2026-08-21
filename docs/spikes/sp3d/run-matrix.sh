#!/bin/bash
# SP-3d: вся матрица одной цепочкой. Запускать под `sg docker -c ./run-matrix.sh`:
# группа docker наследуется всеми потомками — драйвером, CLI и самим docker.
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh" >/dev/null 2>&1
cd "$(dirname "$0")"
set -u
for f in "$@"; do
  echo "───── $f · $(date '+%H:%M:%S') ─────"
  node matrix.mjs "jobs/$f" || echo "БЛОК $f завершился с ошибкой драйвера — продолжаю"
done
echo "───── все блоки пройдены · $(date '+%H:%M:%S') ─────"
