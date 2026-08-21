#!/bin/bash
# SP-3c: вторая половина ночного прогона одной цепочкой.
# Каждый шаг независим: падение одного не останавливает остальные.
set +e
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh" >/dev/null 2>&1
cd /home/ct/Desktop/remotion/docs/spikes/sp3c
export PATH="$(pwd)/bin:$PATH"
step () { echo "########## $* ##########"; date +%H:%M; }

step "G: 10 повторов w4 (частота варианта)"
node matrix.mjs jobs/hf-g-repeat.json

step "H: нагрузка CPU при workers 1 и 2"
node matrix.mjs jobs/hf-h-cpuload-w1w2.json

step "контроль Remotion: preflight (скачать Chrome, собрать бандл)"
node control/preflight.mjs

step "контроль Remotion: матрица 27 прогонов"
node matrix.mjs jobs/ctl.json

step "контроль Remotion: PNG-сиквенсы для попиксельного сравнения"
node matrix.mjs jobs/ctl-png.json

step "V9: рендер в сетевом namespace"
node netcheck.mjs

step "собственный энкод PNG-сиквенсов рецептом SP-3"
node encode-png.mjs out/hfE-png-w4-gpu-r1 out/ctlP-png-c4-angle

step "прямой замер 60 секунд (оба рендерера)"
node long-run.mjs

step "воспроизводимость сборки и размеры (Q7)"
node build-repro.mjs

step "попиксельное сравнение HyperFrames против Remotion (Q6)"
node pixeldiff.mjs out/hfE-png-w4-gpu-r1 out/ctlP-png-c4-angle hyperframes-png remotion-angle-png 100 119
node pixeldiff.mjs out/hfE-png-w4-gpu-r1 out/hfE-png-w4-gpu-r2 hyperframes-r1 hyperframes-r2 100 119
node pixeldiff.mjs out/ctlP-png-c4-angle out/ctlP-png-c4-swangle remotion-angle remotion-swangle 100 119

step "сведение"
node determinism.mjs
node startup-cost.mjs
node fixture.mjs
node machine.mjs
node lib/summary.mjs

echo "########## ВСЁ ##########"; date +%H:%M; df -h /home/ct | tail -1
