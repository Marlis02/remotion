#!/bin/bash
# SP-3d: сведение. Ничего не рендерит — только читает results/raw и out.
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh" >/dev/null 2>&1
cd "$(dirname "$0")"
set -u
echo "── детерминизм по группам"
node determinism.mjs || true
echo "── таблица «локально SP-3c против Docker SP-3d»"
node compare-sp3c.mjs || true
echo "── Q4: Docker против локального софтверного пути"
node q4-compare.mjs || true
echo "── Q4 до энкодера: PNG-сиквенсы и свой энкод"
node png-compare.mjs || true
echo "── сводка"
node lib/summary.mjs || true
