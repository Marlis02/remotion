/**
 * SP-3e: ВЧ-энергия кадра 150 по методу SP-3d §1.2 —
 * средний модуль разности СОСЕДНИХ пикселей по яркости на кропе 520×520.
 * У SP-3d кроп брался в детализированной части фона; здесь фон сплошной,
 * поэтому кроп берётся на градиентной заливке линейного графика
 * (x=100, y=1000) — единственном месте композиции, где растеризатор
 * рисует градиент, то есть где крапчатость SP-3d и проявлялась.
 *
 * Прибор нужен, чтобы увидеть, попадает ли моушн-композиция в «тяжёлое»
 * или «лёгкое» состояние растеризатора и одно ли оно на все прогоны.
 */
import {execFile} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {promisify} from 'node:util';
import {ROOT, BIN} from './lib/env.mjs';

const pexecFile = promisify(execFile);
const FFMPEG = path.join(BIN, 'ffmpeg');
const FRAME = 150;
const CROP = {w: 520, h: 520, x: 100, y: 1000};

export const energyOf = async (file) => {
  const args = ['-hide_banner', '-nostdin', '-loglevel', 'error', '-i', file,
    '-vf', `select=eq(n\\,${FRAME}),crop=${CROP.w}:${CROP.h}:${CROP.x}:${CROP.y},format=gray`,
    '-fps_mode', 'passthrough', '-frames:v', '1', '-f', 'rawvideo', '-'];
  const {stdout} = await pexecFile(FFMPEG, args, {encoding: 'buffer', maxBuffer: 64 * 1024 * 1024});
  const buf = Buffer.from(stdout);
  if (buf.length < CROP.w * CROP.h) throw new Error(`кадр ${FRAME} не извлечён из ${file}: ${buf.length} байт`);
  let sum = 0; let n = 0;
  for (let y = 0; y < CROP.h; y++) {
    for (let x = 0; x < CROP.w; x++) {
      const i = y * CROP.w + x;
      if (x + 1 < CROP.w) { sum += Math.abs(buf[i] - buf[i + 1]); n++; }
      if (y + 1 < CROP.h) { sum += Math.abs(buf[i] - buf[i + CROP.w]); n++; }
    }
  }
  return Math.round((sum / n) * 1e6) / 1e6;
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const outDir = path.join(ROOT, 'out');
  const files = fs.readdirSync(outDir).filter((f) => f.endsWith('.mp4')).sort();
  const rows = [];
  for (const f of files) {
    try {
      rows.push({file: f, frame: FRAME, crop: CROP, energy: await energyOf(path.join(outDir, f))});
    } catch (err) {
      rows.push({file: f, frame: FRAME, crop: CROP, energy: null, error: String(err?.message ?? err)});
    }
  }
  fs.writeFileSync(path.join(ROOT, 'results/raw/hf-energy.json'),
    JSON.stringify({schema: 'sp3e-energy/1', method: 'SP-3d §1.2', frame: FRAME, crop: CROP, rows}, null, 2) + '\n');
  for (const r of rows) console.log(`${r.file}\t${r.energy ?? r.error}`);
}
