// ПРИБОР `where` БЕЗ БРАУЗЕРА: кадры → клипы, bbox и PSNR на синтетических PNG.
//
// ═══ ТРЕБУЕТ ffmpeg, НЕ ТРЕБУЕТ БРАУЗЕРА ═══ ffmpeg в этом проекте СИСТЕМНЫЙ (решение `M-03`
// п. 9, V6), и тесты `media` его уже требуют; skip'а по переменной здесь нет по тому же
// правилу, что в `render.test.ts`: тест либо зелёный, либо красный.
//
// ПОЧЕМУ PNG ГЕНЕРИРУЮТСЯ, А НЕ РЕНДЕРЯТСЯ. Прибор обязан быть проверяем НА ИЗВЕСТНОЙ РАЗНОСТИ:
// «bbox прямоугольника 3×2 в углу» — утверждение, которое можно проверить, а «bbox того, что
// дал браузер» — нельзя. Пиксели пишутся сырыми и превращаются в PNG тем же ffmpeg, которым
// прибор их потом читает: если бы кодек врал, тест покраснел бы на контроле (равные кадры ⇒
// PSNR = +inf).

import { mkdtempSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import type { RenderIrSegment } from '../src/contract.js';
import {
  bboxOfDiff,
  decodeRgb,
  differingFramesOf,
  formatWhereReport,
  pngSize,
  psnrOf,
  whereReport,
  windowOf,
  type WhereRun,
} from '../src/where.js';

const W = 8;
const H = 4;

/** Сырое RGB-поле, залитое одним цветом. */
function field(r: number, g: number, b: number): Buffer {
  const buf = Buffer.alloc(W * H * 3);
  for (let i = 0; i < W * H; i++) {
    buf[i * 3] = r;
    buf[i * 3 + 1] = g;
    buf[i * 3 + 2] = b;
  }
  return buf;
}

/** Ставит пиксель — так строится ИЗВЕСТНАЯ разность. */
function put(buf: Buffer, x: number, y: number, r: number, g: number, b: number): void {
  const i = (y * W + x) * 3;
  buf[i] = r;
  buf[i + 1] = g;
  buf[i + 2] = b;
}

/** Сырые пиксели → PNG на диске, ffmpeg'ом (без второго кодировщика в репозитории). */
function writePng(dir: string, name: string, rgb: Buffer): string {
  const raw = path.join(dir, `${name}.rgb`);
  const png = path.join(dir, name);
  writeFileSync(raw, rgb);
  execFileSync('ffmpeg', [
    '-hide_banner', '-nostdin', '-loglevel', 'error',
    '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${String(W)}x${String(H)}`,
    '-i', raw, '-frames:v', '1', '-y', png,
  ]);
  return png;
}

/** Строка `framemd5` — форма ffmpeg: хэш последним столбцом. */
const line = (frame: number, md5: string): string => `0, ${String(frame)}, ${String(frame)}, 1, 96, ${md5}`;

/** Листинг из 12 кадров; перечисленные кадры получают ДРУГОЙ хэш. */
const listing = (differing: readonly number[] = []): string[] =>
  Array.from({ length: 12 }, (_, i) => line(i, differing.includes(i) ? `ff${String(i)}` : `aa${String(i)}`));

/** IR с тремя клипами: фон 0–12, средний 6–10, титр 10–12. */
const IR = {
  segmentId: 'seg:w',
  segmentDurationInFrames: 12,
  clips: [
    { clipId: 'r:bg', track: 'visual', z: 10, frames: { frameStart: 0, frameEnd: 12 }, template: 'solid@1', params: {}, assets: [], fonts: [], seeds: {} },
    { clipId: 'r:mid', track: 'visual', z: 20, frames: { frameStart: 6, frameEnd: 10 }, template: 'kenburns@1', params: {}, assets: [], fonts: [], seeds: {} },
    { clipId: 'r:tail', track: 'visual', z: 30, frames: { frameStart: 10, frameEnd: 12 }, template: 'flash@1', params: {}, assets: [], fonts: [], seeds: {} },
  ],
  captions: [],
  assets: [],
  fonts: [],
} as unknown as RenderIrSegment;

const runOf = (lines: readonly string[], label: string, framesDir: string | null = null): WhereRun => ({
  label,
  framemd5Lines: lines,
  framesDir,
  pattern: 'frame_%06d.png',
  startNumber: 1,
});

describe('расходящиеся кадры — из ПОКАДРОВЫХ строк framemd5, второго прибора не нужно', () => {
  it('кадры 7–9 названы номерами строк, а не `pts`', () => {
    const { frames, compared, note } = differingFramesOf(listing(), listing([7, 8, 9]));
    expect(frames).toEqual([7, 8, 9]);
    expect(compared).toBe(12);
    expect(note).toBeNull();
  });

  it('разные длины листингов — сравнён общий префикс, и это НАЗВАНО', () => {
    const { compared, note } = differingFramesOf(listing(), listing().slice(0, 9));
    expect(compared).toBe(9);
    expect(note).toContain('R8');
  });
});

describe('«какой слой» — раскладка по окнам клипов IR', () => {
  it('расхождение 7–9 называет клип, накрывающий его, а не только фон', async () => {
    const report = await whereReport(runOf(listing(), '#1'), runOf(listing([7, 8, 9]), '#3'), IR);

    expect(report.differingFrames).toEqual([7, 8, 9]);
    expect(report.segments).toEqual([[7, 9]]);
    // Первым идёт самый «виноватый»: `r:mid` накрывает 3 своих кадра из 4 — 75 %, тогда как
    // фон накрывает те же 3 из 12 (25 %). Порядок и есть ответ «какой слой».
    expect(report.byClip[0]?.clipId).toBe('r:mid');
    expect(report.byClip[0]?.differing).toBe(3);
    expect(report.byClip[0]?.sharePct).toBe(75);
    expect(report.byClip.find((c) => c.clipId === 'r:bg')?.sharePct).toBe(25);
    expect(report.byClip.find((c) => c.clipId === 'r:tail')?.differing).toBe(0);
    expect(report.outsideClips).toEqual([]);
  });

  it('кадр вне всех окон — отдельная находка, а не строка «0 %»', async () => {
    const narrow = {
      ...IR,
      clips: [IR.clips[1] as RenderIrSegment['clips'][number]],
    } as RenderIrSegment;
    const report = await whereReport(runOf(listing(), '#1'), runOf(listing([1, 7]), '#2'), narrow);
    expect(report.outsideClips).toEqual([1]);
    expect(formatWhereReport(report)).toContain('ВНЕ окон клипов');
  });

  it('окно клипа читается и в форме модели (`frameStart`), и в форме рантайма (`start`)', () => {
    const model = { frames: { frameStart: 4, frameEnd: 9 } } as unknown as RenderIrSegment['clips'][number];
    const runtime = { frames: { start: 4, end: 9 } } as unknown as RenderIrSegment['clips'][number];
    expect(windowOf(model)).toEqual([4, 9]);
    expect(windowOf(runtime)).toEqual([4, 9]);
  });
});

describe('bbox и PSNR — на известной разности', () => {
  it('прямоугольник 3×2 найден по координатам, доле и максимальному уровню', () => {
    const a = field(10, 20, 30);
    const b = field(10, 20, 30);
    for (let y = 1; y <= 2; y++) for (let x = 5; x <= 7; x++) put(b, x, y, 10, 20, 34);
    const box = bboxOfDiff(a, b, W, H);

    expect(box.empty).toBe(false);
    if (box.empty) return;
    expect(box.x).toEqual([5, 7]);
    expect(box.y).toEqual([1, 2]);
    expect(box.differingPixels).toBe(6);
    expect(box.maxLevel).toBe(4);
    expect(box.sharePct).toBe(18.75);
  });

  it('равные кадры: bbox пуст, PSNR `+inf` — контроль прибора, а не предположение', () => {
    const a = field(1, 2, 3);
    expect(bboxOfDiff(a, field(1, 2, 3), W, H).empty).toBe(true);
    expect(psnrOf(a, field(1, 2, 3))).toBe(Infinity);
  });

  it('PSNR различает «единицы младших битов» и «катастрофу»', () => {
    const base = field(100, 100, 100);
    const nudged = field(100, 100, 100);
    put(nudged, 0, 0, 101, 100, 100);
    const wrecked = field(0, 0, 0);
    expect(psnrOf(base, nudged)).toBeGreaterThan(60);
    expect(psnrOf(base, wrecked)).toBeLessThan(20);
  });
});

describe('опорные кадры: настоящие PNG, прочитанные ffmpeg', () => {
  it('геометрия из заголовка PNG, разность найдена, PSNR конечен', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'vpe-where-'));
    const a = field(200, 100, 50);
    const b = field(200, 100, 50);
    put(b, 2, 3, 200, 100, 90);
    const fileA = writePng(dir, 'a.png', a);
    const fileB = writePng(dir, 'b.png', b);

    expect(pngSize(fileA)).toEqual({ width: W, height: H });
    const [rgbA, rgbB] = await Promise.all([decodeRgb(fileA), decodeRgb(fileB)]);
    const box = bboxOfDiff(rgbA, rgbB, W, H);
    expect(box.empty).toBe(false);
    if (box.empty) return;
    expect(box.x).toEqual([2, 2]);
    expect(box.y).toEqual([3, 3]);
    expect(Number.isFinite(psnrOf(rgbA, rgbB))).toBe(true);
  });

  it('кадры прогонов не сохранены — отчёт это НАЗЫВАЕТ, а не молчит', async () => {
    const report = await whereReport(runOf(listing(), '#1'), runOf(listing([2]), '#2'), IR);
    expect(report.probes).toHaveLength(1);
    expect(report.probes[0]?.note).toContain('не сохранены');
    expect(report.probes[0]?.bbox).toBeNull();
  });

  it('`whereReport` меряет bbox/PSNR на сохранённых кадрах двух прогонов', async () => {
    const rootA = mkdtempSync(path.join(tmpdir(), 'vpe-where-a-'));
    const rootB = mkdtempSync(path.join(tmpdir(), 'vpe-where-b-'));
    // Кадр 7 сегмента — файл `frame_000008.png` (нумерация с единицы, измерена у рендерера).
    const base = field(30, 30, 30);
    const changed = field(30, 30, 30);
    put(changed, 6, 1, 30, 30, 60);
    writePng(rootA, 'frame_000008.png', base);
    writePng(rootB, 'frame_000008.png', changed);

    const report = await whereReport(
      runOf(listing(), '#1', rootA),
      runOf(listing([7]), '#2', rootB),
      IR,
    );
    const probe = report.probes[0];
    expect(probe?.frame).toBe(7);
    expect(probe?.note).toBeNull();
    expect(probe?.width).toBe(W);
    expect(probe?.bbox?.empty).toBe(false);
    const text = formatWhereReport(report);
    expect(text).toContain('r:mid');
    expect(text).toContain('кадр 7: PSNR');
  });
});
