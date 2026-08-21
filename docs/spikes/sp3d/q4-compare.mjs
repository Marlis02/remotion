/**
 * SP-3d (Q4): один ли это растеризатор — Docker и локальный софтверный путь SP-3c.
 *
 * Три уровня сравнения, потому что одного мало:
 *  1. sha256 mp4 — «файл тот же». Различие здесь может быть и от энкодера, и от кадров.
 *  2. framemd5 — md5 каждого ДЕКОДИРОВАННОГО кадра. Различие здесь означает разную
 *     картинку после энкода; совпадение — что декодированные кадры одинаковы.
 *  3. sha256 «сырого» битстрима h264 (`-c copy -f h264`) — контейнер отброшен, остаётся
 *     только то, что произвёл libx264. Это разделяет «другой энкодер» и «другой файл».
 *
 * Локальные эталоны берутся из SP-3c КАК ЕСТЬ: mp4 из sp3c/out, framemd5 из
 * sp3c/results/framemd5, sha256 из sp3c/results/raw. SP-3c не изменяется.
 */
import {execFile} from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {promisify} from 'node:util';
import {ROOT, SP3C, BIN} from './lib/env.mjs';
import {compareFramemd5, ffprobe, sha256File} from '../sp3/lib/media.mjs';

process.env.PATH = `${BIN}:${process.env.PATH}`;
const pexecFile = promisify(execFile);
const RAW = path.join(ROOT, 'results/raw');
const TMP = path.join(ROOT, 'out', '.q4');
fs.mkdirSync(TMP, {recursive: true});

/** sha256 элементарного потока h264: контейнер и его метаданные отброшены. */
const bitstreamSha256 = async (mp4) => {
  const out = path.join(TMP, `${path.basename(mp4)}.h264`);
  await pexecFile('ffmpeg', ['-hide_banner', '-nostdin', '-loglevel', 'error', '-y', '-i', mp4, '-c', 'copy', '-bsf:v', 'h264_mp4toannexb', '-f', 'h264', out], {maxBuffer: 32 * 1024 * 1024});
  const h = sha256File(out);
  const bytes = fs.statSync(out).size;
  fs.rmSync(out, {force: true});
  return {sha256: h, bytes};
};

const readRun = (dir, runId) => {
  const p = path.join(dir, 'results/raw', `${runId}.json`);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
};

const side = async (label, dir, runId, mp4Rel) => {
  const rec = readRun(dir, runId);
  const mp4 = path.join(dir, mp4Rel ?? `out/${runId}.mp4`);
  const md5File = rec?.verification?.framemd5?.file ? path.join(dir, rec.verification.framemd5.file) : null;
  const exists = fs.existsSync(mp4);
  const out = {
    label,
    runId,
    spike: path.basename(dir),
    mp4: path.relative(path.dirname(ROOT), mp4),
    mp4Exists: exists,
    recordedSha256: rec?.verification?.outputSha256 ?? null,
    recordedBytes: rec?.verification?.outputBytes ?? null,
    framemd5File: md5File && fs.existsSync(md5File) ? path.relative(path.dirname(ROOT), md5File) : null,
    framemd5Sha256: rec?.verification?.framemd5?.sha256 ?? null,
    captureMode: rec?.captureMode ?? null,
    browserLaunchLine: rec?.browserLaunchLine ?? null,
    workers: rec?.config?.workers ?? null,
    gpu: rec?.config?.gpu ?? null,
    project: rec?.config?.project ?? null,
    encoderTag: null,
    bitstream: null,
    ffprobe: null,
  };
  if (exists) {
    out.actualSha256 = sha256File(mp4);
    out.actualBytes = fs.statSync(mp4).size;
    out.ffprobe = (await ffprobe(mp4)).fingerprint;
    const {stdout} = await pexecFile('ffprobe', ['-hide_banner', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream_tags=encoder:format_tags=encoder', '-of', 'json', mp4]);
    out.encoderTag = JSON.parse(stdout);
    out.bitstream = await bitstreamSha256(mp4);
  }
  out.mdlocal = md5File;
  return out;
};

const compare = (a, b) => {
  const res = {
    pair: `${a.label} против ${b.label}`,
    sha256Equal: a.actualSha256 && b.actualSha256 ? a.actualSha256 === b.actualSha256 : null,
    bytesDelta: a.actualBytes != null && b.actualBytes != null ? a.actualBytes - b.actualBytes : null,
    bitstreamEqual: a.bitstream && b.bitstream ? a.bitstream.sha256 === b.bitstream.sha256 : null,
    bitstreamBytesDelta: a.bitstream && b.bitstream ? a.bitstream.bytes - b.bitstream.bytes : null,
    framemd5Equal: null,
    framemd5Compare: null,
  };
  if (a.mdlocal && b.mdlocal && fs.existsSync(a.mdlocal) && fs.existsSync(b.mdlocal)) {
    const cmp = compareFramemd5(a.mdlocal, b.mdlocal);
    res.framemd5Equal = cmp.equal;
    res.framemd5Compare = cmp;
  }
  return res;
};

const doc = {
  schema: 'sp3d-q4/1',
  capturedAt: new Date().toISOString(),
  method: {
    fileHash: 'sha256 mp4 целиком (контейнер + битстрим)',
    framemd5: 'md5 каждого декодированного кадра (ffmpeg -f framemd5)',
    bitstream: 'sha256 элементарного потока h264 после `-c copy -bsf:v h264_mp4toannexb -f h264`: контейнер и его метаданные отброшены',
  },
  encoderFlags: {
    hyperframes:
      '-c:v libx264 -preset medium -crf 18 -bf 0 ' +
      '-x264-params aq-mode=3:aq-strength=0.8:deblock=1,1:colorprim=bt709:transfer=bt709:colormatrix=bt709 ' +
      '(chunkEncoder.ts; -g/-keyint_min/-sc_threshold ставятся ТОЛЬКО при lockGopForChunkConcat, а CLI его не выставляет)',
    hyperframesDockerVsLocal:
      'НАБОР ФЛАГОВ ОДИН И ТОТ ЖЕ: внутри контейнера работает тот же CLI той же версии и тот же chunkEncoder. ' +
      'Отличается только СБОРКА ffmpeg/libx264: в контейнере ffmpeg 5.1.9-0+deb12u1 (Debian bookworm), ' +
      'локально в SP-3c ffmpeg-static 6.0. Управлять флагами x264 через --docker можно ровно так же, как локально: ' +
      'CLI пробрасывает --quality/--crf/--video-bitrate/--vp9-cpu-used внутрь контейнера и больше ничего не даёт ни там, ни там.',
    sp3OwnRecipe:
      '-c:v libx264 -crf <profile> -preset medium -pix_fmt yuv420p -colorspace/-color_primaries/-color_trc bt709 ' +
      '-g 30 -threads 4 -fflags +bitexact -flags:v +bitexact (sp3/lib/profiles.mjs) — рецепт блока D SP-3, ' +
      'применяется к PNG-сиквенсу нашим ffmpeg, а не рендерером',
  },
  sides: [],
  comparisons: [],
};

const DOCKER = [
  ['Docker w1 final', 'dA-final-w1-r1'],
  ['Docker w2 final', 'dA-final-w2-r1'],
  ['Docker w4 final', 'dA-final-w4-r1'],
  ['Docker w8 final', 'dA-final-w8-r1'],
  ['Docker w4 final под нагрузкой', 'dD-final-w4-load6-r1'],
  ['Docker w4 draft', 'dB-draft-w4-r1'],
  ['Docker идиоматичная w1, «тяжёлое» состояние', 'dC-idiom-final-w1-r1'],
  ['Docker идиоматичная w1, «лёгкое» состояние', 'dH-idiom-final-w1-x06'],
  ['Docker идиоматичная w4', 'dC-idiom-final-w4-r1'],
];
const LOCAL = [
  ['SP-3c локально SwiftShader w1 final', 'hfB-final-w1-sw-r1'],
  ['SP-3c локально SwiftShader w2 final', 'hfB-final-w2-sw-r1'],
  ['SP-3c локально SwiftShader w4 final', 'hfB-final-w4-sw-r1'],
  ['SP-3c локально SwiftShader w4 draft', 'hfB-draft-w4-sw-r1'],
  ['SP-3c локально аппаратный GPU w4 final', 'hfA-final-w4-gpu-r1'],
  ['SP-3c локально аппаратный GPU w1 final', 'hfA-final-w1-gpu-r1'],
  ['SP-3c локально SwiftShader идиоматичная w1', 'hfN-idiom-final-w1-sw-r1'],
  ['SP-3c локально SwiftShader идиоматичная w4', 'hfM-idiom-final-w4-sw-r1'],
];

for (const [label, runId] of DOCKER) doc.sides.push(await side(label, ROOT, runId));
for (const [label, runId] of LOCAL) doc.sides.push(await side(label, SP3C, runId));
const byLabel = Object.fromEntries(doc.sides.map((s) => [s.label, s]));

const PAIRS = [
  ['Docker w4 final', 'SP-3c локально SwiftShader w4 final'],
  ['Docker w1 final', 'SP-3c локально SwiftShader w1 final'],
  ['Docker w2 final', 'SP-3c локально SwiftShader w2 final'],
  ['Docker w8 final', 'SP-3c локально SwiftShader w4 final'],
  ['Docker w4 final под нагрузкой', 'SP-3c локально SwiftShader w4 final'],
  ['Docker w4 draft', 'SP-3c локально SwiftShader w4 draft'],
  ['Docker w4 final', 'SP-3c локально аппаратный GPU w4 final'],
  ['Docker идиоматичная w1, «тяжёлое» состояние', 'SP-3c локально SwiftShader идиоматичная w1'],
  ['Docker идиоматичная w1, «лёгкое» состояние', 'SP-3c локально SwiftShader идиоматичная w1'],
  ['Docker идиоматичная w4', 'SP-3c локально SwiftShader идиоматичная w4'],
];
for (const [a, b] of PAIRS) {
  if (!byLabel[a] || !byLabel[b]) continue;
  doc.comparisons.push(compare(byLabel[a], byLabel[b]));
}

for (const s of doc.sides) delete s.mdlocal;
fs.writeFileSync(path.join(RAW, 'q4-compare.json'), JSON.stringify(doc, null, 2) + '\n');
for (const c of doc.comparisons) {
  console.log(
    `${c.framemd5Equal === true ? '✓' : c.framemd5Equal === false ? '✗' : '·'} ${c.pair}: ` +
      `кадры ${c.framemd5Equal === null ? '—' : c.framemd5Equal ? 'равны' : `разошлись на ${c.framemd5Compare?.firstDiffFrame}`}, ` +
      `битстрим ${c.bitstreamEqual === null ? '—' : c.bitstreamEqual ? 'равен' : 'различается'}, ` +
      `sha256 mp4 ${c.sha256Equal === null ? '—' : c.sha256Equal ? 'равен' : `различается (Δ${c.bytesDelta} байт)`}`,
  );
}
console.log('\nresults/raw/q4-compare.json');
