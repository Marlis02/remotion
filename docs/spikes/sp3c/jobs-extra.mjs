/** SP-3c: добавочные списки прогонов, которые понадобились по ходу. */
import fs from 'node:fs';
import path from 'node:path';
import {ROOT} from './lib/env.mjs';

// Блок G: серия повторов одной настройки, чтобы измерить ЧАСТОТУ варианта,
// а не только его наличие. Три прогона показывают «есть/нет», десять — «как часто».
const G = [];
for (let r = 1; r <= 10; r++) {
  G.push({runId: `hfG-final-w4-gpu-x${String(r).padStart(2, '0')}`, profile: 'final', workers: 4, gpu: 'gpu', outputPath: `out/hfG-final-w4-gpu-x${String(r).padStart(2, '0')}.mp4`, timeoutSec: 600, skipIfDone: true});
}
fs.writeFileSync(path.join(ROOT, 'jobs/hf-g-repeat.json'), JSON.stringify(G, null, 2) + '\n');
console.log(`hf-g-repeat.json: ${G.length}`);

// Блок H: PNG-сиквенс Remotion на этой машине (для попиксельного сравнения с HyperFrames, Q6).
const H = [];
for (const gl of ['angle', 'swangle']) {
  H.push({
    runId: `ctlP-png-c4-${gl}`,
    script: 'control/runner.mjs',
    gl,
    concurrency: 4,
    profile: 'final',
    mode: 'frames',
    framesOutDir: `out/ctlP-png-c4-${gl}`,
    outputPath: `out/ctlP-png-c4-${gl}`,
    timeoutSec: 1200,
    skipIfDone: true,
  });
}
fs.writeFileSync(path.join(ROOT, 'jobs/ctl-png.json'), JSON.stringify(H, null, 2) + '\n');
console.log(`ctl-png.json: ${H.length}`);

// Блок H: локализация варианта под нагрузкой — та же нагрузка при workers 1 и 2.
// Три прогона при w=4 под нагрузкой дали ДРУГОЙ framemd5, чем чистые; вопрос,
// нагрузка ли это сама по себе или её сочетание с параллелизмом.
const H2 = [];
for (const workers of [1, 2]) {
  for (const r of [1, 2, 3]) {
    const id = `hfH-final-w${workers}-gpu-load6-r${r}`;
    H2.push({runId: id, profile: 'final', workers, gpu: 'gpu', cpuLoad: 6, outputPath: `out/${id}.mp4`, timeoutSec: 900, skipIfDone: true});
  }
}
fs.writeFileSync(path.join(ROOT, 'jobs/hf-h-cpuload-w1w2.json'), JSON.stringify(H2, null, 2) + '\n');
console.log(`hf-h-cpuload-w1w2.json: ${H2.length}`);
