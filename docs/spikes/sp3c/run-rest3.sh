#!/bin/bash
# SP-3c: четвёртая часть — локализация разброса (SwiftShader под нагрузкой, частота варианта).
set +e
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh" >/dev/null 2>&1
cd /home/ct/Desktop/remotion/docs/spikes/sp3c
export PATH="$(pwd)/bin:$PATH"
step () { echo "########## $* ##########"; date +%H:%M; }

step "перепрогон первых контрольных Remotion: они сняты до правки, без RSS и без верификации"
for f in results/raw/ctlA-final-c1-angle-r1.json results/raw/ctlA-final-c1-angle-r2.json \
         results/raw/ctlA-final-c1-angle-r3.json results/raw/ctlA-final-c2-angle-r1.json \
         results/raw/ctlA-final-c2-angle-r2.json results/raw/ctlA-final-c2-angle-r3.json; do
  python3 - "$f" <<'PY2'
import json,sys,os
p=sys.argv[1]
if os.path.exists(p):
    d=json.load(open(p))
    if 'memory' not in d or 'verification' not in d:
        os.remove(p); print('удалён для перепрогона:', p)
PY2
done
node matrix.mjs jobs/ctl.json --only=ctlA-final-c1-angle
node matrix.mjs jobs/ctl.json --only=ctlA-final-c2-angle

step "J/K/L: SwiftShader под нагрузкой, частота варианта на аппаратном GPU, граница по workers"
node matrix.mjs jobs/hf-jkl.json

step "масштаб расхождения между вариантами mp4 в пикселях"
node variant-diff.mjs

step "финальная сводка"
node determinism.mjs
node startup-cost.mjs
node fixture.mjs
node machine.mjs
node lib/summary.mjs
echo "########## ЧАСТЬ 4 ГОТОВА ##########"; date +%H:%M; df -h /home/ct | tail -1
