/**
 * SP-3e: ГДЕ расходятся прогоны — по окнам элементов.
 * Берёт покадровый PSNR расходящейся пары и раскладывает различающиеся кадры
 * по отрезкам пяти элементов. Это ответ на вопрос «какой элемент композиции
 * не воспроизводится», а не только «воспроизводится ли композиция».
 */
import fs from 'node:fs';
import path from 'node:path';
import {ROOT} from './lib/env.mjs';
import {psnrBetweenFiles} from '../sp3/lib/media.mjs';

const D = JSON.parse(fs.readFileSync(path.join(ROOT, 'data.json'), 'utf8'));
const PAIRS = JSON.parse(process.argv[2] ?? '[["MH-w4-r1","MH-w4-r10"],["MH-w4-r1","MH-w4-r8"],["MH1-w1-r1","MH1-w1-r2"]]');

const out = [];
for (const [a, b] of PAIRS) {
  const {frames} = await psnrBetweenFiles(
    path.join(ROOT, 'out', `${a}.mp4`), path.join(ROOT, 'out', `${b}.mp4`),
    path.join(ROOT, 'results/raw', `psnr-where-${a}-${b}.txt`));
  const diff = frames.filter((f) => Number.isFinite(f.psnrAvg)).map((f) => f.n - 1); // n в статистике с 1
  const byWindow = {};
  for (const [name, w] of Object.entries(D.windows)) {
    const inW = diff.filter((n) => n >= w.from && n < w.to);
    byWindow[name] = {window: [w.from, w.to], framesInWindow: w.to - w.from, differing: inW.length,
      share: Math.round((inW.length / (w.to - w.from)) * 1000) / 10};
  }
  out.push({pair: [a, b], differingFrames: diff.length, totalFrames: frames.length,
    firstDiffFrame: diff[0] ?? null, lastDiffFrame: diff.at(-1) ?? null, byWindow,
    runs: diff.reduce((acc, n) => { const last = acc.at(-1); if (last && n === last[1] + 1) last[1] = n; else acc.push([n, n]); return acc; }, []).slice(0, 20)});
}
fs.writeFileSync(path.join(ROOT, 'results/raw/where.json'), JSON.stringify({schema: 'sp3e-where/1', pairs: out}, null, 2) + '\n');
for (const o of out) {
  console.log(`${o.pair.join(' / ')}: ${o.differingFrames} из ${o.totalFrames}, первый ${o.firstDiffFrame}, последний ${o.lastDiffFrame}`);
  for (const [k, v] of Object.entries(o.byWindow)) console.log(`   ${k} [${v.window[0]}..${v.window[1]}) — ${v.differing} из ${v.framesInWindow} (${v.share} %)`);
  console.log(`   отрезки: ${o.runs.map((r) => r[0] === r[1] ? r[0] : `${r[0]}–${r[1]}`).join(', ')}`);
}
