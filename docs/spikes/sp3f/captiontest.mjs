/**
 * SP-3f: тест ADR-0003 T8 на HyperFrames — «ни одна граница субтитров не
 * сдвинулась на кадр».
 *
 * Метод. Полоса субтитров лежит на НЕПРОЗРАЧНОЙ плашке (`capPlate`, сплошной
 * #05070c от y=1424 до низа), поэтому в кроп полосы не попадает ничего, кроме
 * самих субтитров: фон, частицы и luma-переход за плашкой не видны. Значит
 * покадровый md5 кропа обязан меняться РОВНО на тех кадрах, где по таблице
 * `results/captions.json` меняется страница или активное слово, и не меняться
 * ни на каком другом кадре.
 *
 * Ожидаемое множество кадров смены = {startFrame каждого слова} ∪ {endFrame
 * последнего слова}. Тест сравнивает его с наблюдаемым.
 *
 * Мера смены — НЕ хэш кропа, а средний модуль разности кропа между соседними
 * кадрами (MAD). Хэш здесь не работает: mp4 — потерянный поток, и декодированные
 * пиксели неподвижной полосы всё равно шевелятся на ±1 уровень от кадра к кадру,
 * потому что энкодер распределяет биты по всему кадру. Первый заход прибора
 * поймал 311 «смен» вместо 37 ровно по этой причине. Порог берётся не с потолка:
 * прибор печатает распределение MAD и разрыв между шумом кодека и настоящей
 * сменой; он на два порядка.
 */
import {execFile} from 'node:child_process';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import {promisify} from 'node:util';
import {ROOT, BIN} from './lib/env.mjs';

const p = promisify(execFile);
const CROP = {w: 960, h: 140, x: 60, y: 1446};   // строго внутри непрозрачной плашки
const file = process.argv[2] ?? 'out/V-w4-r1.mp4';
const caps = JSON.parse(fs.readFileSync(path.join(ROOT, 'results/captions.json'), 'utf8'));

const {stdout} = await p(path.join(BIN, 'ffmpeg'),
  ['-hide_banner', '-nostdin', '-loglevel', 'error', '-i', path.join(ROOT, file),
    '-vf', `crop=${CROP.w}:${CROP.h}:${CROP.x}:${CROP.y},format=gray`,
    '-fps_mode', 'passthrough', '-f', 'rawvideo', '-'],
  {encoding: 'buffer', maxBuffer: 1024 * 1024 * 1024});
const buf = Buffer.from(stdout);
const size = CROP.w * CROP.h;
const n = Math.floor(buf.length / size);
const mad = [0];
for (let i = 1; i < n; i++) {
  const a = i * size; const b = (i - 1) * size;
  let sum = 0;
  for (let k = 0; k < size; k++) sum += Math.abs(buf[a + k] - buf[b + k]);
  mad.push(sum / size);
}
const expectedSetForThreshold = new Set(caps.words.map((w) => w.startFrame).concat([caps.words[caps.words.length - 1].endFrame]));
const onBoundary = mad.map((v, i) => ({i, v})).filter((x) => x.i > 0 && expectedSetForThreshold.has(x.i)).map((x) => x.v).sort((a, b) => a - b);
const offBoundary = mad.map((v, i) => ({i, v})).filter((x) => x.i > 0 && !expectedSetForThreshold.has(x.i)).map((x) => x.v).sort((a, b) => a - b);
const THRESHOLD = Number(process.env.SP3F_T8_THRESHOLD ?? 0.5);
const observed = [];
for (let i = 1; i < n; i++) if (mad[i] >= THRESHOLD) observed.push(i);

const expected = caps.words.map((w) => w.startFrame);
expected.push(caps.words[caps.words.length - 1].endFrame);       // исчезновение последней страницы
const expSet = new Set(expected);
const obsSet = new Set(observed);
const missing = expected.filter((f) => !obsSet.has(f));           // граница не состоялась
const extra = observed.filter((f) => !expSet.has(f));             // полоса изменилась вне границы

const pageBoundaries = caps.pages.map((pg) => pg.startFrame);
const res = {
  schema: 'sp3f-t8/2', file, crop: CROP, framesRead: n, threshold: THRESHOLD,
  madOnBoundary: {min: onBoundary[0], p50: onBoundary[Math.floor(onBoundary.length / 2)], max: onBoundary[onBoundary.length - 1], count: onBoundary.length},
  madOffBoundary: {min: offBoundary[0], p50: offBoundary[Math.floor(offBoundary.length / 2)], p95: offBoundary[Math.floor(offBoundary.length * 0.95)], max: offBoundary[offBoundary.length - 1], count: offBoundary.length},
  expectedChanges: expected.length, observedChanges: observed.length,
  missing, extra,
  pass: missing.length === 0 && extra.length === 0,
  pageBoundaries, pageBoundariesHit: pageBoundaries.filter((f) => obsSet.has(f)).length,
  wordBoundariesHit: caps.words.filter((w) => obsSet.has(w.startFrame)).length,
  totalWords: caps.words.length, totalPages: caps.pages.length,
  note: 'expected = {startFrame каждого слова} ∪ {endFrame последнего}; смена страницы — подмножество',
};
fs.writeFileSync(path.join(ROOT, 'results/raw/t8-captions.json'), JSON.stringify(res, null, 2) + '\n');
console.log(`кадров ${n}; ожидалось смен ${res.expectedChanges}, наблюдалось ${res.observedChanges} (порог MAD ${THRESHOLD})`);
console.log(`MAD на границах: мин ${res.madOnBoundary.min?.toFixed(3)}, медиана ${res.madOnBoundary.p50?.toFixed(3)}, макс ${res.madOnBoundary.max?.toFixed(3)}`);
console.log(`MAD вне границ:  мин ${res.madOffBoundary.min?.toFixed(4)}, медиана ${res.madOffBoundary.p50?.toFixed(4)}, p95 ${res.madOffBoundary.p95?.toFixed(4)}, макс ${res.madOffBoundary.max?.toFixed(4)}`);
console.log(`границ страниц попало ${res.pageBoundariesHit}/${res.totalPages}, границ слов ${res.wordBoundariesHit}/${res.totalWords}`);
console.log(`пропущено: [${missing.join(', ')}]`);
console.log(`лишних смен: ${extra.length}${extra.length ? ' → [' + extra.slice(0, 30).join(', ') + ']' : ''}`);
console.log(res.pass ? 'T8: ПРОЙДЕН' : 'T8: НЕ ПРОЙДЕН');
