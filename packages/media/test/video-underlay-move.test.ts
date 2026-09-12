// **ПЕРЕЕЗД ОКНА, СКРУГЛЕНИЕ И ПЕТЛЯ — ИЗМЕРЕНЫ НА ГОТОВЫХ ПИКСЕЛЯХ** (`VID-02c`, 2026-09-12).
//
// ═══ ТРЕБУЕТ ffmpeg. БРАУЗЕРА НЕ ТРЕБУЕТ И НЕ ЗОВЁТ ═══
//
// **ЧТО ИМЕННО ЗДЕСЬ ДОКАЗЫВАЕТСЯ И ПОЧЕМУ ИНАЧЕ НЕЛЬЗЯ.** Прямоугольник окна живёт в двух
// записях: чистой функцией `videoRectAtFrame` (её читают план дыры и тесты) и выражением
// `eval=frame` внутри графа ffmpeg (`moveExprOf`). Сверить две записи чтением невозможно —
// одна на JavaScript, другая на языке выражений фильтров, — поэтому сверка идёт ИЗМЕРЕНИЕМ:
// стадия прогоняется живьём, у каждого кадра ищутся границы НЕПРОЗРАЧНОЙ области, и они
// сравниваются с таблицей. Это тот же приём, каким `VID-02a` сверял `fps=…:round=down` с
// `videoFrameOf`, и та же причина.
//
// **КАДРЫ «БРАУЗЕРА» ЗДЕСЬ ПОЛНОСТЬЮ ПРОЗРАЧНЫ, И ЭТО ЧАСТЬ ПРИБОРА.** Всё непрозрачное в
// выходном кадре пришло СНИЗУ, от видео, — значит границы непрозрачной области и есть окно.

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  compositeVideoUnderlay,
  videoFrameTable,
  videoRectAtFrame,
  videoUnderlayArgs,
  type VideoUnderlayPlan,
} from '../src/assemble/video-underlay.js';

const pexecFile = promisify(execFile);

const TIMEOUT = 600_000;
const FRAMES = 24;
const W = 320;
const H = 480;

const GATE_CLIP = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../templates-spec/src/templates/video@1/gate-requests/assets/clip-64x36.mp4',
);

let root: string;
let framesIn: string;

/** База: 24 кадра канала 30 fps, видео 64×36 при 24 fps на 24 кадра, окно во весь сегмент. */
const BASE: VideoUnderlayPlan = {
  width: W,
  height: H,
  frameCount: FRAMES,
  fps: { num: 30, den: 1 },
  videoPath: GATE_CLIP,
  videoFps: { num: 24, den: 1 },
  videoFrames: 24,
  inPointFrame: 0,
  frameStart: 0,
  frameEnd: FRAMES,
  rect: { x: 180, y: 40, width: 120, height: 68 },
  move: null,
  radiusPx: 0,
  loop: false,
  fit: 'cover',
  background: '#000000',
  holds: [],
  zooms: [],
};

const MOVING: VideoUnderlayPlan = {
  ...BASE,
  move: { startFrame: 4, durationFrames: 12, to: { x: 0, y: 0, width: W, height: H } },
};

/** Кадр PNG в сырые RGBA-байты. Декодирует тот же ffmpeg — своего декодера здесь нет и не надо. */
async function rgbaOf(file: string): Promise<Buffer> {
  const { stdout } = await pexecFile(
    'ffmpeg',
    ['-hide_banner', '-nostdin', '-loglevel', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'],
    { encoding: 'buffer', maxBuffer: 1 << 28 },
  );
  return stdout;
}

/** Границы непрозрачной области кадра: `null`, если прозрачен весь кадр. */
function opaqueBox(
  rgba: Buffer,
  width: number,
  height: number,
): { x: number; y: number; width: number; height: number } | null {
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Порог 128, а не «больше нуля»: сглаженный край скругления даёт частичную альфу, и
      // считать её частью окна значило бы мерить ещё и ширину сглаживания.
      if ((rgba[(y * width + x) * 4 + 3] ?? 0) < 128) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}

async function runStage(plan: VideoUnderlayPlan, tag: string): Promise<string> {
  const out = path.join(root, `out-${tag}`);
  await compositeVideoUnderlay({
    framesDirIn: framesIn,
    framesDirOut: out,
    pattern: 'frame%06d.png',
    startNumber: 1,
    plan,
  });
  return out;
}

function directoryHash(dir: string): string {
  const h = createHash('sha256');
  for (const name of readdirSync(dir).sort()) {
    h.update(name).update(' ').update(createHash('sha256').update(readFileSync(path.join(dir, name))).digest('hex')).update('\n');
  }
  return h.digest('hex');
}

beforeAll(async () => {
  root = mkdtempSync(path.join(tmpdir(), 'vpe-underlay-move-'));
  framesIn = path.join(root, 'in');
  mkdirSync(framesIn, { recursive: true });
  // ПОЛНОСТЬЮ ПРОЗРАЧНЫЕ кадры «браузера» — см. шапку: непрозрачным в выходе будет ровно окно.
  await pexecFile('ffmpeg', [
    '-hide_banner', '-nostdin', '-loglevel', 'error', '-y',
    '-f', 'lavfi',
    '-i', `color=c=black@0.0:s=${String(W)}x${String(H)}:r=30:d=2,format=rgba`,
    '-frames:v', String(FRAMES),
    '-start_number', '1',
    path.join(framesIn, 'frame%06d.png'),
  ]);
}, TIMEOUT);

afterAll(() => {
  if (root !== undefined) rmSync(root, { recursive: true, force: true });
});

describe('**`move`: граф ffmpeg и чистая функция дают ОДИН прямоугольник**', () => {
  it(
    'пять кадров переезда — измерено на пикселях, не прочитано в коде',
    async () => {
      const dir = await runStage(MOVING, 'move');
      const table = Array.from({ length: FRAMES }, (_, n) => videoRectAtFrame(MOVING, n));
      for (const n of [0, 4, 10, 16, 23]) {
        const box = opaqueBox(await rgbaOf(path.join(dir, `frame${String(n + 1).padStart(6, '0')}.png`)), W, H);
        expect(box, `кадр ${String(n)} оказался прозрачен целиком`).not.toBeNull();
        const want = table[n];
        expect(want).toBeDefined();
        // ДОПУСК В ОДИН ПИКСЕЛЬ ПО КАЖДОЙ СТОРОНЕ — и он назван, а не подобран: `scale`
        // округляет размер до целого сам, независимо от нашего `round`, и на дробном
        // множителе две записи расходятся не более чем на пиксель. Расхождение БОЛЬШЕ
        // означало бы разные формулы, а не разное округление.
        // РАВЕНСТВО, А НЕ ДОПУСК: измерено — совпадают ВСЕ ЧЕТЫРЕ числа на всех 24 кадрах
        // переезда. Допуск «в пиксель» здесь означал бы, что мы не знаем, какую формулу
        // исполняет граф, — а мы знаем: ту же самую.
        expect(box, `кадр ${String(n)}`).toEqual(want);
      }
    },
    TIMEOUT,
  );
});

describe('**`radius`: углы окна прозрачны, а середина сторон — нет**', () => {
  it(
    'скругление 24 пикселя вырезает угол и не трогает край',
    async () => {
      const plan: VideoUnderlayPlan = { ...BASE, radiusPx: 24 };
      const dir = await runStage(plan, 'radius');
      const rgba = await rgbaOf(path.join(dir, 'frame000001.png'));
      const alphaAt = (x: number, y: number): number => rgba[(y * W + x) * 4 + 3] ?? 0;
      const r = plan.rect;
      // Угол окна — ВНУТРИ прямоугольника, но снаружи скруглённой дуги: обязан быть прозрачен.
      expect(alphaAt(r.x, r.y), 'левый верхний угол окна не прозрачен').toBeLessThan(16);
      expect(alphaAt(r.x + r.width - 1, r.y), 'правый верхний угол окна не прозрачен').toBeLessThan(16);
      expect(alphaAt(r.x, r.y + r.height - 1), 'левый нижний угол окна не прозрачен').toBeLessThan(16);
      // Середина верхней стороны и центр окна — непрозрачны: скругление съело только углы.
      expect(alphaAt(r.x + Math.floor(r.width / 2), r.y), 'середина верхней стороны съедена').toBeGreaterThan(200);
      expect(alphaAt(r.x + Math.floor(r.width / 2), r.y + Math.floor(r.height / 2))).toBeGreaterThan(200);
      // Без скругления тот же угол непрозрачен — иначе тест был бы зелен и на пустой маске.
      const plain = await runStage(BASE, 'plain');
      const plainRgba = await rgbaOf(path.join(plain, 'frame000001.png'));
      expect(plainRgba[(r.y * W + r.x) * 4 + 3] ?? 0).toBeGreaterThan(200);
    },
    TIMEOUT,
  );
});

describe('**`loop`: кадр `n` равен кадру `n mod frames`**', () => {
  it('таблица отображения повторяется с периодом файла', () => {
    // 24 кадра видео при 24 fps на канале 30 fps — кадр видео = floor(n·24/30). На 24 кадрах
    // сегмента файл ещё не кончается, поэтому окно берётся вдвое длиннее и с точкой входа.
    const plan: VideoUnderlayPlan = {
      ...BASE,
      loop: true,
      frameCount: 60,
      frameEnd: 60,
      inPointFrame: 20,
    };
    const table = videoFrameTable(plan);
    // Кадр 0 → 20. Кадр 5 → floor(4)+20 = 24 → вне файла → 24 mod 24 = 0.
    expect(table[0]).toBe(20);
    expect(table[5]).toBe(0);
    // Без петли тот же кадр держал бы последний: 23.
    expect(videoFrameTable({ ...plan, loop: false })[5]).toBe(23);
    // ПЕРИОДИЧНОСТЬ: на 60 кадрах канала это 48 кадров видео, то есть ровно два прохода.
    for (let n = 0; n < 60; n++) {
      const advanced = Math.floor((n * 24) / 30) + 20;
      expect(table[n], `кадр ${String(n)}`).toBe(advanced % 24);
    }
  });

  it('`-stream_loop -1` стоит на ВХОДЕ и только при `loop: true`', () => {
    const args = videoUnderlayArgs({
      framesDirIn: '/in',
      framesDirOut: '/out',
      pattern: 'frame%06d.png',
      startNumber: 1,
      plan: { ...BASE, loop: true },
    });
    const at = args.indexOf('-stream_loop');
    expect(at).toBeGreaterThan(-1);
    expect(args[at + 1]).toBe('-1');
    // Ровно перед `-i` видео, а не перед кадрами браузера: зациклить кадры значило бы
    // растянуть сегмент.
    expect(args[at + 2]).toBe('-i');
    expect(args[at + 3]).toBe(GATE_CLIP);
    expect(
      videoUnderlayArgs({
        framesDirIn: '/in',
        framesDirOut: '/out',
        pattern: 'frame%06d.png',
        startNumber: 1,
        plan: BASE,
      }),
    ).not.toContain('-stream_loop');
  });
});

describe('**Детерминизм 8/8 с `move` и `radius`**', () => {
  it(
    'восемь прогонов едущего скруглённого окна дают один sha каталога',
    async () => {
      const plan: VideoUnderlayPlan = { ...MOVING, radiusPx: 16 };
      const hashes: string[] = [];
      for (let run = 0; run < 8; run++) {
        hashes.push(directoryHash(await runStage(plan, `det-${String(run)}`)));
      }
      expect(
        new Set(hashes).size,
        `восемь прогонов дали ${String(new Set(hashes).size)} разных каталога: ` +
          'выражения `eval=frame` либо маска альфы зависят от чего-то, кроме плана',
      ).toBe(1);
    },
    TIMEOUT,
  );
});
