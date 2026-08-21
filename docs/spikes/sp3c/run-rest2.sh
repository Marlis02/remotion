#!/bin/bash
# SP-3c: третья часть — идиоматичный вариант композиции (Q6) и досводка отчётов.
set +e
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh" >/dev/null 2>&1
cd /home/ct/Desktop/remotion/docs/spikes/sp3c
export PATH="$(pwd)/bin:$PATH"
step () { echo "########## $* ##########"; date +%H:%M; }

step "линт идиоматичного варианта"
node node_modules/.bin/hyperframes lint src-idiomatic 2>&1 | sed 's/\x1b\[[0-9;]*m//g'

step "прогон идиоматичного варианта (3 mp4 + PNG-сиквенс)"
node matrix.mjs jobs/hf-i-idiomatic.json

step "цена авторской модели в пикселях: точная композиция против идиоматичной"
node pixeldiff.mjs out/hfE-png-w4-gpu-r1 out/hfI-idiom-png-w4-gpu hyperframes-tochnaya hyperframes-idiomatichnaya 0 299

step "досводка"
node determinism.mjs
node startup-cost.mjs
node fixture.mjs
node machine.mjs
node lib/summary.mjs
echo "########## ЧАСТЬ 3 ГОТОВА ##########"; date +%H:%M; df -h /home/ct | tail -1
