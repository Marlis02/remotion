#!/bin/bash
# SP-3d: остаток матрицы одной цепочкой. Запускать под `sg docker -c ./run-rest.sh`.
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh" >/dev/null 2>&1
cd "$(dirname "$0")"
set -u
echo "───── серия из 10 подряд (аналог блока G SP-3c) · $(date '+%H:%M:%S') ─────"
node matrix.mjs jobs/d-g-repeat.json || true
echo "───── серия повторов на идиоматичной композиции · $(date '+%H:%M:%S') ─────"
node matrix.mjs jobs/d-h-idiom-repeat.json || true
echo "───── парный локальный софтверный путь · $(date +%H:%M:%S) ─────"
node matrix.mjs jobs/d-e-local.json || true
echo "───── Q5: сеть контейнера · $(date '+%H:%M:%S') ─────"
node netcheck.mjs || true
echo "───── прямой прогон 60 с · $(date '+%H:%M:%S') ─────"
node matrix.mjs jobs/d-l-long.json || true
echo "───── всё пройдено · $(date '+%H:%M:%S') ─────"
