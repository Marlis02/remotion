/**
 * SP-3d: расхождение В ПИКСЕЛЯХ между двумя наборами кадров.
 *
 * Приём тот же, что в SP-3 и SP-3c: PNG → сырой rgb24, побайтовое сравнение, гистограмма
 * модулей отклонений, плюс PSNR из sp3/lib/media.mjs. Скрипт написан заново, а не
 * переиспользован, по той же причине, что и энкод: sp3c/pixeldiff.mjs и sp3/pixeldiff.mjs
 * пишут в `results/raw` СВОИХ спайков, то есть их вызов изменил бы SP-3c или SP-3.
 * Библиотека приборов (`sp3/lib/media.mjs`) при этом импортируется, а не копируется.
 *
 * Использование: node pixeldiff.mjs <dirA> <dirB> <меткаA> <меткаB> [первый] [последний]
 */
import {execFile} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {promisify} from 'node:util';
import {ROOT, BIN} from './lib/env.mjs';
import {psnrBetweenPngDirs} from '../sp3/lib/media.mjs';

process.env.PATH = `${BIN}:${process.env.PATH}`;
const pexecFile = promisify(execFile);
const [dirAArg, dirBArg, labelA = 'A', labelB = 'B', firstArg, lastArg] = process.argv.slice(2);
if (!dirAArg || !dirBArg) {
  console.error('использование: node pixeldiff.mjs <dirA> <dirB> [меткаA] [меткаB] [первый] [последний]');
  process.exit(2);
}
const abs = (d) => (path.isAbsolute(d) ? d : path.join(ROOT, d));
const dirA = abs(dirAArg);
const dirB = abs(dirBArg);
const OUT = path.join(ROOT, 'out');
const RAW = path.join(ROOT, 'results/raw');
fs.mkdirSync(RAW, {recursive: true});
fs.mkdirSync(OUT, {recursive: true});

const listPng = (d) => fs.readdirSync(d).filter((f) => /\.png$/i.test(f)).sort();
const filesA = listPng(dirA);
const filesB = listPng(dirB);
const first = firstArg ? Number(firstArg) : 0;
const last = lastArg ? Number(lastArg) : Math.min(filesA.length, filesB.length) - 1;

const rawOf = async (png, tag) => {
  const out = path.join(OUT, `pxd-${tag}.rgb`);
  await pexecFile('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', png, '-pix_fmt', 'rgb24', '-f', 'rawvideo', out], {maxBuffer: 8 * 1024 * 1024});
  const buf = fs.readFileSync(out);
  fs.rmSync(out, {force: true});
  return buf;
};

const doc = {
  schema: 'sp3d-pixeldiff/1',
  capturedAt: new Date().toISOString(),
  a: {label: labelA, dir: path.relative(path.dirname(ROOT), dirA), pngCount: filesA.length},
  b: {label: labelB, dir: path.relative(path.dirname(ROOT), dirB), pngCount: filesB.length},
  frameRange: [first, last],
  frames: [],
};
const slug = `${labelA}--vs--${labelB}`.replace(/[^a-zA-Z0-9._-]/g, '_');
const outFile = path.join(RAW, `pixeldiff-${slug}.json`);
const flush = () => fs.writeFileSync(outFile, JSON.stringify(doc, null, 2) + '\n');
flush();

let identical = 0;
for (let i = first; i <= last; i++) {
  if (i >= filesA.length || i >= filesB.length) break;
  const a = await rawOf(path.join(dirA, filesA[i]), 'a');
  const b = await rawOf(path.join(dirB, filesB[i]), 'b');
  if (a.length !== b.length) {
    doc.frames.push({index: i, fileA: filesA[i], fileB: filesB[i], error: `разный размер сырого кадра: ${a.length} против ${b.length}`});
    flush();
    continue;
  }
  if (a.equals(b)) {
    identical += 1;
    doc.frames.push({index: i, fileA: filesA[i], fileB: filesB[i], identical: true});
    continue;
  }
  let differing = 0;
  let maxAbs = 0;
  let sumSq = 0;
  const hist = {};
  for (let k = 0; k < a.length; k++) {
    const d = Math.abs(a[k] - b[k]);
    if (d) {
      differing += 1;
      if (d > maxAbs) maxAbs = d;
      hist[d] = (hist[d] ?? 0) + 1;
      sumSq += d * d;
    }
  }
  const mse = sumSq / a.length;
  doc.frames.push({
    index: i,
    fileA: filesA[i],
    fileB: filesB[i],
    identical: false,
    totalSubpixels: a.length,
    differingSubpixels: differing,
    differingSharePercent: Math.round((differing / a.length) * 1e6) / 1e4,
    maxAbsDiff: maxAbs,
    mse: Math.round(mse * 1e4) / 1e4,
    psnrDb: mse > 0 ? Math.round(10 * Math.log10((255 * 255) / mse) * 100) / 100 : null,
    histogramOfAbsDiff: Object.fromEntries(Object.entries(hist).sort((x, y) => Number(x[0]) - Number(y[0])).slice(0, 12)),
  });
  flush();
}

const diff = doc.frames.filter((f) => f.identical === false && !f.error);
const med = (arr) => (arr.length ? [...arr].sort((x, y) => x - y)[Math.floor(arr.length / 2)] : null);
doc.summary = {
  framesCompared: doc.frames.length,
  identicalFrames: identical,
  differingFrames: diff.length,
  maxAbsDiffOverall: diff.length ? Math.max(...diff.map((f) => f.maxAbsDiff)) : 0,
  maxDifferingSharePercent: diff.length ? Math.max(...diff.map((f) => f.differingSharePercent)) : 0,
  medianDifferingSharePercent: med(diff.map((f) => f.differingSharePercent)),
  minPsnrDb: diff.length ? Math.min(...diff.map((f) => f.psnrDb)) : null,
  medianPsnrDb: med(diff.map((f) => f.psnrDb)),
};
// PSNR по всему диапазону прибором SP-3 — чтобы число было сопоставимо с SP-3/SP-3c.
try {
  doc.psnrWholeRange = await psnrBetweenPngDirs(dirA, dirB, path.join(OUT, `psnr-${slug}.log`));
} catch (e) {
  doc.psnrWholeRange = {error: String(e.message ?? e).slice(0, 400)};
}
flush();
console.log(JSON.stringify(doc.summary, null, 2));
