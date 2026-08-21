#!/bin/bash
set +e
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh" >/dev/null 2>&1
cd /home/ct/Desktop/remotion/docs/spikes/sp3c
export PATH="$(pwd)/bin:$PATH"
echo "########## N: идиоматичная композиция при workers=2 и при w=1 на SwiftShader ##########"; date +%H:%M
node matrix.mjs jobs/hf-n-idiom-w2.json
echo "########## финальная сводка ##########"; date +%H:%M
node variant-diff.mjs
node determinism.mjs
node startup-cost.mjs
node fixture.mjs
node machine.mjs
node lib/summary.mjs
echo "########## ЧАСТЬ 6 ГОТОВА ##########"; date +%H:%M; df -h /home/ct | tail -1
