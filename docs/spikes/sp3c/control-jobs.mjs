/** SP-3c: список прогонов контрольного Remotion на ЭТОЙ машине. */
import fs from 'node:fs';
import path from 'node:path';
import {ROOT} from './lib/env.mjs';

const jobs = [];
const add = (runId, o) => jobs.push({runId, script: 'control/runner.mjs', outputPath: `out/${runId}.mp4`, timeoutSec: 900, skipIfDone: true, ...o});

// Аппаратный ANGLE — прямой аналог пути HyperFrames по умолчанию.
for (const profile of ['final', 'draft']) {
  for (const concurrency of [1, 2, 4]) {
    for (const r of [1, 2, 3]) add(`ctlA-${profile}-c${concurrency}-angle-r${r}`, {gl: 'angle', concurrency, profile});
  }
}
// SwiftShader — то, на чём SP-3 нашёл недетерминизм. Проверяем, воспроизводится ли на другой машине.
for (const concurrency of [1, 4]) {
  for (const r of [1, 2, 3]) add(`ctlB-final-c${concurrency}-swangle-r${r}`, {gl: 'swangle', concurrency, profile: 'final'});
}
for (const r of [1, 2, 3]) add(`ctlB-draft-c4-swangle-r${r}`, {gl: 'swangle', concurrency: 4, profile: 'draft'});

fs.writeFileSync(path.join(ROOT, 'jobs/ctl.json'), JSON.stringify(jobs, null, 2) + '\n');
console.log(`jobs/ctl.json: ${jobs.length}`);
