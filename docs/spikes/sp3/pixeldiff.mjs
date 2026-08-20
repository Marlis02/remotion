/**
 * SP-3: насколько велико расхождение В ПИКСЕЛЯХ.
 *
 * Зачем. Блоки C/E/F дают «да/нет», distribution.mjs — PSNR по mp4, но mp4 — это lossy-энкод,
 * который усиливает крошечную разницу входа в разные решения квантователя. Чтобы понять, что
 * именно делает Chrome, нужна разница на СЫРЫХ кадрах: сколько пикселей и на сколько уровней.
 * Это то число, из которого можно писать порог AC4, если владелец решит, что нулевой порог
 * на профиле final недостижим.
 *
 * Меряется на коротком диапазоне кадров: вопрос качественный, полный ролик для него не нужен.
 */
import {execFile, spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {promisify} from 'node:util';
import {ROOT, getVersions, snapshotState} from './lib/sysinfo.mjs';

const pexecFile = promisify(execFile);
const OUT = path.join(ROOT, 'out');
const RAW = path.join(ROOT, 'results/raw');
const RANGE = [200, 219];

const runFrames = async (dir) => {
  const cfg = {
    runId: `pixeldiff-${path.basename(dir)}`,
    gl: 'swangle',
    concurrency: 1,
    profile: 'final',
    mode: 'frames',
    bundleMode: 'warm',
    framesOutDir: dir,
    frameRange: RANGE,
    resultPath: path.join(OUT, `${path.basename(dir)}.json`),
  };
  const child = spawn(process.execPath, [path.join(ROOT, 'runner.mjs'), JSON.stringify(cfg)], {cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit']});
  const code = await new Promise((r) => child.on('close', r));
  if (code !== 0) throw new Error(`прогон ${dir} упал с кодом ${code}`);
  return `node runner.mjs '${JSON.stringify(cfg)}'`;
};

/** PNG → сырой rgb24, чтобы сравнивать значения пикселей, а не байты контейнера. */
const rawOf = async (png) => {
  const out = path.join(OUT, `${path.basename(png, '.png')}-${path.basename(path.dirname(png))}.rgb`);
  await pexecFile('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', png, '-pix_fmt', 'rgb24', '-f', 'rawvideo', out]);
  const buf = fs.readFileSync(out);
  fs.rmSync(out, {force: true});
  return buf;
};

const doc = {
  schema: 'sp3-pixeldiff/1',
  capturedAt: new Date().toISOString(),
  versions: getVersions(),
  state: snapshotState(),
  frameRange: RANGE,
  config: 'gl=swangle, concurrency=1, профиль final (scale 1, 1080x1920), imageFormat=png, два прогона подряд',
  frames: [],
};
const outFile = path.join(RAW, 'pixeldiff.json');
const flush = () => fs.writeFileSync(outFile, JSON.stringify(doc, null, 2) + '\n');
flush();

const dirA = path.join(OUT, 'pxd-a');
const dirB = path.join(OUT, 'pxd-b');
doc.commandLines = [await runFrames(dirA), await runFrames(dirB)];
flush();

const filesA = fs.readdirSync(dirA).filter((f) => f.endsWith('.png')).sort();
const filesB = fs.readdirSync(dirB).filter((f) => f.endsWith('.png')).sort();
let identicalFiles = 0;
for (let i = 0; i < Math.min(filesA.length, filesB.length); i++) {
  const a = await rawOf(path.join(dirA, filesA[i]));
  const b = await rawOf(path.join(dirB, filesB[i]));
  if (a.equals(b)) {
    identicalFiles += 1;
    doc.frames.push({file: filesA[i], identical: true});
    continue;
  }
  let differingBytes = 0;
  let maxAbs = 0;
  const hist = {};
  for (let k = 0; k < Math.min(a.length, b.length); k++) {
    const d = Math.abs(a[k] - b[k]);
    if (d) {
      differingBytes += 1;
      if (d > maxAbs) maxAbs = d;
      hist[d] = (hist[d] ?? 0) + 1;
    }
  }
  doc.frames.push({
    file: filesA[i],
    identical: false,
    totalSubpixels: a.length,
    differingSubpixels: differingBytes,
    differingShare: Math.round((differingBytes / a.length) * 1e6) / 1e4, // в процентах, 4 знака
    maxAbsDiff: maxAbs,
    histogramOfAbsDiff: Object.fromEntries(Object.entries(hist).sort((x, y) => Number(x[0]) - Number(y[0])).slice(0, 12)),
  });
  flush();
}

const diff = doc.frames.filter((f) => !f.identical);
doc.summary = {
  framesCompared: doc.frames.length,
  identicalFrames: identicalFiles,
  differingFrames: diff.length,
  maxAbsDiffOverall: diff.length ? Math.max(...diff.map((f) => f.maxAbsDiff)) : 0,
  maxDifferingSharepercent: diff.length ? Math.max(...diff.map((f) => f.differingShare)) : 0,
  medianDifferingSharePercent: diff.length
    ? [...diff.map((f) => f.differingShare)].sort((a, b) => a - b)[Math.floor(diff.length / 2)]
    : 0,
};
flush();
fs.rmSync(dirA, {recursive: true, force: true});
fs.rmSync(dirB, {recursive: true, force: true});
console.log(JSON.stringify(doc.summary, null, 2));
