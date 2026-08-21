/**
 * SP-3f: ВЧ-энергия кадра по методу SP-3d §1.2 — средний модуль разности
 * СОСЕДНИХ пикселей по яркости на кропе 520×520. Прибор отвечает на вопрос
 * «попал ли прогон в другое макросостояние растеризатора».
 *
 * Кадров четыре — по одному на слой, как требует задание:
 *   20  — шейдерный фон + проявляющийся параллакс (кроп на градиенте фона);
 *   150 — типографика поверх частиц (кроп на тексте);
 *   250 — стеклянная карточка (кроп на backdrop-filter, самое «крапчатое» место);
 *   400 — финальный кадр и субтитры (кроп на тексте субтитров).
 */
import {execFile} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {promisify} from 'node:util';
import {ROOT, BIN} from './lib/env.mjs';

const pexecFile = promisify(execFile);
const FFMPEG = path.join(BIN, 'ffmpeg');
export const SPOTS = [
  {frame: 20, layer: 'шейдерный фон + параллакс', crop: {w: 520, h: 520, x: 280, y: 260}},
  {frame: 150, layer: 'типографика + частицы', crop: {w: 520, h: 520, x: 100, y: 620}},
  {frame: 250, layer: 'стеклянная карточка', crop: {w: 520, h: 520, x: 120, y: 760}},
  {frame: 400, layer: 'финальный кадр + субтитры', crop: {w: 520, h: 520, x: 120, y: 1080}},
];

export const energyAt = async (file, frame, crop) => {
  const args = ['-hide_banner', '-nostdin', '-loglevel', 'error', '-i', file,
    '-vf', `select=eq(n\\,${frame}),crop=${crop.w}:${crop.h}:${crop.x}:${crop.y},format=gray`,
    '-fps_mode', 'passthrough', '-frames:v', '1', '-f', 'rawvideo', '-'];
  const {stdout} = await pexecFile(FFMPEG, args, {encoding: 'buffer', maxBuffer: 64 * 1024 * 1024});
  const buf = Buffer.from(stdout);
  if (buf.length < crop.w * crop.h) throw new Error(`кадр ${frame} не извлечён из ${file}: ${buf.length} байт`);
  let sum = 0; let n = 0;
  for (let y = 0; y < crop.h; y++) {
    for (let x = 0; x < crop.w; x++) {
      const i = y * crop.w + x;
      if (x + 1 < crop.w) { sum += Math.abs(buf[i] - buf[i + 1]); n++; }
      if (y + 1 < crop.h) { sum += Math.abs(buf[i] - buf[i + crop.w]); n++; }
    }
  }
  return Math.round((sum / n) * 1e6) / 1e6;
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const outDir = path.join(ROOT, 'out');
  const files = fs.readdirSync(outDir).filter((f) => /^V-w4-r\d+\.mp4$/.test(f)).sort();
  const rows = [];
  for (const f of files) {
    const row = {file: f};
    for (const s of SPOTS) {
      try { row['f' + s.frame] = await energyAt(path.join(outDir, f), s.frame, s.crop); }
      catch (err) { row['f' + s.frame] = null; row.error = String(err?.message ?? err); }
    }
    rows.push(row);
    console.log(`${f}\t${SPOTS.map((s) => row['f' + s.frame]).join('\t')}`);
  }
  fs.writeFileSync(path.join(ROOT, 'results/raw/hf-energy.json'),
    JSON.stringify({schema: 'sp3f-energy/1', method: 'SP-3d §1.2', spots: SPOTS, rows}, null, 2) + '\n');
}
