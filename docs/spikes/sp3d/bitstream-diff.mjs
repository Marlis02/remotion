/**
 * SP-3d (Q4, финальная точность): где именно расходятся битстримы Docker и локального пути.
 *
 * `q4-compare.mjs` показал, что sha256 элементарного потока h264 различается при
 * побайтово равных декодированных кадрах и равной ДЛИНЕ потока. Это требует объяснения,
 * иначе вывод «растеризатор один» опирается только на framemd5.
 *
 * Здесь поток вынимается (`-c copy -bsf:v h264_mp4toannexb -f h264`) и сравнивается
 * побайтово: сколько байт различается и в каких позициях.
 */
import {execFile} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {promisify} from 'node:util';
import {ROOT, SP3C, BIN} from './lib/env.mjs';

process.env.PATH = `${BIN}:${process.env.PATH}`;
const pexecFile = promisify(execFile);
const RAW = path.join(ROOT, 'results/raw');
const TMP = path.join(ROOT, 'out', '.bs');
fs.mkdirSync(TMP, {recursive: true});

const es = async (mp4, tag) => {
  const out = path.join(TMP, `${tag}.h264`);
  await pexecFile('ffmpeg', ['-hide_banner', '-nostdin', '-loglevel', 'error', '-y', '-i', mp4, '-c', 'copy', '-bsf:v', 'h264_mp4toannexb', '-f', 'h264', out], {maxBuffer: 32 * 1024 * 1024});
  return fs.readFileSync(out);
};

const PAIRS = [
  ['точная final w4', path.join(ROOT, 'out/dA-final-w4-r1.mp4'), path.join(SP3C, 'out/hfB-final-w4-sw-r1.mp4')],
  ['точная final w1', path.join(ROOT, 'out/dA-final-w1-r1.mp4'), path.join(SP3C, 'out/hfB-final-w1-sw-r1.mp4')],
  ['точная draft w4', path.join(ROOT, 'out/dB-draft-w4-r1.mp4'), path.join(SP3C, 'out/hfB-draft-w4-sw-r1.mp4')],
  ['идиоматичная final w4', path.join(ROOT, 'out/dC-idiom-final-w4-r1.mp4'), path.join(SP3C, 'out/hfM-idiom-final-w4-sw-r1.mp4')],
  ['идиоматичная final w1, «лёгкое» состояние', path.join(ROOT, 'out/dH-idiom-final-w1-x06.mp4'), path.join(SP3C, 'out/hfN-idiom-final-w1-sw-r1.mp4')],
];

const doc = {
  schema: 'sp3d-bitstream/1',
  capturedAt: new Date().toISOString(),
  method:
    'Элементарный поток h264 вынут из mp4 без перекодирования (`-c copy -bsf:v h264_mp4toannexb -f h264`) ' +
    'и сравнён побайтово. Контейнер и его метаданные при этом отброшены — остаётся только то, что произвёл libx264.',
  pairs: [],
};

for (const [label, a, b] of PAIRS) {
  if (!fs.existsSync(a) || !fs.existsSync(b)) {
    doc.pairs.push({label, skipped: `нет файла: ${!fs.existsSync(a) ? a : b}`});
    continue;
  }
  const A = await es(a, 'a');
  const B = await es(b, 'b');
  const n = Math.min(A.length, B.length);
  const positions = [];
  for (let i = 0; i < n; i++) if (A[i] !== B[i]) positions.push(i);
  const region = positions.length ? [positions[0], positions[positions.length - 1]] : null;
  const ctx = (buf) => (region ? buf.subarray(Math.max(0, region[0] - 30), region[1] + 30).toString('latin1').replace(/[^\x20-\x7e]/g, '.') : null);
  doc.pairs.push({
    label,
    docker: path.relative(path.dirname(ROOT), a),
    local: path.relative(path.dirname(ROOT), b),
    bytesDocker: A.length,
    bytesLocal: B.length,
    sameLength: A.length === B.length,
    differingBytes: positions.length + Math.abs(A.length - B.length),
    differingPositions: positions.slice(0, 64),
    differingRegion: region,
    shareOfStreamPercent: A.length ? Math.round((positions.length / A.length) * 1e9) / 1e7 : null,
    contextDocker: ctx(A),
    contextLocal: ctx(B),
    verdict:
      positions.length === 0 && A.length === B.length
        ? 'элементарные потоки ПОБАЙТОВО РАВНЫ'
        : region && region[1] < 1024
          ? 'различия только в первом килобайте потока — это SEI с версией и параметрами x264, сами кодированные данные равны'
          : 'различия по всему потоку — кодированные данные разные',
  });
  console.log(`${label}: различается ${positions.length} байт из ${A.length}, позиции ${region ? region.join('..') : '—'} — ${doc.pairs.at(-1).verdict}`);
}

// Заодно — строки версии x264 из SEI обоих энкодеров: они и есть источник различия.
const x264Line = (buf) => {
  const s = buf.subarray(0, 2048).toString('latin1');
  const m = s.match(/x264 - core \d+[^\x00]*?- options:/);
  return m ? m[0] : null;
};
if (fs.existsSync(path.join(TMP, 'a.h264'))) {
  doc.x264Signature = {
    docker: x264Line(fs.readFileSync(path.join(TMP, 'a.h264'))),
    local: x264Line(fs.readFileSync(path.join(TMP, 'b.h264'))),
  };
}
fs.rmSync(TMP, {recursive: true, force: true});
fs.writeFileSync(path.join(RAW, 'bitstream-diff.json'), JSON.stringify(doc, null, 2) + '\n');
console.log('\nresults/raw/bitstream-diff.json');
