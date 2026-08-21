#!/bin/bash
# SP-3c: пятая часть — проверить, что вывод «SwiftShader и workers=1 детерминированы»
# держится и на композиции другого стиля, а не только на нашей.
set +e
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh" >/dev/null 2>&1
cd /home/ct/Desktop/remotion/docs/spikes/sp3c
export PATH="$(pwd)/bin:$PATH"
echo "########## M: идиоматичная композиция на SwiftShader и при workers=1 ##########"; date +%H:%M
node matrix.mjs jobs/hf-m-idiom-modes.json
echo "########## финальная сводка ##########"; date +%H:%M
node variant-diff.mjs
node determinism.mjs
node startup-cost.mjs
node fixture.mjs
node machine.mjs
node lib/summary.mjs
echo "########## ЧАСТЬ 5 ГОТОВА ##########"; date +%H:%M; df -h /home/ct | tail -1
