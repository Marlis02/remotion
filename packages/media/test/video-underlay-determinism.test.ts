// **ВОСЕМЬ ПРОГОНОВ СТАДИИ НИЖНЕГО СЛОЯ ДАЮТ ОДИН И ТОТ ЖЕ КАТАЛОГ PNG** (`VID-02a` §2.4).
//
// ═══ ТРЕБУЕТ ffmpeg. БРАУЗЕРА НЕ ТРЕБУЕТ И НЕ ЗОВЁТ ═══
// Кадры «браузера» здесь — синтетика: непрозрачная рамка на прозрачном фоне, порождённая тем
// же ffmpeg. Предмет теста — НЕ картинка, а повторяемость стадии, и настоящий браузер добавил
// бы к ней десять секунд и чужой источник расхождений.
//
// **ПОЧЕМУ ЭТО ОТДЕЛЬНЫЙ ПРИБОР, А НЕ ЧАСТЬ ГЕЙТА.** Гейт V13 меряет пару (шаблон, профиль)
// на КОМПОЗИЦИИ, то есть на браузере; стадия ffmpeg в него не входит вовсе — она работает
// после рендера. Значит её повторяемость обязана иметь свой охранник, иначе AC4 держался бы
// на измерении, которого никто не делал.
//
// **`-threads 1` В СТАДИИ НЕТ, И ЭТОТ ФАЙЛ — ОСНОВАНИЕ.** Восемь прогонов БЕЗ него дают один
// sha; ставить флаг «на всякий случай» значило бы платить временем за уже измеренное. Если
// измерение когда-нибудь перевернётся, покраснеет этот файл — то есть раньше ролика.

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { compositeVideoUnderlay, type VideoUnderlayPlan } from '../src/assemble/video-underlay.js';

const pexecFile = promisify(execFile);

/** Восемь — число из задания `VID-02a` §2.4. */
const RUNS = 8;
/** Измерено: один прогон стадии на 30 кадрах 540×960 — около полусекунды. Запас ×20. */
const TIMEOUT = 300_000;
const FRAMES = 30;

/**
 * Видео пробы — то же синтетическое, что лежит в запросах гейта `video@1`.
 *
 * Читается из репозитория, а не порождается тестом: порождение зависело бы от версии ffmpeg,
 * то есть проба меряла бы ещё и энкодер. 64×36, 24 кадра при 24/1 — частота НЕ канальная
 * намеренно, чтобы в прогоне работало отображение 24 → 30.
 */
const GATE_CLIP = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../templates-spec/src/templates/video@1/gate-requests/assets/clip-64x36.mp4',
);

let root: string;
let framesIn: string;

const PLAN: VideoUnderlayPlan = {
  width: 540,
  height: 960,
  frameCount: FRAMES,
  fps: { num: 30, den: 1 },
  videoPath: GATE_CLIP,
  videoFps: { num: 24, den: 1 },
  videoFrames: 24,
  inPointFrame: 2,
  frameStart: 0,
  frameEnd: FRAMES,
  rect: { x: 180, y: 60, width: 300, height: 500 },
  move: null,
  radiusPx: 0,
  loop: false,
  fit: 'cover',
  background: '#000000',
  // Паузу и наезд проба берёт НАМЕРЕННО: именно они несут `loop`, перенумерацию времён и
  // выражения `eval=frame`, то есть все места, где недетерминизм мог бы завестись.
  holds: [{ atVideoFrame: 8, durationFrames: 5 }],
  zooms: [{ startFrame: 4, durationFrames: 12, from: 1, to: 1.6, centerX: 0.5, centerY: 0.45 }],
};

/** sha256 КАТАЛОГА: список имён плюс sha каждого файла — то же правило, что у композиции. */
function directoryHash(dir: string): string {
  const h = createHash('sha256');
  for (const name of readdirSync(dir).sort()) {
    const bytes = readFileSync(path.join(dir, name));
    h.update(name).update(' ').update(createHash('sha256').update(bytes).digest('hex')).update('\n');
  }
  return h.digest('hex');
}

beforeAll(async () => {
  root = mkdtempSync(path.join(tmpdir(), 'vpe-underlay-'));
  framesIn = path.join(root, 'in');
  mkdirSync(framesIn, { recursive: true });
  // Кадры «браузера»: прозрачный фон и непрозрачная рамка — та же форма, что даёт наш рендер
  // (`FACT` SP-VID A1: кадры уже `rgba`, 92.99 % прозрачно).
  await pexecFile('ffmpeg', [
    '-hide_banner',
    '-nostdin',
    '-loglevel',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'color=c=black@0.0:s=540x960:r=30:d=2,format=rgba,drawbox=x=20:y=20:w=500:h=920:color=white@1.0:t=8',
    '-frames:v',
    String(FRAMES),
    '-start_number',
    '1',
    path.join(framesIn, 'frame%06d.png'),
  ]);
}, TIMEOUT);

afterAll(() => {
  if (root !== undefined) rmSync(root, { recursive: true, force: true });
});

describe('**§2.4** — стадия нижнего слоя ПОВТОРЯЕТСЯ побайтово', () => {
  it(
    `${String(RUNS)} прогонов → один sha каталога PNG`,
    async () => {
      const hashes: string[] = [];
      for (let run = 0; run < RUNS; run++) {
        const out = path.join(root, `out-${String(run)}`);
        const done = await compositeVideoUnderlay({
          framesDirIn: framesIn,
          framesDirOut: out,
          pattern: 'frame%06d.png',
          startNumber: 1,
          plan: PLAN,
        });
        expect(readdirSync(done.dir)).toHaveLength(FRAMES);
        hashes.push(directoryHash(out));
      }
      const distinct = new Set(hashes);
      expect(
        distinct.size,
        `различных sha каталога: ${String(distinct.size)} из ${String(RUNS)} прогонов — ` +
          `${[...distinct].map((h) => h.slice(0, 12)).join(', ')}. Стадия обязана быть ` +
          'воспроизводимой побайтово: AC4 требует равенства ДВУХ сборок, а не похожести',
      ).toBe(1);
    },
    TIMEOUT,
  );
});
