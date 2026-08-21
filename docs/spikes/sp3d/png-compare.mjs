/**
 * SP-3d (Q4, сырые кадры до энкодера + «через наш ffmpeg»).
 *
 * Docker-режим не даёт управлять флагами x264 сверх того, что даёт локальный режим
 * (тот же CLI, тот же chunkEncoder), но использует ДРУГУЮ сборку ffmpeg — Debian 5.1.9
 * против ffmpeg-static 6.0 локально. Поэтому вопрос «один ли это растеризатор» нельзя
 * закрывать одним sha256 mp4. Здесь он закрывается двумя способами сразу:
 *
 *  1. сравнением PNG-сиквенсов до энкодера (dirHash + пофайловый sha256), в том числе
 *     с сиквенсом, записанным SP-3c (`hfE-png-w4-sw`, каталог удалён, но sha256 каждого
 *     файла лежит в его raw-JSON);
 *  2. энкодом обоих сиквенсов НАШИМ ffmpeg рецептом блока D SP-3 — то есть одним
 *     энкодером на оба входа.
 *
 * Скрипт sp3c/encode-png.mjs повторно не используется намеренно: он пишет в
 * sp3c/results/raw, то есть его вызов изменил бы SP-3c. Рецепт берётся импортом
 * из sp3/lib/profiles.mjs, приборы — из sp3/lib/media.mjs.
 */
import {execFile} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {promisify} from 'node:util';
import {ROOT, SP3C, BIN} from './lib/env.mjs';
import {PROFILES, encoderExtraArgs} from '../sp3/lib/profiles.mjs';
import {sha256File, framemd5, compareFramemd5} from '../sp3/lib/media.mjs';

process.env.PATH = `${BIN}:${process.env.PATH}`;
const pexecFile = promisify(execFile);
const RAW = path.join(ROOT, 'results/raw');
const OUT = path.join(ROOT, 'out');

const readRun = (dir, runId) => {
  const p = path.join(dir, 'results/raw', `${runId}.json`);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
};

/** Энкод PNG-сиквенса рецептом блока D SP-3: libx264, crf 18, preset medium, bt709, -g 30, bitexact. */
const encodeOnce = async (framesDir, outPath, {threads = 4, crf = 18} = {}) => {
  const profile = {...PROFILES.final, crf, encoderThreads: threads};
  const files = fs.readdirSync(framesDir).filter((f) => f.endsWith('.png')).sort();
  const first = files[0];
  const pattern = first.replace(/\d+/, (m) => `%0${m.length}d`);
  const start = String(Number((first.match(/\d+/) ?? ['0'])[0]));
  const args = [
    '-hide_banner', '-nostdin', '-loglevel', 'error',
    '-framerate', '30', '-start_number', start,
    '-i', path.join(framesDir, pattern),
    '-c:v', 'libx264',
    '-crf', String(profile.crf),
    '-preset', profile.x264Preset,
    '-pix_fmt', profile.pixelFormat,
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
    ...encoderExtraArgs(profile),
    '-y', outPath,
  ];
  fs.rmSync(outPath, {force: true});
  const t = Date.now();
  await pexecFile('ffmpeg', args, {maxBuffer: 32 * 1024 * 1024});
  return {ms: Date.now() - t, outPath: path.relative(ROOT, outPath), bytes: fs.statSync(outPath).size, sha256: sha256File(outPath), frames: files.length, command: `ffmpeg ${args.join(' ')}`};
};

const doc = {
  schema: 'sp3d-png/1',
  capturedAt: new Date().toISOString(),
  method:
    'dirHash = sha256 по (имя + содержимое) всех PNG каталога в отсортированном порядке — прибор SP-3/SP-3c. ' +
    'Пофайловый sha256 позволяет сверяться с сиквенсом SP-3c, каталог которого удалён, но хэши записаны. ' +
    'Свой энкод — рецепт блока D SP-3 (sp3/lib/profiles.mjs) нашим ffmpeg 6.0-static.',
  sides: [],
  comparisons: [],
  ownEncode: [],
};

const SIDES = [
  ['Docker, PNG-сиквенс, w4', ROOT, 'dP-docker-png-w4'],
  ['локально SwiftShader, PNG-сиквенс, w4 (сегодня)', ROOT, 'dP-local-sw-png-w4'],
  ['SP-3c локально SwiftShader, PNG-сиквенс, w4 (ночью)', SP3C, 'hfE-png-w4-sw'],
  ['SP-3c локально аппаратный GPU, PNG-сиквенс, w4 (ночью)', SP3C, 'hfE-png-w4-gpu-r1'],
];
const byLabel = {};
for (const [label, dir, runId] of SIDES) {
  const rec = readRun(dir, runId);
  if (!rec || rec.status !== 'OK') continue;
  const s = {
    label,
    runId,
    source: path.basename(dir),
    dirOnDisk: fs.existsSync(path.join(dir, 'out', runId)) ? path.relative(path.dirname(ROOT), path.join(dir, 'out', runId)) : null,
    dirHash: rec.verification?.dirHash ?? null,
    fileCount: rec.verification?.fileCount ?? null,
    totalBytes: rec.verification?.totalBytes ?? null,
    framemd5Sha256: rec.verification?.framemd5?.sha256 ?? null,
    framemd5File: rec.verification?.framemd5?.file ? path.join(dir, rec.verification.framemd5.file) : null,
    perFile: rec.verification?.perFile ?? null,
    captureMode: rec.captureMode ?? null,
    browserLaunchLine: rec.browserLaunchLine ?? null,
  };
  doc.sides.push(s);
  byLabel[label] = s;
}

const cmp = (a, b) => {
  if (!a || !b) return null;
  const mapA = new Map((a.perFile ?? []).map((f) => [f.file, f.sha256]));
  const mapB = new Map((b.perFile ?? []).map((f) => [f.file, f.sha256]));
  const names = [...new Set([...mapA.keys(), ...mapB.keys()])].sort();
  let identical = 0;
  let firstDifferent = null;
  for (const n of names) {
    if (mapA.get(n) && mapA.get(n) === mapB.get(n)) identical += 1;
    else if (!firstDifferent) firstDifferent = n;
  }
  let framemd5Equal = null;
  if (a.framemd5File && b.framemd5File && fs.existsSync(a.framemd5File) && fs.existsSync(b.framemd5File)) {
    framemd5Equal = compareFramemd5(a.framemd5File, b.framemd5File).equal;
  }
  return {
    pair: `${a.label} против ${b.label}`,
    dirHashEqual: a.dirHash === b.dirHash,
    framemd5Equal,
    filesCompared: names.length,
    identicalFiles: identical,
    firstDifferentFile: firstDifferent,
  };
};

const PAIRS = [
  ['Docker, PNG-сиквенс, w4', 'локально SwiftShader, PNG-сиквенс, w4 (сегодня)'],
  ['Docker, PNG-сиквенс, w4', 'SP-3c локально SwiftShader, PNG-сиквенс, w4 (ночью)'],
  ['локально SwiftShader, PNG-сиквенс, w4 (сегодня)', 'SP-3c локально SwiftShader, PNG-сиквенс, w4 (ночью)'],
  ['Docker, PNG-сиквенс, w4', 'SP-3c локально аппаратный GPU, PNG-сиквенс, w4 (ночью)'],
];
for (const [a, b] of PAIRS) {
  const c = cmp(byLabel[a], byLabel[b]);
  if (c) doc.comparisons.push(c);
}

// Свой энкод — по одному разу на каждый сиквенс, который ещё лежит на диске, плюс
// повтор для проверки детерминизма самого энкодера на этом входе.
for (const s of doc.sides) {
  const dir = s.dirOnDisk ? path.join(path.dirname(ROOT), s.dirOnDisk) : null;
  if (!dir || !fs.existsSync(dir)) {
    doc.ownEncode.push({side: s.label, skipped: 'каталог PNG на диске отсутствует (удалён после сведения)'});
    continue;
  }
  const base = s.runId;
  const e1 = await encodeOnce(dir, path.join(OUT, `own-${base}-t4-e1.mp4`));
  const e2 = await encodeOnce(dir, path.join(OUT, `own-${base}-t4-e2.mp4`));
  const t1 = await encodeOnce(dir, path.join(OUT, `own-${base}-t1-e1.mp4`), {threads: 1});
  const md5 = await framemd5(path.join(OUT, `own-${base}-t4-e1.mp4`), path.join(ROOT, 'results/framemd5', `own-${base}-t4.framemd5`));
  doc.ownEncode.push({
    side: s.label,
    runId: base,
    frames: e1.frames,
    threads4_encode1: e1,
    threads4_encode2: e2,
    threads1_encode1: t1,
    encoderDeterministic: e1.sha256 === e2.sha256,
    threads1VsThreads4Equal: t1.sha256 === e1.sha256,
    framemd5OfOwnEncode: md5.sha256,
  });
  console.log(`свой энкод ${base}: детерминирован=${e1.sha256 === e2.sha256}, sha256=${e1.sha256.slice(0, 16)}`);
}
// Совпали ли mp4, собранные ОДНИМ нашим энкодером из разных сиквенсов.
const enc = doc.ownEncode.filter((e) => !e.skipped);
doc.ownEncodeCrossComparison = [];
for (let i = 0; i < enc.length; i++) {
  for (let j = i + 1; j < enc.length; j++) {
    doc.ownEncodeCrossComparison.push({
      pair: `${enc[i].side} против ${enc[j].side}`,
      equal: enc[i].threads4_encode1.sha256 === enc[j].threads4_encode1.sha256,
      shaA: enc[i].threads4_encode1.sha256,
      shaB: enc[j].threads4_encode1.sha256,
    });
  }
}

for (const s of doc.sides) delete s.perFile;
for (const s of doc.sides) delete s.framemd5File;
fs.writeFileSync(path.join(RAW, 'png-compare.json'), JSON.stringify(doc, null, 2) + '\n');
for (const c of doc.comparisons) {
  console.log(`${c.dirHashEqual ? '✓' : '✗'} ${c.pair}: dirHash ${c.dirHashEqual ? 'равен' : 'различается'}, совпало файлов ${c.identicalFiles} из ${c.filesCompared}${c.firstDifferentFile ? `, первый различающийся ${c.firstDifferentFile}` : ''}`);
}
for (const c of doc.ownEncodeCrossComparison) console.log(`${c.equal ? '✓' : '✗'} через наш ffmpeg: ${c.pair} — ${c.equal ? 'побайтово равны' : 'различаются'}`);
console.log('\nresults/raw/png-compare.json');
