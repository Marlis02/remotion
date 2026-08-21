/**
 * SP-3d: масштаб расхождения между парой mp4 — тем же прибором, что SP-3/SP-3c.
 *
 * Нужен потому, что «файлы разошлись» ничего не говорит о том, что именно разошлось:
 * SP-3 и SP-3c находили расхождения класса «единицы младших битов, PSNR 43–44 dB,
 * глазом не видно». Если расхождение SP-3d того же класса — это одна новость;
 * если другого — совсем другая.
 *
 * Приборы: psnrBetweenFiles + psnrDistribution из sp3/lib/media.mjs (импорт, не копия).
 * Дополнительно вынимаются кадры заданного диапазона в PNG, чтобы можно было прогнать
 * по ним pixeldiff.mjs — сравнение на сырых кадрах, а не на декодированном lossy-выходе.
 *
 * Использование: node scale.mjs <runIdA> <runIdB> [первыйКадр] [последнийКадр]
 */
import {execFile} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {promisify} from 'node:util';
import {ROOT, SP3C, BIN} from './lib/env.mjs';
import {psnrBetweenFiles, psnrDistribution, compareFramemd5} from '../sp3/lib/media.mjs';

process.env.PATH = `${BIN}:${process.env.PATH}`;
const pexecFile = promisify(execFile);
const [idA, idB, firstArg = '0', lastArg = '19'] = process.argv.slice(2);
if (!idA || !idB) {
  console.error('использование: node scale.mjs <runIdA> <runIdB> [первый] [последний]');
  process.exit(2);
}
const RAW = path.join(ROOT, 'results/raw');
const OUT = path.join(ROOT, 'out');

const locate = (runId) => {
  for (const base of [ROOT, SP3C]) {
    const rec = path.join(base, 'results/raw', `${runId}.json`);
    if (!fs.existsSync(rec)) continue;
    const mp4 = path.join(base, 'out', `${runId}.mp4`);
    return {runId, base, rec, mp4, exists: fs.existsSync(mp4), record: JSON.parse(fs.readFileSync(rec, 'utf8'))};
  }
  return null;
};
const A = locate(idA);
const B = locate(idB);
if (!A?.exists || !B?.exists) {
  console.error(`нет mp4: ${idA}=${A?.exists} ${idB}=${B?.exists}`);
  process.exit(3);
}

/** Вынуть диапазон кадров в PNG — сырые кадры для pixeldiff. */
const extract = async (mp4, dir, first, last) => {
  fs.rmSync(dir, {recursive: true, force: true});
  fs.mkdirSync(dir, {recursive: true});
  await pexecFile('ffmpeg', [
    '-hide_banner', '-nostdin', '-loglevel', 'error',
    '-i', mp4,
    '-vf', `select='between(n\\,${first}\\,${last})'`, '-vsync', '0',
    path.join(dir, 'frame_%06d.png'),
  ], {maxBuffer: 32 * 1024 * 1024});
  return fs.readdirSync(dir).length;
};

const first = Number(firstArg);
const last = Number(lastArg);
const slug = `${idA}--vs--${idB}`;
const dirA = path.join(OUT, `.frames-${idA}`);
const dirB = path.join(OUT, `.frames-${idB}`);

const doc = {
  schema: 'sp3d-scale/1',
  capturedAt: new Date().toISOString(),
  a: {runId: idA, spike: path.basename(A.base), sha256: A.record.verification?.outputSha256, bytes: A.record.verification?.outputBytes},
  b: {runId: idB, spike: path.basename(B.base), sha256: B.record.verification?.outputSha256, bytes: B.record.verification?.outputBytes},
  method:
    'psnrBetweenFiles + psnrDistribution из sp3/lib/media.mjs по всем кадрам обоих mp4; ' +
    'первый разошедшийся кадр — из framemd5; сырые кадры диапазона вынуты в PNG для pixeldiff.mjs',
};

const mdA = A.record.verification?.framemd5?.file ? path.join(A.base, A.record.verification.framemd5.file) : null;
const mdB = B.record.verification?.framemd5?.file ? path.join(B.base, B.record.verification.framemd5.file) : null;
if (mdA && mdB && fs.existsSync(mdA) && fs.existsSync(mdB)) doc.framemd5Compare = compareFramemd5(mdA, mdB);

const psnr = await psnrBetweenFiles(A.mp4, B.mp4, path.join(OUT, `psnr-${slug}.log`));
doc.psnrDistribution = psnrDistribution(psnr.frames);
doc.psnrCommand = psnr.command;
doc.worstFrames = [...psnr.frames]
  .filter((f) => Number.isFinite(f.psnrAvg))
  .sort((x, y) => x.psnrAvg - y.psnrAvg)
  .slice(0, 5)
  .map((f) => ({n: f.n, psnrDb: Math.round(f.psnrAvg * 100) / 100, mse: f.mseAvg}));

doc.extractedFrames = {
  range: [first, last],
  a: {dir: path.relative(path.dirname(ROOT), dirA), count: await extract(A.mp4, dirA, first, last)},
  b: {dir: path.relative(path.dirname(ROOT), dirB), count: await extract(B.mp4, dirB, first, last)},
  note: 'это кадры ПОСЛЕ декодирования mp4, а не сырьё рендерера: разница энкодера в них уже сидит',
};

fs.writeFileSync(path.join(RAW, `scale-${slug}.json`), JSON.stringify(doc, null, 2) + '\n');
console.log(JSON.stringify({pair: slug, firstDiffFrame: doc.framemd5Compare?.firstDiffFrame, ...doc.psnrDistribution}, null, 2));
console.log(`\nкадры для pixeldiff: ${doc.extractedFrames.a.dir} и ${doc.extractedFrames.b.dir}`);
