/**
 * SP-3: РАСПРЕДЕЛЕНИЕ расхождений между повторными прогонами.
 *
 * Зачем. Charter AC4: на `render.ac4.yaml` порог нулевой, а «на профиле `final` порог задаётся
 * измеренным распределением, а не на глаз». Значит, ответа «framemd5 разошёлся» недостаточно:
 * нужно знать, на сколько именно. PSNR = inf у кадра означает побитовое совпадение.
 *
 * Вход — mp4, оставшиеся от determinism.mjs (блоки A и B).
 */
import fs from 'node:fs';
import path from 'node:path';
import {psnrBetweenFiles, psnrDistribution} from './lib/media.mjs';
import {ROOT, getVersions, snapshotState} from './lib/sysinfo.mjs';
import {writeSummary} from './lib/summary.mjs';

const OUT = path.join(ROOT, 'out');
const RAW = path.join(ROOT, 'results/raw');
const outFile = path.join(RAW, 'distribution.json');

const doc = {
  schema: 'sp3-distribution/1',
  capturedAt: new Date().toISOString(),
  versions: getVersions(),
  state: snapshotState(),
  pairs: [],
};
const flush = () => {
  fs.writeFileSync(outFile, JSON.stringify(doc, null, 2) + '\n');
  try {
    writeSummary();
  } catch {
    /* пересоберётся позже */
  }
};
flush();

const pairs = [
  {label: 'A: final/swangle/c4, прогон 1 против 2', a: 'det-A-swangle-4-final-r1.mp4', b: 'det-A-swangle-4-final-r2.mp4', profile: 'final'},
  {label: 'A: final/swangle/c4, прогон 1 против 3', a: 'det-A-swangle-4-final-r1.mp4', b: 'det-A-swangle-4-final-r3.mp4', profile: 'final'},
  {label: 'B: ac4/swangle/c1, прогон 1 против 2', a: 'det-B-swangle-1-ac4-r1.mp4', b: 'det-B-swangle-1-ac4-r2.mp4', profile: 'ac4'},
  {label: 'B: ac4/swangle/c1, прогон 1 против 3', a: 'det-B-swangle-1-ac4-r1.mp4', b: 'det-B-swangle-1-ac4-r3.mp4', profile: 'ac4'},
  {label: 'матрица: final/swangle, concurrency 1 против 4', a: 'swangle-1-final.mp4', b: 'swangle-4-final.mp4', profile: 'final'},
  {label: 'матрица: final/swangle, concurrency 1 против 2', a: 'swangle-1-final.mp4', b: 'swangle-2-final.mp4', profile: 'final'},
  {label: 'матрица: final/angle, concurrency 1 против 4', a: 'angle-1-final.mp4', b: 'angle-4-final.mp4', profile: 'final'},
];

for (const p of pairs) {
  const fa = path.join(OUT, p.a);
  const fb = path.join(OUT, p.b);
  if (!fs.existsSync(fa) || !fs.existsSync(fb)) {
    doc.pairs.push({...p, status: 'SKIPPED', reason: 'нет одного из файлов (mp4 не коммитятся; пересними прогон)'});
    flush();
    console.log(`— ${p.label}: пропущено, нет файла`);
    continue;
  }
  const r = await psnrBetweenFiles(fa, fb, path.join(OUT, 'dist.psnr'));
  const dist = psnrDistribution(r.frames);
  doc.pairs.push({...p, status: 'OK', command: r.command, ms: r.ms, distribution: dist});
  flush();
  console.log(
    `${p.label}: побитово совпало ${dist.identicalFrames}/${dist.frames} кадров, ` +
      `PSNR min ${dist.psnrMinDb} dB, p50 ${dist.psnrP50Db} dB, кадров < 40 dB: ${dist.framesBelow40Db}`,
  );
}
doc.finishedAt = new Date().toISOString();
flush();
