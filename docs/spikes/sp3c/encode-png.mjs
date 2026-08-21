/**
 * SP-3c: собственный энкод PNG-сиквенса — тем же вызовом ffmpeg, что в SP-3 (блок D).
 *
 * Два вопроса за один прогон:
 *  1. Детерминирован ли энкодер НА ЭТОЙ машине (дважды один и тот же вход → тот же байт).
 *     Без этого нельзя приписывать расхождение mp4 растеризации.
 *  2. Сравнение mp4 «через наш энкодер, а не их» — как требует задание, если рендерер
 *     не даёт управлять энкодером напрямую.
 *
 * Рецепт: libx264, crf по профилю, preset medium, bt709, yuv420p, -g 30,
 * threads числом, bitexact — из docs/spikes/sp3/lib/profiles.mjs.
 */
import {execFile} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {promisify} from 'node:util';
import {ROOT, BIN} from './lib/env.mjs';
import {PROFILES, encoderExtraArgs} from '../sp3/lib/profiles.mjs';
import {sha256File, framemd5} from '../sp3/lib/media.mjs';
process.env.PATH = `${BIN}:${process.env.PATH}`;

const pexecFile = promisify(execFile);
const RAW = path.join(ROOT, 'results/raw');
const OUT = path.join(ROOT, 'out');
fs.mkdirSync(RAW, {recursive: true});

const dirs = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (!dirs.length) {
  console.error('использование: node encode-png.mjs <каталог-с-PNG> [ещё каталоги]');
  process.exit(2);
}

const encodeOnce = async (framesDir, outPath, {threads, crf}) => {
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
  return {
    ms: Date.now() - t,
    outPath,
    bytes: fs.statSync(outPath).size,
    sha256: sha256File(outPath),
    command: `ffmpeg ${args.join(' ')}`,
    frames: files.length,
  };
};

const doc = {
  schema: 'sp3c-encode/1',
  capturedAt: new Date().toISOString(),
  recipe: 'libx264, preset medium, bt709, yuv420p, -g 30, -fflags +bitexact -flags:v +bitexact (docs/spikes/sp3/lib/profiles.mjs)',
  encodes: [],
};
const outFile = path.join(RAW, 'own-encode.json');
const flush = () => fs.writeFileSync(outFile, JSON.stringify(doc, null, 2) + '\n');

for (const d of dirs) {
  const framesDir = path.isAbsolute(d) ? d : path.join(ROOT, d);
  if (!fs.existsSync(framesDir)) {
    doc.encodes.push({framesDir: d, error: 'каталог отсутствует'});
    flush();
    continue;
  }
  const base = path.basename(framesDir);
  // Двойной энкод одного и того же входа: изоляция энкодера (SP-3 блок D).
  const e1 = await encodeOnce(framesDir, path.join(OUT, `own-${base}-t4-e1.mp4`), {threads: 4, crf: 18});
  const e2 = await encodeOnce(framesDir, path.join(OUT, `own-${base}-t4-e2.mp4`), {threads: 4, crf: 18});
  const t1 = await encodeOnce(framesDir, path.join(OUT, `own-${base}-t1-e1.mp4`), {threads: 1, crf: 18});
  const md5 = await framemd5(e1.outPath, path.join(ROOT, 'results/framemd5', `own-${base}-t4.framemd5`));
  doc.encodes.push({
    framesDir: path.relative(ROOT, framesDir),
    frames: e1.frames,
    threads4_encode1: e1,
    threads4_encode2: e2,
    threads1_encode1: t1,
    encoderDeterministic: e1.sha256 === e2.sha256,
    threads1VsThreads4Equal: t1.sha256 === e1.sha256,
    framemd5OfOwnEncode: md5,
  });
  flush();
  console.log(
    `${base}: энкодер детерминирован=${e1.sha256 === e2.sha256}; threads1==threads4=${t1.sha256 === e1.sha256}; sha256(t4)=${e1.sha256.slice(0, 16)}`,
  );
}
flush();
