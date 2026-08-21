/**
 * SP-3f: ГДЕ расходятся прогоны — по окнам слоёв режиссуры и по bbox.
 * Покадровый PSNR расходящейся пары раскладывается по восьми окнам
 * (фон, параллакс, типографика, частицы, карточка, переход, финал, субтитры),
 * а на трёх опорных кадрах считается bbox ненулевой разности — то есть
 * КАКОЙ слой не воспроизводится, а не только «воспроизводится ли рендер».
 */
import {execFile} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {promisify} from 'node:util';
import {ROOT, BIN} from './lib/env.mjs';
import {psnrBetweenFiles} from '../sp3/lib/media.mjs';
process.env.PATH = `${BIN}:${process.env.PATH}`;
const p = promisify(execFile);

const D = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/data/hook.js'), 'utf8').replace(/^window\.__HOOK = /, '').replace(/;\n$/, ''));
const PAIRS = JSON.parse(process.argv[2] ?? '[]');

const rgb = async (file, frame) => {
  const {stdout} = await p(path.join(BIN, 'ffmpeg'), ['-hide_banner', '-nostdin', '-loglevel', 'error', '-i', file,
    '-vf', `select=eq(n\\,${frame})`, '-fps_mode', 'passthrough', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
    {encoding: 'buffer', maxBuffer: 256 * 1024 * 1024});
  return Buffer.from(stdout);
};
const bbox = async (a, b, frame) => {
  const [A, B] = await Promise.all([rgb(a, frame), rgb(b, frame)]);
  if (A.length !== B.length || A.length < 1080 * 1920 * 3) return null;
  let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1, diff = 0, maxAbs = 0;
  for (let y = 0; y < 1920; y++) {
    for (let x = 0; x < 1080; x++) {
      const i = (y * 1080 + x) * 3;
      const d = Math.max(Math.abs(A[i] - B[i]), Math.abs(A[i + 1] - B[i + 1]), Math.abs(A[i + 2] - B[i + 2]));
      if (d) { diff++; if (d > maxAbs) maxAbs = d; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
  }
  return x1 < 0 ? {empty: true} : {x: [x0, x1], y: [y0, y1], differingPixels: diff, sharePct: Math.round((diff / (1080 * 1920)) * 10000) / 100, maxLevel: maxAbs};
};

const out = [];
for (const [a, b] of PAIRS) {
  const {frames} = await psnrBetweenFiles(path.join(ROOT, 'out', `${a}.mp4`), path.join(ROOT, 'out', `${b}.mp4`),
    path.join(ROOT, 'results/raw', `psnr-where-${a}-${b}.txt`));
  const diff = frames.filter((f) => Number.isFinite(f.psnrAvg)).map((f) => f.n - 1);
  const byWindow = {};
  for (const [name, w] of Object.entries(D.windows)) {
    const inW = diff.filter((n) => n >= w.from && n < w.to);
    byWindow[name] = {window: [w.from, w.to], framesInWindow: w.to - w.from, differing: inW.length,
      share: Math.round((inW.length / (w.to - w.from)) * 1000) / 10};
  }
  const probes = {};
  for (const fr of [20, 150, 250, 400]) {
    if (diff.includes(fr)) probes[fr] = await bbox(path.join(ROOT, 'out', `${a}.mp4`), path.join(ROOT, 'out', `${b}.mp4`), fr);
    else probes[fr] = {identical: true};
  }
  out.push({pair: [a, b], differingFrames: diff.length, totalFrames: frames.length,
    firstDiffFrame: diff[0] ?? null, lastDiffFrame: diff.at(-1) ?? null, byWindow, bboxAtFrames: probes,
    runs: diff.reduce((acc, n) => { const last = acc.at(-1); if (last && n === last[1] + 1) last[1] = n; else acc.push([n, n]); return acc; }, []).slice(0, 24)});
}
fs.writeFileSync(path.join(ROOT, 'results/raw/where.json'), JSON.stringify({schema: 'sp3f-where/1', pairs: out}, null, 2) + '\n');
for (const o of out) {
  console.log(`${o.pair.join(' / ')}: ${o.differingFrames} из ${o.totalFrames}, первый ${o.firstDiffFrame}, последний ${o.lastDiffFrame}`);
  for (const [k, v] of Object.entries(o.byWindow)) console.log(`   ${k} [${v.window[0]}..${v.window[1]}) — ${v.differing} из ${v.framesInWindow} (${v.share} %)`);
  console.log(`   отрезки: ${o.runs.map((r) => r[0] === r[1] ? r[0] : `${r[0]}–${r[1]}`).join(', ')}`);
  for (const [fr, bb] of Object.entries(o.bboxAtFrames)) console.log(`   кадр ${fr}: ${JSON.stringify(bb)}`);
}
