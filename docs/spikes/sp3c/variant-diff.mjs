/**
 * SP-3c: насколько велико расхождение МЕЖДУ ВАРИАНТАМИ одного и того же прогона.
 *
 * «Разошлось» без числа — не результат: SP-3 показал, что расхождение может быть
 * в один уровень из 255 на 15 % субпикселей (то есть глазом невидимо) и всё равно
 * убивать нулевой порог AC4. Здесь то же измерение для HyperFrames: варианты mp4
 * декодируются в кадры и сравниваются попиксельно.
 *
 * Пары берутся автоматически: внутри каждой группы прогонов с одинаковой настройкой
 * ищутся два разных sha256 и сравниваются их файлы.
 */
import {execFile} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {promisify} from 'node:util';
import {ROOT, BIN} from './lib/env.mjs';
import {compareFramemd5, psnrBetweenFiles, psnrDistribution} from '../sp3/lib/media.mjs';
process.env.PATH = `${BIN}:${process.env.PATH}`;

const pexecFile = promisify(execFile);
const RAW = path.join(ROOT, 'results/raw');
const OUT = path.join(ROOT, 'out');

const runs = fs
  .readdirSync(RAW)
  .filter((f) => f.endsWith('.json'))
  .map((f) => {
    try {
      return JSON.parse(fs.readFileSync(path.join(RAW, f), 'utf8'));
    } catch {
      return null;
    }
  })
  .filter((r) => r && r.schema === 'sp3c-run/1' && r.status === 'OK' && r.verification?.outputSha256);

/** Ключ настройки: всё, кроме номера повтора. */
const settingKey = (r) => `${r.renderer}|${r.config.profile}|${r.config.project ?? ''}|${r.config.workers ?? r.config.concurrency}|${r.config.gpu ?? r.config.gl}|${r.config.cpuLoadProcesses}|${JSON.stringify(r.config.envOverrides ?? {})}`;

const groups = new Map();
for (const r of runs) {
  const k = settingKey(r);
  if (!groups.has(k)) groups.set(k, []);
  groups.get(k).push(r);
}

/** Одна и та же настройка, но разные наблюдаемые файлы — вот что интересно. */
const pairs = [];
for (const [k, list] of groups) {
  const byHash = new Map();
  for (const r of list) if (!byHash.has(r.verification.outputSha256)) byHash.set(r.verification.outputSha256, r);
  if (byHash.size >= 2) {
    const [a, b] = [...byHash.values()];
    pairs.push({setting: k, a, b});
  }
}
// Дополнительно: «эталон блока A» против варианта под нагрузкой, даже если внутри
// группы под нагрузкой все три совпали между собой.
const baseline = runs.find((r) => r.runId === 'hfA-final-w4-gpu-r1');
for (const r of runs) {
  if (!baseline) break;
  if (!/^hf[CK]-final-w4-gpu-load6/.test(r.runId)) continue;
  if (r.verification.outputSha256 === baseline.verification.outputSha256) continue;
  if (pairs.some((p) => p.a.runId === baseline.runId && p.b.runId === r.runId)) continue;
  pairs.push({setting: 'эталон без нагрузки против варианта под нагрузкой', a: baseline, b: r});
  break;
}

const doc = {
  schema: 'sp3c-variant-diff/1',
  capturedAt: new Date().toISOString(),
  note: 'Сравниваются готовые mp4 разных вариантов одной и той же настройки: сначала framemd5 (первый разошедшийся кадр), затем покадровый PSNR, затем сырые пиксели на узком диапазоне.',
  pairs: [],
};
const outFile = path.join(RAW, 'variant-diff.json');
const flush = () => fs.writeFileSync(outFile, JSON.stringify(doc, null, 2) + '\n');
flush();

const rawFrame = async (mp4, frame, tag) => {
  const out = path.join(OUT, `vd-${tag}.rgb`);
  await pexecFile(
    'ffmpeg',
    ['-hide_banner', '-loglevel', 'error', '-y', '-i', mp4, '-vf', `select=eq(n\\,${frame})`, '-vsync', '0', '-frames:v', '1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', out],
    {maxBuffer: 16 * 1024 * 1024},
  );
  const buf = fs.readFileSync(out);
  fs.rmSync(out, {force: true});
  return buf;
};

for (const [i, p] of pairs.entries()) {
  const fileA = path.join(OUT, `${p.a.runId}.mp4`);
  const fileB = path.join(OUT, `${p.b.runId}.mp4`);
  if (!fs.existsSync(fileA) || !fs.existsSync(fileB)) {
    doc.pairs.push({setting: p.setting, a: p.a.runId, b: p.b.runId, error: 'один из mp4 отсутствует на диске'});
    flush();
    continue;
  }
  const md5cmp = compareFramemd5(path.join(ROOT, p.a.verification.framemd5.file), path.join(ROOT, p.b.verification.framemd5.file));
  const psnr = await psnrBetweenFiles(fileA, fileB, path.join(OUT, `vd-psnr-${i}.log`));
  const dist = psnrDistribution(psnr.frames);
  const firstDiff = md5cmp.firstDiffFrame ?? 0;
  let pixels = null;
  if (!md5cmp.equal) {
    const a = await rawFrame(fileA, firstDiff, `a${i}`);
    const b = await rawFrame(fileB, firstDiff, `b${i}`);
    if (a.length === b.length) {
      let differing = 0;
      let maxAbs = 0;
      const hist = {};
      for (let k = 0; k < a.length; k++) {
        const d = Math.abs(a[k] - b[k]);
        if (d) {
          differing += 1;
          if (d > maxAbs) maxAbs = d;
          hist[d] = (hist[d] ?? 0) + 1;
        }
      }
      pixels = {
        frame: firstDiff,
        totalSubpixels: a.length,
        differingSubpixels: differing,
        differingSharePercent: Math.round((differing / a.length) * 1e6) / 1e4,
        maxAbsDiff: maxAbs,
        histogramOfAbsDiff: Object.fromEntries(Object.entries(hist).sort((x, y) => Number(x[0]) - Number(y[0])).slice(0, 12)),
      };
    }
  }
  doc.pairs.push({
    setting: p.setting,
    a: {runId: p.a.runId, sha256: p.a.verification.outputSha256},
    b: {runId: p.b.runId, sha256: p.b.verification.outputSha256},
    framemd5Equal: md5cmp.equal,
    firstDiffFrame: md5cmp.firstDiffFrame,
    framesCompared: md5cmp.framesCompared,
    psnrDistribution: dist,
    pixelsOnFirstDiffFrame: pixels,
  });
  flush();
  console.log(
    `${p.a.runId} против ${p.b.runId}: framemd5 ${md5cmp.equal ? 'совпал' : `разошёлся на кадре ${md5cmp.firstDiffFrame}`}; ` +
      `кадров совпало ${dist.identicalFrames}/${dist.frames}; PSNR p50 ${dist.psnrP50Db} dB; ` +
      `субпикселей различается ${pixels ? pixels.differingSharePercent + ' %' : '—'}, макс |Δ| ${pixels?.maxAbsDiff ?? '—'}`,
  );
}
if (!pairs.length) console.log('вариантов одной настройки не найдено — сравнивать нечего');
flush();
