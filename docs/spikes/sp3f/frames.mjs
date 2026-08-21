/** SP-3f: PNG опорных кадров из mp4 — по ним владелец судит «дорого или нет». */
import {execFile} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {promisify} from 'node:util';
import {ROOT, BIN} from './lib/env.mjs';
const p = promisify(execFile);
const FRAMES = (process.argv[3] ?? '20,80,150,250,320,400').split(',').map(Number);
const src = process.argv[2] ?? 'out/V-w4-r1.mp4';
const outDir = path.join(ROOT, 'results/frames');
fs.mkdirSync(outDir, {recursive: true});
for (const f of FRAMES) {
  const dst = path.join(outDir, `frame-${String(f).padStart(3, '0')}.png`);
  await p(path.join(BIN, 'ffmpeg'), ['-y', '-hide_banner', '-loglevel', 'error', '-i', path.join(ROOT, src),
    '-vf', `select=eq(n\\,${f})`, '-fps_mode', 'passthrough', '-frames:v', '1', dst]);
  console.log(`${f} → ${path.relative(ROOT, dst)} ${fs.statSync(dst).size} б`);
}
